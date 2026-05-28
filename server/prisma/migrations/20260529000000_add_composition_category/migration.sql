-- Migration: Add composition category + normalize item types
-- Phase 1 of Engineering Module restructuring

-- Step 1: Add category column to EngineeringComposition
ALTER TABLE "EngineeringComposition" ADD COLUMN IF NOT EXISTS "category" TEXT NOT NULL DEFAULT 'GERAL';

-- Step 2: Create index on category
CREATE INDEX IF NOT EXISTS "EngineeringComposition_category_idx" ON "EngineeringComposition"("category");

-- Step 3: Normalize item type variants to canonical values
-- Fix "Mão de Obra" and other non-canonical values in PROPRIA bases
UPDATE "EngineeringItem" SET type = 'MAO_DE_OBRA'
WHERE type IN ('Mão de Obra', 'MAO DE OBRA', 'MÃO DE OBRA', 'mao_de_obra', 'Mao de Obra', 'ENCARGOS COMPLEMENTARES');

UPDATE "EngineeringItem" SET type = 'EQUIPAMENTO'
WHERE type IN ('ALUGUEL', 'TRANSPORTE', 'Equipamento');

UPDATE "EngineeringItem" SET type = 'SERVICO'
WHERE type IN ('SERVIÇOS', 'SERVICOS', 'TAXAS', 'VERBA', 'ADMINISTRAÇÃO', 'ADMINISTRACAO', 'OUTROS', 'Serviço', 'Servico');

UPDATE "EngineeringItem" SET type = 'MATERIAL'
WHERE type IN ('Material', 'material');

-- Catch-all: any remaining non-canonical values → MATERIAL
UPDATE "EngineeringItem" SET type = 'MATERIAL'
WHERE type NOT IN ('MATERIAL', 'MAO_DE_OBRA', 'EQUIPAMENTO', 'SERVICO', 'OBSERVACAO');
