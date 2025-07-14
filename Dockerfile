# Dockerfile

FROM node:18

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN npm install -g ts-node nodemon
# RUN npm run build || true  # Safe fallback if no build script

CMD ["npm", "run", "dev"]
