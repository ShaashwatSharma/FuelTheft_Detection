import pandas as pd
import numpy as np
import joblib
from catboost import CatBoostClassifier
from pathlib import Path
import os

# --- Load Model and Encoder Artefacts ---
# This is done once when the script is imported, making predictions faster.

# Define the paths to the saved model and encoder
# Use the current working directory instead of __file__ in Colab
BASE_DIR = Path(os.getcwd())
MODEL_PATH = BASE_DIR / "model" / "src/ml/catboost_model_random_tuned.cbm"
ENCODER_PATH = BASE_DIR / "model" / "src/ml/label_encoder.pkl"

# Load the trained model
print(f"Loading model from: {MODEL_PATH}")
model = CatBoostClassifier()
model.load_model(MODEL_PATH)

# Load the label encoder
print(f"Loading label encoder from: {ENCODER_PATH}")
label_encoder = joblib.load(ENCODER_PATH)


def predict_dataframe(df: pd.DataFrame) -> tuple[np.ndarray, pd.DataFrame]:
    """
    Generates predictions for an entire DataFrame.

    Args:
        df: A pandas DataFrame with the same raw structure as the training data.

    Returns:
        A tuple containing:
        - A numpy array of predicted string labels (e.g., ['THEFT', 'NORMAL']).
        - A pandas DataFrame of prediction probabilities for each class.
    """
    # Create a copy to avoid modifying the original DataFrame
    processed_df = df.copy()

    # --- 1. Apply the EXACT same preprocessing and feature engineering ---

    # Handle missing values
    processed_df.fillna({
        'previous_fuel_level': 0,
        'fuel_diff': 0,
    }, inplace=True)

    # Feature engineering from timestamp
    processed_df['timestamp'] = pd.to_datetime(processed_df['timestamp'])
    processed_df['hour'] = processed_df['timestamp'].dt.hour
    processed_df['day_of_week'] = processed_df['timestamp'].dt.dayofweek
    processed_df['is_weekend'] = processed_df['day_of_week'].isin([5, 6]).astype(int)

    # Ensure the feature columns are in the exact same order as during training
    # The model object itself stores the feature names it was trained on.
    model_features = model.feature_names_
    processed_df = processed_df[model_features]

    # --- 2. Make Predictions ---

    # Get encoded predictions (as numbers)
    predictions_encoded = model.predict(processed_df)

    # Get prediction probabilities
    probabilities = model.predict_proba(processed_df)

    # --- 3. Format the Output ---

    # Convert encoded predictions back to original string labels (e.g., 0 -> 'LOW_FUEL')
    final_labels = label_encoder.inverse_transform(predictions_encoded.flatten())

    # Create a user-friendly DataFrame for probabilities
    proba_df = pd.DataFrame(probabilities, columns=label_encoder.classes_)

    return final_labels, proba_df









# # src/ml/model_runner.py
# import os
# from pathlib import Path
# import pandas as pd
# import joblib
# from typing import Any, Dict

# DEFAULT_MODEL_NAME = "src/ml/xgb_vehicle_event_augmented.joblib"

# def _resolve_model_path() -> Path:
#     candidates = [
#         Path.cwd() / DEFAULT_MODEL_NAME,
#         Path("/content/") / DEFAULT_MODEL_NAME,
#         Path("src/ml/xgb_vehicle_event_augmented.joblib"),
#     ]
#     for c in candidates:
#         try:
#             if c.is_file():
#                 return c
#         except Exception:
#             pass
#     raise FileNotFoundError(f"Could not find model file '{DEFAULT_MODEL_NAME}' in {os.getcwd()}.")

# try:
#     MODEL_PATH = _resolve_model_path()
#     _loaded = joblib.load(MODEL_PATH)
#     # Support either a plain pipeline or a dict bundle
#     if isinstance(_loaded, dict):
#         pipeline = _loaded.get("pipeline")
#         label_encoder = _loaded.get("label_encoder")
#         features = _loaded.get("features_in_", None)
#     else:
#         pipeline = _loaded
#         label_encoder = None
#         features = None
#     if pipeline is None:
#         raise ValueError("Loaded model bundle has no 'pipeline'.")
# except Exception as e:
#     print(f"[ERROR] Failed to load model: {e}")
#     pipeline = None
#     label_encoder = None
#     features = None

# def run_prediction(input_data: Dict[str, Any]):
#     """
#     input_data expects (at least):
#       fuelLevel, previous_fuel_level, distanceKm, locationLat, locationLong,
#       speed, ignitionStatus, isOverSpeed (bool-ish)
#     We also compute fuel_diff = fuelLevel - previous_fuel_level (0 if missing).
#     """
#     if pipeline is None:
#         return "Error: Model not loaded"

#     # Fallback expected feature list if bundle didn't include one
#     expected_features = features or [
#         "fuelLevel", "previous_fuel_level", "distanceKm", "locationLat",
#         "locationLong", "speed", "ignitionStatus", "isOverSpeed", "fuel_diff"
#     ]

#     prev = input_data.get("previous_fuel_level")
#     curr = input_data.get("fuelLevel")
#     try:
#         calculated_fuel_diff = (float(curr) if curr is not None else 0.0) - (float(prev) if prev is not None else 0.0)
#     except Exception:
#         calculated_fuel_diff = 0.0

#     row_data = {k: input_data.get(k, None) for k in expected_features}
#     row_data["fuel_diff"] = calculated_fuel_diff

#     # Normalize types
#     if "ignitionStatus" in row_data:
#         row_data["ignitionStatus"] = str(row_data.get("ignitionStatus", "Unknown"))
#     if "isOverSpeed" in row_data:
#         row_data["isOverSpeed"] = bool(row_data.get("isOverSpeed", False))

#     df = pd.DataFrame([row_data])

#     pred_encoded = pipeline.predict(df)[0]
#     if label_encoder is not None:
#         pred_label = label_encoder.inverse_transform([pred_encoded])[0]
#     else:
#         pred_label = pred_encoded

#     print("🔎 Prediction:", pred_label)
#     return str(pred_label)



















# import pandas as pd
# import joblib
# # Load the trained XGBoost model
# MODEL_PATH = "src/ml/xgb_vehicle_event_augmented.joblib"
# model = joblib.load(MODEL_PATH)
# def run_prediction(input_data):
#     """
#     Runs a prediction for a single input row (dictionary of features).
#     """
#     # Parse timestamp to extract hour and minute
#     timestamp = pd.to_datetime(input_data["timestamp"])
#     hour = timestamp.hour
#     minute = timestamp.minute
#     # Calculate fuel delta
#     fuel_delta = input_data["previous_fuel_level"] - input_data["fuelLevel"]
#     # Create DataFrame with required features
#     df = pd.DataFrame([{
#         "fuelLevel": input_data["fuelLevel"],
#         "previous_fuel_level": input_data["previous_fuel_level"],
#         "distanceKm": input_data["distanceKm"],
#         "locationLat": input_data["locationLat"],
#         "locationLong": input_data["locationLong"],
#         "hour": hour,
#         "minute": minute,
#         "fuel_delta": fuel_delta,
#     }])
#     # Predict label
#     prediction_label = model.predict(df)[0]
#     print(":magnifying_glass_right: Prediction:", prediction_label)
#     return prediction_label















# # src/ml/model_runner.py

# import pandas as pd
# import joblib

# model = joblib.load("src/ml/model.pkl")
# label_encoder = joblib.load("src/ml/model.pkl")

# def run_prediction(input_data):
#     # Parse timestamp
#     timestamp = pd.to_datetime(input_data["timestamp"])
#     hour = timestamp.hour
#     minute = timestamp.minute

#     # Calculate fuel_delta
#     fuel_delta = input_data["previous_fuel_level"] - input_data["fuelLevel"]

#     # Create DataFrame with correct feature names
#     df = pd.DataFrame([{
#         "fuelLevel": input_data["fuelLevel"],
#         "previous_fuel_level": input_data["previous_fuel_level"],
#         "distanceKm": input_data.get("distanceKm", 0),
#         "locationLat": input_data.get("locationLat", 0),
#         "locationLong": input_data.get("locationLong", 0),
#         "hour": hour,
#         "minute": minute,
#         "fuel_delta": fuel_delta,
#     }])

#     # Predict and decode
#     prediction_encoded = model.predict(df)[0]
#     prediction = label_encoder.inverse_transform([prediction_encoded])[0]

#     return prediction
















# # src/ml/model_runner.py

# import pandas as pd
# import joblib

# # Load model and label encoder
# model = joblib.load("src/ml/model.pkl")
# label_encoder = joblib.load("src/ml/model.pkl")

# def run_prediction(input_data):
#     # Build DataFrame exactly with provided fields
#     df = pd.DataFrame([{
#         "fuelLevel": input_data["fuelLevel"],
#         "previous_fuel_level": input_data["previous_fuel_level"],
#         "distanceKm": input_data["distanceKm"],
#         "locationLat": input_data["locationLat"],
#         "locationLong": input_data["locationLong"],
#         "timestamp": input_data["timestamp"]
#     }])

#     # Predict and decode label
#     encoded_prediction = model.predict(df)[0]
#     prediction = label_encoder.inverse_transform([encoded_prediction])[0]

#     return prediction































# # src/ml/model_runner.py

# import sys
# import json
# import pandas as pd
# import joblib

# model = joblib.load("src/ml/fuel_event_model_noisy.pkl")

# def run_prediction(input_data):
#     df = pd.DataFrame([{
#         "bus_id": input_data["bus_id"],
#         "sensor_id":input_data["sensor_id"],
#         "fuel_level": float(input_data["fuel_level"]),
#         "fuel_drop": float(input_data["fuel_drop"]),
#         "hour": int(input_data["hour"]),
#         "minute": int(input_data["minute"]),
#     }])
#     return model.predict(df)[0]













# # src/ml/predict_event.py
# import sys
# import json
# import joblib
# import numpy as np
# from flask import Flask, request, jsonify

# app = Flask(__name__)

# # Load your model
# model = joblib.load("src/ml/model.pkl")

# @app.route('/predict', methods=['POST'])
# def predict():
#     try:
#         data = request.get_json()
#         print("📦 Input to model:", data)
    
#         features = [
#             data["fuel_diff"],
#             data["speed"],
#             data["location_delta"],
#             data["time_delta"]
#         ]

#         # Convert to NumPy array with float dtype and reshape
#         input_array = np.array([features], dtype=np.float64)
#         prediction = model.predict(input_array)[0]

#         return jsonify({"prediction": prediction})

#     except Exception as e:
#         return jsonify({"error": str(e)}), 500

# if __name__ == '__main__':
#     app.run(host='0.0.0.0', port=5000, debug=True)






# # src/ml/predict_event.py
# import sys
# import json
# import joblib
# import numpy as np
# from flask import Flask, request, jsonify

# app = Flask(__name__)

# # Load your model
# model = joblib.load("src/ml/model.pkl")

# @app.route('/predict', methods=['POST'])
# def predict():
#     try:
#         data = request.get_json()
#         print("📦 Input to model:", data)
#         features = [
#             data["fuel_diff"],
#             data["speed"],
#             data["location_delta"],
#             data["time_delta"]
#         ]

#         prediction = model.predict([features])[0]
#         return jsonify({"prediction": prediction})
    
#     except Exception as e:
#         return jsonify({"error": str(e)}), 500

# if __name__ == '__main__':
#     app.run(host='0.0.0.0', port=5000, debug=True)




# # src/ml/predict_event.py
# import sys
# import json
# import joblib
# import numpy as np

# # Load directly
# model = joblib.load("src/ml/model.pkl")
# bundle = joblib.load("src/ml/model.pkl")
# print("Type of bundle:", type(bundle))
# print("Bundle contents:", bundle)


# # Optional: if needed
# # le_event = joblib.load("src/ml/label_encoder.pkl")

# def main():
#     try:
#         input_data = json.loads(sys.stdin.read())
#         features = [
#             input_data["fuel_diff"],
#             input_data["speed"],
#             input_data["location_delta"],
#             input_data["time_delta"],
#         ]

#         prediction = model.predict([features])[0]

#         # Optional decoding
#         # label = le_event.inverse_transform([prediction])[0]
#         print(json.dumps({"prediction": prediction}))

#     except Exception as e:
#         print(json.dumps({"error": str(e)}))
#         sys.exit(1)

# if __name__ == "__main__":
#     main()




# import sys
# import json
# import joblib
# import numpy as np

# # Load model bundle
# bundle = joblib.load("src/ml/model.pkl")
# model = bundle["model"]

# def main():
#     try:
#         input_data = json.loads(sys.stdin.read())

#         features = [
#             input_data["fuel_diff"],
#             input_data["speed"],
#             input_data["location_delta"],
#             input_data["time_delta"]
#         ]

#         prediction = model.predict([features])[0]
#         print(json.dumps({"prediction": prediction}))
#     except Exception as e:
#         print(json.dumps({"error": str(e)}))
#         sys.exit(1)

# if __name__ == "__main__":
#     main()
