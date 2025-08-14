/* prisma/seed.ts */
import { PrismaClient } from '../generated/prisma';

const prisma = new PrismaClient();

// ---------- Config ----------
const SENSORS_COUNT = 10;

const DAYS = 8;                         // today + last 7 days
const ENTRIES_PER_DAY = 20;             // 48 entries/day => every 30 minutes
const DAY_MS = 24 * 60 * 60 * 1000;
const STEP_MS = 30 * 60 * 1000;         // ← fixed 30 minutes
const TOTAL_STEPS = DAYS * ENTRIES_PER_DAY;

const MIN_CAP = 250;
const MAX_CAP = 300;
const INIT_MIN = 100;
const INIT_MAX = 150;
const NORMAL_BURN_MIN = 0.4;   // L per step
const NORMAL_BURN_MAX = 1.5;   // L per step (≤1.5)
const THEFT_DROP_MIN = 15;     // sudden drop
const THEFT_DROP_MAX = 30;
const REFUEL_ADD_MIN = 40;
const REFUEL_ADD_MAX = 120;

function randFloat(min: number, max: number, dp = 2) {
  return parseFloat((min + Math.random() * (max - min)).toFixed(dp));
}
function randInt(min: number, max: number) {
  return Math.floor(min + Math.random() * (max - min + 1));
}
function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}
function interp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

type RouteCoord = { name: string; start: [number, number]; end: [number, number] };

// A few India-ish city pairs for variety (approx coords)
const routeCoords: RouteCoord[] = [
  { name: 'Bengaluru → Mysuru',    start: [12.9716, 77.5946], end: [12.2958, 76.6394] },
  { name: 'Delhi → Agra',          start: [28.7041, 77.1025], end: [27.1767, 78.0081] },
  { name: 'Mumbai → Pune',         start: [19.0760, 72.8777], end: [18.5204, 73.8567] },
  { name: 'Jaipur → Ajmer',        start: [26.9124, 75.7873], end: [26.4499, 74.6399] },
  { name: 'Chennai → Vellore',     start: [13.0827, 80.2707], end: [12.9165, 79.1325] },
  { name: 'Kolkata → Kharagpur',   start: [22.5726, 88.3639], end: [22.3460, 87.2319] },
  { name: 'Hyderabad → Warangal',  start: [17.3850, 78.4867], end: [17.9689, 79.5941] },
  { name: 'Bhopal → Indore',       start: [23.2599, 77.4126], end: [22.7196, 75.8577] },
  { name: 'Surat → Vadodara',      start: [21.1702, 72.8311], end: [22.3072, 73.1812] },
  { name: 'Lucknow → Kanpur',      start: [26.8467, 80.9462], end: [26.4499, 80.3319] },
];

async function wipeAll() {
  await prisma.alert.deleteMany();
  await prisma.history.deleteMany();
  await prisma.sensorReading.deleteMany();
  await prisma.summaryMetrics.deleteMany();
  await prisma.sensor.deleteMany();
  await prisma.driver.deleteMany();
  await prisma.vehicle.deleteMany();
  await prisma.route.deleteMany();
}

function regNo(i: number) {
  const states = ['KA', 'DL', 'MH', 'RJ', 'TN', 'WB', 'TS', 'MP', 'GJ', 'UP'];
  const state = states[i % states.length];
  const series = String.fromCharCode(65 + (i % 26)) + String.fromCharCode(65 + ((i + 3) % 26));
  const num = (1000 + i).toString();
  return `${state}01${series}${num}`;
}
function phone(i: number) {
  return `90000${(10000 + i).toString().slice(-5)}`;
}
function license(i: number) {
  return `DL-${(100000 + i).toString()}`;
}

async function createEntities() {
  const routes = [];
  const vehicles = [];
  const drivers = [];
  const sensors = [];

  for (let i = 0; i < SENSORS_COUNT; i++) {
    const rcoord = routeCoords[i % routeCoords.length];

    const route = await prisma.route.create({
      data: {
        name: `${rcoord.name} #${i + 1}`,
        startPoint: rcoord.name.split('→')[0].trim(),
        endPoint: rcoord.name.split('→')[1].trim(),
      },
    });
    routes.push(route);

    const tankSize = randInt(MIN_CAP, MAX_CAP);
    const vehicle = await prisma.vehicle.create({
      data: {
        registrationNo: regNo(i),
        model: `LX-${2020 + (i % 5)}`,
        tankSize,
        mileageEst: randFloat(3.5, 8.5, 2),
        route: { connect: { id: route.id } },
      },
    });
    vehicles.push(vehicle);

    const driver = await prisma.driver.create({
      data: {
        name: `Driver ${i + 1}`,
        phone: phone(i),
        licenseNo: license(i),
        vehicle: { connect: { id: vehicle.id } },
      },
    });
    drivers.push(driver);

    const sensor = await prisma.sensor.create({
      data: {
        sensorCode: `S-${(i + 1).toString().padStart(4, '0')}`,
        isActive: true,
        installedAt: new Date(Date.now() - 10 * DAY_MS),
        lastSeen: new Date(),
        vehicle: { connect: { id: vehicle.id } },
      },
    });
    sensors.push(sensor);
  }

  return { routes, vehicles, drivers, sensors };
}

type Scenario = {
  capacity: number;
  initFuel: number;
  theftAtStep: number;     // global step index where theft occurs
  theftDrop: number;
  refuelThreshold: number; // 50 or 20
  refuelAdded: number;
};

function buildScenario(sensorIndex: number, capacity: number): Scenario {
  const initFuel = randFloat(INIT_MIN, INIT_MAX, 2);
  const theftAtStep = randInt(10, 20); // early theft after ~5–10 hours
  const theftDrop = randFloat(THEFT_DROP_MIN, THEFT_DROP_MAX, 2);
  const refuelThreshold = (sensorIndex % 2 === 0) ? 50 : 20;
  const refuelAdded = randFloat(REFUEL_ADD_MIN, REFUEL_ADD_MAX, 2);
  return { capacity, initFuel, theftAtStep, theftDrop, refuelThreshold, refuelAdded };
}

async function seedReadingsForSensor(
  sensorIdx: number,
  sensorId: string,
  sensorCode: string,
  vehicleTank: number,
  startMidnightUTC: Date,
  route: RouteCoord
) {
  const readings: any[] = [];
  const scenario = buildScenario(sensorIdx, vehicleTank);

  let fuel = scenario.initFuel;
  let odometerKm = randFloat(10000, 50000, 2); // starting odo km
  let angle = randInt(0, 359);
  const refuelThreshold = scenario.refuelThreshold;

  let refueled = false;            // single threshold-based refuel
  let pendingZeroRefuel = false;   // refuel to ~200L on next reading after hitting 0

  for (let d = 0; d < DAYS; d++) {
    for (let k = 0; k < ENTRIES_PER_DAY; k++) {
      const globalStep = d * ENTRIES_PER_DAY + k;
      const ts = new Date(startMidnightUTC.getTime() + d * DAY_MS + k * STEP_MS);
      const tNorm = TOTAL_STEPS > 1 ? globalStep / (TOTAL_STEPS - 1) : 0;

      // Position along route with slight jitter
      const latBase = interp(route.start[0], route.end[0], tNorm);
      const lonBase = interp(route.start[1], route.end[1], tNorm);
      const lat = +(latBase + randFloat(-0.005, 0.005, 6)).toFixed(6);
      const lon = +(lonBase + randFloat(-0.005, 0.005, 6)).toFixed(6);

      // Driving pattern
      const hour = ts.getUTCHours();
      const isDrivingHour = hour >= 1 && hour <= 18;
      const speed = isDrivingHour ? randFloat(15, 60, 2) : randFloat(0, 5, 2);
      const distanceKm = +(speed * (STEP_MS / (60 * 60 * 1000))).toFixed(3);
      odometerKm = +(odometerKm + distanceKm).toFixed(3);
      angle = (angle + randInt(-25, 25) + 360) % 360;

      // GNSS & power
      const sats = isDrivingHour ? randInt(7, 12) : randInt(4, 10);
      const hdop = randFloat(0.7, 2.5, 2);
      const pdop = randFloat(1.2, 4.0, 2);
      const altitude = randFloat(150, 600, 1);
      const priority = randInt(0, 3);
      const deviceVoltage = randFloat(12.0, 14.4, 2);
      const ignitionStatus = speed > 2 ? 'ON' : 'OFF';
      const topic = `sensors/${sensorCode}`;

      // -------- FUEL MODEL --------
      let fuelDelta = 0;
      let rawEventId = 0; // 0=normal, 1=theft, 2=refuel

      if (pendingZeroRefuel) {
        const target = clamp(randFloat(190, 210, 2), 10, scenario.capacity);
        fuelDelta = +(target - fuel).toFixed(2); // fuel is 0 here
        rawEventId = 2;
        pendingZeroRefuel = false;
      } else if (globalStep === scenario.theftAtStep) {
        fuelDelta = -scenario.theftDrop;
        rawEventId = 1;
      } else if (!refueled && fuel <= refuelThreshold) {
        const room = scenario.capacity - fuel;
        const add = clamp(scenario.refuelAdded, 10, Math.max(10, room));
        fuelDelta = +add.toFixed(2);
        refueled = true;
        rawEventId = 2;
      } else {
        fuelDelta = -randFloat(NORMAL_BURN_MIN, NORMAL_BURN_MAX, 2);
      }

      let newFuel = clamp(+((fuel + fuelDelta)).toFixed(2), 0, scenario.capacity);
      if (newFuel <= 0) {
        newFuel = 0;
        pendingZeroRefuel = true; // force ~200L next tick
      }

      readings.push({
        timestamp: ts,
        fuelLevel: newFuel,
        distanceKm: distanceKm,
        locationLat: lat,
        locationLong: lon,
        speed: speed,
        ignitionStatus,
        odometer: +odometerKm.toFixed(3),
        deviceVoltage,
        sats,
        hdop,
        pdop,
        angle,
        altitude,
        priority,
        eventId: rawEventId,
        raw: {
          source: 'seed',
          globalStep,
          scenario: {
            initFuel: scenario.initFuel,
            theftAtStep: scenario.theftAtStep,
            theftDrop: scenario.theftDrop,
            refuelThreshold,
            refuelAdded: scenario.refuelAdded,
            capacity: scenario.capacity,
          },
          appliedDelta: fuelDelta,
        },
        topic,
        processed: false,
        sensorId,
      });

      fuel = newFuel;
    }
  }

  await prisma.sensorReading.createMany({ data: readings });
}

async function main() {
  console.log('🧽 Wiping existing data…');
  await wipeAll();

  console.log('🚚 Creating routes, vehicles, drivers, sensors…');
  const { sensors, vehicles } = await createEntities();

  // Start at **today's midnight UTC - 7 days** → covers last 7 days + today
  const now = new Date();
  const todayMidnightUTC = new Date(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0
  ));
  const start = new Date(todayMidnightUTC.getTime() - 7 * DAY_MS);

  console.log('⛽ Seeding sensor readings…');
  for (let i = 0; i < sensors.length; i++) {
    const sensor = sensors[i];
    const vehicle = vehicles[i];
    const rcoord = routeCoords[i % routeCoords.length];

    const tank = vehicle.tankSize ?? randInt(MIN_CAP, MAX_CAP);
    await seedReadingsForSensor(i, sensor.id, sensor.sensorCode, tank, start, rcoord);

    await prisma.sensor.update({
      where: { id: sensor.id },
      data: { lastSeen: new Date() },
    });

    console.log(`  ✓ Seeded ${TOTAL_STEPS} readings for ${sensor.sensorCode} (${vehicle.registrationNo})`);
  }

  console.log('✅ Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
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
