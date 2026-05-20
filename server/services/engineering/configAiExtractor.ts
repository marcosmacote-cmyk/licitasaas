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
import { downloadWithRetry } from './downloadUtils';

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
        // Encargos can also be inside generic "orçamento" or "anexo" files
        if (/anexo|complement|detalhament/.test(haystack)) score += 12;
        if (/custo|pre[cç]o|refer[eê]ncia/.test(haystack)) score += 8;
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

        // Helper: add a PDF buffer to pdfParts with optional page targeting
        const addPdfBuffer = async (buffer: Buffer, label: string) => {
            const sizeKB = buffer.length / 1024;

            // For large PDFs (>5MB), use page targeting to extract only relevant pages
            if (sizeKB > 5000) {
                try {
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
                        if (totalSizeKB + trimmedSizeKB > MAX_SIZE_KB) return false;
                        totalSizeKB += trimmedSizeKB;
                        pdfParts.push({ inlineData: { data: trimmedBuf.toString('base64'), mimeType: 'application/pdf' } });
                        console.log(`[Config-AI] 🎯 Page targeting (${intent}): "${label}" ${(sizeKB/1024).toFixed(1)}MB → ${(trimmedSizeKB/1024).toFixed(1)}MB (${targeting.selectedPageIndices.length}/${targeting.totalPages} pages)`);
                        return true;
                    }
                } catch (ptErr: any) {
                    console.warn(`[Config-AI] Page targeting failed: ${ptErr.message}, using full PDF`);
                }
            }

            if (totalSizeKB + sizeKB > MAX_SIZE_KB) return false;
            totalSizeKB += sizeKB;
            pdfParts.push({ inlineData: { data: buffer.toString('base64'), mimeType: 'application/pdf' } });
            console.log(`[Config-AI] ✅ PDF "${label}" (${Math.round(sizeKB)} KB)`);
            return true;
        };

        for (const doc of selectedDocs.slice(0, maxDocs)) {
            try {
                let fileUrl = doc.url || '';
                if (fileUrl.includes('pncp-api/v1')) fileUrl = fileUrl.replace('pncp-api/v1', 'api/pncp/v1');
                if (!fileUrl) continue;

                const buffer = await downloadWithRetry(fileUrl, 3, 60000);

                // FIX ARCH-04: Detect file format by magic bytes (same pattern as engineeringExtractionHandler)
                const isPdf = buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46; // %PDF
                const isRar = buffer[0] === 0x52 && buffer[1] === 0x61 && buffer[2] === 0x72 && buffer[3] === 0x21; // Rar!
                const isZip = buffer[0] === 0x50 && buffer[1] === 0x4B; // PK

                if (isPdf) {
                    const added = await addPdfBuffer(buffer, doc.title || fileUrl.substring(0, 60));
                    if (!added) break; // size limit reached
                } else if (isRar) {
                    console.log(`[Config-AI] 📦 RAR detected: "${doc.title}" (${(buffer.length / 1024).toFixed(0)} KB) — extracting PDFs...`);
                    try {
                        const { createExtractorFromData } = await import('node-unrar-js');
                        const extractor = await createExtractorFromData({ data: new Uint8Array(buffer).buffer });
                        const extracted = extractor.extract({});
                        const files = [...extracted.files];
                        const pdfFiles = files.filter(f =>
                            f.fileHeader.name.toLowerCase().endsWith('.pdf') &&
                            !f.fileHeader.flags.directory &&
                            f.extraction && f.extraction.length > 0
                        );
                        // Sort by relevance for config/encargos/bdi
                        pdfFiles.sort((a, b) => {
                            const scoreFile = (name: string): number => {
                                const n = name.toLowerCase();
                                if (/planilh/i.test(n)) return 0;
                                if (/or[cç]ament/i.test(n)) return 1;
                                if (/composi[cç]/i.test(n)) return 2;
                                if (/bdi/i.test(n)) return 3;
                                if (/encargo|leis.?sociais/i.test(n)) return 4;
                                if (/cronograma/i.test(n)) return 5;
                                if (/edital|projeto.?b/i.test(n)) return 6;
                                return 10;
                            };
                            return scoreFile(a.fileHeader.name) - scoreFile(b.fileHeader.name);
                        });
                        console.log(`[Config-AI] 📦 RAR contains ${pdfFiles.length} PDF(s): ${pdfFiles.map(f => f.fileHeader.name).join(', ')}`);
                        for (const rarFile of pdfFiles.slice(0, 3)) {
                            const pdfBuffer = Buffer.from(rarFile.extraction!);
                            const added = await addPdfBuffer(pdfBuffer, `RAR:${rarFile.fileHeader.name}`);
                            if (!added) break;
                        }
                    } catch (rarErr: any) {
                        console.warn(`[Config-AI] ⚠️ Failed to extract RAR: ${rarErr.message}`);
                    }
                } else if (isZip) {
                    console.log(`[Config-AI] 📦 ZIP detected: "${doc.title}" (${(buffer.length / 1024).toFixed(0)} KB) — extracting PDFs...`);
                    try {
                        const JSZip = (await import('jszip')).default;
                        const zip = await JSZip.loadAsync(buffer);
                        let zipEntries = Object.keys(zip.files).filter(name =>
                            name.toLowerCase().endsWith('.pdf') && !zip.files[name].dir
                        );
                        // Sort by relevance
                        zipEntries.sort((a, b) => {
                            const scoreFile = (name: string): number => {
                                const n = name.toLowerCase();
                                if (/planilh/i.test(n)) return 0;
                                if (/or[cç]ament/i.test(n)) return 1;
                                if (/composi[cç]/i.test(n)) return 2;
                                if (/bdi/i.test(n)) return 3;
                                if (/encargo|leis.?sociais/i.test(n)) return 4;
                                if (/cronograma/i.test(n)) return 5;
                                if (/edital|projeto.?b/i.test(n)) return 6;
                                return 10;
                            };
                            return scoreFile(a) - scoreFile(b);
                        });
                        console.log(`[Config-AI] 📦 ZIP contains ${zipEntries.length} PDF(s): ${zipEntries.join(', ')}`);
                        for (const entryName of zipEntries.slice(0, 3)) {
                            const pdfBuffer = await zip.files[entryName].async('nodebuffer');
                            if (pdfBuffer.length > 0) {
                                const added = await addPdfBuffer(pdfBuffer, `ZIP:${entryName}`);
                                if (!added) break;
                            }
                        }
                        // FIX-15: Nested ZIP support
                        const nestedZips = Object.keys(zip.files).filter(name =>
                            name.toLowerCase().endsWith('.zip') && !zip.files[name].dir
                        );
                        for (const nestedName of nestedZips) {
                            try {
                                const nestedBuf = await zip.files[nestedName].async('nodebuffer');
                                console.log(`[Config-AI] 📦📦 Nested ZIP: "${nestedName}" (${(nestedBuf.length / 1024).toFixed(0)} KB)`);
                                const nestedZip = await JSZip.loadAsync(nestedBuf);
                                let nestedPdfs = Object.keys(nestedZip.files).filter(name =>
                                    name.toLowerCase().endsWith('.pdf') && !nestedZip.files[name].dir
                                );
                                nestedPdfs.sort((a, b) => {
                                    const scoreFile = (name: string): number => {
                                        const n = name.toLowerCase();
                                        if (/planilh/i.test(n)) return 0;
                                        if (/or[cç]ament/i.test(n)) return 1;
                                        if (/composi[cç]/i.test(n)) return 2;
                                        if (/bdi/i.test(n)) return 3;
                                        if (/encargo|leis.?sociais/i.test(n)) return 4;
                                        if (/cronograma/i.test(n)) return 5;
                                        if (/edital|projeto.?b/i.test(n)) return 6;
                                        return 10;
                                    };
                                    return scoreFile(a) - scoreFile(b);
                                });
                                for (const entry of nestedPdfs.slice(0, 3)) {
                                    const pdfBuf = await nestedZip.files[entry].async('nodebuffer');
                                    if (pdfBuf.length > 0) {
                                        const added = await addPdfBuffer(pdfBuf, `ZIP>ZIP:${entry}`);
                                        if (!added) break;
                                    }
                                }
                            } catch (nestedErr: any) {
                                console.warn(`[Config-AI] ⚠️ Nested ZIP failed: ${nestedErr.message}`);
                            }
                        }
                    } catch (zipErr: any) {
                        console.warn(`[Config-AI] ⚠️ Failed to extract ZIP: ${zipErr.message}`);
                    }
                } else {
                    console.warn(`[Config-AI] ⚠️ Unknown file format for "${doc.title}" (magic: 0x${buffer[0]?.toString(16)} 0x${buffer[1]?.toString(16)}). Skipping.`);
                }
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
// V2: Enhanced document selection + resilient prompt for varied table formats
// ═══════════════════════════════════════════════════════════
export async function extractEncargosFromBidding(biddingId: string): Promise<any | null> {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    const encargosPrompt = `Você é um engenheiro orçamentista. Analise os documentos e encontre a TABELA DE ENCARGOS SOCIAIS detalhada.

🚨 DIRETRIZES DE CONTROLE E ALUCINAÇÃO (LEIA COM ATENÇÃO):
1. Você deve retornar found=false se o documento NÃO contém a composição detalhada dos encargos sociais (ou seja, se NÃO apresenta os grupos A, B, C e D destrinchados com os valores de cada item de A1 a D2).
2. Se o documento contiver apenas os percentuais globais/finais (ex: "Encargos Sociais: Horista = 92.17%, Mensalista = 53.50%") sem a tabela detalhada de grupos, NÃO tente inventar ou preencher os itens individuais com base no SINAPI ou em seu conhecimento. Marque found=false e explique isso no campo "details".
3. Se e somente se houver uma tabela detalhada com os itens de cada grupo (A1 a D2), marque found=true e copie os valores exatos. Se um item específico da tabela estiver em branco/não mencionado, retorne 0 para ele.

A tabela de encargos detalhada tem 4 GRUPOS com colunas HORISTA (%) e MENSALISTA (%):

GRUPO A — Encargos Sociais Básicos:
  A1=INSS, A2=SESI, A3=SENAI, A4=INCRA, A5=SEBRAE, A6=Sal.Educação, A7=SAT/RAT, A8=FGTS, A9=SECONCI

GRUPO B — Encargos Trabalhistas:
  B1=Repouso Semanal, B2=Feriados, B3=Aux.Enfermidade, B4=13º Salário, B5=Lic.Paternidade,
  B6=Faltas Justificadas, B7=Dias de Chuvas, B8=Aux.Acidente, B9=Férias Gozadas, B10=Sal.Maternidade

GRUPO C — Encargos Rescisórios:
  C1=AP Indenizado, C2=AP Trabalhado, C3=Férias Indenizadas, C4=Dep.Rescisão, C5=Ind.Adicional

GRUPO D — Reincidências:
  D1=Reincidência A sobre B, D2=Reinc.A/AP + FGTS/AP

⚠️ A tabela COMPLETA tem os 4 grupos. O Total Horista normalmente fica entre 80% e 130%.
Se seu total ficou menor que 50%, você PERDEU grupos. Procure MELHOR no documento.

PROCURE em TODAS as páginas por:
- Tabelas "ENCARGOS SOCIAIS", "LEIS SOCIAIS"
- Colunas "HORISTA %" e "MENSALISTA %"
- Subtotais de cada grupo (A, B, C, D)

RETORNE JSON com TODOS estes campos (use 0 para itens não encontrados):
{
  "found": true, "basePrincipal": "SINAPI",
  "totalHorista": 115.10, "totalMensalista": 71.84,
  "a1_h": 20.00, "a1_m": 20.00, "a2_h": 1.50, "a2_m": 1.50,
  "a3_h": 1.00, "a3_m": 1.00, "a4_h": 0.20, "a4_m": 0.20,
  "a5_h": 0.60, "a5_m": 0.60, "a6_h": 2.50, "a6_m": 2.50,
  "a7_h": 3.00, "a7_m": 3.00, "a8_h": 8.00, "a8_m": 8.00,
  "a9_h": 0.00, "a9_m": 0.00,
  "b1_h": 17.86, "b1_m": 0, "b2_h": 4.72, "b2_m": 3.98,
  "b3_h": 1.39, "b3_m": 0.86, "b4_h": 10.91, "b4_m": 8.33,
  "b5_h": 0.07, "b5_m": 0.06, "b6_h": 0.72, "b6_m": 0.56,
  "b7_h": 2.07, "b7_m": 0, "b8_h": 0.08, "b8_m": 0.05,
  "b9_h": 14.14, "b9_m": 11.11, "b10_h": 0.03, "b10_m": 0.02,
  "c1_h": 5.05, "c1_m": 3.86, "c2_h": 0.11, "c2_m": 0.08,
  "c3_h": 4.88, "c3_m": 4.57, "c4_h": 4.44, "c4_m": 3.55,
  "c5_h": 0.50, "c5_m": 0.38,
  "d1_h": 9.13, "d1_m": 3.56, "d2_h": 2.40, "d2_m": 1.86,
  "details": "Mensagem descritiva explicando o que foi encontrado."
}

IMPORTANTE: Os valores acima são apenas EXEMPLO de formato. Extraia os valores REAIS do documento.`;

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

        // Anti-hallucination: if B+C+D are all zeros but A > 0, the extraction is incomplete
        const bcdHorista = parsed.grupoB_horista + parsed.grupoC_horista + parsed.grupoD_horista;
        const bcdMensalista = parsed.grupoB_mensalista + parsed.grupoC_mensalista + parsed.grupoD_mensalista;
        if (parsed.grupoA_horista > 0 && bcdHorista === 0 && bcdMensalista === 0) {
            console.warn(`[Encargos-AI] ⚠️ EXTRAÇÃO INCOMPLETA: Grupo A=${parsed.grupoA_horista}% mas B/C/D = 0%. A IA provavelmente não encontrou os grupos B/C/D no documento.`);
            parsed._extractionIncomplete = true;
        }

        console.log(`[Encargos-AI] 📊 A=${parsed.grupoA_horista} B=${parsed.grupoB_horista} C=${parsed.grupoC_horista} D=${parsed.grupoD_horista} → H=${parsed.totalHorista} M=${parsed.totalMensalista}${parsed._extractionIncomplete ? ' ⚠️ INCOMPLETA' : ''}`);
        return parsed;
    };

    // ═══════════════════════════════════════════════════
    // Encargos responseSchema — forces model to fill ALL 52 fields
    // ═══════════════════════════════════════════════════
    const n = { type: Type.NUMBER };
    const encargosSchema = {
        type: Type.OBJECT,
        properties: {
            found: { type: Type.BOOLEAN }, basePrincipal: { type: Type.STRING, nullable: true },
            totalHorista: { type: Type.NUMBER }, totalMensalista: { type: Type.NUMBER },
            a1_h: n, a1_m: n, a2_h: n, a2_m: n, a3_h: n, a3_m: n,
            a4_h: n, a4_m: n, a5_h: n, a5_m: n, a6_h: n, a6_m: n,
            a7_h: n, a7_m: n, a8_h: n, a8_m: n, a9_h: n, a9_m: n,
            b1_h: n, b1_m: n, b2_h: n, b2_m: n, b3_h: n, b3_m: n,
            b4_h: n, b4_m: n, b5_h: n, b5_m: n, b6_h: n, b6_m: n,
            b7_h: n, b7_m: n, b8_h: n, b8_m: n, b9_h: n, b9_m: n,
            b10_h: n, b10_m: n,
            c1_h: n, c1_m: n, c2_h: n, c2_m: n, c3_h: n, c3_m: n,
            c4_h: n, c4_m: n, c5_h: n, c5_m: n,
            d1_h: n, d1_m: n, d2_h: n, d2_m: n,
            details: { type: Type.STRING, nullable: true, description: 'Se found=false, explique o motivo (ex: apenas totais encontrados)' }
        },
        required: ['found', 'totalHorista', 'totalMensalista'] as string[]
    };

    try {
        // ═══════════════════════════════════════════════════
        // PASS 1: Download top-ranked encargos PDFs (up to 5)
        // ═══════════════════════════════════════════════════
        const pdfParts = await downloadPdfsForExtraction(biddingId, 5, 'encargos');
        if (pdfParts.length > 0) {
            try {
                console.log(`[Encargos-AI] 📄 PASS 1: ${pdfParts.length} PDF(s) ranked for encargos`);
                const result = await callGeminiWithRetry(ai.models, {
                    model: 'gemini-2.5-flash',
                    contents: [{ role: 'user', parts: [...pdfParts, { text: encargosPrompt }] }],
                    config: { responseMimeType: 'application/json', responseSchema: encargosSchema, temperature: 0.1 }
                });
                if (result?.text) {
                    const parsed = JSON.parse(result.text);
                    console.log(`[Encargos-AI] 📋 PASS 1 result: found=${parsed.found} totalH=${parsed.totalHorista} a1_h=${parsed.a1_h} a8_h=${parsed.a8_h} b1_h=${parsed.b1_h} b4_h=${parsed.b4_h}`);
                    if (parsed.found) {
                        const primary = enrichResult(parsed);
                        // P4: Multi-table detection — check if document has additional encargos tables
                        try {
                            const fieldsList = 'a1_h,a1_m,a2_h,a2_m,a3_h,a3_m,a4_h,a4_m,a5_h,a5_m,a6_h,a6_m,a7_h,a7_m,a8_h,a8_m,a9_h,a9_m,b1_h,b1_m,b2_h,b2_m,b3_h,b3_m,b4_h,b4_m,b5_h,b5_m,b6_h,b6_m,b7_h,b7_m,b8_h,b8_m,b9_h,b9_m,b10_h,b10_m,c1_h,c1_m,c2_h,c2_m,c3_h,c3_m,c4_h,c4_m,c5_h,c5_m,d1_h,d1_m,d2_h,d2_m';
                            const multiPrompt = `Analise os documentos. Quantas tabelas DISTINTAS de Encargos Sociais existem?
Um edital pode ter 1, 2, 3 ou mais tabelas (ex: SINAPI, SEINFRA, ORSE, Obras, Serviços).
A tabela "${primary.basePrincipal || 'principal'}" já foi extraída. Extraia TODAS as outras tabelas restantes.

Se há APENAS UMA tabela no total, retorne: {"count":1,"tables":[]}
Se há MAIS tabelas, retorne CADA UMA com todos os 52 campos analíticos:
{"count":3,"tables":[
  {"basePrincipal":"SEINFRA","totalHorista":114.15,"totalMensalista":68.50,${fieldsList.split(',').map(f => `"${f}":0`).join(',')}},
  {"basePrincipal":"ORSE","totalHorista":110.00,"totalMensalista":65.00,${fieldsList.split(',').map(f => `"${f}":0`).join(',')}}
]}
IMPORTANTE: Os valores acima são EXEMPLO. Extraia os valores REAIS de cada tabela adicional.
Cada tabela DEVE ter basePrincipal, totalHorista, totalMensalista e todos os 52 campos (${fieldsList}).`;
                            const multiResult = await ai.models.generateContent({
                                model: 'gemini-2.5-flash',
                                contents: [{ role: 'user', parts: [...pdfParts, { text: multiPrompt }] }],
                                config: { responseMimeType: 'application/json', temperature: 0.1 }
                            });
                            if (multiResult?.text) {
                                const multiParsed = JSON.parse(multiResult.text);
                                if (multiParsed.count > 1 && Array.isArray(multiParsed.tables) && multiParsed.tables.length > 0) {
                                    primary.additionalTables = multiParsed.tables.map((t: any) => enrichResult({ ...t, found: true }));
                                    console.log(`[Encargos-AI] 📋 Multi-table: Found ${multiParsed.count} total. Additional: ${primary.additionalTables.map((t: any) => `${t.basePrincipal}(H=${t.totalHorista}%)`).join(', ')}`);
                                } else {
                                    console.log(`[Encargos-AI] ℹ️ Multi-table: Only 1 table found in document`);
                                }
                            }
                        } catch (multiErr: any) {
                            console.warn(`[Encargos-AI] ⚠️ Multi-table detection failed (non-critical): ${multiErr.message}`);
                        }
                        return primary;
                    }
                    console.log(`[Encargos-AI] ⚠️ PASS 1 returned found=false. Trying broader search...`);
                }
            } catch (e: any) {
                console.warn(`[Encargos-AI] ⚠️ PASS 1 falhou: ${e.message}`);
            }
        } else {
            console.log(`[Encargos-AI] ⚠️ PASS 1: Nenhum PDF disponível para extração`);
        }

        // ═══════════════════════════════════════════════════
        // PASS 2: Try with ALL available PDFs (broader search)
        // Sometimes encargos are embedded in unexpected documents
        // ═══════════════════════════════════════════════════
        const allPdfParts = await downloadPdfsForExtraction(biddingId, 6, 'config');
        if (allPdfParts.length > pdfParts.length) {
            try {
                console.log(`[Encargos-AI] 📄 PASS 2: ${allPdfParts.length} PDF(s) broad search (config-ranked)`);
                const result = await callGeminiWithRetry(ai.models, {
                    model: 'gemini-2.5-flash',
                    contents: [{ role: 'user', parts: [...allPdfParts, { text: encargosPrompt }] }],
                    config: { responseMimeType: 'application/json', responseSchema: encargosSchema, temperature: 0.1 }
                });
                if (result?.text) {
                    const parsed = JSON.parse(result.text);
                    console.log(`[Encargos-AI] 📋 PASS 2 result: found=${parsed.found} totalH=${parsed.totalHorista}`);
                    if (parsed.found) return enrichResult(parsed);
                }
            } catch (e: any) {
                console.warn(`[Encargos-AI] ⚠️ PASS 2 falhou: ${e.message}`);
            }
        }

        // ═══════════════════════════════════════════════════
        // PASS 3: Text fallback from DocumentChunks
        // ═══════════════════════════════════════════════════
        const text = await getEditalText(biddingId, INTENT_KEYWORDS.encargos);
        if (text.length < 100) {
            console.log(`[Encargos-AI] ⚠️ Texto insuficiente (${text.length} chars). Sem mais opções.`);
            return { found: false, details: 'Nenhum documento contém tabela de encargos sociais identificável.' };
        }
        console.log(`[Encargos-AI] 📝 PASS 3 Texto: ${text.length} chars`);
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: encargosPrompt + '\n\nTEXTO DO EDITAL:\n' + text.substring(0, 100000),
            config: { responseMimeType: 'application/json', responseSchema: encargosSchema, temperature: 0.1 }
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

// ═══════════════════════════════════════════════════════════
// Extract Config from IMAGE (clipboard paste / upload)
// ═══════════════════════════════════════════════════════════
export async function extractConfigFromImage(imageBase64: string, mimeType: string): Promise<any | null> {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    const prompt = `Analise esta imagem que contém informações do EDITAL ou PROJETO BÁSICO (Dados do Orçamento).
Extraia TODAS as seguintes informações:
1. **objeto**: Transcreva LITERALMENTE o objeto da obra.
2. **uf**: UF onde a obra será executada (sigla, ex: CE, SP).
3. **bases**: TODAS as bases/tabelas de custos (SINAPI, SEINFRA, SICRO, ORSE, SBC, PROPRIA, etc.). Retorne array de strings.
4. **dataBase**: Mês/ano de referência PRINCIPAL (formato YYYY-MM).
5. **dataBasesPorFonte**: Se houver datas diferentes para bases diferentes, ex: {"SINAPI": "2025-09", "SEINFRA": "2025-08"}.
6. **regime**: "ONERADO" ou "DESONERADO".

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
        required: ['found']
    };

    try {
        const result = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [{ role: 'user', parts: [
                { inlineData: { data: imageBase64, mimeType: mimeType || 'image/png' } },
                { text: prompt }
            ]}],
            config: { responseMimeType: 'application/json', responseSchema, temperature: 0.1 }
        });
        if (!result?.text) return { found: false };
        const parsed = JSON.parse(result.text);
        console.log(`[Config-IMG] 📋 found=${parsed.found}, uf=${parsed.uf}, regime=${parsed.regime}`);
        return parsed;
    } catch (e: any) {
        console.error(`[Config-IMG] ❌ ${e.message}`);
        return { found: false, error: e.message };
    }
}

// ═══════════════════════════════════════════════════════════
// Extract BDI from IMAGE (clipboard paste / upload)
// ═══════════════════════════════════════════════════════════
export async function extractBdiFromImage(imageBase64: string, mimeType: string, isOnerado: boolean = false): Promise<any | null> {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    
    // Note: this aligns with bdiAiExtractor.ts output format.
    const prompt = `Analise esta imagem de uma TABELA DE BDI (Benefícios e Despesas Indiretas) do edital.
Você deve extrair os componentes percentuais (%) da fórmula do TCU 2622.

IMPORTANTE SOBRE COMPONENTES:
- Administração Central deve ser mapeada para "adminCentral".
- Seguros deve ser mapeada para "seguros".
- Garantia deve ser mapeada para "garantias".
- Se houver uma linha combinada "Seguro e Garantia" (ou similar), divida o valor igualmente entre "seguros" e "garantias".
- Despesas Financeiras deve ser mapeada para "despFinanceiras".
- Riscos deve ser mapeada para "riscos".
- Lucro / Remuneração deve ser mapeada para "lucro".

IMPORTANTE SOBRE TRIBUTOS:
Se os tributos estiverem detalhados, extraia separadamente: PIS, COFINS, ISS e CPRB.
${isOnerado ? 'O regime é ONERADO. Extraia também a CSLL (Contribuição Social sobre o Lucro Líquido).' : 'O regime NÃO EXIGE CSLL, mas se a imagem listar ISS, PIS, COFINS, e CPRB, extraia-os.'}

Retorne JSON:
{
  "found": true,
  "bdiType": "TCU",
  "tcu": {
    "adminCentral": N,
    "seguros": N,
    "garantias": N,
    "riscos": N,
    "despFinanceiras": N,
    "lucro": N,
    "pis": N,
    "cofins": N,
    "iss": N,
    "cprb": N,
    "csll": N
  }
}
Onde N é o número percentual sem o símbolo % (ex: 3.00, 0.65, 1.20). Se um item não existir, retorne 0. Se a imagem mostrar apenas um "Total de Tributos" genérico em vez de detalhar, coloque esse total no campo "iss" e 0 no resto, para preservar a soma.`;

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
        console.log(`[BDI-IMG] 📋 found=${parsed.found}`);
        return parsed;
    } catch (e: any) {
        console.error(`[BDI-IMG] ❌ ${e.message}`);
        return { found: false, error: e.message };
    }
}

