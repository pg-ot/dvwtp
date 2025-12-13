# Modbus Register Map - Water Treatment Plant Digital Twin

## Connection Details
- **Protocol**: Modbus TCP
- **IP Address**: localhost (127.0.0.1)
- **Port**: 502
- **Unit ID**: 1

## Coils (Function Code 01/05) - Digital Controls

| Address | Name | Description | Type |
|---------|------|-------------|------|
| 0 | wellfield_on | Wellfield Pump P-101 | R/W |
| 1 | ro_feed_pump_on | RO Feed Pump P-201 | R/W |
| 2 | dist_pump_on | Distribution Pump P-401 | R/W |
| 3 | valve_101_open | Wellfield Discharge Valve | R/W |
| 4 | valve_201_open | RO Feed Discharge Valve | R/W |
| 5 | valve_202_open | RO Reject Valve | R/W |
| 6 | valve_203_open | RO Permeate Valve | R/W |
| 7 | valve_401_open | Distribution Discharge Valve | R/W |
| 8 | naoh_pump_on | NaOH Dosing Pump P-301 | R/W |
| 9 | cl_pump_on | Chlorine Dosing Pump P-302 | R/W |

## Holding Registers (Function Code 03/06/16) - Analog Values

### Setpoints (Write)
| Address | Name | Unit | Scale | Range | Description |
|---------|------|------|-------|-------|-------------|
| 0 | NaOH_dose | mg/L | ÷10 | 0-200 | NaOH dosing rate |
| 1 | Cl_dose | mg/L | ÷10 | 0-50 | Chlorine dosing rate |
| 2 | Q_out_sp | m³/h | ÷1 | 0-150 | Distribution flow setpoint |

### Process Variables (Read Only)
| Address | Name | Unit | Scale | Description |
|---------|------|------|-------|-------------|
| 10 | Q_wellfield | m³/h | ÷1 | Wellfield flow |
| 11 | Q_feed | m³/h | ÷1 | RO feed flow |
| 12 | Q_perm | m³/h | ÷1 | RO permeate flow |
| 13 | Q_brine | m³/h | ÷1 | RO reject flow |
| 14 | Q_out | m³/h | ÷1 | Distribution flow |
| 15 | level_feed_tank | m | ÷100 | Feed tank level (0-5m) |
| 16 | level_clearwell | m | ÷100 | Clearwell level (0-6m) |
| 17 | pressure_well | bar | ÷10 | P-101 discharge pressure |
| 18 | pressure_feed | bar | ÷10 | P-201 discharge pressure |
| 19 | pressure_dist | bar | ÷10 | P-401 discharge pressure |
| 20 | dP_ro_true | bar | ÷100 | RO differential pressure |
| 21 | TDS_feed | µS/cm | ÷1 | Feed conductivity |
| 22 | TDS_perm | µS/cm | ÷1 | Permeate conductivity |
| 23 | pH_true | pH | ÷100 | Product pH (7.00 = 700) |
| 24 | Cl_true | mg/L | ÷100 | Residual chlorine |

### Equipment Health (Read Only)
| Address | Name | Unit | Scale | Description |
|---------|------|------|-------|-------------|
| 30 | membrane_health | % | ÷10 | RO membrane condition |
| 31 | pump_well_health | % | ÷10 | P-101 pump health |
| 32 | pump_feed_health | % | ÷10 | P-201 pump health |
| 33 | pump_dist_health | % | ÷10 | P-401 pump health |
| 34 | pipe_well_health | % | ÷10 | P-101 discharge pipe |
| 35 | pipe_feed_health | % | ÷10 | P-201 discharge pipe |
| 36 | pipe_dist_health | % | ÷10 | P-401 discharge pipe |

## OpenPLC Configuration Example

### Ladder Logic Variables
```
// Digital Outputs (Coils)
%QX0.0 - wellfield_on
%QX0.1 - ro_feed_pump_on
%QX0.2 - dist_pump_on
%QX0.3 - valve_101_open
%QX0.4 - valve_201_open
%QX0.5 - valve_202_open
%QX0.6 - valve_203_open
%QX0.7 - valve_401_open
%QX1.0 - naoh_pump_on
%QX1.1 - cl_pump_on

// Analog Outputs (Holding Registers)
%QW0 - NaOH_dose (scaled)
%QW1 - Cl_dose (scaled)
%QW2 - Q_out_sp

// Analog Inputs (Holding Registers)
%IW10 - Q_wellfield
%IW11 - Q_feed
%IW12 - Q_perm
%IW15 - level_feed_tank
%IW16 - level_clearwell
%IW17 - pressure_well
%IW18 - pressure_feed
%IW30 - membrane_health
```

### Modbus Master Configuration
1. Add Modbus TCP Master device
2. IP: 127.0.0.1 (or digital twin IP)
3. Port: 502
4. Slave ID: 1
5. Polling Rate: 100ms

## Scaling Examples

### Writing Setpoints (PLC → Twin)
```
NaOH dose = 5.0 mg/L
Register value = 5.0 × 10 = 50
Write to register 0: value = 50
```

### Reading Process Variables (Twin → PLC)
```
Register 15 value = 250
level_feed_tank = 250 ÷ 100 = 2.50 m

Register 23 value = 735
pH_true = 735 ÷ 100 = 7.35 pH
```

## Testing with Modbus Tools

### Using modpoll (Linux/Windows)
```bash
# Read all coils
modpoll -m tcp -t 0 -r 0 -c 11 127.0.0.1

# Write coil (start pump)
modpoll -m tcp -t 0 -r 0 -1 127.0.0.1 1

# Read process variables
modpoll -m tcp -t 4 -r 10 -c 15 127.0.0.1

# Write setpoint
modpoll -m tcp -t 4 -r 0 -1 127.0.0.1 50
```

### Using Python pymodbus
```python
from pymodbus.client import ModbusTcpClient

client = ModbusTcpClient('127.0.0.1', port=502)
client.connect()

# Start wellfield pump
client.write_coil(0, True)

# Read flow rate
result = client.read_holding_registers(10, 1)
flow = result.registers[0]  # m³/h

# Set NaOH dose to 5.0 mg/L
client.write_register(0, 50)

client.close()
```

## Attack Scenarios via Modbus

### Scenario 1: Membrane Chemical Attack
```
1. Write coil 10 = 1 (cl_pump_on)
2. Write register 1 = 50 (Cl_dose = 5.0 mg/L)
3. Monitor register 30 (membrane_health decreases)
```

### Scenario 2: Pump Deadhead
```
1. Write coil 0 = 1 (wellfield_on)
2. Write coil 3 = 0 (valve_101_open = closed)
3. Monitor register 17 (pressure_well spikes)
4. Monitor register 31 (pump_well_health decreases)
```

### Scenario 3: RO Overpressure
```
1. Write coil 1 = 1 (ro_feed_pump_on)
2. Write coil 5 = 0 (valve_202_open = closed)
3. Write coil 6 = 0 (valve_203_open = closed)
4. Monitor register 18 (pressure_feed > 20 bar)
5. Monitor register 30 (membrane_health drops rapidly)
```
