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

/**
 * Calculate real vehicle mileage from odometer and fuel data
 * Returns average mileage (km/L) from recent sensor readings
 */
async function calculateVehicleMileage(vehicleId: string): Promise<number | null> {
  try {
    // Get recent sensor readings for this vehicle
    const recentReadings = await prisma.sensorReading.findMany({
      where: {
        sensor: { vehicleId },
        odometerKm: { not: null },
        fuelLevel: { not: null },
        processed: true // Only processed readings
      },
      orderBy: { timestamp: 'desc' },
      take: 20, // Last 20 readings for better accuracy
      include: {
        sensor: true
      }
    });

    if (recentReadings.length < 2) {
      console.log(`[Mileage] Insufficient data for vehicle ${vehicleId} (${recentReadings.length} readings)`);
      return null; // Need at least 2 readings
    }

    // Calculate mileage for each interval
    const mileages: number[] = [];
    
    for (let i = 0; i < recentReadings.length - 1; i++) {
      const current = recentReadings[i];
      const previous = recentReadings[i + 1];
      
      // Ensure we have valid data
      if (!current.odometerKm || !previous.odometerKm || 
          !current.fuelLevel || !previous.fuelLevel) {
        continue;
      }
      
      const distanceKm = current.odometerKm - previous.odometerKm;
      const fuelConsumedL = previous.fuelLevel - current.fuelLevel;
      
      // Validate calculations
      if (distanceKm > 0 && fuelConsumedL > 0) {
        const mileage = distanceKm / fuelConsumedL;
        
        // Sanity check: reasonable mileage range (1-15 km/L)
        if (mileage >= 1 && mileage <= 15) {
          mileages.push(mileage);
        } else {
          console.log(`[Mileage] Skipping unrealistic mileage: ${mileage.toFixed(2)} km/L for vehicle ${vehicleId}`);
        }
      }
    }

    if (mileages.length === 0) {
      console.log(`[Mileage] No valid mileage calculations for vehicle ${vehicleId}`);
      return null;
    }

    // Return average mileage
    const avgMileage = mileages.reduce((sum, m) => sum + m, 0) / mileages.length;
    console.log(`[Mileage] Calculated average mileage for vehicle ${vehicleId}: ${avgMileage.toFixed(2)} km/L (from ${mileages.length} intervals)`);
    
    return avgMileage;
  } catch (error) {
    console.error(`[Mileage] Error calculating mileage for vehicle ${vehicleId}:`, error);
    return null;
  }
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
    // Get vehicle data
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

    // Calculate real mileage and update vehicle if needed
    const realMileage = await calculateVehicleMileage(id);
    
    if (realMileage && realMileage !== vehicle.mileageEst) {
      await prisma.vehicle.update({
        where: { id },
        data: { mileageEst: realMileage }
      });
      
      console.log(`⛽ Vehicle ${vehicle.registrationNo}: Updated mileage from ${vehicle.mileageEst?.toFixed(2) ?? 'null'} to ${realMileage.toFixed(2)} km/L`);
      
      // Update the vehicle object for response
      vehicle.mileageEst = realMileage;
    }

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
