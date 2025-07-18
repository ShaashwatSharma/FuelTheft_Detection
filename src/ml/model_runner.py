# src/ml/model_runner.py

import json
import pandas as pd
import joblib

# Load model and label encoder
model = joblib.load("src/ml/model.pkl")
label_encoder = joblib.load("src/ml/fuel_event_label_encoder_with_noise.pkl")

def run_prediction(input_data):
    # Parse timestamp to extract hour and minute
    timestamp = pd.to_datetime(input_data["timestamp"])
    hour = timestamp.hour
    minute = timestamp.minute

    # Calculate fuel delta
    fuel_delta = input_data["previous_fuel_level"] - input_data["fuelLevel"]

    # Create DataFrame with required features
    df = pd.DataFrame([{
        "fuelLevel": input_data["fuelLevel"],
        "previous_fuel_level": input_data["previous_fuel_level"],
        "distanceKm": input_data["distanceKm"],
        "locationLat": input_data["locationLat"],
        "locationLong": input_data["locationLong"],
        "hour": hour,
        "minute": minute,
        "fuel_delta": fuel_delta,
    }])

    # Predict and decode label
    prediction_encoded = model.predict(df)[0]
    prediction_label = label_encoder.inverse_transform([prediction_encoded])[0]
    print("🔎 Encoded prediction:", prediction_encoded)
    print("🔎 Decoded prediction:", prediction_label)

    return prediction_label








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
