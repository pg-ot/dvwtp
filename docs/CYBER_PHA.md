# Cyber Process Hazard Analysis (Cyber-PHA)
## Water Treatment Plant Digital Twin

**Study Date:** 2024  
**Methodology:** HAZOP-style What-If Analysis  
**Scope:** Cybersecurity attack scenarios via Modbus/SCADA manipulation  
**Risk Matrix:** Consequence × Likelihood → Risk Level

---

## Risk Assessment Criteria

### Consequence Severity
- **1 - Negligible**: No equipment damage, minor process upset
- **2 - Minor**: Temporary equipment stress, recoverable
- **3 - Moderate**: Equipment degradation, water quality impact
- **4 - Major**: Equipment failure, extended downtime
- **5 - Catastrophic**: Multiple equipment failures, safety hazard, environmental release

### Likelihood (Cyber Attack)
- **A - Very Low**: Requires deep system knowledge + physical access
- **B - Low**: Requires authenticated access + expertise
- **C - Medium**: Requires network access + basic PLC knowledge
- **D - High**: Simple Modbus command, easily scripted
- **E - Very High**: Single command, immediate effect

### Risk Level
| Consequence | Likelihood | Risk |
|-------------|------------|------|
| 5 | D/E | **CRITICAL** |
| 4-5 | C | **HIGH** |
| 3-4 | B-D | **MEDIUM** |
| 1-2 | Any | **LOW** |

---

## Node 1: Wellfield System (P-101, XV-101)

### 1.1 P-101 Running + XV-101 Closed

**What-If:** Attacker starts pump with discharge valve closed  
**Modbus Commands:**
```
Write Coil 0 = 1  (wellfield_on = TRUE)
Write Coil 4 = 0  (valve_101_open = FALSE)
```

**Consequences:**
- Pressure spike to 12 bar (normal: 3 bar)
- Pump deadhead condition
- Pump health degrades at 0.3%/sec (18%/min)
- Pipe stress, potential burst at >10 bar
- Pipe health degrades at 0.2%/sec

**Observable Indicators:**
- Register 17 (pressure_well) > 100 (10 bar)
- Register 10 (Q_wellfield) = 0
- Register 31 (pump_well_health) decreasing
- Register 34 (pipe_well_health) decreasing

**Time to Failure:** ~5 minutes to pump damage, ~8 minutes to pipe burst

**Risk Assessment:**
- Consequence: 4 (Major - pump failure)
- Likelihood: D (High - simple 2-command attack)
- **Risk Level: HIGH**

**Mitigation (PLC Logic):**
- Interlock: IF valve_101_open = FALSE THEN wellfield_on = FALSE
- Pressure limit: IF pressure_well > 8 bar THEN wellfield_on = FALSE
- Alarm: pressure_well > 6 bar

---

### 1.2 P-101 Stopped + XV-101 Open (Normal Stop)

**What-If:** Normal shutdown sequence  
**Modbus Commands:**
```
Write Coil 0 = 0  (wellfield_on = FALSE)
```

**Consequences:**
- Feed tank stops filling
- Level drops if RO continues running
- No immediate damage

**Observable Indicators:**
- Register 15 (level_feed_tank) decreasing
- Register 10 (Q_wellfield) = 0

**Time to Impact:** ~30 minutes to low tank level (depends on RO flow)

**Risk Assessment:**
- Consequence: 2 (Minor - process upset)
- Likelihood: E (Very High)
- **Risk Level: LOW**

**Mitigation:** Low-level alarm on feed tank

---

### 1.3 XV-101 Closed During Operation

**What-If:** Valve closed while pump running  
**Modbus Commands:**
```
Write Coil 4 = 0  (valve_101_open = FALSE)
```
*Assumes pump already running*

**Consequences:** Same as 1.1 (deadhead condition)

**Risk Assessment:**
- Consequence: 4 (Major)
- Likelihood: D (High)
- **Risk Level: HIGH**

---

## Node 2: Feed Tank (TK-200)

### 2.1 Overflow Attack

**What-If:** Fill tank faster than discharge  
**Modbus Commands:**
```
Write Coil 0 = 1   (wellfield_on = TRUE)
Write Coil 1 = 0   (ro_feed_pump_on = FALSE)
Write Coil 4 = 1   (valve_101_open = TRUE)
```

**Consequences:**
- Tank level rises to 5.0m (max)
- Overflow condition (clamped in simulation)
- Environmental spill in real plant
- Flooding of equipment area

**Observable Indicators:**
- Register 15 (level_feed_tank) > 480 (4.8m)
- Q_wellfield > 0, Q_feed = 0

**Time to Overflow:** ~20 minutes (depends on initial level)

**Risk Assessment:**
- Consequence: 4 (Major - environmental release)
- Likelihood: D (High)
- **Risk Level: HIGH**

**Mitigation:**
- High-level interlock: IF level_feed_tank > 4.5m THEN wellfield_on = FALSE
- Overflow alarm at 4.8m

---

### 2.2 Tank Depletion Attack

**What-If:** Drain tank faster than fill  
**Modbus Commands:**
```
Write Coil 0 = 0   (wellfield_on = FALSE)
Write Coil 1 = 1   (ro_feed_pump_on = TRUE)
```

**Consequences:**
- Tank level drops to 0.2m
- P-201 cavitation begins
- Pump damage at 0.5%/sec (30%/min)
- Complete pump failure in ~3 minutes

**Observable Indicators:**
- Register 15 (level_feed_tank) < 20 (0.2m)
- Register 32 (pump_feed_health) decreasing rapidly

**Time to Failure:** ~3 minutes

**Risk Assessment:**
- Consequence: 4 (Major - pump failure)
- Likelihood: D (High)
- **Risk Level: HIGH**

**Mitigation:**
- Low-level interlock: IF level_feed_tank < 0.5m THEN ro_feed_pump_on = FALSE

---

## Node 3: RO Feed System (P-201, XV-201)

### 3.1 P-201 Deadhead (XV-201 Closed)

**What-If:** Pump running with discharge valve closed  
**Modbus Commands:**
```
Write Coil 1 = 1   (ro_feed_pump_on = TRUE)
Write Coil 5 = 0   (valve_201_open = FALSE)
```

**Consequences:**
- Pressure spike to 33 bar (normal: 12 bar)
- Immediate pipe stress
- Pipe burst risk at >20 bar
- Pipe health degrades at 0.5%/sec (30%/min)

**Observable Indicators:**
- Register 18 (pressure_feed) > 200 (20 bar)
- Register 11 (Q_feed) = 0
- Register 35 (pipe_feed_health) decreasing rapidly

**Time to Failure:** ~2 minutes to pipe burst

**Risk Assessment:**
- Consequence: 5 (Catastrophic - pipe burst, flooding)
- Likelihood: D (High)
- **Risk Level: CRITICAL**

**Mitigation:**
- Interlock: IF valve_201_open = FALSE THEN ro_feed_pump_on = FALSE
- Pressure relief valve (physical)
- Emergency shutdown: IF pressure_feed > 18 bar THEN ro_feed_pump_on = FALSE

---

### 3.2 P-201 Cavitation (Low Suction)

**What-If:** Pump running with empty feed tank  
**Modbus Commands:**
```
Write Coil 0 = 0   (wellfield_on = FALSE)
Wait for tank to drain...
Keep Coil 1 = 1    (ro_feed_pump_on = TRUE)
```

**Consequences:** Same as 2.2

**Risk Assessment:**
- Consequence: 4 (Major)
- Likelihood: C (Medium - requires timing)
- **Risk Level: MEDIUM**

---

## Node 4: RO Membrane System (XV-202, XV-203)

### 4.1 RO Overpressure Attack (Both Valves Closed)

**What-If:** Close permeate and reject valves while pump running  
**Modbus Commands:**
```
Write Coil 1 = 1   (ro_feed_pump_on = TRUE)
Write Coil 6 = 0   (valve_202_open = FALSE)
Write Coil 7 = 0   (valve_203_open = FALSE)
```

**Consequences:**
- Pressure spike to 30+ bar
- Membrane mechanical rupture
- Membrane health degrades at 1.0%/sec (60%/min)
- Pipe burst at feed side
- Complete membrane failure in ~2 minutes

**Observable Indicators:**
- Register 18 (pressure_feed) > 300 (30 bar)
- Register 20 (dP_ro_true) > 350 (3.5 bar)
- Register 30 (membrane_health) dropping rapidly
- Register 22 (TDS_perm) increasing (rejection failure)

**Time to Failure:** ~90 seconds

**Risk Assessment:**
- Consequence: 5 (Catastrophic - membrane destruction, $50k+ damage)
- Likelihood: D (High)
- **Risk Level: CRITICAL**

**Mitigation:**
- Interlock: IF (valve_202_open = FALSE AND valve_203_open = FALSE) THEN ro_feed_pump_on = FALSE
- Pressure limit: IF pressure_feed > 18 bar THEN ro_feed_pump_on = FALSE

---

### 4.2 Membrane Chemical Attack (Chlorine Poisoning)

**What-If:** Dose chlorine upstream of RO (if injection point modified)  
**Modbus Commands:**
```
Write Coil 10 = 1   (cl_pump_on = TRUE)
Write Register 1 = 50  (Cl_dose = 5.0 mg/L)
```

**Consequences:**
- Chlorine > 0.1 mg/L attacks polyamide membrane
- Membrane health degrades at 0.2%/sec (12%/min)
- Irreversible oxidation damage
- Rejection rate drops
- Product water contamination

**Observable Indicators:**
- Register 24 (Cl_true) > 10 (0.1 mg/L)
- Register 30 (membrane_health) decreasing
- Register 22 (TDS_perm) increasing

**Time to Failure:** ~8 minutes to significant damage

**Risk Assessment:**
- Consequence: 5 (Catastrophic - membrane replacement required)
- Likelihood: C (Medium - requires process knowledge)
- **Risk Level: HIGH**

**Mitigation:**
- Chlorine analyzer upstream of RO
- Interlock: IF Cl_true > 0.05 mg/L THEN ro_feed_pump_on = FALSE
- Dosing point verification (physical)

---

### 4.3 Permeate Valve Closed (XV-203)

**What-If:** Close permeate valve only  
**Modbus Commands:**
```
Write Coil 7 = 0   (valve_203_open = FALSE)
```

**Consequences:**
- No permeate flow
- Pressure builds in permeate side
- Clearwell stops filling
- Brine flow continues (if XV-202 open)

**Observable Indicators:**
- Register 12 (Q_perm) = 0
- Register 16 (level_clearwell) decreasing

**Risk Assessment:**
- Consequence: 3 (Moderate - process upset)
- Likelihood: D (High)
- **Risk Level: MEDIUM**

---

### 4.4 Reject Valve Closed (XV-202)

**What-If:** Close reject valve only  
**Modbus Commands:**
```
Write Coil 6 = 0   (valve_202_open = FALSE)
```

**Consequences:**
- Brine cannot discharge
- Pressure builds
- Reduced recovery
- Membrane fouling accelerates

**Observable Indicators:**
- Register 13 (Q_brine) = 0
- Register 20 (dP_ro_true) increasing

**Risk Assessment:**
- Consequence: 3 (Moderate)
- Likelihood: D (High)
- **Risk Level: MEDIUM**

---

## Node 5: Post-Treatment Dosing (P-301, P-302)

### 5.1 NaOH Overdose Attack

**What-If:** Excessive caustic dosing  
**Modbus Commands:**
```
Write Coil 9 = 1    (naoh_pump_on = TRUE)
Write Register 0 = 200  (NaOH_dose = 20.0 mg/L)
```

**Consequences:**
- pH rises above 8.5
- Corrosive water
- Pipe/equipment corrosion
- Regulatory violation
- Customer complaints

**Observable Indicators:**
- Register 23 (pH_true) > 850 (8.5 pH)

**Time to Impact:** ~5 minutes

**Risk Assessment:**
- Consequence: 3 (Moderate - water quality)
- Likelihood: D (High)
- **Risk Level: MEDIUM**

**Mitigation:**
- pH analyzer with alarm
- Interlock: IF pH_true > 8.3 THEN naoh_pump_on = FALSE
- Dose rate limit in PLC

---

### 5.2 Chlorine Overdose Attack

**What-If:** Excessive chlorine dosing  
**Modbus Commands:**
```
Write Coil 10 = 1   (cl_pump_on = TRUE)
Write Register 1 = 50  (Cl_dose = 5.0 mg/L)
```

**Consequences:**
- Chlorine residual > 2.0 mg/L
- Taste/odor complaints
- Regulatory violation
- Potential health concerns

**Observable Indicators:**
- Register 24 (Cl_true) > 200 (2.0 mg/L)

**Time to Impact:** ~3 minutes

**Risk Assessment:**
- Consequence: 3 (Moderate - water quality)
- Likelihood: D (High)
- **Risk Level: MEDIUM**

**Mitigation:**
- Chlorine analyzer with alarm
- Interlock: IF Cl_true > 1.5 mg/L THEN cl_pump_on = FALSE

---

### 5.3 Dosing Without Flow

**What-If:** Run dosing pumps with no process flow  
**Modbus Commands:**
```
Write Coil 1 = 0    (ro_feed_pump_on = FALSE)
Write Coil 9 = 1    (naoh_pump_on = TRUE)
Write Coil 10 = 1   (cl_pump_on = TRUE)
```

**Consequences:**
- Chemicals concentrate in stagnant pipe
- Super-chlorination (50+ mg/L)
- Pipe corrosion
- Hazardous slug when flow resumes

**Observable Indicators:**
- Register 11 (Q_feed) = 0
- Register 24 (Cl_true) > 5000 (50 mg/L)

**Time to Impact:** Immediate

**Risk Assessment:**
- Consequence: 4 (Major - equipment damage + safety)
- Likelihood: C (Medium)
- **Risk Level: MEDIUM**

**Mitigation:**
- Flow interlock: IF Q_perm < 10 m³/h THEN (naoh_pump_on = FALSE AND cl_pump_on = FALSE)

---

## Node 6: Clearwell (TK-300)

### 6.1 Clearwell Overflow

**What-If:** Fill faster than discharge  
**Modbus Commands:**
```
Write Coil 1 = 1    (ro_feed_pump_on = TRUE)
Write Coil 3 = 0    (dist_pump_on = FALSE)
```

**Consequences:**
- Tank level rises to 6.0m (max)
- Overflow (clamped in simulation)
- Product water loss
- Flooding

**Observable Indicators:**
- Register 16 (level_clearwell) > 580 (5.8m)

**Time to Overflow:** ~40 minutes

**Risk Assessment:**
- Consequence: 3 (Moderate - water loss)
- Likelihood: D (High)
- **Risk Level: MEDIUM**

**Mitigation:**
- High-level interlock: IF level_clearwell > 5.5m THEN ro_feed_pump_on = FALSE

---

### 6.2 Clearwell Depletion

**What-If:** Discharge faster than fill  
**Modbus Commands:**
```
Write Coil 1 = 0    (ro_feed_pump_on = FALSE)
Write Coil 3 = 1    (dist_pump_on = TRUE)
Write Register 2 = 150  (Q_out_sp = 150 m³/h)
```

**Consequences:**
- Tank level drops to 0.1m
- P-401 cavitation
- Pump damage at 0.5%/sec
- Loss of supply pressure

**Observable Indicators:**
- Register 16 (level_clearwell) < 10 (0.1m)
- Register 33 (pump_dist_health) decreasing

**Time to Failure:** ~3 minutes

**Risk Assessment:**
- Consequence: 4 (Major - pump failure + supply loss)
- Likelihood: D (High)
- **Risk Level: HIGH**

**Mitigation:**
- Low-level interlock: IF level_clearwell < 0.5m THEN dist_pump_on = FALSE

---

## Node 7: Distribution System (P-401, XV-401)

### 7.1 P-401 Deadhead (XV-401 Closed)

**What-If:** Pump running with discharge valve closed  
**Modbus Commands:**
```
Write Coil 3 = 1    (dist_pump_on = TRUE)
Write Coil 8 = 0    (valve_401_open = FALSE)
```

**Consequences:**
- Pressure spike to 15 bar (normal: 4 bar)
- Pump deadhead
- Pump health degrades at 0.3%/sec
- Pipe stress at >12 bar
- Pipe health degrades at 0.3%/sec

**Observable Indicators:**
- Register 19 (pressure_dist) > 120 (12 bar)
- Register 14 (Q_out) = 0
- Register 33 (pump_dist_health) decreasing
- Register 36 (pipe_dist_health) decreasing

**Time to Failure:** ~5 minutes

**Risk Assessment:**
- Consequence: 4 (Major - pump failure + supply loss)
- Likelihood: D (High)
- **Risk Level: HIGH**

**Mitigation:**
- Interlock: IF valve_401_open = FALSE THEN dist_pump_on = FALSE
- Pressure limit: IF pressure_dist > 10 bar THEN dist_pump_on = FALSE

---

### 7.2 Excessive Flow Demand

**What-If:** Set flow setpoint above pump capacity  
**Modbus Commands:**
```
Write Register 2 = 200  (Q_out_sp = 200 m³/h)
```
*Pump capacity = 120 m³/h*

**Consequences:**
- Pump runs at maximum capacity
- Clearwell drains faster
- Potential cavitation if tank empties

**Observable Indicators:**
- Register 14 (Q_out) capped at 120 m³/h
- Register 16 (level_clearwell) decreasing

**Risk Assessment:**
- Consequence: 2 (Minor - leads to 6.2)
- Likelihood: E (Very High)
- **Risk Level: LOW**

---

## Multi-Node Attack Scenarios

### S1: Cascading Failure Attack

**Objective:** Cause maximum equipment damage  
**Attack Sequence:**
```
1. Write Coil 10 = 1, Register 1 = 50  (Start chlorine attack)
2. Wait 2 minutes
3. Write Coil 6 = 0, Coil 7 = 0        (Close RO valves)
4. Wait 1 minute
5. Write Coil 4 = 0                     (Close wellfield valve)
```

**Consequences:**
- Membrane chemical + mechanical damage
- P-201 overpressure
- P-101 deadhead
- Multiple equipment failures
- Complete plant shutdown

**Time to Catastrophic Failure:** ~3 minutes  
**Estimated Damage:** $100k+ (membrane + pumps + pipes)

**Risk Level: CRITICAL**

---

### S2: Stealthy Degradation Attack

**Objective:** Slowly degrade equipment without triggering alarms  
**Attack Sequence:**
```
1. Write Register 1 = 15  (Cl_dose = 1.5 mg/L, just above limit)
2. Maintain for hours/days
```

**Consequences:**
- Slow membrane degradation (0.2%/sec when active)
- Gradual rejection loss
- Increased TDS in product water
- May go unnoticed until significant damage

**Time to Significant Damage:** Hours to days  
**Detection Difficulty:** High (slow drift)

**Risk Level: HIGH**

---

### S3: Water Quality Sabotage

**Objective:** Contaminate product water  
**Attack Sequence:**
```
1. Write Coil 6 = 0, Coil 7 = 0  (Damage membrane)
2. Wait for rejection to drop
3. Write Register 0 = 0           (Stop pH adjustment)
4. Write Register 1 = 50          (Overdose chlorine)
```

**Consequences:**
- High TDS in product (>100 µS/cm)
- Low pH (<6.5)
- High chlorine (>2.0 mg/L)
- Regulatory violations
- Public health risk

**Risk Level: CRITICAL**

---

## Summary Risk Matrix

| Node | Scenario | Consequence | Likelihood | Risk |
|------|----------|-------------|------------|------|
| P-101 | Deadhead | 4 | D | **HIGH** |
| TK-200 | Overflow | 4 | D | **HIGH** |
| TK-200 | Depletion | 4 | D | **HIGH** |
| P-201 | Deadhead | 5 | D | **CRITICAL** |
| RO | Overpressure | 5 | D | **CRITICAL** |
| RO | Chlorine Attack | 5 | C | **HIGH** |
| Dosing | NaOH Overdose | 3 | D | **MEDIUM** |
| Dosing | Cl₂ Overdose | 3 | D | **MEDIUM** |
| Dosing | No Flow | 4 | C | **MEDIUM** |
| TK-300 | Depletion | 4 | D | **HIGH** |
| P-401 | Deadhead | 4 | D | **HIGH** |
| Multi | Cascading | 5 | D | **CRITICAL** |
| Multi | Stealthy | 5 | C | **HIGH** |
| Multi | Water Quality | 5 | D | **CRITICAL** |

---

## Recommended PLC Interlocks (Priority Order)

### Critical (Implement First)
1. **Pump-Valve Interlocks**: No pump start if discharge valve closed
2. **Pressure Limits**: Emergency shutdown at overpressure
3. **RO Protection**: Shutdown if both valves closed
4. **Tank Level Limits**: High/low level pump shutdowns

### High Priority
5. **Cavitation Protection**: Low suction level interlocks
6. **Flow-Paced Dosing**: Dosing only when flow present
7. **Chlorine Limit**: Shutdown if Cl₂ > 0.05 mg/L upstream of RO

### Medium Priority
8. **pH Limits**: Alarm and dose cutoff
9. **Pressure Monitoring**: Trend analysis for anomaly detection
10. **Health Monitoring**: Alarm on equipment degradation

---

## Modbus Security Recommendations

1. **Network Segmentation**: Isolate Modbus on dedicated VLAN
2. **Firewall Rules**: Whitelist only authorized PLC IP
3. **Authentication**: Implement Modbus security extensions
4. **Monitoring**: Log all Modbus write commands
5. **Rate Limiting**: Detect rapid command sequences
6. **Anomaly Detection**: Alert on unusual register patterns
7. **Read-Only Registers**: Enforce write protection on PVs (registers 10+)

---

**Document Control:**  
Version: 1.0  
Classification: Confidential - Cybersecurity Training  
Next Review: Annual or after plant modifications
