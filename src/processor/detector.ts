// src/processor/detector.ts
import prisma from '../lib/prisma';
import axios from 'axios';
import {
  Prisma,
  type AlertType,   // enum: THEFT | REFUEL | LOW_FUEL | SENSOR_HEALTH | NORMAL | UNKNOWN
  type EventType,   // enum: THEFT | REFUEL | DROP
} from '../generated/prisma';

const MODEL_URL = process.env.MODEL_URL || 'http://model-service:5000/predict';
const MODEL_TIMEOUT_MS = Number(process.env.MODEL_TIMEOUT_MS ?? 10_000);

// -- helpers ------------------------------------------------------------------

function normalizePrediction(raw: unknown): AlertType {
  const s = String(raw ?? '').trim().toUpperCase().replace(/\s+/g, '_');
  if (s === 'THEFT') return 'THEFT';
  if (s === 'REFUEL') return 'REFUEL';
  if (s === 'LOW_FUEL') return 'LOW_FUEL';
  if (s === 'NORMAL') return 'NORMAL';
  return 'UNKNOWN';
}

function haversineKm(
  lat1?: number | null,
  lon1?: number | null,
  lat2?: number | null,
  lon2?: number | null
): number {
  if (
    lat1 == null || lon1 == null ||
    lat2 == null || lon2 == null
  ) return 0;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Idempotent write: exactly one History per *eventful* SensorReading.
 * We use History.id = SensorReading.id so re-running is safe.
 */
async function writeHistoryByReadingId(
  tx: Prisma.TransactionClient,
  readingId: string,
  data: {
    timestamp: Date;
    type: EventType;
    description: string;
    fuelLevel: number;
    fuelDropLitres: number | null;
    vehicleId: string;
    sensorId: string;
    locationLat?: number | null;
    locationLong?: number | null;
  }
) {
  await tx.history.upsert({
    where: { id: readingId },
    update: {
      type: data.type,
      description: data.description,
      fuelLevel: data.fuelLevel,
      fuelDropLitres: data.fuelDropLitres,
      timestamp: data.timestamp,
      vehicleId: data.vehicleId,
      sensorId: data.sensorId,
      locationLat: data.locationLat ?? null,
      locationLong: data.locationLong ?? null,
    },
    create: {
      id: readingId,
      ...data,
    },
  });
}

// -- main ---------------------------------------------------------------------

export async function runDetection() {
  console.log('🔍 Running event detection (topic-aware, idempotent)…');

  const sensors = await prisma.sensor.findMany({
    include: { vehicle: true },
    orderBy: { sensorCode: 'asc' },
  });

  for (const sensor of sensors) {
    try {
      // Pull readings oldest-first for this sensor.
      const readings = await prisma.sensorReading.findMany({
        where: { sensorId: sensor.id },
        orderBy: { timestamp: 'asc' },
      });
      if (readings.length === 0) continue;

      // Skip readings we've already created a History for (we only create History on events).
      const existingHist = await prisma.history.findMany({
        where: { id: { in: readings.map(r => r.id) } },
        select: { id: true },
      });
      const alreadyHandled = new Set(existingHist.map(h => h.id));
      const pending = readings.filter(r => !alreadyHandled.has(r.id));

      if (pending.length === 0) continue;
      console.log(`▶️  ${sensor.sensorCode}: ${pending.length} pending readings`);

      for (const curr of pending) {
        const topic = curr.topic ?? null;
        const topicLabel = topic ?? '(no-topic)';

        // Previous reading strictly before this timestamp (best-effort).
        const prev = await prisma.sensorReading.findFirst({
          where: {
            sensorId: sensor.id,
            timestamp: { lt: curr.timestamp },
            fuelLevel: { not: null },
            // topic: topic, // if you want "same topic" only, uncomment
          },
          orderBy: { timestamp: 'desc' },
        });

        // Decide fuel values — we need a number if we’re going to create an event/history.
        const prevFuel = prev?.fuelLevel ?? null;
        const fuelNow = curr.fuelLevel ?? prevFuel;

        // If both are null, we can’t reason about fuel; move on.
        if (fuelNow == null) continue;

        // Compute distance feature (prefer odometerKm diff, else haversine)
        const distanceKm =
          prev?.odometerKm != null && curr.odometerKm != null
            ? Math.max(0, curr.odometerKm - prev.odometerKm)
            : haversineKm(prev?.locationLat ?? null, prev?.locationLong ?? null, curr.locationLat ?? null, curr.locationLong ?? null);

        // Build model input
        const input = {
          fuelLevel: fuelNow,
          previous_fuel_level: prevFuel ?? fuelNow,
          distanceKm,
          locationLat: curr.locationLat ?? 0,
          locationLong: curr.locationLong ?? 0,
          speed: curr.speed ?? 0,
          ignitionStatus: curr.ignitionStatus ?? 'UNKNOWN',
          isOverSpeed: curr.isOverSpeed ?? false,
          odometer: curr.odometerKm ?? 0,
          deviceVoltage: curr.deviceVoltage ?? 0,
          topic: topic ?? '',
          timestamp: curr.timestamp.toISOString(),
        };

        // Get model prediction (AlertType)
        let prediction: AlertType = 'UNKNOWN';
        try {
          const { data } = await axios.post(MODEL_URL, input, { timeout: MODEL_TIMEOUT_MS });
          prediction = normalizePrediction(data?.prediction);
        } catch (err: any) {
          console.warn(`❌ ${sensor.sensorCode} [${topicLabel}] model error @ ${curr.timestamp.toISOString()}: ${err?.message}`);
          prediction = 'UNKNOWN';
        }

        // Delta (positive = refuel, negative = drop/consumption)
        const deltaLitres = prevFuel != null ? (fuelNow - prevFuel) : 0;
        const deltaStr = (deltaLitres >= 0 ? '+' : '') + deltaLitres.toFixed(2) + 'L';

        // Map AlertType -> EventType (only for real fuel events)
        let eventType: EventType | null = null;
        if (prediction === 'THEFT') eventType = 'THEFT';
        else if (prediction === 'REFUEL') eventType = 'REFUEL';
        // (No NORMAL/LOW_FUEL/UNKNOWN history entries; LOW_FUEL still creates an alert below)

        // Write History only for eventful readings
        if (eventType) {
          const desc = `[${topicLabel}] ${eventType} | Δ=${deltaStr} | speed=${(curr.speed ?? 0).toFixed(1)} km/h`;
          await prisma.$transaction(async (tx) => {
            await writeHistoryByReadingId(tx, curr.id, {
              timestamp: curr.timestamp,
              type: eventType,
              description: desc,
              fuelLevel: fuelNow,
              fuelDropLitres: eventType === 'THEFT' ? Math.abs(deltaLitres) : null,
              vehicleId: sensor.vehicleId,
              sensorId: sensor.id,
              locationLat: curr.locationLat ?? null,
              locationLong: curr.locationLong ?? null,
            });

            // Create a user-facing alert for THEFT/REFUEL
            const alertType: AlertType = eventType === 'REFUEL' ? 'REFUEL' : 'THEFT';
            const exists = await tx.alert.findFirst({
              where: {
                sensorId: sensor.id,
                vehicleId: sensor.vehicleId,
                timestamp: curr.timestamp,
                type: alertType,
              },
              select: { id: true },
            });
            if (!exists) {
              await tx.alert.create({
                data: {
                  type: alertType,
                  timestamp: curr.timestamp,
                  description: `[${topicLabel}] ${alertType} | ${deltaStr}`,
                  locationLat: curr.locationLat ?? null,
                  locationLong: curr.locationLong ?? null,
                  sensorId: sensor.id,
                  vehicleId: sensor.vehicleId, // REQUIRED by schema
                },
              });
            }
          });
        }

        // LOW_FUEL alert (no history)
        if (prediction === 'LOW_FUEL') {
          const exists = await prisma.alert.findFirst({
            where: {
              sensorId: sensor.id,
              vehicleId: sensor.vehicleId,
              timestamp: curr.timestamp,
              type: 'LOW_FUEL',
            },
            select: { id: true },
          });
          if (!exists) {
            await prisma.alert.create({
              data: {
                type: 'LOW_FUEL',
                timestamp: curr.timestamp,
                description: `[${topicLabel}] LOW_FUEL at ${fuelNow.toFixed(1)}L`,
                locationLat: curr.locationLat ?? null,
                locationLong: curr.locationLong ?? null,
                sensorId: sensor.id,
                vehicleId: sensor.vehicleId, // REQUIRED
              },
            });
          }
        }

        // Note: we no longer mark SensorReading.processed (field was removed).
        // Idempotency is via History.id = reading.id for eventful reads + deduped alerts.
      }

      console.log(`✅ ${sensor.sensorCode}: done`);
    } catch (err) {
      console.error(`🚨 Error processing sensor ${sensor.sensorCode}:`, err);
    }
  }

  console.log('🏁 Detection pass complete.');
}
