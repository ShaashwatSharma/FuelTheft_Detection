# src/ml/predict_event.py
import sys
import json
import joblib
import numpy as np
from flask import Flask, request, jsonify

app = Flask(__name__)

# Load your model
model = joblib.load("src/ml/model.pkl")

@app.route('/predict', methods=['POST'])
def predict():
    try:
        data = request.get_json()
        print("📦 Input to model:", data)

        features = [
            data["fuel_diff"],
            data["speed"],
            data["location_delta"],
            data["time_delta"]
        ]

        # Convert to NumPy array with float dtype and reshape
        input_array = np.array([features], dtype=np.float64)
        prediction = model.predict(input_array)[0]

        return jsonify({"prediction": prediction})

    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)






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
