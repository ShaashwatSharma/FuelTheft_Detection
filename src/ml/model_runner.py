#!/usr/bin/env python3
"""
Convenience runner that predicts on a CSV using config paths.
"""

import argparse
from pathlib import Path
import subprocess
import sys
from . import config

def main():
    ap = argparse.ArgumentParser(description="Run batch predictions with config defaults.")
    ap.add_argument("--input", type=str, default=str(config.DEFAULT_INPUT_CSV), help="Input CSV")
    ap.add_argument("--output", type=str, default=str(config.DEFAULT_OUTPUT_CSV), help="Output CSV with predictions")
    ap.add_argument("--model", type=str, default=str(config.MODEL_PATH), help="Path to model .cbm")
    ap.add_argument("--label-encoder", type=str, default=str(config.LABEL_ENCODER_PATH), help="Path to label encoder .joblib")
    args = ap.parse_args()

    cmd = [
        sys.executable,  # current Python
        str(Path(__file__).with_name("predict.py")),
        "--input", args.input,
        "--output", args.output,
        "--model", args.model,
        "--label-encoder", args.label_encoder,
    ]
    print("Running command:", " ".join(cmd))
    res = subprocess.run(cmd, capture_output=True, text=True)
    print("--- Logs from predict.py ---")
    print(res.stdout)
    if res.returncode != 0:
        print(res.stderr, file=sys.stderr)
        sys.exit(res.returncode)

if __name__ == "__main__":
    main()
