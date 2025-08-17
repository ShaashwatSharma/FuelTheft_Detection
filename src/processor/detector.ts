// src/processor/detector.ts
import prisma from '../lib/prisma';
import axios from 'axios';
import { Prisma, type AlertType, type EventType } from '../generated/prisma';

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
    type: AlertType;
    description: string;
    fuelLevel: number;
    fuelDropLitres: number;
    odoDistance: number;
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
      odoDistance: data.odoDistance,
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
  console.log('🔍 Running event detection (per-sensor, sequential, processed-flag)…');

  const sensors = await prisma.sensor.findMany({
    include: { vehicle: true },
    orderBy: { sensorCode: 'asc' },
  });

  for (const sensor of sensors) {
    try {
      // Determine last processed reading for context
      let lastProcessed = await prisma.sensorReading.findFirst({
        where: { sensorId: sensor.id, processed: true },
        orderBy: { timestamp: 'desc' },
      });

      // Fetch unprocessed readings oldest-first for this sensor
      const pending = await prisma.sensorReading.findMany({
        where: { sensorId: sensor.id, processed: false },
        orderBy: { timestamp: 'asc' },
      });

      if (pending.length === 0) continue;
      console.log(`▶️  ${sensor.sensorCode}: ${pending.length} unprocessed readings`);

      for (const curr of pending) {
        const topic = curr.topic ?? null;
        const topicLabel = topic ?? '(no-topic)';

        // CRITICAL FIX: Better previous reading logic for sensor isolation
        let prev = lastProcessed;
        if (!prev) {
          // If no processed reading, find the most recent unprocessed reading before current
          prev = await prisma.sensorReading.findFirst({
            where: {
              sensorId: sensor.id, // CRITICAL: Ensure same sensor
              timestamp: { lt: curr.timestamp },
              fuelLevel: { not: null },
            },
            orderBy: { timestamp: 'desc' },
          });
        }

        // CRITICAL FIX: Better fuel level logic
        const prevFuel = prev?.fuelLevel ?? null;
        const fuelNow = curr.fuelLevel ?? null;

        // Skip if we can't determine current fuel level
        if (fuelNow == null) {
          console.log(`⚠️  ${sensor.sensorCode}: Skipping reading with null fuel level`);
          continue;
        }

        // CRITICAL FIX: Better previous fuel level handling
        const effectivePrevFuel = prevFuel ?? fuelNow; // Use current as previous if no previous

        // Compute distance feature (prefer odometerKm diff, else haversine)
        const distanceKm =
          prev?.odometerKm != null && curr.odometerKm != null
            ? Math.max(0, curr.odometerKm - prev.odometerKm)
            : haversineKm(prev?.locationLat ?? null, prev?.locationLong ?? null, curr.locationLat ?? null, curr.locationLong ?? null);

        // CRITICAL FIX: Calculate fuel_diff properly
        const fuelDiff = effectivePrevFuel - fuelNow; // Positive = fuel consumed/dropped

        // Build model input with proper fuel_diff - ALIGNED WITH ML MODEL FEATURES
        const input = {
          fuelLevel: fuelNow || 0,
          previous_fuel_level: effectivePrevFuel || 0,
          distanceKm: distanceKm || 0,
          locationLat: curr.locationLat ?? 0,
          locationLong: curr.locationLong ?? 0,
          speed: curr.speed ?? 0,
          ignitionStatus: curr.ignitionStatus ?? 'OFF',
          isOverSpeed: curr.isOverSpeed ?? false,
          odometer: curr.odometerKm ?? 0, // Field name expected by ML model
          deviceVoltage: curr.deviceVoltage ?? 12.0,
          topic: topic ?? '',
          timestamp: curr.timestamp.toISOString(),
        };

        // Debug logging for fuel calculations and model input
        console.log(`🔍 ${sensor.sensorCode}: fuel_now=${fuelNow}, prev_fuel=${effectivePrevFuel}, fuel_diff=${fuelDiff.toFixed(2)}, distance=${distanceKm.toFixed(2)}km`);
        console.log(`📤 ${sensor.sensorCode}: Sending to ML model:`, JSON.stringify(input, null, 2));

        // Get model prediction (AlertType) - SEND DATA IN CORRECT FORMAT
        let prediction: AlertType = 'UNKNOWN';
        try {
          // Send data directly (not in records format) as expected by container app.py
          const { data } = await axios.post(MODEL_URL, input, { timeout: MODEL_TIMEOUT_MS });
          
          // Extract prediction from the response format
          if (data?.prediction) {
            prediction = normalizePrediction(data.prediction);
            console.log(`📥 ${sensor.sensorCode}: ML model response:`, JSON.stringify(data, null, 2));
          } else {
            prediction = 'UNKNOWN';
            console.log(`⚠️ ${sensor.sensorCode}: No predictions in ML response:`, JSON.stringify(data, null, 2));
          }
          
          console.log(`🤖 ${sensor.sensorCode}: Model prediction = ${prediction}`);
        } catch (err: any) {
          console.warn(`❌ ${sensor.sensorCode} [${topicLabel}] model error @ ${curr.timestamp.toISOString()}: ${err?.message}`);
          prediction = 'UNKNOWN';
        }

        // CRITICAL FIX: Better delta calculation
        const deltaLitres = prevFuel != null ? (fuelNow - prevFuel) : 0;
        const deltaStr = (deltaLitres >= 0 ? '+' : '') + deltaLitres.toFixed(2) + 'L';

        // Map AlertType -> EventType (only for REFUEL/THEFT)https://ca.slack-edge.com/T018F3SJ35E-U08T4P6K7HV-34ad189ae82f-512
        let eventType: EventType | null = null;
        if (prediction === 'THEFT') eventType = 'THEFT';
        else if (prediction === 'REFUEL') eventType = 'REFUEL';

        // Transaction per reading: history (always), alert (always), events (only THEFT/REFUEL), mark processed
        await prisma.$transaction(async (tx) => {
          // Always write History with model classification
          const desc = `[${topicLabel}] ${prediction} | Δ=${deltaStr} | speed=${(curr.speed ?? 0).toFixed(1)} km/h | fuel_diff=${fuelDiff.toFixed(2)}L`;
          await writeHistoryByReadingId(tx, curr.id, {
            timestamp: curr.timestamp,
            type: prediction as AlertType,
            description: desc,
            fuelLevel: fuelNow,
            fuelDropLitres: prediction === 'THEFT' ? Math.abs(deltaLitres) : 0,
            odoDistance: curr.odometerKm ?? 0,
            vehicleId: sensor.vehicleId,
            sensorId: sensor.id,
            locationLat: curr.locationLat ?? null,
            locationLong: curr.locationLong ?? null,
          });

          // One alert per reading with model type
          const alertExists = await tx.alert.findFirst({
            where: { sensorId: sensor.id, vehicleId: sensor.vehicleId, timestamp: curr.timestamp, type: prediction },
            select: { id: true },
          });
          if (!alertExists) {
            await tx.alert.create({
              data: {
                type: prediction,
                timestamp: curr.timestamp,
                description: desc,
                locationLat: curr.locationLat ?? null,
                locationLong: curr.locationLong ?? null,
                sensorId: sensor.id,
                vehicleId: sensor.vehicleId,
              },
            });
          }

          // Event only for THEFT/REFUEL
          if (eventType) {
            const evtExists = await tx.event.findFirst({
              where: { sensorId: sensor.id, vehicleId: sensor.vehicleId, timestamp: curr.timestamp, type: eventType },
              select: { id: true },
            });
            if (!evtExists) {
              await tx.event.create({
                data: {
                  type: eventType,
                  timestamp: curr.timestamp,
                  deltaLitres: eventType === 'REFUEL' ? Math.abs(deltaLitres) : -Math.abs(deltaLitres),
                  description: desc,
                  locationLat: curr.locationLat ?? null,
                  locationLong: curr.locationLong ?? null,
                  sensorId: sensor.id,
                  vehicleId: sensor.vehicleId,
                },
              });
            }
          }

          // Mark this reading as processed
          await tx.sensorReading.update({
            where: { id: curr.id },
            data: { processed: true },
          });
        });

        // Advance context for next iteration
        lastProcessed = curr;

        // Idempotency is via History.id = reading.id + processed flag
      }

      console.log(`✅ ${sensor.sensorCode}: processed ${pending.length}`);
    } catch (err) {
      console.error(`🚨 Error processing sensor ${sensor.sensorCode}:`, err);
    }
  }

  console.log('🏁 Detection pass complete.');
}
