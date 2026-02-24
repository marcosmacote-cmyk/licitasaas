-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "rootCnpj" TEXT NOT NULL,
    "razaoSocial" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'Analista',
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyProfile" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "isHeadquarters" BOOLEAN NOT NULL DEFAULT false,
    "cnpj" TEXT NOT NULL,
    "razaoSocial" TEXT NOT NULL,

    CONSTRAINT "CompanyProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BiddingProcess" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyProfileId" TEXT,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "portal" TEXT NOT NULL,
    "modality" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Captado',
    "risk" TEXT,
    "estimatedValue" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "sessionDate" TIMESTAMP(3) NOT NULL,
    "link" TEXT,
    "observations" TEXT DEFAULT '[]',
    "reminderDate" TIMESTAMP(3),
    "reminderStatus" TEXT DEFAULT 'pending',

    CONSTRAINT "BiddingProcess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiAnalysis" (
    "id" TEXT NOT NULL,
    "biddingProcessId" TEXT NOT NULL,
    "requiredDocuments" TEXT NOT NULL,
    "biddingItems" TEXT,
    "pricingConsiderations" TEXT,
    "irregularitiesFlags" TEXT NOT NULL,
    "fullSummary" TEXT,
    "deadlines" TEXT,
    "penalties" TEXT,
    "qualificationRequirements" TEXT,
    "chatHistory" TEXT DEFAULT '[]',
    "analyzedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiAnalysis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "companyProfileId" TEXT NOT NULL,
    "docType" TEXT NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "uploadDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expirationDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Válido',
    "autoRenew" BOOLEAN NOT NULL DEFAULT false,
    "docGroup" TEXT NOT NULL DEFAULT 'Outros',
    "issuerLink" TEXT,
    "fileName" TEXT NOT NULL DEFAULT 'Documento',

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyCredential" (
    "id" TEXT NOT NULL,
    "companyProfileId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "url" TEXT,
    "login" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyCredential_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Tenant_rootCnpj_key" ON "Tenant"("rootCnpj");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "CompanyProfile_cnpj_key" ON "CompanyProfile"("cnpj");

-- CreateIndex
CREATE UNIQUE INDEX "AiAnalysis_biddingProcessId_key" ON "AiAnalysis"("biddingProcessId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyProfile" ADD CONSTRAINT "CompanyProfile_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BiddingProcess" ADD CONSTRAINT "BiddingProcess_companyProfileId_fkey" FOREIGN KEY ("companyProfileId") REFERENCES "CompanyProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BiddingProcess" ADD CONSTRAINT "BiddingProcess_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiAnalysis" ADD CONSTRAINT "AiAnalysis_biddingProcessId_fkey" FOREIGN KEY ("biddingProcessId") REFERENCES "BiddingProcess"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_companyProfileId_fkey" FOREIGN KEY ("companyProfileId") REFERENCES "CompanyProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyCredential" ADD CONSTRAINT "CompanyCredential_companyProfileId_fkey" FOREIGN KEY ("companyProfileId") REFERENCES "CompanyProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
