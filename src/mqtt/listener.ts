import mqtt from 'mqtt';
import prisma from '../lib/prisma';
import dotenv from 'dotenv';

dotenv.config();
const TOPIC = 'fuel/readings';
const client = mqtt.connect(process.env.MQTT_BROKER_URL || 'mqtt://host.docker.internal:1883');

client.on('connect', () => {
  console.log(`✅ Connected to MQTT broker`);
  client.subscribe(TOPIC, err => {
    if (err) console.error('❌ Subscription error:', err);
    else console.log(`📡 Subscribed to topic: ${TOPIC}`);
  });
});

client.on('message', async (topic, message) => {
  try {
    const data = JSON.parse(message.toString());
    console.log('📥 Received:', data);

    const {
      sensorCode,
      dateSec,
      fuelLitre,
      distanceCovered,
      latitude,
      longitude,
      speed,
      ignitionStatus,
      odoDistance,
      deviceVolt,
      isOverSpeed,
    } = data;

    // Find the sensor by sensorCode
    const sensor = await prisma.sensor.findUnique({
      where: { sensorCode },
    });

    if (!sensor) {
      console.warn(`⚠️ Sensor ${sensorCode} not found`);
      return;
    }

    // Determine Timestamp
    const timestamp = dateSec ? new Date(dateSec * 1000) : new Date();

    // Insert SensorReading
    await prisma.sensorReading.create({
      data: {
        sensorId: sensor.id,
        timestamp,
        fuelLevel: fuelLitre || 0,
        distanceKm: distanceCovered || 0,
        locationLat: latitude || 0,
        locationLong: longitude || 0,
        speed: speed || 0,
        ignitionStatus: ignitionStatus || null,
        odometer: odoDistance || null,
        deviceVoltage: deviceVolt || null,
        isOverSpeed: isOverSpeed === 'Y' || isOverSpeed === true,
      },
    });

    console.log(`✅ Inserted reading for sensor: ${sensorCode}`);
  } catch (err) {
    console.error('❌ Error processing MQTT message:', err);
  }
});


















// import mqtt from 'mqtt';
// import prisma from '../lib/prisma';
// import dotenv from 'dotenv';
// // import teltonikaDecoder from 'teltonika-decoder';


// dotenv.config();
// const TOPIC = 'fuel/readings';
// // const TOPIC ='353691841264129/data'
// const client = mqtt.connect(process.env.MQTT_BROKER_URL || 'mqtt://host.docker.internal:1883');


// // import fs from 'fs';

// // const client = mqtt.connect(process.env.MQTT_BROKER_URL!, {
// //   clientId: '353691841264129',
// //   cert: fs.readFileSync('cert/6f01d7881191873f1eacbc586aadc0dbfbb2df6ea915361a654db53bc137760a-certificate.pem.crt'),
// //   key: fs.readFileSync('cert/6f01d7881191873f1eacbc586aadc0dbfbb2df6ea915361a654db53bc137760a-private.pem.key'),
// //   ca: fs.readFileSync('cert/AmazonRootCA1.pem'),
// // });




// client.on('connect', () => {
//   console.log(`✅ Connected to MQTT broker/AWS`);
//   client.subscribe(TOPIC, err => {
//     if (err) console.error('❌ Subscription error:', err);
//     else console.log(`📡 Subscribed to topic: ${TOPIC}`);
//   });
// });

// client.on('message', async (topic, message) => {
//   try {
//     const data = JSON.parse(message.toString());
//     // const data = teltonika.parse(message);
//     console.log('📥 Received:', data);

//     const {
//       sensorCode,
//       fuelLevel,
//       distanceKm,
//       locationLat,
//       locationLong,
//       timestamp,
//     } = data;

//     // Find the sensor
//     const sensor = await prisma.sensor.findUnique({
//       where: { sensorCode },
//     });

//     if (!sensor) {
//       console.warn(`⚠️ Sensor ${sensorCode} not found`);
//       return;
//     }

//     // Insert sensor reading
//     await prisma.sensorReading.create({
//       data: {
//         sensorId: sensor.id,
//         fuelLevel,
//         distanceKm,
//         locationLat,
//         locationLong,
//         timestamp: new Date(timestamp),
//       },
//     });

//     console.log(`✅ Inserted reading for sensor: ${sensorCode}`);
//   } catch (err) {
//     console.error('❌ Error processing MQTT message:', err);
//   }
// });






// // const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL ;
// // const MQTT_BROKER_URL = 'mqtt://localhost:1883';
// // const MQTT_BROKER_URL = 'mqtt://mqtt:1883';
// // const MQTT_BROKER_URL="mqtt://host.docker.internal:1883"; // For Docker setup, use host.docker.internal