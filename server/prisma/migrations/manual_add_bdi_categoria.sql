-- Migration: Add bdiCategoria column to EngineeringProposalItem
-- Date: 2026-04-25
-- Description: Supports differentiated BDI (OBRA vs FORNECIMENTO) per TCU 2622/2013
-- NOTE: Superseded by versioned migration 20260425000000_add_bdi_categoria_engineering_proposal_item

ALTER TABLE "EngineeringProposalItem" 
ADD COLUMN IF NOT EXISTS "bdiCategoria" TEXT DEFAULT 'OBRA';
