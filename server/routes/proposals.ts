// Type-safe extracted route module
/**
 * Auto-extracted route module from server/index.ts
 * Generated: 2026-04-13T00:46:29.485Z
 */
import express from 'express';
import { authenticateToken, requireAdmin, requireSuperAdmin } from '../middlewares/auth';
import { aiLimiter } from '../lib/security';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { handleApiError } from '../middlewares/errorHandler';

const router = express.Router();

import fs from 'fs';
import path from 'path';
import { GoogleGenAI, createPartFromUri } from '@google/genai';
import { robustJsonParse, robustJsonParseDetailed } from '../services/ai/parser.service';
import { callGeminiWithRetry } from '../services/ai/gemini.service';
import { AnalysisSchemaV1, createEmptyAnalysisSchema } from '../services/ai/analysis-schema-v1';
import { fallbackToOpenAi, fallbackToOpenAiV2 } from '../services/ai/openai.service';
import { enforceSchema } from '../services/ai/schemaEnforcer';
import { buildModuleContext, ModuleName } from '../services/ai/modules/moduleContextContracts';
import { PROPOSAL_SYSTEM_PROMPT, PROPOSAL_USER_INSTRUCTION } from '../services/ai/modules/prompts/proposalPromptV2';
import { uploadDir } from '../services/files.service';
import { ANALYZE_EDITAL_SYSTEM_PROMPT, USER_ANALYSIS_INSTRUCTION, V2_EXTRACTION_PROMPT, V2_EXTRACTION_USER_INSTRUCTION, V2_PROMPT_VERSION, getDomainRoutingInstruction, MANUAL_EXTRACTION_ADDON } from '../services/ai/prompt.service';

// Price Proposal CRUD + AI Populate
// ═══════════════════════════════════════════════════════════════════════

// GET proposals for a bidding process
router.get('/:biddingId', authenticateToken, async (req: any, res) => {
    try {
        const proposals = await prisma.priceProposal.findMany({
            where: { biddingProcessId: req.params.biddingId, tenantId: req.user.tenantId },
            include: { items: { orderBy: { sortOrder: 'asc' } }, company: true },
            orderBy: { version: 'desc' },
        });
        res.json(proposals);
    } catch (error: any) {
        logger.error('[Proposals] GET error:', error.message);
        res.status(500).json({ error: 'Failed to fetch proposals' });
    }
});

// GET single proposal with items
router.get('/detail/:id', authenticateToken, async (req: any, res) => {
    try {
        const proposal = await prisma.priceProposal.findFirst({
            where: { id: req.params.id, tenantId: req.user.tenantId },
            include: { items: { orderBy: { sortOrder: 'asc' } }, company: true, biddingProcess: true },
        });
        if (!proposal) return res.status(404).json({ error: 'Proposal not found' });
        res.json(proposal);
    } catch (error: any) {
        logger.error('[Proposals] GET detail error:', error.message);
        res.status(500).json({ error: 'Failed to fetch proposal' });
    }
});

// POST create proposal
router.post('/', authenticateToken, async (req: any, res) => {
    try {
        const { biddingProcessId, companyProfileId, bdiPercentage, taxPercentage, socialCharges, validityDays, notes } = req.body;

        // Fetch company for default images and letter
        const company = await prisma.companyProfile.findUnique({ where: { id: companyProfileId } });

        // Count existing versions
        const existingCount = await prisma.priceProposal.count({
            where: { biddingProcessId, tenantId: req.user.tenantId },
        });

        const proposal = await prisma.priceProposal.create({
            data: {
                tenantId: req.user.tenantId,
                biddingProcessId,
                companyProfileId,
                version: existingCount + 1,
                bdiPercentage: bdiPercentage || 0,
                taxPercentage: taxPercentage || 0,
                socialCharges: socialCharges || 0,
                validityDays: validityDays || 60,
                notes: notes || null,
                headerImage: company?.defaultProposalHeader || null,
                footerImage: company?.defaultProposalFooter || null,
                headerImageHeight: company?.defaultProposalHeaderHeight || 150,
                footerImageHeight: company?.defaultProposalFooterHeight || 100,
                letterContent: company?.defaultLetterContent || null
            },
            include: { items: true, company: true },
        });
        logger.info(`[Proposals] Created proposal ${proposal.id} v${proposal.version} for bidding ${biddingProcessId}`);
        res.status(201).json(proposal);
    } catch (error: any) {
        logger.error('[Proposals] POST error:', error.message);
        res.status(500).json({ error: 'Failed to create proposal' });
    }
});

// PUT update proposal
router.put('/:id', authenticateToken, async (req: any, res) => {
    try {
        const { bdiPercentage, taxPercentage, socialCharges, validityDays, notes, status, letterContent, companyLogo, headerImage, footerImage, headerImageHeight, footerImageHeight, signatureMode, signatureCity,
            adjustedBdi, adjustedDiscount, adjustedTotalValue, adjustedLetterContent } = req.body;

        const existing = await prisma.priceProposal.findFirst({
            where: { id: req.params.id, tenantId: req.user.tenantId },
        });
        if (!existing) return res.status(404).json({ error: 'Proposal not found' });

        const updated = await prisma.priceProposal.update({
            where: { id: req.params.id },
            data: {
                bdiPercentage: bdiPercentage ?? existing.bdiPercentage,
                taxPercentage: taxPercentage ?? existing.taxPercentage,
                socialCharges: socialCharges ?? existing.socialCharges,
                validityDays: validityDays ?? existing.validityDays,
                notes: notes !== undefined ? notes : existing.notes,
                status: status ?? existing.status,
                letterContent: letterContent !== undefined ? letterContent : existing.letterContent,
                companyLogo: companyLogo !== undefined ? companyLogo : existing.companyLogo,
                headerImage: headerImage !== undefined ? headerImage : existing.headerImage,
                footerImage: footerImage !== undefined ? footerImage : existing.footerImage,
                headerImageHeight: headerImageHeight ?? existing.headerImageHeight,
                footerImageHeight: footerImageHeight ?? existing.footerImageHeight,
                signatureMode: signatureMode ?? existing.signatureMode,
                signatureCity: signatureCity !== undefined ? signatureCity : existing.signatureCity,
                // Cenário Proposta Ajustada
                adjustedBdi: adjustedBdi !== undefined ? adjustedBdi : existing.adjustedBdi,
                adjustedDiscount: adjustedDiscount !== undefined ? adjustedDiscount : existing.adjustedDiscount,
                adjustedTotalValue: adjustedTotalValue !== undefined ? adjustedTotalValue : existing.adjustedTotalValue,
                adjustedLetterContent: adjustedLetterContent !== undefined ? adjustedLetterContent : existing.adjustedLetterContent,
            },
            include: { items: { orderBy: { sortOrder: 'asc' } }, company: true },
        });

        // Recalculate total
        const totalValue = updated.items.reduce((sum: number, item: any) => sum + (item.totalPrice || 0), 0);
        await prisma.priceProposal.update({ where: { id: req.params.id }, data: { totalValue } });
        updated.totalValue = totalValue;

        res.json(updated);
    } catch (error: any) {
        logger.error('[Proposals] PUT error:', error.message);
        res.status(500).json({ error: 'Failed to update proposal' });
    }
});

// DELETE proposal
router.delete('/:id', authenticateToken, async (req: any, res) => {
    try {
        const existing = await prisma.priceProposal.findFirst({
            where: { id: req.params.id, tenantId: req.user.tenantId },
        });
        if (!existing) return res.status(404).json({ error: 'Proposal not found' });

        await prisma.priceProposal.delete({ where: { id: req.params.id } });
        res.json({ success: true });
    } catch (error: any) {
        logger.error('[Proposals] DELETE error:', error.message);
        res.status(500).json({ error: 'Failed to delete proposal' });
    }
});

// POST add/replace items in bulk (used by AI populate and manual add)
router.post('/:id/items', authenticateToken, async (req: any, res) => {
    try {
        const { items, replaceAll, roundingMode: reqRoundingMode } = req.body;
        const proposalId = req.params.id;

        const existing = await prisma.priceProposal.findFirst({
            where: { id: proposalId, tenantId: req.user.tenantId },
        });
        if (!existing) return res.status(404).json({ error: 'Proposal not found' });

        // F6: Respect rounding mode — from request, or from stored flag (socialCharges=1 means TRUNCATE)
        const useRounding = reqRoundingMode || (existing.socialCharges === 1 ? 'TRUNCATE' : 'ROUND');
        const roundFn = useRounding === 'TRUNCATE'
            ? (v: number) => Math.floor(v * 100) / 100
            : (v: number) => Math.round(v * 100) / 100;

        // Optionally clear existing items
        if (replaceAll) {
            await prisma.proposalItem.deleteMany({ where: { proposalId } });
        }

        // Create items
        const created = [];
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const bdi = existing.bdiPercentage || 0;
            const linearDisc = existing.taxPercentage || 0;
            const itemDisc = item.discountPercentage ?? 0;
            // Descontos cumulativos: linear + individual (compostos)
            const linearFactor = 1 - linearDisc / 100;
            const itemFactor = 1 - itemDisc / 100;

            const rawUnitPrice = (item.unitCost || 0) * (1 + bdi / 100) * linearFactor * itemFactor;
            const unitPrice = roundFn(rawUnitPrice);

            const multiplier = item.multiplier ?? 1;
            const rawTotalPrice = (item.quantity || 0) * multiplier * unitPrice;
            const totalPrice = roundFn(rawTotalPrice);

            const dbItem = await prisma.proposalItem.create({
                data: {
                    proposalId,
                    itemNumber: item.itemNumber || String(i + 1),
                    description: item.description,
                    unit: item.unit || 'UN',
                    quantity: item.quantity || 0,
                    multiplier: multiplier,
                    multiplierLabel: item.multiplierLabel || null,
                    unitCost: item.unitCost || 0,
                    unitPrice,
                    totalPrice,
                    referencePrice: item.referencePrice || null,
                    discountPercentage: itemDisc,
                    brand: item.brand || null,
                    model: item.model || null,
                    sortOrder: item.sortOrder ?? i,
                    // Cenário Ajustada
                    adjustedUnitCost: item.adjustedUnitCost ?? null,
                    adjustedUnitPrice: item.adjustedUnitPrice ?? null,
                    adjustedTotalPrice: item.adjustedTotalPrice ?? null,
                    adjustedItemDiscount: item.adjustedItemDiscount ?? 0,
                    // Composição de Preços
                    costComposition: item.costComposition || null,
                },
            });
            created.push(dbItem);
        }

        // Recalculate totals
        const allItems = await prisma.proposalItem.findMany({ where: { proposalId } });
        const totalValue = allItems.reduce((sum: number, it: any) => sum + (it.totalPrice || 0), 0);
        const adjustedTotalValue = allItems.reduce((sum: number, it: any) => sum + (it.adjustedTotalPrice || 0), 0);
        await prisma.priceProposal.update({ where: { id: proposalId }, data: { totalValue, ...(adjustedTotalValue > 0 ? { adjustedTotalValue } : {}) } });

        logger.info(`[Proposals] Added ${created.length} items to proposal ${proposalId}, rounding: ${useRounding}, total: R$ ${totalValue.toFixed(2)}${adjustedTotalValue > 0 ? `, adjusted: R$ ${adjustedTotalValue.toFixed(2)}` : ''}`);
        res.json({ items: created, totalValue });
    } catch (error: any) {
        logger.error('[Proposals] POST items error:', error.message);
        res.status(500).json({ error: 'Failed to add items' });
    }
});

// PUT update single item
router.put('/:id/items/:itemId', authenticateToken, async (req: any, res) => {
    try {
        const { itemNumber, description, unit, quantity, multiplier, multiplierLabel, unitCost, referencePrice, brand, model, discountPercentage } = req.body;
        const proposalId = req.params.id;
        const itemId = req.params.itemId;

        const proposal = await prisma.priceProposal.findFirst({
            where: { id: proposalId, tenantId: req.user.tenantId },
        });
        if (!proposal) return res.status(404).json({ error: 'Proposal not found' });

        const bdi = proposal.bdiPercentage || 0;
        const linearDisc = proposal.taxPercentage || 0;
        const itemDisc = discountPercentage ?? 0;
        // Descontos cumulativos: linear + individual (compostos)
        const linearFactor = 1 - linearDisc / 100;
        const itemFactor = 1 - itemDisc / 100;

        const finalUnitCost = unitCost !== undefined ? unitCost : 0;
        const finalQuantity = quantity !== undefined ? quantity : 0;
        const finalMultiplier = multiplier !== undefined ? multiplier : 1;

        const unitPrice = finalUnitCost * (1 + bdi / 100) * linearFactor * itemFactor;
        const totalPrice = finalQuantity * finalMultiplier * unitPrice;

        const updated = await prisma.proposalItem.update({
            where: { id: itemId },
            data: {
                itemNumber: itemNumber,
                description: description,
                unit: unit,
                quantity: finalQuantity,
                multiplier: finalMultiplier,
                multiplierLabel: multiplierLabel !== undefined ? multiplierLabel : null,
                unitCost: finalUnitCost,
                unitPrice: Math.round(unitPrice * 100) / 100,
                totalPrice: Math.round(totalPrice * 100) / 100,
                referencePrice: referencePrice ?? null,
                discountPercentage: itemDisc,
                brand: brand ?? null,
                model: model ?? null,
            },
        });

        // Recalculate total
        const allItems = await prisma.proposalItem.findMany({ where: { proposalId } });
        const totalValue = allItems.reduce((sum: number, it: any) => sum + (it.totalPrice || 0), 0);
        await prisma.priceProposal.update({ where: { id: proposalId }, data: { totalValue } });

        res.json({ item: updated, totalValue });
    } catch (error: any) {
        logger.error('[Proposals] PUT item error:', error.message);
        res.status(500).json({ error: 'Failed to update item' });
    }
});

// DELETE single item
router.delete('/:id/items/:itemId', authenticateToken, async (req: any, res) => {
    try {
        const proposalId = req.params.id;

        const proposal = await prisma.priceProposal.findFirst({
            where: { id: proposalId, tenantId: req.user.tenantId },
        });
        if (!proposal) return res.status(404).json({ error: 'Proposal not found' });

        await prisma.proposalItem.delete({ where: { id: req.params.itemId } });

        // Recalculate total
        const allItems = await prisma.proposalItem.findMany({ where: { proposalId } });
        const totalValue = allItems.reduce((sum: number, it: any) => sum + (it.totalPrice || 0), 0);
        await prisma.priceProposal.update({ where: { id: proposalId }, data: { totalValue } });

        res.json({ success: true, totalValue });
    } catch (error: any) {
        logger.error('[Proposals] DELETE item error:', error.message);
        res.status(500).json({ error: 'Failed to delete item' });
    }
});

// POST AI Populate — extract items from AI analysis
router.post('/ai-populate', authenticateToken, async (req: any, res) => {
    try {
        const { biddingProcessId } = req.body;

        // Get bidding with AI analysis
        const bidding = await prisma.biddingProcess.findFirst({
            where: { id: biddingProcessId, tenantId: req.user.tenantId },
            include: { aiAnalysis: true },
        });

        if (!bidding) return res.status(404).json({ error: 'Bidding process not found' });
        if (!bidding.aiAnalysis) return res.status(400).json({ error: 'No AI analysis found for this bidding. Run the AI analysis first.' });

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
        const ai = new GoogleGenAI({ apiKey });

        // ── Helper: natural sort items by itemNumber (1, 2, 1.1, 1.2, 2.1, etc.) ──
        const naturalSortItems = (items: any[]) => {
            return items.sort((a, b) => {
                const partsA = String(a.itemNumber || '').split('.').map(Number);
                const partsB = String(b.itemNumber || '').split('.').map(Number);
                const maxLen = Math.max(partsA.length, partsB.length);
                for (let i = 0; i < maxLen; i++) {
                    const va = partsA[i] ?? 0;
                    const vb = partsB[i] ?? 0;
                    if (va !== vb) return va - vb;
                }
                return 0;
            });
        };

        const biddingItems = bidding.aiAnalysis.biddingItems || '';
        const pricingInfo = bidding.aiAnalysis.pricingConsiderations || '';
        const schemaV2 = bidding.aiAnalysis.schemaV2 as any;

        // ── Strategy 0: Structured items from V2 analysis (FASTEST — no AI call needed) ──
        const itensLicitados = schemaV2?.proposal_analysis?.itens_licitados;
        if (Array.isArray(itensLicitados) && itensLicitados.length > 0) {
            logger.info(`[AI Populate] ✅ Strategy 0: Using ${itensLicitados.length} pre-extracted items from schemaV2`);
            // Normalize items format
            const items = itensLicitados.map((it: any, idx: number) => ({
                itemNumber: it.itemNumber || String(idx + 1),
                description: it.description || '',
                unit: it.unit || 'UN',
                quantity: it.quantity || 1,
                multiplier: it.multiplier || 1,
                multiplierLabel: it.multiplierLabel || '',
                referencePrice: it.referencePrice || 0,
            }));
            return res.json({ items, totalItems: items.length, source: 'schemaV2_itens_licitados' });
        }

        // ── Strategy 1: Legacy biddingItems (text-based, from older analyses) ──
        // Minimum 200 chars — real bid items have descriptions, quantities, units
        // Below 200 chars is likely observacoes_proposta garbage, skip to Strategy 2/3
        const hasRealBiddingItems = biddingItems && biddingItems.trim().length >= 200;
        if (hasRealBiddingItems) {
            logger.info(`[AI Populate] Using legacy biddingItems (${biddingItems.length} chars)`);

            const prompt = `Você é um especialista em licitações brasileiras. Analise os ITENS LICITADOS abaixo e extraia uma lista estruturada para uma proposta de preços.

ITENS DO EDITAL:
${biddingItems}

INFORMAÇÕES DE PREÇO:
${pricingInfo}

REGRAS:
1. Extraia CADA item/lote individualmente
2. Identifique: número do item, descrição completa, unidade de medida (UN, KG, M², HORA, MÊS, KM, LITRO, DIÁRIA, etc.), quantidade
3. Se houver valor de referência/estimado, inclua
4. Mantenha descrições técnicas completas, não simplifique
5. Se a unidade não estiver clara, use "UN"
6. Se a quantidade não estiver clara, use 1
7. MUITO IMPORTANTE: Procure ativamente por períodos ou múltiplos que devam ser multiplicados. Por exemplo, se a licitação é para o ano todo e os pagamentos são mensais (12 meses), a quantidade é X e o MULTIPLICADOR é 12. Retorne 'multiplier': 12 e 'multiplierLabel': 'Meses'. Caso contrário, retorne 1.

ORGANIZAÇÃO DE LOTES E ITENS (itemNumber):
8. O campo itemNumber DEVE seguir padrão hierárquico organizado:
   - SEM lotes: "1", "2", "3" (numeração sequencial)
   - COM lotes, múltiplos itens: "1.1", "1.2", "2.1", "2.2" (Lote.Item)
   - COM subgrupos: "1.1.1", "1.1.2" (Grupo.Subgrupo.Item)
9. Se o edital usa "Lote 1 - Item 1", converta para "1.1"
10. Retorne os itens SEMPRE na ordem natural crescente: 1, 2, 3... ou 1.1, 1.2, 2.1...
11. NUNCA misture formatos no mesmo array

⚠️ ANTI-TRUNCAMENTO:
12. Você DEVE retornar ABSOLUTAMENTE TODOS os itens — se houver 200 itens, retorne 200. NUNCA pare antes de completar a lista inteira.
13. NÃO duplique a descrição (ex: "EXAME DE X EXAME DE X" → use apenas "EXAME DE X")
14. Para descrições curtas (ex: nome de exame), NÃO adicione texto extra — use a descrição literal do edital.

Responda APENAS com um JSON array válido:
[{"itemNumber":"1","description":"Descrição completa","unit":"Mês","quantity":3,"multiplier":12,"multiplierLabel":"Meses","referencePrice":22465.00}]`;

            const result = await callGeminiWithRetry(ai.models, {
                model: 'gemini-2.5-flash',
                contents: prompt,
                config: { temperature: 0.05, maxOutputTokens: 65536, responseMimeType: 'application/json' },
            }, 3, { tenantId: req.user.tenantId, operation: 'proposal_populate', metadata: { source: 'analysis' } });

            const responseText = result.text?.trim() || '';
            let jsonStr = responseText;
            const jsonMatch = responseText.match(/\[[\s\S]*\]/);
            if (jsonMatch) jsonStr = jsonMatch[0];

            let items: any[];
            try { items = JSON.parse(jsonStr); }
            catch { return res.status(500).json({ error: 'AI returned invalid format', raw: responseText.substring(0, 200) }); }

            // ── Truncation guard: if legacy biddingItems returned suspiciously few items, 
            // fall through to Strategy 2/3 for fuller extraction from PNCP planilhas ──
            const estimatedValue = bidding.estimatedValue || 0;
            const isSuspiciouslyFew = items.length <= 10 && estimatedValue > 100000;
            if (isSuspiciouslyFew) {
                logger.warn(`[AI Populate] ⚠️ Strategy 1 returned only ${items.length} items but estimatedValue=R$${estimatedValue.toLocaleString()} — likely truncated biddingItems. Falling through to Strategy 2/3...`);
                // Don't return — let it fall through to try PNCP planilha extraction
            } else {
                logger.info(`[AI Populate] Extracted ${items.length} items (legacy mode)`);
                return res.json({ items: naturalSortItems(items), totalItems: items.length, source: 'legacy_biddingItems' });
            }
        }

        // ── Strategy 2: Download planilhas from PNCP catalog (new analyses) ──
        const pncpSource = schemaV2?.pncp_source;
        const attachments = pncpSource?.attachments || [];
        
        // Find planilha/orçamento files in the catalog
        let planilhaFiles = attachments.filter((a: any) => 
            a.ativo && a.url && (
                a.purpose === 'planilha_orcamentaria' || 
                a.purpose === 'composicao_custos' ||
                a.purpose === 'bdi_encargos' ||
                a.purpose === 'anexo_geral'  // Include ALL annexes (downloaded or not)
            )
        );
        
        // If no planilha found, fall back to Edital + TR (pregões de serviço have items inside these)
        if (planilhaFiles.length === 0) {
            planilhaFiles = attachments.filter((a: any) =>
                a.ativo && a.url && (
                    a.purpose === 'edital' ||
                    a.purpose === 'termo_referencia'
                )
            );
            if (planilhaFiles.length > 0) {
                logger.info(`[AI Populate] No planilha found — using ${planilhaFiles.length} edital/TR as source for item extraction`);
            }
        }
        
        // Debug: log all attachment purposes to diagnose classification issues
        if (attachments.length > 0) {
            logger.info(`[AI Populate] Catalog has ${attachments.length} attachments. Purposes: ${JSON.stringify(attachments.map((a: any) => ({ t: a.titulo?.substring(0, 40), p: a.purpose, d: a.downloaded })))}`);
        }

        // ── Strategy 3: No catalog? Fetch attachments from PNCP API on the fly ──
        const pncpUrl = bidding.pncpLink || bidding.link || '';
        logger.info(`[AI Populate] Strategy check: planilhaFiles=${planilhaFiles.length}, attachments=${attachments.length}, pncpUrl=${pncpUrl}, hasBiddingItems=${!!(biddingItems && biddingItems.trim().length >= 10)}`);
        
        if (planilhaFiles.length === 0 && pncpUrl) {
            logger.info(`[AI Populate] No planilha in catalog (${attachments.length} total attachments). Fetching from PNCP: ${pncpUrl}`);
            
            // Parse URL to extract CNPJ/ano/sequencial
            // Formats: .../editais/CNPJ/ANO/SEQ or .../orgaos/CNPJ/compras/ANO/SEQ
            const pncpMatch = pncpUrl.match(/editais\/([^/]+)\/(\d{4})\/(\d+)/) || 
                              pncpUrl.match(/orgaos\/([^/]+)\/compras\/(\d{4})\/(\d+)/);
            if (pncpMatch) {
                const [, cnpj, ano, seq] = pncpMatch;
                const arquivosUrl = `https://pncp.gov.br/api/pncp/v1/orgaos/${cnpj}/compras/${ano}/${seq}/arquivos`;
                
                try {
                    const agent2 = new (require('https').Agent)({ rejectUnauthorized: false });
                    const arquivosRes = await axios.get(arquivosUrl, { httpsAgent: agent2, timeout: 10000 } as any);
                    const allArquivos = Array.isArray(arquivosRes.data) ? arquivosRes.data : [];
                    logger.info(`[AI Populate] PNCP returned ${allArquivos.length} attachments`);

                    // Classify and filter for planilha-type files
                    const classifyForProposal = (arq: any): string => {
                        const n = (arq.titulo || arq.nomeArquivo || '').toLowerCase()
                            .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                        if (n.includes('planilha') || n.includes('orcamento') || n.includes('orçamento')) return 'planilha_orcamentaria';
                        if (n.includes('composic') || n.includes('custo')) return 'composicao_custos';
                        if (n.includes('bdi') || n.includes('encargos')) return 'bdi_encargos';
                        if (n.includes('cronograma')) return 'cronograma';
                        if (n.includes('termo') && n.includes('referencia') || n.includes('termo_referencia') || n.includes('tr_')) return 'termo_referencia';
                        if (n.includes('edital') && !n.includes('anexo')) return 'edital';
                        if (n.includes('aviso') || n.includes('publicacao')) return 'aviso';
                        if (n.includes('modelo') || n.includes('minuta')) return 'modelo';
                        if (/^anexo[_\s]+(i|ii|iii|iv|v|vi|[0-9])/.test(n)) return 'anexo_geral';
                        return 'outro';
                    };

                    // First pass: look for planilha-type files
                    for (const arq of allArquivos) {
                        const purpose = classifyForProposal(arq);
                        const url = arq.url || arq.uri || '';
                        if (!url || !arq.statusAtivo) continue;
                        if (purpose === 'planilha_orcamentaria' || purpose === 'composicao_custos' || 
                            purpose === 'bdi_encargos' || purpose === 'anexo_geral') {
                            planilhaFiles.push({
                                titulo: arq.titulo || arq.nomeArquivo || 'arquivo',
                                url,
                                purpose,
                                ativo: true,
                                downloaded: false
                            });
                        }
                    }
                    
                    // Second pass: if no planilha found, use edital/TR (pregões de serviço)
                    if (planilhaFiles.length === 0) {
                        for (const arq of allArquivos) {
                            const purpose = classifyForProposal(arq);
                            const url = arq.url || arq.uri || '';
                            if (!url || !arq.statusAtivo) continue;
                            if (purpose === 'edital' || purpose === 'termo_referencia' ||
                                [1, 2, 4].includes(arq.tipoDocumentoId)) {
                                planilhaFiles.push({
                                    titulo: arq.titulo || arq.nomeArquivo || 'arquivo',
                                    url,
                                    purpose,
                                    ativo: true,
                                    downloaded: false
                                });
                            }
                        }
                        if (planilhaFiles.length > 0) {
                            logger.info(`[AI Populate] No planilha in PNCP fetch — using ${planilhaFiles.length} edital/TR instead`);
                        }
                    }
                    logger.info(`[AI Populate] After PNCP fetch: ${planilhaFiles.length} candidates found`);
                } catch (fetchErr: any) {
                    logger.warn(`[AI Populate] Failed to fetch PNCP attachments: ${fetchErr.message}`);
                }
            }
        }

        if (planilhaFiles.length === 0) {
            return res.status(400).json({ 
                error: 'Nenhuma planilha orçamentária encontrada. Este processo não possui itens de orçamento no edital nem planilhas anexas no PNCP.',
                hint: 'Para obras de engenharia, as planilhas geralmente estão nos Anexos do edital. Para pregões de serviço, tente re-analisar o processo.',
                attachments_found: attachments.length,
                has_pncpLink: !!bidding.pncpLink,
                attachments_purposes: [...new Set(attachments.map((a: any) => a.purpose))]
            });
        }

        logger.info(`[AI Populate] Found ${planilhaFiles.length} planilha candidates in PNCP catalog`);

        // Download planilha PDFs on demand
        const pdfParts: any[] = [];
        const downloadedNames: string[] = [];
        const agent = new (require('https').Agent)({ rejectUnauthorized: false });

        for (const pf of planilhaFiles.slice(0, 5)) { // Max 5 files
            try {
                logger.info(`[AI Populate] Downloading: "${pf.titulo}" (${pf.purpose}) from ${pf.url}`);
                const fileRes = await axios.get(pf.url, {
                    httpsAgent: agent,
                    timeout: 60000,
                    responseType: 'arraybuffer',
                    maxRedirects: 5
                } as any);

                const buffer = Buffer.from(fileRes.data as ArrayBuffer);
                if (buffer.length === 0) continue;

                // Check if PDF
                const isPdf = buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;
                if (isPdf) {
                    pdfParts.push({
                        inlineData: { data: buffer.toString('base64'), mimeType: 'application/pdf' }
                    });
                    downloadedNames.push(pf.titulo);
                    logger.info(`[AI Populate] ✅ PDF: ${pf.titulo} (${(buffer.length / 1024).toFixed(0)} KB)`);
                } else {
                    logger.info(`[AI Populate] ⚠️ Not a PDF: ${pf.titulo} — skipping`);
                }
            } catch (err: any) {
                logger.warn(`[AI Populate] ⚠️ Failed to download ${pf.titulo}: ${err.message}`);
            }
        }

        if (pdfParts.length === 0) {
            return res.status(400).json({ 
                error: 'Não foi possível baixar nenhuma planilha do PNCP. Tente novamente ou adicione a planilha manualmente.',
                attempted: planilhaFiles.map((p: any) => p.titulo)
            });
        }

        // Extract items from planilha PDFs using Gemini multimodal
        const extractPrompt = `Você é um especialista em licitações brasileiras de obras e serviços de engenharia.
Analise a(s) planilha(s) orçamentária(s) abaixo e extraia TODOS os itens/serviços com seus dados.

REGRAS:
1. Extraia CADA serviço/item individualmente — NÃO agrupe
2. Para cada item identifique: número, descrição técnica COMPLETA, unidade de medida, quantidade, preço unitário de referência
3. Mantenha a hierarquia: Grupo/Subgrupo (se houver) como prefixo na descrição
4. NÃO inclua subtotais, totais gerais, BDI ou encargos como itens — apenas serviços
5. Se a quantidade ou unidade não estiver clara, use quantidade=1 e unidade="UN"
6. Para valores monetários, use ponto como separador decimal (ex: 1234.56)
7. Multiplier = 1 para itens de obra (não há recorrência mensal)

ORGANIZAÇÃO DE LOTES E ITENS (itemNumber):
8. O campo itemNumber DEVE seguir padrão hierárquico organizado:
   - SEM lotes: "1", "2", "3" (numeração sequencial)
   - COM lotes, múltiplos itens: "1.1", "1.2", "2.1", "2.2" (Lote.Item)
   - COM subgrupos: "1.1.1", "1.1.2" (Grupo.Subgrupo.Item)
9. Se a planilha usa numeração como "1.1", "1.2", "2.1", PRESERVE tal numeração
10. Se a planilha usa "Lote 1 - Item 1" ou "Grupo A / Item 1", converta para "1.1", "1.2"
11. Retorne os itens SEMPRE na ordem natural crescente
12. NUNCA misture formatos no mesmo array

${pricingInfo ? `INFORMAÇÕES ADICIONAIS DE PREÇO:\n${pricingInfo}\n` : ''}

Responda APENAS com um JSON array válido:
[{"itemNumber":"1.1","description":"Descrição completa do serviço incluindo grupo","unit":"M²","quantity":100,"multiplier":1,"multiplierLabel":"","referencePrice":45.67}]`;

        logger.info(`[AI Populate] Sending ${pdfParts.length} PDFs to Gemini for item extraction...`);
        const result = await callGeminiWithRetry(ai.models, {
            model: 'gemini-2.5-flash',
            contents: [{
                role: 'user',
                parts: [
                    ...pdfParts,
                    { text: extractPrompt }
                ]
            }],
            config: { 
                temperature: 0.05, 
                maxOutputTokens: 65536,
                responseMimeType: 'application/json'
            }
        }, 3, { tenantId: req.user.tenantId, operation: 'proposal_populate', metadata: { source: 'pdf_extraction' } });

        const responseText = result.text?.trim() || '';
        logger.info(`[AI Populate] Response length: ${responseText.length} chars (first 300): ${responseText.substring(0, 300)}`);

        let items: any[];
        try {
            const parsed = JSON.parse(responseText);
            items = Array.isArray(parsed) ? parsed : (parsed.items || parsed.data || []);
        } catch {
            // Try regex extract
            const jsonMatch = responseText.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                try { items = JSON.parse(jsonMatch[0]); }
                catch { return res.status(500).json({ error: 'AI returned invalid JSON from planilha', raw: responseText.substring(0, 300) }); }
            } else {
                return res.status(500).json({ error: 'AI returned no extractable data from planilha' });
            }
        }

        logger.info(`[AI Populate] ✅ Extracted ${items.length} items from ${downloadedNames.length} planilha(s): ${downloadedNames.join(', ')}`);
        res.json({ 
            items: naturalSortItems(items), 
            totalItems: items.length, 
            source: 'pncp_planilha',
            planilhas: downloadedNames
        });
    } catch (error: any) {
        logger.error('[AI Populate] Error:', error.message);
        res.status(500).json({ error: 'AI populate failed: ' + (error.message || 'Unknown') });
    }
});

// ═══════════════════════════════════════════════════════════════════════
// AI Cost Composition — Specialist in unit price composition
// Generates detailed cost breakdowns for exequibilidade proof
// ═══════════════════════════════════════════════════════════════════════
router.post('/ai-composition', authenticateToken, async (req: any, res) => {
    try {
        const { biddingProcessId, items } = req.body;

        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'items array is required (with id, description, unit, quantity, unitPrice)' });
        }

        // Get bidding context
        const bidding = await prisma.biddingProcess.findFirst({
            where: { id: biddingProcessId, tenantId: req.user.tenantId },
            include: { aiAnalysis: true },
        });

        if (!bidding) return res.status(404).json({ error: 'Bidding process not found' });

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
        const ai = new GoogleGenAI({ apiKey });

        const schemaV2 = bidding.aiAnalysis?.schemaV2 as any;
        const pricingInfo = bidding.aiAnalysis?.pricingConsiderations || '';
        const processId = schemaV2?.process_identification || {};
        const modalidade = bidding.modality || processId?.modalidade || '';
        const objeto = processId?.objeto_completo || processId?.objeto || bidding.summary || '';

        const t0 = Date.now();
        logger.info(`[AI Composition] Generating compositions for ${items.length} item(s), bidding: ${biddingProcessId}`);

        // Build items context
        const itemsContext = items.map((it: any, idx: number) => 
            `Item ${it.itemNumber || idx + 1}: "${it.description}" | Unid: ${it.unit} | Qtd: ${it.quantity} | Preço Unit.: R$ ${(it.unitPrice || 0).toFixed(2)}`
        ).join('\n');

        const prompt = `Você é um engenheiro de custos especialista em composição de preços unitários para licitações públicas brasileiras (Lei 14.133/2021, Acórdãos do TCU sobre BDI).

═══ SEU PAPEL ═══
Gerar composições de preços unitários REALISTAS e DETALHADAS para cada item abaixo, comprovando a viabilidade (exequibilidade) do preço ofertado.

═══ CONTEXTO DA LICITAÇÃO ═══
Objeto: ${objeto.substring(0, 1500)}
Modalidade: ${modalidade}
${pricingInfo ? `Informações de preço do edital:\n${pricingInfo.substring(0, 1500)}` : ''}

═══ ITENS PARA COMPOR ═══
${itemsContext}

═══ REGRAS CRÍTICAS ═══
1. Para CADA item, gere uma composição detalhada com elementos de custo REAIS e COERENTES
2. O TOTAL da composição deve ser PRÓXIMO ao preço unitário informado (tolerância de ±5%)
3. Use os seguintes grupos de custo (campo "group"):
   - MATERIAL: matéria-prima, insumos, peças
   - MAO_DE_OBRA: salários, encargos, benefícios
     REGRA OBRIGATÓRIA para MAO_DE_OBRA: a "description" DEVE ser o NOME DO PROFISSIONAL/CARGO que executa o trabalho, NUNCA o nome do processo.
     Exemplos CORRETOS: "Costureiro (Incl. Encargos)", "Auxiliar de Corte (Incl. Encargos)", "Cortador (Incl. Encargos)", "Operador de Máquina (Incl. Encargos)", "Eletricista (Incl. Encargos)", "Pedreiro (Incl. Encargos)", "Servente (Incl. Encargos)"
     Exemplos ERRADOS (NÃO USAR): "Corte de tecido", "Costura e acabamento", "Revisão e embalagem", "Manutenção elétrica"
     SEMPRE adicione "(Incl. Encargos)" ao final da description de MAO_DE_OBRA.
   - EQUIPAMENTO: máquinas, ferramentas (depreciação/aluguel)
   - FRETE: frete, transporte, logística
   - TERCEIROS: serviços subcontratados
   - ADMIN_CENTRAL: administração central (% sobre custo direto, tipicamente 3-6%)
   - CUSTOS_FINANCEIROS: custo financeiro (% sobre custo direto, tipicamente 0.5-2%)
   - SEGUROS: seguros e garantias (% sobre custo direto, tipicamente 0.3-1%)
   - RISCOS: riscos e imprevistos (tipicamente 0.5-1.5%)
   - DESPESAS_OPERACIONAIS: despesas operacionais gerais
   - TRIBUTOS: impostos (PIS 0.65%, COFINS 3%, ISSQN/ICMS conforme tipo)
   - LUCRO: margem de lucro (tipicamente 5-10%)

4. Cada linha da composição deve ter:
   - group: um dos grupos acima
   - description: descrição específica do insumo/custo
   - unit: unidade de medida (UN, KG, M, M², HORA, DIA, MÊS, VB, %, etc.)
   - quantity: quantidade ou coeficiente
   - unitValue: valor unitário do insumo
   
5. Os custos indiretos (ADMIN_CENTRAL, CUSTOS_FINANCEIROS, SEGUROS, RISCOS) geralmente são percentuais sobre o custo direto total
6. TRIBUTOS são calculados sobre o preço de venda
7. LUCRO é percentual sobre o custo direto

═══ FORMATO DE RESPOSTA ═══
Retorne APENAS um JSON array, onde cada elemento corresponde a um item:
[
  {
    "itemId": "id_do_item",
    "templateUsed": "AI_GENERATED",
    "lines": [
      { "group": "MATERIAL", "description": "Tecido algodão 100%", "unit": "M", "quantity": 2.5, "unitValue": 8.50 },
      { "group": "MAO_DE_OBRA", "description": "Costureiro (Incl. Encargos)", "unit": "HORA", "quantity": 1.5, "unitValue": 12.00 },
      { "group": "TRIBUTOS", "description": "PIS (0,65%)", "unit": "VB", "quantity": 1, "unitValue": 0.35 },
      { "group": "LUCRO", "description": "Margem de lucro", "unit": "VB", "quantity": 1, "unitValue": 4.20 }
    ]
  }
]

IMPORTANTE:
- Seja REALISTA nos valores — use preços de mercado brasileiro
- Inclua TODOS os elementos relevantes, sem omissões
- A soma de (quantity × unitValue) de TODAS as linhas DEVE SER IGUAL ao preço unitário do item
- Use o LUCRO como variável de equilíbrio: ajuste a margem de lucro para que o total BATA EXATAMENTE com o preço unitário
- Exemplo: se custos diretos + indiretos + tributos = R$ 35,00 e preço unitário = R$ 41,98, o lucro deve ser EXATAMENTE R$ 6,98
- NÃO retorne texto, markdown ou explicações — APENAS o JSON`;

        const result = await callGeminiWithRetry(ai.models, {
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: { 
                temperature: 0.2, 
                maxOutputTokens: 65536,
                responseMimeType: 'application/json'
            },
        }, 3, { tenantId: req.user.tenantId, operation: 'proposal_composition' });

        const responseText = result.text?.trim() || '';
        const duration = Date.now() - t0;
        logger.info(`[AI Composition] Response: ${responseText.length} chars in ${duration}ms`);

        let compositions: any[];
        try {
            const parsed = JSON.parse(responseText);
            compositions = Array.isArray(parsed) ? parsed : (parsed.compositions || parsed.data || [parsed]);
        } catch {
            const jsonMatch = responseText.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                try { compositions = JSON.parse(jsonMatch[0]); }
                catch { return res.status(500).json({ error: 'AI returned invalid JSON', raw: responseText.substring(0, 300) }); }
            } else {
                return res.status(500).json({ error: 'AI returned no extractable data' });
            }
        }

        // Add IDs to lines, calculate totalValue, and FINE-TUNE to match unit price exactly
        for (let idx = 0; idx < compositions.length && idx < items.length; idx++) {
            const comp = compositions[idx];
            const targetPrice = items[idx].unitPrice || 0;
            if (!comp.lines) comp.lines = [];

            // Step 1: Add IDs and calculate line totals
            for (const line of comp.lines) {
                line.id = `cl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
                line.totalValue = Math.round((line.quantity || 0) * (line.unitValue || 0) * 100) / 100;
                line.source = line.source || 'IA';
            }

            // Step 2: Calculate current grand total
            const currentTotal = comp.lines.reduce((s: number, l: any) => s + (l.totalValue || 0), 0);
            const diff = Math.round((targetPrice - currentTotal) * 100) / 100;

            // Step 3: If there's a difference, adjust LUCRO line to compensate
            if (Math.abs(diff) >= 0.01 && targetPrice > 0) {
                // Find existing LUCRO line
                let lucroLine = comp.lines.find((l: any) => l.group === 'LUCRO');

                if (lucroLine) {
                    // Adjust the LUCRO line value
                    lucroLine.unitValue = Math.round((lucroLine.unitValue + diff / (lucroLine.quantity || 1)) * 100) / 100;
                    lucroLine.totalValue = Math.round((lucroLine.quantity || 1) * lucroLine.unitValue * 100) / 100;
                    
                    // If LUCRO became negative, distribute via DESPESAS_OPERACIONAIS instead
                    if (lucroLine.unitValue < 0) {
                        // Revert LUCRO
                        lucroLine.unitValue = Math.round((lucroLine.unitValue - diff / (lucroLine.quantity || 1)) * 100) / 100;
                        lucroLine.totalValue = Math.round((lucroLine.quantity || 1) * lucroLine.unitValue * 100) / 100;
                        
                        // Add/adjust DESPESAS_OPERACIONAIS
                        let despLine = comp.lines.find((l: any) => l.group === 'DESPESAS_OPERACIONAIS');
                        if (despLine) {
                            despLine.unitValue = Math.round((despLine.unitValue + diff / (despLine.quantity || 1)) * 100) / 100;
                            despLine.totalValue = Math.round((despLine.quantity || 1) * despLine.unitValue * 100) / 100;
                        } else {
                            comp.lines.push({
                                id: `cl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                                group: 'DESPESAS_OPERACIONAIS',
                                description: 'Ajuste operacional',
                                unit: 'VB',
                                quantity: 1,
                                unitValue: diff,
                                totalValue: diff,
                                source: 'Ajuste',
                            });
                        }
                    }
                } else {
                    // Create LUCRO line with the difference
                    comp.lines.push({
                        id: `cl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                        group: 'LUCRO',
                        description: 'Margem de lucro',
                        unit: 'VB',
                        quantity: 1,
                        unitValue: diff,
                        totalValue: diff,
                        source: 'IA',
                    });
                }

                // Final verification — recalculate and micro-adjust if needed (rounding quirks)
                const finalTotal = comp.lines.reduce((s: number, l: any) => s + (l.totalValue || 0), 0);
                const microDiff = Math.round((targetPrice - finalTotal) * 100) / 100;
                if (Math.abs(microDiff) >= 0.01) {
                    const adjustLine = comp.lines.find((l: any) => l.group === 'LUCRO') || comp.lines[comp.lines.length - 1];
                    adjustLine.unitValue = Math.round((adjustLine.unitValue + microDiff / (adjustLine.quantity || 1)) * 100) / 100;
                    adjustLine.totalValue = Math.round((adjustLine.quantity || 1) * adjustLine.unitValue * 100) / 100;
                }

                const adjustedTotal = comp.lines.reduce((s: number, l: any) => s + (l.totalValue || 0), 0);
                logger.info(`[AI Composition] Item ${idx + 1}: ajustado ${currentTotal.toFixed(2)} → ${adjustedTotal.toFixed(2)} (alvo: ${targetPrice.toFixed(2)}, diff original: ${diff.toFixed(2)})`);
            }
        }

        logger.info(`[AI Composition] ✅ Generated ${compositions.length} compositions with ${compositions.reduce((s: number, c: any) => s + (c.lines?.length || 0), 0)} total lines in ${duration}ms`);
        res.json({ 
            compositions, 
            totalItems: compositions.length,
            durationMs: duration,
        });
    } catch (error: any) {
        logger.error('[AI Composition] Error:', error.message);
        res.status(500).json({ error: 'AI composition failed: ' + (error.message || 'Unknown') });
    }
});

// POST AI Letter — DEPRECATED, replaced by /api/proposals/ai-letter-blocks (Fase 2)
// Kept as stub returning 410 Gone for any remaining clients
router.post('/ai-letter', authenticateToken, async (req: any, res) => {
    logger.warn('[AI Letter] DEPRECATED endpoint called. Use /api/proposals/ai-letter-blocks instead.');
    res.status(410).json({
        error: 'Este endpoint foi descontinuado. Use /api/proposals/ai-letter-blocks para geração controlada por blocos.',
        migration: 'POST /api/proposals/ai-letter-blocks',
    });
});
// ═══════════════════════════════════════════════════════════════════════
// AI Letter Blocks — Controlled AI generation for specific letter parts
// Generates ONLY variable text blocks within a predefined structure.
// The AI does NOT decide layout, structure, or mandatory sections.
// ═══════════════════════════════════════════════════════════════════════
router.post('/ai-letter-blocks', authenticateToken, async (req: any, res) => {
    try {
        const { biddingProcessId, requestedBlocks } = req.body;

        if (!biddingProcessId) {
            return res.status(400).json({ error: 'biddingProcessId is required' });
        }
        if (!requestedBlocks || !Array.isArray(requestedBlocks) || requestedBlocks.length === 0) {
            return res.status(400).json({ error: 'requestedBlocks array is required (objectBlock, executionBlock, commercialExtras)' });
        }

        const validBlocks = ['objectBlock', 'executionBlock', 'commercialExtras'];
        const invalid = requestedBlocks.filter((b: string) => !validBlocks.includes(b));
        if (invalid.length > 0) {
            return res.status(400).json({ error: `Invalid blocks: ${invalid.join(', ')}. Valid: ${validBlocks.join(', ')}` });
        }

        const bidding = await prisma.biddingProcess.findFirst({
            where: { id: biddingProcessId, tenantId: req.user.tenantId },
            include: { aiAnalysis: true }
        });

        if (!bidding) return res.status(404).json({ error: 'Bidding process not found' });

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });

        const ai = new GoogleGenAI({ apiKey });
        const schemaV2 = bidding.aiAnalysis?.schemaV2 as any;
        const fullSummary = bidding.aiAnalysis?.fullSummary || '';
        const pricingInfo = bidding.aiAnalysis?.pricingConsiderations || '';
        const processId = schemaV2?.process_identification || {};
        const contractCond = schemaV2?.contract_conditions || {};

        const t0 = Date.now();
        logger.info(`[AI Letter Blocks] Generating ${requestedBlocks.length} block(s) for bidding ${biddingProcessId}`);

        // ── Build prompts for each requested block ──
        const blockPromises: Promise<{ blockId: string; content: string; durationMs: number }>[] = [];

        for (const blockId of requestedBlocks) {
            if (blockId === 'objectBlock') {
                const objContext = processId?.objeto_completo || processId?.objeto || bidding.summary || '';
                blockPromises.push((async () => {
                    const tStart = Date.now();
                    const prompt = `Você é um redator especialista em licitações públicas brasileiras.

TAREFA: Extraia e transcreva NA ÍNTEGRA o OBJETO da licitação abaixo.
NÃO resuma. Transcreva EXATAMENTE como consta no edital.
Se houver itens, lotes ou grupos, mencione-os.
Se o objeto for extenso, inclua-o completo.

DADOS DO EDITAL:
Título: ${bidding.title}
${objContext ? `Objeto identificado: ${objContext.substring(0, 2000)}` : ''}
Resumo do Edital:
${fullSummary.substring(0, 4000)}

REGRAS:
- Retorne APENAS o texto do objeto, sem aspas, sem markdown, sem títulos.
- NÃO adicione interpretações, apenas transcreva.
- Se não encontrar o objeto claramente, retorne o trecho mais relevante que descreva o escopo da contratação.`;

                    const result = await callGeminiWithRetry(ai.models, {
                        model: 'gemini-2.5-flash',
                        contents: prompt,
                        config: { temperature: 0.1, maxOutputTokens: 2048 },
                    }, 3, { tenantId: req.user.tenantId, operation: 'proposal_letter', metadata: { block: 'object' } });
                    return { blockId: 'objectBlock', content: result.text?.trim() || '', durationMs: Date.now() - tStart };
                })());
            }

            if (blockId === 'executionBlock') {
                // Provide FULL contract conditions as context, not just 1 field
                const execContext = contractCond?.local_execucao || contractCond?.prazo_execucao || '';
                const contractCondJson = JSON.stringify(contractCond || {}, null, 0).substring(0, 3000);
                blockPromises.push((async () => {
                    const tStart = Date.now();
                    const prompt = `Você é um analista especialista em editais de licitação pública brasileira.

TAREFA: Extraia do edital abaixo APENAS os seguintes dados (se existirem):
1. LOCAL COMPLETO de execução/entrega dos serviços ou bens (endereço completo, cidade, UF)
2. PRAZO de execução, entrega ou conclusão (em dias, meses ou conforme consta)
3. VIGÊNCIA do contrato (se mencionado)

DADOS DO EDITAL:
Título: ${bidding.title}
${execContext ? `Dados já identificados: ${execContext}` : ''}
Condições contratuais (JSON):
${contractCondJson}
Resumo do Edital:
${fullSummary.substring(0, 4000)}

REGRAS CRÍTICAS:
- Responda em frases COMPLETAS e objetivas, sem markdown.
- NUNCA trunque o texto no meio de uma palavra ou frase.
- Cada informação deve terminar com ponto final.
- Inclua APENAS os dados que existirem no edital.
- Se nenhum dado for encontrado, retorne exatamente: ""
- NÃO invente informações.
- Formato obrigatório: "Local de execução: [endereço completo]. Prazo de execução: [prazo]. Vigência contratual: [vigência]."`;

                    const result = await callGeminiWithRetry(ai.models, {
                        model: 'gemini-2.5-flash',
                        contents: prompt,
                        config: { temperature: 0.1, maxOutputTokens: 1024 },
                    }, 3, { tenantId: req.user.tenantId, operation: 'proposal_letter', metadata: { block: 'execution' } });
                    const content = result.text?.trim() || '';
                    return { blockId: 'executionBlock', content, durationMs: Date.now() - tStart };
                })());
            }

            if (blockId === 'commercialExtras') {
                const contractCondJson = JSON.stringify(contractCond || {}, null, 0).substring(0, 3000);
                blockPromises.push((async () => {
                    const tStart = Date.now();
                    const prompt = `Você é um analista especialista em licitações públicas brasileiras (Lei 14.133/2021).

TAREFA: Analise as condições financeiras e comerciais ESPECÍFICAS deste edital e extraia APENAS:
- Condições de pagamento específicas (prazo, forma, documentos exigidos para liquidação)
- Exigência de garantia contratual (tipo e percentual)
- Critério de reajuste de preços
- Condições sobre composição de BDI
- Exigências específicas sobre a proposta (formato, prazo, documentos adicionais)

DADOS FINANCEIROS DO EDITAL:
${pricingInfo ? `Considerações sobre preços: ${pricingInfo.substring(0, 3000)}` : 'Não disponível'}
Condições contratuais (JSON):
${contractCondJson}

Resumo do Edital:
${fullSummary.substring(0, 4000)}

REGRAS CRÍTICAS:
- NÃO inclua declarações genéricas sobre tributos, custos ou encargos (já estão na carta padrão).
- Retorne APENAS condições ESPECÍFICAS deste edital, em frases declarativas formais.
- Cada frase/cláusula DEVE terminar com ponto final.
- NUNCA trunque o texto no meio de uma palavra ou frase — complete a sentença.
- Se não houver condições específicas além das padrão, retorne exatamente: ""
- NÃO invente informações.
- Sem markdown, sem títulos, sem numeração.`;

                    const result = await callGeminiWithRetry(ai.models, {
                        model: 'gemini-2.5-flash',
                        contents: prompt,
                        config: { temperature: 0.1, maxOutputTokens: 2048 },
                    }, 3, { tenantId: req.user.tenantId, operation: 'proposal_letter', metadata: { block: 'commercial_extras' } });
                    const content = result.text?.trim() || '';
                    return { blockId: 'commercialExtras', content, durationMs: Date.now() - tStart };
                })());
            }
        }

        // ── Execute all blocks in parallel ──
        const results = await Promise.allSettled(blockPromises);
        const blocks: Record<string, string> = {};
        const timings: Record<string, number> = {};
        const errors: string[] = [];

        for (const result of results) {
            if (result.status === 'fulfilled') {
                blocks[result.value.blockId] = result.value.content;
                timings[result.value.blockId] = result.value.durationMs;
            } else {
                errors.push(result.reason?.message || 'Unknown AI error');
            }
        }

        const totalMs = Date.now() - t0;
        logger.info(`[AI Letter Blocks] Completed in ${totalMs}ms — blocks: ${Object.keys(blocks).join(', ')} | timings: ${JSON.stringify(timings)}`);

        if (errors.length > 0) {
            logger.warn(`[AI Letter Blocks] ${errors.length} block(s) failed:`, errors);
        }

        res.json({
            blocks,
            timings,
            errors: errors.length > 0 ? errors : undefined,
            totalMs,
        });

    } catch (error: any) {
        logger.error('[AI Letter Blocks] Error:', error.message);
        res.status(500).json({ error: 'AI block generation failed: ' + (error.message || 'Unknown') });
    }
});
// ═══════════════════════════════════════════════════════════════════════
router.post('/dossier/ai-match', authenticateToken, async (req: any, res) => {
    try {
        const { requirements, documents } = req.body;

        if (!requirements || !Array.isArray(requirements) || requirements.length === 0) {
            return res.status(400).json({ error: 'requirements array is required' });
        }
        if (!documents || !Array.isArray(documents) || documents.length === 0) {
            return res.status(400).json({ error: 'documents array is required' });
        }

        logger.info(`[Dossier AI Match] ${requirements.length} requirements × ${documents.length} docs for tenant ${req.user.tenantId}`);

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
        }

        const ai = new GoogleGenAI({ apiKey });

        // Build compact document list
        const docListStr = documents.map((d: any, i: number) =>
            `  DOC[${i}]: Tipo="${d.docType}" | Arquivo="${d.fileName}" | Grupo="${d.docGroup || 'N/A'}" | Vencimento="${d.expirationDate || 'Sem vencimento'}"`
        ).join('\n');

        // Build compact requirements list
        const reqListStr = requirements.map((r: string, i: number) =>
            `  REQ[${i}]: "${r}"`
        ).join('\n');

        const prompt = `# TAREFA
Você é um especialista sênior em licitações públicas brasileiras com 20 anos de experiência em habilitação documental. Sua tarefa é vincular DOCUMENTOS de uma empresa às EXIGÊNCIAS DE HABILITAÇÃO de um edital.

# PRINCÍPIOS FUNDAMENTAIS
1. **MAXIMIZE as vinculações corretas.** Se existe um documento que pode atender uma exigência, VINCULE-O. Não deixe exigências simples sem vínculo.
2. **Um mesmo documento PODE atender múltiplas exigências** quando faz sentido (ex: Contrato Social atende tanto "ato constitutivo" quanto "comprovação do ramo de atividade").
3. **NÃO vincule quando claramente não há documento compatível** na lista.
4. **RIGOR NAS ESFERAS**: Jamais substitua uma exigência Federal por um documento Estadual ou Municipal (e vice-versa). O match deve ser na mesma esfera.
5. **PJ vs PF**: Documentos de identificação pessoal (RG, CPF, CNH) atendem APENAS exigências de sócios/representantes. NUNCA os use para Habilitação Jurídica da empresa (Contrato Social, CNPJ).
6. **HIERARQUIA**: Priorize 'docType' (Tipo do Documento) sobre o 'fileName' (Nome do Arquivo). Use o nome do arquivo apenas para desempate ou se o Tipo for genérico.
7. **Priorize documentos NÃO vencidos** sobre vencidos. Se só há documento vencido, ainda assim vincule.

# TABELA DE EQUIVALÊNCIAS E EXCLUSÕES
Use esta tabela como referência rigorosa:

| Exigência do Edital | Documentos Aceitos (pelo docType ou nome) | PROIBIDO VINCULAR |
|---|---|---|
| Contrato Social / Ato constitutivo | Contrato Social, Estatuto, Ato Constitutivo, Requerimento Empresário | RG, CPF, CNH, Comprovante de Endereço |
| Inscrição no CNPJ | Cartão CNPJ, Comprovante de Inscrição CNPJ | Inscrição Estadual, Inscrição Municipal |
| Inscrição Estadual (CAD. ICMS) | Inscrição Estadual, Certidão de Dados Cadastrais Estadual | Inscrição Municipal, CNPJ |
| Inscrição Municipal (ISS) | Inscrição Municipal, Alvará de Funcionamento, Cadastro ISS | Inscrição Estadual, CNPJ |
| Regularidade Federal (Tributos e Dívida) | CND Federal, Certidão Conjunta União, Certidão Federal | CND Estadual, CND Municipal |
| Regularidade Estadual | CND Estadual, Certidões da Fazenda Estadual, SEFAZ | CND Federal, CND Municipal, CNPJ |
| Regularidade Municipal | CND Municipal, Certidão Fazenda Municipal | CND Estadual, CND Federal |
| Regularidade FGTS | CRF, Certidão FGTS | CND Trabalhista (CNDT), CND Federal |
| Regularidade Trabalhista (CNDT) | CNDT, Certidão Negativa Débitos Trabalhistas | CRF, CND Federal |
| Falência e Recuperação Judicial | Certidão de Falência, Certidão de Distribuição Cível | Certidão de Débitos, CND |
| Atestados de Capacidade Técnica | Atestado Técnico, Atestado de Capacidade, CAT, Acervo | Balanço, Contrato Social |
| Registro no Conselho (CREA/CAU/etc) | Registro Profissional, Registro no Conselho, CREA, CAU | Registro na Junta Comercial |

# REGRAS DE DECISÃO
- Analise o SIGNIFICADO da exigência, não apenas palavras-chave.
- Se a exigência menciona "no caso de" uma situação específica (estrangeira, MEI, etc), vincule null se não houver doc correspondente.
- Se houver dúvida entre dois documentos, escolha o que tem o 'docType' mais próximo da exigência.
- Check de Exclusão: Antes de vincular, verifique: "Este documento é da esfera (Federal/Estadual/Municipal) correta?".

# DADOS

DOCUMENTOS DA EMPRESA (${documents.length} documentos):
${docListStr}

EXIGÊNCIAS DO EDITAL (${requirements.length} exigências):
${reqListStr}

# FORMATO DE RESPOSTA
Responda APENAS com um JSON array. Para CADA exigência REQ[i], inclua um objeto:
{"r":0,"d":2,"m":"motivo curto"} — quando há match (r=reqIndex, d=docIndex, m=motivo)
{"r":1,"d":null,"m":"sem documento compatível"} — quando não há match

IMPORTANTE: Inclua uma entrada para CADA exigência (R0 a R${requirements.length - 1}).

Responda somente com o JSON array, sem markdown, sem texto adicional:`;

        const result = await callGeminiWithRetry(ai.models, {
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: {
                temperature: 0.05,
                maxOutputTokens: 8192,
            }
        }, 3, { tenantId: req.user.tenantId, operation: 'dossier_match' });

        const responseText = result.text?.trim() || '';
        logger.info(`[Dossier AI Match] Raw response (first 500 chars): ${responseText.substring(0, 500)}`);

        // Parse JSON from response (handle markdown code blocks)
        let jsonStr = responseText;
        const jsonMatch = responseText.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
            jsonStr = jsonMatch[0];
        }

        let matchResults: any[];
        try {
            matchResults = JSON.parse(jsonStr);
        } catch (parseErr) {
            logger.error('[Dossier AI Match] Failed to parse JSON:', responseText.substring(0, 500));
            return res.status(500).json({ error: 'AI returned invalid JSON', raw: responseText.substring(0, 200) });
        }

        // Convert to { requirementText -> [docId] } map
        const matches: Record<string, string[]> = {};

        for (const m of matchResults) {
            // Support both {"reqIndex":0} and {"r":0} formats
            const reqIdx = typeof m.r === 'number' ? m.r
                : typeof m.reqIndex === 'number' ? m.reqIndex
                    : parseInt(String(m.r ?? m.reqIndex ?? '').replace('R', ''));

            if (isNaN(reqIdx) || reqIdx < 0 || reqIdx >= requirements.length) continue;

            const reqText = requirements[reqIdx];

            const docIdxRaw = m.d ?? m.docIndex;
            if (docIdxRaw === null || docIdxRaw === undefined || docIdxRaw === 'SKIP' || docIdxRaw === -1) {
                continue;
            }

            const docIdx = typeof docIdxRaw === 'number' ? docIdxRaw : parseInt(docIdxRaw);
            if (isNaN(docIdx) || docIdx < 0 || docIdx >= documents.length) continue;

            matches[reqText] = [documents[docIdx].id];
            const reason = m.m || m.reason || '';
            logger.info(`[Dossier AI Match] ✅ R${reqIdx} → DOC[${docIdx}] "${documents[docIdx].docType}" | ${reason}`);
        }

        const matchCount = Object.keys(matches).length;
        const skipped = matchResults.filter((m: any) => {
            const d = m.d ?? m.docIndex;
            return d === null || d === undefined || d === 'SKIP' || d === -1;
        }).length;
        logger.info(`[Dossier AI Match] Result: ${matchCount} matched, ${skipped} skipped, ${requirements.length - matchCount - skipped} unhandled`);

        res.json({ matches, matchCount, totalRequirements: requirements.length });

    } catch (error: any) {
        logger.error('[Dossier AI Match] Error:', error?.message || error);
        res.status(500).json({ error: 'AI matching failed: ' + (error?.message || 'Unknown error') });
    }
});
// AI Services imports movidos para cima
export default router;
