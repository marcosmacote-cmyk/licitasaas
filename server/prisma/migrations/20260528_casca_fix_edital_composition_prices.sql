-- CASCA-FIX: Add editalUnitCost and compositionTotalPrice to EngineeringProposalItem
-- editalUnitCost: Reference price from bid document (read-only, never used in calculations)
-- compositionTotalPrice: Formed price from composition items in PROPRIA database

ALTER TABLE "EngineeringProposalItem" ADD COLUMN IF NOT EXISTS "editalUnitCost" DOUBLE PRECISION;
ALTER TABLE "EngineeringProposalItem" ADD COLUMN IF NOT EXISTS "compositionTotalPrice" DOUBLE PRECISION;
