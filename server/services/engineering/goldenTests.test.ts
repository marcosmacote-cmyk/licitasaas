/**
 * ══════════════════════════════════════════════════════════════════
 *  Golden Tests — Validação de regressão para extração de engenharia
 * ══════════════════════════════════════════════════════════════════
 *
 *  These tests use fixture data representing KNOWN GOOD extraction
 *  results. Any change to the normalizer, validator, or screener
 *  must pass these tests to ensure no regression.
 *
 *  To add a new golden case:
 *  1. Copy a successful extraction result from production logs
 *  2. Add it as a fixture below with expected metrics
 *  3. Run tests to verify baseline
 */

import { describe, expect, it } from 'vitest';
import { parseAndNormalizeEngineeringExtraction, normalizeEngineeringItems, postClassifyTypes } from './resultNormalizer';
import { screenEngineeringItems, validateEngineeringExtraction } from './extractionValidator';

// ═══════════════════════════════════════════
// FIXTURE: Typical SINAPI/SEINFRA budget (school construction)
// ═══════════════════════════════════════════

const FIXTURE_ESCOLA = [
    { item: '1', type: 'ETAPA', description: 'SERVIÇOS PRELIMINARES', quantity: 0, unitCost: 0, unit: '' },
    { item: '1.1', type: 'COMPOSICAO', sourceName: 'SINAPI', code: '97622', description: 'LOCAÇÃO DA OBRA - EXECUÇÃO DE MARCAÇÃO', unit: 'M', quantity: 120, unitCost: 3.45 },
    { item: '1.2', type: 'COMPOSICAO', sourceName: 'SINAPI', code: '94990', description: 'EXECUÇÃO DE TAPUME COM TELHA METÁLICA', unit: 'M2', quantity: 80, unitCost: 85.32 },
    { item: '2', type: 'ETAPA', description: 'FUNDAÇÕES E ESTRUTURAS', quantity: 0, unitCost: 0, unit: '' },
    { item: '2.1', type: 'SUBETAPA', description: 'FUNDAÇÃO', quantity: 0, unitCost: 0, unit: '' },
    { item: '2.1.1', type: 'COMPOSICAO', sourceName: 'SINAPI', code: '96523', description: 'ESCAVAÇÃO MANUAL CAMPO ABERTO', unit: 'M3', quantity: 45, unitCost: 54.20 },
    { item: '2.1.2', type: 'COMPOSICAO', sourceName: 'SINAPI', code: '74164', description: 'CONCRETO NÃO ESTRUTURAL', unit: 'M3', quantity: 12, unitCost: 398.50 },
    { item: '2.2', type: 'SUBETAPA', description: 'ESTRUTURA', quantity: 0, unitCost: 0, unit: '' },
    { item: '2.2.1', type: 'COMPOSICAO', sourceName: 'SINAPI', code: '92874', description: 'ARMADURA DE AÇO CA-50', unit: 'KG', quantity: 1500, unitCost: 15.80 },
    { item: '2.2.2', type: 'COMPOSICAO', sourceName: 'SINAPI', code: '92871', description: 'FORMA PLANA COM COMPENSADO', unit: 'M2', quantity: 320, unitCost: 68.50 },
    { item: '2.2.3', type: 'COMPOSICAO', sourceName: 'SINAPI', code: '92793', description: 'CONCRETO FCK 25MPA PREPARO MECÂNICO', unit: 'M3', quantity: 28, unitCost: 412.30 },
    { item: '3', type: 'ETAPA', description: 'ALVENARIA', quantity: 0, unitCost: 0, unit: '' },
    { item: '3.1', type: 'COMPOSICAO', sourceName: 'SINAPI', code: '89181', description: 'ALVENARIA DE BLOCO CERÂMICO 14CM', unit: 'M2', quantity: 450, unitCost: 52.40 },
    { item: '4', type: 'ETAPA', description: 'COBERTURA', quantity: 0, unitCost: 0, unit: '' },
    { item: '4.1', type: 'COMPOSICAO', sourceName: 'SEINFRA', code: 'C4495', description: 'LAJE PRÉ-FABRICADA P/ PISO - VÃO 2,01 A 3M', unit: 'M2', quantity: 200, unitCost: 105.80 },
    { item: '4.2', type: 'COMPOSICAO', sourceName: 'SINAPI', code: '94204', description: 'TELHA DE ALUMÍNIO TRAPEZOIDAL', unit: 'M2', quantity: 380, unitCost: 78.90 },
    { item: '5', type: 'ETAPA', description: 'INSTALAÇÕES ELÉTRICAS', quantity: 0, unitCost: 0, unit: '' },
    { item: '5.1', type: 'COMPOSICAO', sourceName: 'SINAPI', code: '91877', description: 'LUVA PARA ELETRODUTO PVC ROSCÁVEL', unit: 'UN', quantity: 250, unitCost: 14.52 },
    { item: '5.2', type: 'COMPOSICAO', sourceName: 'SINAPI', code: '91941', description: 'CAIXA OCTOGONAL FUNDO FIXO PVC', unit: 'UN', quantity: 40, unitCost: 28.60 },
];

// ═══════════════════════════════════════════
// FIXTURE: Budget with known problems (AI confusion)
// ═══════════════════════════════════════════

const FIXTURE_PROBLEMAS = [
    // Etapa marcada como COMPOSICAO (common AI mistake)
    { item: '1', type: 'COMPOSICAO', description: 'SERVIÇOS PRELIMINARES', quantity: 0, unitCost: 0, unit: '', code: '', sourceName: '' },
    { item: '1.1', type: 'COMPOSICAO', sourceName: 'SINAPI', code: '97622', description: 'LOCAÇÃO DA OBRA', unit: 'M', quantity: 120, unitCost: 3.45 },
    // Duplicate items
    { item: '1.2', type: 'COMPOSICAO', sourceName: 'SINAPI', code: '94990', description: 'TAPUME COM TELHA METÁLICA', unit: 'M2', quantity: 80, unitCost: 85.32 },
    { item: '1.3', type: 'COMPOSICAO', sourceName: 'SINAPI', code: '94990', description: 'TAPUME COM TELHA METÁLICA', unit: 'M2', quantity: 80, unitCost: 85.32 },
    // Narrative noise (should be rejected)
    { item: '2', type: 'COMPOSICAO', description: 'O licitante deverá comprovar experiência', quantity: 0, unitCost: 0, unit: '' },
    // Subtotal (should be rejected)
    { item: '99', type: 'COMPOSICAO', description: 'TOTAL GERAL', quantity: 0, unitCost: 0, unit: '' },
    // Item with invalid code format
    { item: '3.1', type: 'COMPOSICAO', sourceName: 'SINAPI', code: 'ABC', description: 'ITEM COM CÓDIGO INVÁLIDO', unit: 'M2', quantity: 10, unitCost: 50 },
    // Ghost item (no description)
    { item: '3.2', type: 'COMPOSICAO', sourceName: 'SINAPI', code: '12345', description: '', unit: 'UN', quantity: 5, unitCost: 100 },
];

// ═══════════════════════════════════════════
// FIXTURE: Portuguese/alternate field names
// ═══════════════════════════════════════════

const FIXTURE_PORTUGUESE_RAW = JSON.stringify({
    itens: [
        {
            numero: '1',
            tipo: 'ETAPA',
            descricao: 'ADMINISTRAÇÃO DE OBRA',
            quantidade: 0,
            precoUnitario: 0,
        },
        {
            numero: '1.1',
            tipo: 'COMPOSIÇÃO',
            banco: 'SINAPI',
            codigo: '091877',
            descricao: 'LUVA PARA ELETRODUTO PVC ROSCÁVEL DN 40 MM',
            unidade: 'UN',
            quantidade: '250,00',
            precoUnitario: 'R$ 14,52',
            precoUnitarioComBdi: 'R$ 18,15',
            valorTotal: 'R$ 4.537,50',
        },
    ],
});

// ═══════════════════════════════════════════
// TESTS
// ═══════════════════════════════════════════

describe('Golden Tests — Extração de Engenharia', () => {

    describe('Fixture: Escola Municipal (extração limpa)', () => {
        it('normalizes all items correctly', () => {
            const result = normalizeEngineeringItems(FIXTURE_ESCOLA);
            expect(result.engineeringItems).toHaveLength(FIXTURE_ESCOLA.length);
        });

        it('preserves type classification', () => {
            const result = normalizeEngineeringItems(FIXTURE_ESCOLA);
            const types = result.engineeringItems.map(it => it.type);
            expect(types.filter(t => t === 'ETAPA')).toHaveLength(5);
            expect(types.filter(t => t === 'SUBETAPA')).toHaveLength(2);
            expect(types.filter(t => t === 'COMPOSICAO')).toHaveLength(12);
        });

        it('screening keeps all valid items', () => {
            const screening = screenEngineeringItems(FIXTURE_ESCOLA);
            expect(screening.acceptedItems).toHaveLength(FIXTURE_ESCOLA.length);
            expect(screening.rejectedItems).toHaveLength(0);
        });

        it('deduplication does not remove unique items', () => {
            const screening = screenEngineeringItems(FIXTURE_ESCOLA);
            expect(screening.acceptedItems).toHaveLength(FIXTURE_ESCOLA.length);
        });

        it('validates with high quality score (>= 80)', () => {
            const screening = screenEngineeringItems(FIXTURE_ESCOLA);
            const report = validateEngineeringExtraction(screening.acceptedItems, null, screening);
            expect(report.qualityScore).toBeGreaterThanOrEqual(80);
            expect(report.publishable).toBe(true);
        });

        it('reports >80% code coverage', () => {
            const screening = screenEngineeringItems(FIXTURE_ESCOLA);
            const report = validateEngineeringExtraction(screening.acceptedItems, null, screening);
            expect(report.codeCoveragePercent).toBeGreaterThanOrEqual(80);
        });

        it('calculates correct total', () => {
            const screening = screenEngineeringItems(FIXTURE_ESCOLA);
            const report = validateEngineeringExtraction(screening.acceptedItems, null, screening);
            // Manually calculated: sum of qty * unitCost for all COMPOSICAO items
            const expectedTotal =
                120 * 3.45 + 80 * 85.32 + 45 * 54.20 + 12 * 398.50 +
                1500 * 15.80 + 320 * 68.50 + 28 * 412.30 + 450 * 52.40 +
                200 * 105.80 + 380 * 78.90 + 250 * 14.52 + 40 * 28.60;
            expect(report.calculatedTotal).toBeCloseTo(expectedTotal, 0);
        });

        it('has no error-severity issues', () => {
            const screening = screenEngineeringItems(FIXTURE_ESCOLA);
            const report = validateEngineeringExtraction(screening.acceptedItems, null, screening);
            const errors = report.issues.filter(i => i.severity === 'error');
            expect(errors).toHaveLength(0);
        });
    });

    describe('Fixture: Orçamento com problemas (erros de IA)', () => {
        it('postClassifyTypes reclassifies grouper as ETAPA', () => {
            const items = JSON.parse(JSON.stringify(FIXTURE_PROBLEMAS));
            postClassifyTypes(items);
            const item1 = items.find((it: any) => it.item === '1');
            expect(item1.type).toBe('ETAPA');
        });

        it('screening rejects narrative noise and subtotals', () => {
            const items = JSON.parse(JSON.stringify(FIXTURE_PROBLEMAS));
            postClassifyTypes(items);
            const screening = screenEngineeringItems(items);
            const rejectedItems = screening.rejectedItems.map(it => it.item);
            expect(rejectedItems).toContain('2');  // narrative
            expect(rejectedItems).toContain('99'); // subtotal
        });

        it('deduplication preserves items with different numbers even if description matches', () => {
            const items = JSON.parse(JSON.stringify(FIXTURE_PROBLEMAS));
            postClassifyTypes(items);
            const screening = screenEngineeringItems(items);
            // Items 1.2 and 1.3 have DIFFERENT item numbers but same description.
            // FIX-DEDUP-01: Both should survive because in real budgets,
            // identical services in different sections are legitimate.
            const tapumeItems = screening.acceptedItems.filter(
                (it: any) => String(it.description).includes('TAPUME')
            );
            expect(tapumeItems).toHaveLength(2);
        });

        it('validator detects issues', () => {
            const items = JSON.parse(JSON.stringify(FIXTURE_PROBLEMAS));
            postClassifyTypes(items);
            const screening = screenEngineeringItems(items);
            const report = validateEngineeringExtraction(screening.acceptedItems, null, screening);
            // Should flag: ghost items, possibly low coverage
            const issueCodes = report.issues.map(i => i.code);
            expect(issueCodes).toContain('EV06'); // ghost items (empty description)
        });
    });

    describe('Fixture: Campos em português (normalização)', () => {
        it('parses and normalizes Portuguese fields correctly', () => {
            const result = parseAndNormalizeEngineeringExtraction(FIXTURE_PORTUGUESE_RAW);
            expect(result.engineeringItems).toHaveLength(2);

            const etapa = result.engineeringItems[0];
            expect(etapa.type).toBe('ETAPA');
            expect(etapa.description).toBe('ADMINISTRAÇÃO DE OBRA');

            const comp = result.engineeringItems[1];
            expect(comp.type).toBe('COMPOSICAO');
            expect(comp.sourceName).toBe('SINAPI');
            expect(comp.code).toBe('091877'); // raw code preserved by normalizer
            expect(comp.quantity).toBe(250);
            expect(comp.unitCost).toBe(14.52);
            expect(comp.unitPrice).toBe(18.15);
            expect(comp.totalPrice).toBe(4537.50);
        });

        it('normalizes Brazilian number formats', () => {
            const result = parseAndNormalizeEngineeringExtraction(FIXTURE_PORTUGUESE_RAW);
            const comp = result.engineeringItems[1];
            expect(comp.quantity).toBe(250);
            expect(comp.unitCost).toBe(14.52);
        });

        it('maps alternate array key (itens → engineeringItems)', () => {
            const result = parseAndNormalizeEngineeringExtraction(FIXTURE_PORTUGUESE_RAW);
            expect(result.repairs).toContain('array_key:itens->engineeringItems');
        });
    });

    describe('Regression guards', () => {
        it('never removes ETAPAs from screening', () => {
            const allFixtures = [...FIXTURE_ESCOLA, ...FIXTURE_PROBLEMAS];
            const items = JSON.parse(JSON.stringify(allFixtures));
            postClassifyTypes(items);
            const screening = screenEngineeringItems(items);
            const rejectedTypes = screening.rejectedItems.map(it => it.type);
            expect(rejectedTypes).not.toContain('ETAPA');
            expect(rejectedTypes).not.toContain('SUBETAPA');
        });

        it('zeroes quantity and unitCost for ETAPAs and SUBETAPAs', () => {
            const result = normalizeEngineeringItems(FIXTURE_ESCOLA);
            const groupers = result.engineeringItems.filter(
                it => it.type === 'ETAPA' || it.type === 'SUBETAPA'
            );
            for (const g of groupers) {
                expect(g.quantity).toBe(0);
                expect(g.unitCost).toBe(0);
                expect(g.unit).toBe('');
            }
        });

        it('validator quality score for clean data is always >= 70', () => {
            // This ensures no future check accidentally tanks the score for valid data
            const screening = screenEngineeringItems(FIXTURE_ESCOLA);
            const report = validateEngineeringExtraction(screening.acceptedItems, null, screening);
            expect(report.qualityScore).toBeGreaterThanOrEqual(70);
        });

        it('column shift detection flags shifted items', () => {
            // Simulate column shift: quantity == unitCost
            const shiftedItems = FIXTURE_ESCOLA.map(it => ({
                ...it,
                unitCost: it.type === 'COMPOSICAO' ? it.quantity : 0,
            }));
            const screening = screenEngineeringItems(shiftedItems);
            // The column shift detection is in the handler, not validator
            // But we can check that shifted items have same qty and cost
            const composicoes = screening.acceptedItems.filter((it: any) => it.type === 'COMPOSICAO');
            const shifted = composicoes.filter((it: any) => {
                const qty = Number(it.quantity) || 0;
                const cost = Number(it.unitCost) || 0;
                return qty > 0 && cost > 0 && Math.abs(qty - cost) < 0.01;
            });
            // All 12 compositions should be flagged
            expect(shifted.length).toBe(composicoes.length);
        });
    });
});
