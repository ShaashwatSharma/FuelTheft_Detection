# --- START OF FILE model_runner.py ---

#!/usr/bin/env python3
"""Simple model runner utility.
- Can be invoked by cron/docker to score a CSV and produce an output.
- Calls the main predict.py script and shows its output.
"""
import argparse
import subprocess
import sys
from pathlib import Path

# Import default paths from the central config file
from config import DEFAULT_INPUT_CSV, DEFAULT_OUTPUT_CSV

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "--input",
        default=str(DEFAULT_INPUT_CSV),
        help=f"Input CSV to score (default: {DEFAULT_INPUT_CSV.name})"
    )
    ap.add_argument(
        "--output",
        default=str(DEFAULT_OUTPUT_CSV),
        help=f"Where to write predictions CSV (default: {DEFAULT_OUTPUT_CSV.name})"
    )
    args = ap.parse_args()

    # Get the path to the predict.py script in the same directory
    predict_script_path = Path(__file__).resolve().parent / "predict.py"
    
    if not predict_script_path.exists():
        print(f"Error: predict.py not found at {predict_script_path}", file=sys.stderr)
        sys.exit(1)

    # Call predict.py with the specified arguments
    cmd = [
        sys.executable,        # Use the same python interpreter
        str(predict_script_path),
        "--input", args.input,
        "--output", args.output
    ]
    print("Running command:", " ".join(cmd))

    # Run the subprocess and capture its output
    res = subprocess.run(cmd, capture_output=True, text=True, check=False)
    
    # --- Print the captured output from the predict.py script ---
    # The logging messages from predict.py will be in stderr
    if res.stderr:
        print("\n--- Logs from predict.py ---")
        print(res.stderr.strip())

    # If there's any standard output, print it too
    if res.stdout:
        print("\n--- Standard Output from predict.py ---")
        print(res.stdout.strip())
    
    # If the subprocess failed, exit with its error code
    if res.returncode != 0:
        print(f"\npredict.py exited with a non-zero status code: {res.returncode}", file=sys.stderr)
        sys.exit(res.returncode)

    print("\n--- model_runner.py finished ---")

if __name__ == "__main__":
    main()


# # --- START OF FILE model_runner.py ---

# #!/usr/bin/env python3
# """Simple model runner utility.
# - Can be invoked by cron/docker to score a CSV and produce an output.
# - Calls the main predict.py script and shows its output.
# """
# import argparse
# import subprocess
# import sys
# from pathlib import Path

# # Import default paths from the central config file
# from config import DEFAULT_INPUT_CSV, DEFAULT_OUTPUT_CSV

# def main():
#     ap = argparse.ArgumentParser()
#     ap.add_argument(
#         "--input",
#         default=str(DEFAULT_INPUT_CSV),
#         help=f"Input CSV to score (default: {DEFAULT_INPUT_CSV.name})"
#     )
#     ap.add_argument(
#         "--output",
#         default=str(DEFAULT_OUTPUT_CSV),
#         help=f"Where to write predictions CSV (default: {DEFAULT_OUTPUT_CSV.name})"
#     )
#     args = ap.parse_args()

#     # Get the path to the predict.py script in the same directory
#     predict_script_path = Path(__file__).resolve().parent / "predict.py"
    
#     if not predict_script_path.exists():
#         print(f"Error: predict.py not found at {predict_script_path}", file=sys.stderr)
#         sys.exit(1)

#     # Call predict.py with the specified arguments
#     cmd = [
#         sys.executable,        # Use the same python interpreter
#         str(predict_script_path),
#         "--input", args.input,
#         "--output", args.output
#     ]
#     print("Running command:", " ".join(cmd))

#     # Run the subprocess and capture its output
#     res = subprocess.run(cmd, capture_output=True, text=True, check=False)
    
#     # --- Print the captured output from the predict.py script ---
#     # The logging messages from predict.py will be in stderr
#     if res.stderr:
#         print("\n--- Logs from predict.py ---")
#         print(res.stderr.strip())

#     # If there's any standard output, print it too
#     if res.stdout:
#         print("\n--- Standard Output from predict.py ---")
#         print(res.stdout.strip())
    
#     # If the subprocess failed, exit with its error code
#     if res.returncode != 0:
#         print(f"\npredict.py exited with a non-zero status code: {res.returncode}", file=sys.stderr)
#         sys.exit(res.returncode)

#     print("\n--- model_runner.py finished ---")

# if __name__ == "__main__":
#     main()



















#-------------------------------------------------------------------------------------------------









# import pandas as pd
# import numpy as np
# import joblib
# from catboost import CatBoostClassifier
# from pathlib import Path
# import os

# # --- Load Model and Encoder Artefacts ---
# # This is done once when the script is imported, making predictions faster.

# # Define the paths to the saved model and encoder
# # Use the current working directory instead of __file__ in Colab
# BASE_DIR = Path(os.getcwd())
# MODEL_PATH = BASE_DIR / "model" / "/Users/shashwat/Desktop/SIDEMEN/model/catboost_model_random_tuned.cbm"
# ENCODER_PATH = BASE_DIR / "model" / "/Users/shashwat/Desktop/SIDEMEN/label_encoder.pkl"

# # Load the trained model
# print(f"Loading model from: {MODEL_PATH}")
# model = CatBoostClassifier()
# model.load_model(MODEL_PATH)

# # Load the label encoder
# print(f"Loading label encoder from: {ENCODER_PATH}")
# label_encoder = joblib.load(ENCODER_PATH)


# def predict_dataframe(df: pd.DataFrame) -> tuple[np.ndarray, pd.DataFrame]:
#     """
#     Generates predictions for an entire DataFrame.

#     Args:
#         df: A pandas DataFrame with the same raw structure as the training data.

#     Returns:
#         A tuple containing:
#         - A numpy array of predicted string labels (e.g., ['THEFT', 'NORMAL']).
#         - A pandas DataFrame of prediction probabilities for each class.
#     """
#     # Create a copy to avoid modifying the original DataFrame
#     processed_df = df.copy()

#     # --- 1. Apply the EXACT same preprocessing and feature engineering ---

#     # Handle missing values
#     processed_df.fillna({
#         'previous_fuel_level': 0,
#         'fuel_diff': 0,
#     }, inplace=True)

#     # Feature engineering from timestamp
#     processed_df['timestamp'] = pd.to_datetime(processed_df['timestamp'])
#     processed_df['hour'] = processed_df['timestamp'].dt.hour
#     processed_df['day_of_week'] = processed_df['timestamp'].dt.dayofweek
#     processed_df['is_weekend'] = processed_df['day_of_week'].isin([5, 6]).astype(int)

#     # Ensure the feature columns are in the exact same order as during training
#     # The model object itself stores the feature names it was trained on.
#     model_features = model.feature_names_
#     processed_df = processed_df[model_features]

#     # --- 2. Make Predictions ---

#     # Get encoded predictions (as numbers)
#     predictions_encoded = model.predict(processed_df)

#     # Get prediction probabilities
#     probabilities = model.predict_proba(processed_df)

#     # --- 3. Format the Output ---

#     # Convert encoded predictions back to original string labels (e.g., 0 -> 'LOW_FUEL')
#     final_labels = label_encoder.inverse_transform(predictions_encoded.flatten())

#     # Create a user-friendly DataFrame for probabilities
#     proba_df = pd.DataFrame(probabilities, columns=label_encoder.classes_)

#     return final_labels, proba_df