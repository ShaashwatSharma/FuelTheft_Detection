const axios = require('axios');

async function testMLService() {
  const MODEL_URL = 'http://localhost:5001/predict';
  
  console.log('🧪 Testing ML Service...');
  
  // Test data similar to what detector.ts sends
  const testData = {
    fuelLevel: 150.5,
    previous_fuel_level: 160.0,
    distanceKm: 25.3,
    locationLat: 12.9716,
    locationLong: 77.5946,
    speed: 45.2,
    ignitionStatus: 'ON',
    isOverSpeed: false,
    odometer: 125000.5,
    deviceVoltage: 12.8,
    topic: 'test-sensor/data',
    timestamp: new Date().toISOString()
  };
  
  try {
    console.log('📤 Sending test data:', JSON.stringify(testData, null, 2));
    
    const response = await axios.post(MODEL_URL, testData, {
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    console.log('✅ ML Service Response:', response.data);
    console.log('🎯 Prediction:', response.data.prediction);
    
  } catch (error) {
    console.error('❌ ML Service Error:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
      console.error('Response status:', error.response.status);
    }
  }
}

// Test health endpoint first
async function testHealth() {
  try {
    console.log('🏥 Testing health endpoint...');
    const response = await axios.get('http://localhost:5001/health');
    console.log('✅ Health check passed:', response.data);
    return true;
  } catch (error) {
    console.error('❌ Health check failed:', error.message);
    return false;
  }
}

async function main() {
  const isHealthy = await testHealth();
  if (isHealthy) {
    await testMLService();
  } else {
    console.log('⚠️  ML service is not healthy, skipping prediction test');
  }
}

main().catch(console.error);
