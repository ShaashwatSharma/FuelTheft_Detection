import { Request, Response } from 'express';
import prisma from '../../lib/prisma';

const dateRanges: Record<string, () => { from: Date; to: Date }> = {
  today: () => {
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    const to = new Date();
    to.setHours(23, 59, 59, 999);
    return { from, to };
  },
  yesterday: () => {
    const from = new Date();
    from.setDate(from.getDate() - 1);
    from.setHours(0, 0, 0, 0);
    const to = new Date(from);
    to.setHours(23, 59, 59, 999);
    return { from, to };
  },
  this_week: () => {
    const from = new Date();
    const day = from.getDay();
    from.setDate(from.getDate() - day);
    from.setHours(0, 0, 0, 0);
    const to = new Date();
    to.setHours(23, 59, 59, 999);
    return { from, to };
  },
  this_month: () => {
    const from = new Date();
    from.setDate(1);
    from.setHours(0, 0, 0, 0);
    const to = new Date();
    to.setHours(23, 59, 59, 999);
    return { from, to };
  },
};

export async function getBusDetails(req: Request, res: Response) {
  const { id } = req.params;
  let from: Date, to: Date;

  // Handle custom date range
  if (req.query.startDate && req.query.endDate) {
    from = new Date(req.query.startDate.toString());
    to = new Date(req.query.endDate.toString());
  } 
  // Handle predefined ranges
  else {
    const rangeKey = req.query.timeRange?.toString().toLowerCase().replace(' ', '_') || 'today';
    const rangeFn = dateRanges[rangeKey] || dateRanges['today'];
    ({ from, to } = rangeFn());
  }

  try {
    const vehicle = await prisma.vehicle.findUnique({
      where: { id },
      include: {
        driver: true,
        route: true,
        sensor: {
          include: {
            readings: {
              where: {
                timestamp: {
                  gte: from,
                  lte: to,
                },
              },
              orderBy: { timestamp: 'asc' },
            },
            alerts: {
              where: {
                timestamp: {
                  gte: from,
                  lte: to,
                },
              },
            },
          },
        },
        events: {
          where: {
            startTime: {
              gte: from,
              lte: to,
            },
          },
        },
      },
    });

    if (!vehicle || !vehicle.sensor) {
      return res.status(404).json({ message: 'Bus or sensor not found' });
    }

    // Create a mapping of events by closest timestamp
    const eventMap = new Map<string, { type: string; description?: string }>();

    for (const alert of vehicle.sensor.alerts) {
      const ts = alert.timestamp.toISOString();
      eventMap.set(ts, {
        type: alert.type,
        description: alert.description || undefined,
      });
    }

    const readings = vehicle.sensor.readings.map((r) => {
      const ts = r.timestamp.toISOString();
      const event = eventMap.get(ts);
      return {
        timestamp: ts,
        fuelLevel: r.fuelLevel,
        ...(event ? { 
          eventType: event.type.toUpperCase(), 
          description: event.description 
        } : { eventType: 'NORMAL' }),
      };
    });

    const latestReading = vehicle.sensor.readings.at(-1);

    res.json({
      registrationNo: vehicle.registrationNo,
      driver: vehicle.driver?.name,
      route: vehicle.route?.name,
      capacity: vehicle.capacity,
      currentFuelLevel: latestReading?.fuelLevel ?? null,
      readings,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to load bus details' });
  }
}




// import { Request, Response } from 'express';
// import prisma from '../../lib/prisma';

// const dateRanges: Record<string, () => { from: Date; to: Date }> = {
//   today: () => {
//     const from = new Date();
//     from.setHours(0, 0, 0, 0);
//     return { from, to: new Date() };
//   },
//   yesterday: () => {
//     const from = new Date();
//     from.setDate(from.getDate() - 1);
//     from.setHours(0, 0, 0, 0);
//     const to = new Date(from);
//     to.setHours(23, 59, 59, 999);
//     return { from, to };
//   },
//   this_week: () => {
//     const from = new Date();
//     const day = from.getDay();
//     from.setDate(from.getDate() - day);
//     from.setHours(0, 0, 0, 0);
//     return { from, to: new Date() };
//   },
//   this_month: () => {
//     const from = new Date();
//     from.setDate(1);
//     from.setHours(0, 0, 0, 0);
//     return { from, to: new Date() };
//   },
// };

// export async function getBusDetails(req: Request, res: Response) {
//   const { id } = req.params;
//   const rangeKey = req.query.range?.toString() || 'today';
//   const { from, to } = dateRanges[rangeKey] ? dateRanges[rangeKey]() : dateRanges['today']();

//   try {
//     const vehicle = await prisma.vehicle.findUnique({
//       where: { id },
//       include: {
//         driver: true,
//         route: true,
//         sensor: {
//           include: {
//             readings: {
//               where: {
//                 timestamp: {
//                   gte: from,
//                   lte: to,
//                 },
//               },
//               orderBy: { timestamp: 'asc' },
//             },
//             alerts: {
//               where: {
//                 timestamp: {
//                   gte: from,
//                   lte: to,
//                 },
//               },
//             },
//           },
//         },
//         events: {
//           where: {
//             startTime: {
//               gte: from,
//               lte: to,
//             },
//           },
//         },
//       },
//     });

//     if (!vehicle || !vehicle.sensor) {
//       return res.status(404).json({ message: 'Bus or sensor not found' });
//     }

//     // Create a mapping of events by closest timestamp (can be improved using fuzzy matching if needed)
//     const eventMap = new Map<string, { type: string; description?: string }>();

//     for (const alert of vehicle.sensor.alerts) {
//       const ts = alert.timestamp.toISOString();
//       eventMap.set(ts, {
//         type: alert.type,
//         description: alert.description || undefined,
//       });
//     }

//     const readings = vehicle.sensor.readings.map((r) => {
//       const ts = r.timestamp.toISOString();
//       const event = eventMap.get(ts);
//       return {
//         timestamp: ts,
//         fuelLevel: r.fuelLevel,
//         ...(event ? { eventType: event.type, description: event.description } : {}),
//       };
//     });

//     const latestReading = vehicle.sensor.readings.at(-1);

//     res.json({
//       registrationNo: vehicle.registrationNo,
//       driver: vehicle.driver?.name,
//       route: vehicle.route?.name,
//       capacity: vehicle.capacity,
//       currentFuelLevel: latestReading?.fuelLevel ?? null,
//       readings,
//     });
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: 'Failed to load bus details' });
//   }
// }
