// src/api/controllers/sensorController.ts
import { Request, Response } from 'express';
import prisma from '../../lib/prisma';

// Fetch sensor health status with optional filters
export async function getSensorStatus(req: Request, res: Response) {
  const { busId, status, fromDate, toDate } = req.query;

  try {
    const sensorWhere: any = {};
    const historyWhere: any = { type: 'SENSOR_HEALTH' };

    if (busId) {
      const sensor = await prisma.sensor.findFirst({ where: { vehicleId: busId.toString() } });
      if (!sensor) return res.status(404).json({ message: 'Sensor not found for this bus' });
      sensorWhere.id = sensor.id;
      historyWhere.sensorId = sensor.id;
    }

    if (status) {
      const statusUpper = status.toString().toUpperCase();
      historyWhere.description = { contains: statusUpper };
    }

    if (fromDate || toDate) {
      historyWhere.timestamp = {
        ...(fromDate && { gte: new Date(fromDate.toString()) }),
        ...(toDate && { lte: new Date(toDate.toString()) }),
      };
    }

    const sensors = await prisma.sensor.findMany({
      where: sensorWhere,
      include: {
        histories: {
          where: historyWhere,
          orderBy: { timestamp: 'desc' },
        },
      },
    });

    const result = sensors.map((s) => ({
      sensorId: s.id,
      sensorCode: s.sensorCode,
      isActive: s.isActive,
      lastSeen: s.lastSeen,
      healthEvents: s.histories.map(h => ({
        id: h.id,
        timestamp: h.timestamp,
        description: h.description,
      })),
    }));

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch sensor status' });
  }
}

















// // src/api/controllers/sensorController.ts
// import { Request, Response } from 'express';
// import prisma from '../../lib/prisma';

// // Fetch sensor status with optional filters
// export async function getSensorStatus(req: Request, res: Response) {
//   const { busId, status, fromDate, toDate } = req.query;

//   try {
//     const sensorWhere: any = {};
//     const eventWhere: any = {};

//     if (busId) {
//       const sensor = await prisma.sensor.findFirst({ where: { vehicleId: busId.toString() } });
//       if (!sensor) return res.status(404).json({ message: 'Sensor not found for this bus' });
//       sensorWhere.id = sensor.id;
//       eventWhere.sensorId = sensor.id;
//     }

//     if (status) {
//       eventWhere.status = status.toString().toUpperCase();
//     }

//     if (fromDate && toDate) {
//       eventWhere.timestamp = {
//         gte: new Date(fromDate.toString()),
//         lte: new Date(toDate.toString()),
//       };
//     }

//     const sensors = await prisma.sensor.findMany({
//       where: sensorWhere,
//       include: {
//         onOffEvents: {
//           where: eventWhere,
//           orderBy: { timestamp: 'desc' },
//         },
//       },
//     });

//     const result = sensors.map((s) => ({
//       sensorId: s.id,
//       sensorCode: s.sensorCode,
//       isActive: s.isActive,
//       lastSeen: s.lastSeen,
//       onOffEvents: s.onOffEvents,
//     }));

//     res.json(result);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: 'Failed to fetch sensor status' });
//   }
// }
