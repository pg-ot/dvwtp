# dvwtp

Damn Vulnerable Water Treatment Plant (DVWTP) is a Modbus-driven digital twin of
an Oldsmar-style treatment plant with a lightweight web dashboard for visual
monitoring. It exposes coil and holding register controls, renders live process
state via Server-Sent Events (SSE), and aims to be easy to run locally.

## Prerequisites
- Python 3.10+
- `pip` and `venv` modules available
- TCP ports 5020 (Modbus) and 8000 (web dashboard) open on your host

## Installation
Install dependencies into a local virtual environment:

```bash
./scripts/install.sh
```

This creates `.venv` in the repository root and installs packages from
`requirements.txt`.

## Running
Launch the simulator, Modbus server, and web dashboard:

```bash
./scripts/run.sh
```

- Modbus TCP: `0.0.0.0:5020` (coils and holding registers)
- Web dashboard & API: `http://localhost:8000`
  - Live visuals via SSE and a control panel to toggle pumps / adjust NaOH, Cl,
    and demand setpoints (writes back to Modbus coils & registers)

If you prefer manual steps:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python twin.py
```

## Repository structure
- `twin.py` – Digital twin model, Modbus glue, SSE API, and dashboard handler
- `requirements.txt` – Python dependencies
- `scripts/install.sh` – Helper to create a virtual environment and install deps
- `scripts/run.sh` – Helper to start the simulator using the created environment

## Notes
- The simulator warms up to a quasi-steady-state before serving data.
- The dashboard falls back to 1s polling if SSE streaming is unavailable.
