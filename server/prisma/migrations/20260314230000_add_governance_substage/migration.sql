-- AlterTable
ALTER TABLE "BiddingProcess" ADD COLUMN "substage" TEXT;

-- Migrate legacy statuses to new governance model
UPDATE "BiddingProcess" SET status = 'Em Análise',  substage = 'analise_edital'     WHERE status = 'Em Análise de Edital';
UPDATE "BiddingProcess" SET status = 'Em Sessão',   substage = 'disputa_aberta'     WHERE status = 'Participando';
UPDATE "BiddingProcess" SET status = 'Em Sessão',   substage = 'disputa_aberta'     WHERE status = 'Monitorando';
UPDATE "BiddingProcess" SET status = 'Ganho',       substage = 'homologado'         WHERE status = 'Vencido';
UPDATE "BiddingProcess" SET status = 'Perdido',     substage = 'perdeu_disputa'     WHERE status = 'Sem Sucesso';

-- Set default substages for statuses that remain unchanged
UPDATE "BiddingProcess" SET substage = 'importado_pncp'     WHERE status = 'Captado'                 AND substage IS NULL;
UPDATE "BiddingProcess" SET substage = 'revisao_documental' WHERE status = 'Preparando Documentação'  AND substage IS NULL;
UPDATE "BiddingProcess" SET substage = 'elaborando_recurso' WHERE status = 'Recurso'                 AND substage IS NULL;
UPDATE "BiddingProcess" SET substage = 'perdeu_disputa'     WHERE status = 'Perdido'                 AND substage IS NULL;
