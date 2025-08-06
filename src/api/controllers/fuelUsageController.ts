import { Request, Response } from 'express';
import prisma from '../../lib/prisma';

interface FuelUsageResponse {
  totalFuelConsumed: number;
  totalFuelStolen: number;
  totalFuelRefueled: number;
  distanceTravelled: number;
  fuelEfficiency: number | null;
  message?: string;
}

interface FuelEvent {
  type: 'THEFT' | 'REFUEL';
  fuelDropLitres: number | null;
}

interface FuelReading {
  timestamp: Date;
  fuelLevel: number | null;
  distanceKm: number | null;
}

export async function getFuelUsage(req: Request, res: Response) {
  const { busId, fromDate, toDate } = req.query;

  if (!busId || typeof busId !== 'string') {
    return res.status(400).json({ message: 'Missing or invalid busId' });
  }

  let from: Date;
  let to: Date;
  try {
    from = fromDate ? new Date(fromDate.toString()) : new Date('2000-01-01');
    to = toDate ? new Date(toDate.toString()) : new Date();

    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      return res.status(400).json({ message: 'Invalid date format' });
    }
    if (from > to) {
      return res.status(400).json({ message: 'fromDate cannot be after toDate' });
    }
  } catch {
    return res.status(400).json({ message: 'Invalid date parsing' });
  }

  try {
    const sensor = await prisma.sensor.findFirst({
      where: { vehicleId: busId },
      include: {
        readings: {
          where: {
            timestamp: { gte: from, lte: to },
            fuelLevel: { not: undefined },
          },
          orderBy: { timestamp: 'asc' },
        },
        events: {
          where: {
            startTime: { gte: from, lte: to },
            type: { in: ['THEFT', 'REFUEL'] },
            fuelDropLitres: { not: null },
          },
          select: {
            type: true,
            fuelDropLitres: true,
          },
        },
      },
    });

    if (!sensor) {
      return res.status(404).json({ message: 'Sensor not found for this bus' });
    }

    const readings = sensor.readings as FuelReading[];
    const events = sensor.events as FuelEvent[];

    let totalFuelStolen = 0;
    let totalFuelRefueled = 0;
    let distanceTravelled = 0;
    let fuelConsumedFromReadings = 0;
    let detectedRefuelsFromReadings = 0;

    // Process events for theft/refuel
    events.forEach((event) => {
      if (event.type === 'THEFT' && typeof event.fuelDropLitres === 'number') {
        totalFuelStolen += Math.abs(event.fuelDropLitres);
      } else if (event.type === 'REFUEL' && typeof event.fuelDropLitres === 'number') {
        totalFuelRefueled += Math.abs(event.fuelDropLitres);
      }
    });

    // Process readings
    if (readings.length > 1) {
      distanceTravelled = readings.reduce((sum, r) => sum + (r.distanceKm || 0), 0);

      const initialFuel = readings[0].fuelLevel ?? 0;
      const finalFuel = readings[readings.length - 1].fuelLevel ?? 0;
      fuelConsumedFromReadings = Math.max(0, initialFuel - finalFuel);

      for (let i = 1; i < readings.length; i++) {
        const prev = readings[i - 1];
        const curr = readings[i];
        if (prev.fuelLevel !== null && curr.fuelLevel !== null) {
          const delta = curr.fuelLevel - prev.fuelLevel;
          if (delta > 5) {
            detectedRefuelsFromReadings += delta;
          }
        }
      }
    }

    // Total refueled includes estimated refuels
    totalFuelRefueled += detectedRefuelsFromReadings;

    // Total consumed = normal drop + stolen
    const totalFuelConsumed = fuelConsumedFromReadings + totalFuelStolen;

    // Efficiency
    const fuelEfficiency =
      totalFuelConsumed > 0 ? distanceTravelled / totalFuelConsumed : null;

    const response: FuelUsageResponse = {
      totalFuelConsumed: parseFloat(totalFuelConsumed.toFixed(2)),
      totalFuelStolen: parseFloat(totalFuelStolen.toFixed(2)),
      totalFuelRefueled: parseFloat(totalFuelRefueled.toFixed(2)),
      distanceTravelled: parseFloat(distanceTravelled.toFixed(2)),
      fuelEfficiency: fuelEfficiency !== null ? parseFloat(fuelEfficiency.toFixed(2)) : null,
    };

    res.json(response);
  } catch (err) {
    console.error('Error fetching fuel usage:', err);
    res.status(500).json({ message: 'Failed to fetch fuel usage' });
  }
}








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
