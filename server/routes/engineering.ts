import { Router } from 'express';
import { logger } from '../lib/logger';
import { PrismaClient } from '@prisma/client';
import { callGeminiWithRetry } from '../services/ai/gemini.service';
import { robustJsonParse } from '../services/ai/parser.service';
import { ENGINEERING_PROPOSAL_SYSTEM_PROMPT, ENGINEERING_PROPOSAL_USER_INSTRUCTION } from '../services/ai/modules/prompts/engineeringPromptV1';
import { GoogleGenAI } from '@google/genai';
import { downloadAndParseSeinfra, getSeinfraRegimeMeta, type SeinfraRegime } from '../services/engineering/seinfra-scraper';
import { CompositionFlattener } from '../services/engineering/compositionFlattener';
import axios from 'axios';
import https from 'https';
import { submitJob } from '../services/backgroundJobService';
import { classifyEngineeringAttachments } from '../services/engineering/documentClassifier';
import { parseAndNormalizeEngineeringExtraction } from '../services/engineering/resultNormalizer';

const router = Router();
const prisma = new PrismaClient();

function refreshSubmittedPriceAudit(item: any) {
    const audit = item?.priceAudit;
    const matchedUnitCost = Number(audit?.matchedUnitCost) || 0;
    if (!audit || matchedUnitCost <= 0) return audit || undefined;

    const extractedUnitCost = Number(item.unitCost) || 0;
    const hasRegimeMismatch = Array.isArray(audit.warnings) && audit.warnings.some((warning: string) => String(warning).toLowerCase().includes('regime'));
    const deltaValue = hasRegimeMismatch ? null : extractedUnitCost - matchedUnitCost;
    const deltaPercent = deltaValue !== null && matchedUnitCost > 0 ? (deltaValue / matchedUnitCost) * 100 : null;
    const hasPriceDelta = !hasRegimeMismatch && deltaValue !== null && Math.abs(deltaValue) > 0.01;
    const hasBaseWarnings = Array.isArray(audit.warnings) && audit.warnings.length > 0;

    return {
        ...audit,
        extractedUnitCost,
        deltaValue,
        deltaPercent,
        status: hasPriceDelta ? 'DIVERGENT' : hasBaseWarnings ? 'BASE_INCOMPATIVEL' : 'OK',
    };
}

/**
 * Baixa os PDFs do edital diretamente do PNCP e prepara para envio inline ao Gemini.
 * Prioriza: Projeto Básico > Planilha Orçamentária > Edital > outros anexos
 */
async function downloadPncpPdfsForEngineering(biddingId: string): Promise<any[]> {
    const bidding = await prisma.biddingProcess.findUnique({ where: { id: biddingId } });
    if (!bidding?.pncpLink) {
        console.log(`[PNCP-PDF] ⚠️ Sem pncpLink para processo ${biddingId}`);
        return [];
    }

    // Parse CNPJ, ano, sequencial from pncpLink
    // Format: https://pncp.gov.br/app/editais/CNPJ/ANO/SEQ or /api/pncp/v1/orgaos/CNPJ/compras/ANO/SEQ
    const linkMatch = bidding.pncpLink.match(/(\d{14})\/(\d{4})\/(\d+)/);
    if (!linkMatch) {
        console.log(`[PNCP-PDF] ⚠️ Não foi possível extrair CNPJ/ano/seq de: ${bidding.pncpLink}`);
        return [];
    }

    const [, cnpj, ano, seq] = linkMatch;
    const agent = new https.Agent({ rejectUnauthorized: false });
    const arquivosUrl = `https://pncp.gov.br/api/pncp/v1/orgaos/${cnpj}/compras/${ano}/${seq}/arquivos`;

    console.log(`[PNCP-PDF] 📥 Buscando anexos: ${arquivosUrl}`);

    let arquivos: any[] = [];
    try {
        const res = await axios.get(arquivosUrl, { httpsAgent: agent, timeout: 20000 } as any);
        arquivos = Array.isArray(res.data) ? res.data : [];
    } catch (e: any) {
        console.warn(`[PNCP-PDF] ⚠️ Falha ao listar anexos: ${e.message}`);
        return [];
    }

    if (arquivos.length === 0) return [];

    const classifiedDocs = classifyEngineeringAttachments(arquivos, { maxDocuments: 6 });
    const selectedDocs = classifiedDocs.selected.length > 0
        ? classifiedDocs.selected
        : classifiedDocs.all.filter(doc => doc.score > -20).slice(0, 6);

    console.log(
        `[PNCP-PDF] 📎 Classificador selecionou ${selectedDocs.length}/${classifiedDocs.summary.total} anexo(s): ` +
        selectedDocs.map(doc => `"${doc.title}" (${doc.score})`).join(', ')
    );

    // Download top PDFs in parallel (PERF-02 fix: was sequential, now ~4x faster)
    const MAX_PDFS = 4;
    const MAX_SIZE_KB = 12000;
    const candidates = selectedDocs.slice(0, MAX_PDFS + 2);

    const downloadResults = await Promise.allSettled(candidates.map(async ({ url, title }) => {
        let fileUrl = url || '';
        if (fileUrl.includes('pncp-api/v1')) fileUrl = fileUrl.replace('pncp-api/v1', 'api/pncp/v1');
        if (!fileUrl) return null;

        const fileRes = await axios.get(fileUrl, {
            responseType: 'arraybuffer', httpsAgent: agent, timeout: 30000,
            maxRedirects: 5,
        } as any);
        const buffer = Buffer.from(fileRes.data as ArrayBuffer);

        // Verify it's a PDF (magic bytes %P)
        if (buffer[0] !== 0x25 || buffer[1] !== 0x50) {
            console.log(`[PNCP-PDF] ⏭️ "${title}" não é PDF, ignorando`);
            return null;
        }

        const sizeKB = buffer.length / 1024;
        console.log(`[PNCP-PDF] ✅ "${title}" (${Math.round(sizeKB)}KB) baixado`);
        return { name: title, sizeKB, part: { inlineData: { data: buffer.toString('base64'), mimeType: 'application/pdf' } } };
    }));

    // Collect successful downloads respecting size budget
    let totalSizeKB = 0;
    const pdfParts: any[] = [];
    for (const result of downloadResults) {
        if (pdfParts.length >= MAX_PDFS) break;
        if (result.status !== 'fulfilled' || !result.value) {
            if (result.status === 'rejected') console.warn(`[PNCP-PDF] ⚠️ Download falhou: ${(result as any).reason?.message}`);
            continue;
        }
        const { sizeKB, part } = result.value;
        if (totalSizeKB + sizeKB > MAX_SIZE_KB) {
            console.log(`[PNCP-PDF] ⏭️ Budget de ${MAX_SIZE_KB}KB atingido, parando`);
            break;
        }
        totalSizeKB += sizeKB;
        pdfParts.push(part);
    }

    console.log(`[PNCP-PDF] 📦 ${pdfParts.length} PDFs prontos (${Math.round(totalSizeKB)}KB total)`);
    return pdfParts;
}

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
        const compWhereClause: any = { databaseId };
        
        if (query) {
            whereClause.OR = [
                { code: { contains: query, mode: 'insensitive' } },
                { description: { contains: query, mode: 'insensitive' } }
            ];
            compWhereClause.OR = [
                { code: { contains: query, mode: 'insensitive' } },
                { description: { contains: query, mode: 'insensitive' } }
            ];
        }

        const [items, compositions, itemTotal, compositionTotal] = await Promise.all([
            prisma.engineeringItem.findMany({
                where: whereClause,
                take: skip + limit,
                orderBy: { code: 'asc' }
            }),
            prisma.engineeringComposition.findMany({
                where: compWhereClause,
                take: skip + limit,
                orderBy: { code: 'asc' }
            }),
            prisma.engineeringItem.count({ where: whereClause }),
            prisma.engineeringComposition.count({ where: compWhereClause })
        ]);

        const combined = [
            ...items.map((item: any) => ({ ...item, recordKind: 'INSUMO', price: item.price })),
            ...compositions.map((composition: any) => ({
                ...composition,
                recordKind: 'COMPOSICAO',
                price: composition.totalPrice,
                type: 'SERVICO',
            })),
        ].sort((a: any, b: any) => String(a.code).localeCompare(String(b.code)));

        const total = itemTotal + compositionTotal;

        res.json({
            items: combined.slice(skip, skip + limit),
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
// GET /api/engineering/compositions/:code
// Busca composição por código com drill-down completo de insumos
// ═══════════════════════════════════════════════════════════
router.get('/compositions/:code', async (req: any, res: any) => {
    try {
        const code = req.params.code;
        const databaseId = req.query.databaseId as string || undefined;

        const where: any = { code };
        if (databaseId) where.databaseId = databaseId;

        // Try to find in PROPRIA first, then fallback to others
        let composition = null;
        if (!databaseId) {
            composition = await prisma.engineeringComposition.findFirst({
                where: { code, database: { name: 'PROPRIA' } },
                include: { items: { include: { item: true }, orderBy: { createdAt: 'asc' } }, database: { select: { name: true, uf: true } } }
            });
        }

        if (!composition) {
            composition = await prisma.engineeringComposition.findFirst({
                where,
                include: { items: { include: { item: true }, orderBy: { createdAt: 'asc' } }, database: { select: { name: true, uf: true } } }
            });
        }

        if (!composition) {
            return res.status(404).json({ error: 'Composição não encontrada', code });
        }

        if (
            composition.items.length === 0 &&
            String(composition.database?.name || '').toUpperCase() === 'ORSE'
        ) {
            try {
                const hydrated = await hydrateOrseCompositionDetails(composition.id);
                if (hydrated.hydrated) {
                    composition = await prisma.engineeringComposition.findUnique({
                        where: { id: composition.id },
                        include: { items: { include: { item: true }, orderBy: { createdAt: 'asc' } }, database: { select: { name: true, uf: true } } }
                    });
                }
            } catch (e: any) {
                console.warn(`[ORSE Detail] Could not hydrate ${code}: ${e.message}`);
            }
        }

        // Enrich with auxiliary compositions if any
        const enrichedItems = await Promise.all((composition?.items || []).map(async (ci: any) => {
            if (ci.auxiliaryCompositionId) {
                const aux = await prisma.engineeringComposition.findUnique({
                    where: { id: ci.auxiliaryCompositionId },
                    include: { items: { include: { item: true } } }
                });
                return { ...ci, auxiliaryComposition: aux };
            }
            return ci;
        }));

        // Group by type for nice display
        const groups: Record<string, any[]> = { MATERIAL: [], MAO_DE_OBRA: [], EQUIPAMENTO: [], AUXILIAR: [] };
        for (const ci of enrichedItems) {
            if (ci.auxiliaryComposition) {
                groups.AUXILIAR.push(ci);
            } else if (ci.item) {
                const type = ci.item.type || 'MATERIAL';
                if (!groups[type]) groups[type] = [];
                groups[type].push(ci);
            }
        }

        res.json({
            ...composition,
            items: enrichedItems,
            groups,
            totalDirect: enrichedItems.reduce((s: number, ci: any) => s + (ci.price || 0), 0),
        });

    } catch (e: any) {
        console.error('Error fetching composition:', e);
        res.status(500).json({ error: 'Erro ao buscar composição' });
    }
});

// GET /api/engineering/compositions — Listar composições por database
router.get('/compositions', async (req: any, res: any) => {
    try {
        const databaseId = req.query.databaseId as string;
        const q = req.query.q as string || '';
        const limit = parseInt(req.query.limit as string) || 50;

        const where: any = {};
        if (databaseId) where.databaseId = databaseId;
        if (q) {
            where.OR = [
                { code: { contains: q, mode: 'insensitive' } },
                { description: { contains: q, mode: 'insensitive' } }
            ];
        }

        const compositions = await prisma.engineeringComposition.findMany({
            where,
            take: limit,
            orderBy: { code: 'asc' },
            include: { _count: { select: { items: true } } }
        });

        res.json(compositions);
    } catch (e: any) {
        console.error('Error listing compositions:', e);
        res.status(500).json({ error: 'Erro ao listar composições' });
    }
});

// ═══════════════════════════════════════════════════════════
// GET /api/engineering/hub/search — Busca unificada no Hub
// Pesquisa composições + insumos across all databases
// ═══════════════════════════════════════════════════════════
router.get('/hub/search', async (req: any, res: any) => {
    try {
        const q = (req.query.q as string || '').trim();
        const limit = Math.min(parseInt(req.query.limit as string) || 30, 100);
        if (q.length < 2) return res.json({ compositions: [], items: [] });

        const qFilter = [
            { code: { contains: q, mode: 'insensitive' as const } },
            { description: { contains: q, mode: 'insensitive' as const } }
        ];

        const [compositions, items] = await Promise.all([
            prisma.engineeringComposition.findMany({
                where: { OR: qFilter },
                take: limit,
                orderBy: { code: 'asc' },
                include: {
                    database: { select: { id: true, name: true, uf: true, referenceMonth: true, referenceYear: true, payrollExemption: true } },
                    _count: { select: { items: true } }
                }
            }),
            prisma.engineeringItem.findMany({
                where: { OR: qFilter },
                take: limit,
                orderBy: { code: 'asc' },
                include: {
                    database: { select: { id: true, name: true, uf: true, referenceMonth: true, referenceYear: true, payrollExemption: true } }
                }
            })
        ]);

        res.json({ compositions, items });
    } catch (e: any) {
        console.error('[Hub Search] Error:', e);
        res.status(500).json({ error: 'Erro na busca' });
    }
});

// ═══════════════════════════════════════════════════════════
// POST /api/engineering/compositions — Criar Composição (PRÓPRIA)
// ═══════════════════════════════════════════════════════════
router.post('/compositions', async (req: any, res: any) => {
    try {
        const { code, description, unit } = req.body;
        // SEC-02 FIX: Always use authenticated tenantId from middleware
        const tenantId = req.user?.tenantId || req.body.tenantId;
        
        if (!code || !description) {
            return res.status(400).json({ error: 'Código e descrição são obrigatórios' });
        }

        let propriaDb = await prisma.engineeringDatabase.findFirst({
            where: { name: 'PROPRIA', tenantId }
        });

        if (!propriaDb) {
            propriaDb = await prisma.engineeringDatabase.create({
                data: { name: 'PROPRIA', uf: '', tenantId, type: 'PROPRIA' }
            });
        }

        const existing = await prisma.engineeringComposition.findFirst({
            where: { code, databaseId: propriaDb.id }
        });

        if (existing) {
            return res.status(400).json({ error: 'Já existe uma composição com este código na base própria' });
        }

        const comp = await prisma.engineeringComposition.create({
            data: {
                code,
                description,
                unit: unit || 'UN',
                databaseId: propriaDb.id,
                totalPrice: 0
            }
        });

        res.json({ message: 'Composição criada com sucesso', composition: comp });
    } catch (e: any) {
        console.error('Error creating composition:', e);
        res.status(500).json({ error: 'Erro ao criar composição própria' });
    }
});

// ═══════════════════════════════════════════════════════════
// PUT /api/engineering/compositions/:id — Atualizar Composição (Write-Back PRÓPRIA)
// ═══════════════════════════════════════════════════════════
router.put('/compositions/:id', async (req: any, res: any) => {
    try {
        const id = req.params.id;
        const { composition } = req.body;

        if (!composition || !composition.groups) {
            return res.status(400).json({ error: 'Dados da composição inválidos' });
        }

        // Verify if it exists and belongs to a PROPRIA db
        const existing = await prisma.engineeringComposition.findUnique({
            where: { id },
            include: { database: true }
        });

        if (!existing) {
            return res.status(404).json({ error: 'Composição não encontrada' });
        }

        if (existing.database.type !== 'PROPRIA' && existing.database.name !== 'PROPRIA') {
            return res.status(403).json({ error: 'Apenas composições próprias podem ser alteradas' });
        }

        // SEC-02: Verify tenant ownership
        if (existing.database.tenantId && req.user?.tenantId && existing.database.tenantId !== req.user.tenantId) {
            return res.status(403).json({ error: 'Composição pertence a outro tenant' });
        }

        // Flatten all items from groups to update
        const flatItems: any[] = [];
        for (const group of Object.values(composition.groups)) {
            if (Array.isArray(group)) {
                flatItems.push(...group);
            }
        }

        // Start a transaction to delete old items and recreate
        await prisma.$transaction(async (tx: any) => {
            // Update total price and description
            await tx.engineeringComposition.update({
                where: { id },
                data: {
                    totalPrice: composition.totalPrice,
                    description: composition.description,
                    unit: composition.unit,
                }
            });

            // Delete existing items
            await tx.engineeringCompositionItem.deleteMany({
                where: { compositionId: id }
            });

            // Create new items — SEC-02: use authenticated tenantId
            const tenantId = req.user?.tenantId || composition.tenantId;
            const basePropria = await tx.engineeringDatabase.findFirst({ where: { name: 'PROPRIA', tenantId } });

            for (const item of flatItems) {
                let isAux = !!item.auxiliaryCompositionId || (item.auxiliaryComposition && item.auxiliaryComposition.id);
                let itemId = item.item ? item.item.id : item.itemId;
                let auxId = item.auxiliaryComposition ? item.auxiliaryComposition.id : item.auxiliaryCompositionId;
                
                // Dynamically create AI-extracted proprietary inputs
                if (!isAux && itemId && itemId.startsWith('new-')) {
                    const newItem = await tx.engineeringItem.create({
                        data: {
                            databaseId: basePropria?.id || null,
                            code: item.item.code || `AI-${Date.now()}`,
                            description: item.item.description || 'Novo Insumo Próprio (IA)',
                            unit: item.item.unit || 'UN',
                            type: item.item.type || 'MATERIAL',
                            price: item.item.price || 0,
                            tenantId: tenantId
                        }
                    });
                    itemId = newItem.id;
                }

                // Dynamically create AI-extracted auxiliary compositions
                if (isAux && auxId && auxId.startsWith('new-')) {
                    const newAux = await tx.engineeringComposition.create({
                        data: {
                            databaseId: basePropria?.id || null,
                            code: item.auxiliaryComposition.code || `AI-COMP-${Date.now()}`,
                            description: item.auxiliaryComposition.description || 'Nova Composição Auxiliar Própria (IA)',
                            unit: item.auxiliaryComposition.unit || 'UN',
                            totalPrice: item.auxiliaryComposition.totalPrice || 0,
                            tenantId: tenantId
                        }
                    });
                    auxId = newAux.id;
                }
                
                await tx.engineeringCompositionItem.create({
                    data: {
                        compositionId: id,
                        itemId: isAux ? null : itemId,
                        auxiliaryCompositionId: isAux ? auxId : null,
                        coefficient: item.coefficient,
                        price: item.price,
                    }
                });
            }
        });

        res.json({ message: 'Composição atualizada com sucesso', id });

    } catch (e: any) {
        console.error('Error updating custom composition:', e);
        res.status(500).json({ error: 'Erro ao atualizar composição própria', details: e.message });
    }
});

// ═══════════════════════════════════════════════════════════
// GET /api/engineering/proposals/:id/insumos-hub
// Consolida TODOS os insumos de todas as composições do orçamento
// Para o Hub de Insumos (Fase 1 — Proposta de Obras)
// ═══════════════════════════════════════════════════════════
router.get('/proposals/:id/insumos-hub', async (req: any, res: any) => {
    try {
        const proposalId = req.params.id;

        // 1. Load all engineering items for this proposal
        const proposalItems = await prisma.engineeringProposalItem.findMany({
            where: { proposalId },
            orderBy: { sortOrder: 'asc' },
        });

        if (proposalItems.length === 0) {
            return res.json({ insumos: [], stats: { totalInsumos: 0, totalCusto: 0 } });
        }

        // 2. For each item with a code, find its composition and drill down to insumos
        const rawInsumos: any[] = [];

        for (const item of proposalItems) {
            if (!item.code || item.code === 'N/A') continue;

            const composition = await prisma.engineeringComposition.findFirst({
                where: { code: { equals: item.code, mode: 'insensitive' } },
                include: {
                    items: { include: { item: true } },
                    database: { select: { name: true, uf: true } },
                },
            });

            if (!composition) continue;

            for (const ci of composition.items) {
                if (ci.item) {
                    rawInsumos.push({
                        insumoCode: ci.item.code,
                        insumoDescription: ci.item.description,
                        insumoUnit: ci.item.unit,
                        insumoPrice: ci.item.price,
                        insumoType: ci.item.type,
                        coefficient: ci.coefficient,
                        compositionCode: composition.code,
                        compositionDescription: composition.description,
                        base: composition.database?.name || item.sourceName || 'PROPRIA',
                        serviceQuantity: item.quantity,
                    });
                }
            }
        }

        // 3. Fallback: if no compositions found, treat proposal items AS insumos directly
        //    This ensures the Hub always shows something useful
        if (rawInsumos.length === 0) {
            for (const item of proposalItems) {
                const desc = item.description || 'Item sem descrição';
                const cat = normalizeInsumoType(desc);
                rawInsumos.push({
                    insumoCode: item.code || item.itemNumber || `ITEM-${item.sortOrder + 1}`,
                    insumoDescription: desc,
                    insumoUnit: item.unit || 'UN',
                    insumoPrice: item.unitCost || 0,
                    insumoType: cat,
                    coefficient: 1,
                    compositionCode: 'PROPOSTA',
                    compositionDescription: 'Itens da proposta (sem composição detalhada)',
                    base: item.sourceName || 'PROPRIA',
                    serviceQuantity: item.quantity || 1,
                });
            }
            console.log(`[Insumo Hub] ⚠️ Nenhuma composição encontrada, usando ${rawInsumos.length} itens da proposta como insumos diretos`);
        }

        // 4. Consolidate: group by insumo code, sum weighted coefficients
        const consolidated = new Map<string, any>();

        for (const raw of rawInsumos) {
            const key = raw.insumoCode.toUpperCase();
            const weightedCoef = raw.coefficient * raw.serviceQuantity;
            const existing = consolidated.get(key);

            if (existing) {
                existing.coeficienteTotal += weightedCoef;
                if (!existing.composicoesVinculadas.includes(raw.compositionCode)) {
                    existing.composicoesVinculadas.push(raw.compositionCode);
                }
            } else {
                consolidated.set(key, {
                    id: key,
                    codigo: raw.insumoCode,
                    descricao: raw.insumoDescription,
                    categoria: normalizeInsumoType(raw.insumoType),
                    unidade: raw.insumoUnit,
                    precoOriginal: raw.insumoPrice,
                    desconto: 0,
                    precoFinal: raw.insumoPrice,
                    base: raw.base,
                    composicoesVinculadas: [raw.compositionCode],
                    coeficienteTotal: weightedCoef,
                    custoTotal: Math.round(raw.insumoPrice * weightedCoef * 100) / 100,
                });
            }
        }

        // Recalculate custoTotal and sort
        const insumos = Array.from(consolidated.values()).map(ins => ({
            ...ins,
            custoTotal: Math.round(ins.precoFinal * ins.coeficienteTotal * 100) / 100,
        }));
        insumos.sort((a: any, b: any) => b.custoTotal - a.custoTotal);

        // ABC classification
        const totalCusto = insumos.reduce((s: number, i: any) => s + i.custoTotal, 0);
        if (totalCusto > 0) {
            let accum = 0;
            for (const ins of insumos) {
                accum += ins.custoTotal;
                const pct = (accum / totalCusto) * 100;
                ins.abcClass = pct <= 80 ? 'A' : pct <= 95 ? 'B' : 'C';
            }
        }

        // Stats
        const compositionCodes = new Set(rawInsumos.map((r: any) => r.compositionCode));
        const hasRealCompositions = !compositionCodes.has('PROPOSTA');
        const stats = {
            totalInsumos: insumos.length,
            totalCusto: Math.round(totalCusto * 100) / 100,
            custoMaterial: Math.round(insumos.filter((i: any) => i.categoria === 'MATERIAL').reduce((s: number, i: any) => s + i.custoTotal, 0) * 100) / 100,
            custoMaoDeObra: Math.round(insumos.filter((i: any) => i.categoria === 'MAO_DE_OBRA').reduce((s: number, i: any) => s + i.custoTotal, 0) * 100) / 100,
            custoEquipamento: Math.round(insumos.filter((i: any) => i.categoria === 'EQUIPAMENTO').reduce((s: number, i: any) => s + i.custoTotal, 0) * 100) / 100,
            custoServico: Math.round(insumos.filter((i: any) => i.categoria === 'SERVICO').reduce((s: number, i: any) => s + i.custoTotal, 0) * 100) / 100,
            composicoesEncontradas: hasRealCompositions ? compositionCodes.size : 0,
            itensSemComposicao: hasRealCompositions
                ? proposalItems.filter(i => i.code && i.code !== 'N/A').length - compositionCodes.size
                : proposalItems.length,
            mode: hasRealCompositions ? 'compositions' : 'proposal_items',
        };

        console.log(`[Insumo Hub] 📊 ${stats.totalInsumos} insumos (mode=${stats.mode}) — R$ ${stats.totalCusto.toLocaleString()}`);

        res.json({ insumos, stats, rawCount: rawInsumos.length });

    } catch (e: any) {
        console.error('[Insumo Hub] Error:', e);
        res.status(500).json({ error: 'Erro ao consolidar insumos', details: e.message });
    }
});

function normalizeInsumoType(type: string): string {
    const upper = (type || '').toUpperCase();
    if (upper.includes('MAO') || upper.includes('MÃO')) return 'MAO_DE_OBRA';
    if (upper.includes('EQUIP')) return 'EQUIPAMENTO';
    if (upper.includes('MATERIAL')) return 'MATERIAL';
    return 'SERVICO';
}

// ═══════════════════════════════════════════════════════════
// GET /api/engineering/proposals/:id/analytical-report
// Gera o relatório analítico no Padrão TCU (Composições Principais + Auxiliares)
// ═══════════════════════════════════════════════════════════
router.post('/proposals/:id/analytical-report', async (req: any, res: any) => {
    try {
        const proposalId = req.params.id;
        const { items, bdi } = req.body || {};
        
        // Obter configuração de BDI ou Encargos
        const bdiValue = typeof bdi === 'number' ? (bdi > 1 ? bdi / 100 : bdi) : 0.25;
        // FIX ARQ-05: Leis Sociais dinâmico — usa valor do config ao invés de hardcoded
        const engineeringConfig = req.body.engineeringConfig || {};
        const lsHorista = (engineeringConfig?.encargosSociais?.horista || 84.64) / 100;
        const flattener = new CompositionFlattener(bdiValue, lsHorista);
        
        const report = await flattener.flattenProposal(proposalId, items);
        
        console.log(`[Analytical Report] 📊 ${report.principalCompositions.length} principais, ${report.auxiliaryCompositions.length} auxiliares`);
        res.json(report);
        
    } catch (e: any) {
        console.error('[Analytical Report] Error:', e);
        res.status(500).json({ error: 'Erro ao gerar relatório analítico', details: e.message });
    }
});

// ═══════════════════════════════════════════════════════════
// POST /api/engineering/insumos-hub-resolve
// Recebe códigos de serviços do client-side e retorna insumos
// individuais (materiais, mão de obra, equipamentos) consolidados.
// Insumos duplicados em múltiplas composições ficam com preço ÚNICO.
// ═══════════════════════════════════════════════════════════
router.post('/insumos-hub-resolve', async (req: any, res: any) => {
    try {
        const { items } = req.body; // [{ code, quantity, sourceName }]

        if (!Array.isArray(items) || items.length === 0) {
            return res.json({ insumos: [], stats: { totalInsumos: 0, totalCusto: 0 }, mode: 'empty' });
        }

        // Map: insumoCode → consolidated data
        const consolidated = new Map<string, {
            id: string; codigo: string; descricao: string; categoria: string;
            unidade: string; precoOriginal: number; base: string;
            composicoesVinculadas: string[];
            coeficientesPorComposicao: { compCode: string; coef: number; qty: number }[];
            coeficienteTotal: number;
        }>();

        let compositionsFound = 0;
        let itemsWithoutComposition = 0;

        for (const clientItem of items) {
            const code = (clientItem.code || '').trim();
            if (!code || code === 'N/A') { itemsWithoutComposition++; continue; }

            // Search composition by code across all databases
            const composition = await prisma.engineeringComposition.findFirst({
                where: { code: { equals: code, mode: 'insensitive' } },
                include: {
                    items: {
                        include: {
                            item: true,
                            // FIX-04: Include auxiliary compositions with their items for recursive resolution
                        },
                    },
                    database: { select: { name: true, uf: true } },
                },
            });

            if (!composition) {
                itemsWithoutComposition++;
                continue;
            }

            compositionsFound++;
            const serviceQty = Number(clientItem.quantity) || 1;
            const baseName = composition.database?.name || clientItem.sourceName || 'PROPRIA';

            // FIX-04: Helper to add an insumo to the consolidated map
            const addInsumo = (insumoCode: string, insumo: any, coef: number, parentCompCode: string) => {
                const insumoKey = insumoCode.toUpperCase();
                const existing = consolidated.get(insumoKey);
                const weightedCoef = coef * serviceQty;

                if (existing) {
                    existing.coeficienteTotal += weightedCoef;
                    existing.coeficientesPorComposicao.push({
                        compCode: parentCompCode,
                        coef,
                        qty: serviceQty,
                    });
                    if (!existing.composicoesVinculadas.includes(parentCompCode)) {
                        existing.composicoesVinculadas.push(parentCompCode);
                    }
                    if (Math.abs(existing.precoOriginal - insumo.price) > 0.01) {
                        console.warn(`[Insumo Hub] ⚠️ Preço divergente para ${insumo.code}: R$${existing.precoOriginal} vs R$${insumo.price} — usando preço da primeira ocorrência`);
                    }
                } else {
                    consolidated.set(insumoKey, {
                        id: insumoKey,
                        codigo: insumo.code,
                        descricao: insumo.description,
                        categoria: normalizeInsumoType(insumo.type),
                        unidade: insumo.unit,
                        precoOriginal: insumo.price,
                        base: baseName,
                        composicoesVinculadas: [parentCompCode],
                        coeficientesPorComposicao: [{
                            compCode: parentCompCode,
                            coef,
                            qty: serviceQty,
                        }],
                        coeficienteTotal: weightedCoef,
                    });
                }
            };

            // Drill into each insumo of the composition
            for (const ci of composition.items) {
                if (ci.item) {
                    // Direct insumo (material, MO, equipment)
                    addInsumo(ci.item.code, ci.item, ci.coefficient, composition.code);
                } else if (ci.auxiliaryCompositionId) {
                    // FIX-04: Resolve auxiliary composition recursively
                    const visitedAux = new Set<string>();
                    const resolveAuxiliary = async (auxId: string, parentCoef: number, parentCompCode: string) => {
                        if (visitedAux.has(auxId)) return; // Prevent infinite loops
                        visitedAux.add(auxId);

                        const auxComp = await prisma.engineeringComposition.findUnique({
                            where: { id: auxId },
                            include: { items: { include: { item: true } } },
                        });
                        if (!auxComp) return;

                        for (const auxCi of auxComp.items) {
                            if (auxCi.item) {
                                addInsumo(auxCi.item.code, auxCi.item, auxCi.coefficient * parentCoef, parentCompCode);
                            } else if (auxCi.auxiliaryCompositionId) {
                                await resolveAuxiliary(auxCi.auxiliaryCompositionId, auxCi.coefficient * parentCoef, parentCompCode);
                            }
                        }
                    };
                    await resolveAuxiliary(ci.auxiliaryCompositionId, ci.coefficient, composition.code);
                }
            }
        }

        // Build final array with computed fields
        const insumos = Array.from(consolidated.values()).map(ins => ({
            ...ins,
            desconto: 0,
            precoFinal: ins.precoOriginal,
            custoTotal: Math.round(ins.precoOriginal * ins.coeficienteTotal * 100) / 100,
        }));

        // Sort by custoTotal descending
        insumos.sort((a, b) => b.custoTotal - a.custoTotal);

        // ABC classification
        const totalCusto = insumos.reduce((s, i) => s + i.custoTotal, 0);
        if (totalCusto > 0) {
            let accum = 0;
            for (const ins of insumos as any[]) {
                accum += ins.custoTotal;
                const pct = (accum / totalCusto) * 100;
                ins.abcClass = pct <= 80 ? 'A' : pct <= 95 ? 'B' : 'C';
            }
        }

        // Stats
        const stats = {
            totalInsumos: insumos.length,
            totalCusto: Math.round(totalCusto * 100) / 100,
            custoMaterial: Math.round(insumos.filter(i => i.categoria === 'MATERIAL').reduce((s, i) => s + i.custoTotal, 0) * 100) / 100,
            custoMaoDeObra: Math.round(insumos.filter(i => i.categoria === 'MAO_DE_OBRA').reduce((s, i) => s + i.custoTotal, 0) * 100) / 100,
            custoEquipamento: Math.round(insumos.filter(i => i.categoria === 'EQUIPAMENTO').reduce((s, i) => s + i.custoTotal, 0) * 100) / 100,
            custoServico: Math.round(insumos.filter(i => i.categoria === 'SERVICO').reduce((s, i) => s + i.custoTotal, 0) * 100) / 100,
            composicoesEncontradas: compositionsFound,
            itensSemComposicao: itemsWithoutComposition,
            mode: compositionsFound > 0 ? 'compositions' : 'no_compositions',
        };

        console.log(`[Insumo Hub] 🔬 ${stats.totalInsumos} insumos de ${compositionsFound} composições (${itemsWithoutComposition} sem) | Material: R$${stats.custoMaterial} | MO: R$${stats.custoMaoDeObra} | Equip: R$${stats.custoEquipamento}`);

        res.json({ insumos, stats });

    } catch (e: any) {
        console.error('[Insumo Hub Resolve] Error:', e);
        res.status(500).json({ error: 'Erro ao resolver insumos', details: e.message });
    }
});

// ═══════════════════════════════════════════════════════════
// CRUD — Engineering Proposal Items (linked to PriceProposal)
// ═══════════════════════════════════════════════════════════

// GET /api/engineering/proposals/:id/items — Carregar todos os itens
router.get('/proposals/:id/items', async (req: any, res: any) => {
    try {
        const proposalId = req.params.id;
        const [items, proposal] = await Promise.all([
            prisma.engineeringProposalItem.findMany({
                where: { proposalId },
                orderBy: { sortOrder: 'asc' }
            }),
            prisma.priceProposal.findUnique({
                where: { id: proposalId },
                select: { bdiConfig: true, engineeringConfig: true }
            })
        ]);
        res.json({ 
            items, 
            bdiConfig: proposal?.bdiConfig,
            engineeringConfig: proposal?.engineeringConfig
        });
    } catch (e: any) {
        console.error('Error loading engineering items:', e);
        res.status(500).json({ error: 'Erro ao carregar itens de engenharia' });
    }
});

// POST /api/engineering/proposals/:id/items — Salvar/Sincronizar todos os itens
router.post('/proposals/:id/items', async (req: any, res: any) => {
    try {
        const proposalId = req.params.id;
        const { items, bdiConfig, engineeringConfig, cronogramaData } = req.body;

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
                    type: item.type || 'COMPOSICAO',
                    description: item.description || '',
                    unit: item.unit || 'UN',
                    quantity: Number(item.quantity) || (item.type === 'ETAPA' || item.type === 'SUBETAPA' ? 0 : 1),
                    unitCost: Number(item.unitCost) || 0,
                    unitPrice: Number(item.unitPrice) || 0,
                    totalPrice: Number(item.totalPrice) || 0,
                    bdiCategoria: item.bdiCategoria || 'OBRA',
                    priceOrigin: item.priceOrigin || 'MANUAL',
                    officialUnitCost: item.officialUnitCost === undefined ? null : Number(item.officialUnitCost) || 0,
                    officialUnitPrice: item.officialUnitPrice === undefined ? null : Number(item.officialUnitPrice) || 0,
                    officialTotalPrice: item.officialTotalPrice === undefined ? null : Number(item.officialTotalPrice) || 0,
                    priceAudit: refreshSubmittedPriceAudit(item),
                    sortOrder: index,
                }))
            });

            // Calculate and update proposal totals (excluding groupers)
            const totalValue = items
                .filter((it: any) => it.type !== 'ETAPA' && it.type !== 'SUBETAPA')
                .reduce((sum: number, it: any) => sum + (Number(it.totalPrice) || 0), 0);

            // FIX ARQ-04: Persist cronograma data alongside engineering config
            const engConfigToSave = cronogramaData 
                ? { ...(engineeringConfig || {}), cronogramaData }
                : (engineeringConfig || undefined);

            await tx.priceProposal.update({
                where: { id: proposalId },
                data: {
                    totalValue,
                    bdiConfig: bdiConfig || undefined,
                    engineeringConfig: engConfigToSave,
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

// POST /api/engineering/price-audit
// Recalcula o match dos itens contra as bases oficiais respeitando data-base e regime.
router.post('/price-audit', async (req: any, res: any) => {
    try {
        const { items, engineeringConfig } = req.body || {};
        if (!Array.isArray(items)) {
            return res.status(400).json({ error: 'items deve ser um array' });
        }

        const audited = items.map((item: any) => ({ ...item }));
        await enrichWithOfficialPrices(audited, engineeringConfig);
        res.json({ items: audited });
    } catch (e: any) {
        console.error('[Engineering Price Audit] Error:', e);
        res.status(500).json({ error: 'Erro ao reauditar preços', details: e.message });
    }
});

// ═══════════════════════════════════════════════════════════
// POST /api/engineering/ai-extract-bdi
// Extrai a composição de BDI via IA a partir do edital
// ═══════════════════════════════════════════════════════════
import { extractBdiFromBidding } from '../services/engineering/bdiAiExtractor';

router.post('/ai-extract-bdi', async (req: any, res: any) => {
    try {
        const { biddingId } = req.body;
        if (!biddingId) return res.status(400).json({ error: 'biddingId é obrigatório' });
        
        const bdiData = await extractBdiFromBidding(biddingId);
        
        if (!bdiData || !bdiData.found) {
            return res.json({ found: false, message: 'Nenhuma tabela de BDI explícita encontrada no edital.' });
        }
        
        return res.json({ found: true, data: bdiData });
    } catch (e: any) {
        console.error('[Engineering AI BDI] Error:', e);
        res.status(500).json({ error: 'Erro ao extrair BDI', details: e.message });
    }
});

// ═══════════════════════════════════════════════════════════
// POST /api/engineering/ai-populate
// Extrai itens de engenharia via IA a partir do edital
// Pipeline: V2 itens_licitados → AI extraction (fallback)
// ═══════════════════════════════════════════════════════════
router.post('/ai-populate', async (req: any, res: any) => {
    try {
        const { textChunk, biddingId, engineeringConfig, forceRefresh } = req.body;
        
        let extractionText = textChunk;

        if (biddingId) {
            const bidding = await prisma.biddingProcess.findUnique({
                where: { id: biddingId },
                include: { aiAnalysis: true }
            });

            // ═══════════════════════════════════════════════════
            // PASSO 1: Tentar usar dados de engenharia pré-extraídos (Etapa 1.5)
            // A Etapa 1.5 do pipeline PNCP usa o engineeringPromptV1 dedicado
            // para extrair a planilha completa. Se disponível, é SEMPRE superior.
            // ═══════════════════════════════════════════════════
            const schemaV2 = bidding?.aiAnalysis?.schemaV2 as any;
            
            // Priority 1: Use _engineeringBudgetItems from Etapa 1.5 (dedicated extraction)
            const engBudgetItems = schemaV2?._engineeringBudgetItems;
            if (Array.isArray(engBudgetItems) && engBudgetItems.length > 0 && !forceRefresh) {
                console.log(`[Engineering AI-Populate] 🏗️ Usando ${engBudgetItems.length} itens da Etapa 1.5 (extração dedicada)`);
                await enrichWithOfficialPrices(engBudgetItems, engineeringConfig);
                return res.json({ items: engBudgetItems, source: 'v2_engineering_budget', count: engBudgetItems.length });
            }
            
            if (forceRefresh) {
                console.log(`[Engineering AI-Populate] 🔄 forceRefresh=true — invalidando cache e forçando nova extração`);
            }

            // Priority 2: Use V2 itens_licitados if they have enough items
            // Guard: V2 items must be real budget items, NOT high-level stages/chapters
            const itensV2 = schemaV2?.proposal_analysis?.itens_licitados;
            const MIN_V2_ITEMS_FOR_ENGINEERING = 3;
            
            if (Array.isArray(itensV2) && itensV2.length >= MIN_V2_ITEMS_FOR_ENGINEERING) {
                // ═══════════════════════════════════════════════════
                // GUARD ANTI-ETAPA: Detecta se os "itens" são na verdade
                // etapas/capítulos genéricos do orçamento (ex: "SERVIÇOS PRELIMINARES",
                // "ADMINISTRAÇÃO", "DEMOLIÇÕES"). Etapas não têm códigos técnicos
                // (SINAPI/SEINFRA/ORSE) e usam descrições genéricas curtas.
                // Se >50% são etapas, rejeita e força extração dedicada.
                // ═══════════════════════════════════════════════════
                const STAGE_PATTERNS = [
                    /^SERVI[CÇ]OS?\s+(PRELIMIN|FINAIS|GERAIS|COMPLEMENTAR|T[EÉ]CNICOS)/i,
                    /^ADMINISTRA[CÇ][AÃ]O/i,
                    /^DEMOLI[CÇ][OÕ]ES/i,
                    /^TRANSPORTE/i,
                    /^EQUIPAMENTOS?\s+E\s+INSUMOS/i,
                    /^PINTURA$/i,
                    /^INSTALA[CÇ][OÕ]ES/i,
                    /^INFRAESTRUTURA$/i,
                    /^SUPERESTRUTURA$/i,
                    /^TERRAPLENAGEM$/i,
                    /^DRENAGEM$/i,
                    /^PAVIMENTA[CÇ][AÃ]O$/i,
                    /^COBERTURA$/i,
                    /^REVESTIMENTO/i,
                    /^ALVENARIA/i,
                    /^FUNDA[CÇ][OÕ]ES/i,
                    /^ESQUADRIAS/i,
                    /^LIMPEZA\s+(FINAL|GERAL|DA\s+OBRA)/i,
                    /^(M[AÃ]O\s+DE\s+OBRA|ENCARGOS)/i,
                ];
                
                const stageCount = itensV2.filter((item: any) => {
                    const desc = (item.description || '').trim();
                    // Short generic descriptions without technical codes are likely stages
                    const hasCode = /\b\d{4,6}(\/\d+)?\b/.test(desc) || /\b[CI]\d{3,5}\b/i.test(desc);
                    if (hasCode) return false;
                    return STAGE_PATTERNS.some(p => p.test(desc)) || desc.split(/\s+/).length <= 3;
                }).length;
                
                const stageRatio = stageCount / itensV2.length;
                
                if (stageRatio > 0.5) {
                    console.log(`[Engineering AI-Populate] ⚠️ GUARD ANTI-ETAPA: ${stageCount}/${itensV2.length} itens (${Math.round(stageRatio * 100)}%) parecem etapas/capítulos. Rejeitando V2 e forçando extração dedicada.`);
                } else {
                    console.log(`[Engineering AI-Populate] 🎯 Usando ${itensV2.length} itens de itens_licitados V2 (≥ ${MIN_V2_ITEMS_FOR_ENGINEERING}, ${stageCount} etapas detectadas)`);
                    const items = await mapV2ToEngineering(itensV2, engineeringConfig);
                    return res.json({ items, source: 'v2_itens_licitados', count: items.length });
                }
            }

            console.log(`[Engineering AI-Populate] ⚠️ Dados V2 insuficientes (engBudget=${engBudgetItems?.length || 0}, itensV2=${itensV2?.length || 0}).`);

            // ═══════════════════════════════════════════════════
            // GUARDA: Se há um job de engenharia ativo, NÃO re-extrair
            // O background job vai popular _engineeringBudgetItems quando concluir.
            // Re-extrair aqui duplica custo de IA e cria duas fontes de verdade.
            // ═══════════════════════════════════════════════════
            const activeJob = await prisma.backgroundJob.findFirst({
                where: {
                    targetId: biddingId,
                    type: 'engineering_extraction',
                    status: { in: ['QUEUED', 'PROCESSING'] },
                },
                select: { id: true, status: true, progress: true, progressMsg: true },
            });

            if (activeJob) {
                console.log(`[Engineering AI-Populate] ⏳ Job ativo detectado (${activeJob.id}, ${activeJob.status}, ${activeJob.progress}%). Aguardando conclusão...`);
                return res.status(202).json({
                    items: [],
                    source: 'pending_background_job',
                    count: 0,
                    pendingJob: {
                        jobId: activeJob.id,
                        status: activeJob.status,
                        progress: activeJob.progress,
                        progressMsg: activeJob.progressMsg || 'Extração em andamento...',
                    },
                    message: 'A planilha orçamentária está sendo extraída em background. Aguarde a conclusão e tente novamente.',
                });
            }

            console.log(`[Engineering AI-Populate] ⚠️ Sem job ativo. Iniciando extração em background.`);

            // PASSO 2: Criar o job em background se ainda não existe.
            // Antes de submeter, ranqueia anexos para evitar mandar edital/atas
            // genéricos ao extrator multimodal de engenharia.
            const attachments = schemaV2?.pncp_source?.attachments || [];
            const classifiedDocs = classifyEngineeringAttachments(attachments, { maxDocuments: 4 });
            const selectedDocs = classifiedDocs.selected.length > 0
                ? classifiedDocs.selected
                : classifiedDocs.all.filter(doc => doc.score > -20).slice(0, 4);
            const pdfUrls = selectedDocs.map(doc => doc.url);

            console.log(
                `[Engineering AI-Populate] 📎 Classificador selecionou ${selectedDocs.length}/${classifiedDocs.summary.total} anexo(s): ` +
                selectedDocs.map(doc => `"${doc.title}" (${doc.score})`).join(', ')
            );

            const user = req.user || { tenantId: bidding?.tenantId || 'unknown', userId: 'system' };
            
            const newJob = await submitJob({
                tenantId: user.tenantId,
                userId: user.userId || user.id || 'system',
                type: 'engineering_extraction',
                targetId: biddingId,
                targetTitle: `Planilha Orçamentária — ${bidding?.processNumber || bidding?.title || 'Edital'}`,
                input: {
                    biddingId,
                    pdfUrls,
                    documentSelection: {
                        total: classifiedDocs.summary.total,
                        selected: selectedDocs.length,
                        titles: selectedDocs.map(doc => doc.title),
                        scores: selectedDocs.map(doc => doc.score),
                    }
                }
            });

            return res.status(202).json({
                items: [],
                source: 'pending_background_job',
                count: 0,
                pendingJob: {
                    jobId: newJob.jobId,
                    status: 'QUEUED',
                    progress: 0,
                    progressMsg: 'Iniciando extração da planilha de engenharia em background...',
                },
                message: 'A planilha orçamentária de engenharia está sendo extraída em background. Aguarde a conclusão e clique em "Extrair" novamente.'
            });
        }

        // Se NÃO tem biddingId (ex: texto colado direto no front), usa o fallback IA
        if (!extractionText || extractionText.length < 200) {
            // If even combined text is too short, try direct PDF extraction
            console.log(`[Engineering AI-Populate] ⚠️ Texto combinado insuficiente (${extractionText?.length || 0} chars), tentando extração direta dos PDFs do PNCP...`);
        }

        // ═══════════════════════════════════════════════════
        // PASSO 3: AI Extraction — Dois modos:
        //   A) Texto longo (>1000 chars): usar texto diretamente
        //   B) Texto curto ou sem texto: baixar PDFs do PNCP e enviar inline
        // ═══════════════════════════════════════════════════
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        let prompt = ENGINEERING_PROPOSAL_SYSTEM_PROMPT;
        
        if (engineeringConfig) {
            prompt += `\n\n[REGRAS DE NEGÓCIO - CONFIGURAÇÃO MESTRE]
1. Bases permitidas para mapeamento: ${engineeringConfig.basesConsideradas?.join(', ') || 'qualquer'}
2. Considere estritamente essas bases para identificar códigos. Se a base não estiver na lista, categorize o item como PROPRIA.`;
        }
        let result: any;

        const shouldTryPdfDirect = !extractionText || extractionText.length < 1000;

        if (shouldTryPdfDirect && biddingId) {
            // MODE B: Direct PDF extraction from PNCP
            console.log(`[Engineering AI-Populate] 📄 Modo PDF Direto — baixando documentos do PNCP`);
            try {
                const pdfParts = await downloadPncpPdfsForEngineering(biddingId);
                if (pdfParts.length > 0) {
                    console.log(`[Engineering AI-Populate] 📄 ${pdfParts.length} PDFs prontos para envio ao Gemini`);
                    result = await callGeminiWithRetry(ai.models, {
                        model: 'gemini-2.5-flash',
                        contents: [{ role: 'user', parts: [...pdfParts, { text: ENGINEERING_PROPOSAL_USER_INSTRUCTION }] }],
                        config: {
                            systemInstruction: { role: 'system', parts: [{ text: prompt }] },
                            temperature: 0.15, maxOutputTokens: 65536,
                        }
                    });
                }
            } catch (pdfErr: any) {
                console.warn(`[Engineering AI-Populate] ⚠️ Falha no modo PDF direto: ${pdfErr.message}`);
            }
        }

        // MODE A: Text-based extraction (used if PDF mode wasn't tried or failed)
        if (!result && extractionText && extractionText.length > 50) {
            const userInput = ENGINEERING_PROPOSAL_USER_INSTRUCTION + "\n\nTEXTO DO EDITAL/PROJETO:\n" + extractionText.slice(0, 120000);
            result = await callGeminiWithRetry(ai.models, {
                model: 'gemini-2.5-flash',
                contents: [{ role: 'user', parts: [{ text: userInput }] }],
                config: {
                    systemInstruction: { role: 'system', parts: [{ text: prompt }] },
                    temperature: 0.2, maxOutputTokens: 65536,
                }
            });
        }

        if (!result) {
            return res.status(400).json({ error: 'Não foi possível extrair itens: sem texto nem PDFs disponíveis' });
        }

        const rawResponse = result?.text || '';
        let items = parseAndNormalizeEngineeringExtraction(rawResponse).engineeringItems as any[];

        // If text mode yielded ≤1 item and we haven't tried PDF mode, try it now
        if (items.length <= 1 && biddingId && !shouldTryPdfDirect) {
            console.log(`[Engineering AI-Populate] 🔄 Texto retornou apenas ${items.length} item(ns). Tentando modo PDF direto...`);
            try {
                const pdfParts = await downloadPncpPdfsForEngineering(biddingId);
                if (pdfParts.length > 0) {
                    const pdfResult = await callGeminiWithRetry(ai.models, {
                        model: 'gemini-2.5-flash',
                        contents: [{ role: 'user', parts: [...pdfParts, { text: ENGINEERING_PROPOSAL_USER_INSTRUCTION }] }],
                        config: {
                            systemInstruction: { role: 'system', parts: [{ text: prompt }] },
                            temperature: 0.15, maxOutputTokens: 65536,
                        }
                    });
                    const pdfItems = parseAndNormalizeEngineeringExtraction(pdfResult?.text || '').engineeringItems as any[];
                    if (pdfItems.length > items.length) {
                        console.log(`[Engineering AI-Populate] ✅ PDF direto retornou ${pdfItems.length} itens (melhor que texto: ${items.length})`);
                        items = pdfItems;
                    }
                }
            } catch (pdfErr: any) {
                console.warn(`[Engineering AI-Populate] ⚠️ Fallback PDF falhou: ${pdfErr.message}`);
            }
        }
        
        // Auto-lookup for prices against registered databases
        await enrichWithOfficialPrices(items, engineeringConfig);

        // Auto-save composições PRÓPRIAS to the database
        const ownComps = items.filter((it: any) => {
            if (it.type !== 'COMPOSICAO') return false;
            const source = (it.sourceName || '').toUpperCase();
            const isKnownSource = ['SINAPI', 'SEINFRA', 'ORSE', 'SICRO', 'SICOR', 'SBC'].includes(source);
            return !isKnownSource || source === 'PROPRIA';
        });
        if (ownComps.length > 0 && biddingId) {
            try {
                // Ensure empty ones are transformed into observation items with zero cost
                for (const comp of ownComps) {
                    if (!Array.isArray(comp.insumos) || comp.insumos.length === 0) {
                        const expectedPrice = comp.unitPrice || comp.unitCost || 0;
                        comp.insumos = [{
                            type: 'OBSERVACAO',
                            description: `ATENÇÃO: O item no edital possui o valor de R$ ${expectedPrice.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}. Nenhuma composição analítica foi encontrada. Importe a imagem da CPU ou construa os custos manualmente no Módulo Livre.`,
                            unit: 'UN',
                            quantity: 0,
                            unitCost: 0,
                            unitPrice: 0,
                            coefficient: 0
                        }];
                        // Force cost to zero in the budget
                        comp.unitCost = 0;
                        comp.unitPrice = 0;
                        comp.totalPrice = 0;
                    }
                }

                const bidding = await prisma.biddingProcess.findUnique({ where: { id: biddingId }, select: { tenantId: true } });
                if (bidding?.tenantId) {
                    let propriaDb = await prisma.engineeringDatabase.findFirst({ where: { name: 'PROPRIA', tenantId: bidding.tenantId } });
                    if (!propriaDb) {
                        propriaDb = await prisma.engineeringDatabase.create({ data: { name: 'PROPRIA', uf: '', tenantId: bidding.tenantId, type: 'PROPRIA' } });
                    }
                    let saved = 0;
                    for (const comp of ownComps) {
                        try {
                            const existing = await prisma.engineeringComposition.findFirst({ where: { code: comp.code || comp.item, databaseId: propriaDb.id } });
                            let compTotal = 0;
                            if (Array.isArray(comp.insumos)) {
                                for (const ins of comp.insumos) {
                                    if (ins.type !== 'OBSERVACAO') {
                                        compTotal += (ins.coefficient || 0) * (ins.unitPrice || 0);
                                    }
                                }
                            }
                            const compRecord = existing
                                ? await prisma.engineeringComposition.update({ where: { id: existing.id }, data: { description: comp.description, unit: comp.unit || 'UN', totalPrice: compTotal } })
                                : await prisma.engineeringComposition.create({ data: { code: comp.code || comp.item, description: comp.description, unit: comp.unit || 'UN', databaseId: propriaDb.id, totalPrice: compTotal } });

                            await prisma.engineeringCompositionItem.deleteMany({ where: { compositionId: compRecord.id } });
                            for (const ins of (comp.insumos || [])) {
                                const insCode = `INS-${comp.code || comp.item}-${saved + 1}`;
                                let insumo = await prisma.engineeringItem.findFirst({ where: { code: insCode, databaseId: propriaDb.id } });
                                if (!insumo) {
                                    const typeMap: Record<string, string> = { 'MAO_DE_OBRA': 'MAO_DE_OBRA', 'EQUIPAMENTO': 'EQUIPAMENTO', 'MATERIAL': 'MATERIAL', 'OBSERVACAO': 'OBSERVACAO' };
                                    insumo = await prisma.engineeringItem.create({
                                        data: { code: insCode, description: ins.description || '', unit: ins.unit || 'UN', price: ins.unitPrice || 0, type: typeMap[ins.type] || 'MATERIAL', databaseId: propriaDb.id }
                                    });
                                }
                                await prisma.engineeringCompositionItem.create({
                                    data: { compositionId: compRecord.id, itemId: insumo.id, coefficient: ins.coefficient || 0, price: ins.type === 'OBSERVACAO' ? 0 : (ins.coefficient || 0) * (ins.unitPrice || 0) }
                                });
                            }
                            saved++;
                        } catch (e: any) {
                            console.warn(`[Engineering AI-Populate] ⚠️ Erro ao salvar comp própria ${comp.code}: ${e.message}`);
                        }
                    }
                    console.log(`[Engineering AI-Populate] 💾 ${saved} composições próprias com insumos salvas`);
                }
            } catch (e: any) {
                console.warn(`[Engineering AI-Populate] ⚠️ Erro ao salvar comps próprias: ${e.message}`);
            }
        }

        res.json({ items, source: 'ai_extraction', count: items.length });

    } catch (e: any) {
        console.error('Error in AI engineering extraction:', e);
        res.status(500).json({ error: e.message || 'Falha ao extrair itens via Inteligência Artificial' });
    }
});

// ═══════════════════════════════════════════════════════════
// POST /api/engineering/ai-extract-compositions
// Extrai Composições de Preços Unitários (CPUs) via IA
// a partir do texto do edital/projeto básico
// ═══════════════════════════════════════════════════════════
router.post('/ai-extract-compositions', async (req: any, res: any) => {
    try {
        const { biddingId, engineeringConfig, proposalItems } = req.body;
        if (!biddingId) return res.status(400).json({ error: 'biddingId obrigatório' });

        const bidding = await prisma.biddingProcess.findUnique({
            where: { id: biddingId },
            include: { aiAnalysis: true }
        });

        if (!bidding?.aiAnalysis) {
            return res.status(404).json({ error: 'Análise IA não encontrada para este processo' });
        }

        const { COMPOSITION_EXTRACTION_SYSTEM_PROMPT, COMPOSITION_EXTRACTION_USER_INSTRUCTION } = await import('../services/ai/modules/prompts/engineeringCompositionPrompt');

        let systemPrompt = COMPOSITION_EXTRACTION_SYSTEM_PROMPT;
        if (engineeringConfig) {
            systemPrompt += `\n\n[REGRAS DE NEGÓCIO - CONFIGURAÇÃO MESTRE]
1. Bases permitidas para mapeamento de Composições: ${engineeringConfig.basesConsideradas?.join(', ') || 'qualquer'}
2. Considere estritamente essas bases para identificar códigos de composições e insumos.
3. Se a base não estiver na lista, ou for uma composição "P" (Própria), categorize com código "N/A" e informe os insumos.`;
        }

        // Build a list of items from the proposal so the AI uses their exact codes
        let itemsContext = '';
        const budgetItemCodes: string[] = [];
        if (Array.isArray(proposalItems) && proposalItems.length > 0) {
            const compositionItems = proposalItems.filter((it: any) => it.type === 'COMPOSICAO' || it.type === 'INSUMO');
            if (compositionItems.length > 0) {
                itemsContext = '\n\n═══════════════════════════════════════════════════════\nITENS DA PLANILHA ORÇAMENTÁRIA (use ESTES códigos nas composições)\n═══════════════════════════════════════════════════════\n';
                itemsContext += compositionItems.map((it: any) => {
                    budgetItemCodes.push(it.code || '');
                    return `- Código: ${it.code || 'N/A'} | Descrição: ${it.description} | Unidade: ${it.unit || 'UN'} | Qtd: ${it.quantity || 1}`;
                }).join('\n');
                itemsContext += '\n\nIMPORTANTE: Use os códigos EXATOS listados acima (ex: CP-01, CP-02) como "code" de cada composição no JSON de saída. Extraia a composição analítica de CADA item listado acima.';
            }
        }

        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        let result: any = null;

        // ═══════════════════════════════════════════════════════
        // MODO 1 (PRIMÁRIO): Extração multimodal via PDFs do PNCP
        // CPUs estão nos anexos (planilha orçamentária, projeto básico),
        // NÃO no texto narrativo do edital.
        // ═══════════════════════════════════════════════════════
        try {
            const pdfParts = await downloadPncpPdfsForEngineering(biddingId);
            if (pdfParts.length > 0) {
                console.log(`[Engineering AI-Compositions] 📄 ${pdfParts.length} PDFs prontos para extração multimodal de composições (${budgetItemCodes.length} itens contextuais)`);
                result = await callGeminiWithRetry(ai.models, {
                    model: 'gemini-2.5-flash',
                    contents: [{ role: 'user', parts: [...pdfParts, { text: COMPOSITION_EXTRACTION_USER_INSTRUCTION + itemsContext }] }],
                    config: {
                        systemInstruction: { role: 'system', parts: [{ text: systemPrompt }] },
                        temperature: 0.15,
                        maxOutputTokens: 65536,
                    }
                });
            } else {
                console.log(`[Engineering AI-Compositions] ⚠️ Nenhum PDF disponível para extração multimodal`);
            }
        } catch (pdfErr: any) {
            console.warn(`[Engineering AI-Compositions] ⚠️ Falha no modo PDF multimodal: ${pdfErr.message}`);
        }
        // Verify PDF mode actually produced content
        if (result && (!result.text || result.text.trim().length < 10)) {
            console.warn(`[Engineering AI-Compositions] ⚠️ PDF mode returned empty/minimal response (${(result.text || '').length} chars). Trying fallback...`);
            result = null;
        }

        // ═══════════════════════════════════════════════════════
        // MODO 2 (FALLBACK): Texto do aiAnalysis + schemaV2
        // Usado somente se o modo PDF não conseguiu extrair nada
        // ═══════════════════════════════════════════════════════
        if (!result) {
            const parts: string[] = [];
            if (bidding.aiAnalysis.biddingItems) parts.push(bidding.aiAnalysis.biddingItems);
            if (bidding.aiAnalysis.requiredDocuments) parts.push(bidding.aiAnalysis.requiredDocuments);
            if (bidding.aiAnalysis.pricingConsiderations) parts.push(bidding.aiAnalysis.pricingConsiderations);
            if (bidding.aiAnalysis.fullSummary) parts.push(bidding.aiAnalysis.fullSummary);

            const schemaV2 = bidding.aiAnalysis.schemaV2 as any;
            if (schemaV2?.proposal_analysis?.itens_licitados) {
                parts.push('ITENS LICITADOS (estruturados):\n' + JSON.stringify(schemaV2.proposal_analysis.itens_licitados, null, 2));
            }
            // Also include _engineeringBudgetItems if available
            if (schemaV2?._engineeringBudgetItems) {
                parts.push('ITENS DE ENGENHARIA (extração dedicada):\n' + JSON.stringify(schemaV2._engineeringBudgetItems, null, 2));
            }

            const extractionText = parts.join('\n\n---\n\n');
            if (extractionText.length >= 50) {
                console.log(`[Engineering AI-Compositions] 📝 Fallback texto: ${extractionText.length} chars`);
                result = await callGeminiWithRetry(ai.models, {
                    model: 'gemini-2.5-flash',
                    contents: [{
                        role: 'user',
                        parts: [{ text: COMPOSITION_EXTRACTION_USER_INSTRUCTION + '\n\nDOCUMENTO:\n' + extractionText.slice(0, 120000) }]
                    }],
                    config: {
                        systemInstruction: { role: 'system', parts: [{ text: systemPrompt }] },
                        temperature: 0.15,
                        maxOutputTokens: 65536,
                    }
                });
            }
        }

        if (!result) {
            return res.status(400).json({ error: 'Não foi possível extrair composições: sem PDFs nem texto disponíveis' });
        }

        const rawResponse = result?.text || '';
        console.log(`[Engineering AI-Compositions] 📋 Resposta IA: ${rawResponse.length} chars | Primeiros 300: ${rawResponse.substring(0, 300)}`);

        let compositions: any[] = [];
        try {
            const parsed = robustJsonParse(rawResponse);
            console.log(`[Engineering AI-Compositions] 📋 Parse OK. Keys: ${Object.keys(parsed || {}).join(', ')} | Type: ${typeof parsed} | isArray: ${Array.isArray(parsed)}`);

            // Try multiple possible response formats
            if (Array.isArray(parsed?.compositions)) {
                compositions = parsed.compositions;
            } else if (Array.isArray(parsed)) {
                compositions = parsed;
            } else {
                // Search for any array property that looks like compositions
                for (const key of Object.keys(parsed || {})) {
                    const val = parsed[key];
                    if (Array.isArray(val) && val.length > 0 && val[0].code) {
                        compositions = val;
                        console.log(`[Engineering AI-Compositions] 📋 Found compositions under key "${key}"`);
                        break;
                    }
                }
            }
        } catch (parseErr: any) {
            console.error(`[Engineering AI-Compositions] ❌ JSON parse failed: ${parseErr.message}`);
            console.error(`[Engineering AI-Compositions] 📋 Raw response (first 500): ${rawResponse.substring(0, 500)}`);
            return res.status(500).json({ error: 'IA retornou resposta inválida', details: parseErr.message });
        }

        console.log(`[Engineering AI-Compositions] 📋 ${compositions.length} composições encontradas`);

        if (compositions.length === 0) {
            return res.json({ compositions: [], saved: 0, message: 'Nenhuma composição encontrada no documento' });
        }

        // Store extracted compositions in the database as "PROPRIA"
        let dbId: string | undefined;
        // Find or create a "PROPRIA" database for this tenant
        const tenantId = bidding.tenantId;
        let propriaDb = await prisma.engineeringDatabase.findFirst({
            where: { name: 'PROPRIA', tenantId }
        });
        if (!propriaDb) {
            propriaDb = await prisma.engineeringDatabase.create({
                data: { name: 'PROPRIA', uf: '', tenantId, type: 'PROPRIA' }
            });
        }
        dbId = propriaDb.id;

        let insertedCount = 0;
        for (const comp of compositions) {
            try {
                // Calculate totalPrice from groups
                let compTotal = 0;
                for (const items of Object.values(comp.groups || {})) {
                    if (!Array.isArray(items)) continue;
                    for (const it of items) compTotal += (it.coefficient || 0) * (it.unitPrice || 0);
                }

                // Upsert composition
                const existing = await prisma.engineeringComposition.findFirst({
                    where: { code: comp.code, databaseId: dbId }
                });

                const compRecord = existing
                    ? await prisma.engineeringComposition.update({
                        where: { id: existing.id },
                        data: { description: comp.description, unit: comp.unit || 'UN', totalPrice: compTotal }
                    })
                    : await prisma.engineeringComposition.create({
                        data: {
                            code: comp.code, description: comp.description,
                            unit: comp.unit || 'UN', databaseId: dbId, totalPrice: compTotal,
                        }
                    });

                // Delete old items and insert new ones
                await prisma.engineeringCompositionItem.deleteMany({
                    where: { compositionId: compRecord.id }
                });

                for (const [groupKey, items] of Object.entries(comp.groups || {})) {
                    if (!Array.isArray(items)) continue;
                    for (const item of items) {
                        // Find or create the insumo (EngineeringItem)
                        let insumo = await prisma.engineeringItem.findFirst({
                            where: { code: item.code, databaseId: dbId }
                        });
                        if (!insumo) {
                            insumo = await prisma.engineeringItem.create({
                                data: {
                                    code: item.code, description: item.description,
                                    unit: item.unit || 'UN', price: item.unitPrice || 0,
                                    type: groupKey, databaseId: dbId,
                                }
                            });
                        }

                        const itemPrice = (item.coefficient || 0) * (item.unitPrice || 0);
                        await prisma.engineeringCompositionItem.create({
                            data: {
                                compositionId: compRecord.id, itemId: insumo.id,
                                coefficient: item.coefficient || 0, price: itemPrice,
                            }
                        });
                    }
                }
                insertedCount++;
            } catch (compErr: any) {
                console.warn(`[AI-Compositions] ⚠️ Erro ao salvar composição ${comp.code}:`, compErr.message);
            }
        }

        console.log(`[Engineering AI-Compositions] ✅ ${insertedCount}/${compositions.length} composições extraídas e salvas`);

        res.json({
            compositions,
            saved: insertedCount,
            databaseId: dbId,
            message: `${insertedCount} composições extraídas via IA e salvas na base PROPRIA`
        });

    } catch (e: any) {
        console.error('[AI-Compositions] ❌ Error:', e);
        res.status(500).json({ error: 'Falha ao extrair composições via IA', details: e.message });
    }
});

/**
 * Mapeia itens_licitados do V2 para formato de engenharia
 * e faz auto-match contra as bases oficiais cadastradas (SINAPI/SEINFRA)
 */
async function mapV2ToEngineering(itensV2: any[], engineeringConfig?: any): Promise<any[]> {
    const items = itensV2.map((item: any) => {
        // Priority 1: Use V2's explicit sourceCode/sourceBase (new fields from enriched prompt)
        let sourceName = item.sourceBase || '';
        let code = item.sourceCode || '';
        
        // Priority 2: Detect from description/itemNumber if V2 didn't provide
        if (!code) {
            const detected = detectSourceAndCode(item.description, item.itemNumber);
            sourceName = detected.sourceName;
            code = detected.code;
        } else if (!sourceName) {
            sourceName = /\/ORSE$/i.test(code)
                ? 'ORSE'
                : code.match(/^[CI]\d/i)
                    ? 'SEINFRA'
                    : 'SINAPI';
        }

        // Infer type from item structure
        const itemNum = item.itemNumber || '';
        const hasPrice = (item.referencePrice || 0) > 0;
        const depth = (itemNum.match(/\./g) || []).length;
        let type = 'COMPOSICAO';
        if (!hasPrice && depth === 0) type = 'ETAPA';
        else if (!hasPrice && depth === 1 && !item.unit) type = 'SUBETAPA';
        else if (sourceName === 'PROPRIA' && !code) type = 'INSUMO';

        return {
            item: itemNum,
            type,
            sourceName: type === 'ETAPA' || type === 'SUBETAPA' ? '' : sourceName,
            code: type === 'ETAPA' || type === 'SUBETAPA' ? '' : code,
            description: item.description || '',
            unit: type === 'ETAPA' || type === 'SUBETAPA' ? '' : (item.unit || 'UN'),
            quantity: type === 'ETAPA' || type === 'SUBETAPA' ? 0 : (item.quantity || 1),
            unitCost: type === 'ETAPA' || type === 'SUBETAPA' ? 0 : (item.referencePrice || 0),
        };
    });

    // Enrich with official database prices
    await enrichWithOfficialPrices(items, engineeringConfig);
    
    return items;
}

/**
 * Detecta a base oficial (SINAPI, SEINFRA, SICOR, ORSE, SICRO) e o código
 * a partir da descrição ou número do item
 */
function detectSourceAndCode(description: string, itemNumber?: string): { sourceName: string; code: string } {
    const desc = (description || '').toUpperCase();
    
    // Pattern: "SINAPI 74209/1" or "SINAPI: 74209"
    const sinapiMatch = desc.match(/SINAPI[\s:.-]*(\d{4,6}(?:\/\d+)?)/i);
    if (sinapiMatch) return { sourceName: 'SINAPI', code: sinapiMatch[1] };
    
    // Pattern: "SEINFRA C0054" or "COD: C1614"
    const seinfraMatch = desc.match(/(?:SEINFRA[\s:.-]*)?([CI]\d{3,5})/i);
    if (seinfraMatch) return { sourceName: 'SEINFRA', code: seinfraMatch[1].toUpperCase() };
    
    // Pattern: "ORSE 1234", "SICRO 1234" or "SICOR-MG ED-12345"
    const sourceMatch = desc.match(/\b(ORSE|SICRO|SICOR(?:-MG)?|DER(?:-MG)?)[\s:.-]*([A-Z]{0,4}[-.]?\d{3,8})(?:\/ORSE)?\b/i)
        || desc.match(/\b(0*\d{1,6})\/(ORSE)\b/i);
    if (sourceMatch) {
        const isSlashFormat = String(sourceMatch[2] || '').toUpperCase() === 'ORSE';
        const rawSourceName = isSlashFormat ? 'ORSE' : String(sourceMatch[1]).toUpperCase();
        const sourceName = rawSourceName === 'SICOR-MG' || rawSourceName === 'DER' || rawSourceName === 'DER-MG' ? 'SICOR' : rawSourceName;
        const numericCode = isSlashFormat ? sourceMatch[1] : sourceMatch[2];
        return {
            sourceName,
            code: sourceName === 'ORSE'
                ? `${String(numericCode).replace(/^0+(\d)/, '$1')}/ORSE`
                : String(numericCode),
        };
    }

    // If itemNumber has a code-like pattern (e.g., C0054)
    if (itemNumber && /^[CI]\d{3,5}$/i.test(itemNumber.trim())) {
        return { sourceName: 'SEINFRA', code: itemNumber.trim().toUpperCase() };
    }
    if (itemNumber && /^0*\d{1,6}\/ORSE$/i.test(itemNumber.trim())) {
        return { sourceName: 'ORSE', code: itemNumber.trim().toUpperCase().replace(/^0+(\d)/, '$1') };
    }

    return { sourceName: 'PROPRIA', code: itemNumber || 'N/A' };
}

// FIX-01: Price enrichment functions now centralized in priceEnricher.ts
import {
    enrichWithOfficialPrices,
    parseDataBaseMonth,
    formatReference,
    buildCandidateScore,
    chooseBestCandidate,
    type EngineeringPriceAuditStatus,
} from '../services/engineering/priceEnricher';

// ═══════════════════════════════════════════════════════════
// POST /api/engineering/seed — Seed de bases oficiais (admin-only)
// Popula SINAPI-CE e SEINFRA-CE com itens reais
// ═══════════════════════════════════════════════════════════
router.post('/seed', async (req: any, res: any) => {
    try {
        if (req.user?.role !== 'SUPER_ADMIN' && req.user?.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Acesso restrito a administradores' });
        }

        const ITEMS: Record<string, { name: string; uf: string; version: string; items: { code: string; desc: string; unit: string; price: number; type: string }[] }> = {
          'SINAPI-CE': { name: 'SINAPI', uf: 'CE', version: '2026-04', items: [
            {code:'00000370',desc:'CIMENTO PORTLAND COMPOSTO CP II-32',unit:'KG',price:0.62,type:'MATERIAL'},
            {code:'00000406',desc:'AREIA MEDIA - POSTO JAZIDA/FORNECEDOR',unit:'M3',price:75.00,type:'MATERIAL'},
            {code:'00000409',desc:'BRITA 1 - POSTO PEDREIRA/FORNECEDOR',unit:'M3',price:89.00,type:'MATERIAL'},
            {code:'00000436',desc:'TIJOLO CERAMICO FURADO 9X19X19CM',unit:'UN',price:0.48,type:'MATERIAL'},
            {code:'00000453',desc:'BLOCO CONCRETO ESTRUTURAL 14X19X39CM',unit:'UN',price:3.85,type:'MATERIAL'},
            {code:'00000519',desc:'TINTA LATEX PVA PREMIUM',unit:'L',price:12.50,type:'MATERIAL'},
            {code:'00000520',desc:'TINTA LATEX ACRILICA PREMIUM',unit:'L',price:18.90,type:'MATERIAL'},
            {code:'00000537',desc:'MASSA CORRIDA PVA',unit:'L',price:5.80,type:'MATERIAL'},
            {code:'00000693',desc:'TUBO PVC SOLDAVEL DN 25MM (3/4")',unit:'M',price:3.45,type:'MATERIAL'},
            {code:'00000696',desc:'TUBO PVC ESGOTO DN 100MM',unit:'M',price:12.80,type:'MATERIAL'},
            {code:'00000734',desc:'FIO DE COBRE FLEXIVEL 2,5MM2',unit:'M',price:2.85,type:'MATERIAL'},
            {code:'00000822',desc:'ACO CA-50 DIAMETRO 8,0MM',unit:'KG',price:6.85,type:'MATERIAL'},
            {code:'00000824',desc:'ACO CA-50 DIAMETRO 12,5MM',unit:'KG',price:6.55,type:'MATERIAL'},
            {code:'00001379',desc:'PISO CERAMICO ESMALTADO PEI-4 43X43CM',unit:'M2',price:28.50,type:'MATERIAL'},
            {code:'00001382',desc:'AZULEJO CERAMICO ESMALTADO 33X45CM',unit:'M2',price:22.00,type:'MATERIAL'},
            {code:'00001391',desc:'ARGAMASSA COLANTE ACII',unit:'KG',price:1.20,type:'MATERIAL'},
            {code:'00003764',desc:'PORTA DE MADEIRA SEMI-OCA 80X210CM',unit:'UN',price:185.00,type:'MATERIAL'},
            {code:'00003780',desc:'JANELA ALUMINIO CORRER 2 FOLHAS 120X120CM',unit:'UN',price:420.00,type:'MATERIAL'},
            {code:'00004400',desc:'VASO SANITARIO COM CAIXA ACOPLADA',unit:'UN',price:285.00,type:'MATERIAL'},
            {code:'00004401',desc:'LAVATORIO LOUCA COM COLUNA',unit:'UN',price:145.00,type:'MATERIAL'},
            {code:'00011963',desc:'MANTA ASFALTICA 3MM TIPO II',unit:'M2',price:32.00,type:'MATERIAL'},
            {code:'00020083',desc:'TELHA FIBROCIMENTO ONDULADA 6MM',unit:'M2',price:28.00,type:'MATERIAL'},
            {code:'00020087',desc:'TELHA CERAMICA TIPO COLONIAL',unit:'UN',price:1.80,type:'MATERIAL'},
            {code:'00002690',desc:'SERVENTE DE OBRAS',unit:'H',price:12.80,type:'MAO_DE_OBRA'},
            {code:'00002691',desc:'PEDREIRO',unit:'H',price:18.50,type:'MAO_DE_OBRA'},
            {code:'00002692',desc:'CARPINTEIRO',unit:'H',price:17.80,type:'MAO_DE_OBRA'},
            {code:'00002693',desc:'ARMADOR',unit:'H',price:17.50,type:'MAO_DE_OBRA'},
            {code:'00002695',desc:'ELETRICISTA',unit:'H',price:19.20,type:'MAO_DE_OBRA'},
            {code:'00002696',desc:'ENCANADOR / BOMBEIRO HIDRAULICO',unit:'H',price:18.80,type:'MAO_DE_OBRA'},
            {code:'00002698',desc:'PINTOR',unit:'H',price:17.00,type:'MAO_DE_OBRA'},
            {code:'00002705',desc:'MESTRE DE OBRAS',unit:'H',price:24.00,type:'MAO_DE_OBRA'},
            {code:'00005801',desc:'BETONEIRA CAPACIDADE 400L',unit:'H',price:8.50,type:'EQUIPAMENTO'},
            {code:'00005810',desc:'CAMINHAO BASCULANTE 6M3',unit:'H',price:125.00,type:'EQUIPAMENTO'},
            {code:'00005815',desc:'RETROESCAVADEIRA SOBRE RODAS',unit:'H',price:135.00,type:'EQUIPAMENTO'},
            {code:'74209/1',desc:'PINTURA LATEX ACRILICA PREMIUM, 2 DEMAOS, SOBRE MASSA CORRIDA',unit:'M2',price:16.42,type:'SERVICO'},
            {code:'74077/2',desc:'MASSA UNICA PARA RECEBIMENTO DE PINTURA, ESP=2CM',unit:'M2',price:24.85,type:'SERVICO'},
            {code:'87878',desc:'ALVENARIA VEDACAO BLOCOS CERAMICOS FURADOS 9X19X19CM, E=10CM',unit:'M2',price:45.20,type:'SERVICO'},
            {code:'87529',desc:'CHAPISCO APLICADO EM ALVENARIA COM ROLO',unit:'M2',price:4.12,type:'SERVICO'},
            {code:'92263',desc:'REVESTIMENTO CERAMICO PISO INTERNO PLACAS 60X60CM, ARGAMASSA ACII',unit:'M2',price:68.50,type:'SERVICO'},
            {code:'92264',desc:'REVESTIMENTO CERAMICO PAREDE INTERNA PLACAS 33X45CM, ARGAMASSA ACII',unit:'M2',price:55.80,type:'SERVICO'},
            {code:'94964',desc:'CONCRETO USINADO BOMBEAVEL FCK=25MPA',unit:'M3',price:445.00,type:'SERVICO'},
            {code:'94965',desc:'CONCRETO USINADO BOMBEAVEL FCK=30MPA',unit:'M3',price:475.00,type:'SERVICO'},
            {code:'92791',desc:'ARMACAO ACO CA-50 DIAM 8,0 A 12,5MM, CORTE, DOBRA E MONTAGEM',unit:'KG',price:11.85,type:'SERVICO'},
            {code:'92793',desc:'FORMA MADEIRA ESTRUTURAS CONCRETO ARMADO, REAPROVEIT 3X',unit:'M2',price:78.50,type:'SERVICO'},
            {code:'96546',desc:'IMPERMEABILIZACAO MANTA ASFALTICA 3MM TIPO II, INCLUSO PRIMER',unit:'M2',price:72.80,type:'SERVICO'},
            {code:'94213',desc:'LIMPEZA PERMANENTE DA OBRA',unit:'M2',price:1.10,type:'SERVICO'},
            {code:'73948/4',desc:'PLACA DE OBRA EM CHAPA DE ACO GALVANIZADO',unit:'M2',price:295.00,type:'SERVICO'},
            {code:'97622',desc:'PONTO DE ILUMINACAO RESIDENCIAL COM INTERRUPTOR SIMPLES',unit:'UN',price:85.50,type:'SERVICO'},
            {code:'97631',desc:'PONTO DE TOMADA RESIDENCIAL 2P+T 10A',unit:'UN',price:72.00,type:'SERVICO'},
            {code:'89357',desc:'INSTALACAO PONTO AGUA FRIA PVC SOLDAVEL DN 25MM',unit:'UN',price:110.00,type:'SERVICO'},
            {code:'89707',desc:'INSTALACAO PONTO ESGOTO PVC DN 100MM',unit:'UN',price:95.00,type:'SERVICO'},
            {code:'86906',desc:'INSTALACAO VASO SANITARIO COM CAIXA ACOPLADA INCLUSO ACESSORIOS',unit:'UN',price:145.00,type:'SERVICO'},
            {code:'97063',desc:'COBERTURA TELHA CERAMICA COLONIAL, INCLUSO MADEIRAMENTO',unit:'M2',price:95.00,type:'SERVICO'},
            {code:'95241',desc:'PORTA MADEIRA SEMI-OCA 80X210CM INCLUSO MARCO E FERRAGENS',unit:'UN',price:485.00,type:'SERVICO'},
            {code:'94570',desc:'JANELA ALUMINIO CORRER 2 FOLHAS VIDRO 4MM 120X120CM',unit:'UN',price:620.00,type:'SERVICO'},
            {code:'93358',desc:'ESCAVACAO MANUAL DE VALA ATE 1,5M',unit:'M3',price:52.00,type:'SERVICO'},
            {code:'93382',desc:'REGULARIZACAO E COMPACTACAO DE TERRENO, MANUAL',unit:'M2',price:4.80,type:'SERVICO'},
            {code:'96995',desc:'CALCADA CONCRETO FCK=15MPA ESP=7CM COM JUNTA DE DILATACAO',unit:'M2',price:48.50,type:'SERVICO'},
            {code:'96996',desc:'CONTRAPISO ARGAMASSA TRACO 1:3 ESP=3CM',unit:'M2',price:22.00,type:'SERVICO'},
          ]},
          'SEINFRA-CE': { name: 'SEINFRA', uf: 'CE', version: '028.1', items: [
            {code:'C0010',desc:'PLACA DE IDENTIFICACAO DE OBRA (MODELO PADRAO SEINFRA)',unit:'M2',price:310.00,type:'SERVICO'},
            {code:'C0054',desc:'ALVENARIA TIJOLO CERAMICO FURADO 9X19X19CM, E=10CM',unit:'M2',price:47.50,type:'SERVICO'},
            {code:'C0058',desc:'ALVENARIA BLOCO CERAMICO 14X19X39CM, E=14CM',unit:'M2',price:55.80,type:'SERVICO'},
            {code:'C0102',desc:'CHAPISCO COM ARGAMASSA 1:3 (CIMENTO E AREIA GROSSA)',unit:'M2',price:4.50,type:'SERVICO'},
            {code:'C0106',desc:'REBOCO COM ARGAMASSA 1:2:8 ESP=2CM',unit:'M2',price:26.80,type:'SERVICO'},
            {code:'C0152',desc:'PISO CERAMICO 43X43CM ASSENTADO COM ARGAMASSA ACII',unit:'M2',price:62.00,type:'SERVICO'},
            {code:'C0160',desc:'REVESTIMENTO CERAMICO PAREDE 33X45CM COM ARGAMASSA ACII',unit:'M2',price:52.00,type:'SERVICO'},
            {code:'C0200',desc:'PINTURA LATEX ACRILICA 2 DEMAOS SOBRE MASSA CORRIDA',unit:'M2',price:17.20,type:'SERVICO'},
            {code:'C0210',desc:'PINTURA ESMALTE SINTETICO 2 DEMAOS',unit:'M2',price:22.50,type:'SERVICO'},
            {code:'C0304',desc:'CONCRETO USINADO FCK=25MPA LANCAMENTO COM BOMBA',unit:'M3',price:460.00,type:'SERVICO'},
            {code:'C0350',desc:'ARMACAO ACO CA-50 CORTE DOBRA E MONTAGEM',unit:'KG',price:12.50,type:'SERVICO'},
            {code:'C0360',desc:'FORMA DE MADEIRA PARA CONCRETO ARMADO',unit:'M2',price:82.00,type:'SERVICO'},
            {code:'C0400',desc:'COBERTURA TELHA CERAMICA COLONIAL INCLUSO ESTRUTURA MADEIRA',unit:'M2',price:98.00,type:'SERVICO'},
            {code:'C0500',desc:'INSTALACAO PONTO AGUA FRIA PVC SOLDAVEL DN 25MM',unit:'UN',price:115.00,type:'SERVICO'},
            {code:'C0510',desc:'INSTALACAO PONTO ESGOTO PVC DN 100MM',unit:'UN',price:98.00,type:'SERVICO'},
            {code:'C0600',desc:'PONTO DE ILUMINACAO COM INTERRUPTOR SIMPLES',unit:'UN',price:88.00,type:'SERVICO'},
            {code:'C0610',desc:'PONTO DE TOMADA 2P+T 10A, 600V',unit:'UN',price:75.00,type:'SERVICO'},
            {code:'C0700',desc:'PORTA MADEIRA SEMI-OCA 80X210CM COM MARCO BATENTE E FERRAGENS',unit:'UN',price:495.00,type:'SERVICO'},
            {code:'C0710',desc:'JANELA ALUMINIO CORRER 2 FOLHAS VIDRO 4MM 120X120CM',unit:'UN',price:640.00,type:'SERVICO'},
            {code:'C0800',desc:'IMPERMEABILIZACAO MANTA ASFALTICA 3MM TIPO II',unit:'M2',price:75.00,type:'SERVICO'},
            {code:'C0900',desc:'ESCAVACAO MANUAL VALA ATE 1,5M PROFUNDIDADE',unit:'M3',price:55.00,type:'SERVICO'},
            {code:'C0910',desc:'ATERRO COMPACTADO COM MATERIAL DA ESCAVACAO',unit:'M3',price:18.00,type:'SERVICO'},
            {code:'C1000',desc:'CONTRAPISO ARGAMASSA 1:3 ESP=3CM',unit:'M2',price:23.50,type:'SERVICO'},
            {code:'C1010',desc:'CALCADA CONCRETO FCK=15MPA ESP=7CM',unit:'M2',price:50.00,type:'SERVICO'},
            {code:'C1050',desc:'LIMPEZA FINAL DA OBRA',unit:'M2',price:3.50,type:'SERVICO'},
          ]}
        };

        const results: Record<string, number> = {};

        for (const [key, cfg] of Object.entries(ITEMS)) {
            let db = await prisma.engineeringDatabase.findFirst({
                where: { name: cfg.name, uf: cfg.uf, type: 'OFICIAL' }
            });
            if (db) {
                await prisma.engineeringItem.deleteMany({ where: { databaseId: db.id } });
            } else {
                db = await prisma.engineeringDatabase.create({
                    data: { name: cfg.name, uf: cfg.uf, version: cfg.version, type: 'OFICIAL' }
                });
            }
            // Create basic items (MATERIAL, MAO_DE_OBRA, EQUIPAMENTO)
            const basicItems = cfg.items.filter(it => it.type !== 'SERVICO');
            const serviceItems = cfg.items.filter(it => it.type === 'SERVICO');

            const r = await prisma.engineeringItem.createMany({
                data: basicItems.map(it => ({
                    databaseId: db!.id, code: it.code, description: it.desc,
                    unit: it.unit, price: it.price, type: it.type
                })),
                skipDuplicates: true,
            });

            // Create compositions for SERVICO items (these are the real compositions)
            // They need to be in EngineeringComposition for the CompositionDrawer to find them
            await prisma.engineeringComposition.deleteMany({ where: { databaseId: db!.id } });
            let compCount = 0;
            for (const svc of serviceItems) {
                try {
                    await prisma.engineeringComposition.create({
                        data: {
                            databaseId: db!.id,
                            code: svc.code,
                            description: svc.desc,
                            unit: svc.unit,
                            totalPrice: svc.price,
                        }
                    });
                    compCount++;
                } catch (e: any) {
                    // Skip duplicates
                    if (!e.message?.includes('Unique constraint')) {
                        console.warn(`[Seed] Composição ${svc.code} erro: ${e.message}`);
                    }
                }
            }
            results[key] = r.count + compCount;
            console.log(`[Seed] ${key}: ${r.count} insumos + ${compCount} composições`);
        }

        const totalItems = Object.values(results).reduce((s, v) => s + v, 0);
        res.json({ message: `Seed concluído: ${totalItems} itens em ${Object.keys(results).length} bases`, details: results });

    } catch (e: any) {
        console.error('Error seeding engineering bases:', e);
        res.status(500).json({ error: 'Erro ao popular bases de engenharia', details: e.message });
    }
});

// ═══════════════════════════════════════════════════════════
// POST /api/engineering/bases/import — Importar planilha Excel oficial
// Aceita SINAPI, SEINFRA, SICRO, ORSE ou qualquer planilha com
// colunas: Código, Descrição, Unidade, Preço
// ═══════════════════════════════════════════════════════════
import multer from 'multer';
import * as XLSX from 'xlsx';

const xlsUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } }); // 50MB

router.post('/bases/import', xlsUpload.single('file'), async (req: any, res: any) => {
    try {
        if (req.user?.role !== 'SUPER_ADMIN' && req.user?.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Acesso restrito a administradores' });
        }

        if (!req.file) return res.status(400).json({ error: 'Nenhum arquivo enviado' });

        const { baseName, uf, version } = req.body;
        if (!baseName) return res.status(400).json({ error: 'baseName é obrigatório (ex: SINAPI, SEINFRA)' });

        console.log(`[Eng Import] Parsing ${req.file.originalname} (${(req.file.size / 1024).toFixed(0)} KB)...`);

        // Parse Excel
        const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        const allItems: { code: string; description: string; unit: string; price: number; type: string }[] = [];

        // Process each sheet
        for (const sheetName of workbook.SheetNames) {
            const sheet = workbook.Sheets[sheetName];
            const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
            if (rows.length < 2) continue;

            // Smart column detection: find header row
            let headerRowIdx = -1;
            let colMap: Record<string, number> = {};

            for (let i = 0; i < Math.min(rows.length, 15); i++) {
                const row = rows[i].map((c: any) => String(c).trim().toUpperCase());
                const codeIdx = row.findIndex((c: string) => c.includes('CODIGO') || c.includes('CÓDIGO') || c === 'COD' || c === 'CÓDIGO SINAPI' || c === 'CÓDIGO SEINFRA');
                const descIdx = row.findIndex((c: string) => c.includes('DESCRI') || c.includes('DESCRIÇÃO') || c.includes('DESCRIÇÃO DO INSUMO') || c.includes('DESCRIÇÃO DO SERVIÇO'));
                const unitIdx = row.findIndex((c: string) => c.includes('UNID') || c === 'UN' || c === 'UND' || c.includes('UNIDADE'));
                const priceIdx = row.findIndex((c: string) => c.includes('PRECO') || c.includes('PREÇO') || c.includes('CUSTO') || c.includes('VALOR') || c.includes('PREÇO UNITÁRIO') || c.includes('MEDIANA'));

                if (codeIdx >= 0 && descIdx >= 0 && priceIdx >= 0) {
                    headerRowIdx = i;
                    colMap = { code: codeIdx, desc: descIdx, unit: unitIdx >= 0 ? unitIdx : -1, price: priceIdx };
                    break;
                }
            }

            if (headerRowIdx < 0) {
                console.log(`[Eng Import] Sheet "${sheetName}": header não encontrado, pulando...`);
                continue;
            }

            console.log(`[Eng Import] Sheet "${sheetName}": header na linha ${headerRowIdx + 1}, ${rows.length - headerRowIdx - 1} data rows`);

            // Parse data rows
            for (let i = headerRowIdx + 1; i < rows.length; i++) {
                const row = rows[i];
                const code = String(row[colMap.code] ?? '').trim();
                const desc = String(row[colMap.desc] ?? '').trim();
                const unit = colMap.unit >= 0 ? String(row[colMap.unit] ?? '').trim().toUpperCase() : 'UN';
                const rawPrice = row[colMap.price];

                if (!code || !desc || code.length < 2) continue;

                // Parse price (handles "1.234,56" and "1234.56" formats)
                let price = 0;
                if (typeof rawPrice === 'number') {
                    price = rawPrice;
                } else if (rawPrice) {
                    const cleaned = String(rawPrice).replace(/[^\d.,\-]/g, '');
                    // Brazilian format: 1.234,56 → detect by comma before end
                    if (cleaned.includes(',') && (!cleaned.includes('.') || cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.'))) {
                        price = parseFloat(cleaned.replace(/\./g, '').replace(',', '.')) || 0;
                    } else {
                        price = parseFloat(cleaned.replace(/,/g, '')) || 0;
                    }
                }

                if (price <= 0) continue;

                // Infer type from description or unit
                let type = 'SERVICO';
                const descUpper = desc.toUpperCase();
                if (['H', 'HORA', 'MES', 'DIA'].includes(unit) && (descUpper.includes('PEDREIRO') || descUpper.includes('SERVENTE') || descUpper.includes('MESTRE') || descUpper.includes('ELETRICISTA') || descUpper.includes('ENCANADOR') || descUpper.includes('PINTOR') || descUpper.includes('CARPINTEIRO') || descUpper.includes('ARMADOR') || descUpper.includes('SOLDADOR'))) {
                    type = 'MAO_DE_OBRA';
                } else if (['KG', 'L', 'M', 'UN', 'M2', 'M3', 'SC', 'PCT', 'PC', 'GL', 'LT', 'TN', 'CJ'].includes(unit) && price < 500 && !descUpper.includes('INSTALACAO') && !descUpper.includes('ASSENTAMENTO') && !descUpper.includes('EXECUCAO')) {
                    type = 'MATERIAL';
                } else if (descUpper.includes('BETONEIRA') || descUpper.includes('CAMINHAO') || descUpper.includes('RETROESCAVADEIRA') || descUpper.includes('COMPACTADOR') || descUpper.includes('GUINDASTE') || descUpper.includes('VIBRADOR')) {
                    type = 'EQUIPAMENTO';
                }

                allItems.push({ code, description: desc, unit: unit || 'UN', price, type });
            }
        }

        if (allItems.length === 0) {
            return res.status(400).json({ error: 'Nenhum item válido encontrado na planilha. Verifique se há colunas de Código, Descrição e Preço.' });
        }

        console.log(`[Eng Import] Total de ${allItems.length} itens válidos extraídos. Inserindo no banco...`);

        // Upsert database
        let db = await prisma.engineeringDatabase.findFirst({
            where: { name: baseName.toUpperCase(), uf: uf?.toUpperCase() || null, type: 'OFICIAL' }
        });

        if (db) {
            await prisma.engineeringItem.deleteMany({ where: { databaseId: db.id } });
            await prisma.engineeringDatabase.update({ where: { id: db.id }, data: { version: version || new Date().toISOString().substring(0, 7) } });
            console.log(`[Eng Import] Base existente "${db.name} ${db.uf}" limpa e atualizada.`);
        } else {
            db = await prisma.engineeringDatabase.create({
                data: { name: baseName.toUpperCase(), uf: uf?.toUpperCase() || null, version: version || new Date().toISOString().substring(0, 7), type: 'OFICIAL' }
            });
            console.log(`[Eng Import] Nova base "${db.name} ${db.uf}" criada.`);
        }

        // Bulk insert in batches of 1000
        const BATCH = 1000;
        let insertedItems = 0;
        
        const basicItems = allItems.filter(it => it.type !== 'SERVICO');
        const serviceItems = allItems.filter(it => it.type === 'SERVICO');

        for (let i = 0; i < basicItems.length; i += BATCH) {
            const batch = basicItems.slice(i, i + BATCH);
            const result = await prisma.engineeringItem.createMany({
                data: batch.map(it => ({ databaseId: db!.id, ...it })),
                skipDuplicates: true,
            });
            insertedItems += result.count;
        }

        // Bulk insert compositions
        await prisma.engineeringComposition.deleteMany({ where: { databaseId: db!.id } });
        let insertedComps = 0;
        for (let i = 0; i < serviceItems.length; i += BATCH) {
            const batch = serviceItems.slice(i, i + BATCH);
            for (const svc of batch) {
                try {
                    await prisma.engineeringComposition.create({
                        data: {
                            databaseId: db!.id,
                            code: svc.code,
                            description: svc.description,
                            unit: svc.unit,
                            totalPrice: svc.price,
                        }
                    });
                    insertedComps++;
                } catch (e: any) {
                    if (!e.message?.includes('Unique constraint')) {
                        console.warn(`[Eng Import] Composição ${svc.code} erro: ${e.message}`);
                    }
                }
            }
        }

        const stats = {
            MATERIAL: allItems.filter(i => i.type === 'MATERIAL').length,
            MAO_DE_OBRA: allItems.filter(i => i.type === 'MAO_DE_OBRA').length,
            EQUIPAMENTO: allItems.filter(i => i.type === 'EQUIPAMENTO').length,
            SERVICO: allItems.filter(i => i.type === 'SERVICO').length,
            Total: insertedItems + insertedComps
        };

        console.log(`[Eng Import] ✅ Concluído! ${stats.Total} itens na base "${db.name} ${db.uf}".`);

        res.json({
            message: `Importação concluída: ${stats.Total} itens na base ${db.name} ${db.uf || ''}`,
            databaseId: db.id,
            totalParsed: allItems.length,
            totalInserted: stats.Total,
            breakdown: stats,
            sheets: workbook.SheetNames,
        });

    } catch (e: any) {
        console.error('[Eng Import] Error:', e);
        res.status(500).json({ error: 'Erro na importação', details: e.message });
    }
});

// ═══════════════════════════════════════════════════════════
// POST /api/engineering/bases/sync-sinapi
// Trigger SINAPI auto-download & import (Admin only)
// ═══════════════════════════════════════════════════════════
import { syncSinapi, importFromBuffer as importSinapiFromBuffer } from '../services/engineering/sinapiCrawler';
import { getLatestOrsePeriods, hydrateOrseCompositionDetails, searchOrseInsumos, searchOrseServices, syncOrse } from '../services/engineering/orseCrawler';
import { getLatestSicorPublications, getSicorRegions, hasConfiguredSicorAuthToken, syncSicorMg, validateSicorAuthToken } from '../services/engineering/sicorMgSync';

router.post('/bases/sync-sinapi', async (req: any, res: any) => {
    try {
        if (req.user?.role !== 'SUPER_ADMIN' && req.user?.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Acesso restrito a administradores' });
        }

        const { ufs = ['CE'], months = 12, includeDesonerado = true } = req.body;

        console.log(`[SINAPI Sync] 🚀 Admin ${req.user?.email} disparou sync: UFs=${ufs.join(',')}, meses=${months}, desonerado=${includeDesonerado}`);

        // Run in background — don't block the HTTP response
        res.json({
            message: `Sync SINAPI iniciado em background para ${ufs.join(', ')} (${months} meses, ${includeDesonerado ? 'Onerado+Desonerado' : 'Apenas Onerado'})`,
            status: 'started',
        });

        // Fire and forget
        syncSinapi({ ufs, months, includeDesonerado }).then(report => {
            console.log(`[SINAPI Sync] 🏁 Relatório final: ${report.totalSuccess}/${report.totalAttempted} sucesso em ${report.finished}`);
        }).catch(err => {
            console.error(`[SINAPI Sync] ❌ Erro fatal:`, err);
        });

    } catch (e: any) {
        console.error('[SINAPI Sync] Error:', e);
        res.status(500).json({ error: 'Erro ao iniciar sync', details: e.message });
    }
});

// ═══════════════════════════════════════════════════════════
// POST /api/engineering/bases/sync-sicro
// Trigger SICRO (DNIT) auto-download & import (Admin only)
// ═══════════════════════════════════════════════════════════
import { syncSicro } from '../services/engineering/sicroCrawler';

router.post('/bases/sync-sicro', async (req: any, res: any) => {
    try {
        if (req.user?.role !== 'SUPER_ADMIN' && req.user?.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Acesso restrito a administradores' });
        }

        const { ufs = ['ALL'], months = 12 } = req.body;

        console.log(`[SICRO Sync] 🚀 Admin ${req.user?.email} disparou sync SICRO: UFs=${Array.isArray(ufs) ? ufs.join(',') : ufs}, meses=${months}`);

        res.json({
            message: `Sync SICRO iniciado em background para ${Array.isArray(ufs) ? ufs.join(', ') : 'Todos os estados'} (${months} meses)`,
            status: 'started',
        });

        // Fire and forget
        syncSicro({ ufs: Array.isArray(ufs) ? ufs : ['ALL'], months }).then(report => {
            console.log(`[SICRO Sync] 🏁 Relatório final: ${report.totalSuccess}/${report.totalAttempted} sucesso em ${report.finished}`);
        }).catch(err => {
            console.error(`[SICRO Sync] ❌ Erro fatal:`, err);
        });

    } catch (e: any) {
        console.error('[SICRO Sync] Error:', e);
        res.status(500).json({ error: 'Erro ao iniciar sync SICRO', details: e.message });
    }
});

// ═══════════════════════════════════════════════════════════
// POST /api/engineering/bases/sync-sbc
// Trigger SBC (Informativo SBC) auto-download & import (Admin only)
// Credentials from env: SBC_EMAIL, SBC_PASSWORD
// ═══════════════════════════════════════════════════════════
import { syncSbc, getSbcRegions } from '../services/engineering/sbcCrawler';

router.post('/bases/sync-sbc', async (req: any, res: any) => {
    try {
        if (req.user?.role !== 'SUPER_ADMIN' && req.user?.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Acesso restrito a administradores' });
        }

        const sbcEmail = process.env.SBC_EMAIL;
        const sbcPassword = process.env.SBC_PASSWORD;
        if (!sbcEmail || !sbcPassword) {
            return res.status(400).json({ error: 'Credenciais SBC não configuradas. Defina SBC_EMAIL e SBC_PASSWORD nas variáveis de ambiente.' });
        }

        const { regions = ['ALL'], months = 12 } = req.body;

        console.log(`[SBC Sync] 🚀 Admin ${req.user?.email} disparou sync SBC: Regiões=${Array.isArray(regions) ? regions.join(',') : regions}, meses=${months}`);

        res.json({
            message: `Sync SBC iniciado em background para ${Array.isArray(regions) && regions.includes('ALL') ? 'Todas as 30 regiões' : (Array.isArray(regions) ? regions.join(', ') : regions)} (${months} meses)`,
            status: 'started',
        });

        // Fire and forget
        syncSbc({ regions: Array.isArray(regions) ? regions : ['ALL'], months, email: sbcEmail, password: sbcPassword }).then(report => {
            console.log(`[SBC Sync] 🏁 Relatório final: ${report.totalSuccess}/${report.totalAttempted} sucesso em ${report.finished}`);
        }).catch(err => {
            console.error(`[SBC Sync] ❌ Erro fatal:`, err);
        });

    } catch (e: any) {
        console.error('[SBC Sync] Error:', e);
        res.status(500).json({ error: 'Erro ao iniciar sync SBC', details: e.message });
    }
});

router.get('/bases/sbc/regions', async (_req: any, res: any) => {
    res.json({ regions: getSbcRegions() });
});

// ═══════════════════════════════════════════════════════════
// POST /api/engineering/bases/sync-caern
// Trigger CAERN (RN) auto-download & import (Admin only)
// Public access — no credentials needed
// ═══════════════════════════════════════════════════════════
import { syncCaern } from '../services/engineering/caernCrawler';

router.post('/bases/sync-caern', async (req: any, res: any) => {
    try {
        if (req.user?.role !== 'SUPER_ADMIN' && req.user?.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Acesso restrito a administradores' });
        }

        const currentYear = new Date().getFullYear();
        const { years = [currentYear, currentYear - 1, currentYear - 2] } = req.body;

        console.log(`[CAERN Sync] 🚀 Admin ${req.user?.email} disparou sync CAERN: Anos=${Array.isArray(years) ? years.join(',') : years}`);

        res.json({
            message: `Sync CAERN iniciado em background para anos ${Array.isArray(years) ? years.join(', ') : years}`,
            status: 'started',
        });

        // Fire and forget
        syncCaern({ years: Array.isArray(years) ? years : [currentYear, currentYear - 1, currentYear - 2] }).then(report => {
            console.log(`[CAERN Sync] 🏁 Relatório final: ${report.totalSuccess}/${report.totalAttempted} sucesso em ${report.finished}`);
        }).catch(err => {
            console.error(`[CAERN Sync] ❌ Erro fatal:`, err);
        });

    } catch (e: any) {
        console.error('[CAERN Sync] Error:', e);
        res.status(500).json({ error: 'Erro ao iniciar sync CAERN', details: e.message });
    }
});

// ═══════════════════════════════════════════════════════════
// ORSE official base sync + live search
// Uses the public ORSE service search by period because .ORSE update
// packages are proprietary binary files from the desktop ORSE system.
// ═══════════════════════════════════════════════════════════
router.get('/bases/orse/periods', async (req: any, res: any) => {
    try {
        const months = Math.max(1, Math.min(Number(req.query.months || 12), 24));
        const periods = await getLatestOrsePeriods(months);
        res.json({ periods });
    } catch (e: any) {
        console.error('[ORSE Periods] Error:', e);
        res.status(500).json({ error: 'Erro ao listar períodos ORSE', details: e.message });
    }
});

router.get('/bases/orse/search', async (req: any, res: any) => {
    try {
        let period = String(req.query.period || '');
        if (!period) {
            const periods = await getLatestOrsePeriods(1);
            period = String(periods[0]?.value || '');
        }
        if (!period) return res.status(404).json({ error: 'Nenhum período ORSE disponível' });

        const q = String(req.query.q || '');
        const page = Math.max(1, Number(req.query.page || 1));
        const result = await searchOrseServices(period, q, page);
        res.json(result);
    } catch (e: any) {
        console.error('[ORSE Search] Error:', e);
        res.status(500).json({ error: 'Erro na busca ORSE', details: e.message });
    }
});

router.get('/bases/orse/insumos/search', async (req: any, res: any) => {
    try {
        let period = String(req.query.period || '');
        if (!period) {
            const periods = await getLatestOrsePeriods(1);
            period = String(periods[0]?.value || '');
        }
        if (!period) return res.status(404).json({ error: 'Nenhum período ORSE disponível' });

        const q = String(req.query.q || '');
        const page = Math.max(1, Number(req.query.page || 1));
        const groupId = String(req.query.groupId || '0');
        const result = await searchOrseInsumos(period, q, page, groupId);
        res.json(result);
    } catch (e: any) {
        console.error('[ORSE Inputs Search] Error:', e);
        res.status(500).json({ error: 'Erro na busca de insumos ORSE', details: e.message });
    }
});

router.post('/bases/sync-orse', async (req: any, res: any) => {
    try {
        if (req.user?.role !== 'SUPER_ADMIN' && req.user?.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Acesso restrito a administradores' });
        }

        const months = Math.max(1, Math.min(Number(req.body?.months || 12), 24));
        const force = Boolean(req.body?.force);
        const maxPagesPerPeriod = req.body?.maxPagesPerPeriod ? Number(req.body.maxPagesPerPeriod) : undefined;

        console.log(`[ORSE Sync] Admin ${req.user?.email} disparou sync: meses=${months}, force=${force}`);

        res.json({
            message: `Sync ORSE iniciado em background para os últimos ${months} períodos disponíveis`,
            status: 'started',
        });

        syncOrse({ months, force, maxPagesPerPeriod }).then(report => {
            console.log(`[ORSE Sync] Relatório final: ${report.totalSuccess}/${report.totalAttempted} sucesso em ${report.finished}`);
        }).catch(err => {
            console.error('[ORSE Sync] Erro fatal:', err);
        });
    } catch (e: any) {
        console.error('[ORSE Sync] Error:', e);
        res.status(500).json({ error: 'Erro ao iniciar sync ORSE', details: e.message });
    }
});

// ═══════════════════════════════════════════════════════════
// SICOR-MG official base sync
// Uses DER-MG SCO Portal endpoints. These endpoints require the same
// bearer token used by the official Portal de Serviços session.
// ═══════════════════════════════════════════════════════════
router.get('/bases/sicor-mg/status', async (req: any, res: any) => {
    try {
        if (req.user?.role !== 'SUPER_ADMIN' && req.user?.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Acesso restrito a administradores' });
        }

        const hasCredentials = Boolean(
            (process.env.SICOR_MG_CNPJ || process.env.DER_MG_CNPJ || '').trim() &&
            (process.env.SICOR_MG_SENHA || process.env.DER_MG_SENHA || '').trim()
        );

        res.json({
            tokenConfigured: hasConfiguredSicorAuthToken(),
            authMethod: hasCredentials ? 'auto-login' : (hasConfiguredSicorAuthToken() ? 'static-token' : 'none'),
            envNames: ['SICOR_MG_CNPJ + SICOR_MG_SENHA (recomendado)', 'SICOR_MG_TOKEN (alternativo)'],
            requiresToken: !hasConfiguredSicorAuthToken(),
            portalUrl: 'https://portal.der.mg.gov.br/sco-portal/',
            instructions: hasConfiguredSicorAuthToken()
                ? 'Autenticação configurada. O sistema renova o token automaticamente.'
                : 'Configure SICOR_MG_CNPJ e SICOR_MG_SENHA no Railway para login automático, ou passe um Bearer token via X-Sicor-Token header.',
        });
    } catch (e: any) {
        logger.error('[SICOR-MG Status] Error:', e?.message);
        res.status(500).json({ error: 'Erro ao consultar configuração SICOR-MG', details: e.message });
    }
});

router.get('/bases/sicor-mg/regions', async (req: any, res: any) => {
    try {
        if (req.user?.role !== 'SUPER_ADMIN' && req.user?.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Acesso restrito a administradores' });
        }
        const authToken = String(req.headers['x-sicor-token'] || req.query.authToken || '') || undefined;
        const regions = await getSicorRegions(authToken);
        res.json({ regions });
    } catch (e: any) {
        logger.error('[SICOR-MG Regions] Error:', e?.message);
        res.status(500).json({ error: 'Erro ao listar regiões SICOR-MG', details: e.message });
    }
});

router.get('/bases/sicor-mg/periods', async (req: any, res: any) => {
    try {
        if (req.user?.role !== 'SUPER_ADMIN' && req.user?.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Acesso restrito a administradores' });
        }
        const authToken = String(req.headers['x-sicor-token'] || req.query.authToken || '') || undefined;
        const months = Math.max(1, Math.min(Number(req.query.months || 12), 24));
        const regionCodes = req.query.regionCodes
            ? String(req.query.regionCodes).split(',').map(value => value.trim()).filter(Boolean)
            : undefined;
        const publications = await getLatestSicorPublications({ authToken, months, regionCodes });
        const periods = [...new Map(publications.map(publication => [
            `${publication.period.year}-${publication.period.month}`,
            publication.period,
        ])).values()];
        res.json({ periods, publications });
    } catch (e: any) {
        logger.error('[SICOR-MG Periods] Error:', e?.message);
        res.status(500).json({ error: 'Erro ao listar datas-base SICOR-MG', details: e.message });
    }
});

router.post('/bases/sync-sicor-mg', async (req: any, res: any) => {
    try {
        if (req.user?.role !== 'SUPER_ADMIN' && req.user?.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Acesso restrito a administradores' });
        }

        const months = Math.max(1, Math.min(Number(req.body?.months || 12), 24));
        const force = Boolean(req.body?.force);
        const rawToken = req.headers['x-sicor-token'] || req.body?.authToken || '';
        const authToken = typeof rawToken === 'string' && rawToken.trim() ? rawToken.trim() : undefined;
        const conditions = Array.isArray(req.body?.conditions) ? req.body.conditions : undefined;
        const regionCodes = Array.isArray(req.body?.regionCodes) ? req.body.regionCodes : undefined;
        const includeCompositionWorkbook = Boolean(req.body?.includeCompositionWorkbook);

        // Diagnostic: log which env vars are present (values redacted)
        const diagCnpj = (process.env.SICOR_MG_CNPJ || '').trim();
        const diagSenha = (process.env.SICOR_MG_SENHA || '').trim();
        const diagToken = (process.env.SICOR_MG_TOKEN || '').trim();
        const diagCnpjAlt = (process.env.DER_MG_CNPJ || '').trim();
        const diagSenhaAlt = (process.env.DER_MG_SENHA || '').trim();
        const diagTokenAlt = (process.env.DER_MG_SCO_TOKEN || '').trim();
        logger.info(`[SICOR-MG Sync] Auth diagnostic: SICOR_MG_CNPJ=${diagCnpj ? `set(${diagCnpj.length}ch)` : 'MISSING'}, SICOR_MG_SENHA=${diagSenha ? `set(${diagSenha.length}ch)` : 'MISSING'}, SICOR_MG_TOKEN=${diagToken ? `set(${diagToken.length}ch)` : 'MISSING'}, DER_MG_CNPJ=${diagCnpjAlt ? 'set' : 'MISSING'}, DER_MG_SENHA=${diagSenhaAlt ? 'set' : 'MISSING'}, DER_MG_SCO_TOKEN=${diagTokenAlt ? 'set' : 'MISSING'}, explicit=${authToken ? 'yes' : 'no'}`);

        validateSicorAuthToken(authToken);

        logger.info(`[SICOR-MG Sync] Admin ${req.user?.email} disparou sync: meses=${months}, force=${force}`);

        res.json({
            message: `Sync SICOR-MG iniciado em background para as últimas ${months} datas-base`,
            status: 'started',
        });

        syncSicorMg({ months, force, authToken, conditions, regionCodes, includeCompositionWorkbook }).then(report => {
            logger.info(`[SICOR-MG Sync] Relatório final: ${report.totalSuccess}/${report.totalAttempted} sucesso em ${report.finished}`);
        }).catch(err => {
            logger.error('[SICOR-MG Sync] Erro fatal:', err?.message);
        });
    } catch (e: any) {
        logger.error('[SICOR-MG Sync] Error:', e?.message);
        const missingToken = String(e.message || '').includes('Token SICOR-MG ausente');
        res.status(missingToken ? 400 : 500).json({
            error: missingToken ? 'Token SICOR-MG não configurado' : 'Erro ao iniciar sync SICOR-MG',
            details: e.message,
            instructions: missingToken
                ? 'Configure SICOR_MG_CNPJ e SICOR_MG_SENHA no Railway para login automático, ou envie um Bearer token via header X-Sicor-Token.'
                : undefined,
        });
    }
});

// ═══════════════════════════════════════════════════════════
// POST /api/engineering/bases/scrape-seinfra
// Scrape SEINFRA-CE SIPROCE portal and populate database
// ═══════════════════════════════════════════════════════════
router.post('/bases/scrape-seinfra', async (req: any, res: any) => {
    try {
        if (req.user?.role !== 'SUPER_ADMIN' && req.user?.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Acesso restrito a administradores' });
        }

        const requestedRegime = String(req.body?.regime || 'ambas').toLowerCase();
        const regimes: SeinfraRegime[] = requestedRegime === 'onerada'
            ? ['onerada']
            : requestedRegime === 'desonerada'
                ? ['desonerada']
                : ['onerada', 'desonerada'];

        console.log(`[SEINFRA Import] 🚀 Iniciando import SIPROCE: ${regimes.join(', ')}`);
        const summaries: any[] = [];

        for (const regime of regimes) {
            const meta = getSeinfraRegimeMeta(regime);
            const errors: string[] = [];
            console.log(`[SEINFRA Import] 📚 Processando SEINFRA ${meta.version} (${regime})...`);

            const parsed = await downloadAndParseSeinfra(regime);
            errors.push(...parsed.errors);
            const { insumos, compositions } = parsed;

            if (insumos.length === 0 && compositions.length === 0) {
                summaries.push({
                    regime,
                    version: meta.version,
                    payrollExemption: meta.payrollExemption,
                    parsed: { insumos: 0, compositions: 0 },
                    inserted: { insumos: 0, compositions: 0, compositionItems: 0 },
                    errors: errors.slice(0, 20),
                });
                continue;
            }

            let db = await prisma.engineeringDatabase.findFirst({
                where: {
                    name: 'SEINFRA',
                    uf: 'CE',
                    type: 'OFICIAL',
                    version: meta.version,
                    payrollExemption: meta.payrollExemption,
                }
            });

            if (!db) {
                db = await prisma.engineeringDatabase.create({
                    data: {
                        name: 'SEINFRA',
                        uf: 'CE',
                        version: meta.version,
                        type: 'OFICIAL',
                        payrollExemption: meta.payrollExemption,
                    }
                });
            } else {
                db = await prisma.engineeringDatabase.update({
                    where: { id: db.id },
                    data: {
                        version: meta.version,
                        payrollExemption: meta.payrollExemption,
                    }
                });
            }

            let insertedInsumos = 0;
            for (const insumo of insumos) {
                try {
                    await prisma.engineeringItem.upsert({
                        where: { databaseId_code: { databaseId: db.id, code: insumo.code } },
                        create: {
                            databaseId: db.id,
                            code: insumo.code,
                            description: insumo.description,
                            unit: insumo.unit,
                            price: insumo.price,
                            type: insumo.type,
                        },
                        update: {
                            description: insumo.description,
                            unit: insumo.unit,
                            price: insumo.price,
                            type: insumo.type,
                        },
                    });
                    insertedInsumos++;
                } catch (e: any) {
                    if (!e.message.includes('Unique constraint')) {
                        errors.push(`Insumo ${insumo.code}: ${e.message}`);
                    }
                }
            }

            let insertedComps = 0;
            let insertedCompItems = 0;
            for (const comp of compositions) {
                try {
                    const dbComp = await prisma.engineeringComposition.upsert({
                        where: { databaseId_code: { databaseId: db.id, code: comp.code } },
                        create: {
                            databaseId: db.id,
                            code: comp.code,
                            description: comp.description,
                            unit: comp.unit,
                            totalPrice: comp.totalPrice,
                        },
                        update: {
                            description: comp.description,
                            unit: comp.unit,
                            totalPrice: comp.totalPrice,
                        },
                    });

                    await prisma.engineeringCompositionItem.deleteMany({
                        where: { compositionId: dbComp.id }
                    });

                    for (const item of comp.items) {
                        let itemId: string | null = null;
                        let auxCompId: string | null = null;

                        if (item.isComposition) {
                            const auxComp = await prisma.engineeringComposition.findFirst({
                                where: { databaseId: db.id, code: item.insumoCode }
                            });
                            auxCompId = auxComp?.id || null;
                        } else {
                            const dbItem = await prisma.engineeringItem.findFirst({
                                where: { databaseId: db.id, code: item.insumoCode }
                            });
                            itemId = dbItem?.id || null;
                        }

                        await prisma.engineeringCompositionItem.create({
                            data: {
                                compositionId: dbComp.id,
                                itemId,
                                auxiliaryCompositionId: auxCompId,
                                coefficient: item.coefficient,
                                price: item.totalPrice,
                            },
                        });
                        insertedCompItems++;
                    }

                    insertedComps++;
                } catch (e: any) {
                    errors.push(`Composition ${comp.code}: ${e.message}`);
                }
            }

            const [itemCount, compositionCount] = await Promise.all([
                prisma.engineeringItem.count({ where: { databaseId: db.id } }),
                prisma.engineeringComposition.count({ where: { databaseId: db.id } }),
            ]);
            await prisma.engineeringDatabase.update({
                where: { id: db.id },
                data: { itemCount, compositionCount },
            });

            console.log(`[SEINFRA Import] 🏁 ${regime}: ${insertedInsumos} insumos, ${insertedComps} composições, ${insertedCompItems} itens`);
            summaries.push({
                regime,
                version: meta.version,
                payrollExemption: meta.payrollExemption,
                databaseId: db.id,
                parsed: { insumos: insumos.length, compositions: compositions.length },
                inserted: { insumos: insertedInsumos, compositions: insertedComps, compositionItems: insertedCompItems },
                counts: { items: itemCount, compositions: compositionCount },
                errors: errors.slice(0, 20),
            });
        }

        const totalInserted = summaries.reduce((sum, s) => sum + (s.inserted?.insumos || 0) + (s.inserted?.compositions || 0), 0);
        res.json({
            message: totalInserted > 0
                ? `SEINFRA importada por regime: ${summaries.map(s => `${s.version} ${s.regime}`).join(', ')}`
                : 'Download concluído mas nenhum dado encontrado. Verifique se o portal SIPROCE está acessível.',
            results: summaries,
        });

    } catch (e: any) {
        console.error('[SEINFRA Import] Fatal:', e);
        res.status(500).json({ error: 'Erro na importação SEINFRA', details: e.message });
    }
});

// ═══════════════════════════════════════════════════════════
// AI EXTRACTION - SMART CPU BUILDER
// ═══════════════════════════════════════════════════════════

import { extractCompositionFromImage } from '../services/ai/engineering/compositionExtractor';
const aiUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.post('/ai/extract-composition', aiUpload.single('file'), async (req: any, res: any) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Nenhum arquivo enviado' });
        }

        const { code } = req.body;
        const result = await extractCompositionFromImage(req.file.buffer, req.file.mimetype, code);
        
        res.json(result);
    } catch (e: any) {
        console.error('[AI Extract Composition] Error:', e);
        res.status(500).json({ error: 'Falha na extração por IA', details: e.message });
    }
});

// ═══════════════════════════════════════════════════════════
// POST /api/engineering/bases/import-excel
// Upload manual de planilha SINAPI/SEINFRA/ORSE/SICRO (.xlsx)
// Para quando download automático não funcionar
// ═══════════════════════════════════════════════════════════
router.post('/bases/import-excel', aiUpload.single('file'), async (req: any, res: any) => {
    try {
        if (req.user?.role !== 'SUPER_ADMIN' && req.user?.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Acesso restrito a administradores' });
        }

        if (!req.file) {
            return res.status(400).json({ error: 'Nenhum arquivo enviado' });
        }

        const { baseName, uf, month, year, desonerado } = req.body;
        if (!baseName || !uf || !month || !year) {
            return res.status(400).json({ error: 'baseName, uf, month e year são obrigatórios' });
        }

        const isDesonerado = desonerado === 'true' || desonerado === true;
        const monthNum = parseInt(month);
        const yearNum = parseInt(year);

        console.log(`[Base Import] 📥 Admin ${req.user?.email}: ${baseName} ${uf} ${monthNum}/${yearNum} ${isDesonerado ? 'Desonerado' : 'Onerado'}`);

        const result = await importSinapiFromBuffer(
            req.file.buffer,
            baseName.toUpperCase(),
            uf.toUpperCase(),
            monthNum,
            yearNum,
            isDesonerado,
        );

        res.json({
            success: result.success,
            message: result.message,
            itemCount: result.itemCount,
            compositionCount: result.compositionCount,
        });
    } catch (e: any) {
        console.error('[Base Import] Fatal:', e);
        res.status(500).json({ error: 'Erro na importação', details: e.message });
    }
});

// ═══════════════════════════════════════════════════════════
// GET /api/engineering/bases/status
// Retorna mapa de cobertura das bases oficiais
// (base × mês × regime → ✅/❌ + contadores)
// ═══════════════════════════════════════════════════════════
router.get('/bases/status', async (req: any, res: any) => {
    try {
        const bases = await prisma.engineeringDatabase.findMany({
            where: { type: 'OFICIAL' },
            select: {
                id: true,
                name: true,
                uf: true,
                version: true,
                referenceMonth: true,
                referenceYear: true,
                payrollExemption: true,
                itemCount: true,
                compositionCount: true,
                updatedAt: true,
            },
            orderBy: [
                { name: 'asc' },
                { referenceYear: 'desc' },
                { referenceMonth: 'desc' },
            ],
        });

        // Build coverage matrix: { "SINAPI-CE": { "2026-04": { onerado: {...}, desonerado: {...} } } }
        const coverage: Record<string, Record<string, Record<string, { id: string; itemCount: number; compositionCount: number; updatedAt: Date }>>> = {};

        for (const db of bases) {
            const key = `${db.name}-${db.uf || 'BR'}`;
            if (!coverage[key]) coverage[key] = {};

            const monthKey = db.referenceYear && db.referenceMonth
                ? `${db.referenceYear}-${String(db.referenceMonth).padStart(2, '0')}`
                : (db.version || 'sem-data');

            if (!coverage[key][monthKey]) coverage[key][monthKey] = {};

            const regime = db.payrollExemption ? 'desonerado' : 'onerado';
            coverage[key][monthKey][regime] = {
                id: db.id,
                itemCount: db.itemCount,
                compositionCount: db.compositionCount,
                updatedAt: db.updatedAt,
            };
        }

        // Summary stats
        const totalDatabases = bases.length;
        const totalItems = bases.reduce((sum, b) => sum + b.itemCount, 0);
        const totalCompositions = bases.reduce((sum, b) => sum + b.compositionCount, 0);
        const lastUpdated = bases.length > 0
            ? new Date(Math.max(...bases.map(b => b.updatedAt.getTime())))
            : null;

        // Check coverage for last 12 months
        const now = new Date();
        const expectedMonths: string[] = [];
        for (let i = 0; i < 12; i++) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            expectedMonths.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
        }

        const gaps: string[] = [];
        for (const [baseKey, monthData] of Object.entries(coverage)) {
            for (const month of expectedMonths) {
                if (!monthData[month]) {
                    gaps.push(`${baseKey} ${month}: FALTANDO`);
                } else {
                    if (!monthData[month].onerado) gaps.push(`${baseKey} ${month}: falta onerado`);
                    if (!monthData[month].desonerado) gaps.push(`${baseKey} ${month}: falta desonerado`);
                }
            }
        }

        res.json({
            totalDatabases,
            totalItems,
            totalCompositions,
            lastUpdated,
            coverage,
            gaps: gaps.slice(0, 50), // Max 50 gaps
            expectedMonths,
        });
    } catch (e: any) {
        console.error('[Bases Status] Error:', e);
        res.status(500).json({ error: 'Erro ao consultar status das bases', details: e.message });
    }
});

export default router;
