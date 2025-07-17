import { PrismaClient } from '../generated/prisma';

const prisma = new PrismaClient();

async function clearData() {
  try {
    console.log('🧹 Clearing alerts, events, and sensor readings...');

    await prisma.alert.deleteMany();
    await prisma.event.deleteMany();
    await prisma.sensorReading.deleteMany();

    console.log('✅ Data cleared successfully!');
  } catch (err) {
    console.error('❌ Failed to clear data:', err);
  } finally {
    await prisma.$disconnect();
  }
}

clearData();
