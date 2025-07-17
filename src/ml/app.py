# src/ml/app.py

from flask import Flask, request, jsonify
from model_runner import run_prediction

app = Flask(__name__)

@app.route("/predict", methods=["POST"])
def predict():
    try:
        data = request.get_json()
        prediction = run_prediction(data)
        return jsonify({"prediction": prediction})
    except Exception as e:
        return jsonify({"error": str(e)}), 500
