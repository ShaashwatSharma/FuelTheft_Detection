#!/usr/bin/env python3
"""
Convenience wrapper to run predict.py with sensible defaults and clear logs.

- Prefers data/ paths inside the project.
- Falls back to root if needed.
- Prints predict.py stdout/stderr and propagates its exit code.
"""

import sys
import subprocess
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parent
DATA_DIR = PROJECT_DIR / "data"
PREDICT = PROJECT_DIR / "predict.py"

DEFAULT_INPUTS = [
    DATA_DIR / "vehicle_events_noisy_no_flag.csv",
    DATA_DIR / "synthetic_fuel_11000_rules.csv",
    PROJECT_DIR / "vehicle_events_noisy_no_flag.csv",
    PROJECT_DIR / "synthetic_fuel_11000_rules.csv",
]
DEFAULT_OUTPUT = DATA_DIR / "vehicle_events_with_preds.csv"

def main():
    input_path = next((p for p in DEFAULT_INPUTS if p.exists()), None)
    if input_path is None:
        print("❌ No default input CSV found. Looked for:")
        for p in DEFAULT_INPUTS:
            print("  -", p)
        print("\nFix one of these:")
        print("  • Put your CSV into data/vehicle_events_noisy_no_flag.csv, or")
        print("  • Edit model_runner.py DEFAULT_INPUTS to your file.")
        sys.exit(2)

    if not PREDICT.exists():
        print(f"❌ predict.py not found at {PREDICT}")
        sys.exit(2)

    DEFAULT_OUTPUT.parent.mkdir(parents=True, exist_ok=True)

    cmd = [
        sys.executable,
        str(PREDICT),
        "--input", str(input_path),
        "--output", str(DEFAULT_OUTPUT),
    ]

    print("Running command:", " ".join(cmd), flush=True)
    proc = subprocess.run(cmd, capture_output=True, text=True)

    print("\n--- Logs from predict.py ---")
    if proc.stdout:
        print(proc.stdout.rstrip())
    if proc.stderr:
        print(proc.stderr.rstrip())

    if proc.returncode != 0:
        print(f"\npredict.py exited with a non-zero status code: {proc.returncode}")
        sys.exit(proc.returncode)

    print("\n✅ Done.")

if __name__ == "__main__":
    main()








#-------------------------------------------------------------------------------------------------








# #!/usr/bin/env python3
# import sys
# import subprocess
# from pathlib import Path

# # Project folders
# PROJECT_DIR = Path(__file__).resolve().parent
# DATA_DIR = PROJECT_DIR / "data"
# PREDICT = PROJECT_DIR / "predict.py"

# # Defaults (adjust if you like)
# DEFAULT_INPUT  = DATA_DIR / "synthetic_fuel_11000_rules.csv"
# DEFAULT_OUTPUT = DATA_DIR / "vehicle_events_noisy_no_flag.csv"

# def main():
#     # Prefer data/… files; fall back to project root if needed
#     input_candidates = [
#         DEFAULT_INPUT,
#         PROJECT_DIR / "synthetic_fuel_11000_rules.csv",
#     ]
#     output_path = DEFAULT_OUTPUT

#     # Pick the first existing input
#     input_path = next((p for p in input_candidates if p.exists()), None)

#     if input_path is None:
#         print("❌ Could not find an input CSV. Looked for:")
#         for p in input_candidates:
#             print(f"   - {p}")
#         print("\nFix one of these:")
#         print("  • Move your CSV to data/synthetic_fuel_11000_rules.csv")
#         print("  • Or edit model_runner.py to point at the correct file")
#         sys.exit(2)

#     if not PREDICT.exists():
#         print(f"❌ predict.py not found at {PREDICT}")
#         sys.exit(2)

#     cmd = [
#         sys.executable,
#         str(PREDICT),
#         "--input", str(input_path),
#         "--output", str(output_path),
#     ]

#     print("Running command:", " ".join(cmd), flush=True)
#     proc = subprocess.run(cmd, capture_output=True, text=True)

#     print("\n--- Logs from predict.py ---")
#     if proc.stdout:
#         print(proc.stdout.rstrip())
#     if proc.stderr:
#         print(proc.stderr.rstrip())

#     if proc.returncode != 0:
#         print(f"\npredict.py exited with a non-zero status code: {proc.returncode}")
#         sys.exit(proc.returncode)

#     print("\n✅ Done.")

# if __name__ == "__main__":
#     main()
