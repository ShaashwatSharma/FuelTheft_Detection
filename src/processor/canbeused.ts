// import { PrismaClient, AlertType, SensorReading, Sensor } from '@prisma/client';

// const prisma = new PrismaClient();

// // Configuration - these can be changed as needed
// const CONFIG = {
//   TIME_WINDOW_MINUTES: 5, // Expected time between readings
//   FUEL_CONSUMPTION_THRESHOLD_LITERS: 0.5, // 500ml
//   FUEL_REFUEL_THRESHOLD_LITERS: 5, // Significant increase to consider refuel
//   MIN_READINGS_FOR_ANALYSIS: 2, // Minimum readings needed to detect anomalies
// };

// interface SensorData {
//   sensorCode: string;
//   fuelLevel: number;
//   distanceKm: number;
//   locationLat: number;
//   locationLong: number;
//   timestamp: string;
// }

// export async function processSensorData(rawData: string): Promise<void> {
//   try {
//     // Parse the incoming data
//     const data: SensorData = parseSensorData(rawData);
    
//     // Get the sensor from DB
//     const sensor = await prisma.sensor.findUnique({
//       where: { sensorCode: data.sensorCode },
//       include: { vehicle: true }
//     });

//     if (!sensor) {
//       console.warn(`Sensor ${data.sensorCode} not found in database`);
//       return;
//     }

//     // Save the new reading
//     const newReading = await prisma.sensorReading.create({
//       data: {
//         fuelLevel: data.fuelLevel,
//         distanceKm: data.distanceKm,
//         locationLat: data.locationLat,
//         locationLong: data.locationLong,
//         timestamp: new Date(data.timestamp),
//         sensorId: sensor.id,
//       }
//     });

//     // Get previous readings for analysis (within last 24 hours)
//     const previousReadings = await prisma.sensorReading.findMany({
//       where: {
//         sensorId: sensor.id,
//         timestamp: {
//           lt: new Date(data.timestamp),
//           gte: new Date(new Date(data.timestamp).getTime() - 24 * 60 * 60 * 1000) // 24 hours before
//         },
//         processed: false
//       },
//       orderBy: { timestamp: 'desc' },
//     });

//     // If we have at least one previous reading to compare with
//     if (previousReadings.length >= CONFIG.MIN_READINGS_FOR_ANALYSIS - 1) {
//       const latestReading = previousReadings[0];
      
//       // Calculate time difference in minutes
//       const timeDiffMinutes = (newReading.timestamp.getTime() - latestReading.timestamp.getTime()) / (1000 * 60);
      
//       // Calculate fuel difference
//       const fuelDiff = latestReading.fuelLevel - newReading.fuelLevel;
//       const fuelDiffPerMinute = fuelDiff / timeDiffMinutes;

//       // Check for anomalies
//       if (fuelDiff < -CONFIG.FUEL_REFUEL_THRESHOLD_LITERS) {
//         // Significant fuel increase - possible refuel
//         await createAlert(
//           sensor,
//           newReading,
//           AlertType.REFUEL,
//           `Possible refuel detected. Fuel increased by ${-fuelDiff.toFixed(2)} liters in ${timeDiffMinutes.toFixed(1)} minutes.`
//         );
//       } else if (
//         timeDiffMinutes <= CONFIG.TIME_WINDOW_MINUTES * 2 && // Within reasonable time window
//         fuelDiff > CONFIG.FUEL_CONSUMPTION_THRESHOLD_LITERS && // More than expected consumption
//         fuelDiffPerMinute > (CONFIG.FUEL_CONSUMPTION_THRESHOLD_LITERS / CONFIG.TIME_WINDOW_MINUTES) * 2 // More than double expected rate
//       ) {
//         // Abnormal fuel consumption - possible theft
//         await createAlert(
//           sensor,
//           newReading,
//           AlertType.THEFT,
//           `Possible fuel theft detected. ${fuelDiff.toFixed(2)} liters consumed in ${timeDiffMinutes.toFixed(1)} minutes.`
//         );
//       } else if (newReading.fuelLevel < 10) { // Example threshold for low fuel
//         await createAlert(
//           sensor,
//           newReading,
//           AlertType.LOW_FUEL,
//           `Low fuel level detected: ${newReading.fuelLevel.toFixed(2)} liters remaining.`
//         );
//       }

//       // Mark previous readings as processed
//       await prisma.sensorReading.updateMany({
//         where: { id: { in: previousReadings.map(r => r.id) } },
//         data: { processed: true }
//       });
//     }

//     // Update sensor last seen
//     await prisma.sensor.update({
//       where: { id: sensor.id },
//       data: { lastSeen: new Date(data.timestamp) }
//     });

//   } catch (error) {
//     console.error('Error processing sensor data:', error);
//     throw error;
//   }
// }

// async function createAlert(
//   sensor: Sensor & { vehicle: { id: string } | null },
//   reading: SensorReading,
//   type: AlertType,
//   description: string
// ): Promise<void> {
//   // Create the alert
//   await prisma.alert.create({
//     data: {
//       type,
//       description,
//       locationLat: reading.locationLat,
//       locationLong: reading.locationLong,
//       timestamp: reading.timestamp,
//       sensorId: sensor.id,
//     }
//   });

//   // Also create an event if there's a vehicle associated
//   if (sensor.vehicle) {
//     await prisma.event.create({
//       data: {
//         type,
//         startTime: reading.timestamp,
//         vehicleId: sensor.vehicle.id,
//         notes: description,
//         // For refuel events, record the fuel increase
//         fuelDropLitres: type === AlertType.REFUEL 
//           ? -(reading.fuelLevel - (await getPreviousReadingFuelLevel(sensor.id, reading.timestamp)))
//           : undefined,
//       }
//     });
//   }
// }

// async function getPreviousReadingFuelLevel(sensorId: string, before: Date): Promise<number> {
//   const previous = await prisma.sensorReading.findFirst({
//     where: {
//       sensorId,
//       timestamp: { lt: before }
//     },
//     orderBy: { timestamp: 'desc' }
//   });
//   return previous?.fuelLevel || 0;
// }

// function parseSensorData(rawData: string): SensorData {
//   try {
//     // Extract the JSON part from the string
//     const jsonStart = rawData.indexOf('{');
//     const jsonEnd = rawData.lastIndexOf('}') + 1;
//     const jsonString = rawData.slice(jsonStart, jsonEnd);
    
//     // Parse the JSON
//     const data = JSON.parse(jsonString);
    
//     // Validate the data structure
//     if (
//       !data.sensorCode ||
//       typeof data.fuelLevel !== 'number' ||
//       typeof data.distanceKm !== 'number' ||
//       typeof data.locationLat !== 'number' ||
//       typeof data.locationLong !== 'number' ||
//       !data.timestamp
//     ) {
//       throw new Error('Invalid sensor data structure');
//     }
    
//     return data;
//   } catch (error) {
//     console.error('Error parsing sensor data:', error);
//     throw new Error('Failed to parse sensor data');
//   }
// }

// // Example usage:
// // const inputData = "📤 Published for SIM-SENSOR-007: {...}";
// // processSensorData(inputData).catch(console.error);