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

    const bdiPrompt = `Você é um engenheiro orçamentista SÊNIOR analisando um edital de licitação pública.
Seu objetivo é encontrar a COMPOSIÇÃO ANALÍTICA DO BDI (Benefícios e Despesas Indiretas) exigida pelo edital.

ALVO DESTA EXTRAÇÃO: ${target}.

🚨 REGRA DE OURO: Extraia os valores EXATOS que aparecem no documento. NUNCA invente valores.
NUNCA use medianas do TCU. NUNCA use valores "típicos". Copie os NÚMEROS do edital.

PROCURE POR:
- Tabelas intituladas "COMPOSIÇÃO DO BDI", "COMPOSIÇÃO DE BDI", "BDI - SERVIÇOS", "BDI ADOTADO"
- Tabelas separadas como "BDI - FORNECIMENTO", "BDI MATERIAIS", "BDI EQUIPAMENTOS", "BDI DIFERENCIADO", "BDI 2" ou "BDI 3"
- Referências ao Acórdão TCU 2622/2013 ou TCU 2369/2011
- Quadros com a fórmula: BDI = {(1+AC+S+G+R)×(1+DF)×(1+L)/(1-I) - 1} × 100
- Em planilhas OGU do TransfereGOV, o BDI aparece no cabeçalho como "BDI 1", "BDI 2", "BDI 3"

EXTRAIA OBRIGATORIAMENTE os seguintes percentuais individuais (NÃO o BDI total):
- **adminCentral**: Administração Central (AC)
- **seguros**: Seguros (S)
- **garantias**: Garantias (G)
- **riscos**: Riscos (R)
- **despFinanceiras**: Despesas Financeiras (DF)
- **lucro**: Lucro / Remuneração (L)
- **pis**: PIS
- **cofins**: COFINS
- **iss**: ISS (Imposto Sobre Serviços)
- **csll**: CSLL. Se não mencionado, retorne 0.

⚠️ CAMPOS COMBINADOS — MUITO IMPORTANTE:
Muitos editais COMBINAM campos. Quando isso acontecer:
- "S + G" ou "Garantia/Seguros" = valor combinado → divida igualmente entre seguros e garantias.
  Ex: "S + G = 0,80%" → seguros=0.40, garantias=0.40
- "Benefício" ou "S+G+L" (Seguros+Garantias+Lucro) → separe os componentes.
  Geralmente o "Benefício TOTAL" é a soma de S+G+L. Use o Total menos L para obter S+G.
- Se não houver divisão possível e o valor for claramente S+G combinado (valor < 2%),
  divida meio a meio entre seguros e garantias.

⚠️ TRIBUTOS: Extraia INDIVIDUALMENTE (PIS, COFINS, ISS, CSLL).
Se o edital mostra apenas "Tributos (I) = X%" ou "Impostos = X%" sem detalhar:
Verifique se há uma subtabela de Impostos com os itens individuais.
Se não houver detalhamento: PIS = 0.65, COFINS = 3.00, CSLL = 0, ISS = (Total - 0.65 - 3.00).

REGRAS CRÍTICAS:
1. Se encontrar a tabela com QUALQUER nível de detalhamento, SEMPRE retorne tcu preenchido. Mesmo que tenha apenas 3-4 campos visíveis, preencha o que encontrar e os demais = 0.
2. Só retorne tcu=null se REALMENTE só houver o percentual global sem NENHUMA tabela.
3. NUNCA coloque o valor do BDI global no campo "lucro". Lucro é APENAS a margem de lucro/remuneração.
4. Se um componente é "0" ou não mencionado, coloque 0.
5. Os valores individuais são SEMPRE MUITO MENORES que o BDI total.
6. Se houver BDI diferenciado para fornecimento, preencha globalBdiFornecimento e tcuFornecimento.
7. Se o ALVO for FORNECIMENTO e não existir BDI de fornecimento, retorne found=false.

Retorne apenas os números (sem o símbolo de %).`;

    const tcuSchema = {
        type: Type.OBJECT,
        nullable: true,
        description: 'Os parâmetros INDIVIDUAIS do BDI extraídos EXATAMENTE do edital. NUNCA use valores default — copie os números do documento.',
        properties: {
            adminCentral: { type: Type.NUMBER, description: 'Administração Central (AC) — EXTRAIA o valor EXATO do edital' },
            seguros: { type: Type.NUMBER, description: 'Seguros (S) — se combinado com G, divida igualmente' },
            garantias: { type: Type.NUMBER, description: 'Garantias (G) — se combinado com S, divida igualmente' },
            riscos: { type: Type.NUMBER, description: 'Riscos (R) — EXTRAIA o valor EXATO do edital' },
            despFinanceiras: { type: Type.NUMBER, description: 'Despesas Financeiras (DF) — EXTRAIA o valor EXATO do edital' },
            lucro: { type: Type.NUMBER, description: 'Lucro/Remuneração (L) — EXTRAIA o valor EXATO do edital. NUNCA o BDI total.' },
            pis: { type: Type.NUMBER, description: 'PIS — EXTRAIA o valor EXATO do edital' },
            cofins: { type: Type.NUMBER, description: 'COFINS — EXTRAIA o valor EXATO do edital' },
            iss: { type: Type.NUMBER, description: 'ISS — EXTRAIA o valor EXATO do edital' },
            csll: { type: Type.NUMBER, description: 'CSLL — EXTRAIA o valor EXATO ou 0 se não mencionado' },
        }
    };

    const responseSchema = {
        type: Type.OBJECT,
        properties: {
            found: { type: Type.BOOLEAN, description: 'Se a tabela de BDI foi encontrada no edital.' },
            globalBdi: { type: Type.NUMBER, description: 'O valor do BDI Global calculado (em percentual).', nullable: true },
            tcu: tcuSchema,
            globalBdiFornecimento: { type: Type.NUMBER, description: 'BDI global específico para fornecimento, materiais ou equipamentos, quando o edital trouxer BDI diferenciado.', nullable: true },
            tcuFornecimento: tcuSchema,
        },
        required: ['found'] as string[]
    };

    const sanitizeBdiResult = (parsed: any) => {
        if (!parsed?.found) return parsed;
        // Fix: AI put BDI total in lucro field
        if (parsed.tcu && parsed.globalBdi && Math.abs(parsed.tcu.lucro - parsed.globalBdi) < 0.5) {
            console.warn(`[BDI-AI] ⚠️ AI colocou BDI total (${parsed.globalBdi}) no campo Lucro. Removendo tcu para usar apenas globalBdi.`);
            parsed.tcu = null;
        }
        if (parsed.tcuFornecimento && parsed.globalBdiFornecimento && Math.abs(parsed.tcuFornecimento.lucro - parsed.globalBdiFornecimento) < 0.5) {
            console.warn(`[BDI-AI] ⚠️ AI colocou BDI fornecimento total (${parsed.globalBdiFornecimento}) no campo Lucro. Removendo tcuFornecimento.`);
            parsed.tcuFornecimento = null;
        }
        // Fix: If seguros and garantias are identical and small, they might be a combined S+G value duplicated
        if (parsed.tcu && parsed.tcu.seguros === parsed.tcu.garantias && parsed.tcu.seguros > 0 && parsed.tcu.seguros <= 1.5) {
            // Check if splitting makes more mathematical sense (total S+G should be the combined value)
            console.log(`[BDI-AI] 📊 S=${parsed.tcu.seguros} G=${parsed.tcu.garantias} (iguais — pode ser S+G combinado)`);
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
                                        extraKeywords: ['BDI', 'B.D.I.', 'LDI', 'L.D.I.', 'COMPOSIÇÃO DO BDI', 'BONIFICAÇÃO', 'DESPESAS INDIRETAS', 'ACÓRDÃO TCU', 'LUCRO', 'ADMINISTRAÇÃO CENTRAL', 'TRIBUTOS'],
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
                                const sanitized = sanitizeBdiResult(parsed);
                                console.log(`[BDI-AI] ✅ BDI extraído via multimodal PDF — alvo: ${target}, global: ${sanitized.globalBdi}%, tcu: ${sanitized.tcu ? 'SIM (AC=' + sanitized.tcu.adminCentral + ', L=' + sanitized.tcu.lucro + ', I=' + sanitized.tcu.tributos + ')' : 'NÃO (apenas global)'}, fornecimento: ${sanitized.globalBdiFornecimento || 'N/A'}%`);
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
