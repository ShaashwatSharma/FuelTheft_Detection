/*
  Warnings:

  - You are about to drop the `Log` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterEnum
ALTER TYPE "AlertType" ADD VALUE 'NORMAL';

-- DropForeignKey
ALTER TABLE "Log" DROP CONSTRAINT "Log_sensorId_fkey";

-- DropForeignKey
ALTER TABLE "Log" DROP CONSTRAINT "Log_vehicleId_fkey";

-- DropTable
DROP TABLE "Log";

-- CreateTable
CREATE TABLE "History" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" "AlertType" NOT NULL,
    "description" TEXT NOT NULL,
    "fuelLevel" DOUBLE PRECISION NOT NULL,
    "fuelDropLitres" DOUBLE PRECISION,
    "vehicleId" TEXT NOT NULL,
    "sensorId" TEXT NOT NULL,
    "locationLat" DOUBLE PRECISION NOT NULL,
    "locationLong" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "History_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "History" ADD CONSTRAINT "History_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "History" ADD CONSTRAINT "History_sensorId_fkey" FOREIGN KEY ("sensorId") REFERENCES "Sensor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
