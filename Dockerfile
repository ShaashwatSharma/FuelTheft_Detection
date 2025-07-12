# FROM node:18

# WORKDIR /app

# COPY package.json ./
# COPY package-lock.json ./     
# RUN npm install

# COPY prisma ./prisma/
# RUN npx prisma generate

# COPY . .

# EXPOSE 3000
# CMD ["npm", "run", "dev"]

FROM node:18

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma/
RUN npm install

COPY . .

# Copy the .env file inside the container
COPY .env .env

# Generate Prisma client inside container
RUN npx prisma generate

CMD ["npm", "run", "dev"]
