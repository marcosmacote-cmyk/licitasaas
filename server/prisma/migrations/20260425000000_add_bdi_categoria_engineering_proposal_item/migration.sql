-- AlterTable: Add bdiCategoria column to EngineeringProposalItem
-- Purpose: Supports differentiated BDI (Obra vs Fornecimento) per TCU Accord 2622/2013
-- Default 'OBRA' is backward-compatible with all existing records
ALTER TABLE "EngineeringProposalItem" ADD COLUMN IF NOT EXISTS "bdiCategoria" TEXT DEFAULT 'OBRA';
