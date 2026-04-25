-- Migration: Add bdiCategoria column to EngineeringProposalItem
-- Date: 2026-04-25
-- Description: Supports differentiated BDI (OBRA vs FORNECIMENTO) per TCU 2622/2013

ALTER TABLE "EngineeringProposalItem" 
ADD COLUMN "bdiCategoria" TEXT DEFAULT 'OBRA';

-- Backfill existing records
UPDATE "EngineeringProposalItem" 
SET "bdiCategoria" = 'OBRA' 
WHERE "bdiCategoria" IS NULL;
