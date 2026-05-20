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
        // Fórmula TCU:
        // AC=4.00%, S=0.80%, G=0.80%, R=0.97% -> sum = 6.57% -> 1.0657
        // DF=0.59% -> 1.0059
        // L=6.16% -> 1.0616
        // I = PIS + COFINS + ISS + CSLL + CPRB = 0.65 + 3.00 + 2.00 + 1.00 + 0 = 6.65% -> 0.0665 -> 1 - I = 0.9335
        // BDI = ((1.0657 * 1.0059 * 1.0616) / 0.9335 - 1) * 100
        // = (1.138027 / 0.9335 - 1) * 100 = (1.219097 - 1) * 100 = 21.91%
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
        // I = PIS + COFINS + ISS + CSLL + CPRB = 0.65 + 3.00 + 2.00 + 0.00 + 4.50 = 10.15% -> 0.1015 -> 1 - I = 0.8985
        // BDI = ((1.0657 * 1.0059 * 1.0616) / 0.8985 - 1) * 100
        // = (1.138027 / 0.8985 - 1) * 100 = (1.266585 - 1) * 100 = 26.66%
        const bdi = calculateBdiTCU(params);
        expect(bdi).toBeCloseTo(26.66, 1);
    });

    test('autoDistributeBdi inicializa cprb: 0', () => {
        const target = 25.00;
        const res = autoDistributeBdi(target);
        expect(res.cprb).toBe(0);
        expect(res.lucro).toBeGreaterThan(0);
    });
});
