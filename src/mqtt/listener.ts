// src/mqtt/listener.ts
import mqtt from 'mqtt';
import prisma from '../lib/prisma';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { 
  levelToLiters, 
  isValidFuelReading, 
  DEFAULT_CALIBRATION, 
  extractCalibrationArrays 
} from '../utils/fuelCalibration';

dotenv.config();

/** ---------- Thing Configuration ---------- */

// Define your 5 AWS IoT Things and their configurations
const THING_CONFIGS = [
  {
    thingName: 'FMB920_Bus1',  // Your actual Thing name
    topic: '353691844334010/data',  // Your actual IMEI
    certPath: 'cert/thing1'
  },
  {
    thingName: 'FMB920_Bus2',  // Your second Thing name
    topic: '353691842778101/data',  // Your second IMEI
    certPath: 'cert/thing2'
  },
  {
    thingName: 'FMB920_Bus3',  // Your third Thing name
    topic: '353691842777921/data',  // Your third IMEI
    certPath: 'cert/thing3'
  },
  {
    thingName: 'FMB920_Bus4',  // Your fourth Thing name
    topic: '353691844382142/data',  // Your fourth IMEI
    certPath: 'cert/thing4'
  },
  {
    thingName: 'FMB920_Bus5',  // Your fifth Thing name
    topic: '353691844371830/data',  // Your fifth IMEI
    certPath: 'cert/thing5'
  }
];

// AWS IoT Core MQTT connection options for a specific Thing
const createMqttOptions = (thingConfig: typeof THING_CONFIGS[0]): mqtt.IClientOptions => {
  const certDir = path.join(__dirname, '..', '..', thingConfig.certPath);
  
  try {
    // Find the actual certificate files with hexadecimal prefixes
    const files = fs.readdirSync(certDir);
    const privateKeyFile = files.find(f => f.endsWith('-private.pem.key'));
    const certificateFile = files.find(f => f.endsWith('-certificate.pem.crt'));
    const rootCAFile = 'AmazonRootCA1.pem'; // This one has a fixed name
    
    if (!privateKeyFile || !certificateFile) {
      throw new Error(`Missing certificate files in ${certDir}`);
    }
    
    return {
      clientId: thingConfig.thingName,
      key: fs.readFileSync(path.join(certDir, privateKeyFile)),
      cert: fs.readFileSync(path.join(certDir, certificateFile)),
      ca: fs.readFileSync(path.join(certDir, rootCAFile)),
  protocol: 'mqtts',
    rejectUnauthorized: true,
    keepalive: 60,
    reconnectPeriod: 3000,
  };
} catch (err) {
    console.error(`❌ Certificate files not found for ${thingConfig.thingName}:`, err);
    throw new Error(`Missing certificates for ${thingConfig.thingName}`);
  }
};

const brokerUrl = process.env.AWS_MQTT_ENDPOINT
  ? `mqtts://${process.env.AWS_MQTT_ENDPOINT}:8883`
  : 'mqtt://localhost:1883';

console.log('🔧 ENV: { endpoint:%s }', process.env.AWS_MQTT_ENDPOINT);
console.log(`🔗 Connecting to ${brokerUrl}`);

/** ---------- MQTT Client Management ---------- */

const clients: { [thingName: string]: mqtt.MqttClient } = {};

// Create and manage MQTT connections for each Thing
const createThingConnection = (thingConfig: typeof THING_CONFIGS[0]) => {
  const mqttOptions = createMqttOptions(thingConfig);
const client = mqtt.connect(brokerUrl, mqttOptions);

client.on('connect', () => {
    console.log(`✅ Connected ${thingConfig.thingName} to ${brokerUrl}`);
    client.subscribe(thingConfig.topic, (err) => {
      if (err) {
        console.error(`❌ Subscription error for ${thingConfig.thingName}:`, err);
      } else {
        console.log(`📡 ${thingConfig.thingName} subscribed to: ${thingConfig.topic}`);
      }
  });
});

  client.on('error', (err) => {
    console.error(`❌ MQTT error for ${thingConfig.thingName}:`, err);
  });

  client.on('close', () => {
    console.log(`🔌 MQTT connection closed for ${thingConfig.thingName}`);
  });

  client.on('message', (topic, buf) => {
    handleMessage(thingConfig, topic, buf);
  });

  clients[thingConfig.thingName] = client;
  return client;
};

// Initialize all Thing connections
const initializeConnections = () => {
  console.log('🚀 Initializing connections for 5 FMB920 Things...');
  
  THING_CONFIGS.forEach(thingConfig => {
    try {
      createThingConnection(thingConfig);
    } catch (err) {
      console.error(`❌ Failed to create connection for ${thingConfig.thingName}:`, err);
    }
  });
  
  console.log(`✅ Initialized ${Object.keys(clients).length} connections`);
};

/** ---------- FMB920 Data Processing ---------- */

const isNil = (v: any) => v === null || v === undefined;

const toFloat = (v: any): number | null => {
  if (isNil(v)) return null;
  const s = (typeof v === 'string') ? v.trim() : v;
  if (s === '' || s === '-' || s === 'nill') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const toBool = (v: any): boolean | null => {
  if (isNil(v)) return null;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  if (['y', 'yes', 'true', '1'].includes(s)) return true;
  if (['n', 'no', 'false', '0'].includes(s)) return false;
  return null;
};

const normalizeIgnition = (v: any): 'ON' | 'OFF' | null => {
  if (isNil(v)) return null;
  const s = String(v).trim().toLowerCase();
  if (s.includes('on')) return 'ON';
  if (s.includes('off')) return 'OFF';
  // FMB920 sends 1/0
  if (['1', 'true', 'y', 'yes'].includes(s)) return 'ON';
  if (['0', 'false', 'n', 'no'].includes(s)) return 'OFF';
  return null;
};

const fromMsOrSec = (date?: any, dateSec?: any, fallback?: any): Date => {
  const ms = toFloat(date);
  if (ms && ms > 10_000_000_000) return new Date(ms); // already ms
  const sec = toFloat(dateSec) ?? (ms && ms < 10_000_000_000 ? ms : null);
  if (sec) return new Date(sec * 1000);
  const fb = toFloat(fallback);
  if (fb) return new Date(fb);
  return new Date(); // last resort
};

/** FMB920 specific data extraction */
const fromFMB920 = (data: any) => {
  // Extract timestamp from FMB920 data
  const timestamp = data?.ts ? new Date(data.ts) : new Date();
  
  // Validate fuel reading before processing
  const isValidReading = isValidFuelReading(data);
  
  // Fuel level calibration (parameter 241) - convert raw to liters
  let fuelLevel = null;
  if (isValidReading) {
    const raw241 = toFloat(data?.['241']);
    if (raw241 !== null && !isNaN(raw241)) {
      const { levels, liters } = extractCalibrationArrays(DEFAULT_CALIBRATION);
      fuelLevel = levelToLiters(raw241, levels, liters);
      
      // Log calibration for debugging
      console.log(`🔧 Fuel Calibration: Raw=${raw241} → ${fuelLevel?.toFixed(2)}L`);
    }
  }
  
  // Location conversion (FMB920 format) - coordinates already in decimal degrees
  const latRaw = toFloat(data?.['66']);
  const lngRaw = toFloat(data?.['67']);
  const locationLat = latRaw ? latRaw : null;
  const locationLong = lngRaw ? lngRaw : null;
  
  // Speed (parameter 21) - save ALL values
  const speed = toFloat(data?.['21']);
  
  // Ignition status (parameter 1) - save ALL values
  const ignitionStatus = normalizeIgnition(data?.['1']);
  
  // Odometer (parameter 16 or 241) - save ALL values
  const odometerKm = toFloat(data?.['16']) || toFloat(data?.['241']);
  
  // Device voltage (if available) - save ALL values
  const deviceVoltage = null; // FMB920 doesn't provide this
  
  // Over speed detection (if available) - save ALL values
  const isOverSpeed = toBool(data?.isOverSpeed) ?? null;
  
  return {
    timestamp,
    fuelLevel,
    locationLat,
    locationLong,
    speed,
    ignitionStatus,
    odometerKm,
    deviceVoltage,
    address: null,
    isOverSpeed,
  };
};

/** Extract vehicle identity from FMB920 data */
const extractVehicleIdentity = (payload: any, sensorCode: string, thingName: string) => {
  const body = (payload?.state?.reported) ? payload.state.reported : payload;

  // Try to extract vehicle info from FMB920 data
  // You might need to add vehicle mapping logic here
  const regNo = [body?.regNo, body?.vehicleId, body?.vehicleName]
    .map((v: any) => (typeof v === 'string' ? v.trim() : ''))
    .find((s: string) => s.length > 0);

  return {
    registrationNo: regNo || `${thingName}-${sensorCode}`, // Use Thing name as prefix
    externalVehicleId: (typeof body?.vehicleId === 'string' && body.vehicleId.trim().length > 0)
      ? body.vehicleId.trim()
      : null,
  };
};

/** Upsert (idempotent) Vehicle + Sensor and return both (transaction-safe) */
const getOrCreateVehicleAndSensor = async (sensorCode: string, payload: any, thingName: string) => {
  const { registrationNo, externalVehicleId } = extractVehicleIdentity(payload, sensorCode, thingName);

  return prisma.$transaction(async (tx) => {
    // Try to find vehicle by registrationNo; if not exist, create.
    let vehicle = await tx.vehicle.findUnique({ where: { registrationNo } });
    if (!vehicle) {
      // Get default mileage from similar vehicles or use standard default
      const similarVehicle = await tx.vehicle.findFirst({
        where: { 
          model: 'FMB920 GPS Tracker',
          mileageEst: { not: null }
        },
        orderBy: { createdAt: 'desc' }
      });
      
      const defaultMileage = similarVehicle?.mileageEst ?? 3.5; // Standard default
      
      vehicle = await tx.vehicle.create({
        data: {
          registrationNo,
          externalVehicleId: externalVehicleId ?? undefined,
          model: 'FMB920 GPS Tracker',
          tankSize: null,
          mileageEst: defaultMileage, // Use real default instead of null
        },
      });
      console.log(`🚚 Created Vehicle: ${registrationNo} with default mileage: ${defaultMileage} km/L`);
    } else if (externalVehicleId && vehicle.externalVehicleId !== externalVehicleId) {
      // Keep external id in sync (optional)
      vehicle = await tx.vehicle.update({
        where: { id: vehicle.id },
        data: { externalVehicleId },
      });
    }

    // Upsert sensor by sensorCode (IMEI) and attach to vehicle
    let sensor = await tx.sensor.findUnique({ where: { sensorCode } });
    if (!sensor) {
      sensor = await tx.sensor.create({
        data: {
          sensorCode,
          isActive: true,
          status: 'OK',
          vehicleId: vehicle.id,
          lastSeen: new Date(),
        },
      });
      console.log('🛰️  Created Sensor:', sensorCode);
    } else {
      // Ensure 1–1 mapping is enforced (move sensor if needed)
      if (sensor.vehicleId !== vehicle.id) {
        sensor = await tx.sensor.update({
          where: { id: sensor.id },
          data: { vehicleId: vehicle.id },
        });
      }
      // Update health/lastSeen
      sensor = await tx.sensor.update({
        where: { id: sensor.id },
        data: { status: 'OK', isActive: true, lastSeen: new Date() },
      });
    }

    return { vehicle, sensor };
  });
};

/** ---------- Message Handler ---------- */

const handleMessage = async (thingConfig: typeof THING_CONFIGS[0], topic: string | Buffer, buf: Buffer) => {
  // Extract IMEI from topic (e.g., "353691841264129/data" -> "353691841264129")
  const topicStr = topic.toString();
  const sensorCode = topicStr.split('/')[0];
  
  // Validate IMEI format (should be numeric)
  if (!/^\d+$/.test(sensorCode)) {
    console.warn(`⚠️ Invalid sensor code format for ${thingConfig.thingName}:`, sensorCode);
    return;
  }

  try {
    const rawStr = buf.toString();
    const payload = JSON.parse(rawStr);
    console.log(`📥 [${thingConfig.thingName}] Incoming [%s]: %s`, topicStr, rawStr);

    // Extract FMB920 data from state.reported
    const fmbData = payload?.state?.reported;
    if (!fmbData) {
      console.warn(`⚠️ Invalid FMB920 data format for ${thingConfig.thingName} sensor %s`, sensorCode);
      return;
    }

    // Normalize to SensorReading fields
    const reading = fromFMB920(fmbData);

    // Create (or fetch) Vehicle + Sensor
    const { sensor } = await getOrCreateVehicleAndSensor(sensorCode, payload, thingConfig.thingName);

    // Insert reading (duplicate-safe on [sensorId, timestamp])
    try {
    await prisma.sensorReading.create({
      data: {
        sensorId: sensor.id,
          timestamp: reading.timestamp,
          fuelLevel: reading.fuelLevel ?? undefined,
          locationLat: reading.locationLat ?? undefined,
          locationLong: reading.locationLong ?? undefined,
          speed: reading.speed ?? undefined,
          ignitionStatus: reading.ignitionStatus ?? undefined,
          odometerKm: reading.odometerKm ?? undefined,
          deviceVoltage: reading.deviceVoltage ?? undefined,
          address: reading.address ?? undefined,
          isOverSpeed: reading.isOverSpeed ?? undefined,
          raw: payload,
          topic: topicStr,
      },
    });
      console.log(`✅ [${thingConfig.thingName}] Stored reading for sensor %s @ %s (fuel: %s, speed: %s)`, 
        sensorCode, 
        reading.timestamp.toISOString(),
        reading.fuelLevel ?? 'null',
        reading.speed ?? 'null'
      );
    } catch (e: any) {
      // P2002 = Unique constraint failed on the fields: (`sensorId`,`timestamp`)
      if (e?.code === 'P2002') {
        console.warn(`⚠️ [${thingConfig.thingName}] Duplicate reading skipped (%s, %s)`, sensorCode, reading.timestamp.toISOString());
      } else {
        throw e;
      }
    }
  } catch (err) {
    console.error(`❌ [${thingConfig.thingName}] Error processing message [%s]:`, topicStr, err);
  }
};

/** ---------- Initialize Connections ---------- */

// Start all connections
initializeConnections();

// Export the clients for external access
export { clients };
export default clients;
