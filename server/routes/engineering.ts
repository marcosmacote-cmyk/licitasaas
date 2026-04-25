import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { callGeminiWithRetry } from '../services/ai/gemini.service';
import { robustJsonParse } from '../services/ai/parser.service';
import { ENGINEERING_PROPOSAL_SYSTEM_PROMPT, ENGINEERING_PROPOSAL_USER_INSTRUCTION } from '../services/ai/modules/prompts/engineeringPromptV1';
import { GoogleGenAI } from '@google/genai';
import { downloadAndParseSeinfra } from '../services/engineering/seinfra-scraper';
import { CompositionFlattener } from '../services/engineering/compositionFlattener';
import axios from 'axios';
import https from 'https';

const router = Router();
const prisma = new PrismaClient();

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

    // Prioritize engineering-relevant docs
    const scored = arquivos.map((arq: any) => {
        const name = (arq.titulo || arq.nomeArquivo || arq.nome || '').toLowerCase();
        let score = 10;
        if (/projeto.?b[aá]sico/i.test(name)) score = 1;
        if (/planilha|or[cç]amento|quantitativ/i.test(name)) score = 2;
        if (/composi[cç][aã]o|cpu|bdi/i.test(name)) score = 3;
        if (/cronograma/i.test(name)) score = 4;
        if (/edital/i.test(name)) score = 5;
        if (/memorial|especifica[cç]/i.test(name)) score = 6;
        // Exclude irrelevant files
        if (/ata|aviso|decreto|portaria|lei|certid|retifica|resultado|homologa/i.test(name)) score = 99;
        return { arq, score, name };
    }).filter(s => s.score < 99).sort((a, b) => a.score - b.score);

    // Download top 4 most relevant PDFs (budget limit)
    const MAX_PDFS = 4;
    const MAX_SIZE_KB = 12000;
    let totalSizeKB = 0;
    const pdfParts: any[] = [];

    for (const { arq, name } of scored.slice(0, MAX_PDFS + 2)) {
        if (pdfParts.length >= MAX_PDFS) break;

        let fileUrl = arq.url || arq.uri || '';
        if (fileUrl.includes('pncp-api/v1')) fileUrl = fileUrl.replace('pncp-api/v1', 'api/pncp/v1');
        if (!fileUrl) continue;

        try {
            const fileRes = await axios.get(fileUrl, {
                responseType: 'arraybuffer', httpsAgent: agent, timeout: 30000,
                maxRedirects: 5,
            } as any);
            const buffer = Buffer.from(fileRes.data as ArrayBuffer);
            const sizeKB = buffer.length / 1024;

            // Verify it's a PDF
            if (buffer[0] !== 0x25 || buffer[1] !== 0x50) {
                console.log(`[PNCP-PDF] ⏭️ "${name}" não é PDF, ignorando`);
                continue;
            }

            if (totalSizeKB + sizeKB > MAX_SIZE_KB) {
                console.log(`[PNCP-PDF] ⏭️ Budget de ${MAX_SIZE_KB}KB atingido, parando`);
                break;
            }

            totalSizeKB += sizeKB;
            pdfParts.push({ inlineData: { data: buffer.toString('base64'), mimeType: 'application/pdf' } });
            console.log(`[PNCP-PDF] ✅ "${name}" (${Math.round(sizeKB)}KB) adicionado`);
        } catch (dlErr: any) {
            console.warn(`[PNCP-PDF] ⚠️ Falha ao baixar "${name}": ${dlErr.message}`);
        }
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

        // Enrich with auxiliary compositions if any
        const enrichedItems = await Promise.all(composition.items.map(async (ci: any) => {
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
// POST /api/engineering/compositions — Criar Composição (PRÓPRIA)
// ═══════════════════════════════════════════════════════════
router.post('/compositions', async (req: any, res: any) => {
    try {
        const { code, description, unit, tenantId } = req.body;
        
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

            // Create new items
            for (const item of flatItems) {
                const isAux = !!item.auxiliaryCompositionId || (item.auxiliaryComposition && item.auxiliaryComposition.id);
                const itemId = item.item ? item.item.id : item.itemId;
                const auxId = item.auxiliaryComposition ? item.auxiliaryComposition.id : item.auxiliaryCompositionId;
                
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
        const flattener = new CompositionFlattener(bdiValue, 0.8464); // Exemplo LS 84.64%
        
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
                    items: { include: { item: true } },
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

            // Drill into each insumo of the composition
            for (const ci of composition.items) {
                if (!ci.item) continue;

                const insumoKey = ci.item.code.toUpperCase();
                const existing = consolidated.get(insumoKey);
                const weightedCoef = ci.coefficient * serviceQty;

                if (existing) {
                    existing.coeficienteTotal += weightedCoef;
                    existing.coeficientesPorComposicao.push({
                        compCode: composition.code,
                        coef: ci.coefficient,
                        qty: serviceQty,
                    });
                    if (!existing.composicoesVinculadas.includes(composition.code)) {
                        existing.composicoesVinculadas.push(composition.code);
                    }
                    // IMPORTANT: Keep the SAME price (legal requirement)
                    // If different prices found, log a warning
                    if (Math.abs(existing.precoOriginal - ci.item.price) > 0.01) {
                        console.warn(`[Insumo Hub] ⚠️ Preço divergente para ${ci.item.code}: R$${existing.precoOriginal} vs R$${ci.item.price} — usando preço da primeira ocorrência`);
                    }
                } else {
                    consolidated.set(insumoKey, {
                        id: insumoKey,
                        codigo: ci.item.code,
                        descricao: ci.item.description,
                        categoria: normalizeInsumoType(ci.item.type),
                        unidade: ci.item.unit,
                        precoOriginal: ci.item.price,
                        base: baseName,
                        composicoesVinculadas: [composition.code],
                        coeficientesPorComposicao: [{
                            compCode: composition.code,
                            coef: ci.coefficient,
                            qty: serviceQty,
                        }],
                        coeficienteTotal: weightedCoef,
                    });
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
        const { items, bdiConfig, engineeringConfig } = req.body;

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
                    sortOrder: index,
                }))
            });

            // Calculate and update proposal totals (excluding groupers)
            const totalValue = items
                .filter((it: any) => it.type !== 'ETAPA' && it.type !== 'SUBETAPA')
                .reduce((sum: number, it: any) => sum + (Number(it.totalPrice) || 0), 0);

            await tx.priceProposal.update({
                where: { id: proposalId },
                data: {
                    totalValue,
                    bdiConfig: bdiConfig || undefined,
                    engineeringConfig: engineeringConfig || undefined,
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
// Pipeline: V2 itens_licitados → AI extraction (fallback)
// ═══════════════════════════════════════════════════════════
router.post('/ai-populate', async (req: any, res: any) => {
    try {
        const { textChunk, biddingId, engineeringConfig } = req.body;
        
        let extractionText = textChunk;

        if (biddingId) {
            const bidding = await prisma.biddingProcess.findUnique({
                where: { id: biddingId },
                include: { aiAnalysis: true }
            });

            // ═══════════════════════════════════════════════════
            // PASSO 1: Tentar usar itens_licitados do V2 (JÁ extraídos pela análise PNCP)
            // Isso evita chamar a IA novamente e usa dados estruturados com códigos
            // ═══════════════════════════════════════════════════
            const schemaV2 = bidding?.aiAnalysis?.schemaV2 as any;
            const itensV2 = schemaV2?.proposal_analysis?.itens_licitados;
            
            if (Array.isArray(itensV2) && itensV2.length > 1) {
                console.log(`[Engineering AI-Populate] 🎯 Usando ${itensV2.length} itens de itens_licitados V2`);
                
                const items = await mapV2ToEngineering(itensV2);
                return res.json({ items, source: 'v2_itens_licitados', count: items.length });
            }

            // ═══════════════════════════════════════════════════
            // PASSO 2: Fallback — combinar TODAS as fontes de texto para AI extraction
            // Engenharia precisa do máximo de contexto possível
            // ═══════════════════════════════════════════════════
            const textParts: string[] = [];
            
            // Priority 1: Full summary has the most comprehensive text
            if (bidding?.aiAnalysis?.fullSummary) textParts.push(bidding.aiAnalysis.fullSummary);
            // Priority 2: Bidding items (planilha, quantitativos)
            if (bidding?.aiAnalysis?.biddingItems) textParts.push(bidding.aiAnalysis.biddingItems);
            // Priority 3: Pricing considerations (BDI, custos)
            if (bidding?.aiAnalysis?.pricingConsiderations) textParts.push(bidding.aiAnalysis.pricingConsiderations);
            // Priority 4: Required documents (pode conter referências a itens)
            if (bidding?.aiAnalysis?.requiredDocuments) textParts.push(bidding.aiAnalysis.requiredDocuments);
            
            // Priority 5: V2 structured data (serialize as context)
            if (schemaV2) {
                const v2Parts: string[] = [];
                if (schemaV2.proposal_analysis?.itens_licitados?.length > 0) {
                    v2Parts.push('ITENS LICITADOS (V2):\n' + JSON.stringify(schemaV2.proposal_analysis.itens_licitados, null, 2));
                }
                if (schemaV2.proposal_analysis?.proposta_comercial?.length > 0) {
                    v2Parts.push('PROPOSTA COMERCIAL:\n' + JSON.stringify(schemaV2.proposal_analysis.proposta_comercial, null, 2));
                }
                if (v2Parts.length > 0) textParts.push(v2Parts.join('\n\n'));
            }
            
            extractionText = textParts.join('\n\n═══════════════════════════════════════\n\n');

            console.log(`[Engineering AI-Populate] ⚠️ V2 itens_licitados insuficiente (${itensV2?.length || 0}), usando fallback IA com ${textParts.length} fontes, ${extractionText?.length || 0} chars`);
        }

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
        const extractedData = robustJsonParse(rawResponse);
        
        let items = extractedData?.engineeringItems || [];

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
                    const pdfData = robustJsonParse(pdfResult?.text || '');
                    const pdfItems = pdfData?.engineeringItems || [];
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
        await enrichWithOfficialPrices(items);

        // Auto-save composições PRÓPRIAS with insumos to the database
        const ownComps = items.filter((it: any) => it.type === 'COMPOSICAO' && it.sourceName === 'PROPRIA' && Array.isArray(it.insumos) && it.insumos.length > 0);
        if (ownComps.length > 0 && biddingId) {
            try {
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
                                for (const ins of comp.insumos) compTotal += (ins.coefficient || 0) * (ins.unitPrice || 0);
                            }
                            const compRecord = existing
                                ? await prisma.engineeringComposition.update({ where: { id: existing.id }, data: { description: comp.description, unit: comp.unit || 'UN', totalPrice: compTotal } })
                                : await prisma.engineeringComposition.create({ data: { code: comp.code || comp.item, description: comp.description, unit: comp.unit || 'UN', databaseId: propriaDb.id, totalPrice: compTotal } });

                            await prisma.engineeringCompositionItem.deleteMany({ where: { compositionId: compRecord.id } });
                            for (const ins of (comp.insumos || [])) {
                                const insCode = `INS-${comp.code || comp.item}-${saved + 1}`;
                                let insumo = await prisma.engineeringItem.findFirst({ where: { code: insCode, databaseId: propriaDb.id } });
                                if (!insumo) {
                                    const typeMap: Record<string, string> = { 'MAO_DE_OBRA': 'MAO_DE_OBRA', 'EQUIPAMENTO': 'EQUIPAMENTO', 'MATERIAL': 'MATERIAL' };
                                    insumo = await prisma.engineeringItem.create({
                                        data: { code: insCode, description: ins.description || '', unit: ins.unit || 'UN', price: ins.unitPrice || 0, type: typeMap[ins.type] || 'MATERIAL', databaseId: propriaDb.id }
                                    });
                                }
                                await prisma.engineeringCompositionItem.create({
                                    data: { compositionId: compRecord.id, itemId: insumo.id, coefficient: ins.coefficient || 0, price: (ins.coefficient || 0) * (ins.unitPrice || 0) }
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
        res.status(500).json({ error: 'Falha ao extrair itens via Inteligência Artificial', details: e.message });
    }
});

// ═══════════════════════════════════════════════════════════
// POST /api/engineering/ai-extract-compositions
// Extrai Composições de Preços Unitários (CPUs) via IA
// a partir do texto do edital/projeto básico
// ═══════════════════════════════════════════════════════════
router.post('/ai-extract-compositions', async (req: any, res: any) => {
    try {
        const { biddingId, engineeringConfig } = req.body;
        if (!biddingId) return res.status(400).json({ error: 'biddingId obrigatório' });

        const bidding = await prisma.biddingProcess.findUnique({
            where: { id: biddingId },
            include: { aiAnalysis: true }
        });

        if (!bidding?.aiAnalysis) {
            return res.status(404).json({ error: 'Análise IA não encontrada para este processo' });
        }

        // Build extraction text from all available sources
        const parts: string[] = [];
        if (bidding.aiAnalysis.biddingItems) parts.push(bidding.aiAnalysis.biddingItems);
        if (bidding.aiAnalysis.requiredDocuments) parts.push(bidding.aiAnalysis.requiredDocuments);
        if (bidding.aiAnalysis.pricingConsiderations) parts.push(bidding.aiAnalysis.pricingConsiderations);
        if (bidding.aiAnalysis.fullSummary) parts.push(bidding.aiAnalysis.fullSummary);

        // Also check schemaV2 for structured composition data
        const schemaV2 = bidding.aiAnalysis.schemaV2 as any;
        if (schemaV2?.proposal_analysis?.itens_licitados) {
            parts.push('ITENS LICITADOS (estruturados):\n' + JSON.stringify(schemaV2.proposal_analysis.itens_licitados, null, 2));
        }

        const extractionText = parts.join('\n\n---\n\n');
        if (extractionText.length < 50) {
            return res.status(400).json({ error: 'Texto insuficiente para extração de composições' });
        }

        console.log(`[Engineering AI-Compositions] 🔬 Extraindo composições de ${extractionText.length} chars`);

        const { COMPOSITION_EXTRACTION_SYSTEM_PROMPT, COMPOSITION_EXTRACTION_USER_INSTRUCTION } = await import('../services/ai/modules/prompts/engineeringCompositionPrompt');

        let systemPrompt = COMPOSITION_EXTRACTION_SYSTEM_PROMPT;
        if (engineeringConfig) {
            systemPrompt += `\n\n[REGRAS DE NEGÓCIO - CONFIGURAÇÃO MESTRE]
1. Bases permitidas para mapeamento de Composições: ${engineeringConfig.basesConsideradas?.join(', ') || 'qualquer'}
2. Considere estritamente essas bases para identificar códigos de composições e insumos.
3. Se a base não estiver na lista, ou for uma composição "P" (Própria), categorize com código "N/A" e informe os insumos.`;
        }

        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const result = await callGeminiWithRetry(ai.models, {
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

        const rawResponse = result?.text || '';
        const parsed = robustJsonParse(rawResponse);
        const compositions = parsed?.compositions || [];

        if (compositions.length === 0) {
            return res.json({ compositions: [], message: 'Nenhuma composição encontrada no documento' });
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
async function mapV2ToEngineering(itensV2: any[]): Promise<any[]> {
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
            sourceName = code.match(/^[CI]\d/i) ? 'SEINFRA' : 'SINAPI';
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
    await enrichWithOfficialPrices(items);
    
    return items;
}

/**
 * Detecta a base oficial (SINAPI, SEINFRA, ORSE, SICRO) e o código
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
    
    // Pattern: "ORSE 1234" or "SICRO 1234"
    const orseMatch = desc.match(/(?:ORSE|SICRO)[\s:.-]*(\d{3,6})/i);
    if (orseMatch) return { sourceName: orseMatch[0].split(/[\s:.-]/)[0].toUpperCase(), code: orseMatch[1] };

    // If itemNumber has a code-like pattern (e.g., C0054)
    if (itemNumber && /^[CI]\d{3,5}$/i.test(itemNumber.trim())) {
        return { sourceName: 'SEINFRA', code: itemNumber.trim().toUpperCase() };
    }

    return { sourceName: 'PROPRIA', code: itemNumber || 'N/A' };
}

/**
 * Enriquece itens com preços da base oficial cadastrada
 * Busca por código exato no EngineeringItem
 */
async function enrichWithOfficialPrices(items: any[]): Promise<void> {
    for (const item of items) {
        // Skip groupers (ETAPA/SUBETAPA)
        if (item.type === 'ETAPA' || item.type === 'SUBETAPA') continue;
        if (!item.code || item.code === 'N/A') continue;

        // 1. Search in EngineeringItem (insumos)
        const dbItem = await prisma.engineeringItem.findFirst({
            where: { code: { equals: item.code, mode: 'insensitive' } },
            include: { database: { select: { name: true } } },
        });
        if (dbItem) {
            item.unitCost = Number(dbItem.price) || item.unitCost || 0;
            item.sourceName = dbItem.database?.name || item.sourceName || 'OFICIAL';
            if (!item.unit || item.unit === 'UN') item.unit = dbItem.unit || item.unit;
            console.log(`[Engineering Match] ✅ Item ${item.code} → ${dbItem.description?.substring(0, 50)} = R$ ${dbItem.price} (${item.sourceName})`);
            continue;
        }

        // 2. Search in EngineeringComposition (composições)
        const dbComp = await prisma.engineeringComposition.findFirst({
            where: { code: { equals: item.code, mode: 'insensitive' } },
            include: { database: { select: { name: true } } },
        });
        if (dbComp) {
            item.unitCost = Number(dbComp.totalPrice) || item.unitCost || 0;
            item.sourceName = dbComp.database?.name || item.sourceName || 'OFICIAL';
            if (!item.unit || item.unit === 'UN') item.unit = dbComp.unit || item.unit;
            item.type = 'COMPOSICAO';
            console.log(`[Engineering Match] ✅ Comp ${item.code} → ${dbComp.description?.substring(0, 50)} = R$ ${dbComp.totalPrice} (${item.sourceName})`);
            continue;
        }

        // 3. Auto-register: If AI extracted a SINAPI/SEINFRA code with data, auto-create it
        if (item.sourceName && ['SINAPI', 'SEINFRA', 'SICRO', 'ORSE'].includes(item.sourceName) && item.description && item.unitCost > 0) {
            try {
                let officialDb = await prisma.engineeringDatabase.findFirst({
                    where: { name: item.sourceName, type: 'OFICIAL' }
                });
                if (!officialDb) {
                    officialDb = await prisma.engineeringDatabase.create({
                        data: { name: item.sourceName, uf: '', type: 'OFICIAL' }
                    });
                }
                await prisma.engineeringComposition.create({
                    data: {
                        databaseId: officialDb.id,
                        code: item.code,
                        description: item.description,
                        unit: item.unit || 'UN',
                        totalPrice: item.unitCost,
                    }
                });
                item.type = 'COMPOSICAO';
                console.log(`[Engineering Auto-Register] 📝 ${item.sourceName} ${item.code} → ${item.description?.substring(0, 50)} = R$ ${item.unitCost} (auto-cadastrado)`);
            } catch (e: any) {
                // Ignore duplicates (race condition or already exists)
                if (!e.message?.includes('Unique constraint')) {
                    console.warn(`[Engineering Auto-Register] ⚠️ ${item.code}: ${e.message}`);
                }
            }
        }
    }
}

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
import { syncSinapi } from '../services/engineering/sinapiCrawler';

router.post('/bases/sync-sinapi', async (req: any, res: any) => {
    try {
        if (req.user?.role !== 'SUPER_ADMIN' && req.user?.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Acesso restrito a administradores' });
        }

        const { ufs = ['CE'], months = 3, includeDesonerado = true } = req.body;

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
// POST /api/engineering/bases/scrape-seinfra
// Scrape SEINFRA-CE SIPROCE portal and populate database
// ═══════════════════════════════════════════════════════════
router.post('/bases/scrape-seinfra', async (req: any, res: any) => {
    try {
        if (req.user?.role !== 'SUPER_ADMIN' && req.user?.role !== 'ADMIN') {
            return res.status(403).json({ error: 'Acesso restrito a administradores' });
        }

        console.log('[SEINFRA Import] 🚀 Iniciando download dos Excel oficiais do SIPROCE...');

        // Phase 1: Download and parse Excel files
        const { insumos, compositions, errors } = await downloadAndParseSeinfra();

        console.log(`[SEINFRA Import] ✅ Parse concluído: ${insumos.length} insumos, ${compositions.length} composições`);

        if (insumos.length === 0 && compositions.length === 0) {
            return res.json({
                message: 'Download concluído mas nenhum dado encontrado. Verifique se o portal SIPROCE está acessível.',
                errors: errors.slice(0, 20),
            });
        }

        // Phase 2: Create or find the SEINFRA database
        let db = await prisma.engineeringDatabase.findFirst({
            where: { name: 'SEINFRA', uf: 'CE', type: 'OFICIAL' }
        });
        if (!db) {
            db = await prisma.engineeringDatabase.create({
                data: {
                    name: 'SEINFRA',
                    uf: 'CE',
                    version: '028',
                    type: 'OFICIAL',
                }
            });
        }

        // Phase 3: Upsert insumos (materials, labor, equipment)
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
        console.log(`[SEINFRA Import] 📦 ${insertedInsumos} insumos importados`);

        // Phase 4: Upsert compositions and their items
        let insertedComps = 0;
        let insertedCompItems = 0;

        for (const comp of compositions) {
            try {
                // Upsert composition
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

                // Delete existing composition items and re-insert
                await prisma.engineeringCompositionItem.deleteMany({
                    where: { compositionId: dbComp.id }
                });

                // Link composition items
                for (const item of comp.items) {
                    let itemId: string | null = null;
                    let auxCompId: string | null = null;

                    if (item.isComposition) {
                        // This is an auxiliary composition (C-code referencing another C-code)
                        const auxComp = await prisma.engineeringComposition.findFirst({
                            where: { databaseId: db.id, code: item.insumoCode }
                        });
                        auxCompId = auxComp?.id || null;
                    } else {
                        // This is a basic insumo (I-code or numeric)
                        const dbItem = await prisma.engineeringItem.findFirst({
                            where: { databaseId: db.id, code: item.insumoCode }
                        });
                        itemId = dbItem?.id || null;
                    }

                    // Create composition item even without a linked record (will show description)
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

        console.log(`[SEINFRA Import] 🏁 Import concluído: ${insertedInsumos} insumos, ${insertedComps} composições, ${insertedCompItems} itens`);

        res.json({
            message: `SEINFRA-CE V028: ${insertedInsumos} insumos + ${insertedComps} composições (${insertedCompItems} itens) importados`,
            databaseId: db.id,
            parsed: { insumos: insumos.length, compositions: compositions.length },
            inserted: { insumos: insertedInsumos, compositions: insertedComps, compositionItems: insertedCompItems },
            errors: errors.slice(0, 20),
        });

    } catch (e: any) {
        console.error('[SEINFRA Import] Fatal:', e);
        res.status(500).json({ error: 'Erro na importação SEINFRA', details: e.message });
    }
});

export default router;
