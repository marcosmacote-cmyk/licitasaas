/**
 * configAiExtractor.ts — Extrai Configurações e Encargos Sociais do Edital via IA
 * Reutiliza a infra de download de PDFs do bdiAiExtractor.
 */
import { GoogleGenAI, Type } from '@google/genai';
import { PrismaClient } from '@prisma/client';
import { callGeminiWithRetry } from '../ai/gemini.service';
import axios from 'axios';
import https from 'https';
import { classifyEngineeringAttachments } from './documentClassifier';

const prisma = new PrismaClient();

type ExtractionIntent = 'config' | 'encargos';

const INTENT_KEYWORDS: Record<ExtractionIntent, string[]> = {
    config: [
        'EDITAL', 'PROJETO BÁSICO', 'PROJETO BASICO', 'TERMO DE REFERÊNCIA', 'TERMO DE REFERENCIA',
        'OBJETO', 'LOCAL DA OBRA', 'MUNICÍPIO', 'MUNICIPIO', 'UF', 'SINAPI', 'SEINFRA', 'SICRO',
        'ORSE', 'SICOR', 'SIPROCE', 'SETOP', 'SEDOP', 'DER', 'DATA BASE', 'DATA-BASE',
        'MÊS DE REFERÊNCIA', 'MES DE REFERENCIA', 'DESONERADO', 'NÃO DESONERADO', 'NAO DESONERADO',
        'ONERADO', 'REGIME',
    ],
    encargos: [
        'ENCARGOS SOCIAIS', 'LEIS SOCIAIS', 'ENCARGO', 'HORISTA', 'MENSALISTA', 'GRUPO A',
        'GRUPO B', 'GRUPO C', 'GRUPO D', 'GRUPO E', 'INSS', 'FGTS', 'RAT', 'FAP',
        'DESONERADO', 'NÃO DESONERADO', 'NAO DESONERADO', 'SINAPI', 'SEINFRA', 'SICRO',
    ],
};

function scoreDocForIntent(doc: any, intent: ExtractionIntent): number {
    const haystack = `${doc.title || ''} ${doc.purpose || ''}`.toLowerCase();
    let score = Number(doc.score) || 0;
    if (intent === 'config') {
        if (/edital|projeto.?b[aá]sico|termo.?refer[eê]ncia/.test(haystack)) score += 55;
        if (/planilh|or[cç]ament|data.?base|sinapi|seinfra|sicro|orse|sicor|siproce|sedop|setop|der/.test(haystack)) score += 28;
        if (/cronograma|bdi|encargo/.test(haystack)) score += 8;
    } else {
        if (/encargo|leis.?sociais|m[aã]o.?de.?obra|horista|mensalista/.test(haystack)) score += 70;
        if (/bdi|composi[cç][aã]o|planilh|or[cç]ament/.test(haystack)) score += 22;
        if (/edital|projeto.?b[aá]sico|termo.?refer[eê]ncia/.test(haystack)) score += 16;
    }
    return score;
}

function selectDocsForIntent(arquivos: any[], maxDocs: number, intent: ExtractionIntent) {
    const classified = classifyEngineeringAttachments(arquivos, { maxDocuments: Math.max(maxDocs, 6), minScore: -50 });
    return classified.all
        .map(doc => ({ ...doc, intentScore: scoreDocForIntent(doc, intent) }))
        .sort((a, b) => b.intentScore - a.intentScore)
        .slice(0, maxDocs);
}

// ═══════════════════════════════════════════════════════════
// Helper: Download PDFs from PNCP for AI extraction
// Supports page targeting for large PDFs to ensure encargos
// (typically at the end) are not cut off by size limits.
// ═══════════════════════════════════════════════════════════
async function downloadPdfsForExtraction(biddingId: string, maxDocs = 3, intent: ExtractionIntent = 'config'): Promise<any[]> {
    const bidding = await prisma.biddingProcess.findUnique({
        where: { id: biddingId },
        include: { aiAnalysis: true }
    });
    const agent = new https.Agent({ rejectUnauthorized: false });

    try {
        const schemaV2 = bidding?.aiAnalysis?.schemaV2 as any;
        let arquivos = Array.isArray(schemaV2?.pncp_source?.attachments) ? schemaV2.pncp_source.attachments : [];

        if (arquivos.length === 0 && bidding?.pncpLink) {
            const linkMatch = bidding.pncpLink.match(/(\d{14})\/(\d{4})\/(\d+)/);
            if (!linkMatch) return [];

            const [, cnpj, ano, seq] = linkMatch;
            const arquivosUrl = `https://pncp.gov.br/api/pncp/v1/orgaos/${cnpj}/compras/${ano}/${seq}/arquivos`;
            const apiRes = await axios.get(arquivosUrl, { httpsAgent: agent, timeout: 20000 } as any);
            arquivos = Array.isArray(apiRes.data) ? apiRes.data : [];
        }
        if (arquivos.length === 0) return [];

        const selectedDocs = selectDocsForIntent(arquivos, maxDocs, intent);

        const pdfParts: any[] = [];
        let totalSizeKB = 0;
        const MAX_SIZE_KB = 20000; // 20MB — increased to handle large engineering PDFs
        const extraKeywords = INTENT_KEYWORDS[intent];

        for (const doc of selectedDocs.slice(0, maxDocs)) {
            try {
                let fileUrl = doc.url || '';
                if (fileUrl.includes('pncp-api/v1')) fileUrl = fileUrl.replace('pncp-api/v1', 'api/pncp/v1');
                if (!fileUrl) continue;

                const fileRes = await axios.get(fileUrl, {
                    responseType: 'arraybuffer', httpsAgent: agent,
                    timeout: 60000, maxRedirects: 5,
                    maxContentLength: 30 * 1024 * 1024, // 30MB max download
                } as any);
                const buffer = Buffer.from(fileRes.data as ArrayBuffer);
                if (buffer[0] !== 0x25 || buffer[1] !== 0x50) continue;

                const sizeKB = buffer.length / 1024;

                // For large PDFs (>5MB), use page targeting to extract only relevant pages
                if (sizeKB > 5000) {
                    try {
                        // Dynamic import of page targeting
                        const { targetBudgetPages } = await import('./pageTargeting');
                        const targeting = await targetBudgetPages(buffer, {
                            minScore: 2,
                            maxPages: intent === 'config' ? 40 : 35,
                            contextPages: 2,
                            minPagesForTargeting: 10,
                            extraKeywords,
                        });
                        if (targeting.strategy === 'targeted' && targeting.trimmedPdfBuffer) {
                            const trimmedBuf = targeting.trimmedPdfBuffer;
                            const trimmedSizeKB = trimmedBuf.length / 1024;
                            if (totalSizeKB + trimmedSizeKB > MAX_SIZE_KB) break;
                            totalSizeKB += trimmedSizeKB;
                            pdfParts.push({ inlineData: { data: trimmedBuf.toString('base64'), mimeType: 'application/pdf' } });
                            console.log(`[Config-AI] 🎯 Page targeting (${intent}): ${(sizeKB/1024).toFixed(1)}MB → ${(trimmedSizeKB/1024).toFixed(1)}MB (${targeting.selectedPageIndices.length}/${targeting.totalPages} pages)`);
                            continue;
                        }
                    } catch (ptErr: any) {
                        console.warn(`[Config-AI] Page targeting failed: ${ptErr.message}, using full PDF`);
                    }
                }

                if (totalSizeKB + sizeKB > MAX_SIZE_KB) break;
                totalSizeKB += sizeKB;
                pdfParts.push({ inlineData: { data: buffer.toString('base64'), mimeType: 'application/pdf' } });
            } catch { /* skip failed downloads */ }
        }
        return pdfParts;
    } catch { return []; }
}

// ═══════════════════════════════════════════════════════════
// Fallback: text from DocumentChunks or AiAnalysis
// ═══════════════════════════════════════════════════════════
function scoreTextForKeywords(text: string, keywords: string[]): number {
    if (keywords.length === 0) return 0;
    const normalized = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return keywords.reduce((score, kw) => {
        const needle = kw.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        return normalized.includes(needle) ? score + 1 : score;
    }, 0);
}

async function getEditalText(biddingId: string, keywords: string[] = []): Promise<string> {
    const chunks = await prisma.documentChunk.findMany({
        where: { biddingProcessId: biddingId },
        orderBy: { id: 'asc' }
    });
    if (chunks && chunks.length > 0) {
        if (keywords.length === 0) return chunks.map(c => c.content).join('\n\n');

        const scored = chunks
            .map((chunk, index) => ({ chunk, index, score: scoreTextForKeywords(chunk.content, keywords) }))
            .filter(item => item.score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, 35);

        if (scored.length > 0) {
            const selectedIndexes = new Set<number>();
            for (const item of scored) {
                selectedIndexes.add(item.index);
                if (item.index > 0) selectedIndexes.add(item.index - 1);
                if (item.index < chunks.length - 1) selectedIndexes.add(item.index + 1);
            }
            return Array.from(selectedIndexes)
                .sort((a, b) => a - b)
                .map(index => chunks[index].content)
                .join('\n\n');
        }

        return chunks.map(c => c.content).join('\n\n');
    }

    const bidding = await prisma.biddingProcess.findUnique({
        where: { id: biddingId },
        include: { aiAnalysis: true }
    });
    if (bidding?.aiAnalysis) {
        const parts: string[] = [];
        const a = bidding.aiAnalysis;
        if (a.fullSummary) parts.push(a.fullSummary);
        if (a.biddingItems) parts.push(a.biddingItems);
        if (a.pricingConsiderations) parts.push(a.pricingConsiderations);
        return parts.join('\n\n---\n\n');
    }
    return '';
}

// ═══════════════════════════════════════════════════════════
// Extract Config (Objeto, UF, Bases, Data Base, Regime)
// ═══════════════════════════════════════════════════════════
export async function extractConfigFromBidding(biddingId: string): Promise<any | null> {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    const configPrompt = `Você é um engenheiro orçamentista SÊNIOR analisando um edital de licitação pública de obras de engenharia.
Extraia TODAS as seguintes informações do edital. Leia o documento inteiro com extrema atenção.

1. **objeto**: Descrição resumida do objeto da obra (máx 200 caracteres).
2. **uf**: UF onde a obra será executada (sigla de 2 letras, ex: CE, PA, SP). Procure endereço, município, local da obra.
3. **bases**: Quais bases/tabelas de referência de custos o edital exige. Procure por menções a SINAPI, SEINFRA, SICRO, ORSE, SICOR, SBC, SIPROCE, SETOP, EMOP, SUDECAP, DER, SEDOP. Retorne um array de strings com nomes padronizados (em MAIÚSCULAS).
4. **dataBase**: Mês/ano de referência da base de preços. 

REGRAS PARA DATA BASE — MUITO IMPORTANTE:
- A data-base NÃO é a data de publicação do edital nem a data da sessão/abertura.
- A data-base é o mês de referência das tabelas de custos (SINAPI, SEINFRA, etc.)
- Procure por expressões como:
  * "referência" ou "data-base" ou "mês de referência" ou "base de preços"
  * "SINAPI referente a" ou "SINAPI de" ou "preços referência"
  * "tabela SINAPI de março/2025" → dataBase = "2025-03"
  * "SINAPI ref. outubro de 2024" → dataBase = "2024-10"
  * "preços do mês de setembro/2025" → dataBase = "2025-09"
  * "mês-base: SET/2025" → dataBase = "2025-09"
  * "SINAPI 10/2025" → dataBase = "2025-10"
  * "sistema de custos com data referência 09/2025" → dataBase = "2025-09"
- **FORMATO OGU/TransfereGOV**: Em planilhas da OGU, a data-base aparece no cabeçalho como:
  * "DATA BASE 09-25" → dataBase = "2025-09" (setembro de 2025)
  * "DATA BASE 03-26" → dataBase = "2026-03" (março de 2026)
  * "DATA BASE 12-24" → dataBase = "2024-12" (dezembro de 2024)
  * O formato é MM-AA onde MM=mês e AA=ano (2 dígitos). CONVERTA para YYYY-MM.
  * Frequentemente seguido de "(N DES.)" = não desonerado ou "(DES.)" = desonerado.
- Formato obrigatório: YYYY-MM (ex: 2025-09, 2024-03)
- Se houver várias datas para diferentes bases, retorne a mais recente como dataBase principal.

5. **dataBasesPorFonte**: Caso o edital especifique datas-base DIFERENTES para cada tabela (ex: SINAPI março/2026, SEINFRA janeiro/2026), retorne um objeto. Exemplo: { "SINAPI": "2026-03", "SEINFRA": "2026-01" }.
Se todas as bases usarem a mesma data, retorne objeto vazio {}.

6. **regime**: Procure explicitamente se o edital menciona:
- "desonerado", "com desoneração", "desoneração da folha" → retorne "DESONERADO"
- "onerado", "sem desoneração", "não desonerado", "(N DES.)" → retorne "ONERADO"
- Se mencionar tabela SINAPI desonerada ou "(DES.)" → "DESONERADO"
- Se nada for mencionado sobre desoneração → retorne "UNKNOWN". NÃO chute o regime.

Retorne JSON.`;

    const responseSchema = {
        type: Type.OBJECT,
        properties: {
            found: { type: Type.BOOLEAN },
            objeto: { type: Type.STRING, nullable: true },
            uf: { type: Type.STRING, nullable: true },
            bases: { type: Type.ARRAY, items: { type: Type.STRING }, nullable: true },
            dataBase: { type: Type.STRING, nullable: true },
            dataBasesPorFonte: { type: Type.OBJECT, nullable: true, properties: {} },
            regime: { type: Type.STRING, nullable: true },
        },
        required: ['found'] as string[]
    };

    // Try PDFs first
    const pdfParts = await downloadPdfsForExtraction(biddingId, 3, 'config');
    if (pdfParts.length > 0) {
        try {
            console.log(`[Config-AI] 📄 Enviando ${pdfParts.length} PDF(s) ao Gemini com responseSchema`);
            const result = await callGeminiWithRetry(ai.models, {
                model: 'gemini-2.5-flash',
                contents: [{ role: 'user', parts: [...pdfParts, { text: configPrompt }] }],
                config: { responseMimeType: 'application/json', responseSchema, temperature: 0.05 }
            });
            if (result?.text) {
                const parsed = JSON.parse(result.text);
                console.log(`[Config-AI] 📋 Resultado PDF: found=${parsed.found}, objeto=${(parsed.objeto||'').substring(0,60)}, uf=${parsed.uf}, bases=${JSON.stringify(parsed.bases)}, dataBase=${parsed.dataBase}, regime=${parsed.regime}`);
                if (parsed.found) return parsed;
            }
        } catch (e: any) {
            console.warn(`[Config-AI] PDF mode failed: ${e.message}`);
        }
    }

    // Fallback: text
    const text = await getEditalText(biddingId, INTENT_KEYWORDS.config);
    if (text.length < 100) return { found: false };

    console.log(`[Config-AI] 📝 Fallback texto: ${text.length} chars`);
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: configPrompt + '\n\nTEXTO DO EDITAL:\n' + text.substring(0, 100000),
        config: { responseMimeType: 'application/json', responseSchema, temperature: 0.05 }
    });
    if (!response.text) return null;
    try { return JSON.parse(response.text); } catch { return null; }
}

// ═══════════════════════════════════════════════════════════
// Extract Encargos Sociais (composition by groups A-E)
// Suporta múltiplas bases: retorna encargos por base se o edital tiver
// ═══════════════════════════════════════════════════════════
export async function extractEncargosFromBidding(biddingId: string): Promise<any | null> {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    const encargosPrompt = `Você é um engenheiro orçamentista analisando um edital de licitação pública.
Procure a tabela ou quadro de ENCARGOS SOCIAIS / LEIS SOCIAIS do edital.

ATENÇÃO: Muitos editais de obras públicas apresentam quadros de encargos sociais SEPARADOS para cada base de referência utilizada (SINAPI, SEINFRA, SICRO, etc.). Cada quadro pode ter percentuais diferentes.

Extraia os percentuais (%) para HORISTA e MENSALISTA, agrupados assim:

**Grupo A — Encargos Básicos:** INSS, SESI, SENAI, INCRA, SEBRAE, Salário Educação, FGTS, Seguro Acidente (RAT×FAP)
**Grupo B — Incidentes:** 13º Salário, Férias + 1/3 constitucional
**Grupo C — Complementares:** Aviso Prévio, Auxílio Doença, Licença Paternidade, Falta Justificada, Dias de Chuva/Improdutivos
**Grupo D — Reincidências:** Incidência do Grupo A sobre Grupo B
**Grupo E — Complementos:** Vale Transporte, Alimentação, EPI/Uniformes

REGRAS:
- Se o edital apresenta MÚLTIPLOS quadros de encargos (um para cada base), retorne cada um no campo "encargosPorBase" (ex: { "SINAPI": { totalHorista: 114.3, ... }, "SEINFRA": { totalHorista: 108.5, ... } }).
- Se há apenas UM quadro geral, retorne totalHorista e totalMensalista no nível raiz.
- Se não encontrar a composição detalhada mas encontrar apenas os totais, retorne apenas totalHorista/totalMensalista.
- Retorne apenas JSON com os números (sem símbolo %).`;

    const grupoSchema = {
        type: Type.OBJECT as const, nullable: true,
        properties: {
            inss: { type: Type.NUMBER as const }, sesi: { type: Type.NUMBER as const }, senai: { type: Type.NUMBER as const },
            incra: { type: Type.NUMBER as const }, sebrae: { type: Type.NUMBER as const }, salarioEducacao: { type: Type.NUMBER as const },
            fgts: { type: Type.NUMBER as const }, seguroAcidente: { type: Type.NUMBER as const },
            decimoTerceiro: { type: Type.NUMBER as const }, ferias: { type: Type.NUMBER as const },
            avisoPrevio: { type: Type.NUMBER as const }, auxilioDoenca: { type: Type.NUMBER as const },
            licencaPaternidade: { type: Type.NUMBER as const }, faltaJustificada: { type: Type.NUMBER as const },
            diasChuva: { type: Type.NUMBER as const }, reincidenciaGrupoA: { type: Type.NUMBER as const },
            valeTransporte: { type: Type.NUMBER as const }, alimentacao: { type: Type.NUMBER as const },
            epiUniformes: { type: Type.NUMBER as const },
        }
    };

    const baseEncargosSchema = {
        type: Type.OBJECT as const, nullable: true,
        properties: {
            totalHorista: { type: Type.NUMBER as const, nullable: true },
            totalMensalista: { type: Type.NUMBER as const, nullable: true },
            grupoHorista: grupoSchema,
        }
    };

    const responseSchema = {
        type: Type.OBJECT,
        properties: {
            found: { type: Type.BOOLEAN },
            totalHorista: { type: Type.NUMBER, nullable: true },
            totalMensalista: { type: Type.NUMBER, nullable: true },
            grupoHorista: grupoSchema,
            encargosPorBase: {
                type: Type.OBJECT as const, nullable: true,
                properties: {
                    SINAPI: baseEncargosSchema,
                    SEINFRA: baseEncargosSchema,
                    SICRO: baseEncargosSchema,
                    ORSE: baseEncargosSchema,
                    SICOR: baseEncargosSchema,
                    SBC: baseEncargosSchema,
                }
            },
        },
        required: ['found'] as string[]
    };

    const pdfParts = await downloadPdfsForExtraction(biddingId, 3, 'encargos');
    if (pdfParts.length > 0) {
        try {
            console.log(`[Encargos-AI] 📄 Enviando ${pdfParts.length} PDF(s) ao Gemini com responseSchema`);
            const result = await callGeminiWithRetry(ai.models, {
                model: 'gemini-2.5-flash',
                contents: [{ role: 'user', parts: [...pdfParts, { text: encargosPrompt }] }],
                config: { responseMimeType: 'application/json', responseSchema, temperature: 0.1 }
            });
            if (result?.text) {
                const parsed = JSON.parse(result.text);
                console.log(`[Encargos-AI] 📋 Resultado PDF: found=${parsed.found}, totalHorista=${parsed.totalHorista}, totalMensalista=${parsed.totalMensalista}, encargosPorBase=${JSON.stringify(Object.keys(parsed.encargosPorBase || {}))}`);
                if (parsed.found) return parsed;
            }
        } catch (e: any) {
            console.warn(`[Encargos-AI] PDF mode failed: ${e.message}`);
        }
    }

    const text = await getEditalText(biddingId, INTENT_KEYWORDS.encargos);
    if (text.length < 100) return { found: false };

    console.log(`[Encargos-AI] 📝 Fallback texto: ${text.length} chars`);
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: encargosPrompt + '\n\nTEXTO DO EDITAL:\n' + text.substring(0, 100000),
        config: { responseMimeType: 'application/json', responseSchema, temperature: 0.1 }
    });
    if (!response.text) return null;
    try { return JSON.parse(response.text); } catch { return null; }
}
