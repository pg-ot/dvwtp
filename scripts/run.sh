#!/usr/bin/env bash
set -euo pipefail

if [[ ! -d .venv ]]; then
  echo "Virtual environment not found. Run scripts/install.sh first." >&2
  exit 1
fi

source .venv/bin/activate
python twin.py
