/**
 * compositionCategorizer.ts — Classificador de Categorias de Composição
 *
 * Classifica composições em categorias (FUNDACOES, ESTRUTURA_CONCRETO, etc.)
 * usando dicionário de palavras-chave por descrição + heurísticas por código.
 *
 * Mesmo padrão arquitetural do insumoClassifier.ts.
 */

// ═══════════════════════════════════════════════════════════
// TIPOS
// ═══════════════════════════════════════════════════════════

export type CompositionCategory =
    | 'ADMINISTRACAO'
    | 'SERVICOS_PRELIMINARES'
    | 'MOVIMENTO_TERRA'
    | 'FUNDACOES'
    | 'ESTRUTURA_CONCRETO'
    | 'ESTRUTURA_METALICA'
    | 'ALVENARIA_VEDACAO'
    | 'REVESTIMENTO'
    | 'COBERTURA'
    | 'INSTALACOES_ELETRICAS'
    | 'INSTALACOES_HIDRAULICAS'
    | 'PINTURA'
    | 'ESQUADRIAS'
    | 'PAVIMENTACAO'
    | 'DRENAGEM'
    | 'SINALIZACAO'
    | 'GERAL';

export const CATEGORY_LABELS: Record<CompositionCategory, string> = {
    ADMINISTRACAO: 'Administração',
    SERVICOS_PRELIMINARES: 'Serviços Preliminares',
    MOVIMENTO_TERRA: 'Movimento de Terra',
    FUNDACOES: 'Fundações',
    ESTRUTURA_CONCRETO: 'Estrutura de Concreto',
    ESTRUTURA_METALICA: 'Estrutura Metálica',
    ALVENARIA_VEDACAO: 'Alvenaria e Vedação',
    REVESTIMENTO: 'Revestimento',
    COBERTURA: 'Cobertura',
    INSTALACOES_ELETRICAS: 'Instalações Elétricas',
    INSTALACOES_HIDRAULICAS: 'Instalações Hidráulicas',
    PINTURA: 'Pintura',
    ESQUADRIAS: 'Esquadrias',
    PAVIMENTACAO: 'Pavimentação',
    DRENAGEM: 'Drenagem',
    SINALIZACAO: 'Sinalização',
    GERAL: 'Geral',
};

export const CATEGORY_COLORS: Record<CompositionCategory, string> = {
    ADMINISTRACAO: '#64748b',
    SERVICOS_PRELIMINARES: '#8b5cf6',
    MOVIMENTO_TERRA: '#a16207',
    FUNDACOES: '#b45309',
    ESTRUTURA_CONCRETO: '#0369a1',
    ESTRUTURA_METALICA: '#475569',
    ALVENARIA_VEDACAO: '#c2410c',
    REVESTIMENTO: '#0d9488',
    COBERTURA: '#9333ea',
    INSTALACOES_ELETRICAS: '#eab308',
    INSTALACOES_HIDRAULICAS: '#0891b2',
    PINTURA: '#e11d48',
    ESQUADRIAS: '#7c3aed',
    PAVIMENTACAO: '#65a30d',
    DRENAGEM: '#0284c7',
    SINALIZACAO: '#f97316',
    GERAL: '#94a3b8',
};

export type CategoryConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface CategoryClassification {
    category: CompositionCategory;
    confidence: CategoryConfidence;
    matchedKeyword?: string;
}

// ═══════════════════════════════════════════════════════════
// DICIONÁRIO DE PALAVRAS-CHAVE POR CATEGORIA
// ═══════════════════════════════════════════════════════════

const CATEGORY_DICTIONARY: Record<CompositionCategory, string[]> = {
    ADMINISTRACAO: [
        'administracao local', 'administracao central', 'administracao da obra',
        'mobilizacao e desmobilizacao', 'mobilizacao', 'desmobilizacao',
        'canteiro de obras', 'instalacao do canteiro', 'barracoes',
        'placa de obra', 'placa da obra',
        'seguranca do trabalho', 'equipamentos de protecao',
        'engenheiro residente', 'equipe tecnica',
    ],
    SERVICOS_PRELIMINARES: [
        'servicos preliminares', 'servico preliminar',
        'limpeza do terreno', 'limpeza de terreno', 'rocada', 'capina',
        'demolicao', 'remocao de entulho', 'retirada de entulho',
        'locacao de obra', 'locacao da obra',
        'tapume', 'cerca provisoria', 'isolamento de area',
        'sondagem', 'levantamento topografico', 'topografia',
        'projeto executivo', 'projeto arquitetonico',
    ],
    MOVIMENTO_TERRA: [
        'escavacao', 'escavacao mecanica', 'escavacao manual',
        'aterro compactado', 'aterro', 'reaterro',
        'terraplenagem', 'terraplanagem',
        'corte e aterro', 'bota-fora', 'bota fora',
        'compactacao de solo', 'compactacao do solo', 'compactacao mecanica',
        'regularizacao do subleito', 'regularizacao de subleito',
        'movimento de terra',
    ],
    FUNDACOES: [
        'fundacao', 'fundacoes', 'fundacao profunda', 'fundacao rasa',
        'estaca', 'estaca pre-moldada', 'estaca helier', 'estaca raiz',
        'estaca broca', 'estacas',
        'sapata', 'sapata corrida', 'sapata isolada',
        'bloco de coroamento', 'bloco de fundacao',
        'radier', 'baldrames', 'baldrame',
        'viga baldrame', 'cintamento',
        'tubulao', 'tubuloes',
    ],
    ESTRUTURA_CONCRETO: [
        'concreto armado', 'concreto usinado', 'concreto magro',
        'lancamento de concreto', 'concretagem',
        'forma de madeira', 'forma para', 'formas',
        'armacao de aco', 'armacao de ferro', 'armadura',
        'laje pre-moldada', 'laje macica', 'laje nervurada', 'laje',
        'viga de concreto', 'pilar de concreto',
        'estrutura de concreto', 'estrutura concreto',
        'verga', 'contraverga', 'cinta de amarracao',
    ],
    ESTRUTURA_METALICA: [
        'estrutura metalica', 'estrutura de aco',
        'perfil metalico', 'viga metalica', 'pilar metalico',
        'trelica metalica', 'trelica de aco',
        'terça metalica', 'terca metalica',
        'soldagem', 'solda eletrica',
        'galvanizacao',
    ],
    ALVENARIA_VEDACAO: [
        'alvenaria', 'alvenaria de vedacao', 'alvenaria de embasamento',
        'bloco ceramico', 'bloco de concreto', 'tijolo',
        'parede de alvenaria', 'parede de gesso',
        'drywall', 'divisoria',
        'cobogo', 'elemento vazado', 'muxarabi',
        'muro de alvenaria', 'muro de arrimo', 'muro',
    ],
    REVESTIMENTO: [
        'revestimento', 'reboco', 'emboço', 'emboco',
        'chapisco', 'massa unica',
        'piso ceramico', 'piso porcelanato', 'piso vinilico', 'piso',
        'azulejo', 'ceramica de parede', 'revestimento ceramico',
        'contrapiso', 'regularizacao de piso',
        'rodape', 'soleira', 'peitoril',
        'forro de gesso', 'forro de pvc', 'forro',
        'granito', 'marmore',
        'argamassa colante', 'rejuntamento', 'rejunte',
    ],
    COBERTURA: [
        'cobertura', 'telhado', 'telhamento',
        'telha ceramica', 'telha fibrocimento', 'telha metalica', 'telha',
        'cumeeira', 'rufo', 'calha',
        'estrutura de madeira para telhado', 'madeiramento',
        'tesoura de madeira', 'caibro', 'ripa',
        'impermeabilizacao de laje', 'impermeabilizacao de cobertura',
        'manta asfaltica', 'impermeabilizacao',
    ],
    INSTALACOES_ELETRICAS: [
        'instalacao eletrica', 'instalacoes eletricas',
        'eletroduto', 'condulete',
        'fio', 'cabo eletric', 'cabo de cobre',
        'disjuntor', 'quadro de distribuicao', 'qd ',
        'tomada', 'interruptor', 'ponto eletrico',
        'luminaria', 'lampada', 'refletor', 'iluminacao',
        'aterramento', 'spda', 'para-raios',
        'caixa de passagem eletric',
        'subestacao', 'transformador',
    ],
    INSTALACOES_HIDRAULICAS: [
        'instalacao hidraulica', 'instalacoes hidraulicas',
        'instalacao hidrosanitaria', 'instalacoes hidrosanitarias',
        'tubo pvc', 'tubulacao', 'encanamento',
        'registro', 'valvula', 'torneira',
        'caixa d\'agua', 'caixa dagua', 'reservatorio',
        'vaso sanitario', 'bacia sanitaria', 'lavatorio', 'pia',
        'esgoto', 'fossa', 'sumidouro',
        'agua fria', 'agua quente',
        'sifao', 'ralo', 'caixa sifonada',
        'bomba hidraulica', 'pressurizador',
        'incendio', 'hidrante', 'sprinkler',
    ],
    PINTURA: [
        'pintura', 'pinturas',
        'tinta latex', 'tinta acrilica', 'tinta esmalte', 'tinta epoxi',
        'massa corrida', 'massa pva', 'massa acrilica',
        'selador', 'fundo preparador',
        'textura', 'grafiato',
        'verniz', 'stain',
        'emassamento', 'lixamento',
        'aplicacao de tinta', 'demao de tinta',
    ],
    ESQUADRIAS: [
        'esquadria', 'esquadrias',
        'porta de madeira', 'porta de aluminio', 'porta de vidro', 'porta',
        'janela de aluminio', 'janela de vidro', 'janela',
        'vidro temperado', 'vidro laminado', 'vidracaria',
        'fechadura', 'dobradica', 'puxador',
        'batente', 'marco', 'alizar', 'guarnicao',
        'portao', 'grade', 'gradil',
        'persiana', 'veneziana',
    ],
    PAVIMENTACAO: [
        'pavimentacao', 'pavimento',
        'asfalto', 'capa asfaltica', 'cbuq', 'concreto betuminoso',
        'piso intertravado', 'bloquete', 'paver',
        'meio-fio', 'meio fio', 'guia',
        'sarjeta', 'sarjetao',
        'base de brita', 'sub-base', 'base de solo',
        'imprimacao', 'pintura de ligacao',
        'fresagem', 'recapeamento',
        'calcada', 'passeio', 'rampa de acessibilidade',
    ],
    DRENAGEM: [
        'drenagem', 'dreno',
        'caixa de drenagem', 'poco de visita', 'pv ',
        'bueiro', 'boca de lobo', 'boca de leao',
        'galeria de aguas pluviais', 'galeria pluvial',
        'tubo de concreto para drenagem', 'manilha',
        'valeta', 'canaleta de drenagem',
        'geocomposto drenante', 'geotextil',
        'dissipador de energia',
    ],
    SINALIZACAO: [
        'sinalizacao', 'sinalização',
        'placa de sinalizacao', 'placa de transito',
        'pintura de faixa', 'faixa de pedestre',
        'defensa metalica', 'guard rail',
        'tacha refletiva', 'tachao',
        'sinalizacao horizontal', 'sinalizacao vertical',
        'semaforo',
    ],
    GERAL: [],  // Default — never matched by keywords
};

// ═══════════════════════════════════════════════════════════
// NORMALIZAÇÃO
// ═══════════════════════════════════════════════════════════

function normalizeText(text: string): string {
    return (text || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// ═══════════════════════════════════════════════════════════
// CLASSIFICADOR PRINCIPAL
// ═══════════════════════════════════════════════════════════

/**
 * Classifies a composition into a category based on its description.
 *
 * @param description - Composition description (e.g., "EXECUÇÃO DE ALVENARIA COM BLOCO CERÂMICO")
 * @param code - Optional composition code for SINAPI-based heuristics
 * @returns Classification result with category, confidence, and matched keyword
 */
export function classifyComposition(
    description: string,
    code?: string,
): CategoryClassification {
    const normalizedDesc = normalizeText(description);

    // ─── Priority 1: Dictionary keyword match ───
    const categories = Object.keys(CATEGORY_DICTIONARY) as CompositionCategory[];
    for (const category of categories) {
        if (category === 'GERAL') continue;
        const keywords = CATEGORY_DICTIONARY[category];
        for (const keyword of keywords) {
            const normalizedKw = normalizeText(keyword);
            if (normalizedKw && normalizedDesc.includes(normalizedKw)) {
                return {
                    category,
                    confidence: 'HIGH',
                    matchedKeyword: keyword,
                };
            }
        }
    }

    // ─── Priority 2: SINAPI code range heuristic ───
    if (code) {
        const numericCode = parseInt(code.replace(/\D/g, ''), 10);
        if (!isNaN(numericCode)) {
            const codeCategory = classifyByCodeRange(numericCode);
            if (codeCategory) {
                return { category: codeCategory, confidence: 'MEDIUM' };
            }
        }
    }

    // ─── Default ───
    return { category: 'GERAL', confidence: 'LOW' };
}

/**
 * SINAPI code range heuristics.
 * Based on SINAPI's organizational structure.
 */
function classifyByCodeRange(code: number): CompositionCategory | null {
    // These ranges are approximate and based on typical SINAPI organization
    if (code >= 73000 && code < 74000) return 'INSTALACOES_ELETRICAS';
    if (code >= 74000 && code < 75000) return 'INSTALACOES_HIDRAULICAS';
    if (code >= 87000 && code < 88000) return 'ALVENARIA_VEDACAO';
    if (code >= 88000 && code < 89000) return 'REVESTIMENTO';
    if (code >= 89000 && code < 90000) return 'PINTURA';
    if (code >= 91000 && code < 92000) return 'COBERTURA';
    if (code >= 92000 && code < 93000) return 'ESTRUTURA_CONCRETO';
    if (code >= 94000 && code < 95000) return 'ESQUADRIAS';
    if (code >= 96000 && code < 97000) return 'PAVIMENTACAO';
    return null;
}

/**
 * Batch classify multiple compositions.
 */
export function classifyCompositionBatch(
    compositions: Array<{ code: string; description: string }>,
): Map<string, CategoryClassification> {
    const results = new Map<string, CategoryClassification>();
    for (const comp of compositions) {
        results.set(comp.code, classifyComposition(comp.description, comp.code));
    }
    return results;
}
