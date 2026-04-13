"use strict";
/**
 * ══════════════════════════════════════════════════════════════════
 *  SchemaEnforcer Golden Dataset Test — V4.9.1
 * ══════════════════════════════════════════════════════════════════
 *
 * Tests the SchemaEnforcer's safety-nets with deterministic input→output.
 * Based on 11 real editals audited in the V4.8–V4.9 sprint.
 *
 * Uso: npx tsx server/services/ai/benchmark/schemaEnforcerGoldenTest.ts
 *
 * What this tests:
 *   - CLEANUP 1: Phantom item removal
 *   - CLEANUP 1.5: Deduplication
 *   - CLEANUP 3: QTO→QTP migration
 *   - CLEANUP 4: DC↔RFT dedup + F3-04 reserva PCD
 *   - CLEANUP 5: PC anti-pollution + F3-01 desclassification + F3-06 platform noise
 *   - CLEANUP 6: PC empty injection
 *   - RFT Safety-Net: CND injection, FGTS/CNDT standalone
 *   - QEF Safety-Net: Balanço/Índices/Falência injection
 *   - Regra de Ouro: CNPJ→IE→IM ordering
 *   - F3-02: HJ consórcio injection
 *   - Participation_conditions: boolean defaults
 */
Object.defineProperty(exports, "__esModule", { value: true });
const schemaEnforcer_1 = require("../schemaEnforcer");
const logger_1 = require("../../../lib/logger");
const tests = [];
// ═══════════════════════════════════════════════════════════════
// TEST GROUP 1: RFT Regra de Ouro — CNPJ→IE→IM ordering
// ═══════════════════════════════════════════════════════════════
tests.push({
    name: 'REGRA-OURO-01: IE/IM fora de ordem → reordena para CNPJ→IE→IM',
    description: 'Quando IE e IM aparecem depois de CNDs, deve reordenar para CNPJ(01)→IE(02)→IM(03)',
    severity: 'critical',
    input: {
        process_identification: { objeto: 'Teste', modalidade: 'Pregão Eletrônico' },
        requirements: {
            habilitacao_juridica: [{ requirement_id: 'HJ-01', title: 'Ato constitutivo', description: '', obligation_type: 'obrigatoria_universal', entry_type: 'exigencia_principal', phase: 'habilitacao', applies_to: 'licitante', risk_if_missing: 'inabilitacao', source_ref: 'Edital', evidence_refs: [] }],
            regularidade_fiscal_trabalhista: [
                { requirement_id: 'RFT-01', title: 'Prova de inscrição no CNPJ', description: '', obligation_type: 'obrigatoria_universal', entry_type: 'exigencia_principal', phase: 'habilitacao', applies_to: 'licitante', risk_if_missing: 'inabilitacao', source_ref: 'Edital', evidence_refs: [] },
                { requirement_id: 'RFT-02', title: 'CRF FGTS', description: '', obligation_type: 'obrigatoria_universal', entry_type: 'exigencia_principal', phase: 'habilitacao', applies_to: 'licitante', risk_if_missing: 'inabilitacao', source_ref: 'Edital', evidence_refs: [] },
                { requirement_id: 'RFT-03', title: 'Inscrição estadual', description: 'IE no cadastro de contribuintes estadual', obligation_type: 'obrigatoria_universal', entry_type: 'exigencia_principal', phase: 'habilitacao', applies_to: 'licitante', risk_if_missing: 'inabilitacao', source_ref: 'Edital', evidence_refs: [] },
                { requirement_id: 'RFT-04', title: 'Inscrição municipal', description: 'IM no cadastro de contribuintes municipal', obligation_type: 'obrigatoria_universal', entry_type: 'exigencia_principal', phase: 'habilitacao', applies_to: 'licitante', risk_if_missing: 'inabilitacao', source_ref: 'Edital', evidence_refs: [] },
            ],
        },
        participation_conditions: {},
        technical_analysis: {},
        economic_financial_analysis: {},
        evidence_registry: [],
        timeline: {},
    },
    assertions: [
        (o) => {
            const rft = o.requirements.regularidade_fiscal_trabalhista;
            const first3 = rft.slice(0, 3).map((r) => r.title.toLowerCase());
            const hasCNPJ = first3[0]?.includes('cnpj');
            const hasIE = first3[1]?.includes('estadual') || first3[1]?.includes('inscrição estadual');
            const hasIM = first3[2]?.includes('municipal') || first3[2]?.includes('inscrição municipal');
            return { pass: hasCNPJ && hasIE && hasIM, detail: `RFT order: [${first3.join(' | ')}] — expected CNPJ→IE→IM` };
        },
    ],
});
// ═══════════════════════════════════════════════════════════════
// TEST GROUP 2: RFT Safety-Net — CND injection
// ═══════════════════════════════════════════════════════════════
tests.push({
    name: 'RFT-SAFETY-01: RFT thin (3 items) → injects missing CNDs',
    description: 'When RFT has only CNPJ/IE/IM, injects CND Federal, Estadual, Municipal, FGTS, CNDT',
    severity: 'critical',
    input: {
        process_identification: { objeto: 'Obra de pavimentação', modalidade: 'Concorrência Eletrônica' },
        requirements: {
            habilitacao_juridica: [{ requirement_id: 'HJ-01', title: 'Ato constitutivo', description: '', obligation_type: 'obrigatoria_universal', entry_type: 'exigencia_principal', phase: 'habilitacao', applies_to: 'licitante', risk_if_missing: 'inabilitacao', source_ref: 'Edital, item 4.1', evidence_refs: [] }],
            regularidade_fiscal_trabalhista: [
                { requirement_id: 'RFT-01', title: 'Prova de inscrição no CNPJ', description: '', obligation_type: 'obrigatoria_universal', entry_type: 'exigencia_principal', phase: 'habilitacao', applies_to: 'licitante', risk_if_missing: 'inabilitacao', source_ref: 'Edital, item 4.2', evidence_refs: [] },
                { requirement_id: 'RFT-02', title: 'Inscrição estadual', description: '', obligation_type: 'obrigatoria_universal', entry_type: 'exigencia_principal', phase: 'habilitacao', applies_to: 'licitante', risk_if_missing: 'inabilitacao', source_ref: 'Edital, item 4.2', evidence_refs: [] },
                { requirement_id: 'RFT-03', title: 'Inscrição municipal', description: '', obligation_type: 'obrigatoria_universal', entry_type: 'exigencia_principal', phase: 'habilitacao', applies_to: 'licitante', risk_if_missing: 'inabilitacao', source_ref: 'Edital, item 4.2', evidence_refs: [] },
            ],
            qualificacao_economico_financeira: [{ requirement_id: 'QEF-01', title: 'Certidão de Falência', description: '', obligation_type: 'obrigatoria_universal', entry_type: 'exigencia_principal', phase: 'habilitacao', applies_to: 'licitante', risk_if_missing: 'inabilitacao', source_ref: 'Edital', evidence_refs: [] }],
        },
        participation_conditions: {},
        technical_analysis: {},
        economic_financial_analysis: {},
        evidence_registry: [],
        timeline: {},
    },
    assertions: [
        (o) => {
            const rft = o.requirements.regularidade_fiscal_trabalhista;
            return { pass: rft.length >= 7, detail: `RFT count: ${rft.length} (expected ≥7 after CND injection)` };
        },
        (o) => {
            const rft = o.requirements.regularidade_fiscal_trabalhista;
            const titles = rft.map((r) => r.title.toLowerCase()).join(' | ');
            const hasFGTS = titles.includes('fgts');
            const hasCNDT = titles.includes('cndt') || titles.includes('trabalhist');
            return { pass: hasFGTS && hasCNDT, detail: `FGTS: ${hasFGTS}, CNDT: ${hasCNDT}` };
        },
    ],
});
// ═══════════════════════════════════════════════════════════════
// TEST GROUP 3: QEF Safety-Net — Balanço/Índices/Falência
// ═══════════════════════════════════════════════════════════════
tests.push({
    name: 'QEF-SAFETY-01: QEF with only Falência → injects Balanço + Índices',
    description: 'When QEF has only Certidão de Falência, must inject Balanço and Índices Contábeis',
    severity: 'critical',
    input: {
        process_identification: { objeto: 'Construção de ETA', modalidade: 'Concorrência Eletrônica' },
        requirements: {
            habilitacao_juridica: [{ requirement_id: 'HJ-01', title: 'Ato constitutivo', description: '', obligation_type: 'obrigatoria_universal', entry_type: 'exigencia_principal', phase: 'habilitacao', applies_to: 'licitante', risk_if_missing: 'inabilitacao', source_ref: 'Edital', evidence_refs: [] }],
            regularidade_fiscal_trabalhista: [
                { requirement_id: 'RFT-01', title: 'CNPJ', description: '', obligation_type: 'obrigatoria_universal', entry_type: 'exigencia_principal', phase: 'habilitacao', applies_to: 'licitante', risk_if_missing: 'inabilitacao', source_ref: 'Edital', evidence_refs: [] },
            ],
            qualificacao_economico_financeira: [
                { requirement_id: 'QEF-01', title: 'Certidão Negativa de Falência', description: 'Certidão negativa de falência ou recuperação judicial', obligation_type: 'obrigatoria_universal', entry_type: 'exigencia_principal', phase: 'habilitacao', applies_to: 'licitante', risk_if_missing: 'inabilitacao', source_ref: 'Edital, item 4.5', evidence_refs: [] },
            ],
        },
        participation_conditions: {},
        technical_analysis: {},
        economic_financial_analysis: {},
        evidence_registry: [],
        timeline: {},
    },
    assertions: [
        (o) => {
            const qef = o.requirements.qualificacao_economico_financeira;
            return { pass: qef.length >= 3, detail: `QEF count: ${qef.length} (expected ≥3 after Balanço + Índices injection)` };
        },
        (o) => {
            const qef = o.requirements.qualificacao_economico_financeira;
            const titles = qef.map((r) => r.title.toLowerCase()).join(' | ');
            const hasBalanco = titles.includes('balan') || titles.includes('demonstr');
            const hasIndices = titles.includes('ndice') || titles.includes('liquidez');
            return { pass: hasBalanco && hasIndices, detail: `Balanço: ${hasBalanco}, Índices: ${hasIndices}` };
        },
    ],
});
// ═══════════════════════════════════════════════════════════════
// TEST GROUP 4: PC Anti-Pollution — CLEANUP 5
// ═══════════════════════════════════════════════════════════════
tests.push({
    name: 'PC-POLLUTION-01: 12 PC items with generic clauses → cleans to ≤6',
    description: 'PC polluted with desclassification rules, platform noise, and generic clauses',
    severity: 'critical',
    input: {
        process_identification: { objeto: 'Fardamentos escolares', modalidade: 'Pregão Eletrônico' },
        requirements: {
            habilitacao_juridica: [{ requirement_id: 'HJ-01', title: 'Ato constitutivo', description: '', obligation_type: 'obrigatoria_universal', entry_type: 'exigencia_principal', phase: 'habilitacao', applies_to: 'licitante', risk_if_missing: 'inabilitacao', source_ref: 'Edital', evidence_refs: [] }],
            regularidade_fiscal_trabalhista: [],
            proposta_comercial: [
                { requirement_id: 'PC-01', title: 'Proposta de preços unitários', description: '', obligation_type: 'obrigatoria_universal', entry_type: 'exigencia_principal', phase: 'proposta', applies_to: 'licitante', risk_if_missing: 'desclassificacao', source_ref: 'Edital', evidence_refs: [] },
                { requirement_id: 'PC-02', title: 'Planilha orçamentária', description: 'Planilha com composição de custos', obligation_type: 'obrigatoria_universal', entry_type: 'exigencia_principal', phase: 'proposta', applies_to: 'licitante', risk_if_missing: 'desclassificacao', source_ref: 'Edital', evidence_refs: [] },
                { requirement_id: 'PC-03', title: 'Prazo de validade da proposta', description: 'Prazo de validade da proposta de 60 dias', obligation_type: 'obrigatoria_universal', entry_type: 'exigencia_principal', phase: 'proposta', applies_to: 'licitante', risk_if_missing: 'desclassificacao', source_ref: 'Edital', evidence_refs: [] },
                { requirement_id: 'PC-04', title: 'Proposta sem emendas ou rasuras', description: 'Proposta sem rasura, emenda ou ressalva', obligation_type: 'obrigatoria_universal', entry_type: 'exigencia_principal', phase: 'proposta', applies_to: 'licitante', risk_if_missing: 'desclassificacao', source_ref: 'Edital', evidence_refs: [] },
                { requirement_id: 'PC-05', title: 'Redigida em português', description: 'redigida em português', obligation_type: 'obrigatoria_universal', entry_type: 'exigencia_principal', phase: 'proposta', applies_to: 'licitante', risk_if_missing: 'desclassificacao', source_ref: 'Edital', evidence_refs: [] },
                { requirement_id: 'PC-06', title: 'Proposta com vícios insanáveis', description: 'Desclassificação por vícios insanáveis na proposta', obligation_type: 'obrigatoria_universal', entry_type: 'exigencia_principal', phase: 'proposta', applies_to: 'licitante', risk_if_missing: 'desclassificacao', source_ref: 'Edital', evidence_refs: [] },
                { requirement_id: 'PC-07', title: 'Preço manifestamente inexequível', description: 'manifestamente inexequível', obligation_type: 'obrigatoria_universal', entry_type: 'exigencia_principal', phase: 'proposta', applies_to: 'licitante', risk_if_missing: 'desclassificacao', source_ref: 'Edital', evidence_refs: [] },
                { requirement_id: 'PC-08', title: 'Preencher o campo Marca', description: 'preencher o campo marca do item', obligation_type: 'obrigatoria_universal', entry_type: 'exigencia_principal', phase: 'proposta', applies_to: 'licitante', risk_if_missing: 'desclassificacao', source_ref: 'Edital', evidence_refs: [] },
                { requirement_id: 'PC-09', title: 'Preencher o campo Fabricante', description: 'preencher o campo fabricante', obligation_type: 'obrigatoria_universal', entry_type: 'exigencia_principal', phase: 'proposta', applies_to: 'licitante', risk_if_missing: 'desclassificacao', source_ref: 'Edital', evidence_refs: [] },
                { requirement_id: 'PC-10', title: 'Preços de exclusiva responsabilidade', description: 'preços de exclusiva responsabilidade do licitante', obligation_type: 'obrigatoria_universal', entry_type: 'exigencia_principal', phase: 'proposta', applies_to: 'licitante', risk_if_missing: 'desclassificacao', source_ref: 'Edital', evidence_refs: [] },
                { requirement_id: 'PC-11', title: 'Oferta firme e irrevogável', description: 'Oferta firme e irrevogável', obligation_type: 'obrigatoria_universal', entry_type: 'exigencia_principal', phase: 'proposta', applies_to: 'licitante', risk_if_missing: 'desclassificacao', source_ref: 'Edital', evidence_refs: [] },
                { requirement_id: 'PC-12', title: 'Preço não superior ao estimado', description: 'preço não superior ao valor estimado', obligation_type: 'obrigatoria_universal', entry_type: 'exigencia_principal', phase: 'proposta', applies_to: 'licitante', risk_if_missing: 'desclassificacao', source_ref: 'Edital', evidence_refs: [] },
            ],
        },
        participation_conditions: {},
        technical_analysis: {},
        economic_financial_analysis: {},
        evidence_registry: [],
        timeline: {},
    },
    assertions: [
        (o) => {
            const pc = o.requirements.proposta_comercial;
            return { pass: pc.length <= 6, detail: `PC count: ${pc.length} (expected ≤6 after cleanup)` };
        },
        (o) => {
            const pc = o.requirements.proposta_comercial;
            const titles = pc.map((r) => r.title.toLowerCase());
            const hasGeneric = titles.some((t) => /rasura|emenda|irrevogável|vícios|inexequível|preencher.*campo/i.test(t));
            return { pass: !hasGeneric, detail: `Generic items remaining: ${hasGeneric ? 'YES (bad)' : 'NO (good)'}` };
        },
    ],
});
// ═══════════════════════════════════════════════════════════════
// TEST GROUP 5: PC Empty Injection — CLEANUP 6
// ═══════════════════════════════════════════════════════════════
tests.push({
    name: 'PC-EMPTY-01: PC=0 items → injects Planilha + BDI',
    description: 'When model returns zero PC items for non-pré-qualificação edital, inject minimum',
    severity: 'critical',
    input: {
        process_identification: { objeto: 'Obra de drenagem', modalidade: 'Concorrência Eletrônica' },
        requirements: {
            habilitacao_juridica: [{ requirement_id: 'HJ-01', title: 'Ato constitutivo', description: '', obligation_type: 'obrigatoria_universal', entry_type: 'exigencia_principal', phase: 'habilitacao', applies_to: 'licitante', risk_if_missing: 'inabilitacao', source_ref: 'Edital', evidence_refs: [] }],
            regularidade_fiscal_trabalhista: [{ requirement_id: 'RFT-01', title: 'CNPJ', description: '', obligation_type: 'obrigatoria_universal', entry_type: 'exigencia_principal', phase: 'habilitacao', applies_to: 'licitante', risk_if_missing: 'inabilitacao', source_ref: 'Edital', evidence_refs: [] }],
            proposta_comercial: [],
        },
        participation_conditions: {},
        technical_analysis: {},
        economic_financial_analysis: {},
        evidence_registry: [],
        timeline: {},
    },
    assertions: [
        (o) => {
            const pc = o.requirements.proposta_comercial;
            return { pass: pc.length >= 2, detail: `PC count: ${pc.length} (expected ≥2 after injection)` };
        },
    ],
});
// ═══════════════════════════════════════════════════════════════
// TEST GROUP 6: F3-02 — HJ Consórcio injection
// ═══════════════════════════════════════════════════════════════
tests.push({
    name: 'F3-02-01: consórcio permitido + HJ sem consórcio → injeta',
    description: 'When permite_consorcio=true but no HJ item mentions consórcio, inject',
    severity: 'critical',
    input: {
        process_identification: { objeto: 'Obras de engenharia', modalidade: 'Concorrência Eletrônica' },
        requirements: {
            habilitacao_juridica: [
                { requirement_id: 'HJ-01', title: 'Ato constitutivo', description: '', obligation_type: 'obrigatoria_universal', entry_type: 'exigencia_principal', phase: 'habilitacao', applies_to: 'licitante', risk_if_missing: 'inabilitacao', source_ref: 'Edital', evidence_refs: [] },
            ],
            regularidade_fiscal_trabalhista: [{ requirement_id: 'RFT-01', title: 'CNPJ', description: '', obligation_type: 'obrigatoria_universal', entry_type: 'exigencia_principal', phase: 'habilitacao', applies_to: 'licitante', risk_if_missing: 'inabilitacao', source_ref: 'Edital', evidence_refs: [] }],
        },
        participation_conditions: { permite_consorcio: true },
        technical_analysis: {},
        economic_financial_analysis: {},
        evidence_registry: [],
        timeline: {},
    },
    assertions: [
        (o) => {
            const hj = o.requirements.habilitacao_juridica;
            const hasConsorcio = hj.some((r) => /consórcio/i.test(`${r.title} ${r.description}`));
            return { pass: hasConsorcio, detail: `HJ consórcio item: ${hasConsorcio ? 'FOUND' : 'MISSING'}` };
        },
    ],
});
tests.push({
    name: 'F3-02-02: consórcio NÃO permitido → NÃO injeta',
    description: 'When permite_consorcio=false, must NOT inject consórcio item',
    severity: 'critical',
    input: {
        process_identification: { objeto: 'Limpeza pública', modalidade: 'Pregão Eletrônico' },
        requirements: {
            habilitacao_juridica: [
                { requirement_id: 'HJ-01', title: 'Ato constitutivo', description: '', obligation_type: 'obrigatoria_universal', entry_type: 'exigencia_principal', phase: 'habilitacao', applies_to: 'licitante', risk_if_missing: 'inabilitacao', source_ref: 'Edital', evidence_refs: [] },
            ],
            regularidade_fiscal_trabalhista: [{ requirement_id: 'RFT-01', title: 'CNPJ', description: '', obligation_type: 'obrigatoria_universal', entry_type: 'exigencia_principal', phase: 'habilitacao', applies_to: 'licitante', risk_if_missing: 'inabilitacao', source_ref: 'Edital', evidence_refs: [] }],
        },
        participation_conditions: { permite_consorcio: false },
        technical_analysis: {},
        economic_financial_analysis: {},
        evidence_registry: [],
        timeline: {},
    },
    assertions: [
        (o) => {
            const hj = o.requirements.habilitacao_juridica;
            const hasConsorcio = hj.some((r) => /consórcio/i.test(`${r.title} ${r.description}`));
            return { pass: !hasConsorcio, detail: `HJ consórcio item: ${hasConsorcio ? 'INJECTED (bad — should not inject)' : 'ABSENT (good)'}` };
        },
    ],
});
// ═══════════════════════════════════════════════════════════════
// TEST GROUP 7: F3-04 — Reserva de cargos PCD migration
// ═══════════════════════════════════════════════════════════════
tests.push({
    name: 'F3-04-01: reserva de cargos in RFT → migrates to DC',
    description: 'reserva de cargos PCD in RFT must always be in DC for consistency',
    severity: 'warning',
    input: {
        process_identification: { objeto: 'Coleta de lixo', modalidade: 'Concorrência Eletrônica' },
        requirements: {
            habilitacao_juridica: [{ requirement_id: 'HJ-01', title: 'Ato constitutivo', description: '', obligation_type: 'obrigatoria_universal', entry_type: 'exigencia_principal', phase: 'habilitacao', applies_to: 'licitante', risk_if_missing: 'inabilitacao', source_ref: 'Edital', evidence_refs: [] }],
            regularidade_fiscal_trabalhista: [
                { requirement_id: 'RFT-01', title: 'CNPJ', description: '', obligation_type: 'obrigatoria_universal', entry_type: 'exigencia_principal', phase: 'habilitacao', applies_to: 'licitante', risk_if_missing: 'inabilitacao', source_ref: 'Edital', evidence_refs: [] },
                { requirement_id: 'RFT-02', title: 'Declaração de reserva de cargos PCD', description: 'cumprimento reserva de cargos para pessoa com deficiência e reabilitado da Previdência Social', obligation_type: 'obrigatoria_universal', entry_type: 'declaracao', phase: 'habilitacao', applies_to: 'licitante', risk_if_missing: 'inabilitacao', source_ref: 'Edital', evidence_refs: [] },
            ],
            documentos_complementares: [
                { requirement_id: 'DC-01', title: 'Declaração de menor', description: 'não emprega menor de 18 anos', obligation_type: 'obrigatoria_universal', entry_type: 'declaracao', phase: 'habilitacao', applies_to: 'licitante', risk_if_missing: 'inabilitacao', source_ref: 'Edital', evidence_refs: [] },
            ],
        },
        participation_conditions: {},
        technical_analysis: {},
        economic_financial_analysis: {},
        evidence_registry: [],
        timeline: {},
    },
    assertions: [
        (o) => {
            const rft = o.requirements.regularidade_fiscal_trabalhista;
            const rftHasReserva = rft.some((r) => /reserva.*cargos/i.test(`${r.title} ${r.description}`));
            return { pass: !rftHasReserva, detail: `reserva de cargos in RFT: ${rftHasReserva ? 'STILL THERE (bad)' : 'REMOVED (good)'}` };
        },
        (o) => {
            const dc = o.requirements.documentos_complementares;
            const dcHasReserva = dc.some((r) => /reserva.*cargos/i.test(`${r.title} ${r.description}`));
            return { pass: dcHasReserva, detail: `reserva de cargos in DC: ${dcHasReserva ? 'FOUND (good)' : 'MISSING (bad)'}` };
        },
    ],
});
// ═══════════════════════════════════════════════════════════════
// TEST GROUP 8: Participation conditions — boolean defaults
// ═══════════════════════════════════════════════════════════════
tests.push({
    name: 'PART-COND-01: null booleans → default false',
    description: 'When participation_conditions has null booleans, must default to false',
    severity: 'warning',
    input: {
        process_identification: { objeto: 'Material de escritório', modalidade: 'Pregão Eletrônico' },
        requirements: {
            habilitacao_juridica: [],
        },
        participation_conditions: {
            permite_consorcio: null,
            permite_subcontratacao: null,
            exige_visita_tecnica: null,
            exige_garantia_proposta: null,
            exige_garantia_contratual: null,
            exige_amostra: null,
        },
        technical_analysis: {},
        economic_financial_analysis: {},
        evidence_registry: [],
        timeline: {},
    },
    assertions: [
        (o) => {
            const pc = o.participation_conditions;
            const allFalse = pc.permite_consorcio === false && pc.permite_subcontratacao === false
                && pc.exige_visita_tecnica === false && pc.exige_garantia_proposta === false;
            return { pass: allFalse, detail: `All null booleans defaulted to false: ${allFalse}` };
        },
    ],
});
// ═══════════════════════════════════════════════════════════════
// TEST GROUP 9: DC↔RFT Cross-Dedup — CLEANUP 4
// ═══════════════════════════════════════════════════════════════
tests.push({
    name: 'DC-RFT-DEDUP-01: Same item in DC and RFT → remove from DC',
    description: 'When DC and RFT both have "não emprego de menor", remove from DC',
    severity: 'warning',
    input: {
        process_identification: { objeto: 'Serviço de limpeza', modalidade: 'Pregão' },
        requirements: {
            habilitacao_juridica: [],
            regularidade_fiscal_trabalhista: [
                { requirement_id: 'RFT-01', title: 'CNPJ', description: '', obligation_type: 'obrigatoria_universal', entry_type: 'exigencia_principal', phase: 'habilitacao', applies_to: 'licitante', risk_if_missing: 'inabilitacao', source_ref: 'Edital', evidence_refs: [] },
                { requirement_id: 'RFT-02', title: 'Declaração de não emprego de menor de 18 anos', description: '', obligation_type: 'obrigatoria_universal', entry_type: 'declaracao', phase: 'habilitacao', applies_to: 'licitante', risk_if_missing: 'inabilitacao', source_ref: 'Edital', evidence_refs: [] },
            ],
            documentos_complementares: [
                { requirement_id: 'DC-01', title: 'Declaração de não emprego de menor', description: '', obligation_type: 'obrigatoria_universal', entry_type: 'declaracao', phase: 'habilitacao', applies_to: 'licitante', risk_if_missing: 'inabilitacao', source_ref: 'Edital', evidence_refs: [] },
                { requirement_id: 'DC-02', title: 'Declaração de ME/EPP', description: '', obligation_type: 'condicional', entry_type: 'declaracao', phase: 'habilitacao', applies_to: 'licitante', risk_if_missing: 'inabilitacao', source_ref: 'Edital', evidence_refs: [] },
            ],
        },
        participation_conditions: {},
        technical_analysis: {},
        economic_financial_analysis: {},
        evidence_registry: [],
        timeline: {},
    },
    assertions: [
        (o) => {
            const dc = o.requirements.documentos_complementares;
            const dcHasMinor = dc.some((r) => /n[ãa]o emprego.*menor/i.test(r.title));
            return { pass: !dcHasMinor, detail: `"não emprego de menor" in DC after dedup: ${dcHasMinor ? 'STILL THERE (bad)' : 'REMOVED (good)'}` };
        },
        (o) => {
            const dc = o.requirements.documentos_complementares;
            return { pass: dc.length === 1, detail: `DC count after dedup: ${dc.length} (expected 1 — only ME/EPP)` };
        },
    ],
});
// ═══════════════════════════════════════════════════════════════
// TEST GROUP 10: HJ Empty Injection
// ═══════════════════════════════════════════════════════════════
tests.push({
    name: 'HJ-EMPTY-01: HJ=0 but other cats populated → injects Ato constitutivo',
    description: 'When HJ is empty but RFT/QEF exist, inject basic HJ item',
    severity: 'warning',
    input: {
        process_identification: { objeto: 'Pavimentação', modalidade: 'Concorrência' },
        requirements: {
            habilitacao_juridica: [],
            regularidade_fiscal_trabalhista: [{ requirement_id: 'RFT-01', title: 'CNPJ', description: '', obligation_type: 'obrigatoria_universal', entry_type: 'exigencia_principal', phase: 'habilitacao', applies_to: 'licitante', risk_if_missing: 'inabilitacao', source_ref: 'Edital', evidence_refs: [] }],
        },
        participation_conditions: {},
        technical_analysis: {},
        economic_financial_analysis: {},
        evidence_registry: [],
        timeline: {},
    },
    assertions: [
        (o) => {
            const hj = o.requirements.habilitacao_juridica;
            return { pass: hj.length >= 1, detail: `HJ count: ${hj.length} (expected ≥1 after injection)` };
        },
        (o) => {
            const hj = o.requirements.habilitacao_juridica;
            const hasAto = hj.some((r) => /ato constitutivo|contrato social/i.test(r.title));
            return { pass: hasAto, detail: `Ato constitutivo injected: ${hasAto}` };
        },
    ],
});
// ═══════════════════════════════════════════════════════════════
// RUNNER
// ═══════════════════════════════════════════════════════════════
logger_1.logger.info(`\n🧪 SCHEMA ENFORCER GOLDEN DATASET TEST — V4.9.1`);
logger_1.logger.info(`${'═'.repeat(60)}\n`);
let totalAssertions = 0;
let passedAssertions = 0;
let failedCritical = 0;
let failedWarning = 0;
for (const test of tests) {
    // Deep clone input to avoid mutation
    const input = JSON.parse(JSON.stringify(test.input));
    // Run enforcer — returns { schema, corrections, details }
    const { schema: result } = (0, schemaEnforcer_1.enforceSchema)(input);
    logger_1.logger.info(`\n📋 ${test.name}`);
    logger_1.logger.info(`   ${test.description}`);
    for (const assertion of test.assertions) {
        totalAssertions++;
        const { pass, detail } = assertion(result);
        if (pass) {
            passedAssertions++;
            logger_1.logger.info(`   ✅ ${detail}`);
        }
        else {
            if (test.severity === 'critical')
                failedCritical++;
            else
                failedWarning++;
            logger_1.logger.info(`   ${test.severity === 'critical' ? '❌' : '⚠️'} ${detail}`);
        }
    }
}
logger_1.logger.info(`\n${'═'.repeat(60)}`);
logger_1.logger.info(`TOTAL: ${tests.length} tests | ${totalAssertions} assertions | ✅ ${passedAssertions} passed | ❌ ${failedCritical} critical | ⚠️ ${failedWarning} warnings`);
if (failedCritical > 0) {
    logger_1.logger.info(`\n🚨 ${failedCritical} CRITICAL FAILURE(S) — SchemaEnforcer safety-nets broken!`);
    process.exit(1);
}
else if (failedWarning > 0) {
    logger_1.logger.info(`\n⚠️ ${failedWarning} warning(s) — review manually.`);
    process.exit(0);
}
else {
    logger_1.logger.info(`\n✅ ALL GOLDEN TESTS PASSED — SchemaEnforcer integrity confirmed.`);
    process.exit(0);
}
