/*
  Warnings:

  - You are about to drop the column `capacity` on the `Vehicle` table. All the data in the column will be lost.
  - You are about to drop the `Event` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `SensorOnOffEvent` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `speed` to the `SensorReading` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "LogLevel" AS ENUM ('INFO', 'WARNING', 'ERROR');

-- AlterEnum
ALTER TYPE "AlertType" ADD VALUE 'SENSOR_HEALTH';

-- DropForeignKey
ALTER TABLE "Event" DROP CONSTRAINT "Event_sensorId_fkey";

-- DropForeignKey
ALTER TABLE "Event" DROP CONSTRAINT "Event_vehicleId_fkey";

-- DropForeignKey
ALTER TABLE "SensorOnOffEvent" DROP CONSTRAINT "SensorOnOffEvent_sensorId_fkey";

-- AlterTable
ALTER TABLE "SensorReading" ADD COLUMN     "deviceVoltage" DOUBLE PRECISION,
ADD COLUMN     "ignitionStatus" TEXT,
ADD COLUMN     "isOverSpeed" BOOLEAN,
ADD COLUMN     "odometer" DOUBLE PRECISION,
ADD COLUMN     "speed" DOUBLE PRECISION NOT NULL;

-- AlterTable
ALTER TABLE "Vehicle" DROP COLUMN "capacity",
ADD COLUMN     "tankSize" INTEGER;

-- DropTable
DROP TABLE "Event";

-- DropTable
DROP TABLE "SensorOnOffEvent";

-- DropEnum
DROP TYPE "SensorStatus";

-- CreateTable
CREATE TABLE "Log" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "message" TEXT NOT NULL,
    "level" "LogLevel" NOT NULL,
    "context" TEXT,
    "details" JSONB,
    "userId" TEXT,
    "requestId" TEXT,
    "actionType" TEXT,
    "vehicleId" TEXT,
    "sensorId" TEXT,

    CONSTRAINT "Log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SummaryMetrics" (
    "id" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "fromDate" TIMESTAMP(3) NOT NULL,
    "toDate" TIMESTAMP(3) NOT NULL,
    "sFuelLevel" DOUBLE PRECISION NOT NULL,
    "eFuelLevel" DOUBLE PRECISION NOT NULL,
    "totalFuelConsumed" DOUBLE PRECISION NOT NULL,
    "totalFuelFills" DOUBLE PRECISION NOT NULL,
    "totalFuelDrops" DOUBLE PRECISION NOT NULL,
    "kmpl" DOUBLE PRECISION NOT NULL,
    "totalDistanceKm" DOUBLE PRECISION NOT NULL,
    "totalRunningHours" DOUBLE PRECISION NOT NULL,
    "totalIdleHours" DOUBLE PRECISION NOT NULL,
    "totalStoppageHours" DOUBLE PRECISION NOT NULL,
    "dropAlert" BOOLEAN NOT NULL DEFAULT false,
    "fillAlert" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SummaryMetrics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SummaryMetrics_fromDate_toDate_idx" ON "SummaryMetrics"("fromDate", "toDate");

-- AddForeignKey
ALTER TABLE "Log" ADD CONSTRAINT "Log_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Log" ADD CONSTRAINT "Log_sensorId_fkey" FOREIGN KEY ("sensorId") REFERENCES "Sensor"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SummaryMetrics" ADD CONSTRAINT "SummaryMetrics_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
