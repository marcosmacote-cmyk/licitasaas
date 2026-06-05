/**
 * insumoClassifier.ts — Motor de Classificação Inteligente de Insumos
 *
 * Classifica insumos em categorias (MAO_DE_OBRA, MATERIAL, EQUIPAMENTO, SERVICO)
 * usando dicionário de palavras-chave + heurísticas por unidade.
 *
 * Retorna tipo + confiança + origem da classificação.
 */

// ═══════════════════════════════════════════════════════════
// TIPOS
// ═══════════════════════════════════════════════════════════

export type InsumoCategoria = 'MATERIAL' | 'MAO_DE_OBRA' | 'EQUIPAMENTO' | 'SERVICO';

export type ClassificationConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export type ClassificationSource =
    | 'DICTIONARY'       // Matched a keyword in the dictionary
    | 'UNIT_HEURISTIC'   // Inferred from unit + context
    | 'DATABASE'         // Preserved from official database type
    | 'MANUAL'           // Set by user manually
    | 'DEFAULT';         // Fallback (no match found)

export interface TypeClassification {
    type: InsumoCategoria;
    confidence: ClassificationConfidence;
    source: ClassificationSource;
    matchedKeyword?: string;   // The keyword that triggered the match
}

// ═══════════════════════════════════════════════════════════
// DICIONÁRIO DE PALAVRAS-CHAVE (80+ termos)
// ═══════════════════════════════════════════════════════════

/**
 * Keywords are matched against the NORMALIZED description (lowercase, no accents).
 * Order matters: first match wins within each category.
 * Multi-word entries must appear as substrings in the description.
 */
const DICTIONARY: Record<InsumoCategoria, string[]> = {
    MAO_DE_OBRA: [
        // Profissões específicas
        'pedreiro', 'servente', 'mestre de obras', 'eletricista', 'encanador',
        'pintor', 'carpinteiro', 'armador', 'soldador', 'montador',
        'bombeiro hidraulico', 'bombeiro hidr', 'apontador', 'almoxarife',
        'calceteiro', 'marmorista', 'vidraceiro', 'serralheiro', 'gesseiro',
        'azulejista', 'ladrilhista', 'impermeabilizador', 'poceiro',
        'topografo', 'nivelador', 'laboratorista',
        // Qualificações genéricas
        'engenheiro civil', 'engenheiro eletric', 'engenheiro mecanico',
        'engenheiro de seguranca', 'engenheiro sanitarista',
        'tecnico de seguranca', 'tecnico em edificacoes', 'tecnico em eletric',
        'tecnico em eletrotecnic', 'eletrotecnico',
        // Cargo/função
        'encarregado', 'operador de maquina', 'operador de equip',
        'operador de betoneira', 'operador de guincho', 'operador de grua',
        'motorista de caminhao', 'motorista',
        'vigia', 'vigilante', 'auxiliar de escritorio', 'auxiliar de topografia',
        // Termos compostos comuns
        'ajudante', 'meio oficial', 'oficial',
        'mao de obra', 'mao-de-obra',
        // Encargos/benefícios (tratados como MO)
        'encargos complementares', 'encargos sociais',
        'alimentacao - mensalista', 'alimentacao (coletivo',
        'transporte - mensalista', 'transporte (coletivo',
        'vale transporte', 'vale alimentacao',
        'epi ', 'equipamento de protecao individual',
        // Termos de "mensalista" / "horista" que indicam MO
        'mensalista', 'horista',
    ],

    EQUIPAMENTO: [
        // Veículos e máquinas pesadas
        'betoneira', 'retroescavadeira', 'escavadeira', 'pa carregadeira',
        'trator', 'motoniveladora', 'rolo compactador', 'rolo compressor',
        'caminhao basculante', 'caminhao carroceria', 'caminhao pipa',
        'caminhao munk', 'caminhao munck', 'caminhao guindauto',
        'caminhonete', 'caminhoneta', 'veiculo utilitario',
        'veiculo com um cesto', 'cesto aereo',
        // Equipamentos menores
        'vibrador de imersao', 'vibrador de concreto',
        'compactador de solos', 'placa vibratoria',
        'guindaste', 'guincho', 'grua', 'elevador de obra',
        'bomba de concreto', 'bomba submersivel', 'bomba',
        'compressor de ar', 'gerador de energia', 'gerador eletric', 'gerador',
        'serra circular', 'serra eletrica', 'furadeira',
        'martelete', 'martelo demolidor', 'rompedor',
        'andaime metalico', 'andaime tubular', 'escoramento',
        'forma metalica', 'forma de aco',
        'plataforma elevatoria', 'plataforma', 'carrinho de mao',
        'rolo compactador', 'rolo compressor', 'rolo',
        'tanque', 'grupo gerador', 'cacamba',
        // Termos genéricos de equipamento (prioridade menor)
        'equipamento', 'maquina', 'ferramenta',
        // Aluguel de equipamentos
        'aluguel de', 'locacao de',
    ],

    MATERIAL: [
        // Materiais de construção básicos
        'material de', 'materiais', 'kit de',
        'cimento portland', 'cimento', 'areia media', 'areia fina', 'areia grossa',
        'brita 1', 'brita 2', 'brita 0', 'brita graduada', 'pedra britada',
        'concreto usinado', 'concreto fck', 'concreto magro',
        'argamassa colante', 'argamassa industrializada', 'argamassa de',
        'tijolo ceramico', 'tijolo macico', 'bloco ceramico', 'bloco de concreto',
        // Aço e metais
        'aco ca-50', 'aco ca-60', 'vergalhao', 'barra de aco',
        'tela de aco', 'tela soldada', 'arame recozido', 'arame galvanizado',
        'prego', 'parafuso',
        // Tintas e revestimentos
        'tinta latex', 'tinta acrilica', 'tinta esmalte', 'tinta epoxi',
        'massa corrida', 'massa acrilica', 'selador', 'verniz', 'fundo preparador',
        // Cerâmicas e revestimentos
        'piso ceramico', 'azulejo', 'porcelanato', 'pastilha ceramica',
        'rejunte', 'rodape ceramico',
        // Tubulações
        'tubo pvc', 'tubo de pvc', 'tubo de ferro', 'tubo de cobre',
        'conexao pvc', 'joelho pvc', 'te pvc', 'luva pvc',
        // Elétrica
        'fio de cobre', 'cabo de cobre', 'cabo flexivel', 'cabo eletric',
        'eletroduto', 'disjuntor', 'tomada', 'interruptor',
        'quadro de distribuicao', 'caixa de passagem',
        'rele fotoeletrico', 'reator', 'lampada', 'luminaria', 'refletor',
        'conector', 'terminal', 'abraçadeira', 'bracadeira',
        // Iluminação pública
        'plaqueta de identificacao',
        // Madeiras
        'madeira de lei', 'tabua', 'sarrafo', 'pontalete', 'viga de madeira',
        'compensado', 'chapa de madeira', 'mdf',
        // Impermeabilização
        'manta asfaltica', 'impermeabilizante', 'primer asfaltico',
        // Coberturas
        'telha fibrocimento', 'telha ceramica', 'telha metalica', 'cumeeira',
        // Esquadrias e portas
        'porta de madeira', 'porta de aluminio', 'janela de aluminio',
        'vidro temperado', 'vidro laminado',
        // Louças e metais sanitários
        'vaso sanitario', 'bacia sanitaria', 'lavatorio', 'pia',
        'torneira', 'registro', 'sifao', 'valvula de descarga',
        // Cabos especiais
        'cabo de cobre', 'cabo pp', 'cabo sintenax',
    ],

    SERVICO: [
        // Serviços puros (raro em insumos, mas possível)
        'taxa', 'emolumento', 'licenca', 'alvara',
        'consultoria', 'projeto', 'laudo',
        'verba', 'franquia',
        'administracao local', 'administracao central',
    ],
};

/**
 * Units that strongly suggest MAO_DE_OBRA when combined with context.
 */
const LABOR_UNITS = new Set(['H', 'HORA', 'HH', 'H/H', 'DIA', 'MES', 'MÊS', 'MESES']);

/**
 * Units that strongly suggest MATERIAL.
 */
const MATERIAL_UNITS = new Set([
    'KG', 'T', 'TON', 'L', 'M', 'M2', 'M3', 'UN', 'PC', 'PÇ',
    'CJ', 'JG', 'KIT', 'GL', 'SC', 'RL', 'FLT', 'PAR', 'BD',
]);

// ═══════════════════════════════════════════════════════════
// NORMALIZAÇÃO
// ═══════════════════════════════════════════════════════════

/**
 * Remove accents, special characters, and normalizes whitespace.
 */
function normalizeText(text: string): string {
    return (text || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')  // Remove diacritics
        .replace(/[^\w\s]/g, ' ')         // Replace special chars with space
        .replace(/\s+/g, ' ')             // Collapse whitespace
        .trim();
}

// ═══════════════════════════════════════════════════════════
// CLASSIFICADOR PRINCIPAL
// ═══════════════════════════════════════════════════════════

/**
 * Classifies an insumo's type based on its description and unit.
 *
 * Priority:
 * 1. If existingType is a valid non-default type from official DB → preserve it (DATABASE source)
 * 2. Dictionary keyword match → HIGH confidence
 * 3. Unit heuristic → MEDIUM confidence
 * 4. Default fallback → LOW confidence
 *
 * @param description - Insumo description (e.g., "PEDREIRO COM ENCARGOS COMPLEMENTARES")
 * @param unit - Insumo unit (e.g., "H", "MES", "KG")
 * @param existingType - Current type in the database (if any)
 * @returns Classification result with type, confidence, and source
 */
export function classifyInsumoType(
    description: string,
    unit: string,
    existingType?: string,
): TypeClassification {
    const normalizedDesc = normalizeText(description);
    const normalizedUnit = (unit || '').toUpperCase().trim();

    // ─── Priority 1: Preserve valid DB types (not default MATERIAL) ───
    if (existingType) {
        const upper = existingType.toUpperCase().trim();
        // Only trust DB type if it's NOT the default 'MATERIAL' or if the description confirms it
        if (upper === 'MAO_DE_OBRA' || upper === 'MÃO DE OBRA' || upper === 'MAO DE OBRA') {
            return { type: 'MAO_DE_OBRA', confidence: 'HIGH', source: 'DATABASE' };
        }
        if (upper === 'EQUIPAMENTO') {
            return { type: 'EQUIPAMENTO', confidence: 'HIGH', source: 'DATABASE' };
        }
        // For MATERIAL and SERVICO from DB, still run dictionary to catch misclassifications
    }

    // ─── Priority 2: Dictionary keyword match ───
    // Check categories in priority order: MAO_DE_OBRA first (most commonly misclassified)
    const categoryOrder: InsumoCategoria[] = ['MAO_DE_OBRA', 'EQUIPAMENTO', 'MATERIAL', 'SERVICO'];

    for (const category of categoryOrder) {
        const keywords = DICTIONARY[category];
        for (const keyword of keywords) {
            const normalizedKw = normalizeText(keyword);
            if (normalizedDesc.includes(normalizedKw)) {
                if (category === 'MAO_DE_OBRA' && !LABOR_UNITS.has(normalizedUnit)) {
                    continue;
                }
                return {
                    type: category,
                    confidence: 'HIGH',
                    source: 'DICTIONARY',
                    matchedKeyword: keyword,
                };
            }
        }
    }

    // ─── Priority 3: Unit heuristic ───
    if (LABOR_UNITS.has(normalizedUnit)) {
        // Unit is H/MES/DIA — could be labor or equipment rental
        // Check for equipment keywords first (since they also use H)
        const hasEquipHint = normalizedDesc.includes('aluguel') ||
            normalizedDesc.includes('locacao') ||
            normalizedDesc.includes('veiculo') ||
            normalizedDesc.includes('caminhao') ||
            normalizedDesc.includes('maquina') ||
            normalizedDesc.includes('equipamento') ||
            normalizedDesc.includes('rolo') ||
            normalizedDesc.includes('tanque') ||
            normalizedDesc.includes('bomba') ||
            normalizedDesc.includes('gerador') ||
            normalizedDesc.includes('plataforma') ||
            normalizedDesc.includes('grupo');

        if (hasEquipHint) {
            return { type: 'EQUIPAMENTO', confidence: 'MEDIUM', source: 'UNIT_HEURISTIC' };
        }

        // Check for material keywords in hourly/monthly items (like cleaning materials monthly)
        const hasMaterialHint = normalizedDesc.includes('material') ||
            normalizedDesc.includes('materiais') ||
            normalizedDesc.includes('kit') ||
            normalizedDesc.includes('ferramenta') ||
            normalizedDesc.includes('peca') ||
            normalizedDesc.includes('peça');

        if (hasMaterialHint) {
            return { type: 'MATERIAL', confidence: 'MEDIUM', source: 'UNIT_HEURISTIC' };
        }

        // Otherwise H/MES/DIA most likely indicates labor
        return { type: 'MAO_DE_OBRA', confidence: 'MEDIUM', source: 'UNIT_HEURISTIC' };
    }

    // ─── Priority 4: Preserve existing type if reasonable ───
    if (existingType) {
        const upper = existingType.toUpperCase().trim();
        const mapped = mapExpandedType(upper);
        if (mapped) {
            return { type: mapped, confidence: 'MEDIUM', source: 'DATABASE' };
        }
    }

    // ─── Priority 5: Default fallback ───
    if (MATERIAL_UNITS.has(normalizedUnit)) {
        return { type: 'MATERIAL', confidence: 'LOW', source: 'DEFAULT' };
    }

    return { type: 'MATERIAL', confidence: 'LOW', source: 'DEFAULT' };
}

/**
 * Maps expanded/detailed types to macro categories.
 */
function mapExpandedType(type: string): InsumoCategoria | null {
    switch (type) {
        case 'MÃO DE OBRA':
        case 'MAO DE OBRA':
        case 'MAO_DE_OBRA':
        case 'ENCARGOS COMPLEMENTARES':
            return 'MAO_DE_OBRA';

        case 'MATERIAL':
        case 'EQUIPAMENTO PARA AQUISIÇÃO PERMANENTE':
        case 'EQUIPAMENTO PARA AQUISICAO PERMANENTE':
            return 'MATERIAL';

        case 'EQUIPAMENTO':
        case 'ALUGUEL':
        case 'TRANSPORTE':
            return 'EQUIPAMENTO';

        case 'SERVIÇOS':
        case 'SERVICOS':
        case 'SERVICO':
        case 'TAXAS':
        case 'ADMINISTRAÇÃO':
        case 'ADMINISTRACAO':
        case 'VERBA':
        case 'CONSULTORIA':
        case 'FRANQUIA':
        case 'OUTROS':
            return 'SERVICO';

        default:
            return null;
    }
}

/**
 * Batch classify multiple insumos.
 * Returns a map of insumoCode → classification.
 */
export function classifyInsumoBatch(
    insumos: Array<{ code: string; description: string; unit: string; type?: string }>,
): Map<string, TypeClassification> {
    const results = new Map<string, TypeClassification>();

    for (const ins of insumos) {
        const key = (ins.code || '').toUpperCase();
        results.set(key, classifyInsumoType(ins.description, ins.unit, ins.type));
    }

    return results;
}

/**
 * Checks if a type was likely set by default (MATERIAL) and should be re-evaluated.
 * Returns true if the type looks like it needs reclassification.
 */
export function needsReclassification(
    currentType: string,
    description: string,
    unit: string,
): boolean {
    const classification = classifyInsumoType(description, unit);

    // If current type is MATERIAL but classification says otherwise with high confidence
    if (currentType === 'MATERIAL' && classification.type !== 'MATERIAL' && classification.confidence === 'HIGH') {
        return true;
    }

    return false;
}
