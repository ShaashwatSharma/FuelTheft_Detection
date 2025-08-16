import { Request, Response } from 'express';
import prisma from '../../lib/prisma';
import { validateDateRange } from '../../utils/dateUtils';

// GET /summary-metrics?busId=<>&fromDate=<>&toDate=<>
export async function getSummaryMetrics(req: Request, res: Response) {
  const { busId, fromDate, toDate, generate } = req.query;

  if (!busId || typeof busId !== 'string') {
    return res.status(400).json({ message: 'Missing or invalid busId' });
  }
       
  const dateValidation = validateDateRange(fromDate, toDate);
  if (!dateValidation.isValid) {
    return res.status(400).json({ message: dateValidation.error });
  }
  const { from, to } = dateValidation;
  
  // Ensure from and to are defined
  if (!from || !to) {
    return res.status(400).json({ message: 'Invalid date range' });
  }

  try {
    // First, try to find existing summary metrics
    let summaries = await prisma.summaryMetrics.findMany({
      where: {
        vehicleId: busId,
        fromDate: { lte: to },    // Record starts before query ends
        toDate: { gte: from },    // Record ends after query starts
      },
      orderBy: { fromDate: 'desc' },
    });

    // If no summaries found, generate one on-the-fly (if generate=true or not specified)
    const shouldGenerate = generate === undefined || generate === 'true';
    if (!summaries.length && shouldGenerate) {
      console.log(`No summary metrics found for vehicle ${busId}, generating on-the-fly...`);
      
      try {
        const generatedSummary = await generateSummaryMetrics(busId, from, to);
        if (generatedSummary) {
          // Try to save the generated summary to database for future use
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
            console.log(`Saved generated summary metrics to database for vehicle ${busId}`);
          } catch (saveError) {
            console.warn(`Could not save generated summary metrics to database:`, saveError);
            // Continue with the generated summary even if save fails
          }
          
          summaries = [generatedSummary];
          console.log(`Successfully generated summary metrics for vehicle ${busId}`);
        } else {
          console.log(`Could not generate summary metrics for vehicle ${busId} - no data available`);
          return res.status(404).json({ 
            message: 'No summary metrics found and unable to generate from available data',
            suggestion: 'Ensure the vehicle has sensor readings and history data for the specified date range'
          });
        }
      } catch (genError) {
        console.error('Error generating summary metrics:', genError);
        return res.status(500).json({ 
          message: 'Failed to generate summary metrics',
          error: 'Summary generation failed'
        });
      }
    } else if (!summaries.length) {
      // No summaries and generation is disabled
      return res.status(404).json({ 
        message: 'No summary metrics found for this bus',
        suggestion: 'Set generate=true query parameter to auto-generate summary metrics from available data'
      });
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

// Helper function to generate summary metrics from raw data
async function generateSummaryMetrics(vehicleId: string, fromDate: Date, toDate: Date) {
  try {
    // Get the sensor for this vehicle
    const sensor = await prisma.sensor.findFirst({
      where: { vehicleId },
      select: { id: true }
    });

    if (!sensor) {
      console.log(`No sensor found for vehicle ${vehicleId}`);
      return null;
    }

    // Get sensor readings within the date range
    const readings = await prisma.sensorReading.findMany({
      where: {
        sensorId: sensor.id,
        timestamp: { gte: fromDate, lte: toDate },
        fuelLevel: { not: null },
        odometerKm: { not: null }
      },
      orderBy: { timestamp: 'asc' },
      select: {
        timestamp: true,
        fuelLevel: true,
        odometerKm: true,
        speed: true,
        ignitionStatus: true
      }
    });

    if (readings.length < 2) {
      console.log(`Insufficient readings for vehicle ${vehicleId} in date range`);
      return null;
    }

    // Get history records for fuel events
    const histories = await prisma.history.findMany({
      where: {
        sensorId: sensor.id,
        timestamp: { gte: fromDate, lte: toDate }
      },
      select: {
        type: true,
        fuelDropLitres: true,
        timestamp: true
      }
    });

    // Calculate summary metrics
    const firstReading = readings[0];
    const lastReading = readings[readings.length - 1];
    
    const startFuelLevel = firstReading.fuelLevel || 0;
    const endFuelLevel = lastReading.fuelLevel || 0;
    
    // Calculate total fuel consumed (start - end)
    const totalFuelConsumed = Math.max(0, startFuelLevel - endFuelLevel);
    
    // Calculate distance traveled
    const totalDistanceKm = Math.max(0, (lastReading.odometerKm || 0) - (firstReading.odometerKm || 0));
    
    // Calculate fuel efficiency (km/L)
    const kmpl = totalFuelConsumed > 0 ? totalDistanceKm / totalFuelConsumed : 0;
    
    // Calculate fuel fills and drops from history
    let totalFuelFills = 0;
    let totalFuelDrops = 0;
    let dropAlert = false;
    let fillAlert = false;

    histories.forEach(history => {
      if (history.type === 'REFUEL' && history.fuelDropLitres) {
        totalFuelFills += Math.abs(history.fuelDropLitres);
        fillAlert = true;
      } else if (history.type === 'THEFT' && history.fuelDropLitres) {
        totalFuelDrops += Math.abs(history.fuelDropLitres);
        dropAlert = true;
      }
    });

    // Calculate running hours based on ignition status and speed
    let totalRunningHours = 0;
    let totalIdleHours = 0;
    let totalStoppageHours = 0;

    for (let i = 1; i < readings.length; i++) {
      const prev = readings[i - 1];
      const curr = readings[i];
      const timeDiff = (curr.timestamp.getTime() - prev.timestamp.getTime()) / (1000 * 60 * 60); // hours
      
      if (curr.speed && curr.speed > 5) {
        totalRunningHours += timeDiff;
      } else if (curr.ignitionStatus === 'ON' && curr.speed && curr.speed <= 5) {
        totalIdleHours += timeDiff;
      } else {
        totalStoppageHours += timeDiff;
      }
    }

    // Create summary metrics object
    const summaryMetrics = {
      id: `generated-${Date.now()}`,
      vehicleId,
      fromDate,
      toDate,
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
    console.error('Error in generateSummaryMetrics:', error);
    return null;
  }
}
