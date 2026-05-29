import { describe, expect, test } from 'vitest';
import { calculateBdiTCU, autoDistributeBdi, type BdiTcuParams } from './bdiEngine';

describe('bdiEngine — Cálculo de BDI TCU 2622/2013', () => {
    test('Calcula BDI corretamente com regime Onerado (sem CPRB, com CSLL)', () => {
        const params: BdiTcuParams = {
            adminCentral: 4.00,
            seguros: 0.80,
            garantias: 0.80,
            riscos: 0.97,
            despFinanceiras: 0.59,
            lucro: 6.16,
            pis: 0.65,
            cofins: 3.00,
            iss: 2.00,
            csll: 1.00,
            cprb: 0.00
        };
        const bdi = calculateBdiTCU(params);
        expect(bdi).toBeCloseTo(21.91, 1);
    });

    test('Calcula BDI corretamente com regime Desonerado (com CPRB, sem CSLL)', () => {
        const params: BdiTcuParams = {
            adminCentral: 4.00,
            seguros: 0.80,
            garantias: 0.80,
            riscos: 0.97,
            despFinanceiras: 0.59,
            lucro: 6.16,
            pis: 0.65,
            cofins: 3.00,
            iss: 2.00,
            csll: 0.00,
            cprb: 4.50
        };
        const bdi = calculateBdiTCU(params);
        expect(bdi).toBeCloseTo(26.66, 1);
    });

    // FIX STAB: Tributos somando 100% — divisão por zero → retorna 0
    test('Tributos somando 100% → retorna 0 (não Infinity)', () => {
        const params: BdiTcuParams = {
            adminCentral: 4.00, seguros: 0.80, garantias: 0.80,
            riscos: 0.97, despFinanceiras: 0.59, lucro: 6.16,
            pis: 20, cofins: 30, iss: 50, csll: 0, cprb: 0 // soma = 100%
        };
        const bdi = calculateBdiTCU(params);
        expect(bdi).toBe(0);
        expect(Number.isFinite(bdi)).toBe(true);
    });

    // FIX STAB: Tributos somando > 100% → retorna 0
    test('Tributos somando > 100% → retorna 0', () => {
        const params: BdiTcuParams = {
            adminCentral: 0, seguros: 0, garantias: 0, riscos: 0,
            despFinanceiras: 0, lucro: 0,
            pis: 50, cofins: 50, iss: 10, csll: 0, cprb: 0 // soma = 110%
        };
        expect(calculateBdiTCU(params)).toBe(0);
    });

    // FIX STAB-01: Valores negativos sanitizados para 0
    test('Valores negativos sanitizados para 0', () => {
        const params: BdiTcuParams = {
            adminCentral: -5, seguros: -2, garantias: 0, riscos: 0,
            despFinanceiras: 0, lucro: 10,
            pis: 0.65, cofins: 3.00, iss: -2.00, csll: 0, cprb: 0
        };
        const bdi = calculateBdiTCU(params);
        expect(Number.isFinite(bdi)).toBe(true);
        expect(bdi).toBeGreaterThanOrEqual(0);
        // Com negativos clampeados para 0: AC=0, S=0, I=PIS+COFINS+0=3.65%
        // BDI = ((1+0)*(1+0)*(1+0.10) / (1-0.0365) - 1) * 100
        // = (1.10 / 0.9635 - 1) * 100 ≈ 14.17%
        expect(bdi).toBeCloseTo(14.17, 0);
    });

    // FIX STAB: NaN em params → não produz NaN
    test('NaN em params → sanitizados, não produz NaN', () => {
        const params: BdiTcuParams = {
            adminCentral: NaN, seguros: 0, garantias: 0, riscos: 0,
            despFinanceiras: 0, lucro: 0,
            pis: 0, cofins: 0, iss: 0, csll: 0, cprb: 0
        };
        const bdi = calculateBdiTCU(params);
        expect(Number.isFinite(bdi)).toBe(true);
        expect(bdi).toBe(0); // Todos zero → BDI = 0
    });

    test('autoDistributeBdi inicializa cprb: 0', () => {
        const target = 25.00;
        const res = autoDistributeBdi(target);
        expect(res.cprb).toBe(0);
        expect(res.lucro).toBeGreaterThan(0);
    });

    // FIX STAB: autoDistributeBdi com alvo 0%
    test('autoDistributeBdi com BDI alvo 0% → lucro = 0', () => {
        const res = autoDistributeBdi(0);
        expect(res.lucro).toBe(0);
    });

    // FIX STAB: autoDistributeBdi com alvo 50%
    test('autoDistributeBdi com BDI alvo 50% → lucro calculado positivo', () => {
        const res = autoDistributeBdi(50);
        expect(res.lucro).toBeGreaterThan(0);
        // Verify the distributed BDI produces close to the target
        const bdi = calculateBdiTCU(res);
        expect(bdi).toBeCloseTo(50, 0);
    });
});

