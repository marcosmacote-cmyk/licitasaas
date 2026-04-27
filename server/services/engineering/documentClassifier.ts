/**
 * Engineering Document Classifier
 *
 * Lightweight deterministic ranking for PNCP attachments before the expensive
 * PDF/LLM extraction path. The goal is to send budget-like files first and keep
 * general edital/legal attachments out of the engineering extractor whenever
 * possible.
 */

export interface EngineeringAttachmentInput {
    url?: string | null;
    uri?: string | null;
    titulo?: string | null;
    title?: string | null;
    nomeArquivo?: string | null;
    nome?: string | null;
    purpose?: string | null;
    ativo?: boolean | null;
    [key: string]: unknown;
}

export interface ClassifiedEngineeringDocument {
    attachment: EngineeringAttachmentInput;
    url: string;
    title: string;
    purpose: string;
    score: number;
    reasons: string[];
    decision: 'selected' | 'rejected';
}

export interface EngineeringDocumentClassification {
    selected: ClassifiedEngineeringDocument[];
    rejected: ClassifiedEngineeringDocument[];
    all: ClassifiedEngineeringDocument[];
    summary: {
        total: number;
        selected: number;
        rejected: number;
        maxDocuments: number;
    };
}

interface ClassificationOptions {
    maxDocuments?: number;
    minScore?: number;
}

const PURPOSE_SCORES: Record<string, number> = {
    planilha_orcamentaria: 80,
    composicao_custos: 72,
    cronograma_fisico_financeiro: 44,
    anexo_geral: 12,
    edital: -28,
};

const POSITIVE_PATTERNS: Array<[RegExp, number, string]> = [
    [/planilh/i, 34, 'nome menciona planilha'],
    [/or[cç]ament/i, 32, 'nome menciona orçamento'],
    [/quantitativ/i, 28, 'nome menciona quantitativo'],
    [/composi[cç][aã]o|cpu\b|custo unit/i, 24, 'nome menciona composição/custo unitário'],
    [/\bbdi\b|bonifica/i, 18, 'nome menciona BDI'],
    [/cronograma.*f[ií]sico|f[ií]sico.*financeiro/i, 14, 'nome menciona cronograma físico-financeiro'],
    [/sinapi|seinfra|sicro|orse|sicor|siproce/i, 18, 'nome menciona base oficial'],
    [/mem[oó]ria.*c[aá]lculo|curva.?abc/i, 16, 'nome menciona memória de cálculo/curva ABC'],
    [/projeto.?b[aá]sico|termo.?refer[eê]ncia/i, 8, 'documento técnico de apoio'],
];

const NEGATIVE_PATTERNS: Array<[RegExp, number, string]> = [
    [/ata|aviso|publica[cç][aã]o|extrato|resultado|homologa|adjudica/i, -44, 'documento administrativo'],
    [/decreto|portaria|lei|resolu[cç][aã]o|certid/i, -40, 'documento normativo/certidão'],
    [/impugna|recurso|esclarecimento|resposta/i, -34, 'documento de comunicação processual'],
    [/edital|minuta|contrato|declara[cç][aã]o|habilita[cç][aã]o/i, -24, 'documento jurídico/editalício'],
    [/retifica|errata|republica/i, -20, 'retificação sem indicação orçamentária'],
    [/\.(zip|rar|7z)$/i, -18, 'arquivo compactado não tratado neste fluxo'],
];

function attachmentTitle(att: EngineeringAttachmentInput): string {
    return String(att.titulo || att.title || att.nomeArquivo || att.nome || att.url || att.uri || 'Anexo sem título');
}

function attachmentUrl(att: EngineeringAttachmentInput): string {
    const url = String(att.url || att.uri || '');
    return url.includes('pncp-api/v1') ? url.replace('pncp-api/v1', 'api/pncp/v1') : url;
}

function normalizePurpose(purpose?: string | null): string {
    return String(purpose || '').trim().toLowerCase();
}

export function classifyEngineeringAttachments(
    attachments: EngineeringAttachmentInput[] | undefined | null,
    options: ClassificationOptions = {}
): EngineeringDocumentClassification {
    const maxDocuments = options.maxDocuments ?? 4;
    const minScore = options.minScore ?? 18;

    const classified = (attachments || [])
        .filter(att => att && att.ativo !== false && attachmentUrl(att))
        .map((attachment): ClassifiedEngineeringDocument => {
            const title = attachmentTitle(attachment);
            const purpose = normalizePurpose(attachment.purpose);
            const haystack = `${title} ${purpose}`.toLowerCase();
            const reasons: string[] = [];
            let score = PURPOSE_SCORES[purpose] ?? 0;

            if (PURPOSE_SCORES[purpose]) {
                reasons.push(`purpose=${purpose}`);
            }

            if (/\.pdf(?:$|\?)/i.test(attachmentUrl(attachment)) || /\.pdf$/i.test(title)) {
                score += 8;
                reasons.push('arquivo PDF');
            }

            for (const [pattern, weight, reason] of POSITIVE_PATTERNS) {
                if (pattern.test(haystack)) {
                    score += weight;
                    reasons.push(reason);
                }
            }

            for (const [pattern, weight, reason] of NEGATIVE_PATTERNS) {
                if (pattern.test(haystack)) {
                    score += weight;
                    reasons.push(reason);
                }
            }

            return {
                attachment,
                url: attachmentUrl(attachment),
                title,
                purpose,
                score,
                reasons,
                decision: 'rejected',
            };
        })
        .sort((a, b) => b.score - a.score);

    const selectedUrls = new Set<string>();
    const selected: ClassifiedEngineeringDocument[] = [];
    const rejected: ClassifiedEngineeringDocument[] = [];

    for (const doc of classified) {
        if (doc.score >= minScore && selected.length < maxDocuments && !selectedUrls.has(doc.url)) {
            doc.decision = 'selected';
            selected.push(doc);
            selectedUrls.add(doc.url);
        } else {
            doc.decision = 'rejected';
            rejected.push(doc);
        }
    }

    return {
        selected,
        rejected,
        all: classified,
        summary: {
            total: classified.length,
            selected: selected.length,
            rejected: rejected.length,
            maxDocuments,
        },
    };
}

export function urlsToEngineeringAttachments(urls: string[] | undefined | null): EngineeringAttachmentInput[] {
    return (urls || []).filter(Boolean).map(url => ({
        url,
        titulo: url.split('/').pop() || url,
        purpose: 'anexo_geral',
        ativo: true,
    }));
}
