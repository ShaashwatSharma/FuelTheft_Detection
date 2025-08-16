import prisma from '../lib/prisma';

const OFFLINE_MINUTES = Number(process.env.OFFLINE_MINUTES ?? 15);

export async function runOfflineMonitor(): Promise<void> {
  const cutoff = new Date(Date.now() - OFFLINE_MINUTES * 60_000);

  // Find sensors and their latest reading
  const sensors = await prisma.sensor.findMany({ include: { vehicle: true } });

  for (const s of sensors) {
    const latest = await prisma.sensorReading.findFirst({
      where: { sensorId: s.id },
      orderBy: { timestamp: 'desc' },
      select: { timestamp: true, locationLat: true, locationLong: true },
    });

    const isOffline = !latest || latest.timestamp < cutoff;

    if (isOffline) {
      const ts = latest?.timestamp ?? new Date(Date.now() - OFFLINE_MINUTES * 60_000);
      const exists = await prisma.alert.findFirst({
        where: {
          sensorId: s.id,
          vehicleId: s.vehicleId,
          type: 'SENSOR_HEALTH',
          timestamp: { gte: cutoff },
        },
        select: { id: true },
      });
      if (!exists) {
        await prisma.alert.create({
          data: {
            type: 'SENSOR_HEALTH',
            timestamp: ts,
            description: `Sensor offline (no data ≥ ${OFFLINE_MINUTES} min)`,
            locationLat: latest?.locationLat ?? null,
            locationLong: latest?.locationLong ?? null,
            sensorId: s.id,
            vehicleId: s.vehicleId,
          },
        });
      }
    }
  }
}
