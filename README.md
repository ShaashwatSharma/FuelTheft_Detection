# 🛢️ Fuel Theft Detection Backend (PetroTrack SSD)

A backend system designed to monitor and detect fuel theft events in public transport vehicles using real-time IoT sensor data. The system ingests fuel level readings via MQTT, persists them in PostgreSQL using Prisma ORM, and detects suspicious events such as fuel theft or refueling using an algorithmic detection engine.

---

## 📖 Table of Contents

- [🚀 Features](#-features)
- [📡 API Endpoints](#-api-endpoints)
- [🛠️ Technologies Used](#-technologies-used)
- [📦 Getting Started Locally](#-getting-started-locally)
- [🧪 Data Simulation](#-data-simulation)
- [🧰 Developer Utilities](#-developer-utilities)
- [📌 Project Structure](#-project-structure)
- [📄 License](#-license)

---

## 🚀 Features

- Real-time MQTT sensor data ingestion
- Fuel theft and refueling detection algorithm
- PostgreSQL with Prisma for schema & querying
- Modular service architecture (sensor listener, detector, simulator, API)
- Dockerized development environment
- REST API for frontend integration

---

## 📡 API Endpoints

| Method | Endpoint                      | Description                                         | Response Example |
|--------|-------------------------------|-----------------------------------------------------|------------------|
| `GET`  | `/dashboard`                  | Returns data for dashboard (buses, alerts, stats)   | `{ totalBuses, activeAlerts, thefts, refuels, topBuses[] }` |
| `GET`  | `/buses/:id/details`          | Returns detailed info about a single bus            | `{ id, registrationNo, route, fuelLevel, driver, status, readings[] }` |
| `GET`  | `/alerts`                     | Returns recent high-priority alerts                 | `[{ id, type, busId, timestamp, severity }]` |
| `GET`  | `/alerts/all`                 | Returns full alert history                          | `[{ id, type, busId, timestamp, severity }]` |
| `GET`  | `/stats/summary`              | Returns system-wide statistics                      | `{ totalBuses, totalEvents, totalSensors, uptime }` |
| `GET`  | `/health`                     | Health check route                                  | `"✅ API is healthy"` |

---

## 🧰 Technologies Used

- **Node.js + Express** — REST API & server logic
- **TypeScript** — Strong typing and maintainability
- **MQTT (Mosquitto)** — Lightweight messaging for sensor communication
- **PostgreSQL** — Reliable relational database
- **Prisma ORM** — Type-safe database access
- **Docker & Docker Compose** — Containerized development and deployment
- **ts-node + nodemon** — Development server
- **cron + anomaly detection logic** — Periodic background event classification

---

## 📦 Getting Started Locally

### 1. Clone the Repo

```bash
git clone https://github.com/your-org/FuelTheft-bknd-Draft-01.git
cd FuelTheft-bknd-Draft-01
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Create `.env` File & `docker.env`

<!-- ```bash
cp .env.example .env
``` -->

Then edit `.env` and set:

```.env
DATABASE_URL="postgresql://fueladmin:mysecretpassword@localhost:5433/fueltheftdb"
MQTT_BROKER_URL="mqtt://host.docker.internal:1883"
```
Then edit `docker.env` and set:

```docker.env
DATABASE_URL="postgresql://fueladmin:mysecretpassword@postgres:5432/fueltheftdb"
```


> Use `mqtt://mqtt:1883` if you're inside the Docker container.

### 4. Start All Services with Docker

```bash
docker-compose up --build
```

This launches:
- PostgreSQL DB (`fueltheftdb`)
- MQTT Broker (Mosquitto)
- Backend API service (Node + MQTT listener + event detector)

---

## 🧪 Data Simulation

To simulate live sensor data:

```bash
npx nodemon src/simulator/publisher.ts
```

This will publish randomized fuel levels and location data to the MQTT broker every 5 seconds.

---

## 🧰 Developer Utilities

### 🌱 Initial Sensor Seeding (Required Once)

If you're running the backend for the first time:

```bash
npx ts-node src/dev/seed-sensor.ts
```

This will insert a test sensor (`SIM-SENSOR-001`) and a test vehicle into your database.

### 🧬 Access Prisma Studio

To visually explore DB:

```bash
npx prisma studio
```

---

## 📁 Project Structure

```
src/
├── api/                   # REST API routes
├── dev/                   # Dev seed scripts
├── lib/                   # DB connector (Prisma)
├── mqtt/                  # MQTT listener
├── processor/             # Event detection logic
├── simulator/             # Sensor data publisher
├── index.ts               # Main entrypoint
prisma/
├── schema.prisma          # DB schema
.env                       # Environment variables
docker.env                       # Docker Environment variables
docker-compose.yml         # Dev services
Dockerfile                 # Backend container config
```

---


