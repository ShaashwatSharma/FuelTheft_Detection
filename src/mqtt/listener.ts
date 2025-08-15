// src/mqtt/listener.ts
import mqtt from 'mqtt';
import prisma from '../lib/prisma';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

/** ---------- Config ---------- */

// Subscribe to one topic per sensor, e.g. "353691841264129/data".
// Use wildcard to handle all sensors automatically.
const TOPIC_FILTER = process.env.AWS_MQTT_TOPIC_FILTER || '+/data';

// AWS IoT Core MQTT connection options (TLS)
const mqttOptions: mqtt.IClientOptions = {
  clientId: process.env.AWS_MQTT_CLIENT_ID || 'fuel-theft-backend',
  key: fs.readFileSync(path.join(__dirname, '..', '..', 'cert', 'private.pem.key')),
  cert: fs.readFileSync(path.join(__dirname, '..', '..', 'cert', 'certificate.pem.crt')),
  ca: fs.readFileSync(path.join(__dirname, '..', '..', 'cert', 'AmazonRootCA1.pem')),
  protocol: 'mqtts',
  rejectUnauthorized: true,
  keepalive: 60,
  reconnectPeriod: 3000,
};

const brokerUrl = process.env.AWS_MQTT_ENDPOINT
  ? `mqtts://${process.env.AWS_MQTT_ENDPOINT}:8883`
  : 'mqtt://localhost:1883';

console.log('🔧 ENV: { endpoint:%s, clientId:%s, topicFilter:%s }',
  process.env.AWS_MQTT_ENDPOINT, mqttOptions.clientId, TOPIC_FILTER);

console.log(`🔗 Connecting to ${brokerUrl}`);
const client = mqtt.connect(brokerUrl, mqttOptions);

client.on('connect', () => {
  console.log(`✅ Connected to ${brokerUrl}`);
  client.subscribe(TOPIC_FILTER, (err) => {
    if (err) console.error('❌ Subscription error:', err);
    else console.log(`📡 Subscribed to: ${TOPIC_FILTER}`);
  });
});

client.on('error', (err) => console.error('❌ MQTT error:', err));
client.on('close', () => console.log('🔌 MQTT connection closed'));

/** ---------- Helpers ---------- */

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
  // Some providers send 1/0
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

const normalizeLat = (payload: any): number | null => {
  const lat = toFloat(payload?.latitude ?? payload?.lat);
  if (lat === 0) return null; // treat 0,0 as invalid unless you prefer otherwise
  return lat;
};
const normalizeLng = (payload: any): number | null => {
  const lng = toFloat(payload?.longitude ?? payload?.lng);
  if (lng === 0) return null;
  return lng;
};

const normalizeVoltage = (v: any): number | null => {
  const n = toFloat(v);
  if (n === null) return null;
  // Heuristic: if someone sends millivolts, convert to volts
  return n > 100 ? n / 1000 : n;
};

/** FMB920 numeric I/O fallback (if you receive raw param map) */
const fmbPick = (obj: any, key: string) => (obj && !isNil(obj[key]) ? obj[key] : undefined);
const fromFMB920 = (data: any) => {
  const latRaw = toFloat(fmbPick(data, '66'));
  const lngRaw = toFloat(fmbPick(data, '67'));
  return {
    timestamp: new Date(), // If no time in packet, server time
    fuelLevel: toFloat(fmbPick(data, '25')),    // %
    locationLat: latRaw ? latRaw / 100000 : null,
    locationLong: lngRaw ? lngRaw / 100000 : null,
    speed: toFloat(fmbPick(data, '21')),
    ignitionStatus: (fmbPick(data, '1') === 1 || fmbPick(data, '1') === '1') ? 'ON' : 'OFF',
    odometerKm: toFloat(fmbPick(data, '205')),
    deviceVoltage: null,
    address: null,
    isOverSpeed: null,
  };
};

/** Provider JSON (your sample shape) */
const fromProvider = (p: any) => ({
  timestamp: fromMsOrSec(p?.date, p?.dateSec, p?.lastComunicationTime),
  fuelLevel: toFloat(p?.fuelLitre ?? p?.fuelLitres),
  locationLat: normalizeLat(p),
  locationLong: normalizeLng(p),
  speed: toFloat(p?.speed),
  ignitionStatus: normalizeIgnition(p?.ignitionStatus ?? p?.engineStatus),
  odometerKm: toFloat(p?.odoDistance),
  deviceVoltage: normalizeVoltage(p?.deviceVolt),
  address: (typeof p?.address === 'string' && p.address.trim().length > 0) ? p.address.trim() : null,
  isOverSpeed: toBool(p?.isOverSpeed) ?? null,
});

/** Robust mapper that detects shape and returns SensorReading-compatible fields */
const mapToReading = (payload: any) => {
  // Device Shadow wrapper
  const body = (payload?.state?.reported) ? payload.state.reported : payload;

  // Heuristic: if it has 'latitude'/'lat' keys -> provider JSON
  const looksProvider = ('latitude' in body) || ('lat' in body) || ('fuelLitre' in body) || ('fuelLitres' in body);

  return looksProvider ? fromProvider(body) : fromFMB920(body);
};

/** Choose best registration number/external id from payload */
const extractVehicleIdentity = (payload: any, sensorCode: string) => {
  const body = (payload?.state?.reported) ? payload.state.reported : payload;
  const regNo = [body?.regNo, body?.vehicleId, body?.vehicleName]
    .map((v: any) => (typeof v === 'string' ? v.trim() : ''))
    .find((s: string) => s.length > 0);

  return {
    registrationNo: regNo || `SENSOR-${sensorCode}`, // guaranteed unique-ish fallback
    externalVehicleId: (typeof body?.vehicleId === 'string' && body.vehicleId.trim().length > 0)
      ? body.vehicleId.trim()
      : null,
  };
};

/** Upsert (idempotent) Vehicle + Sensor and return both (transaction-safe) */
const getOrCreateVehicleAndSensor = async (sensorCode: string, payload: any) => {
  const { registrationNo, externalVehicleId } = extractVehicleIdentity(payload, sensorCode);

  return prisma.$transaction(async (tx) => {
    // Try to find vehicle by registrationNo; if not exist, create.
    let vehicle = await tx.vehicle.findUnique({ where: { registrationNo } });
    if (!vehicle) {
      vehicle = await tx.vehicle.create({
        data: {
          registrationNo,
          externalVehicleId: externalVehicleId ?? undefined,
          model: null,
          tankSize: null,
          mileageEst: null,
        },
      });
      console.log('🚚 Created Vehicle:', registrationNo);
    } else if (externalVehicleId && vehicle.externalVehicleId !== externalVehicleId) {
      // Keep external id in sync (optional)
      vehicle = await tx.vehicle.update({
        where: { id: vehicle.id },
        data: { externalVehicleId },
      });
    }

    // Upsert sensor by sensorCode and attach to vehicle
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

client.on('message', async (topic, buf) => {
  // Only process topics ending with "/data"
  if (!topic.toString().endsWith('/data')) return;

  // sensorCode is the segment before "/data"
  const sensorCode = topic.toString().split('/')[0];

  try {
    const rawStr = buf.toString();
    const payload = JSON.parse(rawStr);
    console.log('📥 Incoming [%s]: %s', topic, rawStr);

    // Normalize to SensorReading fields
    const reading = mapToReading(payload);

    // Create (or fetch) Vehicle + Sensor
    const { sensor } = await getOrCreateVehicleAndSensor(sensorCode, payload);

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
          topic: topic.toString(),
        },
      });
      console.log('✅ Stored reading for sensor %s @ %s', sensorCode, reading.timestamp.toISOString());
    } catch (e: any) {
      // P2002 = Unique constraint failed on the fields: (`sensorId`,`timestamp`)
      if (e?.code === 'P2002') {
        console.warn('⚠️ Duplicate reading skipped (%s, %s)', sensorCode, reading.timestamp.toISOString());
      } else {
        throw e;
      }
    }
  } catch (err) {
    console.error('❌ Error processing message [%s]:', topic, err);
  }
});

export default client;





















// // src/mqtt/listener.ts

// import mqtt from 'mqtt';
// import prisma from '../lib/prisma';
// import dotenv from 'dotenv';
// import fs from 'fs';
// import path from 'path';

// dotenv.config();

// /** ---------- Config ---------- */

// // Subscribe to one topic per sensor, e.g. "353691841264129/data".
// // Use wildcard to handle all sensors automatically.
// const TOPIC_FILTER = process.env.AWS_MQTT_TOPIC_FILTER || '+/data';

// // AWS IoT Core MQTT connection options (TLS)
// const mqttOptions: mqtt.IClientOptions = {
//   clientId: process.env.AWS_MQTT_CLIENT_ID || 'fuel-theft-backend',
//   key: fs.readFileSync(path.join(__dirname, '..', '..', 'cert', 'private.pem.key')),
//   cert: fs.readFileSync(path.join(__dirname, '..', '..', 'cert', 'certificate.pem.crt')),
//   ca: fs.readFileSync(path.join(__dirname, '..', '..', 'cert', 'AmazonRootCA1.pem')),
//   protocol: 'mqtts',
//   rejectUnauthorized: true,
//   keepalive: 60,
//   reconnectPeriod: 3000,
// };

// const brokerUrl = process.env.AWS_MQTT_ENDPOINT
//   ? `mqtts://${process.env.AWS_MQTT_ENDPOINT}:8883`
//   : 'mqtt://localhost:1883';

// console.log('🔧 ENV: { endpoint:%s, clientId:%s, topicFilter:%s }',
//   process.env.AWS_MQTT_ENDPOINT, mqttOptions.clientId, TOPIC_FILTER);

// console.log(`🔗 Connecting to ${brokerUrl}`);
// const client = mqtt.connect(brokerUrl, mqttOptions);

// client.on('connect', () => {
//   console.log(`✅ Connected to ${brokerUrl}`);
//   client.subscribe(TOPIC_FILTER, (err) => {
//     if (err) console.error('❌ Subscription error:', err);
//     else console.log(`📡 Subscribed to: ${TOPIC_FILTER}`);
//   });
// });

// client.on('error', (err) => console.error('❌ MQTT error:', err));
// client.on('close', () => console.log('🔌 MQTT connection closed'));

// /** ---------- Helpers ---------- */

// const isNil = (v: any) => v === null || v === undefined;
// const toFloat = (v: any): number | null => {
//   if (isNil(v)) return null;
//   const s = (typeof v === 'string') ? v.trim() : v;
//   if (s === '' || s === '-' || s === 'nill') return null;
//   const n = Number(s);
//   return Number.isFinite(n) ? n : null;
// };

// const toBool = (v: any): boolean | null => {
//   if (isNil(v)) return null;
//   if (typeof v === 'boolean') return v;
//   const s = String(v).trim().toLowerCase();
//   if (['y', 'yes', 'true', '1'].includes(s)) return true;
//   if (['n', 'no', 'false', '0'].includes(s)) return false;
//   return null;
// };

// const normalizeIgnition = (v: any): 'ON' | 'OFF' | null => {
//   if (isNil(v)) return null;
//   const s = String(v).trim().toLowerCase();
//   if (s.includes('on')) return 'ON';
//   if (s.includes('off')) return 'OFF';
//   // Some providers send 1/0
//   if (['1', 'true', 'y', 'yes'].includes(s)) return 'ON';
//   if (['0', 'false', 'n', 'no'].includes(s)) return 'OFF';
//   return null;
// };

// const fromMsOrSec = (date?: any, dateSec?: any, fallback?: any): Date => {
//   const ms = toFloat(date);
//   if (ms && ms > 10_000_000_000) return new Date(ms); // already ms
//   const sec = toFloat(dateSec) ?? (ms && ms < 10_000_000_000 ? ms : null);
//   if (sec) return new Date(sec * 1000);
//   const fb = toFloat(fallback);
//   if (fb) return new Date(fb);
//   return new Date(); // last resort
// };

// const normalizeLat = (payload: any): number | null => {
//   const lat = toFloat(payload?.latitude ?? payload?.lat);
//   if (lat === 0) return null; // treat 0,0 as invalid unless you prefer otherwise
//   return lat;
// };
// const normalizeLng = (payload: any): number | null => {
//   const lng = toFloat(payload?.longitude ?? payload?.lng);
//   if (lng === 0) return null;
//   return lng;
// };

// const normalizeVoltage = (v: any): number | null => {
//   const n = toFloat(v);
//   if (n === null) return null;
//   // Heuristic: if someone sends millivolts, convert to volts
//   return n > 100 ? n / 1000 : n;
// };

// /** FMB920 numeric I/O fallback (if you receive raw param map) */
// const fmbPick = (obj: any, key: string) => (obj && !isNil(obj[key]) ? obj[key] : undefined);
// const fromFMB920 = (data: any) => {
//   const latRaw = toFloat(fmbPick(data, '66'));
//   const lngRaw = toFloat(fmbPick(data, '67'));
//   return {
//     timestamp: new Date(), // If no time in packet, server time
//     fuelLevel: toFloat(fmbPick(data, '25')),    // %
//     locationLat: latRaw ? latRaw / 100000 : null,
//     locationLong: lngRaw ? lngRaw / 100000 : null,
//     speed: toFloat(fmbPick(data, '21')),
//     ignitionStatus: (fmbPick(data, '1') === 1 || fmbPick(data, '1') === '1') ? 'ON' : 'OFF',
//     odometerKm: toFloat(fmbPick(data, '205')),
//     deviceVoltage: null,
//     address: null,
//     isOverSpeed: null,
//   };
// };

// /** Provider JSON (your sample shape) */
// const fromProvider = (p: any) => ({
//   timestamp: fromMsOrSec(p?.date, p?.dateSec, p?.lastComunicationTime),
//   fuelLevel: toFloat(p?.fuelLitre ?? p?.fuelLitres),
//   locationLat: normalizeLat(p),
//   locationLong: normalizeLng(p),
//   speed: toFloat(p?.speed),
//   ignitionStatus: normalizeIgnition(p?.ignitionStatus ?? p?.engineStatus),
//   odometerKm: toFloat(p?.odoDistance),
//   deviceVoltage: normalizeVoltage(p?.deviceVolt),
//   address: (typeof p?.address === 'string' && p.address.trim().length > 0) ? p.address.trim() : null,
//   isOverSpeed: toBool(p?.isOverSpeed) ?? null,
// });

// /** Robust mapper that detects shape and returns SensorReading-compatible fields */
// const mapToReading = (payload: any) => {
//   // Device Shadow wrapper
//   const body = (payload?.state?.reported) ? payload.state.reported : payload;

//   // Heuristic: if it has 'latitude'/'lat' keys -> provider JSON
//   const looksProvider = ('latitude' in body) || ('lat' in body) || ('fuelLitre' in body) || ('fuelLitres' in body);

//   return looksProvider ? fromProvider(body) : fromFMB920(body);
// };

// /** Choose best registration number/external id from payload */
// const extractVehicleIdentity = (payload: any, sensorCode: string) => {
//   const body = (payload?.state?.reported) ? payload.state.reported : payload;
//   const regNo = [body?.regNo, body?.vehicleId, body?.vehicleName]
//     .map((v: any) => (typeof v === 'string' ? v.trim() : ''))
//     .find((s: string) => s.length > 0);

//   return {
//     registrationNo: regNo || `SENSOR-${sensorCode}`, // guaranteed unique-ish fallback
//     externalVehicleId: (typeof body?.vehicleId === 'string' && body.vehicleId.trim().length > 0)
//       ? body.vehicleId.trim()
//       : null,
//   };
// };

// /** Upsert (idempotent) Vehicle + Sensor and return both (transaction-safe) */
// const getOrCreateVehicleAndSensor = async (sensorCode: string, payload: any) => {
//   const { registrationNo, externalVehicleId } = extractVehicleIdentity(payload, sensorCode);

//   return prisma.$transaction(async (tx) => {
//     // Try to find vehicle by registrationNo; if not exist, create.
//     let vehicle = await tx.vehicle.findUnique({ where: { registrationNo } });
//     if (!vehicle) {
//       vehicle = await tx.vehicle.create({
//         data: {
//           registrationNo,
//           externalVehicleId: externalVehicleId ?? undefined,
//           model: null,
//           tankSize: null,
//           mileageEst: null,
//         },
//       });
//       console.log('🚚 Created Vehicle:', registrationNo);
//     } else if (externalVehicleId && vehicle.externalVehicleId !== externalVehicleId) {
//       // Keep external id in sync (optional)
//       vehicle = await tx.vehicle.update({
//         where: { id: vehicle.id },
//         data: { externalVehicleId },
//       });
//     }

//     // Upsert sensor by sensorCode and attach to vehicle
//     let sensor = await tx.sensor.findUnique({ where: { sensorCode } });
//     if (!sensor) {
//       sensor = await tx.sensor.create({
//         data: {
//           sensorCode,
//           isActive: true,
//           status: 'OK',
//           vehicleId: vehicle.id,
//           lastSeen: new Date(),
//         },
//       });
//       console.log('🛰️  Created Sensor:', sensorCode);
//     } else {
//       // Ensure 1–1 mapping is enforced (move sensor if needed)
//       if (sensor.vehicleId !== vehicle.id) {
//         sensor = await tx.sensor.update({
//           where: { id: sensor.id },
//           data: { vehicleId: vehicle.id },
//         });
//       }
//       // Update health/lastSeen
//       sensor = await tx.sensor.update({
//         where: { id: sensor.id },
//         data: { status: 'OK', isActive: true, lastSeen: new Date() },
//       });
//     }

//     return { vehicle, sensor };
//   });
// };

// /** ---------- Message Handler ---------- */

// client.on('message', async (topic, buf) => {
//   // Only process topics ending with "/data"
//   if (!topic.toString().endsWith('/data')) return;

//   // sensorCode is the segment before "/data"
//   const sensorCode = topic.toString().split('/')[0];

//   try {
//     const rawStr = buf.toString();
//     const payload = JSON.parse(rawStr);
//     console.log('📥 Incoming [%s]: %s', topic, rawStr);

//     // Normalize to SensorReading fields
//     const reading = mapToReading(payload);

//     // Create (or fetch) Vehicle + Sensor
//     const { sensor } = await getOrCreateVehicleAndSensor(sensorCode, payload);

//     // Insert reading (duplicate-safe on [sensorId, timestamp])
//     try {
//       await prisma.sensorReading.create({
//         data: {
//           sensorId: sensor.id,
//           timestamp: reading.timestamp,
//           fuelLevel: reading.fuelLevel ?? undefined,
//           locationLat: reading.locationLat ?? undefined,
//           locationLong: reading.locationLong ?? undefined,
//           speed: reading.speed ?? undefined,
//           ignitionStatus: reading.ignitionStatus ?? undefined,
//           odometerKm: reading.odometerKm ?? undefined,
//           deviceVoltage: reading.deviceVoltage ?? undefined,
//           address: reading.address ?? undefined,
//           isOverSpeed: reading.isOverSpeed ?? undefined,
//           raw: payload,
//           topic: topic.toString(),
//         },
//       });
//       console.log('✅ Stored reading for sensor %s @ %s', sensorCode, reading.timestamp.toISOString());
//     } catch (e: any) {
//       // P2002 = Unique constraint failed on the fields: (`sensorId`,`timestamp`)
//       if (e?.code === 'P2002') {
//         console.warn('⚠️ Duplicate reading skipped (%s, %s)', sensorCode, reading.timestamp.toISOString());
//       } else {
//         throw e;
//       }
//     }
//   } catch (err) {
//     console.error('❌ Error processing message [%s]:', topic, err);
//   }
// });

// export default client;




















// import mqtt from 'mqtt';
// import prisma from '../lib/prisma';
// import dotenv from 'dotenv';
// import fs from 'fs';
// import path from 'path';

// dotenv.config();

// // Debug environment variables
// console.log('🔧 Environment variables:');
// console.log('AWS_MQTT_ENDPOINT:', process.env.AWS_MQTT_ENDPOINT);
// console.log('AWS_MQTT_CLIENT_ID:', process.env.AWS_MQTT_CLIENT_ID);

// // Hardcode the topic as per instruction
// const TOPIC = '353691841264129/data';

// // AWS IoT Core MQTT connection options
// const mqttOptions: mqtt.IClientOptions = {
//   clientId: process.env.AWS_MQTT_CLIENT_ID || 'fuel-theft-backend',
//   key: fs.readFileSync(path.join(__dirname, '..', '..', 'cert', 'private.pem.key')),
//   cert: fs.readFileSync(path.join(__dirname, '..', '..', 'cert', 'certificate.pem.crt')),
//   ca: fs.readFileSync(path.join(__dirname, '..', '..', 'cert', 'AmazonRootCA1.pem')),
//   protocol: 'mqtts',
//   rejectUnauthorized: true, // Allow self-signed certs for development
// };

// const brokerUrl = process.env.AWS_MQTT_ENDPOINT ? `mqtts://${process.env.AWS_MQTT_ENDPOINT}:8883` : 'mqtt://localhost:1883';

// console.log(`🔗 Connecting to AWS IoT Core at: ${brokerUrl}`);

// const client = mqtt.connect(brokerUrl, mqttOptions);

// client.on('connect', () => {
//   console.log(`✅ Connected to AWS IoT Core at ${brokerUrl}`);
//   client.subscribe(TOPIC, err => {
//     if (err) {
//       console.error('❌ Subscription error:', err);
//     } else {
//       console.log(`📡 Subscribed to topic: ${TOPIC}`);
//     }
//   });
// });

// client.on('error', (err) => {
//   console.error('❌ MQTT connection error:', err);
// });

// client.on('close', () => {
//   console.log('🔌 MQTT connection closed');
// });

// // FMB920 parameter mapping
// const FMB920_PARAMS = {
//   '1': 'ignition',           // Ignition status
//   '16': 'totalDistance',     // Total distance (km)
//   '21': 'speed',             // Speed (km/h)
//   '25': 'fuelLevel',         // Fuel level (%)
//   '29': 'engineRPM',         // Engine RPM
//   '66': 'latitude',          // Latitude
//   '67': 'longitude',         // Longitude
//   '68': 'altitude',          // Altitude
//   '200': 'fuelConsumption',  // Fuel consumption
//   '205': 'odometer'          // Odometer reading
// };

// client.on('message', async (topic, message) => {
//   try {
//     const data = JSON.parse(message.toString());
//     console.log('📥 Received from FMB920:', data);

//     // Handle FMB920 Device Shadow format
//     let fmbData = data;
//     if (data.state && data.state.reported) {
//       fmbData = data.state.reported;
//     }

//     // Extract FMB920 parameters
//     const sensorCode = 'FMB920'; // You can make this configurable
//     const timestamp = new Date();
    
//     // Map FMB920 parameters to our schema
//     const mappedData = {
//       fuelLevel: fmbData['25'] ? parseFloat(fmbData['25']) : null,
//       distanceKm: fmbData['16'] ? parseFloat(fmbData['16']) : null,
//       locationLat: fmbData['66'] ? parseFloat(fmbData['66']) / 100000 : 0, // Convert from FMB920 format
//       locationLong: fmbData['67'] ? parseFloat(fmbData['67']) / 100000 : 0, // Convert from FMB920 format
//       speed: fmbData['21'] ? parseFloat(fmbData['21']) : 0,
//       ignitionStatus: fmbData['1'] === 1 ? 'ON' : 'OFF',
//       odometer: fmbData['205'] ? parseFloat(fmbData['205']) : null,
//       deviceVoltage: null, // FMB920 doesn't provide this directly
//     };

//     console.log('🔄 Mapped FMB920 data:', mappedData);

//     // Find the sensor by sensorCode
//     const sensor = await prisma.sensor.findUnique({
//       where: { sensorCode },
//     });

//     if (!sensor) {
//       console.warn(`⚠️ Sensor ${sensorCode} not found in database. Creating one...`);
      
//       // Create a vehicle first
//       const vehicle = await prisma.vehicle.create({
//         data: {
//           registrationNo: 'FMB920-Vehicle',
//           model: 'FMB920 GPS Tracker',
//           tankSize: 50,
//           mileageEst: 12.5,
//         },
//       });

//       // Create the sensor
//       const newSensor = await prisma.sensor.create({
//         data: {
//           sensorCode,
//           isActive: true,
//           vehicleId: vehicle.id,
//         },
//       });

//       console.log(`✅ Created new sensor: ${newSensor.id}`);
      
//       // Use the new sensor
//       await prisma.sensorReading.create({
//         data: {
//           sensorId: newSensor.id,
//           timestamp,
//           ...mappedData,
//         },
//       });
//     } else {
//       // Use existing sensor
//       await prisma.sensorReading.create({
//         data: {
//           sensorId: sensor.id,
//           timestamp,
//           ...mappedData,
//         },
//       });
//     }

//     console.log(`✅ Inserted FMB920 reading for sensor: ${sensorCode}`);
//   } catch (err) {
//     console.error('❌ Error processing FMB920 message:', err);
//   }
// });

// export default client;
