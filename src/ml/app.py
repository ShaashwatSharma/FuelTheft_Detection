# # src/ml/app.py

import os
import pandas as pd
import joblib
from flask import Flask, request, jsonify
from catboost import CatBoostClassifier

# --- 1. Define paths relative to the current working directory ---
# Use the current working directory instead of __file__ in Colab
BASE_DIR = os.getcwd()
MODEL_PATH = os.path.join(BASE_DIR, "src/ml/catboost_model_random_tuned.cbm") # Corrected path
LABEL_ENCODER_PATH = os.path.join(BASE_DIR, "src/ml/label_encoder.pkl") # Corrected path

# --- 2. Load the CatBoost model ---
model = CatBoostClassifier()
if os.path.exists(MODEL_PATH):
    model.load_model(MODEL_PATH)
    print(f"Model loaded successfully from {MODEL_PATH}")
else:
    raise FileNotFoundError(f"Model file not found at {MODEL_PATH}")

# --- 3. Load the LabelEncoder ---
if os.path.exists(LABEL_ENCODER_PATH):
    label_encoder = joblib.load(LABEL_ENCODER_PATH)
    print(f"LabelEncoder loaded successfully from {LABEL_ENCODER_PATH}")
else:
    raise FileNotFoundError(f"LabelEncoder file not found at {LABEL_ENCODER_PATH}")

# --- 4. Define Flask app ---
app = Flask(__name__)

# --- 5. Prediction endpoint ---
@app.route('/predict', methods=['POST'])
def predict():
    try:
        if not request.is_json:
            return jsonify({"error": "Expected application/json body"}), 400
        
        data = request.get_json()
        
        # Validate required fields
        required_fields = ['fuelLevel', 'previous_fuel_level', 'distanceKm', 'locationLat', 
                          'locationLong', 'speed', 'ignitionStatus', 'isOverSpeed', 
                          'odometer', 'deviceVoltage', 'topic', 'timestamp']
        
        for field in required_fields:
            if field not in data:
                return jsonify({"error": f"Missing required field: {field}"}), 400
        
        # Convert request to DataFrame
        df = pd.DataFrame([data])
        
        # Add time-based features
        timestamp = pd.to_datetime(data['timestamp'])
        df['hour'] = timestamp.hour
        df['day_of_week'] = timestamp.dayofweek
        df['is_weekend'] = int(timestamp.dayofweek in [5, 6])
        
        # Calculate fuel_diff
        df['fuel_diff'] = data['fuelLevel'] - data['previous_fuel_level']
        
        # Ensure we have all required features
        required_features = model.feature_names_
        for feature in required_features:
            if feature not in df.columns:
                df[feature] = 0  # Default value for missing features
        
        # Select only the features the model expects
        df = df[required_features]
        
        # Predict
        pred_encoded = model.predict(df)
        pred_labels = label_encoder.inverse_transform(pred_encoded.flatten())
        
        return jsonify({"prediction": str(pred_labels[0])})
    except Exception as e:
        print(f"Prediction error: {e}")
        return jsonify({"error": str(e)}), 500

# --- 6. Health endpoint ---
@app.route('/health', methods=['GET'])
def health():
    return jsonify({"status": "ok"})

# --- 7. Root endpoint ---
@app.route('/', methods=['GET'])
def root():
    return jsonify({"message": "Vehicle Event Prediction API is running."})

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=False)
