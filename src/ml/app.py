
# --- START OF FILE app.py ---

from flask import Flask, request, jsonify
import pandas as pd
import numpy as np
from catboost import CatBoostClassifier
import joblib
from pathlib import Path
import logging

# Import paths and settings from the central config file
from config import MODEL_PATH, LABEL_ENCODER_PATH, MODEL_FEATURES

# --- App Initialization ---
app = Flask(__name__)
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger("predict-api")

# --- Load Model and Encoder at Startup ---
try:
    logger.info(f"Loading model from: {MODEL_PATH}")
model = CatBoostClassifier()
    model.load_model(str(MODEL_PATH))

    logger.info(f"Loading label encoder from: {LABEL_ENCODER_PATH}")
    label_encoder = joblib.load(LABEL_ENCODER_PATH)
    logger.info("Model and encoder loaded successfully.")
except FileNotFoundError as e:
    logger.error(f"Error loading model artifacts: {e}")
    # Exit if essential files are missing
    raise RuntimeError(f"Could not load model/encoder: {e}") from e


def preprocess(df: pd.DataFrame) -> pd.DataFrame:
    """
    Applies the same preprocessing and feature engineering as in the training script.
    """
    X = df.copy()

    # 1. Fill missing values
    X.fillna({
        'previous_fuel_level': 0,
        'fuel_diff': 0,
    }, inplace=True)

    # 2. Feature engineering from timestamp
    if 'timestamp' in X.columns:
        ts = pd.to_datetime(X['timestamp'], errors='coerce')
        X['hour'] = ts.dt.hour
        X['day_of_week'] = ts.dt.dayofweek
        X['is_weekend'] = X['day_of_week'].isin([5, 6]).astype(int)
else:
        # Handle case where timestamp is not provided
        raise ValueError("'timestamp' column is required for feature engineering.")
        
    # 3. Ensure all model features are present and in the correct order
    # This is critical for the model to work correctly.
    for col in MODEL_FEATURES:
        if col not in X.columns:
            raise ValueError(f"Missing required feature column: '{col}'")
            
    return X[MODEL_FEATURES]

# --- API Endpoints ---

@app.route("/health", methods=["GET"])
def health():
    """Health check endpoint to confirm the service is running."""
    return jsonify({"status": "ok", "model": str(Path(MODEL_PATH).name)})

@app.route("/predict", methods=["POST"])
def predict():
    """Main prediction endpoint. Accepts JSON or a CSV file."""
    try:
        # Accept JSON with {'records': [...]} or a CSV file field 'file'
        if request.is_json:
            payload = request.get_json(silent=True) or {}
            records = payload.get("records")
            if not records or not isinstance(records, list):
                return jsonify({"error": "JSON payload must be in the format {'records': [...]}"}), 400
            df_in = pd.DataFrame.from_records(records)
        else:
            if "file" not in request.files:
                return jsonify({"error": "No JSON payload or CSV file uploaded."}), 400
            file = request.files["file"]
            df_in = pd.read_csv(file)

        if df_in.empty:
            return jsonify({"error": "Input data is empty."}), 400

        # Preprocess the data to create features
        X = preprocess(df_in)
        
        # Make predictions
        pred_encoded = np.array(model.predict(X)).reshape(-1)
        pred_labels = label_encoder.inverse_transform(pred_encoded)
        
        # Get probabilities
        proba = model.predict_proba(X)
        classes = list(label_encoder.classes_)
        proba_df = pd.DataFrame(proba, columns=classes)

        # Build the response
        out_df = df_in.copy()
        out_df['predicted_eventType'] = pred_labels
        for c in classes:
            out_df[f"proba_{c}"] = proba_df[c].values

        counts = pd.Series(pred_labels).value_counts().to_dict()

        return jsonify({
            "prediction_counts": counts,
            "predictions": out_df.to_dict(orient="records"),
        })

    except ValueError as e:
        logger.error(f"Validation error: {e}")
        return jsonify({"error": f"Bad Request: {e}"}), 400
    except Exception as e:
        logger.exception("An unexpected error occurred during prediction.")
        return jsonify({"error": f"An internal error occurred: {e}"}), 500

if __name__ == "__main__":
    # Runs the Flask app on port 5001
    app.run(host="0.0.0.0", port=5001, debug=False)







# from flask import Flask, request, jsonify
# import pandas as pd
# from catboost import CatBoostClassifier
# import joblib

# # --- Initialize Flask app ---
# app = Flask(__name__)

# # --- Load the trained CatBoost model ---
# MODEL_PATH = "/Users/shashwat/Desktop/SIDEMEN/model/catboost_model_random_tuned.cbm"
# model = CatBoostClassifier()
# model.load_model(MODEL_PATH)

# # Load the label encoder
# LABEL_ENCODER_PATH = "label_encoder.pkl"
# label_encoder = joblib.load(LABEL_ENCODER_PATH)

# # --- Data Preprocessing Function ---
# def preprocess(df: pd.DataFrame) -> pd.DataFrame:
#     # Fill missing values for the features used in training
#     df.fillna({
#         'previous_fuel_level': 0,
#         'fuel_diff': 0
#     }, inplace=True)

#     # Drop 'data_quality_flag' if present (not used in training)
#     if 'data_quality_flag' in df.columns:
#         df.drop(columns=['data_quality_flag'], inplace=True)

#     return df

# # --- Health Check Endpoint ---
# @app.route("/health", methods=["GET"])
# def health():
#     return jsonify({"status": "ok"}), 200

# # --- Prediction Endpoint ---
# @app.route("/predict", methods=["POST"])
# def predict_endpoint():
#     # Handle JSON input
#     if request.is_json:
#         payload = request.get_json(silent=True) or {}
#         records = payload.get("records")
#         if not records:
#             return jsonify({"error": "JSON must contain 'records': [{feature: value}]"}), 400
#         df = pd.DataFrame.from_records(records)
#     else:
#         # Handle CSV upload
#         if "file" not in request.files:
#             return jsonify({"error": "No JSON or CSV file uploaded"}), 400
#         file = request.files["file"]
#         try:
#             df = pd.read_csv(file)
#         except Exception as e:
#             return jsonify({"error": f"Failed to read CSV: {e}"}), 400

#     # Preprocess incoming data
#     df_processed = preprocess(df)

#     # Make prediction
#     pred_encoded = model.predict(df_processed)
#     pred_labels = label_encoder.inverse_transform(pred_encoded.flatten())

#     # Optional: return probabilities
#     pred_proba = model.predict_proba(df_processed)
#     pred_proba_df = pd.DataFrame(pred_proba, columns=label_encoder.classes_)

#     return jsonify({
#         "predictions": pred_labels.tolist(),
#         "probabilities": pred_proba_df.to_dict(orient="records")
#     })

# # --- Run the app ---
# if __name__ == "__main__":
#     app.run(host="0.0.0.0", port=8000, debug=False)






# app_api.py
# import os
# import pandas as pd
# import joblib
# from fastapi import FastAPI, HTTPException
# # Removed Pydantic BaseModel and List import as they will be handled by integrating the predict_event function
# # from pydantic import BaseModel
# # from typing import List

# from catboost import CatBoostClassifier

# # --- 1. Define paths relative to the current working directory ---
# # Use the current working directory instead of __file__ in Colab
# BASE_DIR = os.getcwd()
# MODEL_PATH = os.path.join(BASE_DIR, "/Users/shashwat/Desktop/SIDEMEN/model/catboost_model_random_tuned.cbm") # Corrected path
# LABEL_ENCODER_PATH = os.path.join(BASE_DIR, "label_encoder.pkl") # Corrected path

# # --- 2. Load the CatBoost model ---
# model = CatBoostClassifier()
# if os.path.exists(MODEL_PATH):
#     model.load_model(MODEL_PATH)
#     print(f"Model loaded successfully from {MODEL_PATH}")
# else:
#     raise FileNotFoundError(f"Model file not found at {MODEL_PATH}")

# # --- 3. Load the LabelEncoder ---
# if os.path.exists(LABEL_ENCODER_PATH):
#     label_encoder = joblib.load(LABEL_ENCODER_PATH)
#     print(f"LabelEncoder loaded successfully from {LABEL_ENCODER_PATH}")
# else:
#     raise FileNotFoundError(f"LabelEncoder file not found at {LABEL_ENCODER_PATH}")

# # --- 4. Define FastAPI ---
# app = FastAPI(title="Vehicle Event Prediction API")

# # --- Removed Pydantic model for request ---
# # class VehicleData(BaseModel):
# #     ignitionStatus: List[int]       # or List[str] if categorical strings
# #     isOverSpeed: List[int]          # 0/1
# #     previous_fuel_level: List[float]
# #     fuel_diff: List[float]
# #     hour: List[int]
# #     day_of_week: List[int]
# #     is_weekend: List[int]
# #     # Add other features from your training dataset if needed

# # --- Removed Prediction endpoint ---
# # @app.post("/predict")
# # def predict(data: VehicleData):
# #     try:
# #         # Convert request to DataFrame
# #         df = pd.DataFrame(data.dict())
# #         # Predict
# #         pred_encoded = model.predict(df)
# #         pred_labels = label_encoder.inverse_transform(pred_encoded.flatten())
# #         return {"predictions": pred_labels.tolist()}
# #     except Exception as e:
# #         raise HTTPException(status_code=400, detail=str(e))

# # --- 7. Root endpoint ---
# @app.get("/")
# def root():
#     return {"message": "Vehicle Event Prediction API is running."}

# # Note: The actual prediction endpoint will be added in a subsequent step
# # using the 'predict_event' function defined in cell qLPjIQ7iJH51.

#-----------------------------------------------------------------------------------------




# from flask import Flask, request, jsonify
# import pandas as pd
# import numpy as np
# from catboost import CatBoostClassifier
# import joblib
# from pathlib import Path
# import logging

# from config import MODEL_PATH, LABEL_ENCODER_PATH, MODEL_FEATURES, SPEED_LIMIT_KMH

# app = Flask(__name__)
# logging.basicConfig(level=logging.INFO)
# logger = logging.getLogger("predict-api")

# # ---- Load model & encoder at startup ----
# model = CatBoostClassifier()
# model.load_model(MODEL_PATH)
# label_encoder = joblib.load(LABEL_ENCODER_PATH)

# CATEGORICAL_COLS = ['ignitionStatus', 'isOverSpeed']

# def ensure_cols(df: pd.DataFrame) -> pd.DataFrame:
#     # Compute derived fields if missing
#     if 'fuel_diff' not in df.columns and {'fuelLevel','previous_fuel_level'}.issubset(df.columns):
#         df['fuel_diff'] = df['fuelLevel'] - df['previous_fuel_level']

#     if 'isOverSpeed' not in df.columns and 'speed' in df.columns:
#         df['isOverSpeed'] = df['speed'] > SPEED_LIMIT_KMH

#     # ignitionStatus as ON/OFF if numeric provided
#     if 'ignitionStatus' in df.columns:
#         df['ignitionStatus'] = df['ignitionStatus'].apply(lambda v: 'ON' if str(v).upper() in ['ON','1','TRUE'] else 'OFF')

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
#     }, inplace=True)

#     # Type fixes
#     df['isOverSpeed'] = df['isOverSpeed'].astype(bool)
#     return df

# def preprocess(df: pd.DataFrame) -> pd.DataFrame:
#     df = ensure_cols(df.copy())

#     # One-hot encode ignitionStatus (ON/OFF) and bool to 0/1
#     if 'ignitionStatus' in df.columns:
#         df['ignitionStatus'] = (df['ignitionStatus'].astype(str).str.upper() == 'ON').astype(int)
#     if 'isOverSpeed' in df.columns:
#         df['isOverSpeed'] = df['isOverSpeed'].astype(bool).astype(int)

#     # Select model features
#     X = df[MODEL_FEATURES].copy()
#     return X

# @app.route("/health", methods=["GET"])
# def health():
#     return jsonify({"status": "ok", "model": str(Path(MODEL_PATH).name)})

# @app.route("/predict", methods=["POST"])
# def predict():
#     # Accept JSON with {'records': [...]} or a CSV file field 'file'
#     if request.is_json:
#         payload = request.get_json(silent=True) or {}
#         records = payload.get("records")
#         if not records:
#             return jsonify({"error": "JSON must contain 'records': [{feature: value}]"}), 400
#         df_in = pd.DataFrame.from_records(records)
#     else:
#         if "file" not in request.files:
#             return jsonify({"error": "No JSON or CSV file uploaded"}), 400
#         file = request.files["file"]
#         try:
#             df_in = pd.read_csv(file)
#         except Exception as e:
#             return jsonify({"error": f"Failed to read CSV: {e}"}), 400

#     X = preprocess(df_in)
#     pred_encoded = model.predict(X)
#     # CatBoost returns shape (n,1); flatten to 1D ints
#     pred_encoded = np.array(pred_encoded).reshape(-1)
#     pred_labels = label_encoder.inverse_transform(pred_encoded)

#     # Optional probabilities
#     proba = model.predict_proba(X)
#     classes = list(label_encoder.classes_)
#     proba_df = pd.DataFrame(proba, columns=classes)

#     out = df_in.copy()
#     out['predicted_eventType'] = pred_labels
#     for c in classes:
#         out[f"proba_{c}"] = proba_df[c].values

#     # Summaries
#     counts = pd.Series(pred_labels).value_counts().to_dict()

#     return jsonify({
#         "pred_counts": counts,
#         "predictions": out.to_dict(orient="records"),
#     })

# # if __name__ == "__main__":
# #     app.run(host="0.0.0.0", port=5000, debug=False)

#     app.run(host="0.0.0.0", port=5001, debug=False)
# if __name__ == "__main__":
#     app.run(host="0.0.0.0", port=5001, debug=False)










# from flask import Flask, request, jsonify
# import pandas as pd
# import numpy as np
# from catboost import CatBoostClassifier
# import joblib
# from pathlib import Path
# import logging

# from config import MODEL_PATH, LABEL_ENCODER_PATH, MODEL_FEATURES, SPEED_LIMIT_KMH

# app = Flask(__name__)
# logging.basicConfig(level=logging.INFO)
# logger = logging.getLogger("predict-api")

# # Load model & encoder
# model = CatBoostClassifier()
# model.load_model(MODEL_PATH)
# label_encoder = joblib.load(LABEL_ENCODER_PATH)

# def ensure_cols(df: pd.DataFrame) -> pd.DataFrame:
#     if 'fuel_diff' not in df.columns and {'fuelLevel','previous_fuel_level'}.issubset(df.columns):
#         df['fuel_diff'] = df['fuelLevel'] - df['previous_fuel_level']
#     if 'isOverSpeed' not in df.columns and 'speed' in df.columns:
#         df['isOverSpeed'] = df['speed'] > SPEED_LIMIT_KMH
#     if 'ignitionStatus' in df.columns:
#         df['ignitionStatus'] = df['ignitionStatus'].apply(
#             lambda v: 'ON' if str(v).upper() in ['ON','1','TRUE'] else 'OFF'
#         )
#     if 'timestamp' not in df.columns:
#         df['timestamp'] = ''
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
#     df['isOverSpeed'] = df['isOverSpeed'].astype(bool)
#     return df

# def preprocess(df: pd.DataFrame) -> pd.DataFrame:
#     df = ensure_cols(df.copy())
#     df['ignitionStatus'] = (df['ignitionStatus'].astype(str).str.upper() == 'ON').astype(int)
#     df['isOverSpeed'] = df['isOverSpeed'].astype(bool).astype(int)
#     for c in MODEL_FEATURES:
#         if c not in df.columns:
#             if c in ['ignitionStatus','isOverSpeed']:
#                 df[c] = 0
#             elif c == 'timestamp':
#                 df[c] = ''
#             else:
#                 df[c] = 0.0
#     return df[MODEL_FEATURES].copy()

# @app.route("/health", methods=["GET"])
# def health():
#     return jsonify({"status": "ok", "model": str(Path(MODEL_PATH).name)})

# @app.route("/predict", methods=["POST"])
# def predict():
#     if request.is_json:
#         payload = request.get_json(silent=True) or {}
#         records = payload.get("records")
#         if not records:
#             return jsonify({"error": "JSON must contain 'records': [{feature: value}]"}), 400
#         df_in = pd.DataFrame.from_records(records)
#     else:
#         if "file" not in request.files:
#             return jsonify({"error": "No JSON or CSV file uploaded"}), 400
#         file = request.files["file"]
#         try:
#             df_in = pd.read_csv(file)
#         except Exception as e:
#             return jsonify({"error": f"Failed to read CSV: {e}"}), 400

#     X = preprocess(df_in)
#     pred_encoded = np.array(model.predict(X)).reshape(-1)
#     pred_labels = label_encoder.inverse_transform(pred_encoded)

#     proba = model.predict_proba(X)
#     classes = list(label_encoder.classes_)
#     proba_df = pd.DataFrame(proba, columns=classes)

#     out = df_in.copy()
#     out['predicted_eventType'] = pred_labels
#     for c in classes:
#         out[f"proba_{c}"] = proba_df[c].values

#     counts = pd.Series(pred_labels).value_counts().to_dict()
#     return jsonify({
#         "pred_counts": counts,
#         "predictions": out.to_dict(orient="records"),
#     })

# if __name__ == "__main__":
#     app.run(host="0.0.0.0", port=5001, debug=False)




















