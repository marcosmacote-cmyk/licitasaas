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
// Strategy: Free JSON only (no structured schema — avoids "too many states" error)
// ═══════════════════════════════════════════════════════════
export async function extractEncargosFromBidding(biddingId: string): Promise<any | null> {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    const encargosPrompt = `Você é um engenheiro orçamentista especialista em encargos sociais SINAPI.
Analise o documento e encontre a TABELA DE ENCARGOS SOCIAIS / LEIS SOCIAIS.

A tabela segue a estrutura SINAPI com 4 GRUPOS e ITENS INDIVIDUAIS.
Extraia CADA ITEM com valores para HORISTA e MENSALISTA:

GRUPO A — Encargos Sociais Básicos:
  A1: INSS (20% se onerado, 0% se desonerado)
  A2: SESI (1.50%), A3: SENAI (1.00%), A4: INCRA (0.20%), A5: SEBRAE (0.60%)
  A6: Salário Educação (2.50%), A7: Seguro Contra Acidentes de Trabalho / RAT (3.00%)
  A8: FGTS (8.00%), A9: SECONCI (0.00% quando não aplicável)

GRUPO B — Encargos Trabalhistas:
  B1: Repouso Semanal Remunerado, B2: Feriados, B3: Auxílio Enfermidade
  B4: 13º Salário, B5: Licença Paternidade, B6: Faltas Justificadas
  B7: Dias de Chuvas, B8: Auxílio Acidente de Trabalho
  B9: Férias Gozadas, B10: Salário Maternidade

GRUPO C — Encargos Rescisórios:
  C1: Aviso Prévio Indenizado, C2: Aviso Prévio Trabalhado, C3: Férias Indenizadas
  C4: Depósito Rescisão Sem Justa Causa, C5: Indenização Adicional

GRUPO D — Reincidências:
  D1: Reincidência de Grupo A sobre Grupo B
  D2: Reincidência de Grupo A sobre Aviso Prévio Trabalhado e FGTS sobre Aviso Prévio Indenizado

RETORNE JSON com EXATAMENTE estes campos:
{ "found": true, "basePrincipal": "SINAPI",
  "totalHorista": 115.10, "totalMensalista": 71.84,
  "a1_h": 20.00, "a1_m": 20.00, "a2_h": 1.50, "a2_m": 1.50,
  "a3_h": 1.00, "a3_m": 1.00, "a4_h": 0.20, "a4_m": 0.20,
  "a5_h": 0.60, "a5_m": 0.60, "a6_h": 2.50, "a6_m": 2.50,
  "a7_h": 3.00, "a7_m": 3.00, "a8_h": 8.00, "a8_m": 8.00,
  "a9_h": 0.00, "a9_m": 0.00,
  "b1_h": N, "b1_m": N, "b2_h": N, "b2_m": N, "b3_h": N, "b3_m": N,
  "b4_h": N, "b4_m": N, "b5_h": N, "b5_m": N, "b6_h": N, "b6_m": N,
  "b7_h": N, "b7_m": N, "b8_h": N, "b8_m": N, "b9_h": N, "b9_m": N,
  "b10_h": N, "b10_m": N,
  "c1_h": N, "c1_m": N, "c2_h": N, "c2_m": N, "c3_h": N, "c3_m": N,
  "c4_h": N, "c4_m": N, "c5_h": N, "c5_m": N,
  "d1_h": N, "d1_m": N, "d2_h": N, "d2_m": N }
Onde N = valor percentual sem símbolo % (ex: 17.86). Se item=0 ou não existe, retorne 0.
Se não encontrar tabela de encargos, retorne {"found": false}.`;

    const enrichResult = (parsed: any) => {
        if (!parsed?.found) return parsed;
        const sum = (...keys: string[]) => keys.reduce((s, k) => s + (parsed[k] || 0), 0);
        parsed.grupoA_horista = Math.round(sum('a1_h','a2_h','a3_h','a4_h','a5_h','a6_h','a7_h','a8_h','a9_h') * 100) / 100;
        parsed.grupoA_mensalista = Math.round(sum('a1_m','a2_m','a3_m','a4_m','a5_m','a6_m','a7_m','a8_m','a9_m') * 100) / 100;
        parsed.grupoB_horista = Math.round(sum('b1_h','b2_h','b3_h','b4_h','b5_h','b6_h','b7_h','b8_h','b9_h','b10_h') * 100) / 100;
        parsed.grupoB_mensalista = Math.round(sum('b1_m','b2_m','b3_m','b4_m','b5_m','b6_m','b7_m','b8_m','b9_m','b10_m') * 100) / 100;
        parsed.grupoC_horista = Math.round(sum('c1_h','c2_h','c3_h','c4_h','c5_h') * 100) / 100;
        parsed.grupoC_mensalista = Math.round(sum('c1_m','c2_m','c3_m','c4_m','c5_m') * 100) / 100;
        parsed.grupoD_horista = Math.round(sum('d1_h','d2_h') * 100) / 100;
        parsed.grupoD_mensalista = Math.round(sum('d1_m','d2_m') * 100) / 100;
        const th = parsed.grupoA_horista + parsed.grupoB_horista + parsed.grupoC_horista + parsed.grupoD_horista;
        const tm = parsed.grupoA_mensalista + parsed.grupoB_mensalista + parsed.grupoC_mensalista + parsed.grupoD_mensalista;
        if (th > 0) parsed.totalHorista = Math.round(th * 100) / 100;
        if (tm > 0) parsed.totalMensalista = Math.round(tm * 100) / 100;
        console.log(`[Encargos-AI] 📊 A=${parsed.grupoA_horista} B=${parsed.grupoB_horista} C=${parsed.grupoC_horista} D=${parsed.grupoD_horista} → H=${parsed.totalHorista} M=${parsed.totalMensalista}`);
        return parsed;
    };

    try {
        const pdfParts = await downloadPdfsForExtraction(biddingId, 3, 'encargos');
        if (pdfParts.length > 0) {
            try {
                console.log(`[Encargos-AI] 📄 PDF: ${pdfParts.length} PDF(s) — JSON livre (sem schema)`);
                const result = await callGeminiWithRetry(ai.models, {
                    model: 'gemini-2.5-flash',
                    contents: [{ role: 'user', parts: [...pdfParts, { text: encargosPrompt }] }],
                    config: { responseMimeType: 'application/json', temperature: 0.1 }
                });
                if (result?.text) {
                    const parsed = JSON.parse(result.text);
                    console.log(`[Encargos-AI] 📋 PDF ok: found=${parsed.found} a1_h=${parsed.a1_h} a8_h=${parsed.a8_h}`);
                    if (parsed.found) return enrichResult(parsed);
                }
            } catch (e: any) {
                console.warn(`[Encargos-AI] ⚠️ PDF falhou: ${e.message}`);
            }
        }

        const text = await getEditalText(biddingId, INTENT_KEYWORDS.encargos);
        if (text.length < 100) return { found: false };
        console.log(`[Encargos-AI] 📝 Texto: ${text.length} chars`);
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: encargosPrompt + '\n\nTEXTO DO EDITAL:\n' + text.substring(0, 100000),
            config: { responseMimeType: 'application/json', temperature: 0.1 }
        });
        if (!response.text) return { found: false };
        try { return enrichResult(JSON.parse(response.text)); } catch { return { found: false }; }
    } catch (outerError: any) {
        console.error(`[Encargos-AI] ❌ Fatal: ${outerError.message}`);
        return { found: false, error: outerError.message };
    }
}

// ═══════════════════════════════════════════════════════════
// Extract Encargos from IMAGE (clipboard paste / upload)
// ═══════════════════════════════════════════════════════════
export async function extractEncargosFromImage(imageBase64: string, mimeType: string, label?: string): Promise<any | null> {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const prompt = `Analise esta imagem de uma TABELA DE ENCARGOS SOCIAIS e extraia TODOS os valores.
Retorne JSON: { "found": true, "basePrincipal": "...", "totalHorista": N, "totalMensalista": N,
  "a1_h": N, "a1_m": N, ..., "d2_h": N, "d2_m": N }
Onde _h=HORISTA, _m=MENSALISTA. Campos: a1(INSS), a2(SESI), a3(SENAI), a4(INCRA), a5(SEBRAE),
a6(Sal.Educação), a7(RAT), a8(FGTS), a9(SECONCI), b1(Repouso), b2(Feriados), b3(Aux.Enfermidade),
b4(13º), b5(Lic.Paternidade), b6(Faltas), b7(Chuvas), b8(Aux.Acidente), b9(Férias), b10(Maternidade),
c1(AP Indenizado), c2(AP Trabalhado), c3(Férias Ind.), c4(Dep.Rescisão), c5(Ind.Adicional),
d1(Reinc.A/B), d2(Reinc.A/AP+FGTS). Valores % sem símbolo. Se item=0, retorne 0.`;

    try {
        const result = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [{ role: 'user', parts: [
                { inlineData: { data: imageBase64, mimeType: mimeType || 'image/png' } },
                { text: prompt }
            ]}],
            config: { responseMimeType: 'application/json', temperature: 0.1 }
        });
        if (!result?.text) return { found: false };
        const parsed = JSON.parse(result.text);
        if (!parsed.found) return { found: false };
        const sum = (...keys: string[]) => keys.reduce((s, k) => s + (parsed[k] || 0), 0);
        parsed.grupoA_horista = Math.round(sum('a1_h','a2_h','a3_h','a4_h','a5_h','a6_h','a7_h','a8_h','a9_h') * 100) / 100;
        parsed.grupoA_mensalista = Math.round(sum('a1_m','a2_m','a3_m','a4_m','a5_m','a6_m','a7_m','a8_m','a9_m') * 100) / 100;
        parsed.grupoB_horista = Math.round(sum('b1_h','b2_h','b3_h','b4_h','b5_h','b6_h','b7_h','b8_h','b9_h','b10_h') * 100) / 100;
        parsed.grupoB_mensalista = Math.round(sum('b1_m','b2_m','b3_m','b4_m','b5_m','b6_m','b7_m','b8_m','b9_m','b10_m') * 100) / 100;
        parsed.grupoC_horista = Math.round(sum('c1_h','c2_h','c3_h','c4_h','c5_h') * 100) / 100;
        parsed.grupoC_mensalista = Math.round(sum('c1_m','c2_m','c3_m','c4_m','c5_m') * 100) / 100;
        parsed.grupoD_horista = Math.round(sum('d1_h','d2_h') * 100) / 100;
        parsed.grupoD_mensalista = Math.round(sum('d1_m','d2_m') * 100) / 100;
        parsed.totalHorista = Math.round((parsed.grupoA_horista + parsed.grupoB_horista + parsed.grupoC_horista + parsed.grupoD_horista) * 100) / 100;
        parsed.totalMensalista = Math.round((parsed.grupoA_mensalista + parsed.grupoB_mensalista + parsed.grupoC_mensalista + parsed.grupoD_mensalista) * 100) / 100;
        if (label) parsed.basePrincipal = label;
        console.log(`[Encargos-IMG] 📋 H=${parsed.totalHorista} M=${parsed.totalMensalista} base=${parsed.basePrincipal}`);
        return parsed;
    } catch (e: any) {
        console.error(`[Encargos-IMG] ❌ ${e.message}`);
        return { found: false, error: e.message };
    }
}

