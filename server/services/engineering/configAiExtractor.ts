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

1. **objeto**: Transcreva LITERALMENTE o objeto da obra conforme consta no edital.
   NÃO resuma. NÃO sintetize. NÃO abrevie. NÃO reformule.
   Copie o texto EXATO, palavra por palavra, como aparece no edital.
   Se o objeto estiver em múltiplas linhas, junte tudo numa única string.

2. **uf**: UF onde a obra será executada (sigla de 2 letras, ex: CE, PA, SP).

3. **bases**: TODAS as bases/tabelas de referência de custos mencionadas no edital.
   Procure em TODAS as páginas por: SINAPI, SEINFRA, SICRO, ORSE, SICOR, SBC,
   SIPROCE, SETOP, EMOP, SUDECAP, DER, SEDOP, COMPOSIÇÕES PRÓPRIAS.
   Se o edital menciona "composições próprias" ou "composições do autor", inclua "PROPRIA".
   Retorne TODAS as bases encontradas, não apenas a principal.
   Array de strings MAIÚSCULAS. Ex: ["SINAPI", "SEINFRA", "PROPRIA"]

4. **dataBase**: Mês/ano de referência PRINCIPAL da base de preços.

REGRAS PARA DATA BASE — EXTREMAMENTE IMPORTANTE:
- A data-base NÃO é a data de publicação do edital nem a data da sessão/abertura.
- A data-base é o mês de referência das tabelas de custos (SINAPI, SEINFRA, etc.)
- Procure por expressões como:
  * "referência" ou "data-base" ou "mês de referência" ou "base de preços"
  * "SINAPI referente a" ou "SINAPI de" ou "preços referência"
  * "tabela SINAPI de março/2025" → dataBase = "2025-03"
  * "SINAPI ref. outubro de 2024" → dataBase = "2024-10"
  * "preços do mês de setembro/2025" → dataBase = "2025-09"
  * "mês-base: SET/2025" → dataBase = "2025-09"
- **FORMATO OGU/TransfereGOV**: Em planilhas da OGU, a data-base aparece no cabeçalho como:
  * "DATA BASE 09-25" → dataBase = "2025-09" (formato MM-AA → YYYY-MM)
  * Frequentemente seguido de "(N DES.)" = não desonerado ou "(DES.)" = desonerado.
- Formato obrigatório de saída: YYYY-MM (ex: 2025-09, 2024-03)

5. **dataBasesPorFonte**: Se o edital especifica datas-base DIFERENTES para cada tabela,
   retorne um objeto com TODAS as datas encontradas.
   Exemplo: { "SINAPI": "2025-09", "SEINFRA": "2025-09", "PROPRIA": "2025-09" }
   Se todas usam a mesma data, retorne um objeto com cada base mapeada para a mesma data.
   NUNCA retorne vazio — sempre mapeie cada base à sua data.

6. **regime**: Procure explicitamente se o edital menciona:
   - "desonerado", "com desoneração", "(DES.)" → "DESONERADO"
   - "onerado", "sem desoneração", "não desonerado", "(N DES.)" → "ONERADO"
   - Se nada for mencionado → "UNKNOWN". NÃO chute.

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
// Extract Encargos Sociais — Aligned with SINAPI Methodology
// Structure: Groups A (Básicos), B (Trabalhistas), C (Rescisórios), D (Reincidências)
// ═══════════════════════════════════════════════════════════
export async function extractEncargosFromBidding(biddingId: string): Promise<any | null> {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    const encargosPrompt = `Você é um engenheiro orçamentista especialista em encargos sociais SINAPI.
Analise o documento e encontre a TABELA DE ENCARGOS SOCIAIS / LEIS SOCIAIS.

A tabela segue a estrutura SINAPI com 4 GRUPOS e ITENS INDIVIDUAIS.
Extraia CADA ITEM com valores para HORISTA e MENSALISTA:

GRUPO A — Encargos Sociais Básicos:
  A1: INSS (20% se onerado, 0% se desonerado)
  A2: SESI (1.50%)
  A3: SENAI (1.00%)
  A4: INCRA (0.20%)
  A5: SEBRAE (0.60%)
  A6: Salário Educação (2.50%)
  A7: Seguro Contra Acidentes de Trabalho / RAT (3.00%)
  A8: FGTS (8.00%)
  A9: SECONCI (0.00% quando não aplicável)

GRUPO B — Encargos Trabalhistas:
  B1:  Repouso Semanal Remunerado
  B2:  Feriados
  B3:  Auxílio Enfermidade
  B4:  13º Salário
  B5:  Licença Paternidade
  B6:  Faltas Justificadas
  B7:  Dias de Chuvas
  B8:  Auxílio Acidente de Trabalho
  B9:  Férias Gozadas
  B10: Salário Maternidade

GRUPO C — Encargos Rescisórios:
  C1: Aviso Prévio Indenizado
  C2: Aviso Prévio Trabalhado
  C3: Férias Indenizadas
  C4: Depósito Rescisão Sem Justa Causa
  C5: Indenização Adicional

GRUPO D — Reincidências:
  D1: Reincidência de Grupo A sobre Grupo B
  D2: Reincidência de Grupo A sobre Aviso Prévio Trabalhado e Reincidência do FGTS sobre Aviso Prévio Indenizado

INSTRUÇÕES OBRIGATÓRIAS:
1. Preencha CADA ITEM individual (a1_h, a1_m, a2_h, a2_m, ..., d2_h, d2_m)
2. _h = valor HORISTA, _m = valor MENSALISTA
3. Valores são percentuais SEM símbolo % (ex: 20.00, não "20,00%")
4. Se um item não existir ou for 0, coloque 0
5. Se houver MÚLTIPLAS tabelas (por base), extraia a PRIMEIRA/PRINCIPAL
6. totalHorista e totalMensalista = soma de TODOS os grupos (A+B+C+D)
7. Se não encontrar tabela de encargos, retorne found=false`;

    // Schema with individual items — all non-nullable to minimize states
    const responseSchema = {
        type: Type.OBJECT,
        properties: {
            found: { type: Type.BOOLEAN },
            totalHorista: { type: Type.NUMBER, description: 'Total A+B+C+D horista' },
            totalMensalista: { type: Type.NUMBER, description: 'Total A+B+C+D mensalista' },
            basePrincipal: { type: Type.STRING, nullable: true },
            // Group A items
            a1_h: { type: Type.NUMBER }, a1_m: { type: Type.NUMBER },
            a2_h: { type: Type.NUMBER }, a2_m: { type: Type.NUMBER },
            a3_h: { type: Type.NUMBER }, a3_m: { type: Type.NUMBER },
            a4_h: { type: Type.NUMBER }, a4_m: { type: Type.NUMBER },
            a5_h: { type: Type.NUMBER }, a5_m: { type: Type.NUMBER },
            a6_h: { type: Type.NUMBER }, a6_m: { type: Type.NUMBER },
            a7_h: { type: Type.NUMBER }, a7_m: { type: Type.NUMBER },
            a8_h: { type: Type.NUMBER }, a8_m: { type: Type.NUMBER },
            a9_h: { type: Type.NUMBER }, a9_m: { type: Type.NUMBER },
            // Group B items
            b1_h: { type: Type.NUMBER }, b1_m: { type: Type.NUMBER },
            b2_h: { type: Type.NUMBER }, b2_m: { type: Type.NUMBER },
            b3_h: { type: Type.NUMBER }, b3_m: { type: Type.NUMBER },
            b4_h: { type: Type.NUMBER }, b4_m: { type: Type.NUMBER },
            b5_h: { type: Type.NUMBER }, b5_m: { type: Type.NUMBER },
            b6_h: { type: Type.NUMBER }, b6_m: { type: Type.NUMBER },
            b7_h: { type: Type.NUMBER }, b7_m: { type: Type.NUMBER },
            b8_h: { type: Type.NUMBER }, b8_m: { type: Type.NUMBER },
            b9_h: { type: Type.NUMBER }, b9_m: { type: Type.NUMBER },
            b10_h: { type: Type.NUMBER }, b10_m: { type: Type.NUMBER },
            // Group C items
            c1_h: { type: Type.NUMBER }, c1_m: { type: Type.NUMBER },
            c2_h: { type: Type.NUMBER }, c2_m: { type: Type.NUMBER },
            c3_h: { type: Type.NUMBER }, c3_m: { type: Type.NUMBER },
            c4_h: { type: Type.NUMBER }, c4_m: { type: Type.NUMBER },
            c5_h: { type: Type.NUMBER }, c5_m: { type: Type.NUMBER },
            // Group D items
            d1_h: { type: Type.NUMBER }, d1_m: { type: Type.NUMBER },
            d2_h: { type: Type.NUMBER }, d2_m: { type: Type.NUMBER },
        },
        required: ['found'] as string[]
    };

    // Post-processor: calculate group subtotals from individual items
    const enrichResult = (parsed: any) => {
        if (!parsed?.found) return parsed;
        // Calculate group subtotals from items
        const sum = (...keys: string[]) => keys.reduce((s, k) => s + (parsed[k] || 0), 0);
        parsed.grupoA_horista = Math.round(sum('a1_h','a2_h','a3_h','a4_h','a5_h','a6_h','a7_h','a8_h','a9_h') * 100) / 100;
        parsed.grupoA_mensalista = Math.round(sum('a1_m','a2_m','a3_m','a4_m','a5_m','a6_m','a7_m','a8_m','a9_m') * 100) / 100;
        parsed.grupoB_horista = Math.round(sum('b1_h','b2_h','b3_h','b4_h','b5_h','b6_h','b7_h','b8_h','b9_h','b10_h') * 100) / 100;
        parsed.grupoB_mensalista = Math.round(sum('b1_m','b2_m','b3_m','b4_m','b5_m','b6_m','b7_m','b8_m','b9_m','b10_m') * 100) / 100;
        parsed.grupoC_horista = Math.round(sum('c1_h','c2_h','c3_h','c4_h','c5_h') * 100) / 100;
        parsed.grupoC_mensalista = Math.round(sum('c1_m','c2_m','c3_m','c4_m','c5_m') * 100) / 100;
        parsed.grupoD_horista = Math.round(sum('d1_h','d2_h') * 100) / 100;
        parsed.grupoD_mensalista = Math.round(sum('d1_m','d2_m') * 100) / 100;
        // Recalculate totals from groups if individual items were present
        const calcTotal_h = parsed.grupoA_horista + parsed.grupoB_horista + parsed.grupoC_horista + parsed.grupoD_horista;
        const calcTotal_m = parsed.grupoA_mensalista + parsed.grupoB_mensalista + parsed.grupoC_mensalista + parsed.grupoD_mensalista;
        if (calcTotal_h > 0) parsed.totalHorista = Math.round(calcTotal_h * 100) / 100;
        if (calcTotal_m > 0) parsed.totalMensalista = Math.round(calcTotal_m * 100) / 100;
        console.log(`[Encargos-AI] 📊 Enriquecido: A_h=${parsed.grupoA_horista} B_h=${parsed.grupoB_horista} C_h=${parsed.grupoC_horista} D_h=${parsed.grupoD_horista} → Total_h=${parsed.totalHorista}`);
        return parsed;
    };

    const pdfParts = await downloadPdfsForExtraction(biddingId, 3, 'encargos');
    if (pdfParts.length > 0) {
        // Attempt 1: Full schema with individual items
        try {
            console.log(`[Encargos-AI] 📄 Tentativa 1: ${pdfParts.length} PDF(s) com schema SINAPI completo (itens individuais)`);
            const result = await callGeminiWithRetry(ai.models, {
                model: 'gemini-2.5-flash',
                contents: [{ role: 'user', parts: [...pdfParts, { text: encargosPrompt }] }],
                config: { responseMimeType: 'application/json', responseSchema, temperature: 0.1 }
            });
            if (result?.text) {
                const parsed = JSON.parse(result.text);
                console.log(`[Encargos-AI] 📋 Resultado T1: found=${parsed.found}, a1_h=${parsed.a1_h}, a8_h=${parsed.a8_h}, totalH=${parsed.totalHorista}`);
                if (parsed.found) return enrichResult(parsed);
            }
        } catch (e: any) {
            console.warn(`[Encargos-AI] ⚠️ Tentativa 1 falhou: ${e.message}`);
        }

        // Attempt 2: Free JSON — no schema constraint
        try {
            console.log(`[Encargos-AI] 📄 Tentativa 2: ${pdfParts.length} PDF(s) sem schema (JSON livre com itens)`);
            const freePrompt = encargosPrompt + '\n\nRetorne JSON com os campos exatos: found (boolean), totalHorista, totalMensalista, basePrincipal (string), e TODOS os itens individuais: a1_h, a1_m, a2_h, a2_m, ..., a9_h, a9_m, b1_h, b1_m, ..., b10_h, b10_m, c1_h, c1_m, ..., c5_h, c5_m, d1_h, d1_m, d2_h, d2_m (todos numbers).';
            const result = await callGeminiWithRetry(ai.models, {
                model: 'gemini-2.5-flash',
                contents: [{ role: 'user', parts: [...pdfParts, { text: freePrompt }] }],
                config: { responseMimeType: 'application/json', temperature: 0.1 }
            });
            if (result?.text) {
                const parsed = JSON.parse(result.text);
                console.log(`[Encargos-AI] 📋 Resultado T2: found=${parsed.found}, a1_h=${parsed.a1_h}, totalH=${parsed.totalHorista}`);
                if (parsed.found) return enrichResult(parsed);
            }
        } catch (e: any) {
            console.warn(`[Encargos-AI] ⚠️ Tentativa 2 falhou: ${e.message}`);
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
    try { return enrichResult(JSON.parse(response.text)); } catch { return null; }
}
