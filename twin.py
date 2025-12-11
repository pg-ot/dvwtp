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

import json
import math
import threading
import time
from dataclasses import dataclass
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Dict, Optional

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
            "recovery_clean": 0.75,  # nominal RO recovery
            "recovery_dTDS": 0.08,  # recovery drop per (g/L) feed TDS above base
            "salt_rejection_clean": 0.97,  # clean RO salt rejection
            "salt_rejection_dTDS": 0.01,  # rejection drop per (g/L) feed TDS above base
            "dP_clean_bar": 1.2,  # bar, clean RO differential pressure
            "dP_dTDS_bar": 0.15,  # bar per (g/L) feed TDS above base
            "degas_eff": 0.95,  # H2S removal fraction in degas tower
            # pH / NaOH:
            "pH_base": 6.8,  # pH with nominal NaOH
            "NaOH_nom": 5.0,  # mg/L, nominal dose
            "alkalinity_meq": 2.0,  # meq/L natural alkalinity
            "tau_pH": 60.0,  # s, pH response time constant
            # Clearwell:
            "A_clearwell": 100.0,  # m2, tank surface area
            "V_init": 500.0,  # m3, starting volume
            "Q_out_nom": 80.0,  # m3/h, nominal demand
            "pump_tau": 8.0,  # s, pump flow ramp time constant
            # Chlorine:
            "Cl_nom": 1.0,  # mg/L, nominal dose
            "k_Cl_base": 0.5,  # 1/h, bulk decay rate at pH 7
            "k_Cl_pH_gain": 0.12,  # fractional increase per pH unit above 7
            "k_Cl_temp_gain": 0.02,  # fractional increase per degC above 20C
            "temp_C": 24.0,  # assumed bulk temperature
        }

        # Simulation time (s)
        self.time = 0.0

        # Synchronisation primitive for concurrent readers (Modbus + web UI)
        self._lock = threading.RLock()

        # --- Process state (true physical values) ---
        V0 = self.params["V_init"]
        h0 = V0 / self.params["A_clearwell"]

        self.state = {
            # Flows (m3/h)
            "Q_feed": 0.0,
            "Q_perm": 0.0,
            "Q_brine": 0.0,
            "Q_out": self.params["Q_out_nom"],
            "Q_feed_target": self.params["Q_well_nom"],
            # Quality
            "TDS_feed": self.params["TDS_raw_base"],
            "TDS_perm": 200.0,
            "TDS_brine": 0.0,
            "H2S_feed": self.params["H2S_raw_base"],
            "H2S_out": 0.25,
            "pH_true": 7.0,
            "Cl_true": 0.5,
            "dP_ro_true": 1.2,
            # Tank
            "V_clearwell": V0,  # m3
            "level_clearwell": h0,  # m
            # Placeholders for measurements (updated by sensors)
            "Q_feed_meas": 0.0,
            "Q_perm_meas": 0.0,
            "level_clearwell_meas": h0,
            "pH_meas": 7.0,
            "Cl_meas": 0.5,
            "dP_ro_meas": 1.2,
        }

        # --- Instrumentation objects (clean) ---
        self.sensors = [
            Sensor("FI-101", "Q_feed", "Q_feed_meas", tau=2.0),
            Sensor("FI-302", "Q_perm", "Q_perm_meas", tau=2.0),
            Sensor("LT-601", "level_clearwell", "level_clearwell_meas", tau=15.0),
            Sensor("pH-AT-401", "pH_true", "pH_meas", tau=10.0),
            Sensor("CL-AT-601", "Cl_true", "Cl_meas", tau=30.0),
            Sensor("DP-501", "dP_ro_true", "dP_ro_meas", tau=5.0),
        ]

        # Bring plant to a sensible steady-state before exposing measurements
        self._settle_initial_state()

    # ------------------------------------------------------------------ #
    def _settle_initial_state(self) -> None:
        """Iterate the model to reach a quasi steady-state starting point."""
        default_controls = {
            "wellfield_on": True,
            "ro_on": True,
            "dist_pump_on": True,
            "NaOH_dose": self.params["NaOH_nom"],
            "Cl_dose": self.params["Cl_nom"],
            "Q_out_sp": self.params["Q_out_nom"],
        }
        for _ in range(900):  # 15 minutes of warmup at dt=1s
            self.step(1.0, default_controls)

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
    def _effective_ro_performance(self, feed_tds: float) -> Dict[str, float]:
        """Return recovery, salt rejection, and dP adjusted for feed quality."""
        p = self.params
        d_tds_g = max(0.0, (feed_tds - p["TDS_raw_base"]) / 1000.0)

        recovery = p["recovery_clean"] - p["recovery_dTDS"] * d_tds_g
        recovery = min(max(recovery, 0.55), 0.82)

        salt_rejection = p["salt_rejection_clean"] - p["salt_rejection_dTDS"] * d_tds_g
        salt_rejection = min(max(salt_rejection, 0.9), 0.99)

        dP = p["dP_clean_bar"] + p["dP_dTDS_bar"] * d_tds_g

        return {
            "recovery": recovery,
            "salt_rejection": salt_rejection,
            "dP": dP,
        }

    # ------------------------------------------------------------------ #
    def _pH_from_NaOH(self, NaOH_dose: float, current_pH: float, dt: float) -> float:
        """Buffer-aware pH update using alkalinity and NaOH addition (log scale)."""
        p = self.params
        # Convert alkalinity to mol/L (1 meq/L = 1e-3 eq/L)
        alkalinity_mol = p["alkalinity_meq"] * 1e-3
        # NaOH dose mg/L -> mol/L (MW=40 g/mol)
        oh_add_mol = max(0.0, NaOH_dose) / 40000.0
        # Assume baseline OH- from alkalinity; convert pH to H+ concentration
        h_conc = 10 ** (-current_pH)
        oh_conc = max(1e-12, alkalinity_mol + oh_add_mol)
        # Net hydroxide after neutralising existing H+
        net_oh = max(1e-12, oh_conc - h_conc)
        target_pH = 14.0 + math.log10(net_oh)
        tau_pH = p["tau_pH"]
        return current_pH + dt / max(tau_pH, 1e-6) * (target_pH - current_pH)

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
        with self._lock:
            s = self.state

            # Advance simulation time
            self.time += dt

            # Update raw water quality deterministically
            self._update_raw_water_quality()

            # ------------------ 1. Wellfield / raw water -------------------
            pump_tau = p["pump_tau"]
            s["Q_feed_target"] = p["Q_well_nom"] if controls["wellfield_on"] else 0.0
            s["Q_feed"] += dt / max(pump_tau, 1e-6) * (s["Q_feed_target"] - s["Q_feed"])

            # ------------------ 2. RO unit (steady each step) ---------------
            Qf = s["Q_feed"]
            Cf = s["TDS_feed"]

            if controls["ro_on"] and Qf > 1e-6:
                perf = self._effective_ro_performance(Cf)
                R = perf["recovery"]
                SR = perf["salt_rejection"]

                Qp = R * Qf
                Qb = (1.0 - R) * Qf
                Cp = (1.0 - SR) * Cf
                Cb = (Qf * Cf - Qp * Cp) / max(Qb, 1e-6)
                s["dP_ro_true"] = perf["dP"]
            else:
                Qp = 0.0
                Qb = Qf
                Cp = s["TDS_perm"]
                Cb = Cf
                s["dP_ro_true"] = 0.0

            s["Q_perm"] = Qp
            s["Q_brine"] = Qb
            s["TDS_perm"] = Cp
            s["TDS_brine"] = Cb

            # ------------------ 3. Degas tower (H2S removal) ---------------
            eta = p["degas_eff"]
            s["H2S_out"] = (1.0 - eta) * s["H2S_feed"]

            # ------------------ 4. NaOH dosing -> pH dynamics ---------------
            u_NaOH = controls["NaOH_dose"]
            s["pH_true"] = self._pH_from_NaOH(u_NaOH, s["pH_true"], dt)

            # ------------------ 5. Clearwell & chlorine ---------------------
            Q_in = s["Q_perm"]  # from RO
            Q_out_target = max(0.0, controls["Q_out_sp"]) if controls["dist_pump_on"] else 0.0
            s["Q_out"] += dt / max(pump_tau, 1e-6) * (Q_out_target - s["Q_out"])
            Q_out = max(0.0, s["Q_out"])

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
                k_Cl = p["k_Cl_base"] * (
                    1.0
                    + p["k_Cl_pH_gain"] * max(0.0, s["pH_true"] - 7.0)
                    + p["k_Cl_temp_gain"] * max(0.0, p["temp_C"] - 20.0)
                )
                dCdt = (Q_in / V_new) * (C_in + u_Cl - C) - k_Cl * C
            else:
                dCdt = -p["k_Cl_base"] * C

            s["Cl_true"] = max(0.0, C + (dt / 3600.0) * dCdt)

            # ------------------ 6. Instrumentation update -------------------
            for sensor in self.sensors:
                sensor.step(s, dt)

            self.state = s
            return dict(self.state)

    # ------------------------------------------------------------------ #
    def snapshot(self) -> Dict[str, Dict[str, float]]:
        """Thread-safe shallow copy of params and state for external readers."""
        with self._lock:
            return {
                "time": self.time,
                "params": dict(self.params),
                "state": dict(self.state),
            }


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


def write_controls_to_modbus(context: ModbusServerContext, changes: Dict[str, float]) -> Dict[str, float]:
    """Persist requested control changes and return the resulting controls."""

    slave = context[0]
    controls = read_controls_from_modbus(context, twin=None)  # type: ignore[arg-type]

    def clamp(value: float, lo: float, hi: float) -> float:
        return max(lo, min(hi, float(value)))

    if "wellfield_on" in changes:
        controls["wellfield_on"] = bool(changes["wellfield_on"])
    if "ro_on" in changes:
        controls["ro_on"] = bool(changes["ro_on"])
    if "dist_pump_on" in changes:
        controls["dist_pump_on"] = bool(changes["dist_pump_on"])

    if "NaOH_dose" in changes:
        controls["NaOH_dose"] = clamp(changes["NaOH_dose"], 0.0, 50.0)
    if "Cl_dose" in changes:
        controls["Cl_dose"] = clamp(changes["Cl_dose"], 0.0, 10.0)
    if "Q_out_sp" in changes:
        controls["Q_out_sp"] = clamp(changes["Q_out_sp"], 0.0, 200.0)

    slave.setValues(1, 0, [
        int(controls["wellfield_on"]),
        int(controls["ro_on"]),
        int(controls["dist_pump_on"]),
    ])

    slave.setValues(3, 100, [
        int(round(controls["NaOH_dose"] * 100.0)),
        int(round(controls["Cl_dose"] * 100.0)),
        int(round(controls["Q_out_sp"] * 10.0)),
    ])

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
    dP_ro = int(max(0.0, state.get("dP_ro_meas", 0.0)) * 100.0)  # bar * 100

    values = [
        Q_feed_meas,  # HR 0
        Q_perm_meas,  # HR 1
        level_meas,  # HR 2
        pH_meas,  # HR 3
        Cl_meas,  # HR 4
        TDS_perm,  # HR 5
        dP_ro,  # HR 6
    ]
    slave.setValues(3, 0, values)


def build_state_payload(twin: WTPTwin, context: Optional[ModbusServerContext]) -> Dict:
    """Create a serialisable state/controls payload with minimal lock time."""
    snapshot = twin.snapshot()
    try:
        controls = read_controls_from_modbus(context, twin) if context is not None else {}
    except Exception:
        controls = {"error": "modbus unavailable"}

    return {
        "time_s": snapshot["time"],
        "state": snapshot["state"],
        "params": snapshot["params"],
        "controls": controls,
    }


# ---------------------------------------------------------------------------
# Lightweight web visualisation
# ---------------------------------------------------------------------------


def _dashboard_html() -> str:
    """Return a compact HTML page that polls /api/state for visuals."""
    return """
<!DOCTYPE html>
<html lang=\"en\">
<head>
  <meta charset=\"UTF-8\" />
  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />
  <title>CLEAN WTP Twin</title>
  <style>
    :root {
      --bg: #0e1a2a;
      --panel: #13233a;
      --accent: #4fc3f7;
      --warn: #ffa000;
      --ok: #4caf50;
      --text: #e8f1f8;
    }
    body { background: var(--bg); color: var(--text); font-family: 'Segoe UI', sans-serif; margin: 0; }
    header { padding: 16px 20px; border-bottom: 1px solid #1f3553; }
    h1 { margin: 0; font-size: 20px; }
    main { padding: 16px; display: grid; gap: 12px; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); }
    .card { background: var(--panel); border: 1px solid #1f3553; border-radius: 10px; padding: 14px; box-shadow: 0 5px 12px rgba(0,0,0,0.25); }
    .card h2 { margin: 0 0 8px; font-size: 15px; letter-spacing: 0.02em; text-transform: uppercase; color: #bcd7f2; }
    .metric { display: flex; justify-content: space-between; margin: 4px 0; }
    .meter { background: #0b1524; border: 1px solid #1f3553; border-radius: 999px; height: 12px; position: relative; overflow: hidden; }
    .fill { background: linear-gradient(90deg, #4fc3f7, #4dd0e1); height: 100%; width: 0%; transition: width 0.3s ease-out; }
    .status { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px; }
    .status.on { background: rgba(76, 175, 80, 0.2); color: var(--ok); border: 1px solid rgba(76, 175, 80, 0.4); }
    .status.off { background: rgba(255, 160, 0, 0.15); color: var(--warn); border: 1px solid rgba(255, 160, 0, 0.4); }
    .subtitle { color: #92a8c4; font-size: 12px; margin-bottom: 6px; }
    .controls { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); margin-top: 8px; }
    button, input[type=\"number\"] { width: 100%; box-sizing: border-box; border-radius: 8px; border: 1px solid #1f3553; background: #0b1524; color: var(--text); padding: 8px 10px; font-size: 14px; }
    button { cursor: pointer; transition: border-color 0.15s ease, color 0.15s ease; }
    button:hover { border-color: var(--accent); color: var(--accent); }
    label { font-size: 12px; color: #9db3d2; display: block; margin-bottom: 4px; }
    .hint { color: #7e93b3; font-size: 12px; margin-top: 6px; }
  </style>
</head>
<body>
  <header>
    <div style=\"display:flex;align-items:center;justify-content:space-between;gap:12px;\">
      <div>
        <h1>CLEAN WTP Digital Twin – Live Overview</h1>
        <div class=\"subtitle\">Updates pushed via server-sent events; falls back to 1s polling. Adjust setpoints below.</div>
      </div>
      <div id=\"conn_status\" class=\"status off\">Connecting...</div>
    </div>
  </header>
  <main>
    <section class=\"card\">
      <h2>Raw Water & RO</h2>
      <div class=\"metric\"><span>Wellfield Pump</span><span id=\"wellfield_status\" class=\"status off\">OFF</span></div>
      <div class=\"metric\"><span>RO Train</span><span id=\"ro_status\" class=\"status off\">OFF</span></div>
      <div class=\"metric\"><span>Feed Flow</span><span id=\"Q_feed\">-</span></div>
      <div class=\"meter\"><div id=\"Q_feed_bar\" class=\"fill\"></div></div>
      <div class=\"metric\"><span>Permeate Flow</span><span id=\"Q_perm\">-</span></div>
      <div class=\"meter\"><div id=\"Q_perm_bar\" class=\"fill\"></div></div>
      <div class=\"metric\"><span>RO dP</span><span id=\"dP_ro\">-</span></div>
      <div class=\"meter\"><div id=\"dP_bar\" class=\"fill\"></div></div>
      <div class=\"metric\"><span>Feed TDS</span><span id=\"TDS_feed\">-</span></div>
      <div class=\"metric\"><span>Permeate TDS</span><span id=\"TDS_perm\">-</span></div>
    </section>

    <section class=\"card\">
      <h2>Chemistry</h2>
      <div class=\"metric\"><span>NaOH Dose</span><span id=\"NaOH_dose\">-</span></div>
      <div class=\"metric\"><span>pH (proc)</span><span id=\"pH\">-</span></div>
      <div class=\"meter\"><div id=\"pH_bar\" class=\"fill\"></div></div>
      <div class=\"metric\"><span>Cl Dose</span><span id=\"Cl_dose\">-</span></div>
      <div class=\"metric\"><span>Residual Cl</span><span id=\"Cl_true\">-</span></div>
      <div class=\"meter\"><div id=\"Cl_bar\" class=\"fill\"></div></div>
      <div class=\"metric\"><span>H2S after Degas</span><span id=\"H2S_out\">-</span></div>
    </section>

    <section class=\"card\">
      <h2>Clearwell & Distribution</h2>
      <div class=\"metric\"><span>Distribution Pump</span><span id=\"dist_status\" class=\"status off\">OFF</span></div>
      <div class=\"metric\"><span>Clearwell Level</span><span id=\"level\">-</span></div>
      <div class=\"meter\"><div id=\"level_bar\" class=\"fill\"></div></div>
      <div class=\"metric\"><span>Tank Volume</span><span id=\"volume\">-</span></div>
      <div class=\"metric\"><span>Demand Setpoint</span><span id=\"Q_out_sp\">-</span></div>
      <div class=\"metric\"><span>Outlet Flow</span><span id=\"Q_out\">-</span></div>
    </section>

    <section class=\"card\">
      <h2>Controls</h2>
      <div class=\"controls\">
        <div>
          <label>Wellfield Pump</label>
          <button id=\"toggle_wellfield\">Toggle</button>
        </div>
        <div>
          <label>RO Train</label>
          <button id=\"toggle_ro\">Toggle</button>
        </div>
        <div>
          <label>Distribution Pump</label>
          <button id=\"toggle_dist\">Toggle</button>
        </div>
      </div>
      <div class=\"controls\">
        <div>
          <label for=\"NaOH_input\">NaOH Dose (mg/L)</label>
          <input id=\"NaOH_input\" type=\"number\" step=\"0.1\" min=\"0\" max=\"50\" />
        </div>
        <div>
          <label for=\"Cl_input\">Cl Dose (mg/L)</label>
          <input id=\"Cl_input\" type=\"number\" step=\"0.1\" min=\"0\" max=\"10\" />
        </div>
        <div>
          <label for=\"Qout_input\">Demand Setpoint (m3/h)</label>
          <input id=\"Qout_input\" type=\"number\" step=\"1\" min=\"0\" max=\"200\" />
        </div>
      </div>
      <div class=\"controls\">
        <div>
          <button id=\"apply_setpoints\">Apply Setpoints</button>
        </div>
      </div>
      <div class=\"hint\" id=\"last_action\">Use the controls above to update Modbus coils and setpoints.</div>
    </section>
  </main>

  <script>
    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
    const conn = document.getElementById('conn_status');
    const setConnection = (txt, ok) => {
      conn.textContent = txt;
      conn.classList.toggle('on', ok);
      conn.classList.toggle('off', !ok);
    };

    const render = (data) => {
      if (!data || !data.state) return;
      const s = data.state;
      const c = data.controls || {};
      const params = data.params || {};

      const setStatus = (el, on) => {
        el.textContent = on ? 'ON' : 'OFF';
        el.classList.toggle('on', on);
        el.classList.toggle('off', !on);
      };

      setStatus(document.getElementById('wellfield_status'), !!c.wellfield_on);
      setStatus(document.getElementById('ro_status'), !!c.ro_on);
      setStatus(document.getElementById('dist_status'), !!c.dist_pump_on);

      document.getElementById('Q_feed').textContent = s.Q_feed.toFixed(1) + ' m3/h';
      document.getElementById('Q_perm').textContent = s.Q_perm.toFixed(1) + ' m3/h';
      document.getElementById('Q_out').textContent = s.Q_out.toFixed(1) + ' m3/h';
      document.getElementById('Q_out_sp').textContent = (c.Q_out_sp || 0).toFixed(1) + ' m3/h';
      document.getElementById('TDS_feed').textContent = s.TDS_feed.toFixed(0) + ' mg/L';
      document.getElementById('TDS_perm').textContent = s.TDS_perm.toFixed(0) + ' mg/L';
      document.getElementById('dP_ro').textContent = s.dP_ro_true.toFixed(2) + ' bar';
      document.getElementById('NaOH_dose').textContent = (c.NaOH_dose || 0).toFixed(2) + ' mg/L';
      document.getElementById('Cl_dose').textContent = (c.Cl_dose || 0).toFixed(2) + ' mg/L';
      document.getElementById('pH').textContent = s.pH_true.toFixed(2);
      document.getElementById('Cl_true').textContent = s.Cl_true.toFixed(2) + ' mg/L';
      document.getElementById('H2S_out').textContent = s.H2S_out.toFixed(2) + ' mg/L';
      document.getElementById('level').textContent = (s.level_clearwell_meas || s.level_clearwell).toFixed(2) + ' m';
      document.getElementById('volume').textContent = s.V_clearwell.toFixed(1) + ' m3';

      document.getElementById('NaOH_input').value = (c.NaOH_dose || 0).toFixed(2);
      document.getElementById('Cl_input').value = (c.Cl_dose || 0).toFixed(2);
      document.getElementById('Qout_input').value = (c.Q_out_sp || 0).toFixed(1);

      document.getElementById('Q_feed_bar').style.width = clamp(100 * s.Q_feed / (params.Q_well_nom + 1e-6), 0, 100) + '%';
      document.getElementById('Q_perm_bar').style.width = clamp(100 * s.Q_perm / (params.Q_well_nom + 1e-6), 0, 100) + '%';
      document.getElementById('dP_bar').style.width = clamp(100 * s.dP_ro_true / 4.0, 0, 100) + '%';
      document.getElementById('pH_bar').style.width = clamp(100 * (s.pH_true / 14.0), 0, 100) + '%';
      document.getElementById('Cl_bar').style.width = clamp(100 * s.Cl_true / 3.0, 0, 100) + '%';
      document.getElementById('level_bar').style.width = clamp(100 * s.level_clearwell / 5.0, 0, 100) + '%';
    };

    async function poll() {
      try {
        const res = await fetch('/api/state');
        if (!res.ok) return setConnection('API unavailable', false);
        const data = await res.json();
        setConnection('Polling', true);
        render(data);
      } catch (err) {
        console.error(err);
        setConnection('Polling error', false);
      } finally {
        setTimeout(poll, 1000);
      }
    }

    function startStream() {
      if (!('EventSource' in window)) {
        setConnection('Polling (no SSE)', false);
        return poll();
      }

      const es = new EventSource('/api/stream');
      es.onopen = () => setConnection('Live (SSE)', true);
      es.onmessage = (ev) => {
        try {
          render(JSON.parse(ev.data));
        } catch (err) {
          console.error(err);
        }
      };
      es.onerror = () => {
        setConnection('Reconnecting...', false);
        es.close();
        setTimeout(startStream, 1500);
      };
    }

    async function sendControl(changes, friendly) {
      try {
        const res = await fetch('/api/control', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(changes),
        });
        if (!res.ok) throw new Error('Request failed');
        const payload = await res.json();
        render(payload);
        const msg = `${friendly} updated at ${new Date().toLocaleTimeString()}`;
        document.getElementById('last_action').textContent = msg;
      } catch (err) {
        console.error(err);
        document.getElementById('last_action').textContent = 'Control update failed';
      }
    }

    document.getElementById('toggle_wellfield').onclick = () => {
      const on = document.getElementById('wellfield_status').classList.contains('off');
      sendControl({ wellfield_on: on }, 'Wellfield');
    };

    document.getElementById('toggle_ro').onclick = () => {
      const on = document.getElementById('ro_status').classList.contains('off');
      sendControl({ ro_on: on }, 'RO train');
    };

    document.getElementById('toggle_dist').onclick = () => {
      const on = document.getElementById('dist_status').classList.contains('off');
      sendControl({ dist_pump_on: on }, 'Distribution pump');
    };

    document.getElementById('apply_setpoints').onclick = () => {
      const NaOH = parseFloat(document.getElementById('NaOH_input').value || '0');
      const Cl = parseFloat(document.getElementById('Cl_input').value || '0');
      const Qout = parseFloat(document.getElementById('Qout_input').value || '0');
      sendControl({ NaOH_dose: NaOH, Cl_dose: Cl, Q_out_sp: Qout }, 'Setpoints');
    };

    startStream();
  </script>
</body>
</html>
    """


class TwinRequestHandler(BaseHTTPRequestHandler):
    twin: WTPTwin
    context: Optional[ModbusServerContext]

    def _json_body(self) -> Dict[str, float]:
        length = int(self.headers.get("Content-Length", 0))
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        try:
            return json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            return {}

    def _send_json(self, payload: Dict) -> None:
        data = json.dumps(payload).encode()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:  # noqa: N802 - keep BaseHTTPRequestHandler signature
        if self.path == "/":
            html = _dashboard_html().encode()
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(html)))
            self.end_headers()
            self.wfile.write(html)
            return

        if self.path == "/api/state":
            self._send_json(build_state_payload(self.twin, self.context))
            return

        if self.path == "/api/stream":
            payload = build_state_payload(self.twin, self.context)
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Connection", "keep-alive")
            self.end_headers()
            try:
                while True:
                    msg = f"data: {json.dumps(payload)}\n\n".encode()
                    self.wfile.write(msg)
                    self.wfile.flush()
                    time.sleep(1.0)
                    payload = build_state_payload(self.twin, self.context)
            except Exception:
                # Client closed connection or encountered an error; just exit loop
                return

        self.send_error(HTTPStatus.NOT_FOUND, "Not found")

    def do_POST(self) -> None:  # noqa: N802 - keep BaseHTTPRequestHandler signature
        if self.path == "/api/control" and self.context is not None:
            changes = self._json_body()
            controls = write_controls_to_modbus(self.context, changes)
            payload = build_state_payload(self.twin, self.context)
            payload["controls"] = controls
            self._send_json(payload)
            return

        self.send_error(HTTPStatus.NOT_FOUND, "Not found")

    def log_message(self, fmt: str, *args) -> None:  # silence default stdout noise
        return


def start_http_server(twin: WTPTwin, context: Optional[ModbusServerContext], host: str = "0.0.0.0", port: int = 8000) -> ThreadingHTTPServer:
    """Start a background HTTP server that surfaces dashboard and JSON state."""

    handler_cls = type(
        "_TwinHandler",
        (TwinRequestHandler,),
        {"twin": twin, "context": context},
    )
    server = ThreadingHTTPServer((host, port), handler_cls)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    print(f"Web dashboard available at http://{host}:{port}")
    return server


def run_simulation(context: ModbusServerContext, twin: WTPTwin) -> None:
    """Background thread that advances the twin and updates Modbus."""
    dt = 1.0  # seconds
    while True:
        controls = read_controls_from_modbus(context, twin)
        state = twin.step(dt, controls)
        write_measurements_to_modbus(context, state)
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

    # 4) Start lightweight web dashboard
    start_http_server(twin, context, port=8000)

    # 5) Start Modbus TCP server
    print("Starting CLEAN WTP digital twin Modbus server on 0.0.0.0:5020")
    print("Coils: 0=wellfield_on, 1=ro_on, 2=dist_pump_on")
    print(
        "Holding (setpoints): 100=NaOH_dose*100, 101=Cl_dose*100, 102=Q_out*10",
    )
    print(
        "Holding (measurements): 0=Q_feed*10, 1=Q_perm*10, 2=level*100, "
        "3=pH*100, 4=Cl*100, 5=TDS_perm, 6=dP_ro*100",
    )
    StartTcpServer(context=context, address=("0.0.0.0", 5020))


if __name__ == "__main__":
    main()
