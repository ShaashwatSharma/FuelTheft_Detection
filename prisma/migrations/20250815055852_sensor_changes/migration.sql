/*
  Warnings:

  - You are about to drop the column `altitude` on the `SensorReading` table. All the data in the column will be lost.
  - You are about to drop the column `angle` on the `SensorReading` table. All the data in the column will be lost.
  - You are about to drop the column `distanceKm` on the `SensorReading` table. All the data in the column will be lost.
  - You are about to drop the column `eventId` on the `SensorReading` table. All the data in the column will be lost.
  - You are about to drop the column `hdop` on the `SensorReading` table. All the data in the column will be lost.
  - You are about to drop the column `odometer` on the `SensorReading` table. All the data in the column will be lost.
  - You are about to drop the column `pdop` on the `SensorReading` table. All the data in the column will be lost.
  - You are about to drop the column `priority` on the `SensorReading` table. All the data in the column will be lost.
  - You are about to drop the column `processed` on the `SensorReading` table. All the data in the column will be lost.
  - You are about to drop the column `sats` on the `SensorReading` table. All the data in the column will be lost.
  - Added the required column `vehicleId` to the `Alert` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `type` on the `History` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "public"."EventType" AS ENUM ('THEFT', 'REFUEL', 'DROP');

-- CreateEnum
CREATE TYPE "public"."SensorStatus" AS ENUM ('OK', 'OFFLINE', 'FAULTY', 'UNKNOWN');

-- DropForeignKey
ALTER TABLE "public"."Alert" DROP CONSTRAINT "Alert_sensorId_fkey";

-- AlterTable
ALTER TABLE "public"."Alert" ADD COLUMN     "vehicleId" TEXT NOT NULL,
ALTER COLUMN "locationLat" DROP NOT NULL,
ALTER COLUMN "locationLong" DROP NOT NULL,
ALTER COLUMN "sensorId" DROP NOT NULL;

-- AlterTable
ALTER TABLE "public"."History" DROP COLUMN "type",
ADD COLUMN     "type" "public"."EventType" NOT NULL,
ALTER COLUMN "locationLat" DROP NOT NULL,
ALTER COLUMN "locationLong" DROP NOT NULL;

-- AlterTable
ALTER TABLE "public"."Sensor" ADD COLUMN     "status" "public"."SensorStatus" NOT NULL DEFAULT 'UNKNOWN';

-- AlterTable
ALTER TABLE "public"."SensorReading" DROP COLUMN "altitude",
DROP COLUMN "angle",
DROP COLUMN "distanceKm",
DROP COLUMN "eventId",
DROP COLUMN "hdop",
DROP COLUMN "odometer",
DROP COLUMN "pdop",
DROP COLUMN "priority",
DROP COLUMN "processed",
DROP COLUMN "sats",
ADD COLUMN     "address" TEXT,
ADD COLUMN     "isOverSpeed" BOOLEAN,
ADD COLUMN     "odometerKm" DOUBLE PRECISION,
ALTER COLUMN "locationLat" DROP NOT NULL,
ALTER COLUMN "locationLong" DROP NOT NULL,
ALTER COLUMN "speed" DROP NOT NULL;

-- AlterTable
ALTER TABLE "public"."Vehicle" ADD COLUMN     "externalVehicleId" TEXT;

-- DropEnum
DROP TYPE "public"."LogLevel";

-- CreateTable
CREATE TABLE "public"."Event" (
    "id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "type" "public"."EventType" NOT NULL,
    "deltaLitres" DOUBLE PRECISION,
    "locationLat" DOUBLE PRECISION,
    "locationLong" DOUBLE PRECISION,
    "description" TEXT,
    "vehicleId" TEXT NOT NULL,
    "sensorId" TEXT NOT NULL,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Event_vehicleId_timestamp_idx" ON "public"."Event"("vehicleId", "timestamp");

-- AddForeignKey
ALTER TABLE "public"."Event" ADD CONSTRAINT "Event_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "public"."Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Event" ADD CONSTRAINT "Event_sensorId_fkey" FOREIGN KEY ("sensorId") REFERENCES "public"."Sensor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Alert" ADD CONSTRAINT "Alert_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "public"."Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Alert" ADD CONSTRAINT "Alert_sensorId_fkey" FOREIGN KEY ("sensorId") REFERENCES "public"."Sensor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
