import { Request, Response } from 'express';
import prisma from '../../lib/prisma';

// -------- utils --------------------------------------------------------------

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

function parseIncludeList(q: unknown): Set<string> {
  if (!q) return new Set();
  return new Set(
    String(q)
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

// -------- controllers --------------------------------------------------------

// GET /vehicles
export async function getVehicles(req: Request, res: Response) {
  try {
    const vehicles = await prisma.vehicle.findMany({
      include: {
        driver: { select: { name: true } },
        route: { select: { name: true } },
        // quick status info for list view
        sensor: { select: { status: true, lastSeen: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const result = vehicles.map(v => ({
      id: v.id,
      registrationNo: v.registrationNo,
      driver: v.driver?.name ?? null,
      route: v.route?.name ?? null,
      sensorStatus: v.sensor?.status ?? null,
      sensorLastSeen: v.sensor?.lastSeen ?? null,
    }));

    res.json(result);
  } catch (err) {
    console.error('getVehicles error:', err);
    res.status(500).json({ message: 'Failed to fetch vehicles' });
  }
}

// GET /vehicles/:id/details
// Query params:
//   include=alerts,readings,histories,events
//   fromDate=ISO | toDate=ISO
export async function getVehicleDetails(req: Request, res: Response) {
  const { id } = req.params;
  const includes = parseIncludeList(req.query.include);
  const { from, to } = normalizeRange(req.query.fromDate, req.query.toDate);

  const wantAlerts = includes.has('alerts');
  const wantReadings = includes.has('readings');
  const wantHistories = includes.has('histories');
  const wantEvents = includes.has('events');

  try {
    const vehicle = await prisma.vehicle.findUnique({
      where: { id },
      include: {
        driver: true,
        route: true,
        sensor:
          wantAlerts || wantReadings || wantHistories || wantEvents
            ? {
                include: {
                  // ⚠️ Sensor relation names are PascalCase in your schema
                  Alert: wantAlerts
                    ? {
                        where: { timestamp: { gte: from, lte: to } },
                        orderBy: { timestamp: 'desc' },
                      }
                    : false,
                  readings: wantReadings
                    ? {
                        where: { timestamp: { gte: from, lte: to } },
                        orderBy: { timestamp: 'asc' },
                      }
                    : false,
                  History: wantHistories
                    ? {
                        where: { timestamp: { gte: from, lte: to } },
                        orderBy: { timestamp: 'desc' },
                      }
                    : false,
                  Event: wantEvents
                    ? {
                        where: { timestamp: { gte: from, lte: to } },
                        orderBy: { timestamp: 'desc' },
                      }
                    : false,
                },
              }
            : false,
        // You also have vehicle-level relations if you ever want them:
        // alerts: wantAlerts ? { where: { timestamp: { gte: from, lte: to } } } : false,
        // histories: wantHistories ? { where: { timestamp: { gte: from, lte: to } } } : false,
        // events: wantEvents ? { where: { timestamp: { gte: from, lte: to } } } : false,
      },
    });

    if (!vehicle) return res.status(404).json({ message: 'Vehicle not found' });

    res.json({
      ...vehicle,
      // Optional: echo back the applied range for the client
      range: { from, to },
    });
  } catch (err) {
    console.error('getVehicleDetails error:', err);
    res.status(500).json({ message: 'Failed to fetch vehicle details' });
  }
}











// import { Request, Response } from 'express';
// import prisma from '../../lib/prisma';

// // GET /vehicles
// export async function getVehicles(req: Request, res: Response) {
//   try {
//     const vehicles = await prisma.vehicle.findMany({
//       include: {
//         driver: true,
//         route: true,
//       },
//     });

//     const result = vehicles.map((v) => ({
//       id: v.id,
//       registrationNo: v.registrationNo,
//       driver: v.driver?.name || null,
//       route: v.route?.name || null,
//     }));

//     res.json(result);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: 'Failed to fetch vehicles' });
//   }
// }

// // GET /vehicles/:id/details
// export async function getVehicleDetails(req: Request, res: Response) {
//   const { id } = req.params;
//   const { include = '', fromDate, toDate } = req.query;

//   const includes = (include as string).split(',').map(i => i.trim());
//   const from = fromDate ? new Date(fromDate.toString()) : new Date('2000-01-01');
//   const to = toDate ? new Date(toDate.toString()) : new Date();

//   try {
//     const vehicle = await prisma.vehicle.findUnique({
//       where: { id },
//       include: {
//         driver: true,
//         route: true,
//         sensor: includes.includes('alerts') || includes.includes('readings') || includes.includes('histories')
//           ? {
//               include: {
//                 alerts: includes.includes('alerts')
//                   ? { where: { timestamp: { gte: from, lte: to } } }
//                   : false,
//                 readings: includes.includes('readings')
//                   ? {
//                       where: { timestamp: { gte: from, lte: to } },
//                       orderBy: { timestamp: 'asc' },
//                     }
//                   : false,
//                 histories: includes.includes('histories')
//                   ? {
//                       where: { timestamp: { gte: from, lte: to } },
//                       orderBy: { timestamp: 'desc' },
//                     }
//                   : false,
//               },
//             }
//           : false,
//       },
//     });

//     if (!vehicle) return res.status(404).json({ message: 'Vehicle not found' });

//     res.json(vehicle);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: 'Failed to fetch vehicle details' });
//   }
// }





// import { Request, Response } from 'express';
// import prisma from '../../lib/prisma';

// // GET /vehicles
// export async function getVehicles(req: Request, res: Response) {
//   try {
//     const vehicles = await prisma.vehicle.findMany({
//       include: {
//         driver: true,
//         route: true,
//       },
//     });

//     const result = vehicles.map((v) => ({
//       id: v.id,
//       registrationNo: v.registrationNo,
//       driver: v.driver?.name || null,
//       route: v.route?.name || null,
//     }));

//     res.json(result);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: 'Failed to fetch vehicles' });
//   }
// }

// // GET /vehicles/:id/details
// export async function getVehicleDetails(req: Request, res: Response) {
//   const { id } = req.params;
//   const { include = '', fromDate, toDate } = req.query;

//   const includes = (include as string).split(',').map(i => i.trim());
//   const from = fromDate ? new Date(fromDate.toString()) : new Date('2000-01-01');
//   const to = toDate ? new Date(toDate.toString()) : new Date();

//   try {
//     const vehicle = await prisma.vehicle.findUnique({
//       where: { id },
//       include: {
//         driver: true,
//         route: true,
//         sensor: includes.includes('alerts') || includes.includes('readings')
//           ? {
//               include: {
//                 alerts: includes.includes('alerts')
//                   ? { where: { timestamp: { gte: from, lte: to } } }
//                   : false,
//                 readings: includes.includes('readings')
//                   ? {
//                       where: { timestamp: { gte: from, lte: to } },
//                       orderBy: { timestamp: 'asc' },
//                     }
//                   : false,
//               },
//             }
//           : false,
//         events: includes.includes('events')
//           ? {
//               where: { startTime: { gte: from, lte: to } },
//             }
//           : false,
//       },
//     });

//     if (!vehicle) return res.status(404).json({ message: 'Vehicle not found' });

//     res.json(vehicle);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: 'Failed to fetch vehicle details' });
//   }
// }
