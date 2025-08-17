/*
  Warnings:

  - Added the required column `odoDistance` to the `History` table without a default value. This is not possible if the table is not empty.
  - Made the column `fuelDropLitres` on table `History` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "public"."History" ADD COLUMN     "odoDistance" DOUBLE PRECISION NOT NULL,
ALTER COLUMN "fuelDropLitres" SET NOT NULL;
