/**
 * ══════════════════════════════════════════════════════════
 *  Bidding Helpers — Tests
 *  Sprint 8.1 — Coverage for extracted normalization logic
 * ══════════════════════════════════════════════════════════
 */
import { describe, it, expect, vi } from 'vitest';

// Mock the logger 
vi.mock('./logger', () => ({
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

import {
    normalizeModality,
    normalizePortal,
    hasMonitorableDomain,
    detectPlatformFromLink,
    sanitizeBiddingData,
    MONITORABLE_DOMAINS,
    PLATFORM_DOMAINS,
} from './biddingHelpers';

// ── normalizeModality ─────────────────────────────────────

describe('normalizeModality', () => {
    it('should normalize pregão variants', () => {
        expect(normalizeModality('Pregão Eletrônico')).toBe('Pregão');
        expect(normalizeModality('pregão presencial')).toBe('Pregão');
        expect(normalizeModality('PREGÃO Nº 123/2024')).toBe('Pregão');
        expect(normalizeModality('Pregão Eletrônico - SRP')).toBe('Pregão');
        expect(normalizeModality('Pregão Eletrônico Nº 45/2024 - SISPP')).toBe('Pregão');
    });

    it('should normalize concorrência variants', () => {
        expect(normalizeModality('Concorrência')).toBe('Concorrência');
        expect(normalizeModality('Concorrência Eletrônica')).toBe('Concorrência');
        expect(normalizeModality('Tomada de Preços')).toBe('Concorrência');
        expect(normalizeModality('Convite')).toBe('Concorrência');
        expect(normalizeModality('RDC')).toBe('Concorrência');
    });

    it('should normalize contratação direta', () => {
        expect(normalizeModality('Dispensa de Licitação')).toBe('Dispensa');
        expect(normalizeModality('Inexigibilidade')).toBe('Inexigibilidade');
    });

    it('should normalize procedimentos auxiliares', () => {
        expect(normalizeModality('Credenciamento')).toBe('Procedimento Auxiliar');
        expect(normalizeModality('Pré-Qualificação')).toBe('Procedimento Auxiliar');
    });

    it('should handle empty/null inputs', () => {
        expect(normalizeModality('')).toBe('');
        expect(normalizeModality(null)).toBe('');
        expect(normalizeModality(undefined)).toBe('');
    });

    it('should strip Nº/numbers', () => {
        expect(normalizeModality('Licitação Eletrônica Nº 456/2025')).toBe('Pregão');
    });
});

// ── normalizePortal ───────────────────────────────────────

describe('normalizePortal', () => {
    it('should identify portals by name', () => {
        expect(normalizePortal('BLL Compras')).toBe('BLL');
        expect(normalizePortal('BBMNET')).toBe('BBMNET');
        expect(normalizePortal('M2A Tecnologia')).toBe('M2A');
        expect(normalizePortal('Portal de Compras Públicas')).toBe('Portal de Compras Públicas');
        expect(normalizePortal('Licita Mais Brasil')).toBe('Licita Mais Brasil');
    });

    it('should identify portals by link', () => {
        expect(normalizePortal('', 'https://bllcompras.com/Process')).toBe('BLL');
        expect(normalizePortal('', 'https://novabbmnet.com.br/app')).toBe('BBMNET');
        expect(normalizePortal('', 'https://compras.m2atecnologia.com.br')).toBe('M2A');
        expect(normalizePortal('', 'https://cnetmobile.estaleiro.serpro.gov.br')).toBe('Compras.gov.br');
        expect(normalizePortal('', 'https://pncp.gov.br/app/editais')).toBe('Compras.gov.br');
    });

    it('should identify Compras.gov.br variants', () => {
        expect(normalizePortal('ComprasNet')).toBe('Compras.gov.br');
        expect(normalizePortal('PNCP')).toBe('Compras.gov.br');
        expect(normalizePortal('Compras.gov.br')).toBe('Compras.gov.br');
    });

    it('should return "Não Informado" for empty inputs', () => {
        expect(normalizePortal('', null)).toBe('Não Informado');
        expect(normalizePortal('')).toBe('Não Informado');
    });
});

// ── hasMonitorableDomain ──────────────────────────────────

describe('hasMonitorableDomain', () => {
    it('should detect monitorable domains', () => {
        expect(hasMonitorableDomain('https://cnetmobile.estaleiro.serpro.gov.br')).toBe(true);
        expect(hasMonitorableDomain('https://bllcompras.com/Process')).toBe(true);
        expect(hasMonitorableDomain('https://novabbmnet.com.br')).toBe(true);
        expect(hasMonitorableDomain('https://licitamaisbrasil.com.br')).toBe(true);
        expect(hasMonitorableDomain('https://precodereferencia.com.br')).toBe(true);
    });

    it('should NOT match comprasnet (false positive)', () => {
        // comprasnet.gov.br is the OLD login portal, NOT monitorable
        expect(hasMonitorableDomain('https://www.comprasnet.gov.br/seguro/loginPortal.asp')).toBe(false);
    });

    it('should NOT match PNCP (repository, not platform)', () => {
        expect(hasMonitorableDomain('https://pncp.gov.br/app/editais')).toBe(false);
    });

    it('should NOT match empty links', () => {
        expect(hasMonitorableDomain('')).toBe(false);
    });
});

// ── detectPlatformFromLink ────────────────────────────────

describe('detectPlatformFromLink', () => {
    it('should detect platforms from links', () => {
        expect(detectPlatformFromLink('https://cnetmobile.estaleiro.serpro.gov.br')).toBe('Compras.gov.br');
        expect(detectPlatformFromLink('https://bllcompras.com/Process')).toBe('BLL');
        expect(detectPlatformFromLink('https://novabbmnet.com.br')).toBe('BBMNET');
        expect(detectPlatformFromLink('https://compras.m2atecnologia.com.br/certame/123')).toBe('M2A');
    });

    it('should return null for unknown domains', () => {
        expect(detectPlatformFromLink('https://unknown.com')).toBeNull();
        expect(detectPlatformFromLink('')).toBeNull();
    });
});

// ── sanitizeBiddingData ───────────────────────────────────

describe('sanitizeBiddingData', () => {
    it('should only keep allowed fields', () => {
        const result = sanitizeBiddingData({
            title: 'Test',
            status: 'Em Análise',
            maliciousField: 'drop table',
            __proto__: 'hack',
        });
        expect(result.title).toBe('Test');
        expect(result.status).toBe('Em Análise');
        expect(result.maliciousField).toBeUndefined();
        expect((result as any).constructor_hack).toBeUndefined();
    });

    it('should validate sessionDate', () => {
        const valid = sanitizeBiddingData({ sessionDate: '2025-01-15T10:00:00Z' });
        expect(valid.sessionDate).toBe('2025-01-15T10:00:00.000Z');

        const invalid = sanitizeBiddingData({ sessionDate: 'not-a-date' });
        expect(new Date(invalid.sessionDate).getTime()).not.toBeNaN();
    });

    it('should handle reminderDate null', () => {
        expect(sanitizeBiddingData({ reminderDate: null }).reminderDate).toBeNull();
        expect(sanitizeBiddingData({ reminderDate: '' }).reminderDate).toBeNull();
        expect(sanitizeBiddingData({ reminderDate: 'null' }).reminderDate).toBeNull();
    });

    it('should validate reminderDate', () => {
        const valid = sanitizeBiddingData({ reminderDate: '2025-06-01T10:00:00Z' });
        expect(valid.reminderDate).toBe('2025-06-01T10:00:00.000Z');

        const invalid = sanitizeBiddingData({ reminderDate: 'garbage' });
        expect(invalid.reminderDate).toBeNull();
    });
});

// ── Constants completeness ────────────────────────────────

describe('Constants', () => {
    it('MONITORABLE_DOMAINS should NOT include comprasnet', () => {
        expect(MONITORABLE_DOMAINS).not.toContain('comprasnet');
    });

    it('PLATFORM_DOMAINS should cover the 8 supported platforms', () => {
        expect(Object.keys(PLATFORM_DOMAINS)).toHaveLength(8);
        expect(PLATFORM_DOMAINS['Compras.gov.br']).toBeDefined();
        expect(PLATFORM_DOMAINS['BLL']).toBeDefined();
        expect(PLATFORM_DOMAINS['BBMNET']).toBeDefined();
        expect(PLATFORM_DOMAINS['M2A']).toBeDefined();
    });
});
