import { Request, Response } from 'express';
import prisma from '../../lib/prisma';
import { AlertType } from '../../generated/prisma';

interface FuelUsageResponse {
  totalFuelConsumed: number;   // L (normal consumption + theft)
  totalFuelStolen: number;     // L (from THEFT events)
  totalFuelRefueled: number;   // L (from REFUEL events)
  distanceTravelled: number;   // km
  fuelEfficiency: number | null; // km/L
  message?: string;
  dataPoints: number;          // Number of history entries processed
  dateRange?: { from: Date; to: Date };
}

// Constants for data validation
const MAX_REALISTIC_FUEL_LEVEL = 200; // Maximum realistic fuel level in liters (BLE fuel sensor)
const MAX_REALISTIC_ODOMETER = 999999; // Maximum realistic odometer reading
const MIN_FUEL_CONSUMPTION = 0.1; // Minimum fuel consumption to consider valid

export async function getFuelUsage(req: Request, res: Response) {
  const { busId, fromDate, toDate } = req.query;
  
  if (!busId || typeof busId !== 'string') {
    return res.status(400).json({ message: 'Missing or invalid busId' });
  }

  // Validate and parse date range
  let from: Date | undefined;
  let to: Date | undefined;
  let hasDateRange = false;
  
  if (fromDate && toDate) {
    try {
      from = new Date(String(fromDate));
      to = new Date(String(toDate));
      if (isNaN(from.getTime()) || isNaN(to.getTime())) {
        return res.status(400).json({ message: 'Invalid date format' });
      }
      if (from > to) [from, to] = [to, from]; // Swap if needed
      hasDateRange = true;
    } catch (error) {
      return res.status(400).json({ message: 'Invalid date format' });
    }
  }

  try {
    // Find the sensor for the bus
    const sensor = await prisma.sensor.findFirst({
      where: { vehicleId: busId },
      select: { id: true, vehicle: { select: { tankSize: true } } },
    });
    
    if (!sensor) {
      return res.status(404).json({ message: 'Sensor not found for this bus' });
    }

    console.log(`[FuelUsage] Fetching fuel history for sensor ${sensor.id}`);

    // Get all history entries for this sensor
    const history = await prisma.history.findMany({
      where: {
        sensorId: sensor.id,
        ...(hasDateRange && from && to ? {
          timestamp: { gte: from, lte: to }
        } : {}),
        type: { in: ['NORMAL', 'THEFT', 'REFUEL'] as AlertType[] }
      },
      orderBy: { timestamp: 'asc' },
      select: {
        type: true,
        fuelLevel: true,
        fuelDropLitres: true,
        timestamp: true
      }
    });

    if (history.length === 0) {
      return res.status(404).json({
        message: 'No history data available for this time period'
      });
    }

    console.log(`[FuelUsage] Processing ${history.length} history entries`);

    // Calculate metrics from history
    let totalFuelStolen = 0;
    let totalFuelRefueled = 0;
    let totalNormalConsumption = 0;
    let previousNormalFuelLevel: number | null = null;

    // First pass: Calculate stolen/refueled amounts
    for (const entry of history) {
      switch (entry.type) {
        case 'THEFT':
          totalFuelStolen += Math.abs(entry.fuelDropLitres);
          break;
        case 'REFUEL':
          totalFuelRefueled += Math.abs(entry.fuelDropLitres);
          break;
        case 'NORMAL':
          if (previousNormalFuelLevel !== null) {
            const consumption = previousNormalFuelLevel - entry.fuelLevel;
            if (consumption > 0) {
              totalNormalConsumption += consumption;
            }
          }
          previousNormalFuelLevel = entry.fuelLevel;
          break;
      }
    }

    // Calculate distance travelled from sensor readings with improved logic
    const readings = await prisma.sensorReading.findMany({
      where: {
        sensorId: sensor.id,
        ...(hasDateRange && from && to ? {
          timestamp: { gte: from, lte: to }
        } : {}),
        odometerKm: { not: null }
      },
      orderBy: { timestamp: 'asc' },
      select: { odometerKm: true, timestamp: true }
    });

    let distanceTravelled = 0;
    let distanceCalculationMethod = 'odometer';

    if (readings.length >= 2) {
      // Filter out invalid odometer readings
      const validReadings = readings.filter(r => 
        r.odometerKm !== null && 
        r.odometerKm >= 0 && 
        r.odometerKm <= MAX_REALISTIC_ODOMETER
      );

      if (validReadings.length >= 2) {
        const firstOdo = validReadings[0].odometerKm;
        const lastOdo = validReadings[validReadings.length - 1].odometerKm;
        
        if (firstOdo && lastOdo) {
          // Check for odometer reset (if last reading is much smaller than first)
          if (lastOdo < firstOdo && (firstOdo - lastOdo) > 1000) {
            // Odometer reset detected - calculate distance from reset point
            console.log(`[FuelUsage] ⚠️ Odometer reset detected: ${firstOdo} -> ${lastOdo}`);
            
            // Find the first reading after the reset (where odometer becomes smaller)
            const resetIndex = validReadings.findIndex(r => r.odometerKm! < firstOdo);
            console.log(`[FuelUsage] 🔍 Reset index found at: ${resetIndex}`);
            
            if (resetIndex > 0) {
              const afterResetReadings = validReadings.slice(resetIndex);
              console.log(`[FuelUsage] 📊 After reset readings count: ${afterResetReadings.length}`);
              
              if (afterResetReadings.length >= 2) {
                const newFirstOdo = afterResetReadings[0].odometerKm;
                const newLastOdo = afterResetReadings[afterResetReadings.length - 1].odometerKm;
                console.log(`[FuelUsage] 📊 New first odometer: ${newFirstOdo}, New last odometer: ${newLastOdo}`);
                
                if (newFirstOdo !== null && newLastOdo !== null && newLastOdo >= newFirstOdo) {
                  // Calculate distance from the reset point (0 or first reading after reset)
                  // If first reading after reset is 0, use 0 as starting point
                  // If first reading after reset is > 0, use that as starting point
                  const resetStartingPoint = newFirstOdo === 0 ? 0 : newFirstOdo;
                  distanceTravelled = newLastOdo - resetStartingPoint;
                  console.log(`[FuelUsage] 📏 Distance after reset: ${resetStartingPoint} -> ${newLastOdo} = ${distanceTravelled}km`);
                  distanceCalculationMethod = 'odometer_reset';
                } else {
                  console.log(`[FuelUsage] ❌ Invalid odometer values after reset: first=${newFirstOdo}, last=${newLastOdo}`);
                  console.log(`[FuelUsage] ❌ Condition check: firstOdo!==null=${newFirstOdo !== null}, lastOdo!==null=${newLastOdo !== null}, lastOdo>=firstOdo=${newLastOdo !== null && newFirstOdo !== null ? newLastOdo >= newFirstOdo : 'N/A'}`);
                }
              } else {
                console.log(`[FuelUsage] ❌ Not enough readings after reset: ${afterResetReadings.length}`);
              }
            } else {
              console.log(`[FuelUsage] ❌ Reset index not found or invalid: ${resetIndex}`);
            }
          } else if (lastOdo >= firstOdo) {
            // Normal case - no reset
            distanceTravelled = lastOdo - firstOdo;
            console.log(`[FuelUsage] 📏 Distance: ${firstOdo} -> ${lastOdo} = ${distanceTravelled}km`);
          }
        }
      }
    }

    // If odometer calculation failed, try to estimate from fuel consumption
    if (distanceTravelled <= 0 && distanceCalculationMethod !== 'odometer_reset') {
      console.log(`[FuelUsage] ⚠️ Odometer calculation failed, attempting fuel-based estimation`);
      distanceCalculationMethod = 'fuel_estimation';
      
      // Get fuel readings to estimate distance
      const fuelReadings = await prisma.sensorReading.findMany({
        where: {
          sensorId: sensor.id,
          ...(hasDateRange && from && to ? {
            timestamp: { gte: from, lte: to }
          } : {}),
          fuelLevel: { 
            not: null,
            gte: 0,
            lte: MAX_REALISTIC_FUEL_LEVEL
          }
        },
        orderBy: { timestamp: 'asc' },
        select: { fuelLevel: true, timestamp: true }
      });

      if (fuelReadings.length >= 2) {
        const firstFuel = fuelReadings[0].fuelLevel;
        const lastFuel = fuelReadings[fuelReadings.length - 1].fuelLevel;
        
        if (firstFuel && lastFuel && firstFuel > lastFuel) {
          const fuelConsumed = firstFuel - lastFuel;
          // Estimate distance based on typical fuel efficiency (assuming 3.5 km/L)
          const estimatedEfficiency = 3.5; // km/L
          distanceTravelled = fuelConsumed * estimatedEfficiency;
          console.log(`[FuelUsage] 📏 Estimated distance from fuel: ${fuelConsumed}L * ${estimatedEfficiency}km/L = ${distanceTravelled}km`);
        }
      }
    }

    // Calculate total fuel consumed (normal + thefts)
    const totalFuelConsumed = totalNormalConsumption + totalFuelStolen;

    // If no fuel consumption detected but we have distance, estimate fuel consumption
    let estimatedFuelConsumption = 0;
    if (totalFuelConsumed === 0 && distanceTravelled > 0) {
      // Estimate fuel consumption based on typical efficiency (3.5 km/L)
      const estimatedEfficiency = 3.5; // km/L
      estimatedFuelConsumption = distanceTravelled / estimatedEfficiency;
      console.log(`[FuelUsage] ⛽ Estimated fuel consumption: ${distanceTravelled}km / ${estimatedEfficiency}km/L = ${estimatedFuelConsumption.toFixed(2)}L`);
    }

    // Calculate fuel efficiency
    const totalFuelForEfficiency = totalFuelConsumed > 0 ? totalFuelConsumed : estimatedFuelConsumption;
    const fuelEfficiency = totalFuelForEfficiency > MIN_FUEL_CONSUMPTION && distanceTravelled > 0
        ? distanceTravelled / totalFuelForEfficiency 
        : null;

    console.log(`[FuelUsage] Calculation complete:
      - Normal consumption: ${totalNormalConsumption.toFixed(2)}L
      - Fuel stolen: ${totalFuelStolen.toFixed(2)}L
      - Fuel refueled: ${totalFuelRefueled.toFixed(2)}L
      - Distance: ${distanceTravelled.toFixed(2)}km (${distanceCalculationMethod})
      - Efficiency: ${fuelEfficiency?.toFixed(2) || 'N/A'} km/L`);

    const response: FuelUsageResponse = {
      totalFuelConsumed: +totalFuelConsumed.toFixed(2),
      totalFuelStolen: +totalFuelStolen.toFixed(2),
      totalFuelRefueled: +totalFuelRefueled.toFixed(2),
      distanceTravelled: +distanceTravelled.toFixed(2),
      fuelEfficiency: fuelEfficiency ? +fuelEfficiency.toFixed(2) : null,
      dataPoints: history.length,
      dateRange: hasDateRange && from && to ? { from, to } : undefined,
      message: distanceCalculationMethod === 'fuel_estimation' 
        ? 'Distance estimated from fuel consumption due to odometer reset'
        : history.length < 2
          ? 'Limited data - results may not be accurate'
          : undefined
    };

    res.json(response);
  } catch (err) {
    console.error('[FuelUsage] Error:', err);
    res.status(500).json({ message: 'Failed to calculate fuel usage' });
  }
}
