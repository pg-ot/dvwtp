#!/usr/bin/env python3
"""
Digital Twin for Water Treatment Plant
Simulates physical processes and equipment damage
Integrates with OpenPLC via Modbus TCP and SCADA via REST API
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
from pymodbus.server import StartAsyncTcpServer
from pymodbus.datastore import ModbusSlaveContext, ModbusServerContext
from pymodbus.datastore import ModbusSequentialDataBlock
import asyncio
import threading
import time
import math

app = Flask(__name__)
CORS(app)

# Physics State (Persistent)
physics_state = {
    'Q_wellfield': 0.0,
    'Q_feed': 0.0,
    'Q_out': 0.0,
    'level_feed_tank': 2.5,
    'level_clearwell': 3.0,
    'pressure_well': 0.0,
    'pressure_feed': 0.0,
    'pressure_dist': 0.0,
    'TDS_feed': 1250.0,
    'pH_true': 7.2,
    'Cl_true': 0.0,
    'H2S_feed': 2.5,
    
    # Equipment Health (Persistent Damage)
    'membrane_health': 100.0,
    'pump_well_health': 100.0,
    'pump_feed_health': 100.0,
    'pump_dist_health': 100.0,
    'pipe_well_health': 100.0,
    'pipe_feed_health': 100.0,
    'pipe_dist_health': 100.0,
}

# Control Inputs (from PLC or SCADA)
controls = {
    'wellfield_on': False,
    'ro_feed_pump_on': False,
    'dist_pump_on': False,
    'valve_101_open': True,
    'valve_201_open': True,
    'valve_202_open': True,
    'valve_203_open': True,
    'valve_401_open': True,
    'naoh_pump_on': False,
    'cl_pump_on': False,
    'NaOH_dose': 5.0,
    'Cl_dose': 1.0,
    'Q_out_sp': 80.0,
}

# Constants
TANK_AREA_FEED = 10.0
TANK_AREA_CLEARWELL = 40.0
WELL_FLOW_RATE = 110.0
RO_FEED_RATE = 100.0
DIST_PUMP_CAPACITY = 120.0
RAMP_RATE = 0.1
MAX_FEED_PRESSURE = 15.0
MEMBRANE_CHLORINE_LIMIT = 0.1

last_update = time.time()

# Modbus Register Mapping
# Coils (0x): Digital Outputs/Inputs (Boolean)
COIL_MAP = {
    0: 'wellfield_on',
    1: 'ro_feed_pump_on',
    2: 'dist_pump_on',
    3: 'valve_101_open',
    4: 'valve_201_open',
    5: 'valve_202_open',
    6: 'valve_203_open',
    7: 'valve_401_open',
    8: 'naoh_pump_on',
    9: 'cl_pump_on',
}

# Holding Registers (4x): Analog Values (16-bit integers, scaled)
REGISTER_MAP = {
    # Setpoints (Write)
    0: ('NaOH_dose', 10.0),      # Scale: value/10
    1: ('Cl_dose', 10.0),
    2: ('Q_out_sp', 1.0),
    
    # Process Variables (Read) - scaled to fit 16-bit
    10: ('Q_wellfield', 1.0),
    11: ('Q_feed', 1.0),
    12: ('Q_perm', 1.0),
    13: ('Q_brine', 1.0),
    14: ('Q_out', 1.0),
    15: ('level_feed_tank', 100.0),    # cm
    16: ('level_clearwell', 100.0),
    17: ('pressure_well', 10.0),       # 0.1 bar
    18: ('pressure_feed', 10.0),
    19: ('pressure_dist', 10.0),
    20: ('dP_ro_true', 100.0),         # 0.01 bar
    21: ('TDS_feed', 1.0),
    22: ('TDS_perm', 1.0),
    23: ('pH_true', 100.0),            # pH * 100
    24: ('Cl_true', 100.0),            # mg/L * 100
    
    # Equipment Health (Read)
    30: ('membrane_health', 10.0),     # 0.1%
    31: ('pump_well_health', 10.0),
    32: ('pump_feed_health', 10.0),
    33: ('pump_dist_health', 10.0),
    34: ('pipe_well_health', 10.0),
    35: ('pipe_feed_health', 10.0),
    36: ('pipe_dist_health', 10.0),
}

# Modbus Datastore
modbus_store = None

def simulate_physics(dt):
    """Run one physics timestep"""
    global physics_state
    
    # --- 1. Wellfield Logic ---
    target_Q_well = 0.0
    target_P_well = 0.0
    
    if controls['wellfield_on']:
        if controls['valve_101_open']:
            target_Q_well = WELL_FLOW_RATE
            target_P_well = 3.0
        else:
            target_Q_well = 0.0
            target_P_well = 12.0
    
    if controls['wellfield_on'] and not controls['valve_101_open']:
        physics_state['pump_well_health'] = max(0, physics_state['pump_well_health'] - (0.3 * dt))
    
    # --- 2. RO Feed Pump Logic ---
    suction_head_ok = physics_state['level_feed_tank'] > 0.2
    discharge_path_open = controls['valve_201_open']
    
    if controls['ro_feed_pump_on'] and not suction_head_ok:
        physics_state['pump_feed_health'] = max(0, physics_state['pump_feed_health'] - (0.5 * dt))
    
    pump_efficiency = physics_state['pump_feed_health'] / 100.0
    
    target_Q_feed = 0.0
    target_P_feed = 0.0
    
    if controls['ro_feed_pump_on'] and suction_head_ok:
        if discharge_path_open:
            if controls['valve_202_open'] and controls['valve_203_open']:
                target_Q_feed = RO_FEED_RATE * pump_efficiency
                target_P_feed = 12.0
            else:
                target_Q_feed = 0.0
                target_P_feed = MAX_FEED_PRESSURE * 2.0
        else:
            target_Q_feed = 0.0
            target_P_feed = MAX_FEED_PRESSURE * 2.2
    
    # --- 3. Distribution Pump Logic ---
    target_Q_dist = 0.0
    target_P_dist = 0.0
    
    if controls['dist_pump_on'] and physics_state['level_clearwell'] > 0.1:
        if controls['valve_401_open']:
            target_Q_dist = min(controls['Q_out_sp'], DIST_PUMP_CAPACITY)
            target_P_dist = 4.0
        else:
            target_Q_dist = 0.0
            target_P_dist = 15.0
    
    if controls['dist_pump_on']:
        if physics_state['level_clearwell'] < 0.2:
            physics_state['pump_dist_health'] = max(0, physics_state['pump_dist_health'] - (0.5 * dt))
        if not controls['valve_401_open']:
            physics_state['pump_dist_health'] = max(0, physics_state['pump_dist_health'] - (0.3 * dt))
    
    # --- 4. Apply Ramps ---
    physics_state['Q_wellfield'] += (target_Q_well - physics_state['Q_wellfield']) * RAMP_RATE
    physics_state['Q_feed'] += (target_Q_feed - physics_state['Q_feed']) * RAMP_RATE
    physics_state['Q_out'] += (target_Q_dist - physics_state['Q_out']) * RAMP_RATE
    
    physics_state['pressure_well'] += (target_P_well - physics_state['pressure_well']) * 0.5
    physics_state['pressure_feed'] += (target_P_feed - physics_state['pressure_feed']) * 0.5
    physics_state['pressure_dist'] += (target_P_dist - physics_state['pressure_dist']) * 0.5
    
    # --- 5. Pipe Damage from Overpressure ---
    if physics_state['pressure_well'] > 10:
        physics_state['pipe_well_health'] = max(0, physics_state['pipe_well_health'] - (0.2 * dt))
    if physics_state['pressure_feed'] > 20:
        physics_state['pipe_feed_health'] = max(0, physics_state['pipe_feed_health'] - (0.5 * dt))
    if physics_state['pressure_dist'] > 12:
        physics_state['pipe_dist_health'] = max(0, physics_state['pipe_dist_health'] - (0.3 * dt))
    
    # --- 6. Chemistry ---
    current_Cl = 0.0
    if controls['cl_pump_on']:
        if physics_state['Q_feed'] > 5:
            current_Cl = max(0, controls['Cl_dose'] * 0.9)
        elif controls['Cl_dose'] > 0:
            current_Cl = 50.0
    
    physics_state['Cl_true'] += (current_Cl - physics_state['Cl_true']) * 0.1
    
    if physics_state['Cl_true'] > MEMBRANE_CHLORINE_LIMIT and physics_state['Q_feed'] > 0:
        physics_state['membrane_health'] = max(0, physics_state['membrane_health'] - (0.2 * dt))
    
    if physics_state['pressure_feed'] > 20.0:
        physics_state['membrane_health'] = max(0, physics_state['membrane_health'] - (1.0 * dt))
    
    pH_adjustment = (controls['NaOH_dose'] * 0.15) if controls['naoh_pump_on'] else 0
    physics_state['pH_true'] = 7.0 + pH_adjustment
    
    # --- 7. RO Performance ---
    rejection_rate = 0.98 * (physics_state['membrane_health'] / 100.0)
    ro_recovery = 0.75
    
    Q_perm_actual = physics_state['Q_feed'] * ro_recovery
    Q_brine_actual = physics_state['Q_feed'] - Q_perm_actual
    
    TDS_perm = physics_state['TDS_feed'] * (1 - rejection_rate)
    
    dP_ro = 0.0
    if physics_state['Q_feed'] > 1:
        flow_component = physics_state['Q_feed'] / RO_FEED_RATE
        rupture_factor = 0.2 if physics_state['membrane_health'] < 30 else 1.0
        dP_ro = (0.5 + flow_component * 1.5) * rupture_factor
    
    # --- 8. Mass Balance ---
    dV_feed = (physics_state['Q_wellfield'] - physics_state['Q_feed']) * (dt / 3600.0)
    physics_state['level_feed_tank'] += dV_feed / TANK_AREA_FEED
    physics_state['level_feed_tank'] = max(0, min(5.0, physics_state['level_feed_tank']))
    
    dV_clear = (Q_perm_actual - physics_state['Q_out']) * (dt / 3600.0)
    physics_state['level_clearwell'] += dV_clear / TANK_AREA_CLEARWELL
    physics_state['level_clearwell'] = max(0, min(6.0, physics_state['level_clearwell']))
    
    # --- 9. Return State ---
    return {
        'Q_wellfield': physics_state['Q_wellfield'],
        'Q_feed': physics_state['Q_feed'],
        'Q_perm': Q_perm_actual,
        'Q_brine': Q_brine_actual,
        'Q_out': physics_state['Q_out'],
        'level_feed_tank': physics_state['level_feed_tank'],
        'level_clearwell': physics_state['level_clearwell'],
        'V_clearwell': physics_state['level_clearwell'] * TANK_AREA_CLEARWELL,
        'TDS_feed': physics_state['TDS_feed'],
        'TDS_perm': TDS_perm,
        'pH_true': physics_state['pH_true'],
        'Cl_true': physics_state['Cl_true'],
        'H2S_feed': 2.5,
        'H2S_out': 0.0,
        'pressure_well': physics_state['pressure_well'],
        'dP_ro_true': dP_ro,
        'pressure_feed': physics_state['pressure_feed'],
        'pressure_dist': physics_state['pressure_dist'],
        'membrane_health': physics_state['membrane_health'],
        'pump_well_health': physics_state['pump_well_health'],
        'pump_feed_health': physics_state['pump_feed_health'],
        'pump_dist_health': physics_state['pump_dist_health'],
        'pipe_well_health': physics_state['pipe_well_health'],
        'pipe_feed_health': physics_state['pipe_feed_health'],
        'pipe_dist_health': physics_state['pipe_dist_health'],
    }

def update_modbus_from_controls():
    """Write controls to Modbus coils"""
    if modbus_store is None:
        return
    
    context = modbus_store[0]
    
    # Update coils
    for addr, key in COIL_MAP.items():
        value = 1 if controls[key] else 0
        context.setValues(1, addr, [value])  # Function code 1 = coils

def update_controls_from_modbus():
    """Read controls from Modbus coils"""
    if modbus_store is None:
        return
    
    context = modbus_store[0]
    
    # Read coils
    for addr, key in COIL_MAP.items():
        values = context.getValues(1, addr, 1)
        controls[key] = bool(values[0])
    
    # Read setpoint registers
    for addr, (key, scale) in REGISTER_MAP.items():
        if addr < 10:  # Setpoints are 0-9
            values = context.getValues(3, addr, 1)
            controls[key] = float(values[0]) / scale

def update_modbus_from_state(state):
    """Write process variables to Modbus registers"""
    if modbus_store is None:
        return
    
    context = modbus_store[0]
    
    # Update registers
    for addr, (key, scale) in REGISTER_MAP.items():
        if addr >= 10:  # Process variables start at 10
            if key in state:
                value = int(state[key] * scale)
                value = max(0, min(65535, value))  # Clamp to 16-bit
                context.setValues(3, addr, [value])

def physics_loop():
    """Real-time physics simulation loop"""
    global last_update
    
    print("Physics loop started")
    
    while True:
        now = time.time()
        dt = now - last_update
        last_update = now
        
        # Read controls from Modbus
        update_controls_from_modbus()
        
        # Run physics
        state = simulate_physics(dt)
        
        # Write state to Modbus
        update_modbus_from_state(state)
        
        time.sleep(0.1)  # 10Hz update rate

# ============= REST API Endpoints =============

@app.route('/sync', methods=['POST'])
def sync():
    """Sync endpoint - receives control commands, returns plant state"""
    global controls
    
    try:
        data = request.get_json()
        
        if 'controls' in data:
            controls.update(data['controls'])
            update_modbus_from_controls()
        
        state = simulate_physics(0)  # Get current state without time advance
        
        return jsonify({
            'status': 'ok',
            'state': state,
            'controls': controls,
            'timestamp': time.time()
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/control', methods=['POST'])
def control():
    """Direct control endpoint"""
    global controls
    
    try:
        data = request.get_json()
        controls.update(data)
        update_modbus_from_controls()
        return jsonify({'status': 'ok', 'controls': controls})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/reset_damage', methods=['POST'])
def reset_damage():
    """Reset all equipment health to 100%"""
    global physics_state
    
    physics_state['membrane_health'] = 100.0
    physics_state['pump_well_health'] = 100.0
    physics_state['pump_feed_health'] = 100.0
    physics_state['pump_dist_health'] = 100.0
    physics_state['pipe_well_health'] = 100.0
    physics_state['pipe_feed_health'] = 100.0
    physics_state['pipe_dist_health'] = 100.0
    
    return jsonify({'status': 'ok', 'message': 'Damage reset'})

@app.route('/state', methods=['GET'])
def get_state():
    """Get current plant state"""
    state = simulate_physics(0)
    return jsonify({'state': state, 'controls': controls})

@app.route('/health', methods=['GET'])
def health():
    """Health check"""
    return jsonify({'status': 'running', 'timestamp': time.time()})

# ============= Modbus Server Setup =============

async def run_modbus_server():
    """Start Modbus TCP server"""
    global modbus_store
    
    # Initialize datastore
    coils = ModbusSequentialDataBlock(0, [0] * 100)
    discrete_inputs = ModbusSequentialDataBlock(0, [0] * 100)
    holding_registers = ModbusSequentialDataBlock(0, [0] * 100)
    input_registers = ModbusSequentialDataBlock(0, [0] * 100)
    
    store = ModbusSlaveContext(
        di=discrete_inputs,
        co=coils,
        hr=holding_registers,
        ir=input_registers
    )
    
    context = ModbusServerContext(slaves=store, single=True)
    modbus_store = context
    
    print("Starting Modbus TCP server on port 502...")
    await StartAsyncTcpServer(context=context, address=("0.0.0.0", 502))

def start_modbus_thread():
    """Start Modbus server in separate thread"""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    loop.run_until_complete(run_modbus_server())

if __name__ == '__main__':
    print("=" * 70)
    print("Digital Twin for Water Treatment Plant")
    print("=" * 70)
    print("\n🔧 Starting Services:")
    print("  • Modbus TCP Server: 0.0.0.0:502 (OpenPLC Integration)")
    print("  • REST API Server:   0.0.0.0:5000 (SCADA Integration)")
    print("\n📊 Modbus Register Map:")
    print("  Coils (0-10):        Pump/Valve Controls")
    print("  Registers (0-2):     Setpoints (NaOH, Cl2, Flow)")
    print("  Registers (10-24):   Process Variables")
    print("  Registers (30-36):   Equipment Health")
    print("\n🔗 REST Endpoints:")
    print("  POST /sync          - Sync with SCADA")
    print("  POST /control       - Direct control")
    print("  POST /reset_damage  - Reset equipment damage")
    print("  GET  /state         - Get current state")
    print("=" * 70)
    
    # Start Modbus server in background thread
    modbus_thread = threading.Thread(target=start_modbus_thread, daemon=True)
    modbus_thread.start()
    
    # Start physics loop in background thread
    physics_thread = threading.Thread(target=physics_loop, daemon=True)
    physics_thread.start()
    
    # Start Flask REST API
    app.run(host='0.0.0.0', port=5000, debug=False, use_reloader=False)
