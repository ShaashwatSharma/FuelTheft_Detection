import { Request, Response } from 'express';
import prisma from '../../lib/prisma';
import { AlertType } from '../../generated/prisma';

const dateRanges: Record<string, () => { from: Date; to: Date }> = {
  today: () => {
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    return { from, to: new Date() };
  },
  this_week: () => {
    const from = new Date();
    const day = from.getDay();
    from.setDate(from.getDate() - day);
    from.setHours(0, 0, 0, 0);
    return { from, to: new Date() };
  },
  this_month: () => {
    const from = new Date();
    from.setDate(1);
    from.setHours(0, 0, 0, 0);
    return { from, to: new Date() };
  },
};

export async function getAlerts(req: Request, res: Response) {
  const busId = req.query.busId?.toString();
  const rangeKey = req.query.range?.toString() || 'today';
  const { from, to } = dateRanges[rangeKey] ? dateRanges[rangeKey]() : dateRanges['today']();

  try {
    if (!busId) return res.status(400).json({ message: 'Missing busId' });

    const sensor = await prisma.sensor.findFirst({
      where: { vehicleId: busId },
    });

    if (!sensor) return res.status(404).json({ message: 'Sensor not found for this bus' });

    const alerts = await prisma.alert.findMany({
      where: {
        sensorId: sensor.id,
        timestamp: {
          gte: from,
          lte: to,
        },
      },
      orderBy: { timestamp: 'desc' },
    });

    const formatted = alerts.map(a => ({
      type: a.type,
      timestamp: a.timestamp,
      description: a.description,
      location: {
        lat: a.locationLat,
        long: a.locationLong,
      },
    }));

    res.json(formatted);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch alerts' });
  }
}
export async function getAllAlerts(req: Request, res: Response) {
  const busId = req.query.busId?.toString();
  const type = req.query.type?.toString() as AlertType;
  const rangeKey = req.query.range?.toString() || 'this_week';
  const { from, to } = dateRanges[rangeKey] ? dateRanges[rangeKey]() : dateRanges['this_week']();

  try {
    const whereClause: any = {
      timestamp: {
        gte: from,
        lte: to,
      },
    };

    if (type) whereClause.type = type;

    if (busId) {
      const sensor = await prisma.sensor.findFirst({
        where: { vehicleId: busId },
      });

      if (!sensor) return res.status(404).json({ message: 'Sensor not found for bus' });

      whereClause.sensorId = sensor.id;
    }

    const alerts = await prisma.alert.findMany({
      where: whereClause,
      orderBy: { timestamp: 'desc' },
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

    const formatted = alerts.map(a => ({
      type: a.type,
      timestamp: a.timestamp,
      description: a.description,
      location: {
        lat: a.locationLat,
        long: a.locationLong,
      },
      bus: {
        id: a.sensor.vehicle.id,
        registrationNo: a.sensor.vehicle.registrationNo,
        driver: a.sensor.vehicle.driver?.name,
        route: a.sensor.vehicle.route?.name,
      },
    }));

    res.json(formatted);
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch all alerts' });
  }
}
