#!/usr/bin/env ts-node
import prisma from '../lib/prisma';

const DEDUPE_LOW_FUEL = process.env.DEDUPE_LOW_FUEL !== 'false';
const BACKFILL_EVENTS = process.env.BACKFILL_EVENTS !== 'false';
const BUILD_SUMMARIES = process.env.BUILD_SUMMARIES !== 'false';
const DAYS = Number(process.env.SUMMARY_DAYS ?? 7);

async function backfillEventsFromHistory() {
  const batchSize = 500;
  let skip = 0;
  let created = 0;
  for (;;) {
    const histories = await prisma.history.findMany({
      orderBy: { timestamp: 'asc' },
      skip,
      take: batchSize,
    });
    if (histories.length === 0) break;

    for (const h of histories) {
      const exists = await prisma.event.findFirst({
        where: {
          sensorId: h.sensorId,
          vehicleId: h.vehicleId,
          timestamp: h.timestamp,
          type: h.type as any,
        },
        select: { id: true },
      });
      if (!exists) {
        await prisma.event.create({
          data: {
            type: h.type as any,
            timestamp: h.timestamp,
            deltaLitres: h.type === 'REFUEL' ? Math.abs(h.fuelDropLitres) : (h.type === 'THEFT' ? -Math.abs(h.fuelDropLitres) : null),
            description: h.description,
            locationLat: h.locationLat ?? null,
            locationLong: h.locationLong ?? null,
            sensorId: h.sensorId,
            vehicleId: h.vehicleId,
          },
        });
        created += 1;
      }
    }
    skip += batchSize;
  }
  console.log(`✅ Backfill Events: created ${created}`);
}

async function dedupeLowFuelAlerts(windowHours = 3) {
  const sensors = await prisma.sensor.findMany({ select: { id: true, vehicleId: true } });
  let deleted = 0;
  for (const s of sensors) {
    const alerts = await prisma.alert.findMany({
      where: { sensorId: s.id, vehicleId: s.vehicleId, type: 'LOW_FUEL' },
      orderBy: { timestamp: 'asc' },
    });
    let lastKept: Date | null = null;
    for (const a of alerts) {
      if (!lastKept || (a.timestamp.getTime() - lastKept.getTime()) > windowHours * 3600 * 1000) {
        lastKept = a.timestamp;
      } else {
        await prisma.alert.delete({ where: { id: a.id } });
        deleted += 1;
      }
    }
  }
  console.log(`🧹 Dedupe LOW_FUEL alerts: deleted ${deleted}`);
}

function toStartOfDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

async function buildSummaries(days: number) {
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 3600 * 1000);

  const vehicles = await prisma.vehicle.findMany({ select: { id: true } });
  let upserts = 0;

  for (const v of vehicles) {
    const readings = await prisma.sensorReading.findMany({
      where: { sensor: { vehicleId: v.id }, timestamp: { gte: start, lte: end } },
      orderBy: { timestamp: 'asc' },
      select: { timestamp: true, fuelLevel: true, odometerKm: true, speed: true, ignitionStatus: true },
    });
    if (readings.length === 0) continue;

    const fromDate = readings[0].timestamp;
    const toDate = readings[readings.length - 1].timestamp;
    const sFuelLevel = readings[0].fuelLevel ?? 0;
    const eFuelLevel = readings[readings.length - 1].fuelLevel ?? 0;

    let totalFuelConsumed = 0;
    let totalFuelFills = 0;
    let totalFuelDrops = 0;
    let totalDistanceKm = 0;
    let lastOdo = readings[0].odometerKm ?? 0;

    for (let i = 1; i < readings.length; i++) {
      const prev = readings[i - 1];
      const curr = readings[i];
      if (prev.odometerKm != null && curr.odometerKm != null) {
        const d = Math.max(0, curr.odometerKm - prev.odometerKm);
        totalDistanceKm += d;
      }
      const pf = prev.fuelLevel ?? null;
      const cf = curr.fuelLevel ?? null;
      if (pf != null && cf != null) {
        const delta = cf - pf;
        if (delta < 0) totalFuelConsumed += Math.abs(delta);
        else totalFuelFills += delta;
      }
      lastOdo = curr.odometerKm ?? lastOdo;
    }

    const events = await prisma.event.findMany({ where: { vehicleId: v.id, timestamp: { gte: start, lte: end } }, select: { type: true, deltaLitres: true } });
    for (const ev of events) {
      if (ev.type === 'THEFT') totalFuelDrops += Math.abs(ev.deltaLitres ?? 0);
      if (ev.type === 'REFUEL') totalFuelFills += Math.abs(ev.deltaLitres ?? 0);
    }

    const kmpl = totalFuelConsumed > 0 ? totalDistanceKm / totalFuelConsumed : 0;

    await prisma.summaryMetrics.upsert({
      where: { id: `${v.id}:${toStartOfDay(start).toISOString()}:${toStartOfDay(end).toISOString()}` },
      update: {
        sFuelLevel,
        eFuelLevel,
        totalFuelConsumed,
        totalFuelFills,
        totalFuelDrops,
        kmpl,
        totalDistanceKm,
        totalRunningHours: 0,
        totalIdleHours: 0,
        totalStoppageHours: 0,
        dropAlert: totalFuelDrops > 0,
        fillAlert: totalFuelFills > 0,
      },
      create: {
        id: `${v.id}:${toStartOfDay(start).toISOString()}:${toStartOfDay(end).toISOString()}`,
        vehicleId: v.id,
        fromDate: start,
        toDate: end,
        sFuelLevel,
        eFuelLevel,
        totalFuelConsumed,
        totalFuelFills,
        totalFuelDrops,
        kmpl,
        totalDistanceKm,
        totalRunningHours: 0,
        totalIdleHours: 0,
        totalStoppageHours: 0,
        dropAlert: totalFuelDrops > 0,
        fillAlert: totalFuelFills > 0,
      },
    });
    upserts += 1;
  }
  console.log(`📊 Summaries upserted for ${upserts} vehicles (window=${days}d)`);
}

async function main() {
  if (BACKFILL_EVENTS) await backfillEventsFromHistory();
  if (DEDUPE_LOW_FUEL) await dedupeLowFuelAlerts(3);
  if (BUILD_SUMMARIES) await buildSummaries(DAYS);
}

main()
  .catch((e) => {
    console.error('❌ Backfill error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
