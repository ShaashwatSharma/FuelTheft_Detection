-- AlterTable
ALTER TABLE "public"."SensorReading" ADD COLUMN     "processed" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "SensorReading_sensorId_processed_timestamp_idx" ON "public"."SensorReading"("sensorId", "processed", "timestamp");
