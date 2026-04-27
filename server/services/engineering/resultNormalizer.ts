/**
 * Engineering extraction result normalizer.
 *
 * Repairs common shape drift from LLM responses before the validator runs:
 * - array returned directly instead of { engineeringItems: [...] }
 * - Portuguese/legacy field names
 * - Brazilian numeric strings
 */

export interface NormalizedEngineeringExtraction {
    engineeringItems: Array<Record<string, unknown>>;
    repaired: boolean;
    repairs: string[];
}

const ITEM_ARRAY_KEYS = [
    'engineeringItems',
    'items',
    'budgetItems',
    'itens',
    'itens_licitados',
    'planilha',
    'composicoes',
    'compositions',
];

function stripCodeFences(rawText: string): string {
    return rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
}

function parseLooseJson(rawText: string): unknown {
    const cleaned = stripCodeFences(rawText);

    try {
        return JSON.parse(cleaned);
    } catch { /* continue */ }

    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
        try {
            return JSON.parse(cleaned.substring(firstBrace, lastBrace + 1));
        } catch { /* continue */ }
    }

    const firstBracket = cleaned.indexOf('[');
    const lastBracket = cleaned.lastIndexOf(']');
    if (firstBracket !== -1 && lastBracket > firstBracket) {
        return JSON.parse(cleaned.substring(firstBracket, lastBracket + 1));
    }

    throw new Error('Resposta da IA não é JSON válido');
}

function parseNumber(value: unknown): number {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (value === null || value === undefined || value === '') return 0;

    const raw = String(value).trim();
    if (!raw) return 0;

    const cleaned = raw
        .replace(/R\$/gi, '')
        .replace(/\s/g, '')
        .replace(/[^\d,.-]/g, '');

    if (cleaned.includes(',')) {
        return Number(cleaned.replace(/\./g, '').replace(',', '.')) || 0;
    }

    return Number(cleaned) || 0;
}

function normalizeType(value: unknown): string {
    const normalized = String(value || 'COMPOSICAO')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .trim();

    if (normalized.includes('ETAPA') && !normalized.includes('SUB')) return 'ETAPA';
    if (normalized.includes('SUBETAPA')) return 'SUBETAPA';
    if (normalized.includes('INSUMO')) return 'INSUMO';
    return 'COMPOSICAO';
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function firstDefined(item: Record<string, unknown>, keys: string[]): unknown {
    for (const key of keys) {
        if (item[key] !== undefined && item[key] !== null && item[key] !== '') {
            return item[key];
        }
    }
    return undefined;
}

function extractItems(payload: unknown, repairs: string[]): Array<Record<string, unknown>> {
    if (Array.isArray(payload)) {
        repairs.push('payload_array_wrapped');
        return payload.map(asRecord);
    }

    const record = asRecord(payload);
    for (const key of ITEM_ARRAY_KEYS) {
        if (Array.isArray(record[key])) {
            if (key !== 'engineeringItems') repairs.push(`array_key:${key}->engineeringItems`);
            return record[key].map(asRecord);
        }
    }

    return [];
}

export function normalizeEngineeringItems(items: Array<Record<string, unknown>>): NormalizedEngineeringExtraction {
    const repairs: string[] = [];

    const engineeringItems = (items || []).map((item, index) => {
        const normalized = {
            ...item,
            item: String(firstDefined(item, ['item', 'itemNumber', 'numero', 'n', 'ordem']) ?? `${index + 1}`),
            type: normalizeType(firstDefined(item, ['type', 'tipo', 'classification'])),
            sourceName: String(firstDefined(item, ['sourceName', 'sourceBase', 'base', 'fonte', 'banco']) || 'PROPRIA').toUpperCase(),
            code: String(firstDefined(item, ['code', 'sourceCode', 'codigo', 'cod', 'codigoServico']) || ''),
            description: String(firstDefined(item, ['description', 'descricao', 'descrição', 'servico', 'serviço', 'nome']) || ''),
            unit: String(firstDefined(item, ['unit', 'unidade', 'unid', 'und']) || ''),
            quantity: parseNumber(firstDefined(item, ['quantity', 'quantidade', 'qtd', 'qty'])),
            unitCost: parseNumber(firstDefined(item, [
                'unitCost',
                'unitPrice',
                'precoUnitario',
                'preçoUnitario',
                'preco_unitario',
                'custoUnitario',
                'referencePrice',
            ])),
        };

        if (normalized.type === 'ETAPA' || normalized.type === 'SUBETAPA') {
            normalized.quantity = 0;
            normalized.unitCost = 0;
            normalized.unit = '';
        }

        if (normalized.item !== item.item) repairs.push(`item:${index}`);
        if (normalized.unitCost !== item.unitCost) repairs.push(`unitCost:${normalized.item}`);
        if (normalized.quantity !== item.quantity) repairs.push(`quantity:${normalized.item}`);

        return normalized;
    });

    return {
        engineeringItems,
        repaired: repairs.length > 0,
        repairs,
    };
}

export function parseAndNormalizeEngineeringExtraction(rawText: string): NormalizedEngineeringExtraction {
    const repairs: string[] = [];
    const payload = parseLooseJson(rawText);
    const items = extractItems(payload, repairs);
    const normalized = normalizeEngineeringItems(items);

    return {
        engineeringItems: normalized.engineeringItems,
        repaired: repairs.length > 0 || normalized.repaired,
        repairs: [...repairs, ...normalized.repairs],
    };
}
