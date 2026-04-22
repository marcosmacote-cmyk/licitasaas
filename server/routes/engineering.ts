import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { callGeminiWithRetry } from '../services/ai/gemini.service';
import { robustJsonParse } from '../services/ai/parser.service';
import { ENGINEERING_PROPOSAL_SYSTEM_PROMPT, ENGINEERING_PROPOSAL_USER_INSTRUCTION } from '../services/ai/modules/prompts/engineeringPromptV1';
import { GoogleGenAI } from '@google/genai';

const router = Router();
const prisma = new PrismaClient();

// ═══════════════════════════════════════════════════════════
// GET /api/engineering/bases
// Listar todas as tabelas oficiais e as próprias do Tenant
// ═══════════════════════════════════════════════════════════
router.get('/bases', async (req: any, res: any) => {
    try {
        const tenantId = req.user?.tenantId;
        const bases = await prisma.engineeringDatabase.findMany({
            where: {
                OR: [
                    { type: 'OFICIAL' },
                    { tenantId: tenantId }
                ]
            },
            orderBy: [
                { name: 'asc' },
                { version: 'desc' }
            ]
        });
        res.json(bases);
    } catch (e) {
        console.error('Error fetching engineering bases', e);
        res.status(500).json({ error: 'Erro ao buscar tabelas de engenharia' });
    }
});

// ═══════════════════════════════════════════════════════════
// GET /api/engineering/bases/:id/items
// Buscar/Paginador de itens dentro de uma base
// ═══════════════════════════════════════════════════════════
router.get('/bases/:id/items', async (req: any, res: any) => {
    try {
        const databaseId = req.params.id;
        const query = req.query.q as string || '';
        const limit = parseInt(req.query.limit as string) || 50;
        const page = parseInt(req.query.page as string) || 1;
        const skip = (page - 1) * limit;

        const whereClause: any = { databaseId };
        
        if (query) {
            whereClause.OR = [
                { code: { contains: query, mode: 'insensitive' } },
                { description: { contains: query, mode: 'insensitive' } }
            ];
        }

        const [items, total] = await Promise.all([
            prisma.engineeringItem.findMany({
                where: whereClause,
                skip,
                take: limit,
                orderBy: { code: 'asc' }
            }),
            prisma.engineeringItem.count({ where: whereClause })
        ]);

        res.json({
            items,
            total,
            page,
            totalPages: Math.ceil(total / limit)
        });

    } catch (e) {
        console.error('Error fetching engineering items', e);
        res.status(500).json({ error: 'Erro ao buscar insumos' });
    }
});

// ═══════════════════════════════════════════════════════════
// CRUD — Engineering Proposal Items (linked to PriceProposal)
// ═══════════════════════════════════════════════════════════

// GET /api/engineering/proposals/:id/items — Carregar todos os itens
router.get('/proposals/:id/items', async (req: any, res: any) => {
    try {
        const proposalId = req.params.id;
        const items = await prisma.engineeringProposalItem.findMany({
            where: { proposalId },
            orderBy: { sortOrder: 'asc' }
        });
        res.json(items);
    } catch (e: any) {
        console.error('Error loading engineering items:', e);
        res.status(500).json({ error: 'Erro ao carregar itens de engenharia' });
    }
});

// POST /api/engineering/proposals/:id/items — Salvar/Sincronizar todos os itens
router.post('/proposals/:id/items', async (req: any, res: any) => {
    try {
        const proposalId = req.params.id;
        const { items, bdiConfig } = req.body;

        if (!Array.isArray(items)) {
            return res.status(400).json({ error: 'items deve ser um array' });
        }

        // Transaction: delete all old items + insert new ones + update BDI config
        const result = await prisma.$transaction(async (tx) => {
            // Clear existing items for this proposal
            await tx.engineeringProposalItem.deleteMany({
                where: { proposalId }
            });

            // Insert all items
            const created = await tx.engineeringProposalItem.createMany({
                data: items.map((item: any, index: number) => ({
                    proposalId,
                    itemNumber: item.itemNumber || String(index + 1),
                    code: item.code || null,
                    sourceName: item.sourceName || 'PROPRIA',
                    description: item.description || '',
                    unit: item.unit || 'UN',
                    quantity: Number(item.quantity) || 1,
                    unitCost: Number(item.unitCost) || 0,
                    unitPrice: Number(item.unitPrice) || 0,
                    totalPrice: Number(item.totalPrice) || 0,
                    sortOrder: index,
                }))
            });

            // Calculate and update proposal totals
            const totalValue = items.reduce((sum: number, it: any) =>
                sum + (Number(it.totalPrice) || 0), 0
            );

            await tx.priceProposal.update({
                where: { id: proposalId },
                data: {
                    totalValue,
                    bdiConfig: bdiConfig || undefined,
                    bdiPercentage: Number(bdiConfig?.bdiGlobal) || 0,
                }
            });

            return { count: created.count, totalValue };
        });

        // Fetch and return the saved items
        const savedItems = await prisma.engineeringProposalItem.findMany({
            where: { proposalId },
            orderBy: { sortOrder: 'asc' }
        });

        res.json({
            items: savedItems,
            totalValue: result.totalValue,
            message: `${result.count} itens salvos com sucesso`
        });

    } catch (e: any) {
        console.error('Error saving engineering items:', e);
        res.status(500).json({ error: 'Erro ao salvar itens de engenharia', details: e.message });
    }
});

// DELETE /api/engineering/proposals/:id/items/:itemId — Remover um item
router.delete('/proposals/:id/items/:itemId', async (req: any, res: any) => {
    try {
        await prisma.engineeringProposalItem.delete({
            where: { id: req.params.itemId }
        });
        res.json({ ok: true });
    } catch (e: any) {
        console.error('Error deleting engineering item:', e);
        res.status(500).json({ error: 'Erro ao remover item' });
    }
});

// ═══════════════════════════════════════════════════════════
// POST /api/engineering/ai-populate
// Extrai itens de engenharia via IA a partir do edital
// ═══════════════════════════════════════════════════════════
router.post('/ai-populate', async (req: any, res: any) => {
    try {
        const { textChunk, biddingId } = req.body;
        
        let extractionText = textChunk;

        if (biddingId) {
            // Fetch text from bidding AiAnalysis
            const bidding = await prisma.biddingProcess.findUnique({
                where: { id: biddingId },
                include: { aiAnalysis: true }
            });
            if (bidding?.aiAnalysis?.biddingItems) {
                extractionText = bidding.aiAnalysis.biddingItems;
            } else if (bidding?.aiAnalysis?.requiredDocuments) {
                extractionText = bidding.aiAnalysis.requiredDocuments;
            }
        }

        if (!extractionText) {
            return res.status(400).json({ error: 'Falta o texto do documento (biddingId sem análise ou textChunk vazio)' });
        }

        const prompt = ENGINEERING_PROPOSAL_SYSTEM_PROMPT;
        const userInput = ENGINEERING_PROPOSAL_USER_INSTRUCTION + "\n\nTEXTO DO EDITAL/PROJETO:\n" + extractionText;

        // Calling Gemini using the generalized retry service
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const result = await callGeminiWithRetry(ai.models, {
            model: 'gemini-2.5-flash',
            contents: [{
                role: 'user',
                parts: [{ text: userInput }]
            }],
            config: { 
                systemInstruction: {
                    role: 'system',
                    parts: [{ text: prompt }]
                },
                temperature: 0.2, 
                maxOutputTokens: 65536 
            }
        }); 

        const rawResponse = result?.text || '';
        const extractedData = robustJsonParse(rawResponse);
        
        // Return parsed items, falling back to empty array if something fails
        const items = extractedData?.engineeringItems || [];
        
        // Auto-lookup for prices
        for (const item of items) {
            if (item.code && item.code !== 'N/A') {
                const dbItem = await prisma.engineeringItem.findFirst({
                    where: { code: item.code }
                });
                if (dbItem) {
                    item.unitCost = Number(dbItem.price) || 0;
                }
            }
        }

        res.json({ items });

    } catch (e: any) {
        console.error('Error in AI engineering extraction:', e);
        res.status(500).json({ error: 'Falha ao extrair itens via Inteligência Artificial', details: e.message });
    }
});

export default router;
