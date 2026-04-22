import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { callGeminiWithRetry } from '../services/ai/gemini.service';
import { robustJsonParse } from '../services/ai/parser.service';
import { ENGINEERING_PROPOSAL_SYSTEM_PROMPT, ENGINEERING_PROPOSAL_USER_INSTRUCTION } from '../services/ai/modules/prompts/engineeringPromptV1';

const router = Router();
const prisma = new PrismaClient();

// GET /api/engineering/bases
// Listar todas as tabelas oficiais e as próprias do Tenant
router.get('/bases', async (req: any, res: any) => {
    try {
        const tenantId = req.user?.tenantId; // Supondo auth middleware
        const bases = await prisma.engineeringDatabase.findMany({
            where: {
                isActive: true,
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

// GET /api/engineering/bases/:id/items
// Buscar/Paginador de itens dentro de uma base (Busca por Código ou Descrição)
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

// POST /api/engineering/ai-populate
// Extrai itens de engenharia de um texto de edital/projeto básico
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
        const rawResponse = await callGeminiWithRetry(prompt, userInput, 0.2); // Low temp for precision
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
                    item.unitCost = Number(dbItem.unitPriceDesonerado) || Number(dbItem.unitPriceNaoDesonerado) || 0;
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
