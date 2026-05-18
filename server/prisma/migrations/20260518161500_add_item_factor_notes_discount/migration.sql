-- AlterTable: Add multiplicationFactor, notes, discount to EngineeringProposalItem
-- These fields were only tracked in frontend memory and lost on every save/load cycle,
-- causing the ETAPA multiplication factor to compound on each re-application.

ALTER TABLE "EngineeringProposalItem" ADD COLUMN "multiplicationFactor" DOUBLE PRECISION;
ALTER TABLE "EngineeringProposalItem" ADD COLUMN "notes" TEXT;
ALTER TABLE "EngineeringProposalItem" ADD COLUMN "discount" DOUBLE PRECISION;
