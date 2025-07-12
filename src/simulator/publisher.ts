import mqtt from 'mqtt';

const MQTT_BROKER_URL = 'mqtt://localhost:1883';
const TOPIC = 'fuel/readings';

// Replace this with actual sensor codes from your DB
const TEST_SENSOR_CODE = 'SIM-SENSOR-001';

const client = mqtt.connect(MQTT_BROKER_URL);

client.on('connect', () => {
  console.log('✅ Simulator connected to MQTT broker');
  
  setInterval(() => {
    const simulatedData = {
      sensorCode: TEST_SENSOR_CODE,
      fuelLevel: getRandomFloat(40, 80),
      distanceKm: getRandomFloat(0.1, 5),
      locationLat: 28.6139 + getRandomFloat(-0.01, 0.01),
      locationLong: 77.2090 + getRandomFloat(-0.01, 0.01),
      timestamp: new Date().toISOString(),
    };

    client.publish(TOPIC, JSON.stringify(simulatedData));
    console.log(`📤 Published:`, simulatedData);
  }, 5000); // every 5 seconds
});

function getRandomFloat(min: number, max: number): number {
  return +(Math.random() * (max - min) + min).toFixed(2);
}
