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

function tryParseJson<T = unknown>(value: string): T | null {
    try {
        return JSON.parse(value) as T;
    } catch {
        return null;
    }
}

function findTopLevelArrayObjects(rawText: string, arrayKey?: string): Array<Record<string, unknown>> {
    const cleaned = stripCodeFences(rawText);
    const searchStart = arrayKey ? cleaned.search(new RegExp(`"${arrayKey}"\\s*:`)) : 0;
    if (searchStart < 0) return [];

    const arrayStart = cleaned.indexOf('[', searchStart);
    if (arrayStart < 0) return [];

    const objects: Array<Record<string, unknown>> = [];
    let depth = 0;
    let objectStart = -1;
    let inString = false;
    let escaped = false;

    for (let i = arrayStart + 1; i < cleaned.length; i++) {
        const char = cleaned[i];

        if (escaped) {
            escaped = false;
            continue;
        }

        if (char === '\\' && inString) {
            escaped = true;
            continue;
        }

        if (char === '"') {
            inString = !inString;
            continue;
        }

        if (inString) continue;

        if (char === '{') {
            if (depth === 0) objectStart = i;
            depth++;
            continue;
        }

        if (char === '}') {
            if (depth <= 0) continue;
            depth--;
            if (depth === 0 && objectStart >= 0) {
                const candidate = cleaned.substring(objectStart, i + 1)
                    .replace(/,\s*([}\]])/g, '$1');
                const parsed = tryParseJson<Record<string, unknown>>(candidate);
                if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                    objects.push(parsed);
                }
                objectStart = -1;
            }
        }

        if (char === ']' && depth === 0 && objects.length > 0) break;
    }

    const seen = new Set(objects.map(object => JSON.stringify(object)));
    const arrayEnd = cleaned.indexOf(']', arrayStart + 1);
    const arrayBody = cleaned.substring(arrayStart + 1, arrayEnd > arrayStart ? arrayEnd : cleaned.length);
    const flatObjectMatches = arrayBody.match(/\{[^{}]*\}/gs) || [];

    for (const match of flatObjectMatches) {
        const candidate = match.replace(/,\s*([}\]])/g, '$1');
        const parsed = tryParseJson<Record<string, unknown>>(candidate);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue;

        const signature = JSON.stringify(parsed);
        if (!seen.has(signature)) {
            objects.push(parsed);
            seen.add(signature);
        }
    }

    return objects;
}

function salvageItemsFromMalformedJson(rawText: string, repairs: string[]): unknown | null {
    for (const key of ITEM_ARRAY_KEYS) {
        const objects = findTopLevelArrayObjects(rawText, key);
        if (objects.length > 0) {
            repairs.push(`salvaged_array:${key}:${objects.length}`);
            return { engineeringItems: objects };
        }
    }

    const objects = findTopLevelArrayObjects(rawText);
    if (objects.length > 0) {
        repairs.push(`salvaged_array:unknown:${objects.length}`);
        return objects;
    }

    return null;
}

function parseLooseJson(rawText: string, repairs: string[]): unknown {
    const cleaned = stripCodeFences(rawText);

    const direct = tryParseJson(cleaned);
    if (direct) return direct;

    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
        const parsed = tryParseJson(cleaned.substring(firstBrace, lastBrace + 1));
        if (parsed) return parsed;
    }

    const firstBracket = cleaned.indexOf('[');
    const lastBracket = cleaned.lastIndexOf(']');
    if (firstBracket !== -1 && lastBracket > firstBracket) {
        const parsed = tryParseJson(cleaned.substring(firstBracket, lastBracket + 1));
        if (parsed) return parsed;
    }

    const salvaged = salvageItemsFromMalformedJson(cleaned, repairs);
    if (salvaged) return salvaged;

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
    const payload = parseLooseJson(rawText, repairs);
    const items = extractItems(payload, repairs);
    const normalized = normalizeEngineeringItems(items);

    return {
        engineeringItems: normalized.engineeringItems,
        repaired: repairs.length > 0 || normalized.repaired,
        repairs: [...repairs, ...normalized.repairs],
    };
}
