# Dockerfile-ml — for Python ML microservice

FROM python:3.11-slim

WORKDIR /app

# Copy and install Python dependencies
COPY src/ml/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the model code including .pkl
COPY src/ml ./src/ml

# Expose port (if Flask runs on 5000)
EXPOSE 5000

# Start Flask API
CMD ["python", "src/ml/predict_event.py"]
