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

//   // const [curr, prev] = readings;
// const [prev, curr] = readings;
//   const timeDeltaSec =
//     (new Date(curr.timestamp).getTime() - new Date(prev.timestamp).getTime()) / 1000;

//   if (timeDeltaSec <= 0 || isNaN(timeDeltaSec)) {
//     console.warn('⚠️ Invalid time delta. Skipping detection.');
//     return;
//   }

//   const fuelDiff = curr.fuelLevel - prev.fuelLevel;
//   const locationDelta = Math.sqrt(
//     Math.pow(curr.locationLat - prev.locationLat, 2) +
//     Math.pow(curr.locationLong - prev.locationLong, 2)
//   );

//   const speed = curr.distanceKm / timeDeltaSec;

//   if (
//     isNaN(fuelDiff) || isNaN(speed) ||
//     isNaN(locationDelta) || isNaN(timeDeltaSec)
//   ) {
//     console.warn('⚠️ Skipping detection due to NaN values in input.');
//     return;
//   }

//   const input = {
//     fuel_diff: fuelDiff,
//     speed,
//     location_delta: locationDelta,
//     time_delta: timeDeltaSec,
//   };

//   try {
//     const response = await axios.post('http://host.docker.internal:5001/predict', input);

//     if (response.data?.prediction) {
//       console.log(`✅ Model prediction: ${response.data.prediction}`);
//       // (Optional) Save event to DB here
//     } else {
//       console.warn('⚠️ No prediction returned from model API.');
//     }
//   } catch (error) {
//     if (error instanceof Error) {
//       console.error('❌ Failed to get prediction from model API:', error.message);
//     } else {
//       console.error('❌ Failed to get prediction from model API:', error);
//     }
//     if (
//       typeof error === 'object' &&
//       error !== null &&
//       'response' in error &&
//       typeof (error as any).response === 'object' &&
//       (error as any).response !== null &&
//       'data' in (error as any).response
//     ) {
//       console.error('🔍 API response error:', (error as any).response.data);
//     }
//   }
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
