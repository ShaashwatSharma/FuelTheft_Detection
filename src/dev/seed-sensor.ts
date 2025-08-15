#!/usr/bin/env ts-node

/**
 * Minimal dataset generator (TypeScript) that writes SensorReading rows using Prisma.
 * Mirrors the Python script's behavior, adapted to your Prisma schema.
 *
 * Usage:
 *   ts-node scripts/generateMinimalDataset.ts \
 *     --sensors 5 \
 *     --hours 24 \
 *     --freq 5 \
 *     --seed 2025 \
 *     --theft_prob 0.004 \
 *     --refuel_prob 0.003 \
 *     --drop_prob 0.008
 *
 * Notes:
 * - Requires existing Sensors in DB. Use --sensors to choose how many to use (from earliest by sensorCode).
 * - Creates topic per sensor: `sensors/<sensorCode>`.
 * - Satisfies non-null fields in SensorReading.
 */

import { PrismaClient } from '../generated/prisma'; // adjust path if needed
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

// ---------- CLI ----------
const argv = yargs(hideBin(process.argv))
  .option('sensors', { type: 'number', default: 4, describe: 'Number of sensors to simulate' })
  .option('hours', { type: 'number', default: 12, describe: 'Total simulation horizon in hours' })
  .option('freq', { type: 'number', default: 5, describe: 'Reading frequency (minutes)' })
  .option('seed', { type: 'number', default: 2025, describe: 'PRNG seed' })
  .option('theft_prob', { type: 'number', default: 0.004, describe: 'Probability of a theft event per tick' })
  .option('refuel_prob', { type: 'number', default: 0.003, describe: 'Probability of a refuel event per tick' })
  .option('drop_prob', { type: 'number', default: 0.008, describe: 'Probability of a small drop event per tick' })
  .option('base_lat', { type: 'number', default: 12.9716, describe: 'Base latitude' })
  .option('base_lon', { type: 'number', default: 77.5946, describe: 'Base longitude' })
  .help()
  .strict()
  .parseSync();

const prisma = new PrismaClient();

// ---------- PRNG (deterministic) ----------
function mulberry32(seed: number) {
  let t = seed >>> 0;
  return function () {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(argv.seed);

function randFloat(min: number, max: number, dp = 2) {
  const v = min + (max - min) * rand();
  const f = parseFloat(v.toFixed(dp));
  return f;
}
function randInt(min: number, max: number) {
  return Math.floor(min + (max - min + 1) * rand());
}
function randNormal(mean = 0, sd = 1) {
  // Box-Muller
  let u = 0, v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  return mean + z * sd;
}
function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

// ---------- Helpers ----------
function truncateToFreqUTC(date: Date, minutes: number) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes(), 0, 0));
  const m = d.getUTCMinutes();
  const remainder = m % minutes;
  if (remainder !== 0) d.setUTCMinutes(m - remainder, 0, 0);
  return d;
}

type SensorLite = { id: string; sensorCode: string; vehicleId: string; };

async function pickSensors(limit: number): Promise<SensorLite[]> {
  const sensors = await prisma.sensor.findMany({
    orderBy: { sensorCode: 'asc' },
    select: { id: true, sensorCode: true, vehicleId: true },
    take: limit,
  });
  if (sensors.length < limit) {
    throw new Error(`Requested ${limit} sensors but only found ${sensors.length}. Create sensors first or lower --sensors.`);
  }
  return sensors;
}

/**
 * Generate readings for one sensor and insert in batches.
 */
async function generateForSensor(sensor: SensorLite, opts: {
  startUTC: Date;
  periods: number;
  freqMinutes: number;
  theftProb: number;
  refuelProb: number;
  dropProb: number;
  baseLat: number;
  baseLon: number;
}) {
  // Vehicle/sensor-specific dynamics
  const tankSize = randFloat(150, 350, 2);
  const mileageKmPerL = randFloat(2.5, 5.0, 2);
  let fuel = randFloat(0.5 * tankSize, 0.9 * tankSize, 2);
  let prevFuel = fuel;

  // Start position: slight jitter from base
  let lat = opts.baseLat + randNormal(0, 0.01);
  let lon = opts.baseLon + randNormal(0, 0.01);

  // Synthetic odometer (km)
  let odometerKm = randFloat(5000, 80000, 2);
  let angle = randInt(0, 359);

  const BATCH: any[] = [];
  const BATCH_SIZE = 1000;

  for (let i = 0; i < opts.periods; i++) {
    const t = new Date(opts.startUTC.getTime() + i * opts.freqMinutes * 60_000);
    const hour = t.getUTCHours();

    // Day/night movement pattern
    const isDay = hour >= 6 && hour <= 21;
    const meanSpeed = isDay ? 32.0 : 5.0;
    const speedSd = 10.0;
    const moveFlag = rand() > (isDay ? 0.25 : 0.7);
    const rawSpeed = moveFlag ? Math.max(0, randNormal(meanSpeed, speedSd)) : 0;
    const speed = parseFloat(rawSpeed.toFixed(2));

    const distanceKm = parseFloat((speed * (opts.freqMinutes / 60.0)).toFixed(3));
    odometerKm = parseFloat((odometerKm + distanceKm).toFixed(3));

    // Expected burn from driving
    const expectedBurn = mileageKmPerL > 1e-3 ? distanceKm / mileageKmPerL : 0;

    // Random events
    let eventType: 'NORMAL' | 'THEFT' | 'REFUEL' | 'DROP' = 'NORMAL';
    let theftDrop = 0.0;
    let refuelAdd = 0.0;

    const r = rand();
    if (r < opts.theftProb && fuel > 10) {
      theftDrop = randFloat(5.0, Math.min(30.0, fuel), 2);
      eventType = 'THEFT';
    } else {
      const r2 = rand();
      if (r2 < opts.refuelProb && fuel < tankSize * 0.95) {
        refuelAdd = randFloat(10.0, Math.min(60.0, tankSize - fuel), 2);
        eventType = 'REFUEL';
      } else {
        const r3 = rand();
        if (r3 < opts.dropProb && fuel > 5.0) {
          theftDrop = randFloat(1.0, Math.min(5.0, fuel), 2);
          eventType = 'DROP';
        }
      }
    }

    const noise = randNormal(0, 0.15);
    let newFuel = fuel - expectedBurn - theftDrop + refuelAdd + noise;
    newFuel = clamp(parseFloat(newFuel.toFixed(2)), 0, tankSize);

    // Move position slightly
    if (speed > 0.5) {
      lat += randNormal(0, 0.0015);
      lon += randNormal(0, 0.0015);
    } else {
      lat += randNormal(0, 0.0002);
      lon += randNormal(0, 0.0002);
    }
    const locationLat = parseFloat(lat.toFixed(6));
    const locationLong = parseFloat(lon.toFixed(6));

    // Other telemetry
    const ignitionStatus = speed > 0.5 ? 'ON' : 'OFF';
    const isOverSpeed = speed > 80.0;
    const sats = isDay ? randInt(7, 12) : randInt(4, 10);
    const hdop = randFloat(0.7, 2.5, 2);
    const pdop = randFloat(1.2, 4.0, 2);
    const altitude = randFloat(150, 600, 1);
    const priority = randInt(0, 3);
    const deviceVoltage = randFloat(12.0, 14.4, 2);
    angle = (angle + randInt(-25, 25) + 360) % 360;

    const fuel_diff = parseFloat((newFuel - prevFuel).toFixed(2));

    // Map event type to an integer for eventId
    // 0=normal, 1=theft, 2=refuel, 3=drop
    const eventId =
      eventType === 'THEFT' ? 1 :
      eventType === 'REFUEL' ? 2 :
      eventType === 'DROP' ? 3 : 0;

    // Topic per sensor
    const topic = `sensors/${sensor.sensorCode}`;

    // Build SensorReading row (all non-nullable fields filled)
    BATCH.push({
      timestamp: t,
      fuelLevel: newFuel,
      distanceKm,
      locationLat,
      locationLong,
      speed,
      ignitionStatus,
      odometer: odometerKm,
      deviceVoltage,
      sats,
      hdop,
      pdop,
      angle,
      altitude,
      priority,
      eventId,
      raw: {
        source: 'ts-generator',
        seed: argv.seed,
        sim: {
          tankSize,
          mileageKmPerL,
          expectedBurn,
          theftDrop,
          refuelAdd,
          noise,
          eventType,
          fuel_diff,
          isOverSpeed,
        },
      },
      topic,
      processed: false,
      sensorId: sensor.id,
    });

    // Flush periodically to keep memory/SQL payload reasonable
    if (BATCH.length >= BATCH_SIZE) {
      await prisma.sensorReading.createMany({ data: BATCH, skipDuplicates: true });
      BATCH.length = 0;
    }

    prevFuel = newFuel;
    fuel = newFuel;
  }

  if (BATCH.length > 0) {
    await prisma.sensorReading.createMany({ data: BATCH, skipDuplicates: true });
  }
}

async function main() {
  const {
    sensors: sensorsCount,
    hours,
    freq,
    theft_prob,
    refuel_prob,
    drop_prob,
    base_lat,
    base_lon,
  } = argv;

  // Align start time to the frequency (UTC), matching python's "now() in UTC"
  const now = new Date();
  const startUTC = truncateToFreqUTC(now, freq);

  const periods = Math.floor((hours * 60) / freq);
  if (periods <= 0) {
    throw new Error(`Computed periods is ${periods}. Check --hours and --freq.`);
  }

  const sensors = await pickSensors(sensorsCount);

  console.log(`🛠  Generating ${periods} readings per sensor × ${sensors.length} sensors`);
  console.log(`     Start (UTC): ${startUTC.toISOString()} | freq: ${freq} min | horizon: ${hours}h`);
  console.log(`     Probs: theft=${theft_prob}, refuel=${refuel_prob}, drop=${drop_prob}`);

  for (const s of sensors) {
    await generateForSensor(s, {
      startUTC,
      periods,
      freqMinutes: freq,
      theftProb: theft_prob,
      refuelProb: refuel_prob,
      dropProb: drop_prob,
      baseLat: base_lat,
      baseLon: base_lon,
    });
    // Update lastSeen for niceness
    await prisma.sensor.update({
      where: { id: s.id },
      data: { lastSeen: new Date() },
    });
    console.log(`  ✓ Inserted readings for ${s.sensorCode}`);
  }

  console.log('✅ Done.');
}

main()
  .catch((e) => {
    console.error('❌ Error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });










// import prisma from '../lib/prisma';

// async function main() {
//   console.log('🌱 Seeding Dev Data...');

//   // Create 10 Routes
//   const routes = [];
//   for (let i = 1; i <= 10; i++) {
//     const route = await prisma.route.upsert({
//       where: { name: `Route ${i}` },
//       update: {},
//       create: {
//         name: `Route ${i}`,
//         startPoint: `Depot ${i}`,
//         endPoint: `Terminal ${i}`,
//       },
//     });
//     routes.push(route);
//   }

//   // Create 10 Vehicles with Drivers and Sensors
//   for (let i = 1; i <= 10; i++) {
//     const vehicle = await prisma.vehicle.upsert({
//       where: { registrationNo: `TEST-BUS-${i.toString().padStart(3, '0')}` },
//       update: {},
//       create: {
//         registrationNo: `TEST-BUS-${i.toString().padStart(3, '0')}`,
//         model: 'Tata Starbus',
//         tankSize: 200 + i * 10,
//         mileageEst: 5 + i * 0.1,
//         routeId: routes[i % routes.length].id,
//         driver: {
//           create: {
//             name: `Driver ${i}`,
//             phone: `99999999${i.toString().padStart(2, '0')}`,
//             licenseNo: `DL1234${i.toString().padStart(3, '0')}`,
//           },
//         },
//       },
//     });

//     await prisma.sensor.upsert({
//       where: { sensorCode: `SIM-SENSOR-${i.toString().padStart(3, '0')}` },
//       update: {},
//       create: {
//         sensorCode: `SIM-SENSOR-${i.toString().padStart(3, '0')}`,
//         vehicleId: vehicle.id,
//       },
//     });
//   }

//   console.log('✅ Dev Data Seeding Completed!');
// }

// main()
//   .catch((e) => {
//     console.error(e);
//     process.exit(1);
//   })
//   .finally(async () => {
//     await prisma.$disconnect();
//   });



















// // import prisma from '../lib/prisma';

// // async function main() {
// //   const sensor = await prisma.sensor.upsert({
// //     where: { sensorCode: 'SIM-SENSOR-007' },
// //     update: {},
// //     create: {
// //       sensorCode: 'SIM-SENSOR-007',
// //       isActive: true,
// //       vehicle: {
// //         create: {
// //           registrationNo: 'TEST-1240',
// //           model: 'Test Bus',
// //           capacity: 80,
// //           mileageEst: 3.5,
// //         },
// //       },
// //     },
// //   });

// //   console.log('✅ Sensor created:', sensor);
// // }

// // main().catch(e => {
// //   console.error(e);
// //   process.exit(1);
// // });
