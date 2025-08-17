

# --- START OF FILE config.py ---
# --- START OF FILE config.py ---

# --- START OF FILE config.py ---

from pathlib import Path

# Base directory of the project.
BASE_DIR = Path(__file__).resolve().parent

# --- Model Artifact Paths ---
# Path to the trained CatBoost model file.
MODEL_PATH = "src/ml/catboost_model_random_tuned.cbm"

# Path to the saved LabelEncoder file.
LABEL_ENCODER_PATH = "src/ml/label_encoder.pkl"

# --- Model Features ---
# The exact list of features the model was trained on. This is crucial for consistency.
MODEL_FEATURES = [
    'fuelLevel', 'previous_fuel_level', 'distanceKm', 'locationLat',
    'locationLong', 'speed', 'ignitionStatus', 'isOverSpeed', 'fuel_diff',
    'hour', 'day_of_week', 'is_weekend'
]

# --- Default Data Paths (for standalone predict.py script) ---
DEFAULT_INPUT_CSV = BASE_DIR / "data" / "fuel_dataset_8000_stratified.csv"
DEFAULT_OUTPUT_CSV = BASE_DIR / "data" / "predictions.csv"






# """Project configuration constants."""
# from pathlib import Path

# PROJECT_ROOT = Path(__file__).resolve().parent
# DATA_DIR = PROJECT_ROOT / "data"
# MODEL_DIR = PROJECT_ROOT / "model"
# REQUIREMENTS_DIR = PROJECT_ROOT / "requirements"

# # Model paths
# MODEL_FILENAME = "xgb_vehicle_event_augmented.joblib"
# MODEL_PATH = MODEL_DIR / MODEL_FILENAME

# # Default files (customize as needed)
# DEFAULT_INPUT_CSV = DATA_DIR / "vehicle_events_augmented.csv"
# DEFAULT_OUTPUT_CSV = DATA_DIR / "predicted_vehicle_events.csv"




#--------------------------------------------------------------


# """Configuration for fuel event predictor (CatBoost).
# Updated for 8k stratified dataset and new thresholds.
# """
# from pathlib import Path

# # ---- Model + Encoder paths ----
# # Prefer files in /mnt/data, fall back to user's Desktop path if present.
# DEFAULT_MODEL_CANDIDATES = [
#     Path('/mnt/data/catboost_model_random_tuned.cbm'),
#     Path('/Users/shashwat/Desktop/SIDEMEN/model/catboost_model_random_tuned.cbm'),
# ]

# DEFAULT_LABEL_ENCODER_CANDIDATES = [
#     Path('/mnt/data/label_encoder.pkl'),
#     Path('/Users/shashwat/Desktop/SIDEMEN/label_encoder.pkl'),
# ]

# def resolve_first_existing(paths):
#     for p in paths:
#         try:
#             if Path(p).is_file():
#                 return str(p)
#         except Exception:
#             pass
#     # Return the first as default even if not found (will error on load)
#     return str(paths[0])

# MODEL_PATH = resolve_first_existing(DEFAULT_MODEL_CANDIDATES)
# LABEL_ENCODER_PATH = resolve_first_existing(DEFAULT_LABEL_ENCODER_CANDIDATES)

# # ---- Domain thresholds (match dataset generation rules) ----
# SPEED_LIMIT_KMH = 60.0           # overspeed if speed > 60
# THEFT_DROP_THRESHOLD = 1.5       # liters per 5-min tick
# LOW_FUEL_THRESHOLD = 20.0        # liters

# # ---- Expected feature columns (order matters for some libs) ----
# # Keep names consistent with dataset: machine-friendly, camel/snake case, no spaces.
# FEATURE_COLUMNS = [
#     'timestamp',            # ISO8601 string
#     'fuelLevel',
#     'previous_fuel_level',
#     'distanceKm',
#     'locationLat',
#     'locationLong',
#     'speed',
#     'ignitionStatus',       # 'ON'/'OFF'
#     'isOverSpeed',          # boolean
#     'eventType',            # optional at inference; ignored if present
#     'fuel_diff',
# ]

# # Columns that the model actually consumes (your trained features).
# # If your training excluded timestamp/eventType, adjust here accordingly.
# MODEL_FEATURES = [
#     'fuelLevel',
#     'previous_fuel_level',
#     'distanceKm',
#     'locationLat',
#     'locationLong',
#     'speed',
#     'ignitionStatus',
#     'isOverSpeed',
#     'fuel_diff',
# ]




















