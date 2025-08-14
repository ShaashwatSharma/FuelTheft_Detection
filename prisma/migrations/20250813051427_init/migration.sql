/*
  Warnings:

  - You are about to drop the column `isOverSpeed` on the `SensorReading` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[sensorId,timestamp]` on the table `SensorReading` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "SensorReading" DROP COLUMN "isOverSpeed",
ADD COLUMN     "altitude" DOUBLE PRECISION,
ADD COLUMN     "angle" DOUBLE PRECISION,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "eventId" INTEGER,
ADD COLUMN     "hdop" DOUBLE PRECISION,
ADD COLUMN     "pdop" DOUBLE PRECISION,
ADD COLUMN     "priority" INTEGER,
ADD COLUMN     "raw" JSONB,
ADD COLUMN     "sats" INTEGER,
ADD COLUMN     "topic" TEXT,
ALTER COLUMN "fuelLevel" DROP NOT NULL,
ALTER COLUMN "distanceKm" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "SensorReading_sensorId_timestamp_key" ON "SensorReading"("sensorId", "timestamp");
