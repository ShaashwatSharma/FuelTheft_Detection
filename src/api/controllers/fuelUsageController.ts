import { Request, Response } from 'express';
import prisma from '../../lib/prisma';
import { AlertType, Prisma } from '../../generated/prisma';
import { FUEL_ANOMALY_THRESHOLDS } from '../../config/fuel';

interface FuelUsageResponse {
  totalFuelConsumed: number;   // L (baseline consumption + theft)
  totalFuelStolen: number;     // L (from THEFT events)
  totalFuelRefueled: number;   // L (from REFUEL events + detected jumps)
  distanceTravelled: number;   // km
  fuelEfficiency: number | null; // km/L
  message?: string;
  dataPoints: number;          // Number of readings processed
  dateRange?: { from: Date; to: Date }; // Date range used (if specified)
}

interface FuelReading {
  timestamp: Date;
  fuelLevel: number | null;
  odometerKm: number | null;
}

// ---------- controller ----------

export async function getFuelUsage(req: Request, res: Response) {
  const { busId, fromDate, toDate } = req.query;

  if (!busId || typeof busId !== 'string') {
    return res.status(400).json({ message: 'Missing or invalid busId' });
  }

  // Validate and parse date range (if provided)
  let from: Date | undefined = undefined;
  let to: Date | undefined = undefined;
  let hasDateRange = false;
  
  if (fromDate && toDate) {
    try {
      from = new Date(String(fromDate));
      to = new Date(String(toDate));
      
      if (isNaN(from.getTime()) || isNaN(to.getTime())) {
        return res.status(400).json({ message: 'Invalid date format' });
      }
      
      if (from > to) {
        // Swap if from > to
        const temp = from;
        from = to;
        to = temp;
      }
      hasDateRange = true;
    } catch (error) {
      return res.status(400).json({ message: 'Invalid date format' });
    }
  }

  try {
    // Find the sensor for the bus
    const sensor = await prisma.sensor.findFirst({
      where: { vehicleId: busId },
      select: { id: true },
    });

    if (!sensor) {
      return res.status(404).json({ message: 'Sensor not found for this bus' });
    }

    // Build where clause for readings and events
    const readingWhere: Prisma.SensorReadingWhereInput = {
      sensorId: sensor.id,
      odometerKm: { not: null },
    };
    const eventWhere: Prisma.HistoryWhereInput = {
      sensorId: sensor.id,
      type: { in: ['THEFT', 'REFUEL'] as AlertType[] },
    };
    
    // Only apply date filters if date range is provided
    if (hasDateRange && from && to) {
      readingWhere.timestamp = { gte: from, lte: to };
      eventWhere.timestamp = { gte: from, lte: to };
    }

    console.log(`[FuelUsage] Fetching fuel usage data for sensor ${sensor.id}${hasDateRange ? ` from ${from} to ${to}` : ' (all available data)'}`);

    // Fetch readings and events - NO LIMITS
    const readings: FuelReading[] = await prisma.sensorReading.findMany({
      where: readingWhere,
      orderBy: { timestamp: 'asc' },
      select: { timestamp: true, fuelLevel: true, odometerKm: true },
      // No take/skip limits - fetch all data
    });

    const events = await prisma.history.findMany({
      where: eventWhere,
      select: { type: true, fuelDropLitres: true },
      // No take/skip limits - fetch all data
    });

    console.log(`[FuelUsage] Retrieved ${readings.length} readings and ${events.length} events`);

    // --- Aggregate ML-detected events from database ---
    let totalFuelStolen = 0;
    let totalFuelRefueled = 0;

    for (const event of events) {
      const amount = typeof event.fuelDropLitres === 'number' ? Math.abs(event.fuelDropLitres) : 0;
      if (event.type === 'THEFT') {
        totalFuelStolen += amount;
      } else if (event.type === 'REFUEL') {
        totalFuelRefueled += amount;
      }
    }

    // --- Calculate distance from odometer readings (FIXED LOGIC) ---
    let distanceTravelled = 0;
    if (readings.length > 1) {
      // Sort readings by timestamp to ensure correct order
      const sortedReadings = [...readings].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      
      // Find first and last valid odometer readings (FIXED: no array mutation)
      const firstOdo = sortedReadings.find(r => r.odometerKm !== null)?.odometerKm;
      const lastOdo = [...sortedReadings].reverse().find(r => r.odometerKm !== null)?.odometerKm;
      
      if (typeof firstOdo === 'number' && typeof lastOdo === 'number' && lastOdo >= firstOdo) {
        distanceTravelled = lastOdo - firstOdo;
      }
    }

    // --- Calculate fuel consumption from readings (COMPREHENSIVE LOGIC) ---
    let fuelConsumedFromReadings = 0;
    let detectedRefuelsFromReadings = 0;
    let detectedTheftsFromReadings = 0;
    
    if (readings.length > 1) {
      // Sort readings by timestamp to ensure correct order
      const sortedReadings = [...readings].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      
      // Comprehensive fuel analysis
      let currentFuelLevel = null;
      let totalNormalConsumption = 0;
      let totalRefuels = 0;
      let totalThefts = 0;
      
      for (let i = 0; i < sortedReadings.length; i++) {
        const reading = sortedReadings[i];
        
        if (reading.fuelLevel === null) continue;
        
        if (currentFuelLevel === null) {
          // First valid reading
          currentFuelLevel = reading.fuelLevel;
          console.log(`[FuelUsage] Starting fuel level: ${currentFuelLevel.toFixed(2)}L at ${reading.timestamp}`);
        } else {
          const fuelChange = reading.fuelLevel - currentFuelLevel;
          
          if (fuelChange < 0) {
            // Fuel level decreased
            const absChange = Math.abs(fuelChange);
            
            // Determine if this is normal consumption or theft using configurable threshold
            if (absChange > FUEL_ANOMALY_THRESHOLDS.THEFT) {
              // Large drop - likely theft
              totalThefts += absChange;
              console.log(`[FuelUsage] 🚨 Possible theft detected: -${absChange.toFixed(2)}L at ${reading.timestamp} (threshold: ${FUEL_ANOMALY_THRESHOLDS.THEFT}L)`);
            } else {
              // Small drop - normal consumption
              totalNormalConsumption += absChange;
              console.log(`[FuelUsage] ⛽ Normal consumption: -${absChange.toFixed(2)}L at ${reading.timestamp}`);
            }
          } else if (fuelChange > FUEL_ANOMALY_THRESHOLDS.REFUEL) {
            // Fuel level increased significantly - refuel
            totalRefuels += fuelChange;
            console.log(`[FuelUsage] ⛽ Refuel detected: +${fuelChange.toFixed(2)}L at ${reading.timestamp} (threshold: ${FUEL_ANOMALY_THRESHOLDS.REFUEL}L)`);
          } else if (fuelChange > 0) {
            // Small increase - might be sensor noise or small refuel
            console.log(`[FuelUsage] 📊 Small fuel increase: +${fuelChange.toFixed(2)}L at ${reading.timestamp} (ignored, below threshold: ${FUEL_ANOMALY_THRESHOLDS.REFUEL}L)`);
          }
          
          currentFuelLevel = reading.fuelLevel;
        }
      }
      
      fuelConsumedFromReadings = totalNormalConsumption;
      detectedRefuelsFromReadings = totalRefuels;
      detectedTheftsFromReadings = totalThefts;
      
      console.log(`[FuelUsage] 📊 Fuel analysis summary:
        - Normal consumption: ${totalNormalConsumption.toFixed(2)}L
        - Detected thefts: ${totalThefts.toFixed(2)}L
        - Detected refuels: ${totalRefuels.toFixed(2)}L`);
    }

    // Total refueled includes both event-based and detected refuels
    totalFuelRefueled += detectedRefuelsFromReadings;

    // Total stolen includes both ML-detected and sensor-detected thefts
    totalFuelStolen += detectedTheftsFromReadings;

    // Total consumed = normal consumption + all thefts (both ML and sensor detected)
    const totalFuelConsumed = fuelConsumedFromReadings + totalFuelStolen;

    // Fuel efficiency (km/L) - only calculate if we have valid data
    const fuelEfficiency =
      totalFuelConsumed > 0 && distanceTravelled > 0
        ? distanceTravelled / totalFuelConsumed
        : null;

    console.log(`[FuelUsage] 🎯 Final fuel usage calculations:
      - Normal fuel consumption: ${fuelConsumedFromReadings.toFixed(2)}L
      - ML-detected thefts: ${(totalFuelStolen - detectedTheftsFromReadings).toFixed(2)}L
      - Sensor-detected thefts: ${detectedTheftsFromReadings.toFixed(2)}L
      - Total fuel stolen: ${totalFuelStolen.toFixed(2)}L
      - ML-detected refuels: ${(totalFuelRefueled - detectedRefuelsFromReadings).toFixed(2)}L
      - Sensor-detected refuels: ${detectedRefuelsFromReadings.toFixed(2)}L
      - Total fuel refueled: ${totalFuelRefueled.toFixed(2)}L
      - Total fuel consumed: ${totalFuelConsumed.toFixed(2)}L
      - Distance travelled: ${distanceTravelled.toFixed(2)}km
      - Fuel efficiency: ${fuelEfficiency?.toFixed(2) || 'N/A'} km/L`);

    const response: FuelUsageResponse = {
      totalFuelConsumed: +totalFuelConsumed.toFixed(2),
      totalFuelStolen: +totalFuelStolen.toFixed(2),
      totalFuelRefueled: +totalFuelRefueled.toFixed(2),
      distanceTravelled: +distanceTravelled.toFixed(2),
      fuelEfficiency: fuelEfficiency !== null ? +fuelEfficiency.toFixed(2) : null,
      dataPoints: readings.length,
      dateRange: hasDateRange && from && to ? { from, to } : undefined,
      message:
        readings.length < 2
          ? 'Insufficient readings for accurate consumption/distance; aggregates may be limited.'
          : hasDateRange 
            ? undefined 
            : `Processed all available data (${readings.length} readings)`,
    };

    console.log(`[FuelUsage] Fuel usage calculation complete: ${readings.length} data points processed`);
    res.json(response);
  } catch (err) {
    console.error('[FuelUsage] Error fetching fuel usage:', err);
    res.status(500).json({ message: 'Failed to fetch fuel usage' });
  }
}
