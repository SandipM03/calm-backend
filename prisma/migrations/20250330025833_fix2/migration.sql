/*
  Warnings:

  - You are about to drop the column `questionnaireId` on the `Response` table. All the data in the column will be lost.
  - You are about to drop the `Questionnaire` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "Response" DROP CONSTRAINT "Response_questionnaireId_fkey";

-- AlterTable
ALTER TABLE "Response" DROP COLUMN "questionnaireId";

-- DropTable
DROP TABLE "Questionnaire";
