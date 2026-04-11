-- CreateTable
CREATE TABLE "AiAnalysisTelemetry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "processId" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "numPdfs" INTEGER NOT NULL DEFAULT 0,
    "totalPages" INTEGER NOT NULL DEFAULT 0,
    "totalChars" INTEGER NOT NULL DEFAULT 0,
    "hasScannedPdf" BOOLEAN NOT NULL DEFAULT false,
    "portal" TEXT,
    "modalidade" TEXT,
    "objeto" TEXT,
    "model" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "extractionTimeMs" INTEGER NOT NULL DEFAULT 0,
    "totalTimeMs" INTEGER NOT NULL DEFAULT 0,
    "parseRepairs" INTEGER NOT NULL DEFAULT 0,
    "fallbackUsed" BOOLEAN NOT NULL DEFAULT false,
    "categoryGapRecovery" BOOLEAN NOT NULL DEFAULT false,
    "totalRequirements" INTEGER NOT NULL DEFAULT 0,
    "categoryCounts" JSONB,
    "totalEvidences" INTEGER NOT NULL DEFAULT 0,
    "totalRisks" INTEGER NOT NULL DEFAULT 0,
    "qualityScore" DOUBLE PRECISION,
    "confidenceScore" DOUBLE PRECISION,
    "enforcerCorrections" INTEGER NOT NULL DEFAULT 0,
    "safetyNetsTriggered" JSONB,
    "status" TEXT NOT NULL DEFAULT 'success',
    "errorMessage" TEXT,

    CONSTRAINT "AiAnalysisTelemetry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiAnalysisTelemetry_tenantId_timestamp_idx" ON "AiAnalysisTelemetry"("tenantId", "timestamp");
CREATE INDEX "AiAnalysisTelemetry_status_idx" ON "AiAnalysisTelemetry"("status");
CREATE INDEX "AiAnalysisTelemetry_qualityScore_idx" ON "AiAnalysisTelemetry"("qualityScore");
