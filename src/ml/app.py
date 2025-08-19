#!/usr/bin/env python3
"""
Flask API for inference:
- GET /health -> 200 OK
- POST /predict -> JSON payload OR CSV upload
    - JSON: { rows: [ {feature: value, ...}, ... ] }
    - CSV multipart/form-data field name: file
Returns predicted labels and encoded classes.
"""

from flask import Flask, request, jsonify
from catboost import CatBoostClassifier
import joblib
import pandas as pd
import numpy as np
from pathlib import Path
import io

from . import config

app = Flask(__name__)

# Load artifacts once
MODEL = CatBoostClassifier()
MODEL.load_model(str(config.MODEL_PATH))
LABELER = joblib.load(config.LABEL_ENCODER_PATH)

def normalize_columns(df: pd.DataFrame) -> pd.DataFrame:
    df = df.copy()
    df = df.loc[:, ~df.columns.str.contains(r"^Unnamed", case=False)]
    df.columns = (
        df.columns
        .str.strip()
        .str.replace(r"([a-z0-9])([A-Z])", r"\1_\2", regex=True)
        .str.replace(" ", "_", regex=False)
        .str.lower()
    )
    return df

def preprocess_features(df: pd.DataFrame) -> pd.DataFrame:
    df = normalize_columns(df)
    # drop target and timestamp if present
    for c in [config.TARGET_COL, "timestamp"]:
        if c in df.columns:
            df = df.drop(columns=[c])
    # booleans to ints
    if "is_over_speed" in df.columns:
        df["is_over_speed"] = (
            df["is_over_speed"].astype(str).str.strip().str.lower().map(
                {"true": 1, "1": 1, "yes": 1, "y": 1, "t": 1,
                 "false": 0, "0": 0, "no": 0, "n": 0, "f": 0}
            )
            .fillna(pd.to_numeric(df["is_over_speed"], errors="coerce"))
            .fillna(0).astype(int)
        )
    # coerce numerics if mostly numeric
    for col in df.columns:
        if col in config.CATEGORICAL_COLS:  # leave categorical as is
            continue
        conv = pd.to_numeric(df[col], errors="coerce")
        if conv.notna().mean() >= 0.8:
            df[col] = conv
    # ensure categorical dtypes
    for col in config.CATEGORICAL_COLS:
        if col in df.columns:
            df[col] = df[col].astype("category")
    return df

@app.get("/health")
def health():
    return jsonify({"status": "ok"}), 200

@app.post("/predict")
def predict():
    try:
        if "file" in request.files:
            # CSV upload
            f = request.files["file"]
            data = f.read()
            df_raw = pd.read_csv(io.BytesIO(data))
        else:
            # JSON payload: {"rows": [ {...}, {...} ]}
            payload = request.get_json(silent=True) or {}
            rows = payload.get("rows", [])
            df_raw = pd.DataFrame(rows)

        if df_raw.empty:
            return jsonify({"error": "No input rows provided"}), 400

        df = preprocess_features(df_raw)
        cat_idx = [df.columns.get_loc(c) for c in config.CATEGORICAL_COLS if c in df.columns]

        preds_enc = MODEL.predict(df).astype(int).flatten()
        preds = LABELER.inverse_transform(preds_enc)

        result = {
            "count": len(df),
            "pred_encoded": preds_enc.tolist(),
            "pred_label": preds.tolist(),
        }
        return jsonify(result), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(host=config.API_HOST, port=config.API_PORT, debug=config.API_DEBUG)
