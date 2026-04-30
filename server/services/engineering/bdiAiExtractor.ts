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

    const bdiPrompt = `Você é um engenheiro orçamentista analisando um edital de licitação pública.
Seu objetivo é encontrar a composição da taxa de BDI (Benefícios e Despesas Indiretas) exigida pelo edital.
Procure por tabelas de BDI, LDI, ou referências ao Acórdão TCU 2622/2013.

Extraia os percentuais (%) para cada um dos seguintes itens (se disponíveis):
- Administração Central
- Seguros
- Garantias
- Riscos
- Despesas Financeiras
- Lucro / Remuneração
- Tributos (PIS, COFINS, ISS, CPRB)

Se não houver tabela detalhada, mas houver o BDI Global, informe apenas o global.
Retorne apenas os números (sem o símbolo de %).`;

    const responseSchema = {
        type: Type.OBJECT,
        properties: {
            found: { type: Type.BOOLEAN, description: 'Se a tabela detalhada de BDI foi encontrada no edital.' },
            globalBdi: { type: Type.NUMBER, description: 'O valor do BDI Global (em percentual).', nullable: true },
            tcu: {
                type: Type.OBJECT,
                nullable: true,
                description: 'Os parâmetros detalhados do BDI. Só preencha se encontrar os valores específicos.',
                properties: {
                    adminCentral: { type: Type.NUMBER },
                    seguros: { type: Type.NUMBER },
                    garantias: { type: Type.NUMBER },
                    riscos: { type: Type.NUMBER },
                    despFinanceiras: { type: Type.NUMBER },
                    lucro: { type: Type.NUMBER },
                    tributos: { type: Type.NUMBER },
                }
            }
        },
        required: ['found'] as string[]
    };

    // ═══════════════════════════════════════════════════════
    // TIER 1 (PRIMÁRIO): PDFs do PNCP via multimodal
    // O BDI está nos documentos do edital (memorial descritivo,
    // planilha, edital principal), não nos campos texto do BD.
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
                    const MAX_SIZE_KB = 10000;
                    let totalSizeKB = 0;

                    for (const doc of selectedDocs.slice(0, 3)) {
                        try {
                            let fileUrl = doc.url || '';
                            if (fileUrl.includes('pncp-api/v1')) fileUrl = fileUrl.replace('pncp-api/v1', 'api/pncp/v1');
                            if (!fileUrl) continue;

                            const fileRes = await axios.get(fileUrl, {
                                responseType: 'arraybuffer', httpsAgent: agent,
                                timeout: 30000, maxRedirects: 5,
                            } as any);
                            const buffer = Buffer.from(fileRes.data as ArrayBuffer);

                            if (buffer[0] !== 0x25 || buffer[1] !== 0x50) continue; // Not PDF

                            const sizeKB = buffer.length / 1024;
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
                                temperature: 0.1,
                            }
                        });

                        if (result?.text) {
                            const parsed = JSON.parse(result.text);
                            if (parsed.found) {
                                console.log(`[BDI-AI] ✅ BDI extraído via multimodal PDF`);
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
        }
    });

    if (!response.text) return null;
    try {
        return JSON.parse(response.text);
    } catch {
        return null;
    }
}
