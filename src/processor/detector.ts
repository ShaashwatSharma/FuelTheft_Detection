// // src/processor/detector.ts
// import prisma from '../lib/prisma';
// import { AlertType } from '../generated/prisma';
// import { spawn } from 'child_process';

// const ML_SCRIPT_PATH = 'src/ml/predict_event.py';

// async function predictEvent(input: any): Promise<string> {
//   return new Promise((resolve, reject) => {
//     const py = spawn('python3', [ML_SCRIPT_PATH]);

//     let output = '';
//     let error = '';

//     py.stdout.on('data', (data) => (output += data.toString()));
//     py.stderr.on('data', (data) => (error += data.toString()));

//     py.on('close', (code) => {
//       if (code !== 0 || error) return reject(error);
//       try {
//         const result = JSON.parse(output);
//         if (result.error) return reject(result.error);
//         resolve(result.prediction);
//       } catch (err) {
//         reject('Failed to parse Python output: ' + output);
//       }
//     });

//     py.stdin.write(JSON.stringify(input));
//     py.stdin.end();
//   });
// }

// export async function runDetection() {
//   console.log('🔍 Running ML-based fuel event detection...');

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

//       const fuelDiff = curr.fuelLevel - prev.fuelLevel;
//       // const speed = curr.speed || 0;
//       const locationDelta = Math.sqrt(
//         Math.pow(curr.locationLat - prev.locationLat, 2) +
//         Math.pow(curr.locationLong - prev.locationLong, 2)
//       );
//       const timeDelta =
//         (new Date(curr.timestamp).getTime() - new Date(prev.timestamp).getTime()) / 1000;

//       const timeDeltaHr = timeDelta / 3600;

//       const distanceDiff = curr.distanceKm - prev.distanceKm;
//       const speed = timeDeltaHr > 0 ? distanceDiff / timeDeltaHr : 0;

//       let prediction: string;
//       try {
//         prediction = await predictEvent({ fuel_diff: fuelDiff, speed, location_delta: locationDelta, time_delta: timeDelta });// Call the ML model
//       } catch (err) {
//         console.error(`⚠️ ML prediction failed for ${sensor.sensorCode}:`, err);
//         continue;
//       }

//       let type: AlertType | null = null;
//       let notes = '';

//       if (prediction === 'THEFT') {
//         type = AlertType.THEFT;
//         notes = `ML detected theft: drop of ${Math.abs(fuelDiff)}L`;
//       } else if (prediction === 'REFUEL') {
//         type = AlertType.REFUEL;
//         notes = `ML detected refueling: rise of ${fuelDiff}L`;
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
//               fuelDropLitres: Math.abs(fuelDiff),
//               notes,
//               vehicleId: sensor.vehicleId,
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

//           console.log(`✅ ML-${type} logged for ${sensor.sensorCode}: ${notes}`);
//         }
//       }
//     }
//   }

//   console.log('✅ Detection completed.');
// }














import prisma from '../lib/prisma';
import { AlertType } from '../generated/prisma'; 

const FUEL_DROP_THRESHOLD = 10;
const FUEL_RISE_THRESHOLD = 10;

export async function runDetection() {
  console.log('🔍 Running event detection...');

  const sensors = await prisma.sensor.findMany({
    include: {
      readings: {
        orderBy: { timestamp: 'asc' },
      },
      vehicle: true,
    },
  });

  for (const sensor of sensors) {
    const readings = sensor.readings;

    for (let i = 1; i < readings.length; i++) {
      const prev = readings[i - 1];
      const curr = readings[i];
      const diff = curr.fuelLevel - prev.fuelLevel;

      let type: AlertType | null = null;
      let notes = '';

      if (diff <= -FUEL_DROP_THRESHOLD) {
        type = AlertType.THEFT;
        notes = `Sudden drop of ${Math.abs(diff)}L`;
      } else if (diff >= FUEL_RISE_THRESHOLD) {
        type = AlertType.REFUEL;
        notes = `Sudden rise of ${diff}L`;
      }

      if (type) {
        const exists = await prisma.event.findFirst({
          where: {
            vehicleId: sensor.vehicleId,
            startTime: prev.timestamp,
          },
        });

        if (!exists) {
        await prisma.event.create({
            data: {
                type,
                startTime: prev.timestamp,
                endTime: curr.timestamp,
                fuelDropLitres: Math.abs(diff),
                notes,
                vehicleId: sensor.vehicleId,
            },
          });

        await prisma.alert.create({
            data: {
                type,
                timestamp: curr.timestamp,
                description: notes,
                locationLat: curr.locationLat,
                locationLong: curr.locationLong,
                sensorId: sensor.id,
            },
        });


          console.log(`✅ ${type} event logged for ${sensor.sensorCode} (${notes})`);
        }
      }
    }
  }

  console.log('✅ Detection completed.');
}
