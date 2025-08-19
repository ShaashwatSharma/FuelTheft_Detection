#!/usr/bin/env python3
"""
Central configuration for paths and common options.
Override via environment variables if needed.
"""

from pathlib import Path
import os

# Base project dir (use current directory for Docker container)
BASE = Path(__file__).parent

# Artifacts
MODEL_PATH = Path(os.getenv("MODEL_PATH", BASE / "catboost_model_random_search.cbm"))
LABEL_ENCODER_PATH = Path(os.getenv("LABEL_ENCODER_PATH", BASE / "label_encoder.joblib"))

# Data defaults (not used in API mode, but kept for batch processing)
DEFAULT_INPUT_CSV = Path(os.getenv("INPUT_CSV", BASE / "vehicle_telematics_11000.csv"))
DEFAULT_OUTPUT_CSV = Path(os.getenv("OUTPUT_CSV", BASE / "synthetic_fuel_11000_rules.csv"))

# Inference settings
RANDOM_SEED = int(os.getenv("RANDOM_SEED", "20250818"))

# API settings
API_HOST = os.getenv("API_HOST", "0.0.0.0")
API_PORT = int(os.getenv("API_PORT", "5001"))
API_DEBUG = os.getenv("API_DEBUG", "false").lower() in {"1", "true", "yes", "y"}

# Columns expected by training (drop these if present)
DROP_COLS_IF_PRESENT = ["timestamp"]

# Categorical columns for CatBoost (after normalization)
CATEGORICAL_COLS = ["ignition_status"]

# The target column name used in training
TARGET_COL = "event_type"
