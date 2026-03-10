-- AlterTable: Add ComprasNet fields to BiddingProcess
ALTER TABLE "BiddingProcess" ADD COLUMN "uasg" TEXT;
ALTER TABLE "BiddingProcess" ADD COLUMN "modalityCode" TEXT;
ALTER TABLE "BiddingProcess" ADD COLUMN "processNumber" TEXT;
ALTER TABLE "BiddingProcess" ADD COLUMN "processYear" TEXT;

-- AlterTable: Add monitoring detail fields to ChatMonitorLog
ALTER TABLE "ChatMonitorLog" ADD COLUMN "authorType" TEXT;
ALTER TABLE "ChatMonitorLog" ADD COLUMN "authorCnpj" TEXT;
ALTER TABLE "ChatMonitorLog" ADD COLUMN "eventCategory" TEXT;
ALTER TABLE "ChatMonitorLog" ADD COLUMN "itemRef" TEXT;
ALTER TABLE "ChatMonitorLog" ADD COLUMN "captureSource" TEXT DEFAULT 'pncp-status';
