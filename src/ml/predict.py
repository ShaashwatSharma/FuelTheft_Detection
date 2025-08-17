

# --- START OF FILE predict.py ---

import argparse
import logging
from pathlib import Path
import pandas as pd
import numpy as np
import joblib
from catboost import CatBoostClassifier

# Import paths and settings from the central config file
from config import MODEL_PATH, LABEL_ENCODER_PATH, MODEL_FEATURES, DEFAULT_INPUT_CSV, DEFAULT_OUTPUT_CSV

# Set up basic logging for clear output
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("predict_script")

def load_artifacts():
    """Loads the trained model and label encoder from disk."""
    logger.info(f"Loading model from: {MODEL_PATH}")
    if not MODEL_PATH.exists():
        raise FileNotFoundError(f"Model file not found at {MODEL_PATH}")
    
    model = CatBoostClassifier()
    model.load_model(str(MODEL_PATH))

    logger.info(f"Loading label encoder from: {LABEL_ENCODER_PATH}")
    if not LABEL_ENCODER_PATH.exists():
        raise FileNotFoundError(f"Label encoder not found at {LABEL_ENCODER_PATH}")
        
    label_encoder = joblib.load(LABEL_ENCODER_PATH)
    
    logger.info("Model and encoder loaded successfully.")
    return model, label_encoder

def preprocess_for_prediction(df: pd.DataFrame) -> pd.DataFrame:
    """
    Applies the same preprocessing and feature engineering as in the training script.
    
    Args:
        df: The input pandas DataFrame.

    Returns:
        A DataFrame ready for prediction with features in the correct order.
    """
    X = df.copy()

    # --- Replicate Preprocessing from model.py ---
    
    # 1. Fill missing values
    X.fillna({
        'previous_fuel_level': 0,
        'fuel_diff': 0,
    }, inplace=True)

    # 2. Feature engineering from timestamp
    if 'timestamp' not in X.columns:
        raise ValueError("Input data must contain a 'timestamp' column.")
        
    ts = pd.to_datetime(X['timestamp'], errors='coerce')
    X['hour'] = ts.dt.hour
    X['day_of_week'] = ts.dt.dayofweek
    X['is_weekend'] = X['day_of_week'].isin([5, 6]).astype(int)
    
    # 3. Ensure all model features are present.
    # This prevents errors if the input CSV is missing columns.
    for col in MODEL_FEATURES:
        if col not in X.columns:
            # Create the missing column and fill with a default value
            logger.warning(f"Missing required feature column '{col}'. Filling with 0.")
            X[col] = 0
            
    # 4. Ensure column order is identical to the training data
    return X[MODEL_FEATURES]

def main():
    """Main function to run the batch prediction process."""
    parser = argparse.ArgumentParser(description="Generate predictions from a CSV file.")
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT_CSV, help="Path to the input CSV file.")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT_CSV, help="Path to save the output CSV.")
    args = parser.parse_args()

    if not args.input.exists():
        logger.error(f"Input file not found at: {args.input}")
        return

    logger.info(f"Reading input from {args.input}")
    df_in = pd.read_csv(args.input)
    
    if df_in.empty:
        logger.warning("Input CSV is empty. No predictions will be made.")
        return
        
    model, label_encoder = load_artifacts()
    
    # Preprocess the data to create features for the model
    X_processed = preprocess_for_prediction(df_in)
    
    # --- Prediction and Probability Generation ---
    logger.info(f"Generating predictions for {len(X_processed)} records...")
    
    # Predict class labels
    pred_encoded = np.array(model.predict(X_processed)).reshape(-1)
    pred_labels = label_encoder.inverse_transform(pred_encoded)
    
    # Predict class probabilities
    proba = model.predict_proba(X_processed)
    proba_df = pd.DataFrame(proba, index=df_in.index, columns=label_encoder.classes_)

    # --- Assemble and Save Output ---
    # Start with the original data
    df_out = df_in.copy()
    
    # Add the predicted label
    df_out["predicted_eventType"] = pred_labels
    
    # Add the probability for each class as new columns
    df_out = df_out.join(proba_df.add_prefix("proba_"))
    
    # Ensure the output directory exists
    args.output.parent.mkdir(parents=True, exist_ok=True)
    
    # Save to CSV
    df_out.to_csv(args.output, index=False)
    
    logger.info(f"Successfully wrote {len(df_out)} predictions to {args.output}")
    
    # Print a summary of the predictions
    logger.info("Prediction counts:\n" + str(pd.Series(pred_labels).value_counts()))

if __name__ == "__main__":
    main()


















# """Batch runner to generate predictions from an input CSV to an output CSV.

# Usage:
#     This script is modified to run within a Colab notebook environment.
# """
# import logging
# from pathlib import Path
# import pandas as pd
# import numpy as np
# import joblib
# from catboost import CatBoostClassifier

# # Set up basic logging
# logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s: %(message)s')
# logger = logging.getLogger("model_runner")

# # Paths
# BASE_DIR = Path(__file__).resolve().parent
# MODEL_PATH = Path("/Users/shashwat/Desktop/SIDEMEN/model/catboost_model_random_tuned.cbm")
# ENCODER_PATH = Path("/Users/shashwat/Desktop/SIDEMEN/label_encoder.pkl")


# def load_model_and_encoder():
#     logger.info(f"Loading model from: {MODEL_PATH}")
#     model = CatBoostClassifier()
#     model.load_model(str(MODEL_PATH))
#     if ENCODER_PATH.exists():
#         logger.info(f"Loading label encoder from: {ENCODER_PATH}")
#         label_encoder = joblib.load(ENCODER_PATH)
#     else:
#         label_encoder = None
#         logger.warning("Label encoder not found. Predictions will be raw.")
#     return model, label_encoder


# def predict_dataframe(df: pd.DataFrame, model, label_encoder):
#     # 1. Preprocessing
#     X = df.copy()
#     X.fillna({
#         'previous_fuel_level': 0,
#         'fuel_diff': 0,
#     }, inplace=True)
#     if 'timestamp' in X.columns:
#         ts = pd.to_datetime(X['timestamp'], errors='coerce')
#         X['hour'] = ts.dt.hour
#         X['day_of_week'] = ts.dt.dayofweek
#         X['is_weekend'] = X['day_of_week'].isin([5, 6]).astype(int)
#     # Align features
#     if hasattr(model, "feature_names_"):
#         features = list(model.feature_names_)
#         X = X[features]
#     # 2. Predict
#     raw_preds = model.predict(X)
#     raw_preds = np.asarray(raw_preds).ravel()
#     proba_df = None
#     if hasattr(model, "predict_proba"):
#         proba = model.predict_proba(X)
#         if isinstance(proba, list):
#             proba = np.array(proba)
#         if proba.ndim == 1:
#             proba = np.column_stack([1 - proba, proba])
#         if label_encoder is not None and len(getattr(label_encoder, "classes_", [])) == proba.shape[1]:
#             proba_cols = list(label_encoder.classes_)
#         else:
#             proba_cols = [f"class_{i}" for i in range(proba.shape[1])]
#         proba_df = pd.DataFrame(proba, index=df.index, columns=proba_cols)
#     # 3. Decode labels
#     if label_encoder is not None and np.issubdtype(raw_preds.dtype, np.number):
#         final_labels = label_encoder.inverse_transform(raw_preds.astype(int))
#     else:
#         final_labels = raw_preds.astype(str) if raw_preds.dtype.kind not in {"i", "u", "f"} else raw_preds
#     return final_labels, proba_df


# def main():
#     import argparse
#     parser = argparse.ArgumentParser()
#     parser.add_argument("--input", type=Path, required=True, help="CSV with features")
#     parser.add_argument("--output", type=Path, required=True, help="CSV to write predictions")
#     args = parser.parse_args()

#     if not args.input.exists():
#         logger.error(f"Input file not found at: {args.input}")
#         return

#     logger.info(f"Reading input from {args.input}")
#     df = pd.read_csv(args.input)
#     model, label_encoder = load_model_and_encoder()
#     logger.info(f"Generating predictions for {len(df)} records...")
#     labels, proba = predict_dataframe(df, model, label_encoder)
#     out = df.copy()
#     out["predicted_eventType"] = labels
#     if proba is not None:
#         out = out.join(proba.add_prefix("proba_"))
#     args.output.parent.mkdir(parents=True, exist_ok=True)
#     out.to_csv(args.output, index=False)
#     logger.info(f"Successfully wrote predictions to {args.output}")


# if __name__ == "__main__":
#     main()



#-------------------------------------------------------------------------------------------------

# """Batch runner to generate predictions from an input CSV to an output CSV.

# Usage:
#     python predict.py            # Uses default paths
#     python predict.py --input X --output Y   # Overrides defaults
# """
# import logging
# from pathlib import Path
# import pandas as pd
# import numpy as np
# import joblib
# from catboost import CatBoostClassifier

# # Set up basic logging
# logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s: %(message)s')
# logger = logging.getLogger("model_runner")

# # --- Default file paths ---
# BASE_DIR = Path(__file__).resolve().parent
# DEFAULT_INPUT = BASE_DIR / "data/vehicle_events_noisy.csv"
# DEFAULT_OUTPUT = BASE_DIR / "data/predictions.csv"
# MODEL_PATH = BASE_DIR / "model/catboost_model_random_tuned.cbm"
# ENCODER_PATH = BASE_DIR / "label_encoder.pkl"


# def load_model_and_encoder():
#     logger.info(f"Loading model from: {MODEL_PATH}")
#     model = CatBoostClassifier()
#     model.load_model(str(MODEL_PATH))
#     if ENCODER_PATH.exists():
#         logger.info(f"Loading label encoder from: {ENCODER_PATH}")
#         label_encoder = joblib.load(ENCODER_PATH)
#     else:
#         label_encoder = None
#         logger.warning("Label encoder not found. Predictions will be raw.")
#     return model, label_encoder


# def predict_dataframe(df: pd.DataFrame, model, label_encoder):
#     X = df.copy()
#     X.fillna({'previous_fuel_level': 0, 'fuel_diff': 0}, inplace=True)
#     if 'timestamp' in X.columns:
#         ts = pd.to_datetime(X['timestamp'], errors='coerce')
#         X['hour'] = ts.dt.hour
#         X['day_of_week'] = ts.dt.dayofweek
#         X['is_weekend'] = X['day_of_week'].isin([5, 6]).astype(int)
#     if hasattr(model, "feature_names_"):
#         features = list(model.feature_names_)
#         X = X[features]
#     raw_preds = model.predict(X)
#     raw_preds = np.asarray(raw_preds).ravel()
#     proba_df = None
#     if hasattr(model, "predict_proba"):
#         proba = model.predict_proba(X)
#         if isinstance(proba, list):
#             proba = np.array(proba)
#         if proba.ndim == 1:
#             proba = np.column_stack([1 - proba, proba])
#         if label_encoder is not None and len(getattr(label_encoder, "classes_", [])) == proba.shape[1]:
#             proba_cols = list(label_encoder.classes_)
#         else:
#             proba_cols = [f"class_{i}" for i in range(proba.shape[1])]
#         proba_df = pd.DataFrame(proba, index=df.index, columns=proba_cols)
#     if label_encoder is not None and np.issubdtype(raw_preds.dtype, np.number):
#         final_labels = label_encoder.inverse_transform(raw_preds.astype(int))
#     else:
#         final_labels = raw_preds.astype(str) if raw_preds.dtype.kind not in {"i", "u", "f"} else raw_preds
#     return final_labels, proba_df


# def main():
#     import argparse
#     parser = argparse.ArgumentParser()
#     parser.add_argument("--input", type=Path, default=DEFAULT_INPUT, help="CSV with features")
#     parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT, help="CSV to write predictions")
#     args = parser.parse_args()

#     if not args.input.exists():
#         logger.error(f"Input file not found at: {args.input}")
#         return

#     logger.info(f"Reading input from {args.input}")
#     df = pd.read_csv(args.input)
#     model, label_encoder = load_model_and_encoder()
#     logger.info(f"Generating predictions for {len(df)} records...")
#     labels, proba = predict_dataframe(df, model, label_encoder)
#     out = df.copy()
#     out["predicted_eventType"] = labels
#     if proba is not None:
#         out = out.join(proba.add_prefix("proba_"))
#     args.output.parent.mkdir(parents=True, exist_ok=True)
#     out.to_csv(args.output, index=False)
#     logger.info(f"Successfully wrote predictions to {args.output}")


# if __name__ == "__main__":
#     main()


#-------------------------------------------------------------------------------------------------



#!/usr/bin/env python3
# """Batch prediction script.
# Reads a CSV, applies preprocessing, outputs predictions with probabilities.
# Updated for 8k stratified dataset + 60 km/h overspeed.
# """
# import argparse
# from pathlib import Path
# import pandas as pd
# import numpy as np
# import joblib
# from catboost import CatBoostClassifier
# from config import MODEL_PATH, LABEL_ENCODER_PATH, MODEL_FEATURES, SPEED_LIMIT_KMH

# def ensure_cols(df: pd.DataFrame) -> pd.DataFrame:
#     if 'fuel_diff' not in df.columns and {'fuelLevel','previous_fuel_level'}.issubset(df.columns):
#         df['fuel_diff'] = df['fuelLevel'] - df['previous_fuel_level']
#     if 'isOverSpeed' not in df.columns and 'speed' in df.columns:
#         df['isOverSpeed'] = df['speed'] > SPEED_LIMIT_KMH
#     if 'ignitionStatus' in df.columns:
#         df['ignitionStatus'] = df['ignitionStatus'].apply(lambda v: 'ON' if str(v).upper() in ['ON','1','TRUE'] else 'OFF')
#     df.fillna({
#         'previous_fuel_level': 0.0,
#         'fuel_diff': 0.0,
#         'distanceKm': 0.0,
#         'locationLat': 0.0,
#         'locationLong': 0.0,
#         'speed': 0.0,
#         'ignitionStatus': 'OFF',
#         'isOverSpeed': False,
#     }, inplace=True)
#     df['isOverSpeed'] = df['isOverSpeed'].astype(bool).astype(int)
#     df['ignitionStatus'] = (df['ignitionStatus'].astype(str).str.upper() == 'ON').astype(int)
#     return df

# def preprocess(df: pd.DataFrame) -> pd.DataFrame:
#     df = ensure_cols(df.copy())
#     return df[MODEL_FEATURES].copy()

# def main():
#     ap = argparse.ArgumentParser()
#     ap.add_argument("-i", "--input", required=True, help="Input CSV")
#     ap.add_argument("-o", "--output", required=True, help="Output CSV with predictions")
#     args = ap.parse_args()

#     model = CatBoostClassifier()
#     model.load_model(MODEL_PATH)
#     le = joblib.load(LABEL_ENCODER_PATH)

#     df_in = pd.read_csv(args.input)
#     X = preprocess(df_in)

#     pred = np.array(model.predict(X)).reshape(-1)
#     labels = le.inverse_transform(pred)
#     proba = model.predict_proba(X)
#     classes = list(le.classes_)
#     proba_df = pd.DataFrame(proba, columns=classes)

#     out = df_in.copy()
#     out['predicted_eventType'] = labels
#     for c in classes:
#         out[f"proba_{c}"] = proba_df[c].values
#     Path(args.output).parent.mkdir(parents=True, exist_ok=True)
#     out.to_csv(args.output, index=False)
#     print(f"Wrote predictions to {args.output}")
#     print("Counts:", pd.Series(labels).value_counts().to_dict())

# if __name__ == "__main__":
#     main()






#-----------------------------------------------------------------------------------------------




# #!/usr/bin/env python3
# #!/usr/bin/env python3
# """
# Batch prediction script.
# Reads a CSV, applies preprocessing, outputs predictions with probabilities.
# Handles missing columns gracefully.
# Defaults allow running without -i/-o arguments.
# """
# import argparse
# from pathlib import Path
# import pandas as pd
# import numpy as np
# import joblib
# from catboost import CatBoostClassifier
# from config import MODEL_PATH, LABEL_ENCODER_PATH, MODEL_FEATURES, SPEED_LIMIT_KMH

# # ---- Default paths (so running without args works) ----
# DEFAULT_INPUT = "/Users/shashwat/Desktop/SIDEMEN/data/vehicle_events_noisy_no_flag.csv"
# DEFAULT_OUTPUT = "/Users/shashwat/Desktop/SIDEMEN/data/_tmp.csv"

# def ensure_cols(df: pd.DataFrame) -> pd.DataFrame:
#     if 'fuel_diff' not in df.columns and {'fuelLevel','previous_fuel_level'}.issubset(df.columns):
#         df['fuel_diff'] = df['fuelLevel'] - df['previous_fuel_level']
#     if 'isOverSpeed' not in df.columns and 'speed' in df.columns:
#         df['isOverSpeed'] = df['speed'] > SPEED_LIMIT_KMH
#     if 'ignitionStatus' in df.columns:
#         df['ignitionStatus'] = df['ignitionStatus'].apply(
#             lambda v: 'ON' if str(v).upper() in ['ON','1','TRUE'] else 'OFF'
#         )
#     df.fillna({
#         'previous_fuel_level': 0.0,
#         'fuel_diff': 0.0,
#         'distanceKm': 0.0,
#         'locationLat': 0.0,
#         'locationLong': 0.0,
#         'speed': 0.0,
#         'ignitionStatus': 'OFF',
#         'isOverSpeed': False,
#     }, inplace=True)
#     # Convert to numeric features expected by the model
#     df['isOverSpeed'] = df['isOverSpeed'].astype(bool).astype(int)
#     df['ignitionStatus'] = (df['ignitionStatus'].astype(str).str.upper() == 'ON').astype(int)
#     return df

# def preprocess(df: pd.DataFrame) -> pd.DataFrame:
#     df = ensure_cols(df.copy())
#     missing = [c for c in MODEL_FEATURES if c not in df.columns]
#     if missing:
#         print(f"Warning: missing columns in input CSV, filling with zeros: {missing}")
#         for c in missing:
#             df[c] = 0.0 if c not in ['ignitionStatus','isOverSpeed'] else 0
#     return df[MODEL_FEATURES].copy()

# def main():
#     ap = argparse.ArgumentParser()
#     ap.add_argument("-i", "--input", default=DEFAULT_INPUT,
#                     help=f"Input CSV (default: {DEFAULT_INPUT})")
#     ap.add_argument("-o", "--output", default=DEFAULT_OUTPUT,
#                     help=f"Output CSV (default: {DEFAULT_OUTPUT})")
#     args = ap.parse_args()

#     in_path = Path(args.input).expanduser()
#     out_path = Path(args.output).expanduser()

#     if not in_path.exists():
#         raise FileNotFoundError(
#             f"Input CSV not found: {in_path}\n"
#             f"Tip: pass -i /path/to/file.csv and -o /path/to/out.csv"
#         )

#     model = CatBoostClassifier()
#     model.load_model(MODEL_PATH)
#     le = joblib.load(LABEL_ENCODER_PATH)

#     df_in = pd.read_csv(in_path)
#     X = preprocess(df_in)

#     if X.empty:
#         print("Input CSV has no rows after preprocessing. Nothing to predict.")
#         return

#     pred = np.array(model.predict(X)).reshape(-1)
#     labels = le.inverse_transform(pred)
#     proba = model.predict_proba(X)
#     classes = list(le.classes_)
#     proba_df = pd.DataFrame(proba, columns=classes)

#     out = df_in.copy()
#     out['predicted_eventType'] = labels
#     for c in classes:
#         out[f"proba_{c}"] = proba_df[c].values

#     out_path.parent.mkdir(parents=True, exist_ok=True)
#     out.to_csv(out_path, index=False)
#     print(f"Wrote predictions to {out_path}")
#     print("Counts:", pd.Series(labels).value_counts().to_dict())

# if __name__ == "__main__":
#     main()









#!/usr/bin/env python3
# """
# Batch prediction script.
# Reads a CSV, applies preprocessing, outputs predictions with probabilities.
# Uses 'timestamp' directly (no derived hour/day_of_week/is_weekend).
# """
# import argparse
# from pathlib import Path
# import pandas as pd
# import numpy as np
# import joblib
# from catboost import CatBoostClassifier
# from config import MODEL_PATH, LABEL_ENCODER_PATH, MODEL_FEATURES, SPEED_LIMIT_KMH

# # Defaults so you can run without args
# DEFAULT_INPUT = "/Users/shashwat/Desktop/SIDEMEN/data/vehicle_events_noisy_no_flag.csv"
# DEFAULT_OUTPUT = "/Users/shashwat/Desktop/SIDEMEN/data/_tmp.csv"

# def ensure_cols(df: pd.DataFrame) -> pd.DataFrame:
#     # Compute fuel_diff if missing
#     if 'fuel_diff' not in df.columns and {'fuelLevel','previous_fuel_level'}.issubset(df.columns):
#         df['fuel_diff'] = df['fuelLevel'] - df['previous_fuel_level']

#     # Derive isOverSpeed if missing
#     if 'isOverSpeed' not in df.columns and 'speed' in df.columns:
#         df['isOverSpeed'] = df['speed'] > SPEED_LIMIT_KMH

#     # Normalize ignitionStatus to 'ON'/'OFF' then 1/0 later
#     if 'ignitionStatus' in df.columns:
#         df['ignitionStatus'] = df['ignitionStatus'].apply(
#             lambda v: 'ON' if str(v).upper() in ['ON','1','TRUE'] else 'OFF'
#         )

#     # Ensure timestamp column exists (empty if missing)
#     if 'timestamp' not in df.columns:
#         df['timestamp'] = ''

#     # Fill NA defaults
#     df.fillna({
#         'previous_fuel_level': 0.0,
#         'fuel_diff': 0.0,
#         'distanceKm': 0.0,
#         'locationLat': 0.0,
#         'locationLong': 0.0,
#         'speed': 0.0,
#         'ignitionStatus': 'OFF',
#         'isOverSpeed': False,
#         'timestamp': ''
#     }, inplace=True)

#     # Convert to numeric as expected by the model
#     df['isOverSpeed'] = df['isOverSpeed'].astype(bool).astype(int)
#     df['ignitionStatus'] = (df['ignitionStatus'].astype(str).str.upper() == 'ON').astype(int)

#     return df

# def preprocess(df: pd.DataFrame) -> pd.DataFrame:
#     df = ensure_cols(df.copy())
#     # Ensure all model features exist
#     missing = [c for c in MODEL_FEATURES if c not in df.columns]
#     if missing:
#         print(f"Warning: missing columns in input CSV, filling with defaults: {missing}")
#         for c in missing:
#             if c in ['ignitionStatus', 'isOverSpeed']:
#                 df[c] = 0
#             elif c == 'timestamp':
#                 df[c] = ''
#             else:
#                 df[c] = 0.0
#     # Keep only the model features in the expected order
#     return df[MODEL_FEATURES].copy()

# def main():
#     ap = argparse.ArgumentParser()
#     ap.add_argument("-i", "--input", default=DEFAULT_INPUT, help=f"Input CSV (default: {DEFAULT_INPUT})")
#     ap.add_argument("-o", "--output", default=DEFAULT_OUTPUT, help=f"Output CSV (default: {DEFAULT_OUTPUT})")
#     args = ap.parse_args()

#     in_path = Path(args.input).expanduser()
#     out_path = Path(args.output).expanduser()

#     if not in_path.exists():
#         raise FileNotFoundError(f"Input CSV not found: {in_path}")

#     model = CatBoostClassifier()
#     model.load_model(MODEL_PATH)
#     le = joblib.load(LABEL_ENCODER_PATH)

#     df_in = pd.read_csv(in_path)
#     X = preprocess(df_in)

#     if X.empty:
#         print("Input CSV has no rows after preprocessing. Nothing to predict.")
#         return

#     pred = np.array(model.predict(X)).reshape(-1)
#     labels = le.inverse_transform(pred)
#     proba = model.predict_proba(X)
#     classes = list(le.classes_)
#     proba_df = pd.DataFrame(proba, columns=classes)

#     out = df_in.copy()
#     out['predicted_eventType'] = labels
#     for c in classes:
#         out[f"proba_{c}"] = proba_df[c].values

#     out_path.parent.mkdir(parents=True, exist_ok=True)
#     out.to_csv(out_path, index=False)
#     print(f"Wrote predictions to {out_path}")
#     print("Counts:", pd.Series(labels).value_counts().to_dict())

# if __name__ == "__main__":
#     main()
















# --- START OF FILE predict.py ---

# --- START OF FILE predict.py ---

# import argparse
# import logging
# from pathlib import Path
# import pandas as pd
# import numpy as np
# import joblib
# from catboost import CatBoostClassifier

# # Import paths and settings from the central config file
# from config import MODEL_PATH, LABEL_ENCODER_PATH, MODEL_FEATURES, DEFAULT_INPUT_CSV, DEFAULT_OUTPUT_CSV

# # Set up basic logging for clear output
# logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
# logger = logging.getLogger("predict_script")

# def load_artifacts():
#     """Loads the trained model and label encoder from disk."""
#     logger.info(f"Loading model from: {MODEL_PATH}")
#     if not MODEL_PATH.exists():
#         raise FileNotFoundError(f"Model file not found at {MODEL_PATH}")
    
#     model = CatBoostClassifier()
#     model.load_model(str(MODEL_PATH))

#     logger.info(f"Loading label encoder from: {LABEL_ENCODER_PATH}")
#     if not LABEL_ENCODER_PATH.exists():
#         raise FileNotFoundError(f"Label encoder not found at {LABEL_ENCODER_PATH}")
        
#     label_encoder = joblib.load(LABEL_ENCODER_PATH)
    
#     logger.info("Model and encoder loaded successfully.")
#     return model, label_encoder

# def preprocess_for_prediction(df: pd.DataFrame) -> pd.DataFrame:
#     """
#     Applies the same preprocessing and feature engineering as in the training script.
    
#     Args:
#         df: The input pandas DataFrame.

#     Returns:
#         A DataFrame ready for prediction with features in the correct order.
#     """
#     X = df.copy()

#     # --- Replicate Preprocessing from model.py ---
    
#     # 1. Fill missing values
#     X.fillna({
#         'previous_fuel_level': 0,
#         'fuel_diff': 0,
#     }, inplace=True)

#     # 2. Feature engineering from timestamp
#     if 'timestamp' not in X.columns:
#         raise ValueError("Input data must contain a 'timestamp' column.")
        
#     ts = pd.to_datetime(X['timestamp'], errors='coerce')
#     X['hour'] = ts.dt.hour
#     X['day_of_week'] = ts.dt.dayofweek
#     X['is_weekend'] = X['day_of_week'].isin([5, 6]).astype(int)
    
#     # 3. Ensure all model features are present.
#     # This prevents errors if the input CSV is missing columns.
#     for col in MODEL_FEATURES:
#         if col not in X.columns:
#             # Create the missing column and fill with a default value
#             logger.warning(f"Missing required feature column '{col}'. Filling with 0.")
#             X[col] = 0
            
#     # 4. Ensure column order is identical to the training data
#     return X[MODEL_FEATURES]

# def main():
#     """Main function to run the batch prediction process."""
#     parser = argparse.ArgumentParser(description="Generate predictions from a CSV file.")
#     parser.add_argument("--input", type=Path, default=DEFAULT_INPUT_CSV, help="Path to the input CSV file.")
#     parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT_CSV, help="Path to save the output CSV.")
#     args = parser.parse_args()

#     if not args.input.exists():
#         logger.error(f"Input file not found at: {args.input}")
#         return

#     logger.info(f"Reading input from {args.input}")
#     df_in = pd.read_csv(args.input)
    
#     if df_in.empty:
#         logger.warning("Input CSV is empty. No predictions will be made.")
#         return
        
#     model, label_encoder = load_artifacts()
    
#     # Preprocess the data to create features for the model
#     X_processed = preprocess_for_prediction(df_in)
    
#     # --- Prediction and Probability Generation ---
#     logger.info(f"Generating predictions for {len(X_processed)} records...")
    
#     # Predict class labels
#     pred_encoded = np.array(model.predict(X_processed)).reshape(-1)
#     pred_labels = label_encoder.inverse_transform(pred_encoded)
    
#     # Predict class probabilities
#     proba = model.predict_proba(X_processed)
#     proba_df = pd.DataFrame(proba, index=df_in.index, columns=label_encoder.classes_)

#     # --- Assemble and Save Output ---
#     # Start with the original data
#     df_out = df_in.copy()
    
#     # Add the predicted label
#     df_out["predicted_eventType"] = pred_labels
    
#     # Add the probability for each class as new columns
#     df_out = df_out.join(proba_df.add_prefix("proba_"))
    
#     # Ensure the output directory exists
#     args.output.parent.mkdir(parents=True, exist_ok=True)
    
#     # Save to CSV
#     df_out.to_csv(args.output, index=False)
    
#     logger.info(f"Successfully wrote predictions to {args.output}")
    
#     # Print a summary of the predictions
#     logger.info("Prediction counts:\n" + str(pd.Series(pred_labels).value_counts()))

# if __name__ == "__main__":
#     main()







