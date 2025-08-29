import prisma from './lib/prisma';
import { runDetection } from './processor/detector';
import { runOfflineMonitor } from './processor/offlineMonitor';
import cron from 'node-cron';
import './processor/detector';
import './api';
import './mqtt/listener';

async function main() {
  const vehicles = await prisma.vehicle.findMany();
  console.log('Vehicles:', vehicles);
}

// setTimeout(runDetection, 10000); // run 10 sec after start
cron.schedule('*/15 * * * *', runDetection);// Every 15 minutes
cron.schedule('*/30 * * * *', runOfflineMonitor);// Offline health check every 15 minutes

main().catch(e => {
  console.error(e);
  process.exit(1);
});

