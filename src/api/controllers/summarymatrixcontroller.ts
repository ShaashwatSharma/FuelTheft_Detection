import { Request, Response } from 'express';
import prisma from '../../lib/prisma';

// GET /summary-metrics?busId=<>&fromDate=<>&toDate=<>
export async function getSummaryMetrics(req: Request, res: Response) {
  const { busId, fromDate, toDate } = req.query;

  if (!busId || typeof busId !== 'string') {
    return res.status(400).json({ message: 'Missing or invalid busId' });
  }

  let from: Date;
  let to: Date;
  try {
    from = fromDate ? new Date(fromDate.toString()) : new Date('2000-01-01');
    to = toDate ? new Date(toDate.toString()) : new Date();

    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      return res.status(400).json({ message: 'Invalid date format' });
    }
    if (from > to) {
      return res.status(400).json({ message: 'fromDate cannot be after toDate' });
    }
  } catch {
    return res.status(400).json({ message: 'Invalid date parsing' });
  }

  try {
    const summaries = await prisma.summaryMetrics.findMany({
      where: {
        vehicleId: busId,
        fromDate: { gte: from },
        toDate: { lte: to },
      },
      orderBy: { fromDate: 'desc' },
    });

    if (!summaries.length) {
      return res.status(404).json({ message: 'No summary metrics found for this bus' });
    }

    const result = summaries.map((s) => ({
      id: s.id,
      fromDate: s.fromDate,
      toDate: s.toDate,
      sFuelLevel: s.sFuelLevel,
      eFuelLevel: s.eFuelLevel,
      totalFuelConsumed: s.totalFuelConsumed,
      totalFuelFills: s.totalFuelFills,
      totalFuelDrops: s.totalFuelDrops,
      kmpl: s.kmpl,
      totalDistanceKm: s.totalDistanceKm,
      totalRunningHours: s.totalRunningHours,
      totalIdleHours: s.totalIdleHours,
      totalStoppageHours: s.totalStoppageHours,
      dropAlert: s.dropAlert,
      fillAlert: s.fillAlert,
    }));

    res.json(result);
  } catch (err) {
    console.error('Error fetching summary metrics:', err);
    res.status(500).json({ message: 'Failed to fetch summary metrics' });
  }
}
