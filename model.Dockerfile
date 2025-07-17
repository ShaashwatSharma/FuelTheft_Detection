# model.Dockerfile

FROM python:3.9-slim

WORKDIR /app

# Copy requirements and install
COPY src/ml/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy your model code
COPY src/ml ./src/ml

# Set env variables for Flask
# ENV FLASK_APP=src/ml/predict_event.py
ENV FLASK_APP=src/ml/app.py


# Expose Flask port
EXPOSE 5000

# Run the Flask app
# CMD ["flask", "run", "--host=0.0.0.0"]
CMD ["flask", "run", "--host=0.0.0.0", "--port=5000"]




# FROM python:3.11-slim

# WORKDIR /app

# # Copy requirements and install
# COPY src/ml/requirements.txt ./requirements.txt
# RUN pip install --no-cache-dir -r requirements.txt

# # Copy the model code
# COPY src/ml ./src/ml

# # Set environment variables
# ENV FLASK_APP=src/ml/predict_event.py

# # Expose port
# EXPOSE 5000

# # Run app
# CMD ["python", "src/ml/predict_event.py"]
