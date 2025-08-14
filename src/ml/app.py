# src/ml/app.py
from flask import Flask, request, jsonify, send_file
import pandas as pd
import joblib
import os

from src.ml.model_runner import run_prediction  # <-- this now resolves

app = Flask(__name__)

@app.get("/health")
def health():
    return jsonify({"status": "ok"}), 200

@app.post("/predict")
def predict_json():
    try:
        if not request.is_json:
            return jsonify({"error": "Expected application/json body"}), 400
        payload = request.get_json()
        pred = run_prediction(payload)
        if isinstance(pred, str) and pred.startswith("Error:"):
            return jsonify({"error": pred}), 500
        return jsonify({"prediction": str(pred)}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.post("/predict-file")
def predict_file():
    try:
        file = request.files.get("file")
        if file is None:
            return jsonify({"error": "Missing file in multipart/form-data"}), 400
        df = pd.read_csv(file)
        model_path = "src/ml/xgb_vehicle_event_augmented.joblib"
        mdl = joblib.load(model_path)
        if isinstance(mdl, dict):
            pipe = mdl.get("pipeline")
            if pipe is None:
                return jsonify({"error": "Model bundle missing 'pipeline'"}), 500
            preds = pipe.predict(df)
        else:
            preds = mdl.predict(df)
        df["predicted_event"] = preds
        out_path = "predicted_output.csv"
        df.to_csv(out_path, index=False)
        return send_file(out_path, as_attachment=True)
    except Exception as e:
        return jsonify({"error": str(e)}), 400

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)























# from flask import Flask, request, jsonify
# from model_runner import run_prediction

# app = Flask(__name__)

# @app.route("/predict", methods=["POST"])
# def predict():
#     try:
#         data = request.get_json()
#         prediction = run_prediction(data)
#         return jsonify({"prediction": prediction})
#     except Exception as e:
#         return jsonify({"error": str(e)}), 500
