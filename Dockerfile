# Dockerfile

FROM node:18

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN npm install -g ts-node nodemon
# RUN npm run build || true  # Safe fallback if no build script

CMD ["npm", "run", "dev"]





# # Dockerfile

# FROM node:18

# # Install Python
# RUN apt-get update && \
#     apt-get install -y python3 python3-pip python3-venv && \
#     apt-get clean

# # Set working directory
# WORKDIR /app

# # Copy Node dependencies and install
# COPY package*.json ./
# RUN npm install

# # Copy the rest of your code
# COPY . .

# # Install Python packages inside a virtual environment
# RUN python3 -m venv /opt/venv
# ENV PATH="/opt/venv/bin:$PATH"
# COPY src/ml/requirements.txt ./src/ml/requirements.txt
# RUN pip install --no-cache-dir -r ./src/ml/requirements.txt

# # Install global Node tools
# RUN npm install -g ts-node nodemon

# # Run the app
# CMD ["npm", "run", "dev"]














