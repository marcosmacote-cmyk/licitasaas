/**
 * Deterministic row candidate extraction for engineering budget OCR.
 *
 * This does not try to understand the budget. It creates a coverage manifest
 * from OCR/markdown so the LLM can be asked to process bounded row ids instead
 * of an unbounded multi-page document.
 */

export interface BudgetRowCandidate {
    rowId: string;
    pageNumber: number;
    lineNumber: number;
    rawLine: string;
    rawCells: string[];
    itemNumberHint?: string;
    signals: {
        hasItemNumber: boolean;
        hasOfficialCode: boolean;
        hasUnit: boolean;
        numericCellCount: number;
        likelyHeader: boolean;
        likelySubtotal: boolean;
    };
    confidence: number;
}

export interface BudgetRowBatch {
    index: number;
    total: number;
    candidates: BudgetRowCandidate[];
}

export interface BudgetRowCandidateExtraction {
    candidates: BudgetRowCandidate[];
    pageCount: number;
    rejectedLineCount: number;
    /** First table header line detected (e.g. "ITEM | CÓDIGO | DESCRIÇÃO | UNID | QTD | PREÇO UNIT...") */
    tableHeader: string | null;
}

const UNIT_PATTERN = /\b(?:M2|M²|M3|M³|M|UN|UND|UNID|VB|CJ|GL|KG|G|T|TON|L|H|HR|HORA|MES|M[EÊ]S|DIA|KM|HA|PCT|PAR|JG|KWH)\b/i;
const OFFICIAL_CODE_PATTERN = /\b(?:C\d{3,6}|\d{1,6}\/ORSE|\d{5,7}|CP[-\s]?\d+|CPU[-\s]?\d+)\b/i;
const BRAZILIAN_NUMBER_PATTERN = /(?:\d{1,3}(?:\.\d{3})*,\d{2,4}|\d+,\d{2,4})/g;
const BRAZILIAN_NUMBER_TEST_PATTERN = /(?:\d{1,3}(?:\.\d{3})*,\d{2,4}|\d+,\d{2,4})/;
const ITEM_NUMBER_PATTERN = /^\s*(?:\|+\s*)?(?:item\s*)?(\d+(?:[.,]\d+){0,6})(?:\s|\||-|$)/i;

const HEADER_WORDS = [
    'administracao', 'servicos', 'servicos preliminares', 'infraestrutura',
    'superestrutura', 'fundacao', 'fundacoes', 'pavimentacao', 'drenagem',
    'terraplenagem', 'instalacoes', 'cobertura', 'revestimento', 'pintura',
];

const TABLE_HEADER_PATTERNS = [
    /\bitem\b.*\bc[oó]digo\b.*\bdescri/i,
    /\bdescri[cç][aã]o\b.*\bunid/i,
    /\bquantidade\b.*\bpre[cç]o/i,
    /\bpre[cç]o\s+unit/i,
];

const NEGATIVE_PATTERNS = [
    /\bcronograma\s+f[ií]sico/i,
    /\b30\s+dias\b|\b60\s+dias\b|\b90\s+dias\b|\b120\s+dias\b/i,
    /\bmemorial\s+descritivo\b/i,
    /\bespecifica[cç][oõ]es?\s+de\s+servi[cç]os\b/i,
    /\blicitante\b.*\bdever[aá]\b/i,
    /\bhabilita[cç][aã]o\b|\batestado\b/i,
];

const SUBTOTAL_PATTERNS = [
    /^\s*(?:\|+\s*)?(?:sub[-\s]?total|total\s+geral|valor\s+global)\b/i,
    /\btotal\s+geral\b/i,
];

function normalizeText(value: string): string {
    return value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
}

function splitMarkdownPages(markdown: string): Array<{ pageNumber: number; content: string }> {
    const pageMarker = /\n?══ Página\s+(\d+)[^\n]*══\n?/g;
    const pages: Array<{ pageNumber: number; content: string }> = [];
    let match: RegExpExecArray | null;
    let lastIndex = 0;
    let lastPageNumber: number | null = null;

    while ((match = pageMarker.exec(markdown)) !== null) {
        if (lastPageNumber !== null) {
            pages.push({
                pageNumber: lastPageNumber,
                content: markdown.slice(lastIndex, match.index),
            });
        }

        lastPageNumber = Number(match[1]) || pages.length + 1;
        lastIndex = pageMarker.lastIndex;
    }

    if (lastPageNumber !== null) {
        pages.push({
            pageNumber: lastPageNumber,
            content: markdown.slice(lastIndex),
        });
    }

    if (pages.length > 0) return pages;
    return [{ pageNumber: 1, content: markdown }];
}

function splitCells(line: string): string[] {
    const trimmed = line.trim();
    if (!trimmed) return [];

    if (trimmed.includes('|')) {
        return trimmed
            .split('|')
            .map(cell => cell.trim())
            .filter(Boolean);
    }

    return trimmed
        .split(/\s{2,}/)
        .map(cell => cell.trim())
        .filter(Boolean);
}

function isMarkdownSeparator(line: string): boolean {
    return /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line);
}

function countNumericCells(line: string, cells: string[]): number {
    const cellMatches = cells.filter(cell => BRAZILIAN_NUMBER_TEST_PATTERN.test(cell)).length;
    BRAZILIAN_NUMBER_PATTERN.lastIndex = 0;
    const lineMatches = line.match(BRAZILIAN_NUMBER_PATTERN)?.length || 0;
    return Math.max(cellMatches, lineMatches);
}

function getItemNumberHint(line: string, cells: string[]): string | undefined {
    const firstCell = cells[0] || line;
    const direct = firstCell.match(ITEM_NUMBER_PATTERN) || line.match(ITEM_NUMBER_PATTERN);
    if (!direct) return undefined;
    return direct[1].replace(/,/g, '.');
}

function looksLikeUppercaseHeader(line: string, normalized: string): boolean {
    const letters = line.replace(/[^A-Za-zÀ-ÿ]/g, '');
    if (letters.length < 6) return false;
    const upperLetters = letters.replace(/[^A-ZÀ-Ý]/g, '');
    const upperRatio = upperLetters.length / letters.length;
    if (upperRatio < 0.75) return false;
    return HEADER_WORDS.some(word => normalized.includes(word));
}

function scoreCandidate(line: string): Omit<BudgetRowCandidate, 'rowId' | 'pageNumber' | 'lineNumber'> | null {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length < 4) return null;
    if (isMarkdownSeparator(trimmed)) return null;

    const normalized = normalizeText(trimmed);
    if (NEGATIVE_PATTERNS.some(pattern => pattern.test(trimmed))) return null;
    if (TABLE_HEADER_PATTERNS.some(pattern => pattern.test(trimmed))) return null;

    const rawCells = splitCells(trimmed);
    const itemNumberHint = getItemNumberHint(trimmed, rawCells);
    const hasItemNumber = Boolean(itemNumberHint);
    const hasOfficialCode = OFFICIAL_CODE_PATTERN.test(trimmed);
    const hasUnit = UNIT_PATTERN.test(trimmed);
    const numericCellCount = countNumericCells(trimmed, rawCells);
    const likelySubtotal = SUBTOTAL_PATTERNS.some(pattern => pattern.test(trimmed));
    const likelyHeader = Boolean(
        hasItemNumber &&
        !hasOfficialCode &&
        !hasUnit &&
        numericCellCount <= 1 &&
        (looksLikeUppercaseHeader(trimmed, normalized) || rawCells.length <= 3)
    );

    let confidence = 0;
    if (hasItemNumber) confidence += 35;
    if (hasOfficialCode) confidence += 25;
    if (hasUnit) confidence += 18;
    confidence += Math.min(numericCellCount * 8, 24);
    if (likelyHeader) confidence += 18;
    if (rawCells.length >= 5) confidence += 12;
    if (likelySubtotal) confidence -= 25;
    if (normalized.includes('servente') && normalized.includes('pedreiro') && !hasItemNumber) confidence -= 18;

    if (confidence < 35) return null;

    return {
        rawLine: trimmed,
        rawCells,
        itemNumberHint,
        signals: {
            hasItemNumber,
            hasOfficialCode,
            hasUnit,
            numericCellCount,
            likelyHeader,
            likelySubtotal,
        },
        confidence: Math.max(0, Math.min(100, confidence)),
    };
}

export function extractBudgetRowCandidatesFromMarkdown(markdown: string): BudgetRowCandidateExtraction {
    const pages = splitMarkdownPages(markdown);
    const candidates: BudgetRowCandidate[] = [];
    let rejectedLineCount = 0;
    let tableHeader: string | null = null;

    for (const page of pages) {
        const lines = page.content.split(/\r?\n/);
        lines.forEach((line, index) => {
            // Capture the first table header for column-order context
            if (!tableHeader && TABLE_HEADER_PATTERNS.some(p => p.test(line))) {
                tableHeader = line.trim();
            }

            const scored = scoreCandidate(line);
            if (!scored) {
                if (line.trim().length > 0) rejectedLineCount++;
                return;
            }

            candidates.push({
                ...scored,
                rowId: `ocr-p${page.pageNumber}-r${index + 1}`,
                pageNumber: page.pageNumber,
                lineNumber: index + 1,
            });
        });
    }

    return {
        candidates,
        pageCount: pages.length,
        rejectedLineCount,
        tableHeader,
    };
}

export function buildBudgetRowCandidateBatches(candidates: BudgetRowCandidate[], batchSize = 25): BudgetRowBatch[] {
    const batches: BudgetRowBatch[] = [];
    const total = Math.ceil(candidates.length / batchSize);
    for (let i = 0; i < total; i++) {
        batches.push({
            index: i + 1,
            total,
            candidates: candidates.slice(i * batchSize, (i + 1) * batchSize),
        });
    }
    return batches;
}

export function formatBudgetRowCandidatesForPrompt(candidates: BudgetRowCandidate[]): string {
    return candidates.map(candidate => {
        const cells = candidate.rawCells.length > 1
            ? `cells=${JSON.stringify(candidate.rawCells)}`
            : `line=${JSON.stringify(candidate.rawLine)}`;
        const hint = candidate.itemNumberHint ? ` itemHint=${candidate.itemNumberHint}` : '';
        return `[${candidate.rowId} p.${candidate.pageNumber} l.${candidate.lineNumber}${hint}] ${cells}`;
    }).join('\n');
}
