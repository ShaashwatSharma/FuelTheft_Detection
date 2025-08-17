#!/usr/bin/env ts-node
/**
 * Seed base data (5 routes, vehicles, drivers, sensors) and generate readings.
 * - Never inserts a fuelLevel of 0 (auto-refuels before that).
 * - If computed fuel drops below 1 L, force a REFUEL of at least 100 L (capped by tank).
 */

import prisma from '../lib/prisma';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

// ---------- CLI ----------
const argv = yargs(hideBin(process.argv))
  .option('sensors', { type: 'number', default: 5, describe: 'Total sensors to ensure & simulate' })
  .option('hours', { type: 'number', default: 168, describe: 'Total simulation horizon in hours (7 days)' })
  .option('freq', { type: 'number', default: 30, describe: 'Reading frequency (minutes), e.g., 30' })
  .option('seed', { type: 'number', default: 2025, describe: 'PRNG seed' })
  .option('theft_prob', { type: 'number', default: 0.20, describe: 'Probability of a theft event per tick (20%)' })
  .option('refuel_prob', { type: 'number', default: 0.10, describe: 'Probability of a refuel event per tick (10%)' })
  .option('drop_prob', { type: 'number', default: 0.05, describe: 'Probability of a small drop event per tick (5%)' })
  .option('offline_prob', { type: 'number', default: 0.15, describe: 'Probability of sensor going offline (15%)' })
  .option('base_lat', { type: 'number', default: 12.9716, describe: 'Base latitude' })
  .option('base_lon', { type: 'number', default: 77.5946, describe: 'Base longitude' })
  .help()
  .strict()
  .parseSync();

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

// ---------- Safety thresholds (new) ----------
// If computed fuel would go below this, we force a refuel.
const FUEL_MIN_BEFORE_REFUEL = 1.0;     // liters
// How much we must add at minimum when we force a refuel.
const REFUEL_MIN_LITERS = 100.0;
// Upper bound for a single forced refuel (still capped by tank size).
const REFUEL_MAX_LITERS = 180.0;
// After any refuel, keep a tiny headroom below exact cap to avoid "exactly full".
const TANK_HEADROOM = 0.5;

// ---------- Helpers ----------
function truncateToFreqUTC(date: Date, minutes: number) {
  const d = new Date(Date.UTC(
    date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(),
    date.getUTCHours(), date.getUTCMinutes(), 0, 0
  ));
  const m = d.getUTCMinutes();
  const remainder = m % minutes;
  if (remainder !== 0) d.setUTCMinutes(m - remainder, 0, 0);
  return d;
}

type SensorLite = { id: string; sensorCode: string; vehicleId: string };

// Ensure N routes, vehicles, drivers, sensors (idempotent)
async function ensureBaseData(count: number): Promise<SensorLite[]> {
  const sensors: SensorLite[] = [];
  const pad = (n: number) => n.toString().padStart(2, '0');

  for (let i = 1; i <= count; i++) {
    // 1) Route
    const route = await prisma.route.upsert({
      where: { name: `Route ${i}` },
      update: {},
      create: {
        name: `Route ${i}`,
        startPoint: `Depot ${i}`,
        endPoint: `Hub ${i}`,
      },
    });

    // 2) Vehicle
    const reg = `MH12-FT${i.toString().padStart(4, '0')}`;
    const vTank = randInt(250, 300);                 // realistic tank size
    const vMileage = randFloat(2.5, 4.5, 2);         // km/L

    const vehicle = await prisma.vehicle.upsert({
      where: { registrationNo: reg },
      update: {
        routeId: route.id,
        model: `Model-${i}`,
        tankSize: vTank,
        mileageEst: vMileage,
      },
      create: {
        registrationNo: reg,
        externalVehicleId: `EXT-${reg}`,
        model: `Model-${i}`,
        tankSize: vTank,
        mileageEst: vMileage,
        routeId: route.id,
      },
    });

    // 3) Driver (1-1 with Vehicle)
    const phone = `90000000${pad(i)}${pad(i)}`.slice(0, 10);
    await prisma.driver.upsert({
      where: { phone },
      update: { vehicleId: vehicle.id, name: `Driver ${i}` },
      create: {
        name: `Driver ${i}`,
        phone,
        licenseNo: `DL-${i.toString().padStart(6, '0')}`,
        vehicleId: vehicle.id,
      },
    });

    // 4) Sensor (1-1 with Vehicle)
    const sensorCode = `FMB920-${i.toString().padStart(6, '0')}`;
    const sensor = await prisma.sensor.upsert({
      where: { sensorCode },
      update: { vehicleId: vehicle.id, isActive: true, lastSeen: null },
      create: {
        sensorCode,
        isActive: true,
        vehicleId: vehicle.id,
      },
      select: { id: true, sensorCode: true, vehicleId: true },
    });

    sensors.push(sensor);
  }

  return sensors;
}

type SimEvent = 'NORMAL' | 'THEFT' | 'REFUEL' | 'DROP';

/**
 * Generate readings for one sensor and insert in batches.
 * NOTE: Schema-aligned fields only.
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
  // Pull vehicle specs for realism
  const veh = await prisma.vehicle.findUnique({
    where: { id: sensor.vehicleId },
    select: { tankSize: true, mileageEst: true },
  });
  const tankSize = Math.max(250, Math.min(300, veh?.tankSize ?? 280));
  const mileageKmPerL = Math.max(2.0, Math.min(6.0, veh?.mileageEst ?? 3.5));

  // Start fuel safely above 200 L, below tank cap
  let fuel = randFloat(205, Math.min(tankSize - 10, 270), 2);
  let prevFuel = fuel;

  // Start position: slight jitter from base
  let lat = opts.baseLat + randNormal(0, 0.01);
  let lon = opts.baseLon + randNormal(0, 0.01);

  // Synthetic odometer (km)
  let odometerKm = randFloat(25_000, 180_000, 2);

  // Slow drift direction for geo pathing
  let driftLat = randNormal(0, 0.0003);
  let driftLon = randNormal(0, 0.0003);

  // Avoid clustering events too close
  let lastEventTick = -9999;
  const minEventGapTicks = Math.max(2, Math.floor(180 / opts.freqMinutes)); // ~3h

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

    // BALANCED EVENT GENERATION: 70% Normal, 20% Theft, 10% Refuel
    let eventType: SimEvent = 'NORMAL';
    let theftDrop = 0.0;
    let refuelAdd = 0.0;

    const canEvent = (i - lastEventTick) >= minEventGapTicks;
    if (canEvent) {
      const randomValue = rand();
      
      // 70% Normal (0.0 - 0.7)
      if (randomValue < 0.7) {
        eventType = 'NORMAL';
        // Normal fuel consumption only
      }
      // 20% Theft (0.7 - 0.9)
      else if (randomValue < 0.9 && fuel > 30) {
        eventType = 'THEFT';
        theftDrop = randFloat(15.0, Math.min(35.0, fuel * 0.4), 2);
        lastEventTick = i;
      }
      // 10% Refuel (0.9 - 1.0)
      else if (randomValue < 1.0 && fuel < tankSize * 0.9) {
        eventType = 'REFUEL';
        const room = Math.max(10, tankSize - fuel);
        refuelAdd = randFloat(25.0, Math.min(80.0, room), 2);
        lastEventTick = i;
      }
    }

    // Mild measurement noise
    const noise = randNormal(0, 0.08);

    // Compute next fuel, then enforce safety rules
    let newFuel = fuel - expectedBurn - theftDrop + refuelAdd + noise;
    newFuel = parseFloat(newFuel.toFixed(2));

    // ---------- SAFETY GUARD: never store zero; force refuel if < 1 L ----------
    if (newFuel < FUEL_MIN_BEFORE_REFUEL) {
      const maxRoom = Math.max(0, tankSize - newFuel - TANK_HEADROOM);
      // Ensure at least 100 L, but don't exceed available room or REFUEL_MAX_LITERS.
      const forcedAdd = clamp(
        randFloat(REFUEL_MIN_LITERS, Math.min(REFUEL_MAX_LITERS, Math.max(REFUEL_MIN_LITERS, maxRoom))), 
        REFUEL_MIN_LITERS,
        Math.max(REFUEL_MIN_LITERS, maxRoom)
      );
      newFuel = clamp(parseFloat((newFuel + forcedAdd).toFixed(2)), FUEL_MIN_BEFORE_REFUEL, tankSize - TANK_HEADROOM);
      // Mark it as a refuel event; also reset event cooldown.
      if (eventType !== 'REFUEL') {
        eventType = 'REFUEL';
        lastEventTick = i;
      }
      refuelAdd += forcedAdd;
    } else {
      // For general bounds, also avoid exact 0 or exact cap.
      newFuel = clamp(newFuel, FUEL_MIN_BEFORE_REFUEL, tankSize - TANK_HEADROOM);
      newFuel = parseFloat(newFuel.toFixed(2));
    }
    // --------------------------------------------------------------------------

    // Move position slightly
    if (speed > 0.5) {
      lat += randNormal(0, 0.001) + driftLat;
      lon += randNormal(0, 0.001) + driftLon;
    } else {
      lat += randNormal(0, 0.00015) + driftLat * 0.5;
      lon += randNormal(0, 0.00015) + driftLon * 0.5;
    }
    const locationLat = parseFloat(lat.toFixed(6));
    const locationLong = parseFloat(lon.toFixed(6));

    // Other telemetry
    const ignitionStatus = speed > 2.0 ? 'ON' : 'OFF';
    const isOverSpeed = speed > 80.0;
    const deviceVoltage = parseFloat((12.3 + (isDay ? 0.3 : 0.0) + randNormal(0, 0.15)).toFixed(2));

    const fuel_diff = parseFloat((newFuel - prevFuel).toFixed(2));
    const topic = `${sensor.sensorCode}/data`;

    // SENSOR OFFLINE SIMULATION: 15% chance to skip reading (simulate offline sensor)
    const isOffline = rand() < 0.15;
    if (isOffline) {
      console.log(`📡 ${sensor.sensorCode}: Sensor offline at ${t.toISOString()}`);
      continue; // Skip this reading
    }

    // Build SensorReading row (schema-aligned) - ensure no null values in critical fields
    BATCH.push({
      timestamp: t,
      fuelLevel: newFuel || 0, // Ensure fuelLevel is never null
      locationLat: locationLat || 0,
      locationLong: locationLong || 0,
      speed: speed || 0,
      ignitionStatus: ignitionStatus || 'OFF',
      odometerKm: odometerKm || 0,
      deviceVoltage: deviceVoltage || 12.0,
      isOverSpeed: isOverSpeed || false,
      raw: {
        source: 'ts-generator',
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
      sensorId: sensor.id,
    });

    // Flush periodically
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

  const now = new Date();
  const startUTC = truncateToFreqUTC(new Date(now.getTime() - hours * 60 * 60 * 1000), freq);

  const periods = Math.floor((hours * 60) / freq);
  if (periods <= 0) {
    throw new Error(`Computed periods is ${periods}. Check --hours and --freq.`);
  }

  // Ensure base entities exist (exactly N)
  const sensors = await ensureBaseData(sensorsCount);

  console.log(`🛠  Generating ${periods} readings per sensor × ${sensors.length} sensors`);
  console.log(`     Start (UTC): ${startUTC.toISOString()} | freq: ${freq} min | horizon: ${hours}h`);
  console.log(`     Distribution: 70% Normal, 20% Theft, 10% Refuel`);
  console.log(`     Offline simulation: 15% chance per reading`);
  console.log(`     Guards: min fuel=${FUEL_MIN_BEFORE_REFUEL} L, forced refuel ≥ ${REFUEL_MIN_LITERS} L`);

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

    // Update lastSeen
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






















// #!/usr/bin/env ts-node
// /**
//  * Seed base data (5 routes, vehicles, drivers, sensors) and generate readings.
//  * Schema-aligned for current models: uses odometerKm, processed defaults to false.
//  */

// import prisma from '../lib/prisma';
// import yargs from 'yargs';
// import { hideBin } from 'yargs/helpers';

// // ---------- CLI ----------
// const argv = yargs(hideBin(process.argv))
//   .option('sensors', { type: 'number', default: 10, describe: 'Total sensors to ensure & simulate' })
//   .option('hours', { type: 'number', default: 168, describe: 'Total simulation horizon in hours (7 days)' })
//   .option('freq', { type: 'number', default: 30, describe: 'Reading frequency (minutes), e.g., 30' })
//   .option('seed', { type: 'number', default: 2025, describe: 'PRNG seed' })
//   .option('theft_prob', { type: 'number', default: 0.004, describe: 'Probability of a theft event per tick' })
//   .option('refuel_prob', { type: 'number', default: 0.003, describe: 'Probability of a refuel event per tick' })
//   .option('drop_prob', { type: 'number', default: 0.008, describe: 'Probability of a small drop event per tick' })
//   .option('base_lat', { type: 'number', default: 12.9716, describe: 'Base latitude' })
//   .option('base_lon', { type: 'number', default: 77.5946, describe: 'Base longitude' })
//   .help()
//   .strict()
//   .parseSync();

// // ---------- PRNG (deterministic) ----------
// function mulberry32(seed: number) {
//   let t = seed >>> 0;
//   return function () {
//     t += 0x6D2B79F5;
//     let r = Math.imul(t ^ (t >>> 15), 1 | t);
//     r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
//     return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
//   };
// }
// const rand = mulberry32(argv.seed);

// function randFloat(min: number, max: number, dp = 2) {
//   const v = min + (max - min) * rand();
//   const f = parseFloat(v.toFixed(dp));
//   return f;
// }
// function randInt(min: number, max: number) {
//   return Math.floor(min + (max - min + 1) * rand());
// }
// function randNormal(mean = 0, sd = 1) {
//   // Box-Muller
//   let u = 0, v = 0;
//   while (u === 0) u = rand();
//   while (v === 0) v = rand();
//   const z = Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
//   return mean + z * sd;
// }
// function clamp(n: number, lo: number, hi: number) {
//   return Math.max(lo, Math.min(hi, n));
// }

// // ---------- Helpers ----------
// function truncateToFreqUTC(date: Date, minutes: number) {
//   const d = new Date(Date.UTC(
//     date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(),
//     date.getUTCHours(), date.getUTCMinutes(), 0, 0
//   ));
//   const m = d.getUTCMinutes();
//   const remainder = m % minutes;
//   if (remainder !== 0) d.setUTCMinutes(m - remainder, 0, 0);
//   return d;
// }

// type SensorLite = { id: string; sensorCode: string; vehicleId: string };

// // Ensure 5 routes, vehicles, drivers, sensors (idempotent)
// // Returns the sensors to simulate (exactly `count`).
// async function ensureBaseData(count: number): Promise<SensorLite[]> {
//   const sensors: SensorLite[] = [];
//   const pad = (n: number) => n.toString().padStart(2, '0');

//   for (let i = 1; i <= count; i++) {
//     // 1) Route
//     const route = await prisma.route.upsert({
//       where: { name: `Route ${i}` },
//       update: {},
//       create: {
//         name: `Route ${i}`,
//         startPoint: `Depot ${i}`,
//         endPoint: `Hub ${i}`,
//       },
//     });

//     // 2) Vehicle
//     const reg = `MH12-FT${i.toString().padStart(4, '0')}`;
//     // Realistic tank size 250–300 L and mileage 2.5–4.5 km/L
//     const vTank = randInt(250, 300);
//     const vMileage = randFloat(2.5, 4.5, 2);

//     const vehicle = await prisma.vehicle.upsert({
//       where: { registrationNo: reg },
//       update: {
//         routeId: route.id,
//         model: `Model-${i}`,
//         tankSize: vTank,
//         mileageEst: vMileage,
//       },
//       create: {
//         registrationNo: reg,
//         externalVehicleId: `EXT-${reg}`,
//         model: `Model-${i}`,
//         tankSize: vTank,
//         mileageEst: vMileage,
//         routeId: route.id,
//       },
//     });

//     // 3) Driver (1-1 with Vehicle)
//     const phone = `90000000${pad(i)}${pad(i)}`.slice(0, 10); // unique 10-digit-ish
//     await prisma.driver.upsert({
//       where: { phone },
//       update: { vehicleId: vehicle.id, name: `Driver ${i}` },
//       create: {
//         name: `Driver ${i}`,
//         phone,
//         licenseNo: `DL-${i.toString().padStart(6, '0')}`,
//         vehicleId: vehicle.id,
//       },
//     });

//     // 4) Sensor (1-1 with Vehicle)
//     const sensorCode = `FMB920-${i.toString().padStart(6, '0')}`;
//     const sensor = await prisma.sensor.upsert({
//       where: { sensorCode },
//       update: { vehicleId: vehicle.id, isActive: true, lastSeen: null },
//       create: {
//         sensorCode,
//         isActive: true,
//         vehicleId: vehicle.id,
//       },
//       select: { id: true, sensorCode: true, vehicleId: true },
//     });

//     sensors.push(sensor);
//   }

//   return sensors;
// }

// /**
//  * Generate readings for one sensor and insert in batches.
//  * NOTE: Schema-aligned fields only:
//  *  - odometerKm (✅)
//  *  - keep topic and raw for traceability
//  */
// async function generateForSensor(sensor: SensorLite, opts: {
//   startUTC: Date;
//   periods: number;
//   freqMinutes: number;
//   theftProb: number;
//   refuelProb: number;
//   dropProb: number;
//   baseLat: number;
//   baseLon: number;
// }) {
//   // Pull vehicle specs for realism
//   const veh = await prisma.vehicle.findUnique({
//     where: { id: sensor.vehicleId },
//     select: { tankSize: true, mileageEst: true },
//   });
//   const tankSize = Math.max(250, Math.min(300, veh?.tankSize ?? 280));
//   const mileageKmPerL = Math.max(2.0, Math.min(6.0, veh?.mileageEst ?? 3.5));

//   // Start fuel > 200 L, below tank cap
//   let fuel = randFloat(205, Math.min(tankSize - 10, 270), 2);
//   let prevFuel = fuel;

//   // Start position: slight jitter from base
//   let lat = opts.baseLat + randNormal(0, 0.01);
//   let lon = opts.baseLon + randNormal(0, 0.01);

//   // Synthetic odometer (km)
//   let odometerKm = randFloat(25_000, 180_000, 2);

//   // Slow drift direction for geo pathing
//   let driftLat = randNormal(0, 0.0003);
//   let driftLon = randNormal(0, 0.0003);

//   // Avoid clustering events too close
//   let lastEventTick = -9999;
//   const minEventGapTicks = Math.max(2, Math.floor((180 / opts.freqMinutes))); // ~3h

//   const BATCH: any[] = [];
//   const BATCH_SIZE = 1000;

//   for (let i = 0; i < opts.periods; i++) {
//     const t = new Date(opts.startUTC.getTime() + i * opts.freqMinutes * 60_000);
//     const hour = t.getUTCHours();

//     // Day/night movement pattern
//     const isDay = hour >= 6 && hour <= 21;
//     const meanSpeed = isDay ? 32.0 : 5.0;
//     const speedSd = 10.0;
//     const moveFlag = rand() > (isDay ? 0.25 : 0.7);
//     const rawSpeed = moveFlag ? Math.max(0, randNormal(meanSpeed, speedSd)) : 0;
//     const speed = parseFloat(rawSpeed.toFixed(2));

//     const distanceKm = parseFloat((speed * (opts.freqMinutes / 60.0)).toFixed(3));
//     odometerKm = parseFloat((odometerKm + distanceKm).toFixed(3));

//     // Expected burn from driving
//     const expectedBurn = mileageKmPerL > 1e-3 ? distanceKm / mileageKmPerL : 0;

//     // Random events with time-of-day bias and cooldown
//     let eventType: 'NORMAL' | 'THEFT' | 'REFUEL' | 'DROP' = 'NORMAL';
//     let theftDrop = 0.0;
//     let refuelAdd = 0.0;

//     const canEvent = (i - lastEventTick) >= minEventGapTicks;
//     if (canEvent) {
//       // Bias: theft more likely late night; refuel more likely morning/evening
//       const theftBias = (!isDay ? 1.8 : 1.0);
//       const refuelBias = ((hour >= 6 && hour <= 9) || (hour >= 18 && hour <= 21)) ? 1.6 : 1.0;

//       const rT = rand();
//       const rR = rand();

//       // Occasional larger sudden drop (theft)
//       if (rT < (opts.theftProb * theftBias) && fuel > 30) {
//         theftDrop = randFloat(15.0, Math.min(60.0, fuel), 2);
//         eventType = 'THEFT';
//         lastEventTick = i;
//       } else if (rR < (opts.refuelProb * refuelBias) && fuel < tankSize * 0.85) {
//         // Refuel sizeable amount but not exceeding tank
//         const room = Math.max(5, tankSize - fuel);
//         refuelAdd = randFloat(20.0, Math.min(90.0, room), 2);
//         eventType = 'REFUEL';
//         lastEventTick = i;
//       } else {
//         // Occasionally small drops (sensor noise / minor usage quirk)
//         const rD = rand();
//         if (rD < opts.dropProb && fuel > 5.0) {
//           theftDrop = randFloat(0.5, Math.min(3.0, fuel), 2);
//           eventType = 'DROP';
//         }
//       }
//     }

//     // Mild measurement noise
//     const noise = randNormal(0, 0.08);
//     let newFuel = fuel - expectedBurn - theftDrop + refuelAdd + noise;
//     newFuel = clamp(parseFloat(newFuel.toFixed(2)), 0, tankSize);

//     // Move position slightly
//     if (speed > 0.5) {
//       lat += randNormal(0, 0.001) + driftLat;
//       lon += randNormal(0, 0.001) + driftLon;
//     } else {
//       lat += randNormal(0, 0.00015) + driftLat * 0.5;
//       lon += randNormal(0, 0.00015) + driftLon * 0.5;
//     }
//     const locationLat = parseFloat(lat.toFixed(6));
//     const locationLong = parseFloat(lon.toFixed(6));

//     // Other telemetry
//     const ignitionStatus = speed > 2.0 ? 'ON' : 'OFF';
//     const isOverSpeed = speed > 80.0;
//     const deviceVoltage = parseFloat((12.3 + (isDay ? 0.3 : 0.0) + randNormal(0, 0.15)).toFixed(2));

//     const fuel_diff = parseFloat((newFuel - prevFuel).toFixed(2));
//     const topic = `${sensor.sensorCode}/data`;

//     // Build SensorReading row (schema-aligned)
//     BATCH.push({
//       timestamp: t,
//       fuelLevel: newFuel,
//       locationLat,
//       locationLong,
//       speed,
//       ignitionStatus,
//       odometerKm,
//       deviceVoltage,
//       isOverSpeed,
//       raw: {
//         source: 'ts-generator',
//         sim: {
//           tankSize,
//           mileageKmPerL,
//           expectedBurn,
//           theftDrop,
//           refuelAdd,
//           noise,
//           eventType,
//           fuel_diff,
//           isOverSpeed,
//         },
//       },
//       topic,
//       sensorId: sensor.id,
//     });

//     // Flush periodically
//     if (BATCH.length >= BATCH_SIZE) {
//       await prisma.sensorReading.createMany({ data: BATCH, skipDuplicates: true });
//       BATCH.length = 0;
//     }

//     prevFuel = newFuel;
//     fuel = newFuel;
//   }

//   if (BATCH.length > 0) {
//     await prisma.sensorReading.createMany({ data: BATCH, skipDuplicates: true });
//   }
// }

// async function main() {
//   const {
//     sensors: sensorsCount,
//     hours,
//     freq,
//     theft_prob,
//     refuel_prob,
//     drop_prob,
//     base_lat,
//     base_lon,
//   } = argv;

//   // Align start time to the frequency (UTC) and go back by the requested horizon
//   const now = new Date();
//   const startUTC = truncateToFreqUTC(new Date(now.getTime() - hours * 60 * 60 * 1000), freq);

//   const periods = Math.floor((hours * 60) / freq);
//   if (periods <= 0) {
//     throw new Error(`Computed periods is ${periods}. Check --hours and --freq.`);
//   }

//   // Ensure base entities exist (exactly N)
//   const sensors = await ensureBaseData(sensorsCount);

//   console.log(`🛠  Generating ${periods} readings per sensor × ${sensors.length} sensors`);
//   console.log(`     Start (UTC): ${startUTC.toISOString()} | freq: ${freq} min | horizon: ${hours}h`);
//   console.log(`     Probs: theft=${theft_prob}, refuel=${refuel_prob}, drop=${drop_prob}`);

//   for (const s of sensors) {
//     await generateForSensor(s, {
//       startUTC,
//       periods,
//       freqMinutes: freq,
//       theftProb: theft_prob,
//       refuelProb: refuel_prob,
//       dropProb: drop_prob,
//       baseLat: base_lat,
//       baseLon: base_lon,
//     });

//     // Update lastSeen
//     await prisma.sensor.update({
//       where: { id: s.id },
//       data: { lastSeen: new Date() },
//     });
//     console.log(`  ✓ Inserted readings for ${s.sensorCode}`);
//   }

//   console.log('✅ Done.');
// }

// main()
//   .catch((e) => {
//     console.error('❌ Error:', e);
//     process.exit(1);
//   })
//   .finally(async () => {
//     await prisma.$disconnect();
//   });
