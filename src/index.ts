import prisma from './lib/prisma';
import './mqtt/listener';
import { runDetection } from './processor/detector';
import cron from 'node-cron';
import './mqtt/listener';
import './processor/detector';
import './api';





async function main() {
  const vehicles = await prisma.vehicle.findMany();
  console.log('Vehicles:', vehicles);
}

// setTimeout(runDetection, 10000); // run 10 sec after start
cron.schedule('*/2 * * * *', runDetection);// Every 2 minutes

main().catch(e => {
  console.error(e);
  process.exit(1);
});
