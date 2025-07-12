import mqtt from 'mqtt';
import prisma from '../lib/prisma';

const MQTT_BROKER_URL = 'mqtt://localhost:1883';
const TOPIC = 'fuel/readings';

const client = mqtt.connect(MQTT_BROKER_URL);

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
      fuelLevel,
      distanceKm,
      locationLat,
      locationLong,
      timestamp,
    } = data;

    // Find the sensor
    const sensor = await prisma.sensor.findUnique({
      where: { sensorCode },
    });

    if (!sensor) {
      console.warn(`⚠️ Sensor ${sensorCode} not found`);
      return;
    }

    // Insert sensor reading
    await prisma.sensorReading.create({
      data: {
        sensorId: sensor.id,
        fuelLevel,
        distanceKm,
        locationLat,
        locationLong,
        timestamp: new Date(timestamp),
      },
    });

    console.log(`✅ Inserted reading for sensor: ${sensorCode}`);
  } catch (err) {
    console.error('❌ Error processing MQTT message:', err);
  }
});
