export interface SimulationState {
  // Flows (m3/h)
  Q_wellfield: number;
  Q_feed: number;
  Q_perm: number;
  Q_brine: number;
  Q_out: number;
  
  // Levels (m)
  level_feed_tank: number;
  level_clearwell: number;
  
  // Volumes (m3)
  V_clearwell: number;
  
  // Chemistry
  TDS_feed: number;
  TDS_perm: number;
  pH_true: number;
  Cl_true: number;
  H2S_feed: number;
  H2S_out: number;
  
  // Pressure (bar)
  pressure_well: number;
  dP_ro_true: number;
  pressure_feed: number;
  pressure_dist: number;

  // Asset Health (0-100%) - Critical for CPS Damage Assessment
  membrane_health: number; // 100 = New, <80 = Poor Rejection, <50 = Ruptured
  pump_well_health: number; // P-101
  pump_feed_health: number; // P-201
  pump_dist_health: number; // P-401
  pipe_well_health: number; // After P-101
  pipe_feed_health: number; // After P-201
  pipe_dist_health: number; // After P-401
}

export interface SimulationControls {
  wellfield_on: boolean;
  ro_feed_pump_on: boolean;
  dist_pump_on: boolean;

  // Valves
  valve_101_open: boolean; // Wellfield Discharge
  valve_201_open: boolean; // RO Feed Pump Discharge
  valve_202_open: boolean; // RO Reject
  valve_203_open: boolean; // RO Permeate
  valve_401_open: boolean; // Distribution Discharge
  
  // Dosing Pumps
  naoh_pump_on: boolean; // P-301
  cl_pump_on: boolean; // P-302
  
  // Dosing (mg/L)
  NaOH_dose: number;
  Cl_dose: number;
  
  // Setpoints
  Q_out_sp: number;
}

export interface SimulationData {
  state: SimulationState;
  controls: SimulationControls;
  connected: boolean;
  lastUpdate: number;
}