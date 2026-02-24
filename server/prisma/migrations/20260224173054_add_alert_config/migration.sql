-- AlterTable
ALTER TABLE "AiAnalysis" ADD COLUMN     "sourceFileNames" TEXT DEFAULT '[]';

-- AlterTable
ALTER TABLE "BiddingProcess" ADD COLUMN     "reminderDays" TEXT DEFAULT '[]',
ADD COLUMN     "reminderType" TEXT DEFAULT 'once';

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "alertDays" INTEGER DEFAULT 15,
ALTER COLUMN "companyProfileId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "GlobalConfig" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "config" TEXT NOT NULL DEFAULT '{}',

    CONSTRAINT "GlobalConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GlobalConfig_tenantId_key" ON "GlobalConfig"("tenantId");

-- AddForeignKey
ALTER TABLE "GlobalConfig" ADD CONSTRAINT "GlobalConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
