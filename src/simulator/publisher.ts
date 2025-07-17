import mqtt from 'mqtt';

const MQTT_BROKER_URL = 'mqtt://localhost:1883';
const TOPIC = 'fuel/readings';

// List of simulated sensors
const SENSOR_CODES = [
  'SIM-SENSOR-001',
  'SIM-SENSOR-002',
  'SIM-SENSOR-003',
  'SIM-SENSOR-004',
  'SIM-SENSOR-005',
  'SIM-SENSOR-006',
  'SIM-SENSOR-007',
];

const client = mqtt.connect(MQTT_BROKER_URL);

client.on('connect', () => {
  console.log('✅ Simulator connected to MQTT broker');

  setInterval(() => {
    SENSOR_CODES.forEach(sensorCode => {
      const simulatedData = {
        sensorCode,
        fuelLevel: getRandomFloat(40, 80),
        distanceKm: getRandomFloat(0.1, 5),
        locationLat: 28.6139 + getRandomFloat(-0.01, 0.01),
        locationLong: 77.2090 + getRandomFloat(-0.01, 0.01),
        timestamp: new Date().toISOString(),
      };

      client.publish(TOPIC, JSON.stringify(simulatedData));
      console.log(`📤 Published for ${sensorCode}:`, simulatedData);
    });
  }, 5000); // Every 5 seconds (5000), all sensors send data
});

function getRandomFloat(min: number, max: number): number {
  return +(Math.random() * (max - min) + min).toFixed(2);
}
