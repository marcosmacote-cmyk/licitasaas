/**
 * ═══════════════════════════════════════════════════════════
 * TESTES — Governança Operacional (governance.ts)
 * Sprint 1 | Item 1.2.4
 * 
 * Valida: fases macro, subfases, módulos permitidos/bloqueados,
 * stage resolution (legado → novo), e edge cases.
 * ═══════════════════════════════════════════════════════════
 */

import { describe, it, expect } from 'vitest';
import {
    getGovernance,
    isModuleAllowed,
    resolveStage,
    getDefaultSubstage,
    getSubstageLabel,
    KANBAN_STAGES,
    SUBSTAGES,
    getBlockedMessage,
    getEligibleBiddings,
    MODULE_LABELS,
    type KanbanStage,
    type SystemModule,
} from '../../../governance';

// ── Fase Macro — Cobertura Completa ────────────────────────

describe('Governança — Fases Macro', () => {
    it('deve ter exatamente 12 fases no Kanban', () => {
        expect(KANBAN_STAGES).toHaveLength(12);
    });

    it('todas as 12 fases devem ter subfases definidas', () => {
        for (const stage of KANBAN_STAGES) {
            expect(SUBSTAGES[stage]).toBeDefined();
            expect(SUBSTAGES[stage].length).toBeGreaterThan(0);
        }
    });

    it('todas as 12 fases devem ter governança definida', () => {
        for (const stage of KANBAN_STAGES) {
            const gov = getGovernance(stage);
            expect(gov.stage).toBe(stage);
            expect(gov.objective).toBeTruthy();
            expect(gov.primaryAction).toBeTruthy();
            expect(gov.themeColor).toBeTruthy();
        }
    });
});

// ── Módulos Permitidos / Bloqueados ────────────────────────

describe('Governança — Permissões por Fase', () => {
    it('Captado: bloqueia produção, permite empresas', () => {
        expect(isModuleAllowed('Captado', null, 'companies')).toBe(true);
        expect(isModuleAllowed('Captado', null, 'production-proposal')).toBe(false);
        expect(isModuleAllowed('Captado', null, 'production-declaration')).toBe(false);
        expect(isModuleAllowed('Captado', null, 'production-petition')).toBe(false);
        expect(isModuleAllowed('Captado', null, 'monitoring')).toBe(false);
    });

    it('Em Análise: permite inteligência e oráculo, bloqueia proposta', () => {
        expect(isModuleAllowed('Em Análise', null, 'intelligence')).toBe(true);
        expect(isModuleAllowed('Em Análise', null, 'oracle')).toBe(true);
        expect(isModuleAllowed('Em Análise', null, 'production-proposal')).toBe(false);
    });

    it('Em Sessão: permite monitoramento e proposta, bloqueia petição', () => {
        expect(isModuleAllowed('Em Sessão', null, 'monitoring')).toBe(true);
        expect(isModuleAllowed('Em Sessão', null, 'production-proposal')).toBe(true);
        expect(isModuleAllowed('Em Sessão', null, 'production-petition')).toBe(false);
    });

    it('Recurso: permite petições e monitoramento', () => {
        expect(isModuleAllowed('Recurso', null, 'production-petition')).toBe(true);
        expect(isModuleAllowed('Recurso', null, 'monitoring')).toBe(true);
    });

    it('Ganho: permite resultados, bloqueia tudo operacional', () => {
        expect(isModuleAllowed('Ganho', null, 'results')).toBe(true);
        expect(isModuleAllowed('Ganho', null, 'monitoring')).toBe(false);
        expect(isModuleAllowed('Ganho', null, 'production-proposal')).toBe(false);
    });

    it('Arquivado: bloqueia quase tudo, permite apenas resultados', () => {
        expect(isModuleAllowed('Arquivado', null, 'results')).toBe(true);
        expect(isModuleAllowed('Arquivado', null, 'intelligence')).toBe(false);
        expect(isModuleAllowed('Arquivado', null, 'production-proposal')).toBe(false);
        expect(isModuleAllowed('Arquivado', null, 'monitoring')).toBe(false);
        expect(isModuleAllowed('Arquivado', null, 'companies')).toBe(false);
    });
});

// ── Overrides de Subfase ──────────────────────────────────

describe('Governança — Overrides por Subfase', () => {
    it('analise_esclarecimento: habilita petições (override)', () => {
        expect(isModuleAllowed('Em Análise', 'analise_esclarecimento', 'production-petition')).toBe(true);
    });

    it('analise_impugnacao: habilita petições (override)', () => {
        expect(isModuleAllowed('Em Análise', 'analise_impugnacao', 'production-petition')).toBe(true);
    });

    it('analise_risco: NÃO habilita petições (sem override)', () => {
        expect(isModuleAllowed('Em Análise', 'analise_risco', 'production-petition')).toBe(false);
    });

    it('inabilitado (Perdido): habilita petições para recurso', () => {
        expect(isModuleAllowed('Perdido', 'inabilitado', 'production-petition')).toBe(true);
    });

    it('desclassificado (Perdido): habilita petições para recurso', () => {
        expect(isModuleAllowed('Perdido', 'desclassificado', 'production-petition')).toBe(true);
    });

    it('perdeu_disputa (Perdido): NÃO habilita petições', () => {
        expect(isModuleAllowed('Perdido', 'perdeu_disputa', 'production-petition')).toBe(false);
    });
});

// ── Resolução de Stage (Legado → Novo) ────────────────────

describe('Governança — Resolution de Status', () => {
    it('resolve status novo corretamente', () => {
        expect(resolveStage('Captado')).toBe('Captado');
        expect(resolveStage('Em Análise')).toBe('Em Análise');
        expect(resolveStage('Em Sessão')).toBe('Em Sessão');
        expect(resolveStage('Arquivado')).toBe('Arquivado');
    });

    it('resolve status legado para novo', () => {
        expect(resolveStage('Em Análise de Edital')).toBe('Em Análise');
        expect(resolveStage('Participando')).toBe('Em Sessão');
        expect(resolveStage('Monitorando')).toBe('Em Sessão');
        expect(resolveStage('Vencido')).toBe('Ganho');
        expect(resolveStage('Sem Sucesso')).toBe('Perdido');
    });

    it('status desconhecido resolve para Captado (fallback)', () => {
        expect(resolveStage('QualquerCoisa')).toBe('Captado');
        expect(resolveStage('')).toBe('Captado');
    });
});

// ── Utilitários ───────────────────────────────────────────

describe('Governança — Utilitários', () => {
    it('getDefaultSubstage: retorna primeira subfase', () => {
        expect(getDefaultSubstage('Captado')).toBe('importado_pncp');
        expect(getDefaultSubstage('Em Análise')).toBe('triagem_inicial');
    });

    it('getSubstageLabel: retorna label amigável', () => {
        expect(getSubstageLabel('Captado', 'importado_pncp')).toBe('Importado do PNCP');
        expect(getSubstageLabel('Em Sessão', 'disputa_aberta')).toBe('Disputa aberta');
    });

    it('getSubstageLabel: fallback para key se não encontrar', () => {
        expect(getSubstageLabel('Captado', 'inexistente')).toBe('inexistente');
    });

    it('getSubstageLabel: retorna vazio se null', () => {
        expect(getSubstageLabel('Captado', null)).toBe('');
    });

    it('MODULE_LABELS: todos os módulos têm label e ícone', () => {
        const modules: SystemModule[] = [
            'intelligence', 'oracle', 'production-proposal', 'production-dossier',
            'production-declaration', 'production-petition', 'monitoring', 'companies', 'results',
        ];
        for (const m of modules) {
            expect(MODULE_LABELS[m]).toBeDefined();
            expect(MODULE_LABELS[m].label).toBeTruthy();
            expect(MODULE_LABELS[m].icon).toBeTruthy();
        }
    });
});

// ── Mensagens de Bloqueio ─────────────────────────────────

describe('Governança — Mensagens de Bloqueio', () => {
    it('retorna mensagem específica quando disponível', () => {
        const msg = getBlockedMessage('Captado', null, 'monitoring');
        expect(msg).toContain('Em Sessão');
    });

    it('retorna mensagem genérica quando específica não existe', () => {
        const msg = getBlockedMessage('Em Análise', null, 'production-proposal');
        expect(msg).toContain('não está disponível');
    });

    it('fase Arquivado tem mensagem especial', () => {
        const msg = getBlockedMessage('Arquivado', null, 'production-proposal');
        expect(msg).toContain('arquivado');
    });
});

// ── Filtragem de Elegibilidade ────────────────────────────

describe('Governança — Elegibilidade de Processos', () => {
    const mockBiddings = [
        { id: '1', status: 'Captado', substage: 'importado_pncp' },
        { id: '2', status: 'Em Análise', substage: 'analise_edital' },
        { id: '3', status: 'Em Sessão', substage: 'disputa_aberta' },
        { id: '4', status: 'Arquivado', substage: 'encerrado' },
        { id: '5', status: 'Recurso', substage: 'elaborando_recurso' },
    ];

    it('filtra processos elegíveis para monitoramento', () => {
        const eligible = getEligibleBiddings(mockBiddings, 'monitoring');
        expect(eligible).toContain('3'); // Em Sessão
        expect(eligible).toContain('5'); // Recurso
        expect(eligible).not.toContain('1'); // Captado
        expect(eligible).not.toContain('4'); // Arquivado
    });

    it('filtra processos elegíveis para petições', () => {
        const eligible = getEligibleBiddings(mockBiddings, 'production-petition');
        expect(eligible).toContain('5'); // Recurso
        expect(eligible).not.toContain('1'); // Captado
        expect(eligible).not.toContain('3'); // Em Sessão
    });

    it('filtra processos elegíveis para inteligência', () => {
        const eligible = getEligibleBiddings(mockBiddings, 'intelligence');
        expect(eligible).toContain('2'); // Em Análise
        expect(eligible).not.toContain('4'); // Arquivado
    });
});
