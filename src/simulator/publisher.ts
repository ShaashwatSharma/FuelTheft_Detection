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
  'SIM-SENSOR-008',
  'SIM-SENSOR-009',
  'SIM-SENSOR-010',
];

const client = mqtt.connect(MQTT_BROKER_URL);

client.on('connect', () => {
  console.log('✅ Simulator connected to MQTT broker');

  setInterval(() => {
    SENSOR_CODES.forEach(sensorCode => {
      const now = Date.now();
      const simulatedData = {
        sensorCode: sensorCode,
        dateSec: Math.floor(now / 1000),  // Epoch seconds
        fuelLitre: getRandomFloat(40, 80),
        distanceCovered: getRandomFloat(0.1, 5),
        latitude: 28.6139 + getRandomFloat(-0.01, 0.01),
        longitude: 77.2090 + getRandomFloat(-0.01, 0.01),
        speed: getRandomFloat(0, 60),
        ignitionStatus: Math.random() > 0.2 ? 'ON' : 'OFF',  // 80% ON
        odoDistance: getRandomFloat(10000, 50000),
        deviceVolt: getRandomFloat(11, 14),
        isOverSpeed: Math.random() > 0.85 ? 'Y' : 'N',  // 15% chance overspeed
      };

      client.publish(TOPIC, JSON.stringify(simulatedData));
      console.log(`📤 Published for ${sensorCode}:`, simulatedData);
    });
  }, 5000); // Every 5 seconds
});

function getRandomFloat(min: number, max: number): number {
  return +(Math.random() * (max - min) + min).toFixed(2);
}
