#!/usr/bin/env python3
"""
Batch prediction utility:
- Loads CatBoost model + LabelEncoder
- Normalizes schema (snake_case, coerces numerics)
- Handles categorical features for CatBoost
- Writes predictions (encoded + label) to a CSV if --output is given
"""

import argparse
import pandas as pd
import numpy as np
from pathlib import Path
from catboost import CatBoostClassifier
import joblib
import sys
import re
from . import config

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
    # drop target if present
    if config.TARGET_COL in df.columns:
        df = df.drop(columns=[config.TARGET_COL])
    # drop optional columns if present
    for c in config.DROP_COLS_IF_PRESENT:
        if c in df.columns:
            df = df.drop(columns=[c])

    # is_over_speed -> int
    if "is_over_speed" in df.columns:
        df["is_over_speed"] = (
            df["is_over_speed"].astype(str).str.strip().str.lower().map(
                {"true": 1, "1": 1, "yes": 1, "y": 1, "t": 1,
                 "false": 0, "0": 0, "no": 0, "n": 0, "f": 0}
            ).fillna(pd.to_numeric(df["is_over_speed"], errors="coerce"))
             .fillna(0).astype(int)
        )

    # convert likely numeric columns
    numeric_like = []
    for col in df.columns:
        if col in config.CATEGORICAL_COLS:
            continue
        # try coercion; if mostly numeric, keep numeric
        conv = pd.to_numeric(df[col], errors="coerce")
        if conv.notna().mean() >= 0.8:
            df[col] = conv
            numeric_like.append(col)

    # categorical handling
    for col in config.CATEGORICAL_COLS:
        if col in df.columns:
            df[col] = df[col].astype("category")

    return df

def load_artifacts(model_path: Path, le_path: Path):
    model = CatBoostClassifier()
    model.load_model(str(model_path))
    le = joblib.load(le_path)
    return model, le

def main():
    ap = argparse.ArgumentParser(description="Batch predict telematics event types.")
    ap.add_argument("--input", type=str, default=str(config.DEFAULT_INPUT_CSV), help="Input CSV")
    ap.add_argument("--output", type=str, default=str(config.DEFAULT_OUTPUT_CSV), help="Output CSV with predictions")
    ap.add_argument("--model", type=str, default=str(config.MODEL_PATH), help="Path to CatBoost .cbm")
    ap.add_argument("--label-encoder", type=str, default=str(config.LABEL_ENCODER_PATH), help="Path to LabelEncoder .joblib")
    ap.add_argument("--head", type=int, default=0, help="If >0, only predict first N rows")
    args = ap.parse_args()

    inp = Path(args.input)
    out = Path(args.output)
    model_path = Path(args.model)
    le_path = Path(args.label_encoder)

    if not inp.exists():
        print(f"ERROR: input not found: {inp}", file=sys.stderr); sys.exit(1)
    if not model_path.exists():
        print(f"ERROR: model not found: {model_path}", file=sys.stderr); sys.exit(1)
    if not le_path.exists():
        print(f"ERROR: label encoder not found: {le_path}", file=sys.stderr); sys.exit(1)

    df_raw = pd.read_csv(inp)
    df = preprocess_features(df_raw)

    # CatBoost expects categorical indices by position
    cat_idx = [df.columns.get_loc(c) for c in config.CATEGORICAL_COLS if c in df.columns]

    if args.head and args.head > 0:
        df = df.head(args.head)

    model, le = load_artifacts(model_path, le_path)
    preds_enc = model.predict(df)
    preds_enc = preds_enc.astype(int).flatten()
    preds = le.inverse_transform(preds_enc)

    out_df = df_raw.copy()
    out_df["pred_encoded"] = preds_enc
    out_df["pred_label"] = preds

    if out:
        out.parent.mkdir(parents=True, exist_ok=True)
        out_df.to_csv(out, index=False)

    # Print a short preview to console
    print(out_df[["pred_encoded", "pred_label"]].head(20).to_string(index=False))

if __name__ == "__main__":
    main()
