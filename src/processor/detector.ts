//for ml model-> 

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
        const isFirstReading = !prev;
        
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

        // Process ALL readings including null fuel levels
        // if (fuelNow == null) {
        //   console.log(`⚠️  ${sensor.sensorCode}: Skipping reading with null fuel level`);
        //   continue;
        // }

        // CRITICAL FIX: Better previous fuel level handling
        const effectivePrevFuel = prevFuel ?? fuelNow ?? 0; // Use current as previous if no previous, default to 0

        // Compute distance feature (prefer odometerKm diff, else haversine)
        const distanceKm =
          prev?.odometerKm != null && curr.odometerKm != null
            ? Math.max(0, curr.odometerKm - prev.odometerKm)
            : haversineKm(prev?.locationLat ?? null, prev?.locationLong ?? null, curr.locationLat ?? null, curr.locationLong ?? null);

        // CRITICAL FIX: Calculate fuel_diff properly
        const fuelDiff = (fuelNow ?? 0) - effectivePrevFuel; // Negative = fuel consumed/dropped  

        // Build model input - ALIGNED WITH NEW ML MODEL API
        // The new ML model expects: {"rows": [{...}]} format with snake_case column names
        // Model features: ['fuel_level', 'previous_fuel_level', 'distance_km', 'location_lat', 'location_long', 'speed', 'ignition_status', 'is_over_speed', 'fuel_diff']
        const input = {
          rows: [{
            fuel_level: fuelNow || 0,
            previous_fuel_level: effectivePrevFuel || 0,
            distance_km: distanceKm || 0,
            location_lat: curr.locationLat ?? 0,
            location_long: curr.locationLong ?? 0,
            speed: curr.speed ?? 0,
            ignition_status: curr.ignitionStatus ?? 'OFF',
            is_over_speed: curr.isOverSpeed ?? false,
            fuel_diff: fuelDiff || 0,
            timestamp: curr.timestamp.toISOString(),
          }]
        };

        // Debug logging for fuel calculations and model input
        console.log(`🔍 ${sensor.sensorCode}: fuel_now=${fuelNow ?? 'null'}, prev_fuel=${effectivePrevFuel}, fuel_diff=${fuelDiff.toFixed(2)}, distance=${distanceKm.toFixed(2)}km`);
        console.log(`📤 ${sensor.sensorCode}: Sending to ML model:`, JSON.stringify(input, null, 2));

        // Get model prediction (AlertType) - SEND DATA IN CORRECT FORMAT
        let prediction: AlertType = 'UNKNOWN';
        try {
          // Send data directly (not in records format) as expected by container app.py
          const { data } = await axios.post(MODEL_URL, input, { timeout: MODEL_TIMEOUT_MS });
          
          // Extract prediction from NEW ML MODEL response format
          // New format: { count, pred_encoded: [0,1,2], pred_label: ["NORMAL", "THEFT", "REFUEL"] }
          if (Array.isArray(data?.pred_label) && data.pred_label.length > 0) {
            prediction = normalizePrediction(data.pred_label[0]);
            console.log(`📥 ${sensor.sensorCode}: ML model response (new):`, JSON.stringify(data, null, 2));
          } else if (data?.prediction) {
            // Fallback to old format if needed
            prediction = normalizePrediction(data.prediction);
            console.log(`📥 ${sensor.sensorCode}: ML model response (fallback):`, JSON.stringify(data, null, 2));
          } else {
            prediction = 'UNKNOWN';
            console.log(`⚠️ ${sensor.sensorCode}: No predictions in ML response:`, JSON.stringify(data, null, 2));
          }
          
          console.log(`🤖 ${sensor.sensorCode}: Model prediction = ${prediction}`);
          
          // POST-PROCESSING: Override model prediction for small fuel changes
          if (prediction === 'THEFT' && Math.abs(fuelDiff) < 3.0) {
            console.log(`⚠️ ${sensor.sensorCode}: Overriding THEFT prediction for small fuel drop (${fuelDiff.toFixed(2)}L) -> NORMAL`);
            prediction = 'NORMAL';
          }
        } catch (err: any) {
          console.warn(`❌ ${sensor.sensorCode} [${topicLabel}] model error @ ${curr.timestamp.toISOString()}: ${err?.message}`);
          prediction = 'UNKNOWN';
        }

        // CRITICAL FIX: Better delta calculation - FIXED TO MATCH fuel_diff
        const deltaLitres = prevFuel != null ? ((fuelNow ?? 0) - prevFuel) : 0; // Same as fuel_diff calculation
        const deltaStr = (deltaLitres >= 0 ? '+' : '') + deltaLitres.toFixed(2) + 'L';

        // Handle first reading - create NORMAL entry
        if (isFirstReading) {
          console.log(`🆕 ${sensor.sensorCode}: First reading detected, creating NORMAL entry`);
          prediction = 'NORMAL';
        }

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
            fuelLevel: fuelNow ?? 0,
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
                  deltaLitres: deltaLitres, // Use the corrected delta calculation
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

// Main execution block
if (require.main === module) {
  runDetection()
    .then(() => {
      console.log('✅ Detection completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Detection failed:', error);
      process.exit(1);
    });
}






































//For pure logic ->


// // src/processor/detector.ts
// import prisma from '../lib/prisma';
// import { Prisma, type AlertType, type EventType } from '../generated/prisma';

// // -- helpers ------------------------------------------------------------------

// function determineAlertType(fuelDiff: number): AlertType {
//   // Any increase in fuel is marked as REFUEL (with noise threshold of 0.5L)
//   if (fuelDiff < -0.5) {
//     return 'REFUEL';
//   }
//   // More than 1.5L drop is marked as THEFT
//   else if (fuelDiff > 1.5) {
//     return 'THEFT';
//   }
//   // Everything else is NORMAL
//   return 'NORMAL';
// }

// function haversineKm(
//   lat1?: number | null,
//   lon1?: number | null,
//   lat2?: number | null,
//   lon2?: number | null
// ): number {
//   if (
//     lat1 == null || lon1 == null ||
//     lat2 == null || lon2 == null
//   ) return 0;
//   const toRad = (d: number) => (d * Math.PI) / 180;
//   const R = 6371;
//   const dLat = toRad(lat2 - lat1);
//   const dLon = toRad(lon2 - lon1);
//   const a =
//     Math.sin(dLat / 2) ** 2 +
//     Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
//   return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
// }

// /**
//  * Idempotent write: exactly one History per *eventful* SensorReading.
//  * We use History.id = SensorReading.id so re-running is safe.
//  */
// async function writeHistoryByReadingId(
//   tx: Prisma.TransactionClient,
//   readingId: string,
//   data: {
//     timestamp: Date;
//     type: AlertType;
//     description: string;
//     fuelLevel: number;
//     fuelDropLitres: number;
//     odoDistance: number;
//     vehicleId: string;
//     sensorId: string;
//     locationLat?: number | null;
//     locationLong?: number | null;
//   }
// ) {
//   await tx.history.upsert({
//     where: { id: readingId },
//     update: {
//       type: data.type,
//       description: data.description,
//       fuelLevel: data.fuelLevel,
//       fuelDropLitres: data.fuelDropLitres,
//       odoDistance: data.odoDistance,
//       timestamp: data.timestamp,
//       vehicleId: data.vehicleId,
//       sensorId: data.sensorId,
//       locationLat: data.locationLat ?? null,
//       locationLong: data.locationLong ?? null,
//     },
//     create: {
//       id: readingId,
//       ...data,
//     },
//   });
// }

// // -- main ---------------------------------------------------------------------

// export async function runDetection() {
//   console.log('🔍 Running event detection (per-sensor, sequential, processed-flag)…');

//   const sensors = await prisma.sensor.findMany({
//     include: { vehicle: true },
//     orderBy: { sensorCode: 'asc' },
//   });

//   for (const sensor of sensors) {
//     try {
//       // Determine last processed reading for context
//       let lastProcessed = await prisma.sensorReading.findFirst({
//         where: { sensorId: sensor.id, processed: true },
//         orderBy: { timestamp: 'desc' },
//       });

//       // Fetch unprocessed readings oldest-first for this sensor
//       const pending = await prisma.sensorReading.findMany({
//         where: { sensorId: sensor.id, processed: false },
//         orderBy: { timestamp: 'asc' },
//       });

//       if (pending.length === 0) continue;
//       console.log(`▶️  ${sensor.sensorCode}: ${pending.length} unprocessed readings`);

//       for (const curr of pending) {
//         const topic = curr.topic ?? null;
//         const topicLabel = topic ?? '(no-topic)';

//         // Get previous reading (processed or most recent unprocessed before current)
//         let prev = lastProcessed;
//         if (!prev) {
//           prev = await prisma.sensorReading.findFirst({
//             where: {
//               sensorId: sensor.id,
//               timestamp: { lt: curr.timestamp },
//               fuelLevel: { not: null },
//             },
//             orderBy: { timestamp: 'desc' },
//           });
//         }

//         const prevFuel = prev?.fuelLevel ?? null;
//         const fuelNow = curr.fuelLevel ?? null;

//         // Skip if we can't determine current fuel level
//         if (fuelNow == null) {
//           console.log(`⚠️  ${sensor.sensorCode}: Skipping reading with null fuel level`);
//           continue;
//         }

//         // Use current as previous if no previous reading available
//         const effectivePrevFuel = prevFuel ?? fuelNow;

//         // Compute distance feature (prefer odometerKm diff, else haversine)
//         const distanceKm =
//           prev?.odometerKm != null && curr.odometerKm != null
//             ? Math.max(0, curr.odometerKm - prev.odometerKm)
//             : haversineKm(prev?.locationLat ?? null, prev?.locationLong ?? null, curr.locationLat ?? null, curr.locationLong ?? null);

//         // Calculate fuel difference (positive = fuel consumed/dropped)
//         const fuelDiff = effectivePrevFuel - fuelNow;

//         // Determine alert type based on our algorithm
//         const prediction = determineAlertType(fuelDiff);
//         console.log(`🔍 ${sensor.sensorCode}: fuel_now=${fuelNow}, prev_fuel=${effectivePrevFuel}, fuel_diff=${fuelDiff.toFixed(2)}, distance=${distanceKm.toFixed(2)}km`);
//         console.log(`🤖 ${sensor.sensorCode}: Algorithm prediction = ${prediction}`);

//         // Calculate delta for display (positive = increase, negative = decrease)
//         const deltaLitres = prevFuel != null ? (prevFuel - fuelNow) : 0;
//         const deltaStr = (deltaLitres >= 0 ? '+' : '') + deltaLitres.toFixed(2) + 'L';

//         // Map AlertType -> EventType (only for REFUEL/THEFT)
//         let eventType: EventType | null = null;
//         if (prediction === 'THEFT') eventType = 'THEFT';
//         else if (prediction === 'REFUEL') eventType = 'REFUEL';

//         // Transaction per reading: history (always), alert (always), events (only THEFT/REFUEL), mark processed
//         await prisma.$transaction(async (tx) => {
//           // Always write History with classification
//           const desc = `[${topicLabel}] ${prediction} | Δ=${deltaStr} | speed=${(curr.speed ?? 0).toFixed(1)} km/h | fuel_diff=${fuelDiff.toFixed(2)}L`;
//           await writeHistoryByReadingId(tx, curr.id, {
//             timestamp: curr.timestamp,
//             type: prediction,
//             description: desc,
//             fuelLevel: fuelNow,
//             fuelDropLitres: prediction === 'THEFT' ? Math.abs(deltaLitres) : 0,
//             odoDistance: curr.odometerKm ?? 0,
//             vehicleId: sensor.vehicleId,
//             sensorId: sensor.id,
//             locationLat: curr.locationLat ?? null,
//             locationLong: curr.locationLong ?? null,
//           });

//           // One alert per reading with type
//           const alertExists = await tx.alert.findFirst({
//             where: { sensorId: sensor.id, vehicleId: sensor.vehicleId, timestamp: curr.timestamp, type: prediction },
//             select: { id: true },
//           });
//           if (!alertExists) {
//             await tx.alert.create({
//               data: {
//                 type: prediction,
//                 timestamp: curr.timestamp,
//                 description: desc,
//                 locationLat: curr.locationLat ?? null,
//                 locationLong: curr.locationLong ?? null,
//                 sensorId: sensor.id,
//                 vehicleId: sensor.vehicleId,
//               },
//             });
//           }

//           // Event only for THEFT/REFUEL
//           if (eventType) {
//             const evtExists = await tx.event.findFirst({
//               where: { sensorId: sensor.id, vehicleId: sensor.vehicleId, timestamp: curr.timestamp, type: eventType },
//               select: { id: true },
//             });
//             if (!evtExists) {
//               await tx.event.create({
//                 data: {
//                   type: eventType,
//                   timestamp: curr.timestamp,
//                   deltaLitres: deltaLitres,
//                   description: desc,
//                   locationLat: curr.locationLat ?? null,
//                   locationLong: curr.locationLong ?? null,
//                   sensorId: sensor.id,
//                   vehicleId: sensor.vehicleId,
//                 },
//               });
//             }
//           }

//           // Mark this reading as processed
//           await tx.sensorReading.update({
//             where: { id: curr.id },
//             data: { processed: true },
//           });
//         });

//         // Advance context for next iteration
//         lastProcessed = curr;
//       }

//       console.log(`✅ ${sensor.sensorCode}: processed ${pending.length}`);
//     } catch (err) {
//       console.error(`🚨 Error processing sensor ${sensor.sensorCode}:`, err);
//     }
//   }

//   console.log('🏁 Detection pass complete.');
// }

