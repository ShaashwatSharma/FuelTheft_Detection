import { Request, Response } from 'express';
import prisma from '../../lib/prisma';

const dateRanges: Record<string, () => { from: Date; to: Date }> = {
  today: () => {
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    return { from, to: new Date() };
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
    const day = from.getDay(); // 0 (Sun) to 6 (Sat)
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

export async function getBusDetails(req: Request, res: Response) {
  const { id } = req.params;
  const rangeKey = req.query.range?.toString() || 'today';
  const { from, to } = dateRanges[rangeKey] ? dateRanges[rangeKey]() : dateRanges['today']();

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

const latestReading = vehicle.sensor.readings[vehicle.sensor.readings.length - 1];

    res.json({
      registrationNo: vehicle.registrationNo,
      driver: vehicle.driver?.name,
      route: vehicle.route?.name,
      capacity: vehicle.capacity,
      currentFuelLevel: latestReading?.fuelLevel,
      readings: vehicle.sensor.readings.map(r => ({
        timestamp: r.timestamp,
        fuelLevel: r.fuelLevel,
      })),
      events: vehicle.events.map(e => ({
        type: e.type,
        startTime: e.startTime,
        endTime: e.endTime,
        fuelDropLitres: e.fuelDropLitres,
      })),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to load bus details' });
  }
}
