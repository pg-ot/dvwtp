<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/drive/1OTbBb5yfhSaybpQvDrAPRLt6pmasc4IH

## Run Locally

**Prerequisites:**  Node.js, Python 3.8+

### Option 1: Frontend Only (JavaScript Simulation)
1. Install dependencies:
   `npm install`
2. Run the app:
   `npm run dev`
3. Open http://localhost:3000

### Option 2: Full Digital Twin (Python Backend + Frontend)
1. Install Python dependencies:
   `pip install -r requirements.txt`
2. Start the digital twin:
   `python twin.py`
3. In a new terminal, install frontend dependencies:
   `npm install`
4. Run the frontend:
   `npm run dev`
5. Open http://localhost:3000

**Note:** 
- The frontend automatically connects to Python digital twin (port 5000) if available
- Falls back to JavaScript simulation if backend is offline
- Modbus server runs on port 502 (may require admin/sudo privileges)

## Documentation

- [Modbus Map](docs/MODBUS_MAP.md) - Register mapping for OpenPLC

## Project Structure

```
dvwtp/
├── docs/                 # Documentation
│   ├── CYBER_PHA.md     # Process Hazard Analysis
│   ├── MODBUS_MAP.md    # Modbus register mapping
│   └── SCENARIO_COVERAGE_ANALYSIS.md
├── src/                  # Frontend source
│   ├── components/      # React components
│   ├── services/        # API and simulation
│   ├── App.tsx
│   ├── index.tsx
│   └── types.ts
├── public/              # Static assets
├── twin.py              # Python digital twin
├── requirements.txt     # Python dependencies
└── package.json         # Node dependencies
```

## Architecture

- **twin.py** - Python digital twin with full physics simulation and damage modeling
- **Frontend** - React/TypeScript SCADA interface
- **Modbus TCP Server** - Port 502 for OpenPLC integration
- **REST API** - Port 5000 for SCADA integration

## OpenPLC Integration

The digital twin runs a **Modbus TCP server** on port 502:

1. Configure OpenPLC Modbus Master:
   - IP: `127.0.0.1` (or twin IP)
   - Port: `502`
   - Slave ID: `1`

2. Map PLC variables to Modbus registers (see [MODBUS_MAP.md](MODBUS_MAP.md)):
   - Coils 0-10: Pump/Valve controls
   - Registers 0-2: Setpoints
   - Registers 10-36: Process variables & health

3. PLC can now control the digital twin in real-time

**Note:** On Linux, you may need to run with sudo for port 502 access, or use port 5502 and configure port forwarding.
