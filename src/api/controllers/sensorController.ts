// src/api/controllers/sensorController.ts
import { Request, Response } from 'express';
import prisma from '../../lib/prisma';
import { AlertType, SensorStatus, Prisma } from '../../generated/prisma';

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

function asSensorStatus(v: unknown): SensorStatus | null {
  const s = String(v ?? '').trim().toUpperCase();
  if (s === 'OK' || s === 'OFFLINE' || s === 'FAULTY' || s === 'UNKNOWN') return s as SensorStatus;
  return null;
}

// -------- controller ---------------------------------------------------------

// GET /sensors/health?busId=<vehicleId>&status=<OK|OFFLINE|... or text>&fromDate=&toDate=
export async function getSensorStatus(req: Request, res: Response) {
  const { busId, status, fromDate, toDate } = req.query;

  try {
    const { from, to } = normalizeRange(fromDate, toDate);

    // Build Sensor filters
    const sensorWhere: Prisma.SensorWhereInput = {};

    // If caller passed a vehicle id (busId), restrict to that sensor
    if (busId) {
      const sensor = await prisma.sensor.findFirst({
        where: { vehicleId: String(busId) },
        select: { id: true },
      });
      if (!sensor) return res.status(404).json({ message: 'Sensor not found for this bus' });
      sensorWhere.id = sensor.id;
    }

    // If status matches SensorStatus enum, filter sensors by that status.
    // Otherwise we'll use it as a substring filter on Alert.description below.
    const sensorStatus = asSensorStatus(status);
    if (sensorStatus) {
      sensorWhere.status = sensorStatus;
    }

    // Build Alert (health) filters
    const alertWhere: Prisma.AlertWhereInput = {
      type: 'SENSOR_HEALTH' as AlertType,
      timestamp: { gte: from, lte: to },
    };

    // If status was NOT a SensorStatus enum, treat it as a free-text filter on description
    if (!sensorStatus && status) {
      alertWhere.description = { contains: String(status), mode: 'insensitive' };
    }

    const sensors = await prisma.sensor.findMany({
      where: sensorWhere,
      include: {
        // ⚠️ Sensor relation names are PascalCase in your schema
        Alert: {
          where: alertWhere,
          orderBy: { timestamp: 'desc' },
        },
        vehicle: { select: { id: true, registrationNo: true } },
      },
      orderBy: { installedAt: 'desc' },
    });

    const result = sensors.map((s) => ({
      sensorId: s.id,
      sensorCode: s.sensorCode,
      sensorStatus: s.status,
      isActive: s.isActive,
      lastSeen: s.lastSeen,
      vehicle: s.vehicle ? { id: s.vehicle.id, registrationNo: s.vehicle.registrationNo } : null,
      // Health data comes from Sensor.Alert where type = SENSOR_HEALTH
      healthEvents: s.Alert.map((a) => ({
        id: a.id,
        timestamp: a.timestamp,
        description: a.description,
        locationLat: a.locationLat,
        locationLong: a.locationLong,
      })),
    }));

    res.json({ range: { from, to }, data: result });
  } catch (err) {
    console.error('getSensorStatus error:', err);
    res.status(500).json({ message: 'Failed to fetch sensor status' });
  }
}















// // src/api/controllers/sensorController.ts
// import { Request, Response } from 'express';
// import prisma from '../../lib/prisma';

// // Fetch sensor health status with optional filters
// export async function getSensorStatus(req: Request, res: Response) {
//   const { busId, status, fromDate, toDate } = req.query;

//   try {
//     const sensorWhere: any = {};
//     const historyWhere: any = { type: 'SENSOR_HEALTH' };

//     if (busId) {
//       const sensor = await prisma.sensor.findFirst({ where: { vehicleId: busId.toString() } });
//       if (!sensor) return res.status(404).json({ message: 'Sensor not found for this bus' });
//       sensorWhere.id = sensor.id;
//       historyWhere.sensorId = sensor.id;
//     }

//     if (status) {
//       const statusUpper = status.toString().toUpperCase();
//       historyWhere.description = { contains: statusUpper };
//     }

//     if (fromDate || toDate) {
//       historyWhere.timestamp = {
//         ...(fromDate && { gte: new Date(fromDate.toString()) }),
//         ...(toDate && { lte: new Date(toDate.toString()) }),
//       };
//     }

//     const sensors = await prisma.sensor.findMany({
//       where: sensorWhere,
//       include: {
//         histories: {
//           where: historyWhere,
//           orderBy: { timestamp: 'desc' },
//         },
//       },
//     });

//     const result = sensors.map((s) => ({
//       sensorId: s.id,
//       sensorCode: s.sensorCode,
//       isActive: s.isActive,
//       lastSeen: s.lastSeen,
//       healthEvents: s.histories.map(h => ({
//         id: h.id,
//         timestamp: h.timestamp,
//         description: h.description,
//       })),
//     }));

//     res.json(result);
//   } catch (err) {
//     console.error(err);
//     res.status(500).json({ message: 'Failed to fetch sensor status' });
//   }
// }

















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
