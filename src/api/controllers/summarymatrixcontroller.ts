import { Request, Response } from 'express';
import prisma from '../../lib/prisma';
import { validateDateRange } from '../../utils/dateUtils';
import { FUEL_ANOMALY_THRESHOLDS } from '../../config/fuel';
import { Prisma } from '../../generated/prisma';

// GET /summary-metrics?busId=<>&fromDate=<>&toDate=<>
export async function getSummaryMetrics(req: Request, res: Response) {
  const { busId, fromDate, toDate, generate } = req.query;

  if (!busId || typeof busId !== 'string') {
    return res.status(400).json({ message: 'Missing or invalid busId' });
  }
       
  // Handle date range - allow all data if no dates provided
  let from: Date | undefined = undefined;
  let to: Date | undefined = undefined;
  let hasDateRange = false;
  
  if (fromDate && toDate) {
    const dateValidation = validateDateRange(fromDate, toDate);
    if (!dateValidation.isValid) {
      return res.status(400).json({ message: dateValidation.error });
    }
    from = dateValidation.from;
    to = dateValidation.to;
    hasDateRange = true;
  }

  try {
    // Always generate new summary metrics (ignore cached ones)
    console.log(`[SummaryMatrix] Generating fresh summary metrics for vehicle ${busId}...`);
    
    try {
      const generatedSummary = await generateSummaryMetrics(busId, from, to, hasDateRange);
      if (generatedSummary) {
        // Try to save the generated summary to database for future reference (but we don't use it)
        try {
          await prisma.summaryMetrics.create({
            data: {
              vehicleId: generatedSummary.vehicleId,
              fromDate: generatedSummary.fromDate,
              toDate: generatedSummary.toDate,
              sFuelLevel: generatedSummary.sFuelLevel,
              eFuelLevel: generatedSummary.eFuelLevel,
              totalFuelConsumed: generatedSummary.totalFuelConsumed,
              totalFuelFills: generatedSummary.totalFuelFills,
              totalFuelDrops: generatedSummary.totalFuelDrops,
              kmpl: generatedSummary.kmpl,
              totalDistanceKm: generatedSummary.totalDistanceKm,
              totalRunningHours: generatedSummary.totalRunningHours,
              totalIdleHours: generatedSummary.totalIdleHours,
              totalStoppageHours: generatedSummary.totalStoppageHours,
              dropAlert: generatedSummary.dropAlert,
              fillAlert: generatedSummary.fillAlert
            }
          });
          console.log(`[SummaryMatrix] Saved generated summary metrics to database for vehicle ${busId} (for reference)`);
        } catch (saveError) {
          console.warn(`[SummaryMatrix] Could not save generated summary metrics to database:`, saveError);
          // Continue with the generated summary even if save fails
        }
        
        const summaries = [generatedSummary];
        console.log(`[SummaryMatrix] Successfully generated fresh summary metrics for vehicle ${busId}`);
        
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

        res.json({
          data: result,
          count: result.length,
          dateRange: hasDateRange && from && to ? { from, to } : 'all available data',
          note: 'Fresh summary generated from current data'
        });
      } else {
        console.log(`[SummaryMatrix] Could not generate summary metrics for vehicle ${busId} - no data available`);
        return res.status(404).json({ 
          message: 'Unable to generate summary metrics from available data',
          suggestion: 'Ensure the vehicle has sensor readings and history data for the specified date range'
        });
      }
    } catch (genError) {
      console.error('[SummaryMatrix] Error generating summary metrics:', genError);
      return res.status(500).json({ 
        message: 'Failed to generate summary metrics',
        error: 'Summary generation failed'
      });
    }
  } catch (err) {
    console.error('[SummaryMatrix] Error fetching summary metrics:', err);
    res.status(500).json({ message: 'Failed to fetch summary metrics' });
  }
}

// Helper function to generate summary metrics from raw data
async function generateSummaryMetrics(vehicleId: string, fromDate: Date | undefined, toDate: Date | undefined, hasDateRange: boolean) {
  try {
    // Get the sensor for this vehicle
    const sensor = await prisma.sensor.findFirst({
      where: { vehicleId },
      select: { id: true }
    });

    if (!sensor) {
      console.log(`[SummaryMatrix] No sensor found for vehicle ${vehicleId}`);
      return null;
    }

    // Build where clause for readings
    const readingWhere: Prisma.SensorReadingWhereInput = {
      sensorId: sensor.id,
      fuelLevel: { not: null },
      odometerKm: { not: null }
    };
    
    // Only apply date filters if date range is provided
    if (hasDateRange && fromDate && toDate) {
      readingWhere.timestamp = { gte: fromDate, lte: toDate };
    }

    // Get sensor readings - NO LIMITS
    const readings = await prisma.sensorReading.findMany({
      where: readingWhere,
      orderBy: { timestamp: 'asc' },
      select: {
        timestamp: true,
        fuelLevel: true,
        odometerKm: true,
        speed: true,
        ignitionStatus: true
      }
      // No take/skip limits - fetch all data
    });

    if (readings.length < 2) {
      console.log(`[SummaryMatrix] Insufficient readings for vehicle ${vehicleId}${hasDateRange ? ' in date range' : ''}`);
      return null;
    }

    // Build where clause for history records
    const historyWhere: Prisma.HistoryWhereInput = {
      sensorId: sensor.id,
    };
    
    // Only apply date filters if date range is provided
    if (hasDateRange && fromDate && toDate) {
      historyWhere.timestamp = { gte: fromDate, lte: toDate };
    }

    // Get history records - NO LIMITS
    const histories = await prisma.history.findMany({
      where: historyWhere,
      select: {
        type: true,
        fuelDropLitres: true,
        timestamp: true
      }
      // No take/skip limits - fetch all data
    });

    console.log(`[SummaryMatrix] Processing ${readings.length} readings and ${histories.length} history records for summary metrics`);

    // Calculate summary metrics (FIXED LOGIC)
    const firstReading = readings[0];
    const lastReading = readings[readings.length - 1];
    
    const startFuelLevel = firstReading.fuelLevel || 0;
    const endFuelLevel = lastReading.fuelLevel || 0;
    
    // Calculate total fuel consumed (FIXED - handle refuels properly)
    let totalFuelConsumed = 0;
    let detectedRefuelsFromReadings = 0;
    let detectedTheftsFromReadings = 0;
    
    if (readings.length > 1) {
      // Sort readings by timestamp
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
        } else {
          const fuelChange = reading.fuelLevel - currentFuelLevel;
          
          if (fuelChange < 0) {
            // Fuel level decreased
            const absChange = Math.abs(fuelChange);
            
            // Determine if this is normal consumption or theft using configurable threshold
            if (absChange > FUEL_ANOMALY_THRESHOLDS.THEFT) {
              // Large drop - likely theft
              totalThefts += absChange;
            } else {
              // Small drop - normal consumption
              totalNormalConsumption += absChange;
            }
          } else if (fuelChange > FUEL_ANOMALY_THRESHOLDS.REFUEL) {
            // Fuel level increased significantly - refuel
            totalRefuels += fuelChange;
          }
          
          currentFuelLevel = reading.fuelLevel;
        }
      }
      
      totalFuelConsumed = totalNormalConsumption;
      detectedRefuelsFromReadings = totalRefuels;
      detectedTheftsFromReadings = totalThefts;
    }
    
    // Calculate distance traveled - FIXED
    const totalDistanceKm = Math.max(0, (lastReading.odometerKm || 0) - (firstReading.odometerKm || 0));
    
    // Calculate fuel efficiency (km/L) - FIXED
    const kmpl = totalFuelConsumed > 0 ? totalDistanceKm / totalFuelConsumed : 0;
    
    // Calculate fuel fills and drops from history - FIXED
    let totalFuelFills = 0;
    let totalFuelDrops = 0;
    let dropAlert = false;
    let fillAlert = false;

    // Count ML-detected events from History table
    histories.forEach(history => {
      if (history.type === 'REFUEL') {
        totalFuelFills += Math.abs(history.fuelDropLitres);
        fillAlert = true;
      } else if (history.type === 'THEFT') {
        totalFuelDrops += Math.abs(history.fuelDropLitres);
        dropAlert = true;
      }
    });

    // Add detected refuels to total
    totalFuelFills += detectedRefuelsFromReadings;
    if (detectedRefuelsFromReadings > 0) {
      fillAlert = true;
    }

    // Add detected thefts to total drops
    totalFuelDrops += detectedTheftsFromReadings;
    if (detectedTheftsFromReadings > 0) {
      dropAlert = true;
    }

    // Calculate running hours based on ignition status and speed (FIXED LOGIC with time safety)
    let totalRunningHours = 0;
    let totalIdleHours = 0;
    let totalStoppageHours = 0;

    // Ensure readings are sorted by timestamp
    const sortedReadings = [...readings].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    // Time calculation safety - use lastTimestamp approach
    let lastTimestamp: Date | null = null;
    for (const reading of sortedReadings) {
      if (lastTimestamp && reading.timestamp > lastTimestamp) {
        const timeDiff = (reading.timestamp.getTime() - lastTimestamp.getTime()) / (1000 * 60 * 60); // hours
        
        // Improved logic for determining vehicle state
        if (reading.speed && reading.speed > 5) {
          // Vehicle is moving
          totalRunningHours += timeDiff;
        } else if (reading.ignitionStatus === 'ON' && reading.speed && reading.speed <= 5) {
          // Vehicle is idling (ignition on but not moving)
          totalIdleHours += timeDiff;
        } else {
          // Vehicle is stopped (ignition off or no speed data)
          totalStoppageHours += timeDiff;
        }
      }
      lastTimestamp = reading.timestamp;
    }

    console.log(`[SummaryMatrix] Summary metrics calculations for vehicle ${vehicleId}:
      - Start fuel: ${startFuelLevel.toFixed(2)}L
      - End fuel: ${endFuelLevel.toFixed(2)}L
      - Normal fuel consumption: ${totalFuelConsumed.toFixed(2)}L
      - Distance: ${totalDistanceKm.toFixed(2)}km
      - Efficiency: ${kmpl.toFixed(2)} km/L
      - Fuel fills (ML events): ${(totalFuelFills - detectedRefuelsFromReadings).toFixed(2)}L
      - Fuel fills (detected): ${detectedRefuelsFromReadings.toFixed(2)}L
      - Total fuel fills: ${totalFuelFills.toFixed(2)}L
      - Fuel drops (ML events): ${(totalFuelDrops - detectedTheftsFromReadings).toFixed(2)}L
      - Fuel drops (detected): ${detectedTheftsFromReadings.toFixed(2)}L
      - Total fuel drops: ${totalFuelDrops.toFixed(2)}L
      - Running hours: ${totalRunningHours.toFixed(2)}h
      - Idle hours: ${totalIdleHours.toFixed(2)}h
      - Stoppage hours: ${totalStoppageHours.toFixed(2)}h`);

    // Create summary metrics object
    const summaryMetrics = {
      id: `generated-${Date.now()}`,
      vehicleId,
      fromDate: hasDateRange && fromDate ? fromDate : firstReading.timestamp,
      toDate: hasDateRange && toDate ? toDate : lastReading.timestamp,
      sFuelLevel: startFuelLevel,
      eFuelLevel: endFuelLevel,
      totalFuelConsumed: parseFloat(totalFuelConsumed.toFixed(2)),
      totalFuelFills: parseFloat(totalFuelFills.toFixed(2)),
      totalFuelDrops: parseFloat(totalFuelDrops.toFixed(2)),
      kmpl: parseFloat(kmpl.toFixed(2)),
      totalDistanceKm: parseFloat(totalDistanceKm.toFixed(2)),
      totalRunningHours: parseFloat(totalRunningHours.toFixed(2)),
      totalIdleHours: parseFloat(totalIdleHours.toFixed(2)),
      totalStoppageHours: parseFloat(totalStoppageHours.toFixed(2)),
      dropAlert,
      fillAlert
    };

    return summaryMetrics;
  } catch (error) {
    console.error('[SummaryMatrix] Error in generateSummaryMetrics:', error);
    return null;
  }
}
