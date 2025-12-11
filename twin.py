"""
Oldsmar-style Water Treatment Plant – CLEAN Digital Twin
-------------------------------------------------------

Differences from previous version:
- NO random noise, NO random faults.
- All instrumentation (transmitters / analysers) are clean first-order lags.
- Raw water quality variation (TDS, H2S) is handled deterministically inside
  the process model to emulate realistic "noise" at the plant level.

Requires: pip install pymodbus
"""

import math
import threading
import time
from dataclasses import dataclass
from typing import Dict

from pymodbus.datastore import (
    ModbusSequentialDataBlock,
    ModbusServerContext,
    ModbusSlaveContext,
)
from pymodbus.server import StartTcpServer


# ---------------------------------------------------------------------------
# Instrumentation model – clean, lag only
# ---------------------------------------------------------------------------

@dataclass
class Sensor:
    tag: str
    pv_key: str  # true process variable key in state dict
    meas_key: str  # measured value key in state dict
    tau: float = 5.0  # time constant (s)

    def step(self, state: Dict[str, float], dt: float) -> None:
        """Update measured value with first-order lag (no noise, no bias)."""
        true_val = state.get(self.pv_key, 0.0)
        meas_old = state.get(self.meas_key, true_val)

        # first-order lag
        alpha = dt / max(self.tau, 1e-6)
        meas_new = meas_old + alpha * (true_val - meas_old)

        state[self.meas_key] = meas_new


# ---------------------------------------------------------------------------
# Process model
# ---------------------------------------------------------------------------

class WTPTwin:
    def __init__(self) -> None:
        # --- Parameters (tune as you like) ---
        self.params = {
            # Raw water / RO
            "Q_well_nom": 100.0,  # m3/h total wellfield flow when on
            "TDS_raw_base": 2500.0,  # mg/L, base value
            "TDS_raw_amp": 300.0,  # mg/L, diurnal amplitude
            "H2S_raw_base": 5.0,  # mg/L, base value
            "H2S_raw_amp": 1.0,  # mg/L, diurnal amplitude
            "recovery": 0.75,  # RO recovery
            "salt_rejection": 0.97,  # RO salt rejection
            "degas_eff": 0.95,  # H2S removal fraction in degas tower
            # pH / NaOH:
            "pH_base": 6.5,  # pH with nominal NaOH
            "NaOH_nom": 5.0,  # mg/L, nominal dose
            "K_NaOH": 0.06,  # pH gain per (mg/L NaOH above nominal)
            "tau_pH": 60.0,  # s, pH response time constant
            # Clearwell:
            "A_clearwell": 100.0,  # m2, tank surface area
            "V_init": 500.0,  # m3, starting volume
            "Q_out_nom": 80.0,  # m3/h, nominal demand
            # Chlorine:
            "Cl_nom": 1.0,  # mg/L, nominal dose
            "k_Cl": 0.5,  # 1/h, bulk decay rate
        }

        # Simulation time (s)
        self.time = 0.0

        # --- Process state (true physical values) ---
        V0 = self.params["V_init"]
        h0 = V0 / self.params["A_clearwell"]

        self.state = {
            # Flows (m3/h)
            "Q_feed": 0.0,
            "Q_perm": 0.0,
            "Q_brine": 0.0,
            "Q_out": self.params["Q_out_nom"],
            # Quality
            "TDS_feed": self.params["TDS_raw_base"],
            "TDS_perm": 200.0,
            "TDS_brine": 0.0,
            "H2S_feed": self.params["H2S_raw_base"],
            "H2S_out": 0.25,
            "pH_true": 7.0,
            "Cl_true": 0.5,
            # Tank
            "V_clearwell": V0,  # m3
            "level_clearwell": h0,  # m
            # Placeholders for measurements (updated by sensors)
            "Q_feed_meas": 0.0,
            "Q_perm_meas": 0.0,
            "level_clearwell_meas": h0,
            "pH_meas": 7.0,
            "Cl_meas": 0.5,
        }

        # --- Instrumentation objects (clean) ---
        self.sensors = [
            Sensor("FI-101", "Q_feed", "Q_feed_meas", tau=2.0),
            Sensor("FI-302", "Q_perm", "Q_perm_meas", tau=2.0),
            Sensor("LT-601", "level_clearwell", "level_clearwell_meas", tau=15.0),
            Sensor("pH-AT-401", "pH_true", "pH_meas", tau=10.0),
            Sensor("CL-AT-601", "Cl_true", "Cl_meas", tau=30.0),
        ]

    # ------------------------------------------------------------------ #
    def _update_raw_water_quality(self) -> None:
        """
        Deterministic variation of raw water TDS and H2S based on time of day.
        No randomness – this is the only "noise" source.
        """
        p = self.params
        t_hours = (self.time / 3600.0) % 24.0  # wrap to 0–24 h

        # Simple sinusoidal variation over 24h
        theta = 2.0 * math.pi * t_hours / 24.0
        TDS = p["TDS_raw_base"] + p["TDS_raw_amp"] * math.sin(theta)
        H2S = p["H2S_raw_base"] + p["H2S_raw_amp"] * math.sin(theta + math.pi / 4)

        self.state["TDS_feed"] = max(0.0, TDS)
        self.state["H2S_feed"] = max(0.0, H2S)

    # ------------------------------------------------------------------ #
    def step(self, dt: float, controls: Dict[str, float]) -> Dict[str, float]:
        """
        Advance process by dt seconds using controls:
        controls = {
            "wellfield_on": bool,
            "ro_on": bool,
            "dist_pump_on": bool,
            "NaOH_dose": float (mg/L),
            "Cl_dose": float (mg/L),
            "Q_out_sp": float (m3/h),
        }
        """
        p = self.params
        s = self.state

        # Advance simulation time
        self.time += dt

        # Update raw water quality deterministically
        self._update_raw_water_quality()

        # ------------------ 1. Wellfield / raw water -------------------
        s["Q_feed"] = p["Q_well_nom"] if controls["wellfield_on"] else 0.0

        # ------------------ 2. RO unit (steady each step) ---------------
        Qf = s["Q_feed"]
        Cf = s["TDS_feed"]

        if controls["ro_on"] and Qf > 1e-6:
            R = p["recovery"]
            SR = p["salt_rejection"]

            Qp = R * Qf
            Qb = (1.0 - R) * Qf
            Cp = (1.0 - SR) * Cf
            Cb = (Qf * Cf - Qp * Cp) / max(Qb, 1e-6)
        else:
            Qp = 0.0
            Qb = Qf
            Cp = s["TDS_perm"]
            Cb = Cf

        s["Q_perm"] = Qp
        s["Q_brine"] = Qb
        s["TDS_perm"] = Cp
        s["TDS_brine"] = Cb

        # ------------------ 3. Degas tower (H2S removal) ---------------
        eta = p["degas_eff"]
        s["H2S_out"] = (1.0 - eta) * s["H2S_feed"]

        # ------------------ 4. NaOH dosing -> pH dynamics ---------------
        u_NaOH = controls["NaOH_dose"]
        pH_target = p["pH_base"] + p["K_NaOH"] * (u_NaOH - p["NaOH_nom"])
        tau_pH = p["tau_pH"]
        s["pH_true"] += dt / max(tau_pH, 1e-6) * (pH_target - s["pH_true"])

        # ------------------ 5. Clearwell & chlorine ---------------------
        Q_in = s["Q_perm"]  # from RO
        Q_out = max(0.0, controls["Q_out_sp"]) if controls["dist_pump_on"] else 0.0

        # Convert flows m3/h -> m3 over dt
        V = s["V_clearwell"]
        dV = (Q_in - Q_out) * (dt / 3600.0)
        V_new = V + dV
        V_new = max(0.0, V_new)

        s["V_clearwell"] = V_new
        s["level_clearwell"] = V_new / p["A_clearwell"]
        s["Q_out"] = Q_out

        # Chlorine CSTR dynamics:
        C = s["Cl_true"]
        C_in = 0.0  # assume no chlorine in RO permeate
        u_Cl = controls["Cl_dose"]
        if V_new > 1e-6:
            k_Cl = p["k_Cl"]
            dCdt = (Q_in / V_new) * (C_in + u_Cl - C) - k_Cl * C
        else:
            dCdt = -p["k_Cl"] * C

        s["Cl_true"] = max(0.0, C + (dt / 3600.0) * dCdt)

        # ------------------ 6. Instrumentation update -------------------
        for sensor in self.sensors:
            sensor.step(s, dt)

        self.state = s
        return s


# ---------------------------------------------------------------------------
# Modbus glue
# ---------------------------------------------------------------------------

def read_controls_from_modbus(context: ModbusServerContext, twin: WTPTwin) -> Dict[str, float]:
    """Read coils & holding registers and convert to engineering units."""
    slave = context[0]

    # Coils: 0=wellfield_on, 1=ro_on, 2=dist_pump_on
    coils = slave.getValues(1, 0, 3)
    wellfield_on, ro_on, dist_pump_on = map(bool, coils[:3])

    # Holding registers: 100=NaOH*100, 101=Cl*100, 102=Q_out*10
    hr = slave.getValues(3, 100, 3)
    NaOH_dose = hr[0] / 100.0  # mg/L
    Cl_dose = hr[1] / 100.0  # mg/L
    Q_out_sp = hr[2] / 10.0  # m3/h

    controls = {
        "wellfield_on": wellfield_on,
        "ro_on": ro_on,
        "dist_pump_on": dist_pump_on,
        "NaOH_dose": NaOH_dose,
        "Cl_dose": Cl_dose,
        "Q_out_sp": Q_out_sp,
    }
    return controls


def write_measurements_to_modbus(context: ModbusServerContext, state: Dict[str, float]) -> None:
    """Write measured values into holding registers (scaled integers)."""
    slave = context[0]

    # Scale to integers (OpenPLC-friendly)
    Q_feed_meas = int(max(0.0, state.get("Q_feed_meas", 0.0)) * 10.0)  # 0.1 m3/h
    Q_perm_meas = int(max(0.0, state.get("Q_perm_meas", 0.0)) * 10.0)  # 0.1 m3/h
    level_meas = int(max(0.0, state.get("level_clearwell_meas", 0.0)) * 100.0)  # cm
    pH_meas = int(max(0.0, state.get("pH_meas", 0.0)) * 100.0)  # 0.01 pH
    Cl_meas = int(max(0.0, state.get("Cl_meas", 0.0)) * 100.0)  # 0.01 mg/L
    TDS_perm = int(max(0.0, state.get("TDS_perm", 0.0)))  # mg/L

    values = [
        Q_feed_meas,  # HR 0
        Q_perm_meas,  # HR 1
        level_meas,  # HR 2
        pH_meas,  # HR 3
        Cl_meas,  # HR 4
        TDS_perm,  # HR 5
    ]
    slave.setValues(3, 0, values)


def run_simulation(context: ModbusServerContext, twin: WTPTwin) -> None:
    """Background thread that advances the twin and updates Modbus."""
    dt = 1.0  # seconds
    while True:
        controls = read_controls_from_modbus(context, twin)
        twin.step(dt, controls)
        write_measurements_to_modbus(context, twin.state)
        time.sleep(dt)


def main() -> None:
    # 1) Create Modbus datastore
    # Coils: initialise first three to 1 (all pumps ON by default)
    coil_data = [1, 1, 1] + [0] * 17  # 20 coils total
    co_block = ModbusSequentialDataBlock(0, coil_data)

    # Holding registers: 0..199
    hr_block = ModbusSequentialDataBlock(0, [0] * 200)

    store = ModbusSlaveContext(
        co=co_block,
        hr=hr_block,
        di=None,
        ir=None,
    )
    context = ModbusServerContext(slaves=store, single=True)

    # 2) Instantiate the twin and set default setpoints in HR 100–102
    twin = WTPTwin()
    p = twin.params
    slave = context[0]
    defaults = [
        int(p["NaOH_nom"] * 100.0),  # HR 100
        int(p["Cl_nom"] * 100.0),  # HR 101
        int(p["Q_out_nom"] * 10.0),  # HR 102
    ]
    slave.setValues(3, 100, defaults)

    # 3) Start simulation thread
    sim_thread = threading.Thread(
        target=run_simulation,
        args=(context, twin),
        daemon=True,
    )
    sim_thread.start()

    # 4) Start Modbus TCP server
    print("Starting CLEAN WTP digital twin Modbus server on 0.0.0.0:5020")
    print("Coils: 0=wellfield_on, 1=ro_on, 2=dist_pump_on")
    print(
        "Holding (setpoints): 100=NaOH_dose*100, 101=Cl_dose*100, 102=Q_out*10",
    )
    print(
        "Holding (measurements): 0=Q_feed*10, 1=Q_perm*10, 2=level*100, "
        "3=pH*100, 4=Cl*100, 5=TDS_perm",
    )
    StartTcpServer(context, address=("0.0.0.0", 5020))


if __name__ == "__main__":
    main()
