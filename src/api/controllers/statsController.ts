import { Request, Response } from 'express';
import prisma from '../../lib/prisma';

export async function getStatsSummary(req: Request, res: Response) {
  try {
    const vehicles = await prisma.vehicle.findMany({
      include: {
        events: true,
        sensor: {
          include: {
            alerts: true,
          },
        },
      },
    });

    const stats = vehicles.map(vehicle => {
      const thefts = vehicle.events.filter(e => e.type === 'THEFT');
      const refuels = vehicle.events.filter(e => e.type === 'REFUEL');
      const fuelStolen = thefts.reduce((sum, e) => sum + (e.fuelDropLitres || 0), 0);
      const fuelRefueled = refuels.reduce((sum, e) => sum + (e.fuelDropLitres || 0), 0);
      const alertCount = vehicle.sensor?.alerts.length ?? 0;

      return {
        busId: vehicle.id,
        registrationNo: vehicle.registrationNo,
        fuelStolen: Number(fuelStolen.toFixed(2)),
        fuelRefueled: Number(fuelRefueled.toFixed(2)),
        theftCount: thefts.length,
        refuelCount: refuels.length,
        alertCount,
      };
    });

    res.json({ buses: stats });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to load stats summary' });
  }
}
