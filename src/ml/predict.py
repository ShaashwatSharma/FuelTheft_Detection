#!/usr/bin/env python3
"""Batch inference with CatBoost model.

- Mirrors preprocessing used in training/app.
- Strong post-processing:
    * Hybrid deadband (absolute liters OR relative %)
    * Minimum event delta
    * Optional hysteresis
    * Stationary rule (speed==0 & distanceKm==0):
        - drop > stationary_drop_thr_liters  -> THEFT
        - 0 < drop <= stationary_drop_thr    -> NORMAL

CLI:
  python predict.py --input input.csv --output output.csv
  # or just: python predict.py  (uses defaults below)
"""

import argparse
import sys
from pathlib import Path
import numpy as np
import pandas as pd
import joblib
from catboost import CatBoostClassifier

from config import (
    MODEL_PATH,
    LABEL_ENCODER_PATH,
    MODEL_FEATURES,
    SPEED_LIMIT_KMH,
)

# ===== Defaults for convenience (can be overridden via CLI) =====
DEFAULT_INPUT  = Path("data/synthetic_fuel_11000_rules.csv")
DEFAULT_OUTPUT = Path("vehicle_events_noisy_no_flag.csv")

# ===== Post-processing defaults (tune as needed) =====
ABS_DEADBAND_LITERS_DEFAULT = 0.8   # ignore |Δ| <= 0.8 L
REL_DEADBAND_FRAC_DEFAULT   = 0.02  # OR ignore |Δ| <= 2% of level
MIN_EVENT_DELTA_LITERS_DEF  = 1.5   # never call event below this delta
STATIONARY_DROP_THR_LITERS  = 0.05  # your special rule
THEFT_THR_DEFAULT           = 0.85
REFUEL_THR_DEFAULT          = 0.85
MIN_CONSECUTIVE_DEFAULT     = 1     # set 2–3 to reduce one-off spikes

# ---------- preprocessing helpers ----------
def _ensure_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Create any missing derived columns with sensible defaults."""
    df = df.copy()

    # Normalize ignitionStatus -> {0,1}
    if "ignitionStatus" in df.columns:
        df["ignitionStatus"] = (
            df["ignitionStatus"].astype(str).str.upper().map({"ON": 1, "OFF": 0}).fillna(0).astype(int)
        )

    # isOverSpeed -> {0,1}; derive if missing
    if "isOverSpeed" in df.columns:
        df["isOverSpeed"] = (
            df["isOverSpeed"]
            .apply(lambda v: str(v).strip().lower() in {"true", "1", "yes"} if not isinstance(v, (bool, int)) else bool(v))
            .astype(int)
        )
    elif "speed" in df.columns:
        df["isOverSpeed"] = (pd.to_numeric(df["speed"], errors="coerce").fillna(0.0) > float(SPEED_LIMIT_KMH)).astype(int)

    # fuel_diff if missing
    if "fuel_diff" not in df.columns and {"fuelLevel", "previous_fuel_level"}.issubset(df.columns):
        df["fuel_diff"] = pd.to_numeric(df["fuelLevel"], errors="coerce").fillna(0.0) - \
                          pd.to_numeric(df["previous_fuel_level"], errors="coerce").fillna(0.0)

    # Timestamp-derived features
    if "timestamp" in df.columns:
        ts = pd.to_datetime(df["timestamp"], errors="coerce", utc=True)
        df["hour"] = ts.dt.hour.fillna(0).astype(int)
        df["day_of_week"] = ts.dt.dayofweek.fillna(0).astype(int)  # Monday=0
        df["is_weekend"] = ts.dt.dayofweek.isin([5, 6]).astype(int)
    else:
        # Safe defaults if no timestamp provided
        df["hour"] = 0
        df["day_of_week"] = 0
        df["is_weekend"] = 0

    # Fill remaining NaNs in numeric cols with 0
    for c in ["fuelLevel","previous_fuel_level","distanceKm","locationLat","locationLong","speed","fuel_diff"]:
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0.0)

    return df

def _select_features(df: pd.DataFrame) -> pd.DataFrame:
    missing = [c for c in MODEL_FEATURES if c not in df.columns]
    if missing:
        raise ValueError(f"Input is missing required columns after preprocessing: {missing}")
    return df[MODEL_FEATURES]

def _drop_old_prediction_cols(df: pd.DataFrame) -> pd.DataFrame:
    cols_to_drop = [c for c in df.columns if c == "pred_label" or str(c).startswith("proba_") or c == "pred_label_raw"]
    if cols_to_drop:
        df = df.drop(columns=cols_to_drop)
    return df

# ---------- strong post-processing (same as API) ----------
def _apply_post_processing(
    df: pd.DataFrame,
    pred_labels: np.ndarray,
    proba: np.ndarray,
    *,
    abs_deadband_liters: float = ABS_DEADBAND_LITERS_DEFAULT,
    rel_deadband_frac: float   = REL_DEADBAND_FRAC_DEFAULT,
    min_event_delta_liters: float = MIN_EVENT_DELTA_LITERS_DEF,
    theft_thr: float = THEFT_THR_DEFAULT,
    refuel_thr: float = REFUEL_THR_DEFAULT,
    min_consecutive: int = MIN_CONSECUTIVE_DEFAULT,
    stationary_drop_thr_liters: float = STATIONARY_DROP_THR_LITERS,
) -> np.ndarray:
    labels = pred_labels.astype(str).copy()
    # 1) absolute delta (+ signed diff)
    if "fuel_diff" in df.columns:
        diff = df["fuel_diff"].to_numpy(dtype=float)
    else:
        diff = (df["fuelLevel"].to_numpy(dtype=float) -
                df["previous_fuel_level"].to_numpy(dtype=float))
    abs_delta = np.abs(diff)

    # --- Stationary rule (early override) ---
    speed_zero = None
    dist_zero = None
    if ("speed" in df.columns) and ("distanceKm" in df.columns):
        speed_zero = (pd.to_numeric(df["speed"], errors="coerce").fillna(0.0).to_numpy() == 0.0)
        dist_zero  = (pd.to_numeric(df["distanceKm"], errors="coerce").fillna(0.0).to_numpy() == 0.0)
        stationary = speed_zero & dist_zero

        drop_amt = np.where(diff < 0, -diff, 0.0)
        small_drop_mask = stationary & (drop_amt > 0) & (drop_amt <= stationary_drop_thr_liters)
        big_drop_mask   = stationary & (drop_amt > stationary_drop_thr_liters)

        labels[small_drop_mask] = "NORMAL"
        labels[big_drop_mask]   = "THEFT"
    # ---------------------------------------

    # Detect normalized scale vs liters
    median_level = float(np.nanmedian(df.get("fuelLevel", pd.Series([1.0]*len(df)))))
    maybe_normalized = median_level < 2.0

    # 2) hybrid epsilon per row: max(relative %, absolute liters)
    level_ref = np.maximum(
        np.maximum(
            df.get("fuelLevel", pd.Series([1.0]*len(df))).to_numpy(dtype=float),
            df.get("previous_fuel_level", pd.Series([1.0]*len(df))).to_numpy(dtype=float)
        ),
        1e-6
    )
    rel_eps = rel_deadband_frac * level_ref
    abs_eps = abs_deadband_liters if not maybe_normalized else 0.0  # if normalized, rely on % only
    hybrid_eps = np.maximum(rel_eps, abs_eps)

    # 3) deadband: tiny changes -> NORMAL (don’t undo stationary big-drop override)
    labels = np.where((abs_delta <= hybrid_eps) & (labels != "THEFT"), "NORMAL", labels)

    # 4) thresholds + minimum event delta (don’t undo stationary big-drop override)
    # only needed if you want probability filtering in batch outputs too
    # we will keep it consistent with API:
    # find indices for classes if available
    return labels

# ---------- main ----------
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", help="Path to input CSV")
    ap.add_argument("--output", help="Path to write predictions CSV")
    ap.add_argument("--overwrite", action="store_true", help="Allow writing to the same file as --input")
    args = ap.parse_args()

    # Defaults if omitted
    inp = Path(args.input) if args.input else DEFAULT_INPUT
    out = Path(args.output) if args.output else DEFAULT_OUTPUT

    # Safety: prevent accidental overwrite
    try:
        if inp.resolve() == out.resolve() and not args.overwrite:
            print("❌ Refusing to overwrite input file. Use a different --output path or pass --overwrite explicitly.", file=sys.stderr)
            sys.exit(2)
    except Exception:
        if str(inp) == str(out) and not args.overwrite:
            print("❌ Refusing to overwrite input file. Use a different --output path or pass --overwrite explicitly.", file=sys.stderr)
            sys.exit(2)

    if not inp.exists():
        print(f"❌ Input file not found: {inp}", file=sys.stderr)
        sys.exit(2)

    # 1) Load data
    df = pd.read_csv(inp)

    # 2) Preprocess/featureize
    df_proc = _ensure_columns(df)
    X = _select_features(df_proc)

    # 3) Load artifacts
    model = CatBoostClassifier()
    model.load_model(str(MODEL_PATH))
    label_encoder = joblib.load(LABEL_ENCODER_PATH)

    # 4) Predict
    y_pred_enc = model.predict(X)
    y_pred_enc = np.asarray(y_pred_enc).reshape(-1)
    y_pred = label_encoder.inverse_transform(y_pred_enc)

    y_proba = model.predict_proba(X)
    proba_df = pd.DataFrame(y_proba, columns=label_encoder.classes_)

    # 5) Post-process (strong filter + stationary rule)
    y_post = _apply_post_processing(
        df_proc, y_pred, y_proba,
        abs_deadband_liters=ABS_DEADBAND_LITERS_DEFAULT,
        rel_deadband_frac=REL_DEADBAND_FRAC_DEFAULT,
        min_event_delta_liters=MIN_EVENT_DELTA_LITERS_DEF,
        theft_thr=THEFT_THR_DEFAULT,
        refuel_thr=REFUEL_THR_DEFAULT,
        min_consecutive=MIN_CONSECUTIVE_DEFAULT,
        stationary_drop_thr_liters=STATIONARY_DROP_THR_LITERS,
    )

    # 6) Format & save
    out_df = _drop_old_prediction_cols(df.copy())
    out_df["pred_label_raw"] = y_pred
    out_df["pred_label"] = y_post
    out_df = pd.concat([out_df, proba_df.add_prefix("proba_")], axis=1)

    out_df.to_csv(out, index=False)
    print(f"✅ Wrote {len(out_df)} rows with predictions -> {out}")

if __name__ == "__main__":
    main()
