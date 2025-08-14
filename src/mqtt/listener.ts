import mqtt from 'mqtt';
import prisma from '../lib/prisma';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

// Debug environment variables
console.log('🔧 Environment variables:');
console.log('AWS_MQTT_ENDPOINT:', process.env.AWS_MQTT_ENDPOINT);
console.log('AWS_MQTT_CLIENT_ID:', process.env.AWS_MQTT_CLIENT_ID);

// Hardcode the topic as per instruction
const TOPIC = '353691841264129/data';

// AWS IoT Core MQTT connection options
const mqttOptions: mqtt.IClientOptions = {
  clientId: process.env.AWS_MQTT_CLIENT_ID || 'fuel-theft-backend',
  key: fs.readFileSync(path.join(__dirname, '..', '..', 'cert', 'private.pem.key')),
  cert: fs.readFileSync(path.join(__dirname, '..', '..', 'cert', 'certificate.pem.crt')),
  ca: fs.readFileSync(path.join(__dirname, '..', '..', 'cert', 'AmazonRootCA1.pem')),
  protocol: 'mqtts',
  rejectUnauthorized: true, // Allow self-signed certs for development
};

const brokerUrl = process.env.AWS_MQTT_ENDPOINT ? `mqtts://${process.env.AWS_MQTT_ENDPOINT}:8883` : 'mqtt://localhost:1883';

console.log(`🔗 Connecting to AWS IoT Core at: ${brokerUrl}`);

const client = mqtt.connect(brokerUrl, mqttOptions);

client.on('connect', () => {
  console.log(`✅ Connected to AWS IoT Core at ${brokerUrl}`);
  client.subscribe(TOPIC, err => {
    if (err) {
      console.error('❌ Subscription error:', err);
    } else {
      console.log(`📡 Subscribed to topic: ${TOPIC}`);
    }
  });
});

client.on('error', (err) => {
  console.error('❌ MQTT connection error:', err);
});

client.on('close', () => {
  console.log('🔌 MQTT connection closed');
});

// FMB920 parameter mapping
const FMB920_PARAMS = {
  '1': 'ignition',           // Ignition status
  '16': 'totalDistance',     // Total distance (km)
  '21': 'speed',             // Speed (km/h)
  '25': 'fuelLevel',         // Fuel level (%)
  '29': 'engineRPM',         // Engine RPM
  '66': 'latitude',          // Latitude
  '67': 'longitude',         // Longitude
  '68': 'altitude',          // Altitude
  '200': 'fuelConsumption',  // Fuel consumption
  '205': 'odometer'          // Odometer reading
};

client.on('message', async (topic, message) => {
  try {
    const data = JSON.parse(message.toString());
    console.log('📥 Received from FMB920:', data);

    // Handle FMB920 Device Shadow format
    let fmbData = data;
    if (data.state && data.state.reported) {
      fmbData = data.state.reported;
    }

    // Extract FMB920 parameters
    const sensorCode = 'FMB920'; // You can make this configurable
    const timestamp = new Date();
    
    // Map FMB920 parameters to our schema
    const mappedData = {
      fuelLevel: fmbData['25'] ? parseFloat(fmbData['25']) : null,
      distanceKm: fmbData['16'] ? parseFloat(fmbData['16']) : null,
      locationLat: fmbData['66'] ? parseFloat(fmbData['66']) / 100000 : 0, // Convert from FMB920 format
      locationLong: fmbData['67'] ? parseFloat(fmbData['67']) / 100000 : 0, // Convert from FMB920 format
      speed: fmbData['21'] ? parseFloat(fmbData['21']) : 0,
      ignitionStatus: fmbData['1'] === 1 ? 'ON' : 'OFF',
      odometer: fmbData['205'] ? parseFloat(fmbData['205']) : null,
      deviceVoltage: null, // FMB920 doesn't provide this directly
    };

    console.log('🔄 Mapped FMB920 data:', mappedData);

    // Find the sensor by sensorCode
    const sensor = await prisma.sensor.findUnique({
      where: { sensorCode },
    });

    if (!sensor) {
      console.warn(`⚠️ Sensor ${sensorCode} not found in database. Creating one...`);
      
      // Create a vehicle first
      const vehicle = await prisma.vehicle.create({
        data: {
          registrationNo: 'FMB920-Vehicle',
          model: 'FMB920 GPS Tracker',
          tankSize: 50,
          mileageEst: 12.5,
        },
      });

      // Create the sensor
      const newSensor = await prisma.sensor.create({
        data: {
          sensorCode,
          isActive: true,
          vehicleId: vehicle.id,
        },
      });

      console.log(`✅ Created new sensor: ${newSensor.id}`);
      
      // Use the new sensor
      await prisma.sensorReading.create({
        data: {
          sensorId: newSensor.id,
          timestamp,
          ...mappedData,
        },
      });
    } else {
      // Use existing sensor
      await prisma.sensorReading.create({
        data: {
          sensorId: sensor.id,
          timestamp,
          ...mappedData,
        },
      });
    }

    console.log(`✅ Inserted FMB920 reading for sensor: ${sensorCode}`);
  } catch (err) {
    console.error('❌ Error processing FMB920 message:', err);
  }
});

export default client;