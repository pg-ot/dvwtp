import { SimulationState, SimulationControls } from '../types';

// Internal physics state with damage tracking
let physicsState = {
  Q_wellfield: 0,
  Q_feed: 0,
  Q_out: 0,
  level_feed_tank: 2.5,
  level_clearwell: 3.0,
  pressure_well: 0.0,
  pressure_feed: 0.0,
  pressure_dist: 0.0,
  
  // Chemistry tracking
  TDS_feed: 1250,
  pH_true: 7.2,
  Cl_true: 0.0,
  H2S_feed: 2.5,

  // CPS Damage Tracking (Persistent)
  membrane_health: 100.0,
  pump_well_health: 100.0,
  pump_feed_health: 100.0,
  pump_dist_health: 100.0,
  pipe_well_health: 100.0,
  pipe_feed_health: 100.0,
  pipe_dist_health: 100.0,
};

// Physics constants
const TANK_AREA_FEED = 10; 
const TANK_AREA_CLEARWELL = 40; 
const WELL_FLOW_RATE = 110; 
const RO_FEED_RATE = 100; 
const DIST_PUMP_CAPACITY = 120; 
const RAMP_RATE = 0.1; 
const MAX_FEED_PRESSURE = 15.0; 

// Critical Limits
const MEMBRANE_CHLORINE_LIMIT = 0.1; // mg/L - Polyamide membranes degrade instantly above this
const PIPE_BURST_PRESSURE = 25.0; // bar

export const resetDamage = async () => {
  // Reset local state
  physicsState.membrane_health = 100.0;
  physicsState.pump_well_health = 100.0;
  physicsState.pump_feed_health = 100.0;
  physicsState.pump_dist_health = 100.0;
  physicsState.pipe_well_health = 100.0;
  physicsState.pipe_feed_health = 100.0;
  physicsState.pipe_dist_health = 100.0;
  
  // Reset Python digital twin if available
  try {
    await fetch('http://localhost:5000/reset_damage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (e) {
    // Backend offline, local reset is sufficient
  }
};

export const simulatePhysics = (controls: SimulationControls, dt_seconds: number = 0.1): SimulationState => {
  // --- 1. Determine Logic Targets ---
  
  // Wellfield with Pressure Logic
  let target_Q_well = 0;
  let target_P_well = 0;
  
  if (controls.wellfield_on) {
    if (controls.valve_101_open) {
      target_Q_well = WELL_FLOW_RATE;
      target_P_well = 3.0; // Normal discharge pressure
    } else {
      // Deadhead - valve closed, pump running
      target_Q_well = 0;
      target_P_well = 12.0; // High pressure spike
    }
  } else {
    target_P_well = 0;
  }
  
  // Feed Pump Logic with Cavitation Check
  // If tank is empty but pump is on, flow is 0, but pump takes damage.
  const suction_head_ok = physicsState.level_feed_tank > 0.2;
  const discharge_path_open = controls.valve_201_open;
  
  // P-201 Cavitation Damage
  if (controls.ro_feed_pump_on && !suction_head_ok) {
     physicsState.pump_feed_health = Math.max(0, physicsState.pump_feed_health - (0.5 * dt_seconds));
  }
  
  // P-101 Deadhead Damage
  if (controls.wellfield_on && !controls.valve_101_open) {
     physicsState.pump_well_health = Math.max(0, physicsState.pump_well_health - (0.3 * dt_seconds));
  }
  
  // P-401 Cavitation and Deadhead Damage
  if (controls.dist_pump_on) {
    if (physicsState.level_clearwell < 0.2) {
      // Cavitation
      physicsState.pump_dist_health = Math.max(0, physicsState.pump_dist_health - (0.5 * dt_seconds));
    }
    if (!controls.valve_401_open) {
      // Deadhead
      physicsState.pump_dist_health = Math.max(0, physicsState.pump_dist_health - (0.3 * dt_seconds));
    }
  }
  
  const pump_efficiency = physicsState.pump_feed_health / 100.0;
  
  // RO System Logic
  // RO requires: Pump ON + Suction OK + RO Enable + Permeate Open + Reject Open
  // Note: We allow flow even if logic is bad, to simulate leaks/pressure if valves are wrong
  let target_Q_feed = 0;
  let target_P_feed = 0;

  if (controls.ro_feed_pump_on && suction_head_ok) {
     if (discharge_path_open) {
        // Pump is pushing water
        if (controls.valve_202_open && controls.valve_203_open) {
            // Normal Operation
            target_Q_feed = RO_FEED_RATE * pump_efficiency;
            target_P_feed = 12.0; // Normal operating pressure
        } else {
            // Deadhead against RO Block (High Pressure Attack)
            target_Q_feed = 0;
            target_P_feed = MAX_FEED_PRESSURE * 2.0; // Massive spike
        }
     } else {
         // Deadhead at Pump Discharge (Valve 201 Closed)
         target_Q_feed = 0;
         target_P_feed = MAX_FEED_PRESSURE * 2.2; // Max pump shutoff head
     }
  } else {
     target_P_feed = 0; // Pump off
  }

  // Distribution with Pressure Logic
  let target_Q_dist = 0;
  let target_P_dist = 0;
  
  if (controls.dist_pump_on && physicsState.level_clearwell > 0.1) {
    if (controls.valve_401_open) {
      target_Q_dist = Math.min(controls.Q_out_sp, DIST_PUMP_CAPACITY);
      target_P_dist = 4.0; // Normal discharge pressure
    } else {
      // Deadhead - valve closed, pump running
      target_Q_dist = 0;
      target_P_dist = 15.0; // High pressure spike
    }
  } else {
    target_P_dist = 0;
  }

  // --- 2. Apply Physics Ramps (Inertia) ---
  physicsState.Q_wellfield += (target_Q_well - physicsState.Q_wellfield) * RAMP_RATE;
  physicsState.Q_feed += (target_Q_feed - physicsState.Q_feed) * RAMP_RATE;
  physicsState.Q_out += (target_Q_dist - physicsState.Q_out) * RAMP_RATE;
  
  // Pressure responds faster than flow (hydraulic shock)
  physicsState.pressure_well += (target_P_well - physicsState.pressure_well) * 0.5;
  physicsState.pressure_feed += (target_P_feed - physicsState.pressure_feed) * 0.5;
  physicsState.pressure_dist += (target_P_dist - physicsState.pressure_dist) * 0.5;
  
  // Pipe Damage from Overpressure
  if (physicsState.pressure_well > 10) {
    physicsState.pipe_well_health = Math.max(0, physicsState.pipe_well_health - (0.2 * dt_seconds));
  }
  if (physicsState.pressure_feed > 20) {
    physicsState.pipe_feed_health = Math.max(0, physicsState.pipe_feed_health - (0.5 * dt_seconds));
  }
  if (physicsState.pressure_dist > 12) {
    physicsState.pipe_dist_health = Math.max(0, physicsState.pipe_dist_health - (0.3 * dt_seconds));
  }

  // --- 3. Chemistry & Damage Logic ---

  // Chlorine Calculation
  // Dose (mg/L) = Feed Rate / Flow. Simplified here: Output = Input + Dose
  // If feed flow is zero, dose concentrates in the pipe (dangerous)
  let current_Cl = 0;
  if (controls.cl_pump_on) {
    if (physicsState.Q_feed > 5) {
        current_Cl = Math.max(0, (controls.Cl_dose * 0.9)); // Some consumption
    } else if (controls.Cl_dose > 0) {
        // Static water gets super-chlorinated if dosing pump runs without flow
        current_Cl = 50.0; 
    }
  }

  physicsState.Cl_true += (current_Cl - physicsState.Cl_true) * 0.1;

  // Membrane Damage Logic (Irreversible)
  // If Chlorine > Limit, health degrades.
  if (physicsState.Cl_true > MEMBRANE_CHLORINE_LIMIT && physicsState.Q_feed > 0) {
      // Chemical Attack: Oxidation
      physicsState.membrane_health = Math.max(0, physicsState.membrane_health - (0.2 * dt_seconds));
  }
  // High Pressure Damage
  if (physicsState.pressure_feed > 20.0) {
      // Mechanical Attack: Rupture
      physicsState.membrane_health = Math.max(0, physicsState.membrane_health - (1.0 * dt_seconds));
  }

  // pH Calculation (only if NaOH pump is on)
  const pH_adjustment = controls.naoh_pump_on ? (controls.NaOH_dose * 0.15) : 0;
  
  // Calculate Rejection based on health
  // Healthy (100) = 98% rejection. Damaged (0) = 0% rejection.
  const rejection_rate = 0.98 * (physicsState.membrane_health / 100.0);
  
  // RO Recovery Ratio (Fixed for hydraulics, usually controlled by valve position in real life)
  const ro_recovery = 0.75; 

  // --- 4. Mass Balance (Level Integration) ---
  
  // Feed Tank
  // If level > 5.0, we have overflow. In a sim, we clamp level but logically mass is lost.
  const dV_feed = (physicsState.Q_wellfield - physicsState.Q_feed) * (dt_seconds / 3600);
  physicsState.level_feed_tank += dV_feed / TANK_AREA_FEED;
  
  // Physical overflow check (CPS Hazard)
  let is_overflowing_feed = false;
  if (physicsState.level_feed_tank > 5.0) {
      physicsState.level_feed_tank = 5.0; // Liquid spills out top
      is_overflowing_feed = true;
  }
  if (physicsState.level_feed_tank < 0) physicsState.level_feed_tank = 0;

  // Clearwell
  const Q_perm_actual = physicsState.Q_feed * ro_recovery;
  const dV_clear = (Q_perm_actual - physicsState.Q_out) * (dt_seconds / 3600);
  physicsState.level_clearwell += dV_clear / TANK_AREA_CLEARWELL;
  
  if (physicsState.level_clearwell > 6.0) {
     physicsState.level_clearwell = 6.0; // Spilling
  }
  if (physicsState.level_clearwell < 0) physicsState.level_clearwell = 0;

  // --- 5. Derived Values ---
  const TDS_feed = 1250 + Math.sin(Date.now() / 10000) * 20; 
  const TDS_perm = TDS_feed * (1 - rejection_rate); // Critical CPS Indicator
  
  const pH_true = 7.0 + pH_adjustment; // Simple pH model
  
  // Differential Pressure increases as membrane fouls or flow increases
  // If membrane is ruptured (health low), dP actually drops because it leaks.
  let dP_ro = 0;
  if (physicsState.Q_feed > 1) {
      const flow_component = (physicsState.Q_feed / RO_FEED_RATE);
      // Rupture factor: if health < 30, dP collapses
      const rupture_factor = physicsState.membrane_health < 30 ? 0.2 : 1.0;
      dP_ro = (0.5 + flow_component * 1.5) * rupture_factor;
  }

  // Sensor Noise
  const noise = (mag: number) => (Math.random() - 0.5) * mag;

  return {
    Q_wellfield: physicsState.Q_wellfield > 1 ? physicsState.Q_wellfield + noise(2) : 0,
    Q_feed: physicsState.Q_feed > 1 ? physicsState.Q_feed + noise(2) : 0,
    Q_perm: Q_perm_actual > 0.1 ? Q_perm_actual + noise(1) : 0,
    Q_brine: (physicsState.Q_feed - Q_perm_actual) > 0.1 ? (physicsState.Q_feed - Q_perm_actual) + noise(1) : 0,
    Q_out: physicsState.Q_out > 1 ? physicsState.Q_out + noise(1) : 0,
    
    level_feed_tank: physicsState.level_feed_tank, 
    level_clearwell: physicsState.level_clearwell,
    V_clearwell: physicsState.level_clearwell * TANK_AREA_CLEARWELL,
    
    TDS_feed: TDS_feed + noise(5),
    TDS_perm: TDS_perm + noise(2), // Watch this value for attack confirmation
    pH_true: pH_true + noise(0.05),
    Cl_true: physicsState.Cl_true > 0.05 ? physicsState.Cl_true + noise(0.01) : 0,
    H2S_feed: 2.5,
    H2S_out: 0,
    
    pressure_well: physicsState.pressure_well + noise(0.1),
    dP_ro_true: dP_ro + noise(0.02),
    pressure_feed: physicsState.pressure_feed + noise(0.1),
    pressure_dist: physicsState.pressure_dist + noise(0.1),

    membrane_health: physicsState.membrane_health,
    pump_well_health: physicsState.pump_well_health,
    pump_feed_health: physicsState.pump_feed_health,
    pump_dist_health: physicsState.pump_dist_health,
    pipe_well_health: physicsState.pipe_well_health,
    pipe_feed_health: physicsState.pipe_feed_health,
    pipe_dist_health: physicsState.pipe_dist_health,
  };
};