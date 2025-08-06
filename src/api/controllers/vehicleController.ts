import { Request, Response } from 'express';
import prisma from '../../lib/prisma';

// GET /vehicles
export async function getVehicles(req: Request, res: Response) {
  try {
    const vehicles = await prisma.vehicle.findMany({
      include: {
        driver: true,
        route: true,
      },
    });

    const result = vehicles.map((v) => ({
      id: v.id,
      registrationNo: v.registrationNo,
      driver: v.driver?.name || null,
      route: v.route?.name || null,
    }));

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch vehicles' });
  }
}

// GET /vehicles/:id/details
export async function getVehicleDetails(req: Request, res: Response) {
  const { id } = req.params;
  const { include = '', fromDate, toDate } = req.query;

  const includes = (include as string).split(',').map(i => i.trim());
  const from = fromDate ? new Date(fromDate.toString()) : new Date('2000-01-01');
  const to = toDate ? new Date(toDate.toString()) : new Date();

  try {
    const vehicle = await prisma.vehicle.findUnique({
      where: { id },
      include: {
        driver: true,
        route: true,
        sensor: includes.includes('alerts') || includes.includes('readings') || includes.includes('histories')
          ? {
              include: {
                alerts: includes.includes('alerts')
                  ? { where: { timestamp: { gte: from, lte: to } } }
                  : false,
                readings: includes.includes('readings')
                  ? {
                      where: { timestamp: { gte: from, lte: to } },
                      orderBy: { timestamp: 'asc' },
                    }
                  : false,
                histories: includes.includes('histories')
                  ? {
                      where: { timestamp: { gte: from, lte: to } },
                      orderBy: { timestamp: 'desc' },
                    }
                  : false,
              },
            }
          : false,
      },
    });

    if (!vehicle) return res.status(404).json({ message: 'Vehicle not found' });

    res.json(vehicle);
  } catch (err) {
    console.error(err);
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
