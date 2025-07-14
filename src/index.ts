import prisma from './lib/prisma';
import { runDetection } from './processor/detector';
import cron from 'node-cron';
import './processor/detector';
import './api';
import './mqtt/listener';
// import startListener from './mqtt/listener';



// startListener(); 


async function main() {
  const vehicles = await prisma.vehicle.findMany();
  console.log('Vehicles:', vehicles);
}

// setTimeout(runDetection, 10000); // run 10 sec after start
cron.schedule('*/1 * * * *', runDetection);// Every 1 minutes

main().catch(e => {
  console.error(e);
  process.exit(1);
});

