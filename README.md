# 🛢️ Fuel-Theft Detection Backend 

A comprehensive backend system designed to monitor and detect fuel theft events in public transport vehicles using real-time IoT sensor data. The system ingests fuel level readings via MQTT, persists them in PostgreSQL using Prisma ORM, and detects suspicious events such as fuel theft or refueling using machine learning algorithms.

---

## 📖 Table of Contents

- [🚀 Features](#-features)
- [📡 API Endpoints](#-api-endpoints)
- [🛠️ Technologies Used](#-technologies-used)
- [📦 Prerequisites](#-prerequisites)
- [🔧 Installation & Setup](#-installation--setup)
- [🚀 Running the Application](#-running-the-application)
- [🧪 Data Simulation](#-data-simulation)
- [🧰 Developer Utilities](#-developer-utilities)
- [📌 Project Structure](#-project-structure)
- [🔒 Security Notes](#-security-notes)

---

## 🚀 Features

- **Real-time MQTT sensor data ingestion** - Continuous monitoring of fuel levels
- **Machine Learning-based detection** - Advanced algorithms for fuel theft and refueling detection
- **PostgreSQL with Prisma ORM** - Type-safe database operations and schema management
- **RESTful API** - Comprehensive endpoints for frontend integration
- **Dockerized environment** - Easy deployment and development setup
- **Modular architecture** - Separated concerns for maintainability
- **Real-time alerts** - Instant notification of suspicious activities
- **Historical data analysis** - Comprehensive reporting and analytics

---

## 📡 API Endpoints

### Vehicle Management
| Method | Endpoint | Description | Query Parameters |
|--------|----------|-------------|------------------|
| `GET` | `/vehicles` | Get all vehicles | None |
| `GET` | `/vehicles/:id/details` | Get detailed vehicle information | `include=alerts,events,readings&fromDate=YYYY-MM-DD&toDate=YYYY-MM-DD` |

### Fuel Usage Analytics
| Method | Endpoint | Description | Query Parameters |
|--------|----------|-------------|------------------|
| `GET` | `/fuelusage` | Get fuel usage data | `busid&startDate&endDate` |

### Sensor Monitoring
| Method | Endpoint | Description | Query Parameters |
|--------|----------|-------------|------------------|
| `GET` | `/sensor` | Get sensor status | `busid` |

### Historical Data
| Method | Endpoint | Description | Query Parameters |
|--------|----------|-------------|------------------|
| `GET` | `/history` | Get historical alerts and events | `type&fromDate&toDate` |

### Summary & Analytics
| Method | Endpoint | Description | Query Parameters |
|--------|----------|-------------|------------------|
| `GET` | `/summarymatrix` | Get summary metrics and analytics | None |

### Health Check
| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/health` | API health check |

---

## 🛠️ Technologies Used

- **Backend Framework**: Node.js + Express.js
- **Language**: TypeScript
- **Database**: PostgreSQL 15
- **ORM**: Prisma
- **Message Broker**: MQTT (Mosquitto)
- **Machine Learning**: Python ML service
- **Containerization**: Docker & Docker Compose
- **Development Tools**: nodemon, ts-node
- **Additional Libraries**: cors, dotenv, node-cron, axios

---

## 📦 Prerequisites

Before you begin, ensure you have the following installed:

- **Node.js** (v18 or higher)
- **npm** or **yarn**
- **Docker** and **Docker Compose**
- **Git**

### Installing Prerequisites

#### macOS (using Homebrew)
```bash
# Install Node.js
brew install node

# Install Docker
brew install --cask docker

# Install Git (if not already installed)
brew install git
```

## 🔧 Installation & Setup

### 1. Clone the Repository

```bash
# Clone the repository
git clone https://github.com/ShaashwatSharma/FuelTheft_Detection.git

# Navigate to the project directory
cd FuelTheft_Detection
```

### 2. Install Dependencies

```bash
# Install Node.js dependencies
npm install
```

### 3. Environment Configuration

Create the necessary environment files:

#### Create `.env` file (for local development)
```bash
# Create .env file
touch .env
```

Add the following content to `.env`:
```env
DATABASE_URL="postgresql://fueladmin:mysecretpassword@localhost:5433/fueltheftdb"
MQTT_BROKER_URL="mqtt://host.docker.internal:1883"
PORT=3000
```

#### Create `docker.env` file (for Docker services)
```bash
# Create docker.env file
touch docker.env
```

Add the following content to `docker.env`:
```env
DATABASE_URL="postgresql://fueladmin:mysecretpassword@postgres:5432/fueltheftdb"
MQTT_BROKER_URL="mqtt://mqtt:1883"
PORT=3000
```

### 4. Database Setup

```bash
# Generate Prisma client
npx prisma generate

# Run database migrations
npx prisma migrate dev
```

---

## 🚀 Running the Application

### Option 1: Using Docker Compose (Recommended)

This is the easiest way to run the entire application stack:

```bash
# Start all services
docker-compose up --build
```

This command will start:
- **PostgreSQL Database** (port 5433)
- **MQTT Broker** (port 1883)
- **Backend API** (port 3000)
- **ML Model Service** (port 5001)
- **Prisma Studio** (port 5555)

### Option 2: Running Services Individually

#### Start Database and MQTT
```bash
# Start only database and MQTT
docker-compose up postgres mqtt -d
```

#### Start Backend Service
```bash
# Run the backend in development mode
npm run dev
```

### 5. Verify Installation

Once all services are running, you can verify the installation:

```bash
# Check API health
curl http://localhost:3000/health

# Expected response: "✅ API is healthy"
```

### 6. Seed Initial Data

For first-time setup, seed the database with initial sensor and vehicle data:

```bash
# Run the seeding script
npx ts-node src/dev/seed-sensor.ts
```

---

## 🧪 Data Simulation

To simulate real-time sensor data for testing:

```bash
# Start the data simulator
npx nodemon src/simulator/publisher.ts
```

This will publish randomized fuel levels and location data to the MQTT broker every 5 seconds.

---

## 🧰 Developer Utilities

### Database Management

#### Access Prisma Studio
```bash
# Open Prisma Studio for database visualization
npx prisma studio
```
Access at: http://localhost:5555

#### Database Migrations
```bash
# Create a new migration
npx prisma migrate dev --name migration_name

# Reset database (⚠️ Destructive)
npx prisma migrate reset

# Deploy migrations to production
npx prisma migrate deploy
```

### Development Scripts

```bash
# Start development server with hot reload
npm run dev

# Build the project
npm run build

# Start production server
npm start
```

### Testing API Endpoints

You can test the API endpoints using curl or any API client:

```bash
# Get all vehicles
curl http://localhost:3000/vehicles

# Get vehicle details
curl http://localhost:3000/vehicles/1/details

# Get fuel usage
curl "http://localhost:3000/fuelusage?busid=1&startDate=2024-01-01&endDate=2024-12-31"

# Get sensor status
curl "http://localhost:3000/sensor?busid=1"

# Get summary metrics
curl http://localhost:3000/summarymatrix
```


## 🆘 Troubleshooting

### Common Issues

#### Port Already in Use
```bash
# Check what's using the port
lsof -i :3000

# Kill the process
kill -9 <PID>
```

#### Database Connection Issues
```bash
# Check if PostgreSQL is running
docker ps | grep postgres

# Restart the database
docker-compose restart postgres
```

#### MQTT Connection Issues
```bash
# Check MQTT broker status
docker logs PT-mqtt-broker

# Restart MQTT service
docker-compose restart mqtt
```

#### Prisma Issues
```bash
# Reset Prisma client
npx prisma generate

# Reset database
npx prisma migrate reset
```


