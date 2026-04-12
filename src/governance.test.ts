/**
 * ══════════════════════════════════════════════════════════
 *  Governance Engine — Tests
 *  Sprint 7 — First automated tests for LicitaSaaS
 * ══════════════════════════════════════════════════════════
 */
import { describe, it, expect } from 'vitest';
import {
    resolveStage,
    getGovernance,
    isModuleAllowed,
    getDefaultSubstage,
    getSubstageLabel,
    getBlockedMessage,
    KANBAN_STAGES,
    LEGACY_STATUS_MAP,
    SUBSTAGES,
} from './governance';

// ── resolveStage ──────────────────────────────────────────

describe('resolveStage', () => {
    it('should return valid KanbanStage directly', () => {
        expect(resolveStage('Captado')).toBe('Captado');
        expect(resolveStage('Em Análise')).toBe('Em Análise');
        expect(resolveStage('Em Sessão')).toBe('Em Sessão');
        expect(resolveStage('Arquivado')).toBe('Arquivado');
    });

    it('should map legacy statuses correctly', () => {
        expect(resolveStage('Em Análise de Edital')).toBe('Em Análise');
        expect(resolveStage('Participando')).toBe('Em Sessão');
        expect(resolveStage('Monitorando')).toBe('Em Sessão');
        expect(resolveStage('Vencido')).toBe('Ganho');
        expect(resolveStage('Sem Sucesso')).toBe('Perdido');
    });

    it('should fallback to Captado for unknown statuses', () => {
        expect(resolveStage('invalid')).toBe('Captado');
        expect(resolveStage('')).toBe('Captado');
        expect(resolveStage('XYZ_RANDOM')).toBe('Captado');
    });

    it('should handle all 12 Kanban stages', () => {
        expect(KANBAN_STAGES).toHaveLength(12);
        for (const stage of KANBAN_STAGES) {
            expect(resolveStage(stage)).toBe(stage);
        }
    });
});

// ── getGovernance ─────────────────────────────────────────

describe('getGovernance', () => {
    it('should return governance for every valid stage', () => {
        for (const stage of KANBAN_STAGES) {
            const gov = getGovernance(stage);
            expect(gov.stage).toBe(stage);
            expect(gov.objective).toBeTruthy();
            expect(gov.primaryAction).toBeTruthy();
            expect(gov.themeColor).toBeTruthy();
            expect(Array.isArray(gov.allowedModules)).toBe(true);
            expect(Array.isArray(gov.blockedModules)).toBe(true);
        }
    });

    it('should block production modules in Captado', () => {
        const gov = getGovernance('Captado');
        expect(gov.blockedModules).toContain('production-proposal');
        expect(gov.blockedModules).toContain('production-declaration');
        expect(gov.blockedModules).toContain('monitoring');
    });

    it('should allow intelligence in Em Análise', () => {
        const gov = getGovernance('Em Análise');
        expect(gov.allowedModules).toContain('intelligence');
        expect(gov.allowedModules).toContain('oracle');
    });

    it('should allow monitoring in Em Sessão', () => {
        const gov = getGovernance('Em Sessão');
        expect(gov.allowedModules).toContain('monitoring');
    });

    it('should apply substage overrides', () => {
        // analise_impugnacao should add production-petition
        const gov = getGovernance('Em Análise', 'analise_impugnacao');
        expect(gov.allowedModules).toContain('production-petition');
        expect(gov.primaryAction).toBe('Abrir impugnação');
    });

    it('should NOT add petition module without override substage', () => {
        const gov = getGovernance('Em Análise', 'triagem_inicial');
        expect(gov.allowedModules).not.toContain('production-petition');
    });

    it('should handle unknown stage gracefully', () => {
        const gov = getGovernance('INVALID' as any);
        expect(gov.stage).toBe('INVALID');
        expect(gov.allowedModules).toEqual([]);
        expect(gov.blockedModules).toEqual([]);
    });
});

// ── isModuleAllowed ───────────────────────────────────────

describe('isModuleAllowed', () => {
    it('should allow intelligence in Em Análise', () => {
        expect(isModuleAllowed('Em Análise', null, 'intelligence')).toBe(true);
    });

    it('should block monitoring in Captado', () => {
        expect(isModuleAllowed('Captado', null, 'monitoring')).toBe(false);
    });

    it('should allow monitoring in Em Sessão', () => {
        expect(isModuleAllowed('Em Sessão', null, 'monitoring')).toBe(true);
    });

    it('should allow petition in Recurso', () => {
        expect(isModuleAllowed('Recurso', null, 'production-petition')).toBe(true);
    });

    it('should block all operational modules in Arquivado', () => {
        expect(isModuleAllowed('Arquivado', null, 'production-proposal')).toBe(false);
        expect(isModuleAllowed('Arquivado', null, 'monitoring')).toBe(false);
        expect(isModuleAllowed('Arquivado', null, 'intelligence')).toBe(false);
    });

    it('should allow petition in Perdido/inabilitado substage', () => {
        expect(isModuleAllowed('Perdido', 'inabilitado', 'production-petition')).toBe(true);
    });
});

// ── getDefaultSubstage ────────────────────────────────────

describe('getDefaultSubstage', () => {
    it('should return first substage for each stage', () => {
        expect(getDefaultSubstage('Captado')).toBe('importado_pncp');
        expect(getDefaultSubstage('Em Análise')).toBe('triagem_inicial');
        expect(getDefaultSubstage('Em Sessão')).toBe('aguardando_abertura');
    });
});

// ── getSubstageLabel ──────────────────────────────────────

describe('getSubstageLabel', () => {
    it('should return human-readable label', () => {
        expect(getSubstageLabel('Captado', 'importado_pncp')).toBe('Importado do PNCP');
        expect(getSubstageLabel('Em Sessão', 'disputa_aberta')).toBe('Disputa aberta');
    });

    it('should return empty string for null substage', () => {
        expect(getSubstageLabel('Captado', null)).toBe('');
    });
});

// ── getBlockedMessage ─────────────────────────────────────

describe('getBlockedMessage', () => {
    it('should return specific message for monitoring in Captado', () => {
        const msg = getBlockedMessage('Captado', null, 'monitoring');
        expect(msg).toContain('Monitor');
        expect(msg).toContain('Em Sessão');
    });

    it('should return archive message for Arquivado', () => {
        const msg = getBlockedMessage('Arquivado', null, 'production-proposal');
        expect(msg).toContain('arquivado');
    });
});

// ── SUBSTAGES completeness ────────────────────────────────

describe('SUBSTAGES', () => {
    it('should have substages for every KanbanStage', () => {
        for (const stage of KANBAN_STAGES) {
            expect(SUBSTAGES[stage]).toBeDefined();
            expect(SUBSTAGES[stage].length).toBeGreaterThan(0);
        }
    });

    it('should have unique substage keys within each stage', () => {
        for (const stage of KANBAN_STAGES) {
            const keys = SUBSTAGES[stage].map(s => s.key);
            expect(new Set(keys).size).toBe(keys.length);
        }
    });
});

// ── LEGACY_STATUS_MAP completeness ────────────────────────

describe('LEGACY_STATUS_MAP', () => {
    it('should map all legacy statuses to valid KanbanStages', () => {
        for (const [legacy, mapped] of Object.entries(LEGACY_STATUS_MAP)) {
            expect(KANBAN_STAGES).toContain(mapped.stage);
            // substage should exist in the target stage
            const validKeys = SUBSTAGES[mapped.stage].map(s => s.key);
            expect(validKeys).toContain(mapped.substage);
        }
    });
});
