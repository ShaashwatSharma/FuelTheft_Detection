import { Request, Response } from 'express';
import prisma from '../../lib/prisma';

// Fetch fuel usage statistics for a specific bus
// GET /fuelusage?busId=<id>&fromDate=<date>&toDate=<date>      
export async function getFuelUsage(req: Request, res: Response) {
  const { busId, fromDate, toDate } = req.query;

  if (!busId) {
    return res.status(400).json({ message: 'Missing busId' });
  }

  const from = fromDate ? new Date(fromDate.toString()) : new Date('2000-01-01');
  const to = toDate ? new Date(toDate.toString()) : new Date();

  try {
    const sensor = await prisma.sensor.findFirst({
      where: { vehicleId: busId.toString() },
      include: {
        readings: {
          where: {
            timestamp: { gte: from, lte: to },
          },
        },
        alerts: {
          where: {
            timestamp: { gte: from, lte: to },
          },
        },
      },
    });

    if (!sensor) {
      return res.status(404).json({ message: 'Sensor not found for this bus' });
    }

    const { readings, alerts } = sensor;

    let totalFuelStolen = 0;
    let totalFuelRefueled = 0;
    let distanceTravelled = 0;

    for (const alert of alerts) {
      if (alert.type === 'THEFT') totalFuelStolen += 1; // or alert.fuelDropLitres if tracked
      if (alert.type === 'REFUEL') totalFuelRefueled += 1;
    }

    for (let i = 1; i < readings.length; i++) {
      const prev = readings[i - 1];
      const curr = readings[i];

      const delta = curr.fuelLevel - prev.fuelLevel;

      // Fuel consumption is negative change
      if (delta < 0) {
        totalFuelRefueled += 0; // avoid accidental refuel count
      }

      distanceTravelled += curr.distanceKm ?? 0;
    }

    const totalFuelConsumed = totalFuelStolen + (readings.length > 0 ? readings[0].fuelLevel - readings.at(-1)!.fuelLevel : 0);
    const fuelEfficiency = totalFuelConsumed > 0 ? distanceTravelled / totalFuelConsumed : null;

    res.json({
      totalFuelConsumed: parseFloat(totalFuelConsumed.toFixed(2)),
      totalFuelStolen: parseFloat(totalFuelStolen.toFixed(2)),
      totalFuelRefueled: parseFloat(totalFuelRefueled.toFixed(2)),
      distanceTravelled: parseFloat(distanceTravelled.toFixed(2)),
      fuelEfficiency: fuelEfficiency ? parseFloat(fuelEfficiency.toFixed(2)) : null,
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to fetch fuel usage' });
  }
}
