# # --- START OF FILE app.py ---

# from flask import Flask, request, jsonify
# import pandas as pd
# import numpy as np
# from catboost import CatBoostClassifier
# import joblib
# from pathlib import Path
# import logging

# # Import paths and settings from the central config file
# from config import MODEL_PATH, LABEL_ENCODER_PATH, MODEL_FEATURES

# # --- App Initialization ---
# app = Flask(__name__)
# logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
# logger = logging.getLogger("predict-api")

# # --- Load Model and Encoder at Startup ---
# try:
#     logger.info(f"Loading model from: {MODEL_PATH}")
#     model = CatBoostClassifier()
#     model.load_model(str(MODEL_PATH))

#     logger.info(f"Loading label encoder from: {LABEL_ENCODER_PATH}")
#     label_encoder = joblib.load(LABEL_ENCODER_PATH)
#     logger.info("Model and encoder loaded successfully.")
# except FileNotFoundError as e:
#     logger.error(f"Error loading model artifacts: {e}")
#     # Exit if essential files are missing
#     raise RuntimeError(f"Could not load model/encoder: {e}") from e


# def preprocess(df: pd.DataFrame) -> pd.DataFrame:
#     """
#     Applies the same preprocessing and feature engineering as in the training script.
#     """
#     X = df.copy()

#     # 1. Fill missing values
#     X.fillna({
#         'previous_fuel_level': 0,
#         'fuel_diff': 0,
#     }, inplace=True)

#     # 2. Feature engineering from timestamp
#     if 'timestamp' in X.columns:
#         ts = pd.to_datetime(X['timestamp'], errors='coerce')
#         X['hour'] = ts.dt.hour
#         X['day_of_week'] = ts.dt.dayofweek
#         X['is_weekend'] = X['day_of_week'].isin([5, 6]).astype(int)
#     else:
#         # Handle case where timestamp is not provided
#         raise ValueError("'timestamp' column is required for feature engineering.")
        
#     # 3. Ensure all model features are present and in the correct order
#     # This is critical for the model to work correctly.
#     for col in MODEL_FEATURES:
#         if col not in X.columns:
#             raise ValueError(f"Missing required feature column: '{col}'")
            
#     return X[MODEL_FEATURES]

# # --- API Endpoints ---

# @app.route("/health", methods=["GET"])
# def health():
#     """Health check endpoint to confirm the service is running."""
#     return jsonify({"status": "ok", "model": str(Path(MODEL_PATH).name)})

# @app.route("/predict", methods=["POST"])
# def predict():
#     """Main prediction endpoint. Accepts JSON or a CSV file."""
#     try:
#         # Accept JSON with {'records': [...]} or a CSV file field 'file'
#         if request.is_json:
#             payload = request.get_json(silent=True) or {}
#             records = payload.get("records")
#             if not records or not isinstance(records, list):
#                 return jsonify({"error": "JSON payload must be in the format {'records': [...]}"}), 400
#             df_in = pd.DataFrame.from_records(records)
#         else:
#             if "file" not in request.files:
#                 return jsonify({"error": "No JSON payload or CSV file uploaded."}), 400
#             file = request.files["file"]
#             df_in = pd.read_csv(file)

#         if df_in.empty:
#             return jsonify({"error": "Input data is empty."}), 400

#         # Preprocess the data to create features
#         X = preprocess(df_in)
        
#         # Make predictions
#         pred_encoded = np.array(model.predict(X)).reshape(-1)
#         pred_labels = label_encoder.inverse_transform(pred_encoded)
        
#         # Get probabilities
#         proba = model.predict_proba(X)
#         classes = list(label_encoder.classes_)
#         proba_df = pd.DataFrame(proba, columns=classes)

#         # Build the response
#         out_df = df_in.copy()
#         out_df['predicted_eventType'] = pred_labels
#         for c in classes:
#             out_df[f"proba_{c}"] = proba_df[c].values

#         counts = pd.Series(pred_labels).value_counts().to_dict()

#         return jsonify({
#             "prediction_counts": counts,
#             "predictions": out_df.to_dict(orient="records"),
#         })

#     except ValueError as e:
#         logger.error(f"Validation error: {e}")
#         return jsonify({"error": f"Bad Request: {e}"}), 400
#     except Exception as e:
#         logger.exception("An unexpected error occurred during prediction.")
#         return jsonify({"error": f"An internal error occurred: {e}"}), 500

# if __name__ == "__main__":
#     # Runs the Flask app on port 5001
#     app.run(host="0.0.0.0", port=5001, debug=False)

















#!/usr/bin/env python3
"""Flask API for fuel event prediction (CatBoost).

- Mirrors preprocessing from predict.py (feature parity).
- Loads model + label encoder from config.py.
- Accepts JSON (list of records) or CSV upload (field name: 'file').
- Strong post-processing:
    * Hybrid deadband (absolute liters OR relative percentage of level)
    * Minimum event delta
    * Class probability thresholds
    * Optional per-vehicle hysteresis (require N consecutive events)
    * Stationary rule: when speed==0 and distanceKm==0
        - drop > stationary_drop_thr_liters  -> THEFT
        - 0 < drop <= stationary_drop_thr    -> NORMAL
"""

from __future__ import annotations
import io
from typing import Any, Dict, List

import numpy as np
import pandas as pd
from flask import Flask, request, jsonify
from catboost import CatBoostClassifier
import joblib

from .config import (
    MODEL_PATH,
    LABEL_ENCODER_PATH,
    MODEL_FEATURES,
    SPEED_LIMIT_KMH,
)

# ----------------- Defaults (tune as needed) -----------------
# Deadband & event gating
ABS_DEADBAND_LITERS_DEFAULT = 0.8   # ignore |Δ| <= 0.8 L
REL_DEADBAND_FRAC_DEFAULT   = 0.02  # OR ignore |Δ| <= 2% of level (normalized streams)
MIN_EVENT_DELTA_LITERS_DEF  = 1.5   # never call event below this delta

# Stationary rule threshold (your requirement)
STATIONARY_DROP_THR_LITERS_DEFAULT = 0.05

# Class probability thresholds
THEFT_THR_DEFAULT  = 0.85
REFUEL_THR_DEFAULT = 0.85

# Hysteresis (require consecutive event rows to confirm)
MIN_CONSECUTIVE_DEFAULT = 1  # set to 2–3 to reduce one-off spikes

# If available in your payloads, group hysteresis by this column:
VEHICLE_ID_COL = "vehicleId"  # change to your id column (e.g., 'registrationNo'); set None to disable grouping
# -------------------------------------------------------------

app = Flask(__name__)

# ---------- Load artifacts ----------
_model = CatBoostClassifier()
_model.load_model(str(MODEL_PATH))

_label_encoder = joblib.load(LABEL_ENCODER_PATH)
_classes = list(_label_encoder.classes_)

# ---------- Preprocessing (match predict.py) ----------
def _ensure_columns(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()

    if "ignitionStatus" in df.columns:
        df["ignitionStatus"] = (
            df["ignitionStatus"].astype(str).str.upper().map({"ON": 1, "OFF": 0}).fillna(0).astype(int)
        )

    if "isOverSpeed" in df.columns:
        df["isOverSpeed"] = (
            df["isOverSpeed"]
            .apply(lambda v: str(v).strip().lower() in {"true", "1", "yes"} if not isinstance(v, (bool, int)) else bool(v))
            .astype(int)
        )
    elif "speed" in df.columns:
        df["isOverSpeed"] = (pd.to_numeric(df["speed"], errors="coerce").fillna(0.0) > float(SPEED_LIMIT_KMH)).astype(int)

    if "fuel_diff" not in df.columns and {"fuelLevel", "previous_fuel_level"}.issubset(df.columns):
        df["fuel_diff"] = pd.to_numeric(df["fuelLevel"], errors="coerce").fillna(0.0) - \
                          pd.to_numeric(df["previous_fuel_level"], errors="coerce").fillna(0.0)

    if "timestamp" in df.columns:
        ts = pd.to_datetime(df["timestamp"], errors="coerce", utc=True)
        df["hour"] = ts.dt.hour.fillna(0).astype(int)
        df["day_of_week"] = ts.dt.dayofweek.fillna(0).astype(int)
        df["is_weekend"] = ts.dt.dayofweek.isin([5, 6]).astype(int)
    else:
        df["hour"] = 0
        df["day_of_week"] = 0
        df["is_weekend"] = 0

    for c in ["fuelLevel", "previous_fuel_level", "distanceKm", "locationLat", "locationLong", "speed", "fuel_diff"]:
        if c in df.columns:
            df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0.0)

    return df

def _select_features(df: pd.DataFrame) -> pd.DataFrame:
    missing = [c for c in MODEL_FEATURES if c not in df.columns]
    if missing:
        raise ValueError(f"Input is missing required columns after preprocessing: {missing}")
    return df[MODEL_FEATURES]

# ---------- Strong post-processing (includes stationary rule) ----------
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
    stationary_drop_thr_liters: float = STATIONARY_DROP_THR_LITERS_DEFAULT,
) -> np.ndarray:
    """
    Hybrid deadband (absolute OR relative), minimum delta for events, thresholds,
    optional hysteresis, and the stationary rule.

    Stationary rule (EARLY OVERRIDE):
      if speed==0 and distanceKm==0:
        drop > stationary_drop_thr_liters  -> THEFT
        0 < drop <= stationary_drop_thr    -> NORMAL
    """
    labels = pred_labels.astype(str).copy()
    class_to_idx = {c: i for i, c in enumerate(_classes)}

    # 1) absolute delta (+ signed diff for detecting drop)
    if "fuel_diff" in df.columns:
        diff = df["fuel_diff"].to_numpy(dtype=float)
    else:
        diff = (df["fuelLevel"].to_numpy(dtype=float) -
                df["previous_fuel_level"].to_numpy(dtype=float))
    abs_delta = np.abs(diff)

    # --- Stationary rule (EARLY OVERRIDE) ---
    speed_zero = None
    dist_zero = None
    if ("speed" in df.columns) and ("distanceKm" in df.columns):
        speed_zero = (pd.to_numeric(df["speed"], errors="coerce").fillna(0.0).to_numpy() == 0.0)
        dist_zero  = (pd.to_numeric(df["distanceKm"], errors="coerce").fillna(0.0).to_numpy() == 0.0)
        stationary = speed_zero & dist_zero

        drop_amt = np.where(diff < 0, -diff, 0.0)  # positive liters only when drop
        small_drop_mask = stationary & (drop_amt > 0) & (drop_amt <= stationary_drop_thr_liters)
        big_drop_mask   = stationary & (drop_amt > stationary_drop_thr_liters)

        labels[small_drop_mask] = "NORMAL"
        labels[big_drop_mask]   = "THEFT"
    # ---------------------------------------

    # Detect normalized scale vs liters (for hybrid deadband)
    median_level = float(np.nanmedian(df.get("fuelLevel", pd.Series([1.0]*len(df)))))
    maybe_normalized = median_level < 2.0  # heuristic; adjust if needed

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
    idx_theft  = class_to_idx.get("THEFT")
    idx_refuel = class_to_idx.get("REFUEL")
    for i in range(len(labels)):
        # if already forced THEFT by stationary big-drop, keep it
        if speed_zero is not None and dist_zero is not None:
            if speed_zero[i] and dist_zero[i] and diff[i] < 0 and (-diff[i]) > stationary_drop_thr_liters:
                continue

        if abs_delta[i] < max(min_event_delta_liters, hybrid_eps[i]):
            if labels[i] in ("THEFT", "REFUEL"):
                labels[i] = "NORMAL"
            continue

        if labels[i] == "THEFT" and idx_theft is not None and proba[i, idx_theft] < theft_thr:
            labels[i] = "NORMAL"
        if labels[i] == "REFUEL" and idx_refuel is not None and proba[i, idx_refuel] < refuel_thr:
            labels[i] = "NORMAL"

    # 5) hysteresis: require N consecutive event flags (ordered by timestamp if present)
    if min_consecutive > 1:
        order_idx = np.arange(len(df))
        if "timestamp" in df.columns:
            order_idx = np.argsort(pd.to_datetime(df["timestamp"], errors="coerce").to_numpy())

        def apply_hys(idxs: np.ndarray):
            count = 0
            for j in idxs:
                if labels[j] in ("THEFT", "REFUEL"):
                    count += 1
                    if count < min_consecutive:
                        labels[j] = "NORMAL"
                else:
                    count = 0

        if VEHICLE_ID_COL and VEHICLE_ID_COL in df.columns:
            sorted_df = df.iloc[order_idx]
            for _, grp in sorted_df.groupby(sorted_df[VEHICLE_ID_COL]):
                apply_hys(grp.index.to_numpy())
        else:
            apply_hys(order_idx)

    return labels

# ----------------- Routes -----------------
@app.get("/health")
def health():
    return jsonify({
        "status": "ok",
        "model_path": str(MODEL_PATH),
        "label_encoder_path": str(LABEL_ENCODER_PATH),
        "classes": _classes,
    })

@app.post("/predict")
def predict():
    """Accepts either JSON (list of records) or CSV upload (multipart/form-data, field 'file').
       Query params (optional):
         abs_deadband_liters, rel_deadband_frac, min_event_delta_liters,
         theft_thr, refuel_thr, min_consecutive, stationary_drop_thr_liters
    """
    # Read tuning params from query (fallback to defaults)
    abs_deadband_liters = float(request.args.get("abs_deadband_liters", ABS_DEADBAND_LITERS_DEFAULT))
    rel_deadband_frac   = float(request.args.get("rel_deadband_frac",   REL_DEADBAND_FRAC_DEFAULT))
    min_event_delta_lit = float(request.args.get("min_event_delta_liters", MIN_EVENT_DELTA_LITERS_DEF))
    theft_thr           = float(request.args.get("theft_thr",  THEFT_THR_DEFAULT))
    refuel_thr          = float(request.args.get("refuel_thr", REFUEL_THR_DEFAULT))
    min_consecutive     = int(request.args.get("min_consecutive", MIN_CONSECUTIVE_DEFAULT))
    stationary_thr_lit  = float(request.args.get("stationary_drop_thr_liters", STATIONARY_DROP_THR_LITERS_DEFAULT))

    # Parse input
    if request.files.get("file"):
        f = request.files["file"]
        content = f.read()
        df = pd.read_csv(io.BytesIO(content))
    else:
        data = request.get_json(silent=True)
        if not data:
            return jsonify({"error": "No JSON body or file uploaded"}), 400
        if isinstance(data, dict):
            data = [data]
        df = pd.DataFrame(data)

    # Preprocess
    try:
        df_proc = _ensure_columns(df)
        X = _select_features(df_proc)
    except Exception as e:
        return jsonify({"error": f"Preprocessing failed: {e}"}), 400

    # Predict
    try:
        y_pred_enc = _model.predict(X)
        y_pred_enc = np.asarray(y_pred_enc).reshape(-1)
        y_pred = _label_encoder.inverse_transform(y_pred_enc)

        y_proba = _model.predict_proba(X)
        proba_df = pd.DataFrame(y_proba, columns=_classes)

        # Post-process (strong filter + stationary rule)
        y_post = _apply_post_processing(
            df_proc, y_pred, y_proba,
            abs_deadband_liters=abs_deadband_liters,
            rel_deadband_frac=rel_deadband_frac,
            min_event_delta_liters=min_event_delta_lit,
            theft_thr=theft_thr,
            refuel_thr=refuel_thr,
            min_consecutive=min_consecutive,
            stationary_drop_thr_liters=stationary_thr_lit,
        )

        # Build response
        out = df.copy()
        out["pred_label_raw"] = y_pred
        out["pred_label"] = y_post
        out = pd.concat([out, proba_df.add_prefix("proba_")], axis=1)

        return jsonify({
            "count": int(len(out)),
            "params": {
                "abs_deadband_liters": abs_deadband_liters,
                "rel_deadband_frac": rel_deadband_frac,
                "min_event_delta_liters": min_event_delta_lit,
                "theft_thr": theft_thr,
                "refuel_thr": refuel_thr,
                "min_consecutive": min_consecutive,
                "stationary_drop_thr_liters": stationary_thr_lit,
            },
            "predictions": out.to_dict(orient="records"),
        })
    except Exception as e:
        return jsonify({"error": f"Inference failed: {e}"}), 500

if __name__ == "__main__":
    # For local dev only; use gunicorn in production:
    #   gunicorn -w 2 -b 0.0.0.0:5001 app:app
    app.run(host="0.0.0.0", port=5001, debug=True)
