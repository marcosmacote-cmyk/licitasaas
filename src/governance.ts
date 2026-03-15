// ═══════════════════════════════════════════════════════════
// LicitaSaaS — Governança Operacional Central
// Fonte única de verdade para: fases, subfases, módulos
// permitidos/bloqueados, CTA e mensagens de bloqueio.
// ═══════════════════════════════════════════════════════════

// ── Tipos ────────────────────────────────────────────────

/** Fases macro visíveis no Kanban (12 colunas) */
export type KanbanStage =
    | 'Captado'
    | 'Em Análise'
    | 'Aprovado para Participação'
    | 'Preparando Documentação'
    | 'Preparando Proposta'
    | 'Em Sessão'
    | 'Pós-Sessão'
    | 'Recurso'
    | 'Ganho'
    | 'Não Participar'
    | 'Perdido'
    | 'Arquivado';

/** Todos os módulos navegáveis do sistema */
export type SystemModule =
    | 'intelligence'          // Análise IA / LicitIA
    | 'oracle'                // Oráculo Técnico
    | 'production-proposal'   // Proposta de Preços
    | 'production-dossier'    // Dossiê ZIP
    | 'production-declaration'// Declarações (IA)
    | 'production-petition'   // Petições e Recursos
    | 'monitoring'            // Monitor Chat
    | 'companies'             // Empresas/Documentos
    | 'results';              // Resultados

/** Subfases operacionais internas por fase macro */
export const SUBSTAGES: Record<KanbanStage, { key: string; label: string }[]> = {
    'Captado': [
        { key: 'importado_pncp', label: 'Importado do PNCP' },
        { key: 'cadastrado_manual', label: 'Cadastrado manualmente' },
        { key: 'aguardando_triagem', label: 'Aguardando triagem' },
    ],
    'Em Análise': [
        { key: 'triagem_inicial', label: 'Triagem inicial' },
        { key: 'analise_edital', label: 'Análise de edital' },
        { key: 'analise_risco', label: 'Análise de risco' },
        { key: 'analise_esclarecimento', label: 'Análise para esclarecimento' },
        { key: 'analise_impugnacao', label: 'Análise para impugnação' },
    ],
    'Aprovado para Participação': [
        { key: 'aprovado_sem_ressalvas', label: 'Aprovado sem ressalvas' },
        { key: 'aprovado_com_pendencias', label: 'Aprovado com pendências' },
        { key: 'aguardando_distribuicao', label: 'Aguardando distribuição interna' },
    ],
    'Preparando Documentação': [
        { key: 'revisao_documental', label: 'Revisão documental' },
        { key: 'certidoes_habilitacao', label: 'Certidões e habilitação' },
        { key: 'declaracoes', label: 'Declarações' },
        { key: 'acervo_tecnico', label: 'Acervo técnico' },
        { key: 'montagem_dossie', label: 'Montagem de dossiê' },
        { key: 'pendencia_critica', label: 'Pendência documental crítica' },
    ],
    'Preparando Proposta': [
        { key: 'levantamento_custos', label: 'Levantamento de custos' },
        { key: 'composicao_precos', label: 'Composição de preços' },
        { key: 'revisao_proposta', label: 'Revisão de proposta' },
        { key: 'proposta_pronta', label: 'Proposta pronta para envio' },
    ],
    'Em Sessão': [
        { key: 'aguardando_abertura', label: 'Aguardando abertura da sessão' },
        { key: 'disputa_aberta', label: 'Disputa aberta' },
        { key: 'negociacao', label: 'Negociação' },
        { key: 'aguardando_julgamento', label: 'Aguardando julgamento da sessão' },
    ],
    'Pós-Sessão': [
        { key: 'em_diligencia', label: 'Em diligência' },
        { key: 'em_habilitacao', label: 'Em habilitação' },
        { key: 'aguardando_resultado', label: 'Aguardando resultado final' },
        { key: 'vencedor_provisorio', label: 'Vencedor provisório' },
    ],
    'Recurso': [
        { key: 'elaborando_recurso', label: 'Elaborando recurso' },
        { key: 'elaborando_contrarrazao', label: 'Elaborando contrarrazão' },
        { key: 'aguardando_decisao', label: 'Aguardando decisão recursal' },
    ],
    'Ganho': [
        { key: 'homologado', label: 'Homologado' },
        { key: 'adjudicado', label: 'Adjudicado' },
        { key: 'aguardando_contratacao', label: 'Aguardando contratação' },
        { key: 'concluido_exito', label: 'Concluído com êxito' },
    ],
    'Não Participar': [
        { key: 'inviabilidade_tecnica', label: 'Inviabilidade técnica' },
        { key: 'inviabilidade_documental', label: 'Inviabilidade documental' },
        { key: 'inviabilidade_economica', label: 'Inviabilidade econômica' },
        { key: 'decisao_estrategica', label: 'Decisão estratégica' },
    ],
    'Perdido': [
        { key: 'perdeu_disputa', label: 'Perdeu na disputa' },
        { key: 'inabilitado', label: 'Inabilitado' },
        { key: 'desclassificado', label: 'Desclassificado' },
        { key: 'nao_adjudicado', label: 'Não adjudicado' },
    ],
    'Arquivado': [
        { key: 'encerrado', label: 'Encerrado' },
        { key: 'historico', label: 'Histórico' },
        { key: 'sem_acao_futura', label: 'Sem ação futura' },
    ],
};

// ── Matriz de Governança ─────────────────────────────────

export interface StageGovernance {
    stage: KanbanStage;
    objective: string;
    allowedModules: SystemModule[];
    blockedModules: SystemModule[];
    primaryAction: string;
    /** Cor temática para badges e indicadores */
    themeColor: string;
}

/** Regras especiais por subfase (overrides da fase macro) */
interface SubstageOverride {
    /** Módulos adicionais permitidos nesta subfase */
    addModules?: SystemModule[];
    /** Módulos removidos nesta subfase */
    removeModules?: SystemModule[];
    /** CTA override */
    primaryAction?: string;
}

// ── Governança Base por Fase Macro ────────────────────────

const BASE_GOVERNANCE: Record<KanbanStage, Omit<StageGovernance, 'stage'>> = {
    'Captado': {
        objective: 'Registrar oportunidade recém-captada',
        allowedModules: ['companies'],
        blockedModules: ['production-proposal', 'production-declaration', 'production-petition', 'production-dossier', 'monitoring', 'oracle'],
        primaryAction: 'Iniciar triagem',
        themeColor: 'var(--color-text-secondary)',
    },
    'Em Análise': {
        objective: 'Avaliar técnica, jurídica e estrategicamente o edital',
        allowedModules: ['intelligence', 'oracle', 'companies'],
        blockedModules: ['production-proposal', 'monitoring', 'production-dossier'],
        primaryAction: 'Concluir análise',
        themeColor: 'var(--color-ai)',
    },
    'Aprovado para Participação': {
        objective: 'Formalizar decisão interna de seguir no processo',
        allowedModules: ['companies', 'production-dossier', 'oracle', 'intelligence'],
        blockedModules: ['monitoring'],
        primaryAction: 'Preparar documentação',
        themeColor: 'var(--color-primary)',
    },
    'Preparando Documentação': {
        objective: 'Organizar habilitação, declarações, acervo e dossiê',
        allowedModules: ['companies', 'production-declaration', 'production-dossier', 'oracle', 'intelligence'],
        blockedModules: ['production-proposal', 'monitoring'],
        primaryAction: 'Regularizar pendências documentais',
        themeColor: 'var(--color-urgency)',
    },
    'Preparando Proposta': {
        objective: 'Montar e revisar proposta comercial/técnica',
        allowedModules: ['production-proposal', 'production-declaration', 'production-dossier', 'companies', 'intelligence', 'oracle'],
        blockedModules: ['monitoring'],
        primaryAction: 'Concluir proposta',
        themeColor: 'var(--color-primary)',
    },
    'Em Sessão': {
        objective: 'Operação ao vivo da disputa e negociação',
        allowedModules: ['monitoring', 'production-proposal', 'companies'],
        blockedModules: ['production-petition'],
        primaryAction: 'Acompanhar sessão',
        themeColor: 'var(--color-danger)',
    },
    'Pós-Sessão': {
        objective: 'Tratar diligência, habilitação e consolidação pós-disputa',
        allowedModules: ['production-dossier', 'companies', 'production-declaration', 'monitoring'],
        blockedModules: ['production-proposal'],
        primaryAction: 'Responder diligência / acompanhar habilitação',
        themeColor: 'var(--color-warning)',
    },
    'Recurso': {
        objective: 'Tratar recursos e contrarrazões',
        allowedModules: ['production-petition', 'companies', 'intelligence', 'monitoring'],
        blockedModules: ['production-proposal'],
        primaryAction: 'Elaborar recurso ou contrarrazão',
        themeColor: 'var(--color-warning)',
    },
    'Ganho': {
        objective: 'Consolidar resultado favorável',
        allowedModules: ['results', 'companies'],
        blockedModules: ['monitoring', 'production-proposal', 'production-petition'],
        primaryAction: 'Consolidar ganho',
        themeColor: 'var(--color-success)',
    },
    'Não Participar': {
        objective: 'Registrar desistência estratégica ou inviabilidade',
        allowedModules: ['results', 'companies'],
        blockedModules: ['production-proposal', 'production-dossier', 'monitoring', 'production-petition'],
        primaryAction: 'Registrar justificativa',
        themeColor: 'var(--color-text-tertiary)',
    },
    'Perdido': {
        objective: 'Registrar encerramento sem êxito',
        allowedModules: ['results', 'companies'],
        blockedModules: ['production-proposal', 'monitoring'],
        primaryAction: 'Registrar perda',
        themeColor: 'var(--color-danger)',
    },
    'Arquivado': {
        objective: 'Manter apenas histórico e consulta',
        allowedModules: ['results'],
        blockedModules: ['production-proposal', 'production-declaration', 'production-petition', 'production-dossier', 'monitoring', 'intelligence', 'oracle', 'companies'],
        primaryAction: 'Consultar histórico',
        themeColor: 'var(--color-text-tertiary)',
    },
};

// ── Overrides por Subfase ──────────────────────────────────

const SUBSTAGE_OVERRIDES: Record<string, SubstageOverride> = {
    // Em Análise → esclarecimento/impugnação habilita Petições
    'analise_esclarecimento': { addModules: ['production-petition'], primaryAction: 'Abrir petição de esclarecimento' },
    'analise_impugnacao':     { addModules: ['production-petition'], primaryAction: 'Abrir impugnação' },

    // Preparando Documentação → subfases especializadas
    'declaracoes':          { primaryAction: 'Gerar declarações' },
    'montagem_dossie':      { primaryAction: 'Montar dossiê' },
    'pendencia_critica':    { primaryAction: 'Resolver bloqueio documental' },

    // Em Sessão → chat prioritário
    'disputa_aberta':       { primaryAction: 'Acompanhar disputa ao vivo' },
    'negociacao':           { primaryAction: 'Negociar preço' },
    'aguardando_abertura':  { primaryAction: 'Preparar para sessão' },

    // Pós-Sessão → subfases especializadas
    'em_diligencia':        { primaryAction: 'Responder diligência' },
    'em_habilitacao':       { primaryAction: 'Acompanhar habilitação' },
    'vencedor_provisorio':  { primaryAction: 'Consolidar resultado' },

    // Recurso → subfases especializadas
    'elaborando_recurso':       { primaryAction: 'Gerar recurso' },
    'elaborando_contrarrazao':  { primaryAction: 'Gerar contrarrazão' },
    'aguardando_decisao':       { primaryAction: 'Acompanhar decisão' },

    // Perdido → inabilitado/desclassificado pode avaliar recurso
    'inabilitado':     { addModules: ['production-petition'] },
    'desclassificado': { addModules: ['production-petition'] },
};

// ── API Pública ──────────────────────────────────────────

/**
 * Obtém a governança completa para uma fase + subfase.
 * Aplica overrides da subfase sobre a base da fase macro.
 */
export function getGovernance(stage: KanbanStage, substage?: string | null): StageGovernance {
    const base = BASE_GOVERNANCE[stage];
    if (!base) {
        return {
            stage,
            objective: '',
            allowedModules: [],
            blockedModules: [],
            primaryAction: 'Consultar processo',
            themeColor: 'var(--color-text-secondary)',
        };
    }

    const override = substage ? SUBSTAGE_OVERRIDES[substage] : undefined;

    let allowedModules = [...base.allowedModules];
    let primaryAction = base.primaryAction;

    if (override) {
        if (override.addModules) {
            allowedModules = [...new Set([...allowedModules, ...override.addModules])];
        }
        if (override.removeModules) {
            allowedModules = allowedModules.filter(m => !override.removeModules!.includes(m));
        }
        if (override.primaryAction) {
            primaryAction = override.primaryAction;
        }
    }

    return {
        stage,
        objective: base.objective,
        allowedModules,
        blockedModules: base.blockedModules,
        primaryAction,
        themeColor: base.themeColor,
    };
}

/**
 * Verifica se um módulo é permitido para uma fase + subfase.
 */
export function isModuleAllowed(stage: KanbanStage, substage: string | null | undefined, module: SystemModule): boolean {
    const gov = getGovernance(stage, substage);
    return gov.allowedModules.includes(module);
}

/**
 * Retorna mensagem de bloqueio institucional para acesso indevido
 */
export function getBlockedMessage(stage: KanbanStage, _substage: string | null | undefined, module: SystemModule): string {
    const moduleLabels: Record<SystemModule, string> = {
        'intelligence': 'Análise IA',
        'oracle': 'Oráculo Técnico',
        'production-proposal': 'Proposta de Preços',
        'production-dossier': 'Dossiê',
        'production-declaration': 'Declarações',
        'production-petition': 'Petições e Recursos',
        'monitoring': 'Monitor Chat',
        'companies': 'Empresas',
        'results': 'Resultados',
    };

    const moduleLabel = moduleLabels[module] || module;
    const stageLabel = stage;

    // Mensagens específicas por combinação
    const specificMessages: Partial<Record<SystemModule, Partial<Record<KanbanStage, string>>>> = {
        'monitoring': {
            'Captado': `Este processo não está em fase de sessão. O módulo "${moduleLabel}" só está disponível para processos em "Em Sessão".`,
            'Em Análise': `Este processo está em análise. O módulo "${moduleLabel}" só está disponível para processos em "Em Sessão".`,
            'Preparando Documentação': `Este processo está preparando documentação. O módulo "${moduleLabel}" só está disponível para processos em "Em Sessão".`,
            'Preparando Proposta': `Este processo está preparando proposta. O módulo "${moduleLabel}" só está disponível para processos em "Em Sessão".`,
        },
        'production-proposal': {
            'Recurso': `Este processo está na fase "${stageLabel}". O módulo "${moduleLabel}" não está disponível nesta etapa.`,
            'Ganho': `Este processo já foi ganho. O módulo "${moduleLabel}" não está mais disponível.`,
            'Arquivado': `Este processo está arquivado. Apenas consulta histórica e relatórios permanecem disponíveis.`,
        },
        'production-petition': {
            'Preparando Proposta': `Este processo está na fase "${stageLabel}". O módulo "${moduleLabel}" só está disponível para processos em análise para impugnação/esclarecimento ou em fase recursal.`,
            'Em Sessão': `Este processo está em sessão ativa. O módulo "${moduleLabel}" não está disponível durante a disputa.`,
        },
    };

    const specific = specificMessages[module]?.[stage];
    if (specific) return specific;

    // Mensagem genérica
    if (stage === 'Arquivado') {
        return `Este processo está arquivado. Apenas consulta histórica e relatórios permanecem disponíveis.`;
    }

    return `Este processo está na fase "${stageLabel}". O módulo "${moduleLabel}" não está disponível nesta etapa. Consulte o Hub Operacional para ver as ações compatíveis.`;
}

/**
 * Retorna a subfase default para uma fase macro.
 */
export function getDefaultSubstage(stage: KanbanStage): string {
    const subs = SUBSTAGES[stage];
    return subs && subs.length > 0 ? subs[0].key : '';
}

/**
 * Retorna o label amigável de uma subfase.
 */
export function getSubstageLabel(stage: KanbanStage, substageKey: string | null | undefined): string {
    if (!substageKey) return '';
    const subs = SUBSTAGES[stage];
    const found = subs?.find(s => s.key === substageKey);
    return found?.label || substageKey;
}

/**
 * Todas as 12 fases macro na ordem do board.
 */
export const KANBAN_STAGES: KanbanStage[] = [
    'Captado',
    'Em Análise',
    'Aprovado para Participação',
    'Preparando Documentação',
    'Preparando Proposta',
    'Em Sessão',
    'Pós-Sessão',
    'Recurso',
    'Ganho',
    'Não Participar',
    'Perdido',
    'Arquivado',
];

/**
 * Mapeia os status antigos do sistema para os novos.
 */
export const LEGACY_STATUS_MAP: Record<string, { stage: KanbanStage; substage: string }> = {
    'Captado':                   { stage: 'Captado',                 substage: 'importado_pncp' },
    'Em Análise de Edital':      { stage: 'Em Análise',              substage: 'analise_edital' },
    'Preparando Documentação':   { stage: 'Preparando Documentação', substage: 'revisao_documental' },
    'Participando':              { stage: 'Em Sessão',               substage: 'disputa_aberta' },
    'Monitorando':               { stage: 'Em Sessão',               substage: 'disputa_aberta' },
    'Recurso':                   { stage: 'Recurso',                 substage: 'elaborando_recurso' },
    'Vencido':                   { stage: 'Ganho',                   substage: 'homologado' },
    'Sem Sucesso':               { stage: 'Perdido',                 substage: 'perdeu_disputa' },
    'Perdido':                   { stage: 'Perdido',                 substage: 'perdeu_disputa' },
};

/**
 * Resolve um status (pode ser antigo ou novo) para KanbanStage.
 * Usado durante a transição para garantir compatibilidade.
 */
export function resolveStage(status: string): KanbanStage {
    // Se é uma KanbanStage válida, retorna diretamente
    if (KANBAN_STAGES.includes(status as KanbanStage)) {
        return status as KanbanStage;
    }
    // Se é um status legado, mapeia
    const mapped = LEGACY_STATUS_MAP[status];
    if (mapped) return mapped.stage;
    // Fallback
    return 'Captado';
}

/**
 * Identifica quais processos são elegíveis para um determinado módulo.
 */
export function getEligibleBiddings(
    biddings: { id: string; status: string; substage?: string | null }[],
    module: SystemModule
): string[] {
    return biddings
        .filter(b => isModuleAllowed(resolveStage(b.status), b.substage, module))
        .map(b => b.id);
}

/**
 * Labels amigáveis para módulos (para UI).
 */
export const MODULE_LABELS: Record<SystemModule, { label: string; icon: string }> = {
    'intelligence':           { label: 'Análise IA',         icon: 'ScanSearch' },
    'oracle':                 { label: 'Oráculo Técnico',    icon: 'HardHat' },
    'production-proposal':    { label: 'Proposta de Preços', icon: 'DollarSign' },
    'production-dossier':     { label: 'Dossiê',             icon: 'FolderArchive' },
    'production-declaration': { label: 'Declarações',        icon: 'FileText' },
    'production-petition':    { label: 'Petições e Recursos',icon: 'Gavel' },
    'monitoring':             { label: 'Monitor Chat',       icon: 'Monitor' },
    'companies':              { label: 'Empresas',           icon: 'Building2' },
    'results':                { label: 'Resultados',         icon: 'BarChart3' },
};

// ── "Entenda esta fase" — Conteúdo contextual por fase ───────

export interface PhaseExplainerContent {
    meaning: string;
    cardInterpretation: string;
    availableModules: string[];
    blockedModules: string[];
    recommendedAction: string;
    criticalNote: string;
}

export const PHASE_EXPLAINER: Record<KanbanStage, PhaseExplainerContent> = {
    'Captado': {
        meaning: 'O processo entrou no sistema, mas ainda não passou por triagem operacional.',
        cardInterpretation: 'Os cards aqui representam oportunidades recém-captadas, ainda sem decisão interna de participação.',
        availableModules: ['Busca PNCP', 'Visualização básica', 'Observações internas'],
        blockedModules: ['Proposta', 'Declarações', 'Petições/Recursos', 'Dossiê', 'Monitor Chat'],
        recommendedAction: 'Iniciar triagem',
        criticalNote: 'Esta fase é de entrada. Ainda não há liberação para execução operacional.',
    },
    'Em Análise': {
        meaning: 'O processo está em avaliação técnica, jurídica e estratégica.',
        cardInterpretation: 'Os cards aqui ainda não foram aprovados para participação. A equipe está analisando riscos, exigências e viabilidade.',
        availableModules: ['LicitIA', 'Oráculo Técnico', 'Documentos'],
        blockedModules: ['Proposta', 'Monitor Chat'],
        recommendedAction: 'Concluir análise e decidir participação',
        criticalNote: 'Se a subfase for análise para esclarecimento ou impugnação, o módulo Petições/Recursos poderá ser habilitado.',
    },
    'Aprovado para Participação': {
        meaning: 'A decisão interna foi participar do processo.',
        cardInterpretation: 'Os cards aqui já passaram pela análise e seguirão para a execução preparatória.',
        availableModules: ['Documentos', 'Dossiê', 'Oráculo Técnico', 'LicitIA'],
        blockedModules: ['Recurso', 'Monitor Chat'],
        recommendedAction: 'Preparar documentação',
        criticalNote: 'Esta fase marca a transição entre análise e preparação.',
    },
    'Preparando Documentação': {
        meaning: 'A equipe está reunindo e regularizando a documentação de habilitação, declarações, acervos e dossiê.',
        cardInterpretation: 'Os cards aqui exigem foco em prontidão documental e resolução de pendências.',
        availableModules: ['Documentos', 'Declarações', 'Dossiê', 'Oráculo Técnico', 'LicitIA'],
        blockedModules: ['Proposta', 'Monitor Chat', 'Recurso'],
        recommendedAction: 'Regularizar pendências documentais',
        criticalNote: 'Pendências críticas nesta fase podem impedir a participação.',
    },
    'Preparando Proposta': {
        meaning: 'A proposta comercial/técnica está sendo montada, revisada ou finalizada.',
        cardInterpretation: 'Os cards aqui representam processos já aptos documentalmente ou próximos disso, com foco na composição da proposta.',
        availableModules: ['Proposta', 'Declarações', 'Dossiê', 'Documentos'],
        blockedModules: ['Recurso', 'Monitor Chat'],
        recommendedAction: 'Concluir proposta',
        criticalNote: 'Esta fase antecede a sessão. O foco principal é a proposta.',
    },
    'Em Sessão': {
        meaning: 'O processo está em disputa, negociação ou acompanhamento operacional em tempo real.',
        cardInterpretation: 'Os cards aqui exigem atenção imediata, leitura de eventos da sessão e resposta rápida.',
        availableModules: ['Monitor Chat', 'Proposta', 'Documentos'],
        blockedModules: ['Petições/Recursos'],
        recommendedAction: 'Acompanhar sessão',
        criticalNote: 'Quando houver disputa ou negociação, o módulo prioritário é o Monitor Chat.',
    },
    'Pós-Sessão': {
        meaning: 'A sessão ocorreu e o processo está em diligência, habilitação ou aguardando resultado final.',
        cardInterpretation: 'Os cards aqui ainda exigem acompanhamento ativo, inclusive da comunicação oficial do processo, embora já fora da disputa ao vivo.',
        availableModules: ['Dossiê', 'Documentos', 'Declarações', 'Monitor Chat'],
        blockedModules: ['Proposta'],
        recommendedAction: 'Responder diligência ou acompanhar habilitação',
        criticalNote: 'Esta fase é crítica para documentações complementares, exigências pós-disputa e acompanhamento das comunicações do processo pelo chat.',
    },
    'Recurso': {
        meaning: 'O processo entrou em fase recursal.',
        cardInterpretation: 'Os cards aqui exigem atuação jurídica/administrativa específica, além do acompanhamento das comunicações do processo.',
        availableModules: ['Petições/Recursos', 'Documentos', 'Monitor Chat'],
        blockedModules: ['Proposta'],
        recommendedAction: 'Elaborar recurso ou contrarrazão',
        criticalNote: 'Nesta fase, o acompanhamento do chat pode continuar relevante para monitorar comunicações e atos relacionados ao processo.',
    },
    'Ganho': {
        meaning: 'O resultado final foi favorável à empresa.',
        cardInterpretation: 'Os cards aqui representam processos ganhos, homologados ou em consolidação final.',
        availableModules: ['Resultados', 'Exportações', 'Documentos finais'],
        blockedModules: ['Monitor Chat', 'Proposta', 'Petições/Recursos'],
        recommendedAction: 'Consolidar ganho',
        criticalNote: 'É uma fase de fechamento positivo e transição para histórico ou contratação.',
    },
    'Não Participar': {
        meaning: 'Foi tomada decisão interna de não seguir no processo.',
        cardInterpretation: 'Os cards aqui representam processos descartados por estratégia, inviabilidade ou impeditivos.',
        availableModules: ['Histórico', 'Observações', 'Resultados'],
        blockedModules: ['Proposta', 'Dossiê', 'Monitor Chat', 'Recurso'],
        recommendedAction: 'Registrar justificativa',
        criticalNote: 'Esta fase deve deixar clara a razão da não participação.',
    },
    'Perdido': {
        meaning: 'A empresa participou, mas não obteve êxito no resultado.',
        cardInterpretation: 'Os cards aqui representam processos encerrados sem vitória, ainda podendo exigir análise final ou eventual recurso.',
        availableModules: ['Resultados', 'Histórico', 'Petições/Recursos (se cabível)'],
        blockedModules: ['Proposta', 'Monitor Chat'],
        recommendedAction: 'Registrar perda',
        criticalNote: 'Dependendo da subfase, pode haver possibilidade de recurso.',
    },
    'Arquivado': {
        meaning: 'O processo está encerrado e sem ação operacional ativa.',
        cardInterpretation: 'Os cards aqui existem apenas para consulta histórica e análise posterior.',
        availableModules: ['Histórico', 'Resultados'],
        blockedModules: ['Todos os módulos operacionais'],
        recommendedAction: 'Consultar histórico',
        criticalNote: 'Esta é uma fase terminal do fluxo.',
    },
};

