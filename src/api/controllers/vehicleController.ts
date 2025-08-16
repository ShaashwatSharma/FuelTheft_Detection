import { Request, Response } from 'express';
import prisma from '../../lib/prisma';
import { Prisma } from '../../generated/prisma';
import { normalizeRangeOptional } from '../../utils/dateUtils';

// -------- utils --------------------------------------------------------------

function parseIncludeList(q: unknown): Set<string> {
  if (!q) return new Set();
  return new Set(
    String(q)
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

// -------- controllers --------------------------------------------------------

// GET /vehicles
export async function getVehicles(req: Request, res: Response) {
  try {
    const vehicles = await prisma.vehicle.findMany({
      include: {
        driver: { select: { name: true } },
        route: { select: { name: true } },
        // quick status info for list view
        sensor: { select: { status: true, lastSeen: true } },
      },
      orderBy: { createdAt: 'desc' },
      // No take/skip limits - fetch all vehicles
    });

    const result = vehicles.map(v => ({
      id: v.id,
      registrationNo: v.registrationNo,
      driver: v.driver?.name ?? null,
      route: v.route?.name ?? null,
      sensorStatus: v.sensor?.status ?? null,
      sensorLastSeen: v.sensor?.lastSeen ?? null,
    }));

    console.log(`[Vehicles] Retrieved ${result.length} vehicles`);

    res.json({
      data: result,
      count: result.length
    });
  } catch (err) {
    console.error('[Vehicles] getVehicles error:', err);
    res.status(500).json({ message: 'Failed to fetch vehicles' });
  }
}

// GET /vehicles/:id/details
// Query params:
//   include=alerts,readings,histories,events
//   fromDate=ISO | toDate=ISO
export async function getVehicleDetails(req: Request, res: Response) {
  const { id } = req.params;
  const includes = parseIncludeList(req.query.include);
  const { from, to } = normalizeRangeOptional(req.query.fromDate, req.query.toDate);
  const hasDateRange = from !== undefined && to !== undefined;

  const wantAlerts = includes.has('alerts');
  const wantReadings = includes.has('readings');
  const wantHistories = includes.has('histories');
  const wantEvents = includes.has('events');

  try {
    const vehicle = await prisma.vehicle.findUnique({
      where: { id },
      include: {
        driver: true,
        route: true,
        sensor:
          wantAlerts || wantReadings || wantHistories || wantEvents
            ? {
                include: {
                  // ⚠️ Sensor relation names are PascalCase in your schema
                  Alert: wantAlerts
                    ? {
                        where: hasDateRange && from && to ? { timestamp: { gte: from, lte: to } } : {},
                        orderBy: { timestamp: 'desc' },
                        // No take/skip limits - fetch all data
                      }
                    : false,
                  readings: wantReadings
                    ? {
                        where: hasDateRange && from && to ? { timestamp: { gte: from, lte: to } } : {},
                        orderBy: { timestamp: 'asc' },
                        // No take/skip limits - fetch all data
                      }
                    : false,
                  History: wantHistories
                    ? {
                        where: hasDateRange && from && to ? { timestamp: { gte: from, lte: to } } : {},
                        orderBy: { timestamp: 'desc' },
                        // No take/skip limits - fetch all data
                      }
                    : false,
                  Event: wantEvents
                    ? {
                        where: hasDateRange && from && to ? { timestamp: { gte: from, lte: to } } : {},
                        orderBy: { timestamp: 'desc' },
                        // No take/skip limits - fetch all data
                      }
                    : false,
                },
              }
            : false,
        // You also have vehicle-level relations if you ever want them:
        // alerts: wantAlerts ? { where: { timestamp: { gte: from, lte: to } } } : false,
        // histories: wantHistories ? { where: { timestamp: { gte: from, lte: to } } } : false,
        // events: wantEvents ? { where: { timestamp: { gte: from, lte: to } } } : false,
      },
    });

    if (!vehicle) return res.status(404).json({ message: 'Vehicle not found' });

    console.log(`[Vehicles] Retrieved vehicle details for ${id}${hasDateRange ? ` with date range ${from} to ${to}` : ' (all available data)'}`);

    res.json({
      ...vehicle,
      // Optional: echo back the applied range for the client
      range: hasDateRange && from && to ? { from, to } : 'all available data',
    });
  } catch (err) {
    console.error('[Vehicles] getVehicleDetails error:', err);
    res.status(500).json({ message: 'Failed to fetch vehicle details' });
  }
}
