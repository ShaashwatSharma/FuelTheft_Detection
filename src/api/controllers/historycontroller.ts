import { Request, Response } from 'express';
import prisma from '../../lib/prisma';
import { Prisma, AlertType } from '../../generated/prisma';
import { MAX_LIMIT, DEFAULT_LIMIT, MIN_LIMIT, MAX_OFFSET, DEFAULT_OFFSET } from '../../config/pagination';

// Fetch history records with optional filters   
// GET /history?type&sensorId&fromDate&toDate&sort=desc&limit=all&offset=0
export async function getHistory(req: Request, res: Response) {
  const {
    type,
    sensorId,
    fromDate,
    toDate,
    sort = 'desc',
    limit,
    offset = '0',
  } = req.query;

  try {
    // Validate sort parameter
    if (sort && !['asc', 'desc'].includes(sort.toString().toLowerCase())) {
      return res.status(400).json({ message: 'Invalid sort parameter (must be "asc" or "desc")' });
    }

    const where: Prisma.HistoryWhereInput = {};

    // Filter by sensorId
    if (sensorId) {
      where.sensorId = sensorId.toString();
    }

    // Filter by type (supports comma-separated values)
    if (type) {
      const types = type
        .toString()
        .split(',')
        .map((t) => t.trim().toUpperCase()) as AlertType[];

      // Validate type values against AlertType enum
      const validTypes: AlertType[] = ['THEFT', 'REFUEL', 'NORMAL', 'LOW_FUEL', 'SENSOR_HEALTH', 'UNKNOWN'];
      const invalidTypes = types.filter(t => !validTypes.includes(t));
      if (invalidTypes.length > 0) {
        return res.status(400).json({ 
          message: `Invalid type values: ${invalidTypes.join(', ')}. Valid types: ${validTypes.join(', ')}` 
        });
      }

      if (types.length === 1) {
        where.type = types[0];
      } else if (types.length > 1) {
        where.type = { in: types };
      }
    }

    // Filter by date range
    if (fromDate || toDate) {
      where.timestamp = {
        ...(fromDate && { gte: new Date(fromDate.toString()) }),
        ...(toDate && { lte: new Date(toDate.toString()) }),
      };
    }

    // Handle pagination - allow 'all' to fetch unlimited data
    let skip = 0;
    let take: number | undefined = undefined; // undefined means no limit
    
    if (limit && limit.toString().toLowerCase() !== 'all') {
      const limitNum = parseInt(limit.toString(), 10);
      if (isNaN(limitNum) || limitNum < MIN_LIMIT) {
        return res.status(400).json({ message: `Invalid limit parameter (must be >= ${MIN_LIMIT} or "all")` });
      }
      take = Math.min(limitNum, MAX_LIMIT);
    }
    
    const offsetNum = parseInt(offset.toString(), 10);
    if (isNaN(offsetNum) || offsetNum < DEFAULT_OFFSET) {
      return res.status(400).json({ message: `Invalid offset parameter (must be >= ${DEFAULT_OFFSET})` });
    }
    skip = Math.min(offsetNum, MAX_OFFSET);

    const startTime = Date.now();
    console.log(`[History] Fetching history records${take ? ` with limit ${take}` : ' (all records)'} and offset ${skip}`);

    // Get total count first for proper pagination
    const totalRecords = await prisma.history.count({ where });
    console.log(`[History] Total records matching filters: ${totalRecords}`);

    // Fetch paginated histories with vehicle, driver, route info
    const histories = await prisma.history.findMany({
      where,
      orderBy: {
        timestamp: sort === 'asc' ? 'asc' : 'desc',
      },
      skip,
      take, // undefined = no limit
      include: {
        sensor: {
          include: {
            vehicle: {
              include: {
                driver: true,
                route: true,
              },
            },
          },
        },
      },
    });

    const queryTime = Date.now() - startTime;
    console.log(`[History] Retrieved ${histories.length} history records in ${queryTime}ms`);

    // Format response
    const formatted = histories.map((h) => ({
      id: h.id,
      type: h.type,
      timestamp: h.timestamp,
      description: h.description,
      fuelLevel: h.fuelLevel,
      fuelDropLitres: h.fuelDropLitres,
      location: {
        lat: h.locationLat,
        long: h.locationLong,
      },
      bus: h.sensor?.vehicle
        ? {
            id: h.sensor.vehicle.id,
            registrationNo: h.sensor.vehicle.registrationNo,
            driver: h.sensor.vehicle.driver?.name || null,
            route: h.sensor.vehicle.route?.name || null,
          }
        : null,
    }));

    // Return response with correct pagination info
    res.json({
      data: formatted,
      count: formatted.length,
      hasMore: take ? (skip + take) < totalRecords : false,
      pagination: {
        limit: take,
        offset: skip,
        total: totalRecords
      }
    });
  } catch (err) {
    console.error('[History] Error fetching history records:', err);
    res.status(500).json({ message: 'Failed to fetch history records' });
  }
}
