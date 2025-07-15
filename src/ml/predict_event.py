# # src/ml/predict_event.py

# import sys
# import json
# import joblib
# import numpy as np

# # Load the model and encoders
# bundle = joblib.load("fuel_event_model_from_predicted_data.pkl")
# model = bundle["model"]
# le_event = bundle["le_event"]

# def main():
#     try:
#         input_data = json.loads(sys.stdin.read())

#         # Extract features from input
#         features = [
#             input_data["fuel_diff"],       # float
#             input_data["speed"],           # float
#             input_data["location_delta"],  # float
#             input_data["time_delta"],      # float (in seconds)
#         ]

#         # Predict and decode label
#         prediction = model.predict([features])[0]
#         label = le_event.inverse_transform([prediction])[0]

#         print(json.dumps({"prediction": label}))

#     except Exception as e:
#         print(json.dumps({"error": str(e)}))
#         sys.exit(1)

# if __name__ == "__main__":
#     main()
