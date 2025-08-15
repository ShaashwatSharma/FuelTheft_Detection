import { Request, Response } from 'express';
import prisma from '../../lib/prisma';
import { EventType } from '../../generated/prisma';

interface FuelUsageResponse {
  totalFuelConsumed: number;   // L (baseline consumption + theft)
  totalFuelStolen: number;     // L (from THEFT events)
  totalFuelRefueled: number;   // L (from REFUEL events + detected jumps)
  distanceTravelled: number;   // km
  fuelEfficiency: number | null; // km/L
  message?: string;
}

interface FuelReading {
  timestamp: Date;
  fuelLevel: number | null;
  odometerKm: number | null;
}

// ---------- utils ----------

function parseDate(input: unknown, fallback: Date): Date {
  if (!input) return fallback;
  const d = new Date(String(input));
  return isNaN(d.getTime()) ? fallback : d;
}

function normalizeRange(fromRaw: unknown, toRaw: unknown): { from: Date; to: Date } {
  const now = new Date();
  const defaultFrom = new Date(now.getTime() - 7 * 24 * 3600 * 1000); // last 7 days
  const from = parseDate(fromRaw, defaultFrom);
  const to = parseDate(toRaw, now);
  return from > to ? { from: to, to: from } : { from, to };
}

// noise/refuel heuristics
const NOISE_BAND_LITRES = 0.5;       // ignore tiny jitter
const REFUEL_JUMP_LITRES = 5;        // jump considered a refuel
const ABNORMAL_DROP_LITRES = 5;      // large negative spikes likely theft/event-handled

// ---------- controller ----------

export async function getFuelUsage(req: Request, res: Response) {
  const { busId, fromDate, toDate } = req.query;

  if (!busId || typeof busId !== 'string') {
    return res.status(400).json({ message: 'Missing or invalid busId' });
  }

  const { from, to } = normalizeRange(fromDate, toDate);

  try {
    const sensor = await prisma.sensor.findFirst({
      where: { vehicleId: busId },
      include: {
        readings: {
          where: {
            timestamp: { gte: from, lte: to },
            fuelLevel: { not: null },
          },
          orderBy: { timestamp: 'asc' },
          select: { timestamp: true, fuelLevel: true, odometerKm: true },
        },
        // ⚠️ Sensor relation is PascalCase: History
        History: {
          where: {
            timestamp: { gte: from, lte: to },
            type: { in: ['THEFT', 'REFUEL'] as EventType[] },
            fuelDropLitres: { not: null },
          },
          select: { type: true, fuelDropLitres: true },
        },
      },
    });

    if (!sensor) {
      return res.status(404).json({ message: 'Sensor not found for this bus' });
    }

    const readings = sensor.readings as FuelReading[];
    const events = sensor.History as Array<{ type: EventType; fuelDropLitres: number | null }>;

    // --- Aggregate events ---
    let totalFuelStolen = 0;
    let totalFuelRefueledFromEvents = 0;

    for (const e of events) {
      const amt = typeof e.fuelDropLitres === 'number' ? Math.abs(e.fuelDropLitres) : 0;
      if (e.type === 'THEFT') totalFuelStolen += amt;
      else if (e.type === 'REFUEL') totalFuelRefueledFromEvents += amt;
    }

    // --- Distance from odometer deltas (handles resets) ---
    let distanceTravelled = 0;
    if (readings.length > 1) {
      for (let i = 1; i < readings.length; i++) {
        const prev = readings[i - 1].odometerKm ?? null;
        const curr = readings[i].odometerKm ?? null;
        if (prev !== null && curr !== null) {
          const d = curr - prev;
          if (d > 0) distanceTravelled += d; // sum positive increments only
        }
      }
    }

    // --- Consumption & detected refuels from fuel deltas ---
    let normalConsumptionFromReadings = 0; // L
    let detectedRefuelsFromReadings = 0;   // L

    if (readings.length > 1) {
      for (let i = 1; i < readings.length; i++) {
        const a = readings[i - 1].fuelLevel;
        const b = readings[i].fuelLevel;
        if (a == null || b == null) continue;

        const delta = b - a;

        // ignore tiny jitter
        if (Math.abs(delta) < NOISE_BAND_LITRES) continue;

        if (delta > REFUEL_JUMP_LITRES) {
          // a refuel jump detected from readings
          detectedRefuelsFromReadings += delta;
        } else if (delta < 0) {
          // negative = consumption (ignore huge drops as they’re likely theft/event-handled)
          const drop = -delta;
          if (drop <= ABNORMAL_DROP_LITRES) normalConsumptionFromReadings += drop;
          // else: big drops should already be covered by THEFT events
        }
      }
    }

    const totalFuelRefueled = totalFuelRefueledFromEvents + detectedRefuelsFromReadings;

    // Total consumed = baseline consumption + stolen (stolen is also fuel that left tank)
    const totalFuelConsumed = normalConsumptionFromReadings + totalFuelStolen;

    const fuelEfficiency =
      totalFuelConsumed > 0 ? distanceTravelled / totalFuelConsumed : null;

    const response: FuelUsageResponse = {
      totalFuelConsumed: +totalFuelConsumed.toFixed(2),
      totalFuelStolen: +totalFuelStolen.toFixed(2),
      totalFuelRefueled: +totalFuelRefueled.toFixed(2),
      distanceTravelled: +distanceTravelled.toFixed(2),
      fuelEfficiency: fuelEfficiency !== null ? +fuelEfficiency.toFixed(2) : null,
      message:
        readings.length < 2
          ? 'Insufficient readings for accurate consumption/distance; aggregates may be limited.'
          : undefined,
    };

    res.json(response);
  } catch (err) {
    console.error('Error fetching fuel usage:', err);
    res.status(500).json({ message: 'Failed to fetch fuel usage' });
  }
}

















// import { Request, Response } from 'express';
// import prisma from '../../lib/prisma';

// interface FuelUsageResponse {
//   totalFuelConsumed: number;
//   totalFuelStolen: number;
//   totalFuelRefueled: number;
//   distanceTravelled: number;
//   fuelEfficiency: number | null;
//   message?: string;
// }

// interface FuelEvent {
//   type: 'THEFT' | 'REFUEL';
//   fuelDropLitres: number | null;
// }

// interface FuelReading {
//   timestamp: Date;
//   fuelLevel: number | null;
//   distanceKm: number | null;
// }

// export async function getFuelUsage(req: Request, res: Response) {
//   const { busId, fromDate, toDate } = req.query;

//   if (!busId || typeof busId !== 'string') {
//     return res.status(400).json({ message: 'Missing or invalid busId' });
//   }

//   let from: Date;
//   let to: Date;
//   try {
//     from = fromDate ? new Date(fromDate.toString()) : new Date('2000-01-01');
//     to = toDate ? new Date(toDate.toString()) : new Date();

//     if (isNaN(from.getTime()) || isNaN(to.getTime())) {
//       return res.status(400).json({ message: 'Invalid date format' });
//     }
//     if (from > to) {
//       return res.status(400).json({ message: 'fromDate cannot be after toDate' });
//     }
//   } catch {
//     return res.status(400).json({ message: 'Invalid date parsing' });
//   }

//   try {
//     const sensor = await prisma.sensor.findFirst({
//       where: { vehicleId: busId },
//       include: {
//         readings: {
//           where: {
//             timestamp: { gte: from, lte: to },
//             fuelLevel: { not: undefined },
//           },
//           orderBy: { timestamp: 'asc' },
//         },
//         histories: {
//           where: {
//             timestamp: { gte: from, lte: to },
//             type: { in: ['THEFT', 'REFUEL'] },
//             fuelDropLitres: { not: null },
//           },
//           select: {
//             type: true,
//             fuelDropLitres: true,
//           },
//         },
//       },
//     });

//     if (!sensor) {
//       return res.status(404).json({ message: 'Sensor not found for this bus' });
//     }

//     const readings = sensor.readings as FuelReading[];
//     const events = sensor.histories as FuelEvent[];

//     let totalFuelStolen = 0;
//     let totalFuelRefueled = 0;
//     let distanceTravelled = 0;
//     let fuelConsumedFromReadings = 0;
//     let detectedRefuelsFromReadings = 0;

//     // Process histories for theft/refuel
//     events.forEach((event) => {
//       if (event.type === 'THEFT' && typeof event.fuelDropLitres === 'number') {
//         totalFuelStolen += Math.abs(event.fuelDropLitres);
//       } else if (event.type === 'REFUEL' && typeof event.fuelDropLitres === 'number') {
//         totalFuelRefueled += Math.abs(event.fuelDropLitres);
//       }
//     });

//     // Process readings
//     if (readings.length > 1) {
//       distanceTravelled = readings.reduce((sum, r) => sum + (r.distanceKm || 0), 0);

//       const initialFuel = readings[0].fuelLevel ?? 0;
//       const finalFuel = readings[readings.length - 1].fuelLevel ?? 0;
//       fuelConsumedFromReadings = Math.max(0, initialFuel - finalFuel);

//       for (let i = 1; i < readings.length; i++) {
//         const prev = readings[i - 1];
//         const curr = readings[i];
//         if (prev.fuelLevel !== null && curr.fuelLevel !== null) {
//           const delta = curr.fuelLevel - prev.fuelLevel;
//           if (delta > 5) {
//             detectedRefuelsFromReadings += delta;
//           }
//         }
//       }
//     }

//     // Total refueled includes estimated refuels
//     totalFuelRefueled += detectedRefuelsFromReadings;

//     // Total consumed = normal drop + stolen
//     const totalFuelConsumed = fuelConsumedFromReadings + totalFuelStolen;

//     // Efficiency
//     const fuelEfficiency =
//       totalFuelConsumed > 0 ? distanceTravelled / totalFuelConsumed : null;

//     const response: FuelUsageResponse = {
//       totalFuelConsumed: parseFloat(totalFuelConsumed.toFixed(2)),
//       totalFuelStolen: parseFloat(totalFuelStolen.toFixed(2)),
//       totalFuelRefueled: parseFloat(totalFuelRefueled.toFixed(2)),
//       distanceTravelled: parseFloat(distanceTravelled.toFixed(2)),
//       fuelEfficiency: fuelEfficiency !== null ? parseFloat(fuelEfficiency.toFixed(2)) : null,
//     };

//     res.json(response);
//   } catch (err) {
//     console.error('Error fetching fuel usage:', err);
//     res.status(500).json({ message: 'Failed to fetch fuel usage' });
//   }
// }







// import { Request, Response } from 'express';
// import prisma from '../../lib/prisma';

// export async function getFuelUsage(req: Request, res: Response) {
//   const { busId, fromDate, toDate } = req.query;

//   if (!busId) {
//     return res.status(400).json({ message: 'Missing busId' });
//   }

//   const from = fromDate ? new Date(fromDate.toString()) : new Date('2000-01-01');
//   const to = toDate ? new Date(toDate.toString()) : new Date();

//   try {
//     const sensor = await prisma.sensor.findFirst({
//       where: { vehicleId: busId.toString() },
//       include: {
//         readings: {
//           where: {
//             timestamp: { gte: from, lte: to },
//           },
//           orderBy: {
//             timestamp: 'asc', // Ensure chronological order
//           },
//         },
//         alerts: {
//           where: {
//             timestamp: { gte: from, lte: to },
//             type: { in: ['THEFT', 'REFUEL'] },
//           },
//         },
//       },
//     });

//     if (!sensor) {
//       return res.status(404).json({ message: 'Sensor not found for this bus' });
//     }

//     const { readings, alerts } = sensor;

//     // Initialize variables
//     let totalFuelStolen = 0;
//     let totalFuelRefueled = 0;
//     let distanceTravelled = 0;
//     let fuelConsumedFromReadings = 0;

//     // Calculate from alerts
//     alerts.forEach(alert => {
//       if (alert.type === 'THEFT' && alert.fuelDropLitres) {
//         totalFuelStolen += Math.abs(alert.fuelDropLitres);
//       }
//       if (alert.type === 'REFUEL' && alert.fuelAddedLitres) {
//         totalFuelRefueled += Math.abs(alert.fuelAddedLitres);
//       }
//     });

//     // Calculate from readings
//     if (readings.length > 1) {
//       // Calculate distance travelled (sum of all distanceKm values)
//       distanceTravelled = readings.reduce((sum, reading) => sum + (reading.distanceKm || 0), 0);

//       // Calculate fuel consumed from readings (start fuel - end fuel)
//       const initialFuel = readings[0].fuelLevel;
//       const finalFuel = readings[readings.length - 1].fuelLevel;
//       fuelConsumedFromReadings = Math.max(0, initialFuel - finalFuel);

//       // Additional check for refuel events that might not be captured in alerts
//       for (let i = 1; i < readings.length; i++) {
//         const prev = readings[i - 1];
//         const curr = readings[i];
//         const delta = curr.fuelLevel - prev.fuelLevel;

//         // If fuel level increased significantly, it might be a refuel not captured in alerts
//         if (delta > 1) { // Threshold of 1 liter to avoid small fluctuations
//           totalFuelRefueled += delta;
//         }
//       }
//     }

//     // Total fuel consumed is either from readings or thefts, whichever is greater
//     // This prevents negative values when refuels exceed consumption
//     const totalFuelConsumed = Math.max(fuelConsumedFromReadings, totalFuelStolen);

//     // Calculate fuel efficiency (km per liter)
//     const fuelEfficiency = totalFuelConsumed > 0 
//       ? distanceTravelled / totalFuelConsumed 
//       : null;

//     res.json({
//       totalFuelConsumed: parseFloat(totalFuelConsumed.toFixed(2)),
//       totalFuelStolen: parseFloat(totalFuelStolen.toFixed(2)),
//       totalFuelRefueled: parseFloat(totalFuelRefueled.toFixed(2)),
//       distanceTravelled: parseFloat(distanceTravelled.toFixed(2)),
//       fuelEfficiency: fuelEfficiency ? parseFloat(fuelEfficiency.toFixed(2)) : null,
//     });

//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: 'Failed to fetch fuel usage' });
//   }
// }


// import { Request, Response } from 'express';
// import prisma from '../../lib/prisma';

// // Fetch fuel usage statistics for a specific bus
// // GET /fuelusage?busId=<id>&fromDate=<date>&toDate=<date>      
// export async function getFuelUsage(req: Request, res: Response) {
//   const { busId, fromDate, toDate } = req.query;

//   if (!busId) {
//     return res.status(400).json({ message: 'Missing busId' });
//   }

//   const from = fromDate ? new Date(fromDate.toString()) : new Date('2000-01-01');
//   const to = toDate ? new Date(toDate.toString()) : new Date();

//   try {
//     const sensor = await prisma.sensor.findFirst({
//       where: { vehicleId: busId.toString() },
//       include: {
//         readings: {
//           where: {
//             timestamp: { gte: from, lte: to },
//           },
//         },
//         alerts: {
//           where: {
//             timestamp: { gte: from, lte: to },
//           },
//         },
//       },
//     });

//     if (!sensor) {
//       return res.status(404).json({ message: 'Sensor not found for this bus' });
//     }

//     const { readings, alerts } = sensor;

//     let totalFuelStolen = 0;
//     let totalFuelRefueled = 0;
//     let distanceTravelled = 0;

//     for (const alert of alerts) {
//       if (alert.type === 'THEFT') totalFuelStolen += 1; // or alert.fuelDropLitres if tracked
//       if (alert.type === 'REFUEL') totalFuelRefueled += 1;
//     }

//     for (let i = 1; i < readings.length; i++) {
//       const prev = readings[i - 1];
//       const curr = readings[i];

//       const delta = curr.fuelLevel - prev.fuelLevel;

//       // Fuel consumption is negative change
//       if (delta < 0) {
//         totalFuelRefueled += 0; // avoid accidental refuel count
//       }

//       distanceTravelled += curr.distanceKm ?? 0;
//     }

//     const totalFuelConsumed = totalFuelStolen + (readings.length > 0 ? readings[0].fuelLevel - readings.at(-1)!.fuelLevel : 0);
//     const fuelEfficiency = totalFuelConsumed > 0 ? distanceTravelled / totalFuelConsumed : null;

//     res.json({
//       totalFuelConsumed: parseFloat(totalFuelConsumed.toFixed(2)),
//       totalFuelStolen: parseFloat(totalFuelStolen.toFixed(2)),
//       totalFuelRefueled: parseFloat(totalFuelRefueled.toFixed(2)),
//       distanceTravelled: parseFloat(distanceTravelled.toFixed(2)),
//       fuelEfficiency: fuelEfficiency ? parseFloat(fuelEfficiency.toFixed(2)) : null,
//     });

//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: 'Failed to fetch fuel usage' });
//   }
// }
