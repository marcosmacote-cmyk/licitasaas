/**
 * ══════════════════════════════════════════════════════════════════
 * AlertTaxonomy — Categorias semânticas de alertas de licitação
 * ══════════════════════════════════════════════════════════════════
 * 
 * Cada categoria define:
 * - keywords: termos exatos para matching
 * - patterns: regex com variações (acentos, conjugações, typos comuns)
 * - severity: critical > warning > info
 * - enabledByDefault: se a categoria vem habilitada para novos tenants
 */

export type AlertSeverity = 'critical' | 'warning' | 'info' | 'closure';

export interface AlertCategory {
  id: string;
  label: string;
  icon: string;
  severity: AlertSeverity;
  keywords: string[];
  patterns: RegExp[];
  description: string;
  enabledByDefault: boolean;
  /** Se true, indica evento de encerramento do processo */
  isClosureCategory?: boolean;
}

export const ALERT_TAXONOMY: AlertCategory[] = [
  // ══════════════════════════════════════
  // 🔴 CRITICAL — Ação imediata necessária
  // ══════════════════════════════════════
  {
    id: 'convocacao',
    label: 'Convocação',
    icon: 'bell-ring',
    severity: 'critical',
    keywords: ['convocado', 'convocada', 'convocação', 'convocar'],
    patterns: [
      /convoca[çc][ãa]o/i,
      /foi\s+convocad[oa]/i,
      /empresa\s+convocad[oa]/i,
      /fica\s+convocad[oa]/i,
    ],
    description: 'Fornecedor convocado para enviar documentos ou proposta',
    enabledByDefault: true,
  },
  {
    id: 'vencedor',
    label: 'Declaração de Vencedor',
    icon: 'trophy',
    severity: 'critical',
    keywords: ['vencedor', 'vencedora', 'adjudicado', 'adjudicada', 'homologado', 'homologada'],
    patterns: [
      /declarad[oa]\s+vencedor/i,
      /vencedor[a]?\s+d[oa]\s+item/i,
      /adjudicad[oa]/i,
      /homologad[oa]/i,
    ],
    description: 'Processo teve vencedor declarado ou item adjudicado/homologado',
    enabledByDefault: true,
  },
  {
    id: 'encerramento',
    label: 'Encerramento de Prazo',
    icon: 'timer',
    severity: 'critical',
    keywords: ['encerrado o prazo', 'tempo aleatório', 'fase de lances encerrada'],
    patterns: [
      /encerrad[oa]\s+(o\s+)?prazo/i,
      /tempo\s+aleat[óo]rio/i,
      /fase\s+de\s+lances\s+(foi\s+)?encerrad[oa]/i,
      /encerramento\s+d[ao]s?\s+lance/i,
    ],
    description: 'Prazo encerrado ou fase de lances finalizada',
    enabledByDefault: true,
  },
  {
    id: 'prazo_docs',
    label: 'Prazo de Documentos',
    icon: 'file-clock',
    severity: 'critical',
    keywords: ['prazo para envio', 'envio de documentos', 'anexar documento', 'enviar proposta'],
    patterns: [
      /prazo\s+(para\s+)?envio/i,
      /envio\s+de\s+document/i,
      /anexar\s+document/i,
      /enviar\s+(a\s+)?proposta/i,
      /prazo\s+de\s+\d+\s*(hora|dia|min)/i,
    ],
    description: 'Prazo para envio de documentação de habilitação ou proposta',
    enabledByDefault: true,
  },

  // ══════════════════════════════════════
  // ⚠️ WARNING — Atenção necessária
  // ══════════════════════════════════════
  {
    id: 'suspensao',
    label: 'Suspensão',
    icon: 'ban',
    severity: 'warning',
    keywords: ['suspensa', 'suspenso', 'suspensão'],
    patterns: [
      /suspens[ãa]o/i,
      /sess[ãa]o\s+suspens/i,
      /item\s+suspens/i,
      /licitac[ãa]o\s+suspens/i,
    ],
    description: 'Processo ou item foi suspenso',
    enabledByDefault: true,
  },
  {
    id: 'reabertura',
    label: 'Reabertura',
    icon: 'rotate-ccw',
    severity: 'warning',
    keywords: ['reaberta', 'reaberto', 'reabertura'],
    patterns: [
      /reab[ie]rt[oa]/i,
      /reabertura/i,
      /sess[ãa]o\s+reab/i,
    ],
    description: 'Processo ou sessão foi reaberto',
    enabledByDefault: true,
  },
  {
    id: 'impugnacao',
    label: 'Impugnação / Recurso',
    icon: 'scale',
    severity: 'warning',
    keywords: ['impugnação', 'recurso', 'contrarrazão', 'contrarrazões'],
    patterns: [
      /impugna[çc][ãa]o/i,
      /recurso\s+(administrativo|interposto)/i,
      /contrarraz[ãõo][oe]?s?/i,
      /prazo\s+(para\s+)?recurso/i,
    ],
    description: 'Recurso ou impugnação registrada no processo',
    enabledByDefault: true,
  },
  {
    id: 'inabilitacao',
    label: 'Inabilitação / Desclassificação',
    icon: 'user-x',
    severity: 'warning',
    keywords: ['inabilitado', 'inabilitada', 'desclassificado', 'desclassificada', 'inabilitação', 'desclassificação'],
    patterns: [
      /inabilita[çc][ãa]o/i,
      /inabilitad[oa]/i,
      /desclassificad[oa]/i,
      /desclassifica[çc][ãa]o/i,
    ],
    description: 'Fornecedor inabilitado ou desclassificado',
    enabledByDefault: true,
  },
  {
    id: 'negociacao',
    label: 'Negociação',
    icon: 'message-square-more',
    severity: 'warning',
    keywords: ['negociação', 'negociar', 'contraproposta'],
    patterns: [
      /negocia[çc][ãa]o/i,
      /contraproposta/i,
      /negocia[çc][ãa]o\s+(de\s+)?pre[çc]o/i,
    ],
    description: 'Pregoeiro iniciou negociação de preço',
    enabledByDefault: true,
  },

  // ══════════════════════════════════════
  // ℹ️ INFO — Informativo
  // ══════════════════════════════════════
  {
    id: 'comunicado',
    label: 'Comunicado do Pregoeiro',
    icon: 'megaphone',
    severity: 'info',
    keywords: ['comunico', 'informo', 'comunicamos', 'informamos'],
    patterns: [
      /comunic[oa]mos?\s+que/i,
      /inform[oa]mos?\s+que/i,
      /comunicado\s+d[oa]\s+pregoeiro/i,
    ],
    description: 'Comunicado geral do pregoeiro',
    enabledByDefault: false,
  },
  {
    id: 'adiamento',
    label: 'Adiamento',
    icon: 'calendar-clock',
    severity: 'info',
    keywords: ['adiada', 'adiamento', 'reagendada', 'nova data'],
    patterns: [
      /adiad[oa]/i,
      /adiamento/i,
      /reagendad[oa]/i,
      /nova\s+data/i,
      /remarcad[oa]/i,
    ],
    description: 'Sessão foi adiada ou reagendada',
    enabledByDefault: false,
  },

  // ══════════════════════════════════════
  // 🔒 CLOSURE — Encerramento do processo
  // ══════════════════════════════════════
  {
    id: 'encerramento_processo',
    label: 'Encerramento do Processo',
    icon: 'lock',
    severity: 'closure',
    keywords: [
      'homologado', 'homologada', 'homologação',
      'cancelado', 'cancelada', 'cancelamento',
      'anulado', 'anulada', 'anulação',
      'revogado', 'revogada', 'revogação',
      'deserto', 'deserta',
      'fracassado', 'fracassada',
      'licitação encerrada', 'processo encerrado',
    ],
    patterns: [
      /homologa[çc][ãa]o\s+(d[oa]\s+)?processo/i,
      /processo\s+homologad[oa]/i,
      /cancelamento\s+(d[oa]\s+)?licita/i,
      /licita[çc][ãa]o\s+cancelad[oa]/i,
      /processo\s+cancelad[oa]/i,
      /anula[çc][ãa]o\s+(d[oa]\s+)?processo/i,
      /processo\s+anulad[oa]/i,
      /revoga[çc][ãa]o\s+(d[oa]\s+)?processo/i,
      /processo\s+revogad[oa]/i,
      /licita[çc][ãa]o\s+(declarad[oa]\s+)?desert[oa]/i,
      /licita[çc][ãa]o\s+(declarad[oa]\s+)?fracassad[oa]/i,
      /licita[çc][ãa]o\s+encerrad[oa]/i,
      /processo\s+encerrad[oa]/i,
    ],
    description: 'Processo encerrado (homologado, cancelado, anulado, revogado, deserto ou fracassado)',
    enabledByDefault: true,
    isClosureCategory: true,
  },
];

/** IDs de todas as categorias habilitadas por padrão */
export const DEFAULT_ENABLED_CATEGORIES = ALERT_TAXONOMY
  .filter(c => c.enabledByDefault)
  .map(c => c.id);

/** Busca uma categoria pelo ID */
export function getCategoryById(id: string): AlertCategory | undefined {
  return ALERT_TAXONOMY.find(c => c.id === id);
}

/** Retorna categorias agrupadas por severidade */
export function getCategoriesBySeverity(): Record<AlertSeverity, AlertCategory[]> {
  return {
    critical: ALERT_TAXONOMY.filter(c => c.severity === 'critical'),
    warning: ALERT_TAXONOMY.filter(c => c.severity === 'warning'),
    info: ALERT_TAXONOMY.filter(c => c.severity === 'info'),
    closure: ALERT_TAXONOMY.filter(c => c.severity === 'closure'),
  };
}
