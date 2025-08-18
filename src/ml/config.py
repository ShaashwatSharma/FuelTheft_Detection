# """Central configuration for PetroTrack ML inference/training."""
# from pathlib import Path

# # ---- Paths ----
# BASE_DIR: Path = Path(__file__).resolve().parent

# # Model artifacts
# MODEL_PATH: Path = BASE_DIR / "/Users/shashwat/Desktop/SIDEMEN/model/catboost_model_random_tuned.cbm"
# LABEL_ENCODER_PATH: Path = BASE_DIR / "/Users/shashwat/Desktop/SIDEMEN/label_encoder.pkl"

# # Default CSVs (used by model_runner / examples)
# DEFAULT_INPUT_CSV: Path = BASE_DIR / "synthetic_fuel_11000_rules.csv"
# DEFAULT_OUTPUT_CSV: Path = BASE_DIR / "vehicle_events_noisy_no_flag.csv"

# # ---- Domain constants ----
# SPEED_LIMIT_KMH: int = 60  # used to (re)derive isOverSpeed if needed

# # ---- Feature contract ----
# # Your uploaded dataset (synthetic_fuel_11000_rules.csv) has these base columns:
# # ['timestamp','fuelLevel','previous_fuel_level','distanceKm','locationLat',
# #  'locationLong','speed','ignitionStatus','isOverSpeed','fuel_diff','eventType']
# #
# # The model was trained with the base columns + simple time features.
# # If your current model ignores time features, it will safely ignore extras.
# MODEL_FEATURES = [
#     "fuelLevel",
#     "previous_fuel_level",
#     "distanceKm",
#     "locationLat",
#     "locationLong",
#     "speed",
#     "ignitionStatus",  # categorical -> will be mapped to 0/1
#     "isOverSpeed",     # bool -> 0/1
#     "fuel_diff",

#     # engineered from timestamp
#     "hour",
#     "day_of_week",
#     "is_weekend",
# ]

















#!/usr/bin/env python3
"""Central config: model paths, features, constants."""

from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent

# Artifacts
MODEL_PATH = "src/ml/catboost_model_random_tuned.cbm"
LABEL_ENCODER_PATH ="src/ml/label_encoder.pkl"

# Speed policy (used to derive isOverSpeed if missing)
SPEED_LIMIT_KMH = 60

# Feature contract (train & inference must match this)
MODEL_FEATURES = [
    "fuelLevel",
    "previous_fuel_level",
    "distanceKm",
    "locationLat",
    "locationLong",
    "speed",
    "ignitionStatus",
    "isOverSpeed",
    "fuel_diff",
    "hour",
    "day_of_week",
    "is_weekend",
]









