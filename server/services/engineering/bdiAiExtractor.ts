import { GoogleGenAI, Type } from '@google/genai';
import { PrismaClient } from '@prisma/client';
import { callGeminiWithRetry } from '../ai/gemini.service';
import axios from 'axios';
import https from 'https';
import { classifyEngineeringAttachments } from './documentClassifier';

const prisma = new PrismaClient();

export async function extractBdiFromBidding(biddingId: string): Promise<any | null> {
    const bidding = await prisma.biddingProcess.findUnique({
        where: { id: biddingId },
        include: { aiAnalysis: true }
    });

    if (!bidding) throw new Error('Processo não encontrado');

    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

    const bdiPrompt = `Você é um engenheiro orçamentista SÊNIOR analisando um edital de licitação pública.
Seu objetivo é encontrar a COMPOSIÇÃO ANALÍTICA DO BDI (Benefícios e Despesas Indiretas) exigida pelo edital.

PROCURE POR:
- Tabelas intituladas "COMPOSIÇÃO DO BDI", "COMPOSIÇÃO DE BDI", "BDI - SERVIÇOS", "BDI ADOTADO"
- Referências ao Acórdão TCU 2622/2013 ou TCU 2369/2011
- Quadros com a fórmula: BDI = {(1+AC+S+G+R)×(1+DF)×(1+L)/(1-I) - 1} × 100
- Em planilhas OGU do TransfereGOV, o BDI aparece no cabeçalho como "BDI 1", "BDI 2", "BDI 3" (só o percentual global)

EXTRAIA OBRIGATORIAMENTE os seguintes percentuais individuais (NÃO o BDI total):
- **adminCentral**: Administração Central (AC) — típico: 3-5%
- **seguros**: Seguros (S) — típico: 0.5-1%
- **garantias**: Garantias (G) — típico: 0-1%
- **riscos**: Riscos (R) — típico: 0.5-1.5%
- **despFinanceiras**: Despesas Financeiras (DF) — típico: 0.5-1.5%
- **lucro**: Lucro / Remuneração (L) — típico: 4-8%
- **tributos**: Tributos = PIS + COFINS + ISS (I) — típico: 5-7%

REGRAS CRÍTICAS:
1. Se você encontrar APENAS o BDI global (ex: "BDI = 20,35%") SEM detalhamento, retorne found=true, globalBdi=20.35, tcu=null.
2. Se encontrar a COMPOSIÇÃO DETALHADA (cada componente individual), retorne found=true, globalBdi com o valor calculado, E tcu com TODOS os 7 componentes preenchidos.
3. NUNCA coloque o valor do BDI global no campo "lucro". Lucro é APENAS a margem de lucro/remuneração da empresa (tipicamente 4-8%).
4. Se um componente é "0" ou não mencionado, coloque 0 — NÃO omita o campo.
5. Os valores individuais são SEMPRE MUITO MENORES que o BDI total.

EXEMPLO de composição válida:
AC=4.00, S=0.80, G=0.80, R=0.97, DF=0.59, L=6.16, I=5.65 → BDI = 20.35%

Retorne apenas os números (sem o símbolo de %).`;

    const responseSchema = {
        type: Type.OBJECT,
        properties: {
            found: { type: Type.BOOLEAN, description: 'Se a tabela de BDI foi encontrada no edital.' },
            globalBdi: { type: Type.NUMBER, description: 'O valor do BDI Global calculado (em percentual).', nullable: true },
            tcu: {
                type: Type.OBJECT,
                nullable: true,
                description: 'Os parâmetros INDIVIDUAIS do BDI conforme Acórdão TCU. Cada campo é um percentual pequeno (0-10%). NÃO colocar o BDI total em nenhum campo.',
                properties: {
                    adminCentral: { type: Type.NUMBER, description: 'Administração Central (AC) — tipicamente 3-5%' },
                    seguros: { type: Type.NUMBER, description: 'Seguros (S) — tipicamente 0.5-1%' },
                    garantias: { type: Type.NUMBER, description: 'Garantias (G) — tipicamente 0-1%' },
                    riscos: { type: Type.NUMBER, description: 'Riscos (R) — tipicamente 0.5-1.5%' },
                    despFinanceiras: { type: Type.NUMBER, description: 'Despesas Financeiras (DF) — tipicamente 0.5-1.5%' },
                    lucro: { type: Type.NUMBER, description: 'Lucro/Remuneração (L) — tipicamente 4-8%. NUNCA o BDI total.' },
                    tributos: { type: Type.NUMBER, description: 'Tributos PIS+COFINS+ISS (I) — tipicamente 5-7%' },
                }
            }
        },
        required: ['found'] as string[]
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

                            if (buffer[0] !== 0x25 || buffer[1] !== 0x50) continue; // Not PDF

                            const sizeKB = buffer.length / 1024;

                            // Page targeting for large PDFs (>5MB)
                            if (sizeKB > 5000) {
                                try {
                                    const { targetBudgetPages } = await import('./pageTargeting');
                                    const targeting = await targetBudgetPages(buffer, {
                                        minScore: 3,
                                        maxPages: 25,
                                        contextPages: 1,
                                        minPagesForTargeting: 10,
                                        extraKeywords: ['BDI', 'COMPOSIÇÃO DO BDI', 'BONIFICAÇÃO', 'DESPESAS INDIRETAS', 'ACÓRDÃO TCU', 'LUCRO', 'ADMINISTRAÇÃO CENTRAL', 'TRIBUTOS'],
                                    });
                                    if (targeting.strategy === 'targeted' && targeting.trimmedPdfBuffer) {
                                        const trimmedBuf = targeting.trimmedPdfBuffer;
                                        const trimmedSizeKB = trimmedBuf.length / 1024;
                                        if (totalSizeKB + trimmedSizeKB > MAX_SIZE_KB) break;
                                        totalSizeKB += trimmedSizeKB;
                                        pdfParts.push({ inlineData: { data: trimmedBuf.toString('base64'), mimeType: 'application/pdf' } });
                                        console.log(`[BDI-AI] 🎯 Page targeting: ${(sizeKB/1024).toFixed(1)}MB → ${(trimmedSizeKB/1024).toFixed(1)}MB (${targeting.selectedPageIndices.length}/${targeting.totalPages} pages)`);
                                        continue;
                                    }
                                } catch (ptErr: any) {
                                    console.warn(`[BDI-AI] Page targeting failed: ${ptErr.message}`);
                                }
                            }

                            if (totalSizeKB + sizeKB > MAX_SIZE_KB) break;
                            totalSizeKB += sizeKB;
                            pdfParts.push({ inlineData: { data: buffer.toString('base64'), mimeType: 'application/pdf' } });
                            console.log(`[BDI-AI] ✅ PDF "${doc.title}" (${Math.round(sizeKB)}KB)`);
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
                                // Validation: if tcu.lucro == globalBdi, the AI confused total with component
                                if (parsed.tcu && parsed.globalBdi && Math.abs(parsed.tcu.lucro - parsed.globalBdi) < 0.5) {
                                    console.warn(`[BDI-AI] ⚠️ AI colocou BDI total (${parsed.globalBdi}) no campo Lucro. Removendo tcu para usar apenas globalBdi.`);
                                    parsed.tcu = null;
                                }
                                console.log(`[BDI-AI] ✅ BDI extraído via multimodal PDF — global: ${parsed.globalBdi}%, tcu: ${parsed.tcu ? 'SIM (AC=' + parsed.tcu.adminCentral + ', L=' + parsed.tcu.lucro + ', I=' + parsed.tcu.tributos + ')' : 'NÃO (apenas global)'}`);
                                return parsed;
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
        return JSON.parse(response.text);
    } catch {
        return null;
    }
}
