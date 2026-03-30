-- ══════════════════════════════════════════════════════════════════
--  Migration: Create AiUsageLog table
--  Purpose: Track per-tenant AI token consumption for billing/control
--  Date: 2026-03-30
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS "AiUsageLog" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "operation" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "totalTokens" INTEGER NOT NULL DEFAULT 0,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "success" BOOLEAN NOT NULL DEFAULT true,
    "errorMessage" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsageLog_pkey" PRIMARY KEY ("id")
);

-- Composite index for per-tenant time-range queries (most common use case)
CREATE INDEX IF NOT EXISTS "AiUsageLog_tenantId_createdAt_idx" ON "AiUsageLog"("tenantId", "createdAt");

-- Index for filtering by operation type
CREATE INDEX IF NOT EXISTS "AiUsageLog_operation_idx" ON "AiUsageLog"("operation");
