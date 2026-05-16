import { GoogleGenAI, Type } from '@google/genai';
import { PrismaClient } from '@prisma/client';
import { callGeminiWithRetry } from '../ai/gemini.service';
import axios from 'axios';
import https from 'https';
import { classifyEngineeringAttachments } from './documentClassifier';

const prisma = new PrismaClient();

type BdiExtractionTarget = 'SERVICOS' | 'FORNECIMENTO' | 'ALL';

export async function extractBdiFromBidding(biddingId: string, target: BdiExtractionTarget = 'ALL'): Promise<any | null> {
    const bidding = await prisma.biddingProcess.findUnique({
        where: { id: biddingId },
        include: { aiAnalysis: true }
    });

    if (!bidding) throw new Error('Processo não encontrado');

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    const bdiPrompt = `Você é um engenheiro orçamentista SÊNIOR. Analise o documento e encontre a COMPOSIÇÃO ANALÍTICA DO BDI.

ALVO: ${target}.

🚨 REGRA ABSOLUTA: COPIE os valores EXATOS do documento. NUNCA invente. NUNCA use valores padrão/medianas.
Se o documento diz AC=3,00%, retorne adminCentral=3.00 — NÃO 4.00 (que é mediana TCU).
Se o documento diz L=6,16%, retorne lucro=6.16 — NÃO 5.48 ou outro valor inventado.
Se o documento diz ISS=3,00%, retorne iss=3.00 — NÃO 2.00.

FORMATOS COMUNS DE TABELA BDI EM EDITAIS:

FORMATO 1 — Seções agrupadas:
| COD   | DESCRIÇÃO                | %     |
|-------|--------------------------|-------|
|       | **Benefício**            |       |
| S + G | Garantia/seguros         | 0,80% |   ← seguros=0.40, garantias=0.40
| L     | Lucro                    | 6,16% |   ← lucro=6.16
|       | TOTAL                    | 6,96% |
|       | **Despesas Indiretas**   |       |
| AC    | Administração central    | 3,00% |   ← adminCentral=3.00
| DF    | Despesas financeiras     | 0,59% |   ← despFinanceiras=0.59
| R     | Riscos                   | 0,97% |   ← riscos=0.97
|       | TOTAL                    | 4,56% |
| I     | **Impostos**             |       |
|       | COFINS                   | 3,00% |   ← cofins=3.00
|       | ISS                      | 3,00% |   ← iss=3.00
|       | PIS                      | 0,65% |   ← pis=0.65
|       | TOTAL                    | 6,65% |

FORMATO 2 — Lista simples:
AC=4.00, S=0.80, G=0.42, R=0.97, DF=0.59, L=6.16, Tributos=5.65%

⚠️ CAMPOS COMBINADOS:
- "S + G" ou "Garantia/seguros" como LINHA ÚNICA → divida igualmente: S+G=0.80 → seguros=0.40, garantias=0.40
- "Benefício TOTAL" = soma de S+G+L. NÃO confundir com BDI Global.

⚠️ TRIBUTOS:
Se o edital detalha (COFINS, ISS, PIS), extraia cada um.
Se mostra apenas "Tributos (I) = X%" sem subtabela: pis=0.65, cofins=3.00, csll=0, iss=(X-0.65-3.00).

EXTRAIA OBRIGATORIAMENTE estes campos do documento:
- adminCentral (AC), seguros (S), garantias (G), riscos (R)
- despFinanceiras (DF), lucro (L)
- pis, cofins, iss, csll (0 se não mencionado)

REGRAS:
1. Se encontrou QUALQUER tabela de BDI com componentes, SEMPRE retorne tcu preenchido.
2. Só retorne tcu=null se REALMENTE só houver o percentual global isolado.
3. NUNCA coloque o BDI total no campo lucro.
4. Se um campo não aparece no documento, coloque 0.
5. globalBdi é o BDI resultante da fórmula (não a soma dos componentes).

Retorne números sem %.`;

    const tcuSchema = {
        type: Type.OBJECT,
        nullable: true,
        description: 'Componentes INDIVIDUAIS extraídos EXATAMENTE do documento. PROIBIDO usar valores default.',
        properties: {
            adminCentral: { type: Type.NUMBER, description: 'Administração Central (AC) — copie o valor EXATO do documento' },
            seguros: { type: Type.NUMBER, description: 'Seguros (S) — se combinado S+G, divida igualmente' },
            garantias: { type: Type.NUMBER, description: 'Garantias (G) — se combinado S+G, divida igualmente' },
            riscos: { type: Type.NUMBER, description: 'Riscos (R) — copie o valor EXATO do documento' },
            despFinanceiras: { type: Type.NUMBER, description: 'Despesas Financeiras (DF) — copie o valor EXATO' },
            lucro: { type: Type.NUMBER, description: 'Lucro/Remuneração (L) — copie o valor EXATO. NUNCA o BDI total.' },
            pis: { type: Type.NUMBER, description: 'PIS — copie o valor EXATO' },
            cofins: { type: Type.NUMBER, description: 'COFINS — copie o valor EXATO' },
            iss: { type: Type.NUMBER, description: 'ISS — copie o valor EXATO' },
            csll: { type: Type.NUMBER, description: 'CSLL — copie ou 0 se não mencionado' },
        }
    };

    const responseSchema = {
        type: Type.OBJECT,
        properties: {
            found: { type: Type.BOOLEAN, description: 'Se a tabela de BDI foi encontrada no edital.' },
            globalBdi: { type: Type.NUMBER, description: 'O valor do BDI Global (percentual).', nullable: true },
            tcu: tcuSchema,
            globalBdiFornecimento: { type: Type.NUMBER, description: 'BDI diferenciado para fornecimento/materiais.', nullable: true },
            tcuFornecimento: tcuSchema,
        },
        required: ['found'] as string[]
    };

    const sanitizeBdiResult = (parsed: any) => {
        if (!parsed?.found) return parsed;

        // Fix: AI put BDI total in lucro field (lucro ≈ globalBdi AND other fields are 0 or very small)
        if (parsed.tcu && parsed.globalBdi) {
            const t = parsed.tcu;
            const otherFieldsSum = (t.adminCentral || 0) + (t.seguros || 0) + (t.garantias || 0) + (t.riscos || 0) + (t.despFinanceiras || 0);
            const lucroApproxGlobal = Math.abs(t.lucro - parsed.globalBdi) < 0.5;
            // Only strip if lucro ≈ globalBdi AND the other fields are negligible (AI clearly confused them)
            if (lucroApproxGlobal && otherFieldsSum < 2) {
                console.warn(`[BDI-AI] ⚠️ AI colocou BDI total (${parsed.globalBdi}) no campo Lucro (otherSum=${otherFieldsSum}). Removendo tcu.`);
                parsed.tcu = null;
            } else if (lucroApproxGlobal) {
                console.warn(`[BDI-AI] ⚠️ Lucro (${t.lucro}) ≈ globalBdi (${parsed.globalBdi}) mas outros campos têm valores (sum=${otherFieldsSum}). Mantendo tcu.`);
            }
        }
        if (parsed.tcuFornecimento && parsed.globalBdiFornecimento) {
            const t = parsed.tcuFornecimento;
            const otherSum = (t.adminCentral || 0) + (t.seguros || 0) + (t.garantias || 0) + (t.riscos || 0) + (t.despFinanceiras || 0);
            if (Math.abs(t.lucro - parsed.globalBdiFornecimento) < 0.5 && otherSum < 2) {
                console.warn(`[BDI-AI] ⚠️ AI colocou BDI fornecimento total no Lucro. Removendo tcuFornecimento.`);
                parsed.tcuFornecimento = null;
            }
        }

        // Log detailed extraction for debugging
        if (parsed.tcu) {
            const t = parsed.tcu;
            console.log(`[BDI-AI] 📊 Extracted TCU: AC=${t.adminCentral} S=${t.seguros} G=${t.garantias} R=${t.riscos} DF=${t.despFinanceiras} L=${t.lucro} PIS=${t.pis} COFINS=${t.cofins} ISS=${t.iss} CSLL=${t.csll}`);
        }
        return parsed;
    };

    // ═══════════════════════════════════════════════════════
    // TIER 1 (PRIMÁRIO): PDFs do PNCP via multimodal
    // Uses page targeting for large PDFs to ensure BDI pages are included
    // ═══════════════════════════════════════════════════════
    if (bidding.pncpLink) {
        try {
            const linkMatch = bidding.pncpLink.match(/(\d{14})\/(\d{4})\/(\d+)/);
            if (linkMatch) {
                const [, cnpj, ano, seq] = linkMatch;
                const agent = new https.Agent({ rejectUnauthorized: false });
                const arquivosUrl = `https://pncp.gov.br/api/pncp/v1/orgaos/${cnpj}/compras/${ano}/${seq}/arquivos`;

                const apiRes = await axios.get(arquivosUrl, { httpsAgent: agent, timeout: 20000 } as any);
                const arquivos = Array.isArray(apiRes.data) ? apiRes.data : [];

                if (arquivos.length > 0) {
                    const classified = classifyEngineeringAttachments(arquivos, { maxDocuments: 3 });
                    const selectedDocs = classified.selected.length > 0
                        ? classified.selected
                        : classified.all.filter(doc => doc.score > -20).slice(0, 3);

                    const pdfParts: any[] = [];
                    const MAX_SIZE_KB = 20000; // 20MB — increased for large engineering PDFs
                    let totalSizeKB = 0;

                    // Helper: add a PDF buffer with optional page targeting for BDI extraction
                    const addPdfForBdi = async (buf: Buffer, label: string) => {
                        const sizeKB = buf.length / 1024;
                        if (sizeKB > 5000) {
                            try {
                                const { targetBudgetPages } = await import('./pageTargeting');
                                const targeting = await targetBudgetPages(buf, {
                                    minScore: 3,
                                    maxPages: 25,
                                    contextPages: 1,
                                    minPagesForTargeting: 10,
                                    extraKeywords: ['BDI', 'B.D.I.', 'LDI', 'L.D.I.', 'COMPOSIÇÃO DO BDI', 'BONIFICAÇÃO', 'DESPESAS INDIRETAS', 'ACÓRDÃO TCU', 'LUCRO', 'ADMINISTRAÇÃO CENTRAL', 'TRIBUTOS'],
                                });
                                if (targeting.strategy === 'targeted' && targeting.trimmedPdfBuffer) {
                                    const trimmedBuf = targeting.trimmedPdfBuffer;
                                    const trimmedSizeKB = trimmedBuf.length / 1024;
                                    if (totalSizeKB + trimmedSizeKB > MAX_SIZE_KB) return false;
                                    totalSizeKB += trimmedSizeKB;
                                    pdfParts.push({ inlineData: { data: trimmedBuf.toString('base64'), mimeType: 'application/pdf' } });
                                    console.log(`[BDI-AI] 🎯 Page targeting: "${label}" ${(sizeKB/1024).toFixed(1)}MB → ${(trimmedSizeKB/1024).toFixed(1)}MB (${targeting.selectedPageIndices.length}/${targeting.totalPages} pages)`);
                                    return true;
                                }
                            } catch (ptErr: any) {
                                console.warn(`[BDI-AI] Page targeting failed: ${ptErr.message}`);
                            }
                        }
                        if (totalSizeKB + sizeKB > MAX_SIZE_KB) return false;
                        totalSizeKB += sizeKB;
                        pdfParts.push({ inlineData: { data: buf.toString('base64'), mimeType: 'application/pdf' } });
                        console.log(`[BDI-AI] ✅ PDF "${label}" (${Math.round(sizeKB)}KB)`);
                        return true;
                    };

                    for (const doc of selectedDocs.slice(0, 3)) {
                        try {
                            let fileUrl = doc.url || '';
                            if (fileUrl.includes('pncp-api/v1')) fileUrl = fileUrl.replace('pncp-api/v1', 'api/pncp/v1');
                            if (!fileUrl) continue;

                            const fileRes = await axios.get(fileUrl, {
                                responseType: 'arraybuffer', httpsAgent: agent,
                                timeout: 60000, maxRedirects: 5,
                                maxContentLength: 30 * 1024 * 1024,
                            } as any);
                            const buffer = Buffer.from(fileRes.data as ArrayBuffer);

                            // FIX ARCH-04: Detect file format by magic bytes
                            const isPdf = buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;
                            const isRar = buffer[0] === 0x52 && buffer[1] === 0x61 && buffer[2] === 0x72 && buffer[3] === 0x21;
                            const isZip = buffer[0] === 0x50 && buffer[1] === 0x4B;

                            if (isPdf) {
                                const added = await addPdfForBdi(buffer, doc.title || 'unknown');
                                if (!added) break;
                            } else if (isRar) {
                                console.log(`[BDI-AI] 📦 RAR detected: "${doc.title}" (${(buffer.length / 1024).toFixed(0)} KB) — extracting PDFs...`);
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
                                    console.log(`[BDI-AI] 📦 RAR contains ${pdfFiles.length} PDF(s): ${pdfFiles.map(f => f.fileHeader.name).join(', ')}`);
                                    for (const rarFile of pdfFiles.slice(0, 3)) {
                                        const pdfBuffer = Buffer.from(rarFile.extraction!);
                                        const added = await addPdfForBdi(pdfBuffer, `RAR:${rarFile.fileHeader.name}`);
                                        if (!added) break;
                                    }
                                } catch (rarErr: any) {
                                    console.warn(`[BDI-AI] ⚠️ Failed to extract RAR: ${rarErr.message}`);
                                }
                            } else if (isZip) {
                                console.log(`[BDI-AI] 📦 ZIP detected: "${doc.title}" (${(buffer.length / 1024).toFixed(0)} KB) — extracting PDFs...`);
                                try {
                                    const JSZip = (await import('jszip')).default;
                                    const zip = await JSZip.loadAsync(buffer);
                                    const zipEntries = Object.keys(zip.files).filter(name =>
                                        name.toLowerCase().endsWith('.pdf') && !zip.files[name].dir
                                    );
                                    console.log(`[BDI-AI] 📦 ZIP contains ${zipEntries.length} PDF(s): ${zipEntries.join(', ')}`);
                                    for (const entryName of zipEntries.slice(0, 3)) {
                                        const pdfBuffer = await zip.files[entryName].async('nodebuffer');
                                        if (pdfBuffer.length > 0) {
                                            const added = await addPdfForBdi(pdfBuffer, `ZIP:${entryName}`);
                                            if (!added) break;
                                        }
                                    }
                                } catch (zipErr: any) {
                                    console.warn(`[BDI-AI] ⚠️ Failed to extract ZIP: ${zipErr.message}`);
                                }
                            } else {
                                console.warn(`[BDI-AI] ⚠️ Unknown format for "${doc.title}" (magic: 0x${buffer[0]?.toString(16)} 0x${buffer[1]?.toString(16)}). Skipping.`);
                            }
                        } catch (dlErr: any) {
                            console.warn(`[BDI-AI] ⚠️ PDF download failed: ${dlErr.message}`);
                        }
                    }

                    if (pdfParts.length > 0) {
                        console.log(`[BDI-AI] 📄 Enviando ${pdfParts.length} PDFs ao Gemini para extração multimodal de BDI`);
                        const result = await callGeminiWithRetry(ai.models, {
                            model: 'gemini-2.5-flash',
                            contents: [{ role: 'user', parts: [...pdfParts, { text: bdiPrompt }] }],
                            config: {
                                responseMimeType: 'application/json',
                                responseSchema,
                                temperature: 0.05,
                            }
                        });

                        if (result?.text) {
                            const parsed = JSON.parse(result.text);
                            if (parsed.found) {
                                let sanitized = sanitizeBdiResult(parsed);
                                console.log(`[BDI-AI] ✅ BDI extraído via multimodal PDF — alvo: ${target}, global: ${sanitized.globalBdi}%, tcu: ${sanitized.tcu ? 'SIM (AC=' + sanitized.tcu.adminCentral + ', L=' + sanitized.tcu.lucro + ')' : 'NÃO (apenas global)'}, fornecimento: ${sanitized.globalBdiFornecimento || 'N/A'}%`);

                                // RETRY: If tcu is null but we found globalBdi, force a second pass with non-nullable tcu
                                if (!sanitized.tcu && sanitized.globalBdi && pdfParts.length > 0) {
                                    console.log(`[BDI-AI] 🔄 RETRY: tcu=null, forçando extração de composição com tcu obrigatório...`);
                                    const forcedSchema = {
                                        type: Type.OBJECT,
                                        properties: {
                                            adminCentral: { type: Type.NUMBER }, seguros: { type: Type.NUMBER },
                                            garantias: { type: Type.NUMBER }, riscos: { type: Type.NUMBER },
                                            despFinanceiras: { type: Type.NUMBER }, lucro: { type: Type.NUMBER },
                                            pis: { type: Type.NUMBER }, cofins: { type: Type.NUMBER },
                                            iss: { type: Type.NUMBER }, csll: { type: Type.NUMBER },
                                        }
                                    };
                                    const retryPrompt = `O BDI GLOBAL deste edital é ${sanitized.globalBdi}%.
Agora extraia a COMPOSIÇÃO ANALÍTICA (os componentes individuais que formam esse BDI).
Procure a tabela com AC (Administração Central), S (Seguros), G (Garantias), R (Riscos), DF (Despesas Financeiras), L (Lucro), e Tributos (PIS, COFINS, ISS).
COPIE os valores EXATOS do documento. Se um campo não aparece, coloque 0.
NUNCA coloque o BDI total (${sanitized.globalBdi}%) no campo lucro. Lucro é só a margem de lucro.`;
                                    try {
                                        const retryResult = await callGeminiWithRetry(ai.models, {
                                            model: 'gemini-2.5-flash',
                                            contents: [{ role: 'user', parts: [...pdfParts, { text: retryPrompt }] }],
                                            config: { responseMimeType: 'application/json', responseSchema: forcedSchema, temperature: 0.02 }
                                        });
                                        if (retryResult?.text) {
                                            const retryParsed = JSON.parse(retryResult.text);
                                            const retrySum = (retryParsed.adminCentral || 0) + (retryParsed.seguros || 0) + (retryParsed.garantias || 0) + (retryParsed.riscos || 0) + (retryParsed.despFinanceiras || 0) + (retryParsed.lucro || 0);
                                            console.log(`[BDI-AI] 🔄 RETRY result: AC=${retryParsed.adminCentral} S=${retryParsed.seguros} G=${retryParsed.garantias} R=${retryParsed.riscos} DF=${retryParsed.despFinanceiras} L=${retryParsed.lucro} sum=${retrySum.toFixed(2)}`);
                                            // Only use retry if it produced meaningful values (sum > 5% and lucro != globalBdi)
                                            if (retrySum > 5 && Math.abs(retryParsed.lucro - sanitized.globalBdi) > 0.5) {
                                                sanitized.tcu = retryParsed;
                                                console.log(`[BDI-AI] ✅ RETRY: composição aceita!`);
                                            } else {
                                                console.warn(`[BDI-AI] ⚠️ RETRY: resultado descartado (sum=${retrySum.toFixed(2)}, lucro≈global=${Math.abs(retryParsed.lucro - sanitized.globalBdi) < 0.5})`);
                                            }
                                        }
                                    } catch (retryErr: any) {
                                        console.warn(`[BDI-AI] ⚠️ RETRY falhou: ${retryErr.message}`);
                                    }
                                }

                                return sanitized;
                            }
                        }
                    }
                }
            }
        } catch (pdfErr: any) {
            console.warn(`[BDI-AI] ⚠️ Modo PDF multimodal falhou: ${pdfErr.message}`);
        }
    }

    // ═══════════════════════════════════════════════════════
    // TIER 2: DocumentChunks (RAG index, full text)
    // ═══════════════════════════════════════════════════════
    let text = '';
    const chunks = await prisma.documentChunk.findMany({
        where: { biddingProcessId: biddingId },
        orderBy: { id: 'asc' }
    });

    if (chunks && chunks.length > 0) {
        text = chunks.map(c => c.content).join('\n\n');
    }

    // TIER 3: AiAnalysis fields (fallback when RAG indexing hasn't run)
    if (!text || text.length < 200) {
        if (bidding?.aiAnalysis) {
            const parts: string[] = [];
            const a = bidding.aiAnalysis;
            if (a.fullSummary) parts.push(a.fullSummary);
            if (a.biddingItems) parts.push(a.biddingItems);
            if (a.pricingConsiderations) parts.push(a.pricingConsiderations);
            if (a.requiredDocuments) parts.push(a.requiredDocuments);
            const schemaV2 = a.schemaV2 as any;
            if (schemaV2?.proposal_analysis) {
                parts.push('DADOS ESTRUTURADOS:\n' + JSON.stringify(schemaV2.proposal_analysis, null, 2));
            }
            text = parts.join('\n\n---\n\n');
        }
    }

    // TIER 4: No text available at all
    if (!text || text.length < 100) {
        throw new Error('Texto do edital não disponível. Analise o edital primeiro para extrair o BDI.');
    }

    const chunk = text.substring(0, 150000);

    console.log(`[BDI-AI] 📝 Fallback texto: ${chunk.length} chars`);
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: bdiPrompt + '\n\nTEXTO DO EDITAL:\n' + chunk,
        config: {
            responseMimeType: 'application/json',
            responseSchema,
            temperature: 0.05,
        }
    });

    if (!response.text) return null;
    try {
        return sanitizeBdiResult(JSON.parse(response.text));
    } catch {
        return null;
    }
}
