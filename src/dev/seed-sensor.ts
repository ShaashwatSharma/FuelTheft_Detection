// import prisma from '../lib/prisma';

// async function main() {
//   console.log('🌱 Seeding Dev Data...');

//   // Create 10 Routes
//   const routes = [];
//   for (let i = 1; i <= 10; i++) {
//     const route = await prisma.route.upsert({
//       where: { name: `Route ${i}` },
//       update: {},
//       create: {
//         name: `Route ${i}`,
//         startPoint: `Depot ${i}`,
//         endPoint: `Terminal ${i}`,
//       },
//     });
//     routes.push(route);
//   }

//   // Create 10 Vehicles with Drivers and Sensors
//   for (let i = 1; i <= 10; i++) {
//     const vehicle = await prisma.vehicle.upsert({
//       where: { registrationNo: `TEST-BUS-${i.toString().padStart(3, '0')}` },
//       update: {},
//       create: {
//         registrationNo: `TEST-BUS-${i.toString().padStart(3, '0')}`,
//         model: 'Tata Starbus',
//         tankSize: 200 + i * 10,
//         mileageEst: 5 + i * 0.1,
//         routeId: routes[i % routes.length].id,
//         driver: {
//           create: {
//             name: `Driver ${i}`,
//             phone: `99999999${i.toString().padStart(2, '0')}`,
//             licenseNo: `DL1234${i.toString().padStart(3, '0')}`,
//           },
//         },
//       },
//     });

//     await prisma.sensor.upsert({
//       where: { sensorCode: `SIM-SENSOR-${i.toString().padStart(3, '0')}` },
//       update: {},
//       create: {
//         sensorCode: `SIM-SENSOR-${i.toString().padStart(3, '0')}`,
//         vehicleId: vehicle.id,
//       },
//     });
//   }

//   console.log('✅ Dev Data Seeding Completed!');
// }

// main()
//   .catch((e) => {
//     console.error(e);
//     process.exit(1);
//   })
//   .finally(async () => {
//     await prisma.$disconnect();
//   });



















// // import prisma from '../lib/prisma';

// // async function main() {
// //   const sensor = await prisma.sensor.upsert({
// //     where: { sensorCode: 'SIM-SENSOR-007' },
// //     update: {},
// //     create: {
// //       sensorCode: 'SIM-SENSOR-007',
// //       isActive: true,
// //       vehicle: {
// //         create: {
// //           registrationNo: 'TEST-1240',
// //           model: 'Test Bus',
// //           capacity: 80,
// //           mileageEst: 3.5,
// //         },
// //       },
// //     },
// //   });

// //   console.log('✅ Sensor created:', sensor);
// // }

// // main().catch(e => {
// //   console.error(e);
// //   process.exit(1);
// // });
