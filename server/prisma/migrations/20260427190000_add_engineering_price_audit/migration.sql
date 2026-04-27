-- Preserve item-level official/base price comparison without overwriting edital prices.
ALTER TABLE "EngineeringProposalItem"
ADD COLUMN IF NOT EXISTS "priceAudit" JSONB;

ALTER TABLE "EngineeringProposalItem"
ADD COLUMN IF NOT EXISTS "priceOrigin" TEXT DEFAULT 'MANUAL',
ADD COLUMN IF NOT EXISTS "officialUnitCost" DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS "officialUnitPrice" DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS "officialTotalPrice" DOUBLE PRECISION;
