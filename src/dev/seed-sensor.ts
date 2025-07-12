import prisma from '../lib/prisma';

async function main() {
  const sensor = await prisma.sensor.upsert({
    where: { sensorCode: 'SIM-SENSOR-001' },
    update: {},
    create: {
      sensorCode: 'SIM-SENSOR-001',
      isActive: true,
      vehicle: {
        create: {
          registrationNo: 'TEST-1234',
          model: 'Test Bus',
          capacity: 80,
          mileageEst: 3.5,
        },
      },
    },
  });

  console.log('✅ Sensor created:', sensor);
}

main().catch(e => {
  console.error(e);
  process.exit(1);
});
