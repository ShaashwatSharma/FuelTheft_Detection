import prisma from '../lib/prisma';
import axios from 'axios';
import { AlertType } from '../generated/prisma'; 

export async function runDetection() {
  console.log('🔍 Running event detection...');

  const sensors = await prisma.sensor.findMany({
    include: { vehicle: true },
  });

  for (const sensor of sensors) {
    const unprocessedReadings = await prisma.sensorReading.findMany({
      where: { sensorId: sensor.id, processed: false },
      orderBy: { timestamp: 'asc' },
    });

    if (unprocessedReadings.length === 0) continue;
    

    let lastProcessed = await prisma.sensorReading.findFirst({
      where: {
        sensorId: sensor.id,
        processed: true,
      },
      orderBy: { timestamp: 'desc' },
    });

    for (const curr of unprocessedReadings) {
      if (!lastProcessed) {
        console.log(`ℹ️ Initializing: marking first reading for ${sensor.sensorCode} as processed.`);
        await prisma.sensorReading.update({
          where: { id: curr.id },
          data: { processed: true },
        });
        lastProcessed = curr;
        continue;
      }

      const input = {
        fuelLevel: curr.fuelLevel,
        previous_fuel_level: lastProcessed.fuelLevel,
        distanceKm: curr.distanceKm ?? 0,
        locationLat: curr.locationLat ?? 0,
        locationLong: curr.locationLong ?? 0,
        timestamp: curr.timestamp.toISOString(),
      };

      try {
        const response = await axios.post('http://model-service:5000/predict', input);
        const rawPrediction = response.data?.prediction;
        const prediction = rawPrediction?.toUpperCase() as AlertType;

        if (prediction && Object.values(AlertType).includes(prediction)) {
          console.log(`✅ Prediction for ${sensor.sensorCode}: ${prediction}`);

          const notes = `Predicted by ML at ${new Date().toISOString()}`;

          await prisma.event.create({
            data: {
              sensorId: sensor.id,
              vehicleId: sensor.vehicleId,
              type: prediction,
              startTime: curr.timestamp,
              fuelDropLitres: input.previous_fuel_level - input.fuelLevel,
              notes,
            },
          });

          await prisma.alert.create({
            data: {
              type: prediction,
              timestamp: curr.timestamp,
              description: notes,
              locationLat: curr.locationLat,
              locationLong: curr.locationLong,
              sensorId: sensor.id,
            },
          });
        }

        await prisma.sensorReading.update({
          where: { id: curr.id },
          data: { processed: true },
        });

        // Update reference for next loop
        lastProcessed = curr;

      } catch (error: any) {
        console.error(`❌ Prediction error for ${sensor.sensorCode}:`, error.message);
        if (error.response?.data) {
          console.error('🔍 Model error details:', error.response.data);
        }
      }
    }
  }
}










// // src/processor/detector.ts
// import prisma from '../lib/prisma';
// import axios from 'axios';
// import { AlertType } from '../generated/prisma'; 

// export async function runDetection() {
//   console.log('🔍 Running event detection...');

//   const sensors = await prisma.sensor.findMany({
//     include: { vehicle: true },
//   });

//   for (const sensor of sensors) {
//     const unprocessed = await prisma.sensorReading.findFirst({
//       where: { sensorId: sensor.id, processed: false },
//       orderBy: { timestamp: 'asc' },
//     });

//     if (!unprocessed) continue;

//     const previous = await prisma.sensorReading.findFirst({
//       where: {
//         sensorId: sensor.id,
//         timestamp: { lt: unprocessed.timestamp },
//         processed: true,
//       },
//       orderBy: { timestamp: 'desc' },
//     });

//     // CASE 1: No previous processed reading → mark as processed, skip detection
//     if (!previous) {
//       console.log(`ℹ️ Initializing: marking oldest reading for ${sensor.sensorCode} as processed.`);
//       await prisma.sensorReading.update({
//         where: { id: unprocessed.id },
//         data: { processed: true },
//       });
//       continue;
//     }

//     const input = {
//       fuelLevel: unprocessed.fuelLevel,
//       previous_fuel_level: previous.fuelLevel,
//       distanceKm: unprocessed.distanceKm ?? 0,
//       locationLat: unprocessed.locationLat ?? 0,
//       locationLong: unprocessed.locationLong ?? 0,
//       timestamp: unprocessed.timestamp.toISOString(),
//     };

//     try {
//       const response = await axios.post('http://model-service:5000/predict', input);
//       const rawPrediction = response.data?.prediction;
//         const prediction = rawPrediction?.toUpperCase() as AlertType;

//         if (prediction && Object.values(AlertType).includes(prediction)) {
//           console.log(`✅ Prediction for ${sensor.sensorCode}: ${prediction}`);

//           await prisma.event.create({
//             data: {
//               sensorId: sensor.id,
//               vehicleId: sensor.vehicleId,
//               type: prediction,
//               startTime: unprocessed.timestamp,
//               fuelDropLitres: input.previous_fuel_level - input.fuelLevel,
//               notes: `Predicted by ML at ${new Date().toISOString()}`,
//             },
//           });
        

//       }
//       console.log(`✅ Prediction for ${sensor.sensorCode}: ${prediction}`);

//       await prisma.sensorReading.update({
//         where: { id: unprocessed.id },
//         data: { processed: true },
//       });

//     } catch (error: any) {
//       console.error(`❌ Prediction error for ${sensor.sensorCode}:`, error.message);
//       if (error.response?.data) {
//         console.error('🔍 Model error details:', error.response.data);
//       }
//     }
//   }
// }





























// import prisma from '../lib/prisma';
// import { spawn } from 'child_process';
// import { AlertType } from '../generated/prisma'; 
// export async function runDetection() {
//   console.log('🔍 Running event detection...');

//   const sensors = await prisma.sensor.findMany({
//     include: { vehicle: true },
//   });

//   for (const sensor of sensors) {
//     const unprocessed = await prisma.sensorReading.findFirst({
//       where: {
//         sensorId: sensor.id,
//         processed: false,
//       },
//       orderBy: { timestamp: 'asc' },
//     });

//     if (!unprocessed) continue;

//     const previous = await prisma.sensorReading.findFirst({
//       where: {
//         sensorId: sensor.id,
//         timestamp: { lt: unprocessed.timestamp },
//         processed: true,
//       },
//       orderBy: { timestamp: 'desc' },
//     });

//     if (!previous) {
//       console.log(`ℹ️ Initializing: marking oldest reading for ${sensor.sensorCode} as processed.`);
//       await prisma.sensorReading.update({
//         where: { id: unprocessed.id },
//         data: { processed: true },
//       });
//       continue;
//     }

//     const input = {
//       fuelLevel: unprocessed.fuelLevel,
//       previous_fuel_level: previous.fuelLevel,
//       distanceKm: unprocessed.distanceKm,
//       locationLat: unprocessed.locationLat,
//       locationLong: unprocessed.locationLong,
//       timestamp: new Date(unprocessed.timestamp).toISOString(),
//     };

//     const py = spawn('python', ['src/ml/model_runner.py']);

//     const prediction = await new Promise<string | null>((resolve) => {
//       let result = '';
//       let error = '';

//       py.stdout.on('data', (data) => result += data.toString());
//       py.stderr.on('data', (data) => error += data.toString());

//       py.on('close', () => {
//         if (error) {
//           console.error(`❌ Python error for ${sensor.sensorCode}:`, error);
//           resolve(null);
//         } else {
//           try {
//             const parsed = JSON.parse(result);
//             resolve(parsed.prediction ?? null);
//           } catch (e) {
//             console.error(`❌ Invalid output for ${sensor.sensorCode}:`, result);
//             resolve(null);
//           }
//         }
//       });

//       py.stdin.write(JSON.stringify(input));
//       py.stdin.end();
//     });

//     if (prediction) {
//       console.log(`✅ Prediction for ${sensor.sensorCode}: ${prediction}`);

//       await prisma.event.create({
//         data: {
//           sensorId: sensor.id,
//           vehicleId: sensor.vehicleId,
//           type: prediction as AlertType,
//           startTime: unprocessed.timestamp,
//           fuelDropLitres: previous.fuelLevel - unprocessed.fuelLevel,
//           notes: `Predicted by ML at ${new Date().toISOString()}`,
//         },
//       });
//     }

//     await prisma.sensorReading.update({
//       where: { id: unprocessed.id },
//       data: { processed: true },
//     });
//   }
// }























// // src/processor/detector.ts
// import prisma from '../lib/prisma';
// import axios from 'axios';

// export async function runDetection() {
//   console.log('🔍 Running event detection...');

//   const sensors = await prisma.sensor.findMany({
//     include: { vehicle: true },
//   });

//   for (const sensor of sensors) {
//     const unprocessed = await prisma.sensorReading.findFirst({
//       where: {
//         sensorId: sensor.id,
//         processed: false,
//       },
//       orderBy: { timestamp: 'asc' }, // oldest unprocessed first
//     });

//     if (!unprocessed) continue;

//     // Try to get the latest *processed* reading before this one
//     const previous = await prisma.sensorReading.findFirst({
//       where: {
//         sensorId: sensor.id,
//         timestamp: { lt: unprocessed.timestamp },
//         processed: true,
//       },
//       orderBy: { timestamp: 'desc' },
//     });

//     // CASE 1: No processed readings yet → mark the first one and skip
//     if (!previous) {
//       console.log(`ℹ️ Initializing: marking oldest reading for ${sensor.sensorCode} as processed.`);
//       await prisma.sensorReading.update({
//         where: { id: unprocessed.id },
//         data: { processed: true },
//       });
//       continue;
//     }

//     // CASE 2: Normal detection logic
//     const input = {
//       bus_id: sensor.vehicleId,
//       sensor_id: sensor.id,
//       fuel_level: unprocessed.fuelLevel,
//       fuel_drop: previous.fuelLevel - unprocessed.fuelLevel,
//       hour: new Date(unprocessed.timestamp).getHours(),
//       minute: new Date(unprocessed.timestamp).getMinutes(),
//     };

//     try {
//       const response = await axios.post('http://host.docker.internal:5001/predict', input);
//       const prediction = response.data?.prediction;

//       if (prediction) {
//         console.log(`✅ Prediction for ${sensor.sensorCode}: ${prediction}`);

//         await prisma.event.create({
//           data: {
//             sensorId: sensor.id,
//             vehicleId: sensor.vehicleId,
//             type: prediction,
//             startTime: unprocessed.timestamp,
//             fuelDropLitres: input.fuel_drop,
//             notes: `Predicted by ML at ${new Date().toISOString()}`,
//           },
//         });
//       }

//       await prisma.sensorReading.update({
//         where: { id: unprocessed.id },
//         data: { processed: true },
//       });

//     } catch (error: any) {
//       console.error(`❌ Prediction error for ${sensor.sensorCode}:`, error.message);
//       if (error.response?.data) {
//         console.error('🔍 Model error details:', error.response.data);
//       }
//     }
//   }
// }













// // src/processor/detector.ts
// import prisma from '../lib/prisma';
// import axios from 'axios';

// export async function runDetection() {
//   console.log('🔍 Running event detection...');

//   const sensors = await prisma.sensor.findMany({
//     include: { vehicle: true },
//   });

//   for (const sensor of sensors) {
//     const unprocessed = await prisma.sensorReading.findFirst({
//       where: {
//         sensorId: sensor.id,
//         processed: false,
//       },
//       orderBy: { timestamp: 'desc' },
//     });

//     if (!unprocessed) continue;

//     const previous = await prisma.sensorReading.findFirst({
//       where: {
//         sensorId: sensor.id,
//         timestamp: { lt: unprocessed.timestamp },
//         processed: true,
//       },
//       orderBy: { timestamp: 'desc' },
//     });

//     if (!previous) {
//       console.log(`ℹ️ No previous processed reading for ${sensor.sensorCode}. Skipping.`);
//       continue;
//     }

//     const input = {
//       bus_id: sensor.vehicleId,
//       sensor_id: sensor.id,
//       fuel_level: unprocessed.fuelLevel,
//       fuel_drop: previous.fuelLevel - unprocessed.fuelLevel,
//       hour: new Date(unprocessed.timestamp).getHours(),
//       minute: new Date(unprocessed.timestamp).getMinutes(),
//     };

//     try {
//       const response = await axios.post('http://host.docker.internal:5001/predict', input);
//       const prediction = response.data?.prediction;

//       if (prediction) {
//         console.log(`✅ Prediction for ${sensor.sensorCode}: ${prediction}`);

//         // Save event
//         await prisma.event.create({
//           data: {
//             sensorId: sensor.id,
//             vehicleId: sensor.vehicleId,
//             type: prediction,
//             startTime: unprocessed.timestamp,
//             fuelDropLitres: input.fuel_drop,
//             notes: `Predicted by ML at ${new Date().toISOString()}`
//           },
//         });
//       }

//       // Mark as processed (even if prediction fails to avoid reprocessing)
//       await prisma.sensorReading.update({
//         where: { id: unprocessed.id },
//         data: { processed: true },
//       });

//     } catch (error: any) {
//       console.error(`❌ Prediction error for ${sensor.sensorCode}:`, error.message);
//       if (error.response?.data) {
//         console.error('🔍 Model error details:', error.response.data);
//       }
//     }
//   }
// }










// export async function runDetection() {
//   console.log('🔍 Running event detection...');

//   const sensors = await prisma.sensor.findMany({
//     include: {
//       readings: {
//         orderBy: { timestamp: 'desc' },
//         take: 2,
//       },
//       vehicle: true,
//     },
//   });

//   for (const sensor of sensors) {
//     const readings = sensor.readings;
//     if (readings.length < 2) continue;

//     const [curr, prev] = readings;

//     const timeDeltaSec =
//       (new Date(curr.timestamp).getTime() - new Date(prev.timestamp).getTime()) / 1000;

//     if (timeDeltaSec <= 0 || isNaN(timeDeltaSec)) {
//       console.warn(`⚠️ Invalid time delta for sensor ${sensor.sensorCode}. Skipping.`);
//       continue;
//     }

//     const timestamp = new Date(curr.timestamp);
//     const input = {
//       bus_id: sensor.vehicleId,
//       sensor_id: sensor.id,
//       fuel_level: curr.fuelLevel,
//       fuel_drop: prev.fuelLevel - curr.fuelLevel,
//       hour: new Date(curr.timestamp).getHours(),
//       minute: new Date(curr.timestamp).getMinutes(),
//     };


//     try {
//       const response = await axios.post('http://host.docker.internal:5001/predict', input);
//       if (response.data?.prediction) {
//         console.log(`✅ Prediction for ${sensor.sensorCode}: ${response.data.prediction}`);
//         // Optional: Save event in DB here
//       } else {
//         console.warn(`⚠️ No prediction from model for ${sensor.sensorCode}`);
//       }
//     } catch (error: any) {
//       console.error(`❌ Model API error for sensor ${sensor.sensorCode}:`, error.message);
//       if (error.response?.data) {
//         console.error('🔍 Model error details:', error.response.data);
//       }
//     }
//   }
// }













// // src/processor/detector.ts
// import prisma from '../lib/prisma';
// import axios from 'axios';

// export async function runDetection() {
//   console.log('🔍 Running event detection...');

//   const sensors = await prisma.sensor.findMany({
//     include: {
//       readings: {
//         orderBy: { timestamp: 'desc' },
//         take: 2,
//       },
//     },
//   });

//   for (const sensor of sensors) {
//     const { readings, sensorCode } = sensor;

//     if (readings.length < 2) {
//       console.warn(`⚠️ Not enough readings for ${sensorCode}`);
//       continue;
//     }

//     // Destructure with most recent first due to 'desc' order
//     const [curr, prev] = readings;

//     const timeDeltaSec =
//       (new Date(curr.timestamp).getTime() - new Date(prev.timestamp).getTime()) / 1000;

//     if (timeDeltaSec <= 0 || isNaN(timeDeltaSec)) {
//       console.warn(`⚠️ Invalid time delta for ${sensorCode}. Skipping.`);
//       continue;
//     }

//     const fuelDiff = curr.fuelLevel - prev.fuelLevel;
//     const locationDelta = Math.sqrt(
//       Math.pow(curr.locationLat - prev.locationLat, 2) +
//       Math.pow(curr.locationLong - prev.locationLong, 2)
//     );

//     const speed = curr.distanceKm / timeDeltaSec;

//     if (
//       isNaN(fuelDiff) || isNaN(speed) ||
//       isNaN(locationDelta) || isNaN(timeDeltaSec)
//     ) {
//       console.warn(`⚠️ Skipping ${sensorCode} due to NaN values.`);
//       continue;
//     }

//     const input = {
//       fuel_diff: fuelDiff,
//       speed,
//       location_delta: locationDelta,
//       time_delta: timeDeltaSec,
//     };

//     try {
//       const response = await axios.post('http://host.docker.internal:5001/predict', input);

//       if (response.data?.prediction) {
//         console.log(`✅ ${sensorCode} → Predicted: ${response.data.prediction}`);
//         // TODO: Optionally insert Event into DB here
//       } else {
//         console.warn(`⚠️ ${sensorCode} → No prediction returned.`);
//       }
//     } catch (error) {
//       if (error instanceof Error) {
//         console.error(`❌ ${sensorCode} → Model API error:`, error.message);
//       }

//       if (
//         typeof error === 'object' &&
//         error !== null &&
//         'response' in error &&
//         typeof (error as any).response === 'object' &&
//         (error as any).response !== null &&
//         'data' in (error as any).response
//       ) {
//         console.error(`🔍 ${sensorCode} → API response error:`, (error as any).response.data);
//       }
//     }
//   }

//   console.log('✅ Detection completed.');
// }









// // src/processor/detector.ts
// import prisma from '../lib/prisma';
// import axios from 'axios';

// export async function runDetection() {
//   console.log('🔍 Running event detection...');

//   const readings = await prisma.sensorReading.findMany({
//     orderBy: { timestamp: 'desc' },
//     take: 2,
//   });

//   if (readings.length < 2) {
//     console.warn('⚠️ Not enough sensor readings to run detection.');
//     return;
//   }

//   const [curr, prev] = readings;

//  const input = {
//   fuel_diff: curr.fuelLevel - prev.fuelLevel,
//   speed:
//     (curr.distanceKm ?? 0) /
//     (((new Date(curr.timestamp).getTime() - new Date(prev.timestamp).getTime()) || 1) / 1000),
//   location_delta: Math.sqrt(
//     Math.pow((curr.locationLat ?? 0) - (prev.locationLat ?? 0), 2) +
//     Math.pow((curr.locationLong ?? 0) - (prev.locationLong ?? 0), 2)
//   ),
//   time_delta:
//     ((new Date(curr.timestamp).getTime() - new Date(prev.timestamp).getTime()) || 1) / 1000,
//   curr_fuel_level: curr.fuelLevel,
//   prev_fuel_level: prev.fuelLevel,
// };


// // 👇 Check for NaN before calling the model
// const hasNaN = Object.values(input).some((v) => Number.isNaN(v));
// if (hasNaN) {
//   console.warn("⚠️ Skipping detection: input contains NaN", input);
//   return;
// }


//   try {
//     // const response = await axios.post('http://host.docker.internal:5000/predict', input);
//     // const response = await axios.post('http://model-service:5000/predict', input);
//     const response = await axios.post('http://host.docker.internal:5001/predict', input);



//     if (response.data?.prediction) {
//       console.log(`✅ Model prediction: ${response.data.prediction}`);
//       // (Optional) Save event to DB
//     } else {
//       console.warn('⚠️ No prediction returned from model API.');
//     }
//   } catch (error: any) {
//     console.error('❌ Failed to get prediction from model API:', error.message);
//     if (error.response) {
//       console.error('🔍 API response error:', error.response.data);
//     }
//   }
// }















// import prisma from '../lib/prisma';
// import { AlertType } from '../generated/prisma'; 

// const FUEL_DROP_THRESHOLD = 10;
// const FUEL_RISE_THRESHOLD = 10;

// export async function runDetection() {
//   console.log('🔍 Running event detection...');

//   const sensors = await prisma.sensor.findMany({
//     include: {
//       readings: {
//         orderBy: { timestamp: 'asc' },
//       },
//       vehicle: true,
//     },
//   });

//   for (const sensor of sensors) {
//     const readings = sensor.readings;

//     for (let i = 1; i < readings.length; i++) {
//       const prev = readings[i - 1];
//       const curr = readings[i];
//       const diff = curr.fuelLevel - prev.fuelLevel;

//       let type: AlertType | null = null;
//       let notes = '';

//       if (diff <= -FUEL_DROP_THRESHOLD) {
//         type = AlertType.THEFT;
//         notes = `Sudden drop of ${Math.abs(diff)}L`;
//       } else if (diff >= FUEL_RISE_THRESHOLD) {
//         type = AlertType.REFUEL;
//         notes = `Sudden rise of ${diff}L`;
//       }

//       if (type) {
//         const exists = await prisma.event.findFirst({
//           where: {
//             vehicleId: sensor.vehicleId,
//             startTime: prev.timestamp,
//           },
//         });

//         if (!exists) {
//         await prisma.event.create({
//             data: {
//                 type,
//                 startTime: prev.timestamp,
//                 endTime: curr.timestamp,
//                 fuelDropLitres: Math.abs(diff),
//                 notes,
//                 vehicleId: sensor.vehicleId,
//             },
//           });

//         await prisma.alert.create({
//             data: {
//                 type,
//                 timestamp: curr.timestamp,
//                 description: notes,
//                 locationLat: curr.locationLat,
//                 locationLong: curr.locationLong,
//                 sensorId: sensor.id,
//             },
//         });


//           console.log(`✅ ${type} event logged for ${sensor.sensorCode} (${notes})`);
//         }
//       }
//     }
//   }

//   console.log('✅ Detection completed.');
// }








// // src/processor/testDetector.ts
// import prisma from '../lib/prisma';
// import { AlertType } from '../generated/prisma'; 

// const FUEL_DROP_THRESHOLD = 10;
// const FUEL_RISE_THRESHOLD = 10;

// export async function runDetection() {
//   console.log('🔍 Running event detection...');

//   const sensors = await prisma.sensor.findMany({
//     include: {
//       readings: {
//         orderBy: { timestamp: 'asc' },
//       },
//       vehicle: true,
//     },
//   });

//   for (const sensor of sensors) {
//     const readings = sensor.readings;

//     for (let i = 1; i < readings.length; i++) {
//       const prev = readings[i - 1];
//       const curr = readings[i];
//       const diff = curr.fuelLevel - prev.fuelLevel;

//       let type: AlertType | null = null;
//       let notes = '';

//       if (diff <= -FUEL_DROP_THRESHOLD) {
//         type = AlertType.THEFT;
//         notes = `Sudden drop of ${Math.abs(diff)}L`;
//       } else if (diff >= FUEL_RISE_THRESHOLD) {
//         type = AlertType.REFUEL;
//         notes = `Sudden rise of ${diff}L`;
//       }

//       if (type) {
//         const exists = await prisma.event.findFirst({
//           where: {
//             vehicleId: sensor.vehicleId,
//             startTime: prev.timestamp,
//           },
//         });

//         if (!exists) {
//           await prisma.event.create({
//             data: {
//               type,
//               startTime: prev.timestamp,
//               endTime: curr.timestamp,
//               fuelDropLitres: Math.abs(diff),
//               notes,
//               vehicleId: sensor.vehicleId,
//               sensorId: sensor.id, // ✅ Required now
//             },
//           });

//           await prisma.alert.create({
//             data: {
//               type,
//               timestamp: curr.timestamp,
//               description: notes,
//               locationLat: curr.locationLat,
//               locationLong: curr.locationLong,
//               sensorId: sensor.id,
//             },
//           });

//           console.log(`✅ ${type} event logged for ${sensor.sensorCode} (${notes})`);
//         }
//       }
//     }
//   }

//   console.log('✅ Detection completed.');
// }
