-- CreateTable: PNCP Aggregator - Base local de contratações públicas
CREATE TABLE "PncpContratacao" (
    "id" TEXT NOT NULL,
    "numeroControle" TEXT NOT NULL,
    "cnpjOrgao" TEXT NOT NULL,
    "anoCompra" INTEGER NOT NULL,
    "sequencialCompra" INTEGER NOT NULL,
    "orgaoNome" TEXT,
    "unidadeNome" TEXT,
    "uf" TEXT,
    "municipio" TEXT,
    "esfera" TEXT,
    "objeto" TEXT,
    "modalidade" TEXT,
    "modalidadeCodigo" TEXT,
    "situacao" TEXT,
    "valorEstimado" DOUBLE PRECISION,
    "valorHomologado" DOUBLE PRECISION,
    "srp" BOOLEAN NOT NULL DEFAULT false,
    "modoDisputa" TEXT,
    "numeroCompra" TEXT,
    "dataPublicacao" TIMESTAMP(3),
    "dataAbertura" TIMESTAMP(3),
    "dataEncerramento" TIMESTAMP(3),
    "dataInclusao" TIMESTAMP(3),
    "linkSistema" TEXT,
    "linkOrigem" TEXT,
    "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PncpContratacao_pkey" PRIMARY KEY ("id")
);

-- CreateTable: PNCP Items
CREATE TABLE "PncpItem" (
    "id" TEXT NOT NULL,
    "contratacaoId" TEXT NOT NULL,
    "numeroItem" INTEGER NOT NULL,
    "descricao" TEXT,
    "quantidade" DOUBLE PRECISION,
    "unidadeMedida" TEXT,
    "valorUnitario" DOUBLE PRECISION,
    "valorTotal" DOUBLE PRECISION,
    "situacao" TEXT,
    "tipoBeneficio" TEXT,

    CONSTRAINT "PncpItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable: Sync State
CREATE TABLE "PncpSyncState" (
    "id" TEXT NOT NULL DEFAULT 'singleton',
    "lastSyncAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastFullSyncAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalSynced" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "isRunning" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PncpSyncState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PncpContratacao_numeroControle_key" ON "PncpContratacao"("numeroControle");
CREATE INDEX "PncpContratacao_uf_idx" ON "PncpContratacao"("uf");
CREATE INDEX "PncpContratacao_situacao_idx" ON "PncpContratacao"("situacao");
CREATE INDEX "PncpContratacao_modalidade_idx" ON "PncpContratacao"("modalidade");
CREATE INDEX "PncpContratacao_dataPublicacao_idx" ON "PncpContratacao"("dataPublicacao");
CREATE INDEX "PncpContratacao_valorEstimado_idx" ON "PncpContratacao"("valorEstimado");
CREATE INDEX "PncpContratacao_cnpjOrgao_anoCompra_sequencialCompra_idx" ON "PncpContratacao"("cnpjOrgao", "anoCompra", "sequencialCompra");

CREATE UNIQUE INDEX "PncpItem_contratacaoId_numeroItem_key" ON "PncpItem"("contratacaoId", "numeroItem");
CREATE INDEX "PncpItem_contratacaoId_idx" ON "PncpItem"("contratacaoId");

-- AddForeignKey
ALTER TABLE "PncpItem" ADD CONSTRAINT "PncpItem_contratacaoId_fkey" FOREIGN KEY ("contratacaoId") REFERENCES "PncpContratacao"("id") ON DELETE CASCADE ON UPDATE CASCADE;
