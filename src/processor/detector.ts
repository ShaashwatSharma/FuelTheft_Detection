import prisma from '../lib/prisma';
import { AlertType } from '../generated/prisma'; 

const FUEL_DROP_THRESHOLD = 10;
const FUEL_RISE_THRESHOLD = 10;

export async function runDetection() {
  console.log('🔍 Running event detection...');

  const sensors = await prisma.sensor.findMany({
    include: {
      readings: {
        orderBy: { timestamp: 'asc' },
      },
      vehicle: true,
    },
  });

  for (const sensor of sensors) {
    const readings = sensor.readings;

    for (let i = 1; i < readings.length; i++) {
      const prev = readings[i - 1];
      const curr = readings[i];
      const diff = curr.fuelLevel - prev.fuelLevel;

      let type: AlertType | null = null;
      let notes = '';

      if (diff <= -FUEL_DROP_THRESHOLD) {
        type = AlertType.THEFT;
        notes = `Sudden drop of ${Math.abs(diff)}L`;
      } else if (diff >= FUEL_RISE_THRESHOLD) {
        type = AlertType.REFUEL;
        notes = `Sudden rise of ${diff}L`;
      }

      if (type) {
        const exists = await prisma.event.findFirst({
          where: {
            vehicleId: sensor.vehicleId,
            startTime: prev.timestamp,
          },
        });

        if (!exists) {
        await prisma.event.create({
            data: {
                type,
                startTime: prev.timestamp,
                endTime: curr.timestamp,
                fuelDropLitres: Math.abs(diff),
                notes,
                vehicleId: sensor.vehicleId,
            },
          });

        await prisma.alert.create({
            data: {
                type,
                timestamp: curr.timestamp,
                description: notes,
                locationLat: curr.locationLat,
                locationLong: curr.locationLong,
                sensorId: sensor.id,
            },
        });


          console.log(`✅ ${type} event logged for ${sensor.sensorCode} (${notes})`);
        }
      }
    }
  }

  console.log('✅ Detection completed.');
}
