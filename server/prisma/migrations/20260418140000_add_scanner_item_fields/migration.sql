-- AlterTable: Add fields needed for items preview in scanner results
-- These are nullable so existing rows are unaffected (non-destructive)
ALTER TABLE "OpportunityScannerLog" ADD COLUMN IF NOT EXISTS "orgaoCnpj" TEXT;
ALTER TABLE "OpportunityScannerLog" ADD COLUMN IF NOT EXISTS "anoCompra" TEXT;
ALTER TABLE "OpportunityScannerLog" ADD COLUMN IF NOT EXISTS "sequencialCompra" TEXT;
