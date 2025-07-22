import { Request, Response } from 'express';
import prisma from '../../lib/prisma';

// Fetch alerts with optional filters   
// GET /alerts?type&sensorId&fromDate&toDate&sort=desc&limit=100&offset=0
export async function getAlerts(req: Request, res: Response) {
  const {
    type,
    sensorId,
    fromDate,
    toDate,
    sort = 'desc',
    limit = '100',
    offset = '0',
  } = req.query;

  try {
    const where: any = {};

    // Filter by sensor
    if (sensorId) {
      where.sensorId = sensorId.toString();
    }

    // Filter by type: support comma-separated values
    if (type) {
      const types = type
        .toString()
        .split(',')
        .map((t) => t.trim().toUpperCase());

      if (types.length === 1) {
        where.type = types[0];
      } else if (types.length > 1) {
        where.type = { in: types };
      }
    }

    // Filter by date range
    if (fromDate || toDate) {
      where.timestamp = {
        ...(fromDate && { gte: new Date(fromDate.toString()) }),
        ...(toDate && { lte: new Date(toDate.toString()) }),
      };
    }

    // Fetch alerts with vehicle, driver, route info
    const alerts = await prisma.alert.findMany({
      where,
      orderBy: {
        timestamp: sort === 'asc' ? 'asc' : 'desc',
      },
      skip: parseInt(offset.toString(), 10),
      take: parseInt(limit.toString(), 10),
      include: {
        sensor: {
          include: {
            vehicle: {
              include: {
                driver: true,
                route: true,
              },
            },
          },
        },
      },
    });

    // Format response
    const formatted = alerts.map((a) => ({
      id: a.id,
      type: a.type,
      timestamp: a.timestamp,
      description: a.description,
      location: {
        lat: a.locationLat,
        long: a.locationLong,
      },
      bus: a.sensor?.vehicle
        ? {
            id: a.sensor.vehicle.id,
            registrationNo: a.sensor.vehicle.registrationNo,
            driver: a.sensor.vehicle.driver?.name || null,
            route: a.sensor.vehicle.route?.name || null,
          }
        : null,
    }));

    res.json(formatted);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch alerts' });
  }
}
