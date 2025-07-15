import { Request, Response } from 'express';
import prisma from '../../lib/prisma';


export async function getDashboardData(req: Request, res: Response) {
  try {
    // Total buses
    const totalBuses = await prisma.vehicle.count();

    // Count alerts by type
    const [totalThefts, totalRefuels, activeAlerts] = await Promise.all([
      prisma.alert.count({ where: { type: 'THEFT' } }),
      prisma.alert.count({ where: { type: 'REFUEL' } }),
      prisma.alert.count(), // you can customize this with status if needed
    ]);

    // Fetch top 5 buses (recently active ones)
    const topVehicles = await prisma.vehicle.findMany({
      take: 6,
      include: {
        driver: true,
        route: true,
        sensor: {
          include: {
            readings: {
              orderBy: { timestamp: 'desc' },
              take: 1,
            },
            alerts: true,
          },
        },
      },
    });

    const topBuses = topVehicles.map(vehicle => {
      const sensor = vehicle.sensor;
      const latestReading = sensor?.readings?.[0];
      const fuelLevel = latestReading?.fuelLevel ?? 0;

      // Decide bus status
      let status: 'normal' | 'alert' | 'offline' = 'normal';
      if (!sensor?.isActive || !latestReading) status = 'offline';
      else if (sensor.alerts.some(a => a.type === 'THEFT')) status = 'alert';

      return {
        busId: vehicle.id,
        registrationNo: vehicle.registrationNo,
        driverName: vehicle.driver?.name ?? 'Unassigned',
        routeName: vehicle.route?.name ?? 'N/A',
        fuelLevel,
        status,
      };
    });

    return res.json({
      totalBuses,
      activeAlerts,
      thefts: totalThefts,
      refuels: totalRefuels,
      topBuses,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Failed to load dashboard data' });
  }
}
