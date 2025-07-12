import { Request, Response } from 'express';
import prisma from '../../lib/prisma';

export async function getDashboardData(req: Request, res: Response) {
  try {
    const vehicles = await prisma.vehicle.findMany({
      take: 5,
      include: {
        driver: true,
        route: true,
        sensor: {
          include: {
            alerts: true,
            readings: {
              orderBy: { timestamp: 'desc' },
              take: 1,
            },
          },
        },
      },
    });

    const data = vehicles.map(vehicle => {
      const sensor = vehicle.sensor;
      const latestFuel =
        sensor?.readings?.[0]?.fuelLevel ?? 'No data';
      const totalTheft = sensor?.alerts?.filter(a => a.type === 'THEFT')?.length ?? 0;

      return {
        registrationNo: vehicle.registrationNo,
        driver: vehicle.driver?.name ?? 'Unassigned',
        route: vehicle.route?.name ?? 'N/A',
        latestFuel,
        theftEvents: totalTheft,
        imageUrl: `https://via.placeholder.com/100x60?text=${vehicle.registrationNo}`,
      };
    });

    res.json({ buses: data });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to load dashboard data' });
  }
}
