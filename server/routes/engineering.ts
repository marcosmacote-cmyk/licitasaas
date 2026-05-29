import { Router } from 'express';
import { logger } from '../lib/logger';
import { prisma } from '../lib/prisma';
import { callGeminiWithRetry } from '../services/ai/gemini.service';
import { robustJsonParse } from '../services/ai/parser.service';
import { ENGINEERING_PROPOSAL_SYSTEM_PROMPT, ENGINEERING_PROPOSAL_USER_INSTRUCTION } from '../services/ai/modules/prompts/engineeringPromptV1';
import { GoogleGenAI } from '@google/genai';
// seinfra-scraper moved to engineering/baseSyncRoutes.ts
import { hydrateOrseCompositionDetails } from '../services/engineering/orseCrawler';
import { CompositionFlattener } from '../services/engineering/compositionFlattener';
import axios from 'axios';
import https from 'https';
import fs from 'fs';
import { submitJob } from '../services/backgroundJobService';
import { classifyEngineeringAttachments } from '../services/engineering/documentClassifier';
import { parseAndNormalizeEngineeringExtraction, postClassifyTypes } from '../services/engineering/resultNormalizer';
import { Prisma } from '@prisma/client';
import { SimpleTtlCache } from '../lib/cache';
import { classifyInsumoType } from '../services/engineering/insumoClassifier';
import { classifyComposition } from '../services/engineering/compositionCategorizer';
import { resolveDisplayBase } from '../services/engineering/baseResolver';
import { isTempId, flattenCompositionGroups, buildCompositionMetadata, correctCoefficientScaling, validateFkReferences, generateItemCode } from '../services/engineering/compositionSaveService';
import { getReconciliationReport, reconcileProposal } from '../services/engineering/reconciliationService';

const router = Router();
const compositionCache = new SimpleTtlCache<string, any>(1800);
const engineeringSearchCache = new SimpleTtlCache<string, any>(300); // 5 min TTL for searches


function refreshSubmittedPriceAudit(item: any) {
    const audit = item?.priceAudit;
    const matchedUnitCost = Number(audit?.matchedUnitCost) || 0;
    if (!audit || matchedUnitCost <= 0) return audit || undefined;

    const extractedUnitCost = Number(item.unitCost) || 0;
    const hasRegimeMismatch = Array.isArray(audit.warnings) && audit.warnings.some((warning: string) => String(warning).toLowerCase().includes('regime'));
    const hasDateMismatch = Array.isArray(audit.warnings) && audit.warnings.some((warning: string) => String(warning).toLowerCase().includes('data-base'));
    const deltaValue = hasRegimeMismatch ? null : extractedUnitCost - matchedUnitCost;
    const deltaPercent = deltaValue !== null && matchedUnitCost > 0 ? (deltaValue / matchedUnitCost) * 100 : null;
    const hasPriceDelta = !hasRegimeMismatch && deltaValue !== null && Math.abs(deltaValue) > 0.01;
    const hasBaseWarnings = Array.isArray(audit.warnings) && audit.warnings.length > 0;

    let status;
    if (hasDateMismatch) {
        status = 'BASE_INDISPONIVEL';
    } else if (hasPriceDelta) {
        status = 'DIVERGENT';
    } else if (hasBaseWarnings) {
        status = 'BASE_INCOMPATIVEL';
    } else {
        status = 'OK';
    }

    return {
        ...audit,
        extractedUnitCost,
        deltaValue,
        deltaPercent,
        status,
    };
}

async function getOrCreateEngineeringItemWithCollisionCheck(
    txOrPrisma: any,
    {
        databaseId,
        code,
        description,
        unit,
        price,
        type,
    }: {
        databaseId: string;
        code: string;
        description: string;
        unit: string;
        price: number;
        type: string;
    }
): Promise<{ id: string; code: string }> {
    const cleanCode = String(code || 'PROPRIO').trim();
    let currentCode = cleanCode;
    let suffixCount = 0;

    while (true) {
        const existing = await txOrPrisma.engineeringItem.findFirst({
            where: { databaseId, code: currentCode }
        });

        if (!existing) {
            const created = await txOrPrisma.engineeringItem.create({
                data: {
                    databaseId,
                    code: currentCode,
                    description: description || 'Novo Insumo Próprio',
                    unit: unit || 'UN',
                    price: price || 0,
                    type: classifyInsumoType(description || '', unit || 'UN', type).type,
                }
            });
            logger.info(`[CollisionCheck] 🆕 Created item: code=${currentCode} id=${created.id} (original=${cleanCode})`);
            return { id: created.id, code: currentCode };
        }

        const priceDiff = Math.abs(existing.price - price);
        const unitMatch = String(existing.unit).trim().toUpperCase() === String(unit || 'UN').trim().toUpperCase();

        if (priceDiff <= 0.01 && unitMatch) {
            return { id: existing.id, code: currentCode };
        }

        suffixCount++;
        currentCode = `${cleanCode}-C${suffixCount}`;
    }
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
// Helpers para validação de posse (Multi-tenancy)
// ═══════════════════════════════════════════════════════════
async function validateProposalOwnership(proposalId: string, tenantId: string) {
    if (!proposalId || proposalId === 'undefined' || proposalId === 'null') {
        const err = new Error('ID de proposta inválido');
        (err as any).statusCode = 400;
        throw err;
    }
    const proposal = await prisma.priceProposal.findUnique({
        where: { id: proposalId },
        select: { tenantId: true }
    });
    if (!proposal) {
        const err = new Error('Proposta não encontrada');
        (err as any).statusCode = 404;
        throw err;
    }
    if (proposal.tenantId !== tenantId) {
        const err = new Error('Acesso não autorizado a esta proposta');
        (err as any).statusCode = 403;
        throw err;
    }
}

async function validateDatabaseOwnership(databaseId: string, tenantId: string) {
    if (!databaseId || databaseId === 'undefined' || databaseId === 'null') {
        const err = new Error('ID de base de dados inválido');
        (err as any).statusCode = 400;
        throw err;
    }
    const db = await prisma.engineeringDatabase.findUnique({
        where: { id: databaseId },
        select: { tenantId: true, type: true }
    });
    if (!db) {
        const err = new Error('Base de dados não encontrada');
        (err as any).statusCode = 404;
        throw err;
    }
    if (db.type === 'PROPRIA' && db.tenantId && db.tenantId !== tenantId) {
        const err = new Error('Acesso não autorizado a esta base de dados');
        (err as any).statusCode = 403;
        throw err;
    }
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
        const tenantId = req.user?.tenantId;
        await validateDatabaseOwnership(databaseId, tenantId);

        const query = req.query.q as string || '';
        const limit = parseInt(req.query.limit as string) || 50;
        const page = parseInt(req.query.page as string) || 1;
        const kind = (req.query.kind as string || '').toUpperCase(); // 'COMPOSICAO' | 'INSUMO' | '' (all)
        const skip = (page - 1) * limit;

        const cacheKey = `base:items:${databaseId}:${query}:${limit}:${page}:${kind}`;
        const cached = engineeringSearchCache.get(cacheKey);
        if (cached) {
            return res.json(cached);
        }

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

        // Filter by kind: only query the relevant table(s) and apply database pagination (skip/take)
        let items: any[] = [];
        let compositions: any[] = [];
        let itemTotal = 0;
        let compositionTotal = 0;

        if (kind === 'INSUMO') {
            [items, itemTotal] = await Promise.all([
                prisma.engineeringItem.findMany({
                    where: whereClause,
                    skip,
                    take: limit,
                    orderBy: { code: 'asc' }
                }),
                prisma.engineeringItem.count({ where: whereClause })
            ]);
        } else if (kind === 'COMPOSICAO') {
            [compositions, compositionTotal] = await Promise.all([
                prisma.engineeringComposition.findMany({
                    where: compWhereClause,
                    skip,
                    take: limit,
                    orderBy: { code: 'asc' }
                }),
                prisma.engineeringComposition.count({ where: compWhereClause })
            ]);
        } else {
            // Fallback for when both are requested (both includeItems and includeComps are true)
            const includeItems = kind !== 'COMPOSICAO';
            const includeComps = kind !== 'INSUMO';
            [items, compositions, itemTotal, compositionTotal] = await Promise.all([
                includeItems ? prisma.engineeringItem.findMany({
                    where: whereClause,
                    take: skip + limit,
                    orderBy: { code: 'asc' }
                }) : Promise.resolve([]),
                includeComps ? prisma.engineeringComposition.findMany({
                    where: compWhereClause,
                    take: skip + limit,
                    orderBy: { code: 'asc' }
                }) : Promise.resolve([]),
                includeItems ? prisma.engineeringItem.count({ where: whereClause }) : Promise.resolve(0),
                includeComps ? prisma.engineeringComposition.count({ where: compWhereClause }) : Promise.resolve(0)
            ]);
        }

        const combined = [
            ...items.map((item: any) => ({ ...item, recordKind: 'INSUMO', price: item.price })),
            ...compositions.map((composition: any) => ({
                ...composition,
                recordKind: 'COMPOSICAO',
                price: composition.totalPrice,
                type: 'SERVICO',
            })),
        ];

        // If kind was empty, we retrieved both tables up to skip + limit and need to slice in memory.
        // Otherwise, the database already paginated using skip/take.
        const total = itemTotal + compositionTotal;
        let finalItems = combined;

        if (!kind) {
            finalItems.sort((a: any, b: any) => String(a.code).localeCompare(String(b.code)));
            finalItems = finalItems.slice(skip, skip + limit);
        } else {
            finalItems.sort((a: any, b: any) => String(a.code).localeCompare(String(b.code)));
        }

        const responseData = {
            items: finalItems,
            total,
            page,
            totalPages: Math.ceil(total / limit)
        };

        engineeringSearchCache.set(cacheKey, responseData);
        res.json(responseData);

    } catch (e: any) {
        console.error('Error fetching engineering items', e);
        const status = e.statusCode || 500;
        res.status(status).json({ error: e.message || 'Erro ao buscar insumos' });
    }
});

function getPropriaDatabaseName(proposalId?: string): string {
    if (proposalId && proposalId !== 'undefined' && proposalId !== 'null') {
        return `PROPRIA_${proposalId}`;
    }
    return 'PROPRIA';
}

async function getOrCreatePropriaDatabase(txOrPrisma: any, tenantId: string, proposalId?: string) {
    const dbName = getPropriaDatabaseName(proposalId);
    let db = await txOrPrisma.engineeringDatabase.findFirst({
        where: { name: dbName, tenantId }
    });
    if (!db) {
        db = await txOrPrisma.engineeringDatabase.create({
            data: { name: dbName, uf: '', tenantId, type: 'PROPRIA' }
        });
    }
    return db;
}
/**
 * FIX-HUB-05: Resolve the DISPLAY base name for a composition/insumo.
 * Now delegated to shared baseResolver module.
 * @see server/services/engineering/baseResolver.ts
 */
// resolveDisplayBase is imported from '../services/engineering/baseResolver'

function normalizeCompositionSource(sourceName?: string): string | undefined {
    const source = String(sourceName || '').trim().toUpperCase();
    if (!source) return undefined;
    if (source === 'SICRO3') return 'SICRO';
    if (source === 'SICOR-MG' || source === 'SICOR MG' || source === 'DER-MG' || source === 'DER MG') return 'SICOR';
    return source;
}

function buildCompositionCodeVariants(code: string, sourceName?: string): string[] {
    const raw = String(code || '').trim();
    const upper = raw.toUpperCase().replace(/\.$/, '');
    const variants = new Set<string>([raw, upper]);

    // Handle "COMP. XXX" / "COMP XXX" prefix — budget items often have this but DB may not
    const compPrefixMatch = upper.match(/^COMP[.\s]+(.+)$/);
    if (compPrefixMatch) {
        const withoutPrefix = compPrefixMatch[1].trim();
        variants.add(withoutPrefix);
        variants.add(`COMP. ${withoutPrefix}`);
        variants.add(`COMP ${withoutPrefix}`);
    } else if (!upper.startsWith('COMP')) {
        // Add the prefixed version only for non-COMP codes
        variants.add(`COMP. ${upper}`);
    }

    // FIX ORSE-02: Generate ORSE variants for both old (XXXX/ORSE) and new (XXXX) format
    // sourceName allows detection even when code has no /ORSE suffix
    const isOrse = /ORSE$/i.test(upper) || String(sourceName || '').toUpperCase() === 'ORSE';
    const orse = upper.match(/^0*(\d{1,6})(?:\/ORSE)?$/);
    if (orse && isOrse) {
        // Add all variants: with and without /ORSE suffix, with and without leading zeros
        variants.add(orse[1]);
        variants.add(`${orse[1]}/ORSE`);
        variants.add(orse[1].padStart(4, '0'));
        variants.add(orse[1].padStart(5, '0'));
        variants.add(`${orse[1].padStart(4, '0')}/ORSE`);
        variants.add(`${orse[1].padStart(5, '0')}/ORSE`);
    }
    const numeric = upper.match(/^0*(\d{4,7})$/);
    if (numeric) {
        variants.add(numeric[1]);
        variants.add(numeric[1].padStart(5, '0'));
        variants.add(numeric[1].padStart(6, '0'));
    }
    return [...variants].filter(Boolean);
}

function compositionIncludes() {
    return {
        items: { 
            include: { 
                item: { include: { database: true } } 
            }, 
            orderBy: { createdAt: 'asc' as const } 
        },
        database: { select: { id: true, name: true, uf: true, type: true, version: true, referenceMonth: true, referenceYear: true, payrollExemption: true } },
    };
}

function compositionOrderBy() {
    return [
        { database: { referenceYear: 'desc' as const } },
        { database: { referenceMonth: 'desc' as const } },
        { updatedAt: 'desc' as const },
    ];
}

async function autoCleanCompositionMetadata(comp: any) {
    if (!comp) return;
    const dbName = String(comp.database?.name || '').toUpperCase();
    const isPropria = comp.database?.type === 'PROPRIA' || dbName === 'PROPRIA' || dbName.startsWith('PROPRIA_');
    const hasNoItems = !comp.items || comp.items.length === 0;
    if (isPropria && hasNoItems) {
        let hasMetadata = false;
        if (comp.metadata) {
            if (typeof comp.metadata === 'string') {
                try {
                    const parsed = JSON.parse(comp.metadata);
                    hasMetadata = parsed && Object.keys(parsed).length > 0;
                } catch {
                    hasMetadata = true;
                }
            } else {
                hasMetadata = Object.keys(comp.metadata).length > 0;
            }
        }
        if (hasMetadata) {
            logger.info(`[CompositionAutoClean] 🧼 Auto-cleaning stale metadata for empty composition: code=${comp.code} id=${comp.id}`);
            try {
                await prisma.engineeringComposition.update({
                    where: { id: comp.id },
                    data: { metadata: Prisma.DbNull }
                });
                comp.metadata = null;
            } catch (e: any) {
                logger.warn(`[CompositionAutoClean] Failed to clear metadata for id=${comp.id}: ${e.message}`);
            }
        }
    }
}

function sortCompositionsInMemory(comps: any[]) {
    return comps.sort((a, b) => {
        const yearA = a.database?.referenceYear ?? 0;
        const yearB = b.database?.referenceYear ?? 0;
        if (yearB !== yearA) return yearB - yearA;

        const monthA = a.database?.referenceMonth ?? 0;
        const monthB = b.database?.referenceMonth ?? 0;
        if (monthB !== monthA) return monthB - monthA;

        const dateA = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const dateB = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        return dateB - dateA;
    });
}

async function findCompositionWithItems(codeVariants: string[], where: any) {
    const comps = await prisma.engineeringComposition.findMany({
        where: { ...where, code: { in: codeVariants }, items: { some: {} } },
        include: compositionIncludes(),
    });
    if (comps.length === 0) return null;
    return sortCompositionsInMemory(comps)[0];
}

async function resolveRegimeAlignedDatabaseFilter(
    databaseId?: string,
    sourceName?: string,
    proposalId?: string,
    tenantId?: string
): Promise<{ databaseId?: string; sourceName?: string; desiredExemption?: boolean | null }> {
    let desiredExemption: boolean | null = null;
    if (proposalId) {
        const proposal = await prisma.priceProposal.findUnique({
            where: { id: proposalId },
            select: { engineeringConfig: true }
        });
        const config = (proposal?.engineeringConfig as any) || {};
        if (config.regimeOneracao) {
            desiredExemption = config.regimeOneracao === 'DESONERADO';
        }
    }

    const normalizedSource = normalizeCompositionSource(sourceName);

    if (!databaseId) {
        return { sourceName: normalizedSource, desiredExemption };
    }

    const requestedDatabase = await prisma.engineeringDatabase.findUnique({
        where: { id: databaseId },
        select: { id: true, name: true, uf: true, type: true, payrollExemption: true }
    });

    if (!requestedDatabase) {
        return { databaseId, sourceName: normalizedSource, desiredExemption };
    }

    if (desiredExemption !== null && requestedDatabase.payrollExemption !== desiredExemption && requestedDatabase.type === 'OFICIAL') {
        // Regime mismatch in official database. Find the database with matching regime.
        const alignedDb = await prisma.engineeringDatabase.findFirst({
            where: {
                name: requestedDatabase.name,
                uf: requestedDatabase.uf || null,
                type: 'OFICIAL',
                payrollExemption: desiredExemption
            },
            select: { id: true }
        });
        if (alignedDb) {
            logger.info(`[CompositionLookup] 🔀 Aligned database filter from wrong regime DB ${databaseId} (${requestedDatabase.payrollExemption ? 'DES' : 'ON'}) to correct regime DB ${alignedDb.id} (${desiredExemption ? 'DES' : 'ON'})`);
            return { databaseId: alignedDb.id, desiredExemption };
        }
    }

    return { databaseId, sourceName: normalizedSource, desiredExemption };
}

async function findBestAnalyticalComposition(codeVariants: string[], databaseId?: string, sourceName?: string, tenantId?: string, proposalId?: string) {
    const filter = await resolveRegimeAlignedDatabaseFilter(databaseId, sourceName, proposalId, tenantId);
    const resolvedDbId = filter.databaseId;
    const resolvedSourceName = filter.sourceName;
    const desiredExemption = filter.desiredExemption;

    const requestedDatabase = resolvedDbId
        ? await prisma.engineeringDatabase.findUnique({
            where: { id: resolvedDbId },
            select: { id: true, name: true, uf: true, type: true, tenantId: true, payrollExemption: true },
        })
        : null;

    // FIX SYNC-03: Determine if the caller is requesting a specific official source
    const isRequestingOfficial = resolvedSourceName && resolvedSourceName !== 'PROPRIA';

    // FIX SYNC-03: When an official source is explicitly requested, try it FIRST
    // This prevents PROPRIA copies from hijacking lookups for official compositions
    if (isRequestingOfficial) {
        // 1. Try exact databaseId first
        if (resolvedDbId) {
            const exact = await findCompositionWithItems(codeVariants, { databaseId: resolvedDbId });
            if (exact) {
                logger.info(`[CompositionLookup] ✅ OFFICIAL exact databaseId match: db=${exact.database?.name} code=${exact.code} items=${exact.items?.length || 0}`);
                return exact;
            }
        }

        // 2. Try same source + UF + payroll
        const dbSourceName = normalizeCompositionSource(requestedDatabase?.name || resolvedSourceName);
        if (dbSourceName) {
            const sameSourceAndUfWhere: any = { database: { name: dbSourceName } };
            if (requestedDatabase?.uf) sameSourceAndUfWhere.database.uf = requestedDatabase.uf;
            const finalExemption = desiredExemption !== null ? desiredExemption : requestedDatabase?.payrollExemption;
            if (typeof finalExemption === 'boolean') {
                sameSourceAndUfWhere.database.payrollExemption = finalExemption;
            }
            const sameSourceAndUf = await findCompositionWithItems(codeVariants, sameSourceAndUfWhere);
            if (sameSourceAndUf) {
                logger.info(`[CompositionLookup] ✅ OFFICIAL source+UF match: db=${sameSourceAndUf.database?.name} code=${sameSourceAndUf.code} items=${sameSourceAndUf.items?.length || 0}`);
                return sameSourceAndUf;
            }

            const sameSource = await findCompositionWithItems(codeVariants, { database: { name: dbSourceName } });
            if (sameSource) {
                logger.info(`[CompositionLookup] ✅ OFFICIAL source match: db=${sameSource.database?.name} code=${sameSource.code} items=${sameSource.items?.length || 0}`);
                return sameSource;
            }
        }

        // 3. Fall back to PROPRIA only if no official match was found
        const targetPropriaName = getPropriaDatabaseName(proposalId);
        const propriaWhere: any = { database: { name: targetPropriaName } };
        if (tenantId) propriaWhere.database.tenantId = tenantId;
        const propria = await findCompositionWithItems(codeVariants, propriaWhere);
        if (propria) {
            logger.info(`[CompositionLookup] ⚠️ No official match, falling back to PROPRIA: id=${propria.id} code=${propria.code} items=${propria.items?.length || 0}`);
            return propria;
        } else if (proposalId) {
            const globalPropriaWhere: any = { database: { name: 'PROPRIA' } };
            if (tenantId) globalPropriaWhere.database.tenantId = tenantId;
            const globalPropria = await findCompositionWithItems(codeVariants, globalPropriaWhere);
            if (globalPropria) {
                logger.info(`[CompositionLookup] ⚠️ No official match, falling back to global PROPRIA: id=${globalPropria.id} code=${globalPropria.code} items=${globalPropria.items?.length || 0}`);
                return globalPropria;
            }
        }

        // 4. Try any official database
        const defaultOfficialWhere: any = { database: { type: 'OFICIAL' } };
        if (desiredExemption !== null) {
            defaultOfficialWhere.database.payrollExemption = desiredExemption;
        }
        return findCompositionWithItems(codeVariants, defaultOfficialWhere);
    }

    // Original behavior when PROPRIA is explicitly requested or no sourceName given
    const targetPropriaName = getPropriaDatabaseName(proposalId);
    const propriaWhere: any = { database: { name: targetPropriaName } };
    if (tenantId) propriaWhere.database.tenantId = tenantId;
    const propria = await findCompositionWithItems(codeVariants, propriaWhere);
    if (propria) {
        logger.info(`[CompositionLookup] ✅ PROPRIA found first: id=${propria.id} code=${propria.code} items=${propria.items?.length || 0}`);
        return propria;
    } else if (proposalId) {
        // Fallback to global tenant-wide PROPRIA
        const globalPropriaWhere: any = { database: { name: 'PROPRIA' } };
        if (tenantId) globalPropriaWhere.database.tenantId = tenantId;
        const globalPropria = await findCompositionWithItems(codeVariants, globalPropriaWhere);
        if (globalPropria) {
            logger.info(`[CompositionLookup] ✅ PROPRIA found in global tenant-wide fallback: id=${globalPropria.id} code=${globalPropria.code} items=${globalPropria.items?.length || 0}`);
            return globalPropria;
        }
    } else {
        logger.info(`[CompositionLookup] ℹ️ No PROPRIA composition with items found for codes=[${codeVariants.join(',')}] tenantId=${tenantId || 'none'}`);
    }

    if (resolvedDbId) {
        const exact = await findCompositionWithItems(codeVariants, { databaseId: resolvedDbId });
        if (exact) return exact;
    }

    const dbSourceName = normalizeCompositionSource(requestedDatabase?.name || resolvedSourceName);
    if (dbSourceName) {
        const sameSourceAndUfWhere: any = { database: { name: dbSourceName } };
        if (requestedDatabase?.uf) sameSourceAndUfWhere.database.uf = requestedDatabase.uf;
        const finalExemption = desiredExemption !== null ? desiredExemption : requestedDatabase?.payrollExemption;
        if (typeof finalExemption === 'boolean') {
            sameSourceAndUfWhere.database.payrollExemption = finalExemption;
        }
        const sameSourceAndUf = await findCompositionWithItems(codeVariants, sameSourceAndUfWhere);
        if (sameSourceAndUf) return sameSourceAndUf;

        const sameSource = await findCompositionWithItems(codeVariants, { database: { name: dbSourceName } });
        if (sameSource) return sameSource;
    }

    const defaultOfficialWhere: any = { database: { type: 'OFICIAL' } };
    if (desiredExemption !== null) {
        defaultOfficialWhere.database.payrollExemption = desiredExemption;
    }
    return findCompositionWithItems(codeVariants, defaultOfficialWhere);
}

async function findFallbackComposition(codeVariants: string[], databaseId?: string, sourceName?: string, tenantId?: string, proposalId?: string) {
    const include = compositionIncludes();
    const filter = await resolveRegimeAlignedDatabaseFilter(databaseId, sourceName, proposalId, tenantId);
    const resolvedDbId = filter.databaseId;
    const resolvedSourceName = filter.sourceName;
    const desiredExemption = filter.desiredExemption;

    if (!resolvedDbId) {
        const targetPropriaName = getPropriaDatabaseName(proposalId);
        const propriaDatabaseWhere: any = { name: targetPropriaName };
        if (tenantId) propriaDatabaseWhere.tenantId = tenantId;
        const compsPropria = await prisma.engineeringComposition.findMany({
            where: { code: { in: codeVariants }, database: propriaDatabaseWhere },
            include,
        });
        if (compsPropria.length > 0) {
            return sortCompositionsInMemory(compsPropria)[0];
        }

        if (proposalId) {
            const globalPropriaDatabaseWhere: any = { name: 'PROPRIA', tenantId };
            const globalCompsPropria = await prisma.engineeringComposition.findMany({
                where: { code: { in: codeVariants }, database: globalPropriaDatabaseWhere },
                include,
            });
            if (globalCompsPropria.length > 0) {
                return sortCompositionsInMemory(globalCompsPropria)[0];
            }
        }
    }

    const where: any = { code: { in: codeVariants } };
    if (resolvedDbId) {
        where.databaseId = resolvedDbId;
    } else if (resolvedSourceName) {
        where.database = { name: resolvedSourceName };
        if (desiredExemption !== null) {
            where.database.payrollExemption = desiredExemption;
        }
    } else {
        const defaultOfficialWhere: any = { database: { type: 'OFICIAL' } };
        if (desiredExemption !== null) {
            defaultOfficialWhere.database.payrollExemption = desiredExemption;
        }
        where.database = defaultOfficialWhere.database;
    }

    const comps = await prisma.engineeringComposition.findMany({
        where,
        include,
    });
    if (comps.length === 0) return null;
    return sortCompositionsInMemory(comps)[0];
}

// ═══════════════════════════════════════════════════════════
// GET /api/engineering/compositions/:code
// Busca composição por código com drill-down completo de insumos
// ═══════════════════════════════════════════════════════════
router.get('/compositions/:code', async (req: any, res: any) => {
    try {
        const code = req.params.code;
        const databaseId = req.query.databaseId as string || undefined;
        const tenantId = req.user?.tenantId || 'none';

        if (databaseId) {
            await validateDatabaseOwnership(databaseId, req.user?.tenantId);
        }

        const sourceName = normalizeCompositionSource(req.query.sourceName as string | undefined);
        const proposalId = req.query.proposalId as string || undefined;
        const codeVariants = buildCompositionCodeVariants(code, sourceName);

        // Fetch proposal regime to include in cache key (prevents cross-regime stale cache hits)
        let targetRegime = 'DESONERADO';
        if (proposalId) {
            const proposal = await prisma.priceProposal.findUnique({
                where: { id: proposalId },
                select: { engineeringConfig: true }
            });
            const config = (proposal?.engineeringConfig as any) || {};
            if (config.regimeOneracao) {
                targetRegime = config.regimeOneracao;
            }
        } else if (req.query.regime) {
            targetRegime = req.query.regime as string;
        }

        const cacheKey = `comp:${code}:${databaseId || ''}:${sourceName || ''}:${tenantId}:${proposalId || ''}:${targetRegime}`;
        const cached = compositionCache.get(cacheKey);
        if (cached) {
            logger.info(`[CompositionLookup] ⚡ Cache HIT: ${cacheKey}`);
            return res.json(cached);
        }

        logger.info(`[CompositionLookup] code=${code} databaseId=${databaseId || 'none'} sourceName=${sourceName || 'none'} proposalId=${proposalId || 'none'} codeVariants=${codeVariants.join(',')}`);

        let composition = null;
        if (sourceName === 'PROPRIA') {
            const targetPropriaName = getPropriaDatabaseName(proposalId);
            const propriaDatabaseWhere: any = { name: targetPropriaName };
            if (req.user?.tenantId) propriaDatabaseWhere.tenantId = req.user.tenantId;

            let foundPropria = await prisma.engineeringComposition.findFirst({
                where: { code: { in: codeVariants }, database: propriaDatabaseWhere },
                include: compositionIncludes(),
            });

            if (!foundPropria && proposalId) {
                const globalPropriaDatabaseWhere: any = { name: 'PROPRIA' };
                if (req.user?.tenantId) globalPropriaDatabaseWhere.tenantId = req.user.tenantId;
                foundPropria = await prisma.engineeringComposition.findFirst({
                    where: { code: { in: codeVariants }, database: globalPropriaDatabaseWhere },
                    include: compositionIncludes(),
                });
            }

            if (foundPropria) {
                logger.info(`[CompositionLookup] ⚡ Fast-path PROPRIA match (can be empty): db=${foundPropria.database?.name} code=${foundPropria.code} items=${foundPropria.items?.length || 0}`);
                composition = foundPropria;
            }
        }

        if (!composition) {
            composition = await findBestAnalyticalComposition(codeVariants, databaseId, sourceName, req.user?.tenantId, proposalId);
            if (composition) {
                logger.info(`[CompositionLookup] ✅ ANALYTICAL found: db=${composition.database?.name} code=${composition.code} items=${composition.items?.length || 0}`);
            } else {
                logger.info(`[CompositionLookup] ⚠️ No analytical found, trying fallback...`);
            }
            if (!composition) composition = await findFallbackComposition(codeVariants, databaseId, sourceName, req.user?.tenantId, proposalId);
            if (composition) {
                logger.info(`[CompositionLookup] Fallback result: db=${composition.database?.name} code=${composition.code} items=${composition.items?.length || 0}`);
            }
        }

        if (!composition) {
            const itemWhere: any = { code: { in: codeVariants } };
            if (databaseId) itemWhere.databaseId = databaseId;
            else if (sourceName) itemWhere.database = { name: sourceName };
            const syntheticItem = await prisma.engineeringItem.findFirst({
                where: itemWhere,
                include: { database: { select: { id: true, name: true, uf: true, type: true, version: true, referenceMonth: true, referenceYear: true, payrollExemption: true } } }
            });

            if (!syntheticItem) {
                return res.status(404).json({ error: 'Composição não encontrada', code, codeVariants });
            }

            const syntheticRow = {
                id: `synthetic-${syntheticItem.id}`,
                coefficient: 1,
                price: syntheticItem.price,
                item: {
                    id: syntheticItem.id,
                    code: syntheticItem.code,
                    description: syntheticItem.description,
                    unit: syntheticItem.unit,
                    price: syntheticItem.price,
                    type: syntheticItem.type === 'MAO_DE_OBRA' || syntheticItem.type === 'EQUIPAMENTO' || syntheticItem.type === 'MATERIAL'
                        ? syntheticItem.type
                        : 'SERVICO',
                },
            };

            const syntheticGroups: Record<string, any[]> = { MATERIAL: [], MAO_DE_OBRA: [], EQUIPAMENTO: [], SERVICO: [], AUXILIAR: [] };
            const groupKey = syntheticRow.item.type || 'SERVICO';
            if (!syntheticGroups[groupKey]) syntheticGroups[groupKey] = [];
            syntheticGroups[groupKey].push(syntheticRow);

            const syntheticItemRes = {
                id: `synthetic-${syntheticItem.id}`,
                databaseId: syntheticItem.databaseId,
                code: syntheticItem.code,
                description: syntheticItem.description,
                unit: syntheticItem.unit,
                totalPrice: syntheticItem.price,
                database: syntheticItem.database,
                items: [syntheticRow],
                groups: syntheticGroups,
                totalDirect: syntheticItem.price,
                hasAnalyticalItems: false,
                synthetic: true,
                message: 'Preço sintético encontrado, mas a composição analítica não está importada nesta base.',
            };
            compositionCache.set(cacheKey, syntheticItemRes);
            return res.json(syntheticItemRes);
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
                        include: compositionIncludes()
                    });
                }
            } catch (e: any) {
                console.warn(`[ORSE Detail] Could not hydrate ${code}: ${e.message}`);
            }
        }

        if (!composition) {
            return res.status(404).json({ error: 'Composição não encontrada após atualização', code, codeVariants });
        }

        const resolvedComposition = composition;
        let analyticalFallback: any = null;

        if (
            resolvedComposition.items.length === 0 &&
            String(resolvedComposition.database?.type || '').toUpperCase() === 'OFICIAL'
        ) {
            // ── RETRY: Try to find ANY composition with this code that HAS analytical items ──
            const fallbacks = await prisma.engineeringComposition.findMany({
                where: {
                    code: { in: codeVariants },
                    items: { some: {} },
                },
                include: compositionIncludes(),
            });

            if (fallbacks.length > 0) {
                analyticalFallback = sortCompositionsInMemory(fallbacks)[0];
                logger.info(`[CompositionLookup] 🔄 Found analytical version in db=${analyticalFallback.database?.name} (${analyticalFallback.items.length} items) — using instead of empty composition`);
                composition = analyticalFallback;
            } else {
                analyticalFallback = null;
                const syntheticRow = {
                    id: `synthetic-composition-${resolvedComposition.id}`,
                    coefficient: 1,
                    price: resolvedComposition.totalPrice,
                    item: {
                        id: `synthetic-item-${resolvedComposition.id}`,
                        code: resolvedComposition.code,
                        description: resolvedComposition.description,
                        unit: resolvedComposition.unit,
                        price: resolvedComposition.totalPrice,
                        type: 'SERVICO',
                    },
                };
                const syntheticCompRes = {
                    ...resolvedComposition,
                    items: [syntheticRow],
                    groups: { MATERIAL: [], MAO_DE_OBRA: [], EQUIPAMENTO: [], SERVICO: [syntheticRow], AUXILIAR: [] },
                    totalDirect: resolvedComposition.totalPrice,
                    hasAnalyticalItems: false,
                    synthetic: true,
                    message: 'Composição oficial encontrada, mas sem itens analíticos importados nesta base.',
                };
                compositionCache.set(cacheKey, syntheticCompRes);
                return res.json(syntheticCompRes);
            }
        }

        // Track if analytical data came from a different database than the price match
        const analyticalCrossDb = analyticalFallback && analyticalFallback.databaseId !== resolvedComposition.databaseId;

        // Enrich with auxiliary compositions if any
        const finalComposition = analyticalFallback || composition;
        await autoCleanCompositionMetadata(finalComposition);

        const enrichedItems = await Promise.all(finalComposition.items.map(async (ci: any) => {
            if (ci.auxiliaryCompositionId) {
                const aux = await prisma.engineeringComposition.findUnique({
                    where: { id: ci.auxiliaryCompositionId },
                    include: { 
                        database: { select: { id: true, name: true, uf: true, type: true, version: true, referenceMonth: true, referenceYear: true, payrollExemption: true } },
                        items: { include: { item: { include: { database: true } } } }
                    }
                });
                if (aux) {
                    await autoCleanCompositionMetadata(aux);
                }
                return { ...ci, auxiliaryComposition: aux };
            }
            return ci;
        }));

        const isPropriaResponse = sourceName === 'PROPRIA' ||
            String(finalComposition.database?.type || '').toUpperCase() === 'PROPRIA' ||
            String(finalComposition.database?.name || '').toUpperCase() === 'PROPRIA' ||
            String(finalComposition.database?.name || '').toUpperCase().startsWith('PROPRIA_');

        if (isPropriaResponse && enrichedItems.length > 0) {
            // A composição própria é snapshot da proposta. No load, nunca re-enriquecer
            // contra bases oficiais: apenas deriva preço unitário para exibição a partir
            // do subtotal salvo em EngineeringCompositionItem.price.
            for (const ci of enrichedItems) {
                const savedSubtotal = Number(ci.price) || 0;
                const coefficient = Number(ci.coefficient) || 0;
                if (savedSubtotal <= 0 || coefficient <= 0) continue;

                const savedUnitPrice = savedSubtotal / coefficient;
                if (ci.item) {
                    ci.item = { ...ci.item, price: savedUnitPrice };
                } else if (ci.auxiliaryComposition) {
                    ci.auxiliaryComposition = { ...ci.auxiliaryComposition, totalPrice: savedUnitPrice };
                }
            }
        }

        // Group by groupKey if present, otherwise fallback by type for nice display
        const groups: Record<string, any[]> = {};
        const hasGroupKeys = enrichedItems.some((ci: any) => ci.groupKey);

        if (hasGroupKeys) {
            for (const ci of enrichedItems) {
                const key = ci.groupKey || 'MATERIAL';
                if (!groups[key]) groups[key] = [];
                groups[key].push(ci);
            }
        } else {
            groups.MATERIAL = [];
            groups.MAO_DE_OBRA = [];
            groups.EQUIPAMENTO = [];
            groups.SERVICO = [];
            groups.AUXILIAR = [];
            for (const ci of enrichedItems) {
                if (ci.auxiliaryComposition) {
                    groups.AUXILIAR.push(ci);
                } else if (ci.item) {
                    const type = ci.item.type || 'MATERIAL';
                    if (!groups[type]) groups[type] = [];
                    groups[type].push(ci);
                }
            }
        }

        const metadataObj = finalComposition.metadata 
            ? (typeof finalComposition.metadata === 'string' 
                ? JSON.parse(finalComposition.metadata) 
                : finalComposition.metadata)
            : {};

        const totalDirect = enrichedItems.reduce((s: number, ci: any) => s + (Number(ci.price) || 0), 0);

        const finalEnrichedRes = {
            ...finalComposition,
            ...metadataObj,
            items: enrichedItems,
            groups,
            totalDirect,
            ...(isPropriaResponse ? { totalPrice: totalDirect } : {}),
            hasAnalyticalItems: enrichedItems.length > 0,
            // Cache: the database where analytical items were found (if different from price match)
            ...(analyticalCrossDb ? {
                analyticalDatabaseId: analyticalFallback.databaseId,
                analyticalSourceInfo: {
                    databaseName: analyticalFallback.database?.name,
                    databaseUf: analyticalFallback.database?.uf,
                    note: `Composição analítica obtida de ${analyticalFallback.database?.name || 'outra base'} (${analyticalFallback.items.length} insumos)`,
                },
            } : {}),
        };
        compositionCache.set(cacheKey, finalEnrichedRes);
        res.json(finalEnrichedRes);

    } catch (e: any) {
        console.error('Error fetching composition:', e);
        const status = e.statusCode || 500;
        res.status(status).json({ error: e.message || 'Erro ao buscar composição' });
    }
});

router.get('/compositions', async (req: any, res: any) => {
    try {
        const databaseId = req.query.databaseId as string;
        const q = req.query.q as string || '';
        const limit = parseInt(req.query.limit as string) || 50;

        const cacheKey = `compositions:list:${databaseId || ''}:${q}:${limit}`;
        const cached = engineeringSearchCache.get(cacheKey);
        if (cached) {
            return res.json(cached);
        }

        const where: any = {};
        if (databaseId) {
            await validateDatabaseOwnership(databaseId, req.user?.tenantId);
            where.databaseId = databaseId;
        } else {
            where.database = {
                OR: [
                    { type: 'OFICIAL' },
                    { tenantId: req.user?.tenantId }
                ]
            };
        }

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

        engineeringSearchCache.set(cacheKey, compositions);
        res.json(compositions);
    } catch (e: any) {
        console.error('Error listing compositions:', e);
        const status = e.statusCode || 500;
        res.status(status).json({ error: e.message || 'Erro ao listar composições' });
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

        const cacheKey = `hub:search:${q}:${limit}`;
        const cached = engineeringSearchCache.get(cacheKey);
        if (cached) {
            return res.json(cached);
        }

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

        const result = { compositions, items };
        engineeringSearchCache.set(cacheKey, result);
        res.json(result);
    } catch (e: any) {
        console.error('[Hub Search] Error:', e);
        res.status(500).json({ error: 'Erro na busca' });
    }
});

// ═══════════════════════════════════════════════════════════
// POST /api/engineering/propria/create — Criar Item/Composição Própria via Hub
// ═══════════════════════════════════════════════════════════
router.post('/propria/create', async (req: any, res: any) => {
    try {
        compositionCache.flushAll();
        engineeringSearchCache.flushAll();
        const tenantId = req.user?.tenantId || req.body.tenantId;
        const { code, description, unit, price, recordKind } = req.body;

        if (!code || !description) {
            return res.status(400).json({ error: 'Código e descrição são obrigatórios' });
        }
        if (price === undefined || price === null || isNaN(Number(price))) {
            return res.status(400).json({ error: 'Valor unitário é obrigatório' });
        }

        const proposalId = req.query.proposalId as string || req.body.proposalId as string || undefined;
        const propriaDb = await getOrCreatePropriaDatabase(prisma, tenantId, proposalId);

        const kind = (recordKind || 'INSUMO').toUpperCase();
        const unitValue = (unit || 'UN').toUpperCase().trim();
        const priceValue = Number(price);

        if (kind === 'COMPOSICAO') {
            // Check duplicate
            const existing = await prisma.engineeringComposition.findFirst({
                where: { code, databaseId: propriaDb.id }
            });
            if (existing) {
                return res.status(400).json({ error: `Já existe composição com código "${code}" na base própria` });
            }
            const comp = await prisma.engineeringComposition.create({
                data: { code, description, unit: unitValue, databaseId: propriaDb.id, totalPrice: priceValue }
            });
            // Update counter
            await prisma.engineeringDatabase.update({
                where: { id: propriaDb.id },
                data: { compositionCount: { increment: 1 } }
            });
            return res.json({
                message: 'Composição própria criada com sucesso',
                item: { id: comp.id, code: comp.code, description: comp.description, unit: comp.unit, price: comp.totalPrice, recordKind: 'COMPOSICAO' }
            });
        } else {
            // INSUMO
            const existing = await prisma.engineeringItem.findFirst({
                where: { code, databaseId: propriaDb.id }
            });
            if (existing) {
                return res.status(400).json({ error: `Já existe insumo com código "${code}" na base própria` });
            }
            const item = await prisma.engineeringItem.create({
                data: { code, description, unit: unitValue, price: priceValue, type: classifyInsumoType(description, unitValue).type, databaseId: propriaDb.id }
            });
            // Update counter
            await prisma.engineeringDatabase.update({
                where: { id: propriaDb.id },
                data: { itemCount: { increment: 1 } }
            });
            return res.json({
                message: 'Insumo próprio criado com sucesso',
                item: { id: item.id, code: item.code, description: item.description, unit: item.unit, price: item.price, recordKind: 'INSUMO' }
            });
        }
    } catch (e: any) {
        console.error('[Propria Create] Error:', e);
        res.status(500).json({ error: 'Erro ao criar item próprio' });
    }
});

// ═══════════════════════════════════════════════════════════
// POST /api/engineering/compositions — Criar Composição (PRÓPRIA)
// ═══════════════════════════════════════════════════════════
router.post('/compositions', async (req: any, res: any) => {
    try {
        const { code, description, unit } = req.body;
        const proposalId = req.query.proposalId as string || req.body.proposalId as string || undefined;
        // SEC-02 FIX: Always use authenticated tenantId from middleware
        const tenantId = req.user?.tenantId || req.body.tenantId;
        
        if (!code || !description) {
            return res.status(400).json({ error: 'Código e descrição são obrigatórios' });
        }

        const propriaDb = await getOrCreatePropriaDatabase(prisma, tenantId, proposalId);

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

        compositionCache.flushAll();
        engineeringSearchCache.flushAll();
        logger.info(`[CompositionSave] ✅ POST created PROPRIA: id=${comp.id} code=${comp.code} dbId=${propriaDb.id}`);
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
        const targetDbId = (req.query.databaseId as string) || (req.body.databaseId as string) || (composition?.databaseId as string) || undefined;
        const proposalId = req.query.proposalId as string || req.body.proposalId as string || undefined;

        if (!composition) {
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

        // Flatten all items from groups to update, preserving their groupKey
        const { flatItems, hasGroups } = flattenCompositionGroups(composition);
        logger.info(`[CompositionSave] PUT id=${id} code=${composition.code} flatItems=${flatItems.length} hasGroups=${hasGroups}`);

        let targetCompId = id;
        const tenantId = req.user?.tenantId || composition.tenantId;

        // G12: Targeted cache invalidation — only flush entries related to this composition
        const codeUpper = (composition.code || existing.code || '').toUpperCase();
        compositionCache.flushPattern(key => typeof key === 'string' && key.toUpperCase().includes(codeUpper));
        engineeringSearchCache.flushAll(); // search cache must be fully invalidated since results span multiple compositions



        // Retrieve proposal's target database details if databaseId is provided
        const targetDatabase = targetDbId
            ? await prisma.engineeringDatabase.findUnique({
                where: { id: targetDbId },
                select: { id: true, name: true, uf: true, payrollExemption: true }
            })
            : null;
        if (targetDatabase) {
            logger.info(`[CompositionSave] 🎯 Resolved target database context: name=${targetDatabase.name} uf=${targetDatabase.uf} payrollExemption=${targetDatabase.payrollExemption}`);
        }

        // Setup database and records lookups outside transaction to avoid locks/timeouts
        let basePropria: any = null;
        let officialItems: any[] = [];
        let officialComps: any[] = [];
        let propriaItems: any[] = [];
        let propriaAuxs: any[] = [];
        let existingNonTempItems: any[] = [];
        let existingNonTempAuxs: any[] = [];

        if (hasGroups) {
            basePropria = await getOrCreatePropriaDatabase(prisma, tenantId, proposalId);

            const uniqueDbNames = [...new Set(flatItems.map(item => item._matchedDatabase).filter((name): name is string => !!name && name !== 'PRÓPRIO' && name !== 'PROPRIA'))];

            const officialInputCodes = flatItems
                .filter(item => {
                    const isAux = !!item.auxiliaryCompositionId || !!item.auxiliaryComposition;
                    const dbName = item._matchedDatabase;
                    return !isAux && dbName && dbName !== 'PRÓPRIO' && dbName !== 'PROPRIA';
                })
                .map(item => item.item?.code || item.code)
                .filter(Boolean);

            const officialAuxCodes = flatItems
                .filter(item => {
                    const isAux = !!item.auxiliaryCompositionId || !!item.auxiliaryComposition;
                    const dbName = item._matchedDatabase;
                    return isAux && dbName && dbName !== 'PRÓPRIO' && dbName !== 'PROPRIA';
                })
                .map(item => item.auxiliaryComposition?.code || item.code)
                .filter(Boolean);

            const propriaItemCodes = flatItems
                .filter(item => {
                    const isAux = !!item.auxiliaryCompositionId || !!item.auxiliaryComposition;
                    const itemId = item.item ? item.item.id : item.itemId;
                    return !isAux && itemId && isTempId(itemId) && item.item?.code;
                })
                .map(item => item.item.code)
                .filter(c => c !== 'LIVRE' && c !== 'OBS');

            const propriaAuxCodes = flatItems
                .filter(item => {
                    const isAux = !!item.auxiliaryCompositionId || !!item.auxiliaryComposition;
                    const auxId = item.auxiliaryComposition ? item.auxiliaryComposition.id : item.auxiliaryCompositionId;
                    return isAux && auxId && isTempId(auxId) && item.auxiliaryComposition?.code;
                })
                .map(item => item.auxiliaryComposition.code)
                .filter(c => c !== 'LIVRE');

            const nonTempItemIds = flatItems
                .filter(item => {
                    const isAux = !!item.auxiliaryCompositionId || !!item.auxiliaryComposition;
                    const itemId = item.item ? item.item.id : item.itemId;
                    return !isAux && itemId && !isTempId(itemId);
                })
                .map(item => item.item ? item.item.id : item.itemId);

            const nonTempAuxIds = flatItems
                .filter(item => {
                    const isAux = !!item.auxiliaryCompositionId || !!item.auxiliaryComposition;
                    const auxId = item.auxiliaryComposition ? item.auxiliaryComposition.id : item.auxiliaryCompositionId;
                    return isAux && auxId && !isTempId(auxId);
                })
                .map(item => item.auxiliaryComposition ? item.auxiliaryComposition.id : item.auxiliaryCompositionId);

            // Execute all lookups in parallel outside the transaction
            const [
                rOfficialItems,
                rOfficialComps,
                rPropriaItems,
                rPropriaAuxs,
                rExistingNonTempItems,
                rExistingNonTempAuxs
            ] = await Promise.all([
                officialInputCodes.length > 0
                    ? prisma.engineeringItem.findMany({
                        where: {
                            code: { in: officialInputCodes },
                            database: { name: { in: uniqueDbNames } }
                        },
                        include: { database: true }
                    })
                    : Promise.resolve([]),
                officialAuxCodes.length > 0
                    ? prisma.engineeringComposition.findMany({
                        where: {
                            code: { in: officialAuxCodes },
                            database: { name: { in: uniqueDbNames } }
                        },
                        include: { database: true }
                    })
                    : Promise.resolve([]),
                propriaItemCodes.length > 0
                    ? prisma.engineeringItem.findMany({
                        where: {
                            databaseId: basePropria.id,
                            code: { in: propriaItemCodes }
                        }
                    })
                    : Promise.resolve([]),
                propriaAuxCodes.length > 0
                    ? prisma.engineeringComposition.findMany({
                        where: {
                            databaseId: basePropria.id,
                            code: { in: propriaAuxCodes }
                        }
                    })
                    : Promise.resolve([]),
                nonTempItemIds.length > 0
                    ? prisma.engineeringItem.findMany({
                        where: { id: { in: nonTempItemIds } },
                        include: { database: true }
                    })
                    : Promise.resolve([]),
                nonTempAuxIds.length > 0
                    ? prisma.engineeringComposition.findMany({
                        where: { id: { in: nonTempAuxIds } },
                        include: { database: true }
                    })
                    : Promise.resolve([])
            ]);

            officialItems = rOfficialItems;
            officialComps = rOfficialComps;
            propriaItems = rPropriaItems;
            propriaAuxs = rPropriaAuxs;
            existingNonTempItems = rExistingNonTempItems;
            existingNonTempAuxs = rExistingNonTempAuxs;
        }

        // Sort candidates to prefer newer reference databases (descending order)
        const sortCandidates = (a: any, b: any) => {
            const yearA = a.database?.referenceYear || 0;
            const yearB = b.database?.referenceYear || 0;
            if (yearA !== yearB) return yearB - yearA;
            const monthA = a.database?.referenceMonth || 0;
            const monthB = b.database?.referenceMonth || 0;
            return monthB - monthA;
        };
        officialItems.sort(sortCandidates);
        officialComps.sort(sortCandidates);

        // Setup local maps for quick lookups
        const localPropriaItems = new Map<string, any>();
        for (const item of propriaItems) localPropriaItems.set(item.code, item);

        const localPropriaAuxs = new Map<string, any>();
        for (const aux of propriaAuxs) localPropriaAuxs.set(aux.code, aux);

        const nonTempItemsMap = new Map<string, any>();
        for (const item of existingNonTempItems) nonTempItemsMap.set(item.id, item);

        const nonTempAuxsMap = new Map<string, any>();
        for (const aux of existingNonTempAuxs) nonTempAuxsMap.set(aux.id, aux);

        const metadata = buildCompositionMetadata(composition);

        const newCode = composition.code || existing.code;
        let txBasePropriaId = basePropria?.id;

        // G13: Auto-categorize composition on save
        const autoCategory = classifyComposition(composition.description || existing.description, newCode).category;

        // G14: Collect warnings about skipped items to return to the frontend
        const saveWarnings: string[] = [];
        let savedItemCount = 0;

        // Start a transaction to delete old items and recreate (with expanded timeout of 30s)
        await prisma.$transaction(async (tx: any) => {
            const isGlobalPropria = existing.database.name === 'PROPRIA';
            if (isGlobalPropria && proposalId) {
                const targetDb = await getOrCreatePropriaDatabase(tx, tenantId, proposalId);
                txBasePropriaId = targetDb.id;
                let targetComp = await tx.engineeringComposition.findFirst({
                    where: { databaseId: targetDb.id, code: newCode }
                });
                if (!targetComp) {
                    targetComp = await tx.engineeringComposition.create({
                        data: {
                            code: newCode,
                            description: composition.description || existing.description,
                            unit: composition.unit || existing.unit,
                            totalPrice: composition.totalPrice,
                            databaseId: targetDb.id,
                            metadata: metadata,
                            category: autoCategory
                        }
                    });
                    logger.info(`[CompositionSave] 🐑 Cloned global PROPRIA comp id=${id} code=${newCode} to proposal database ${targetDb.name} with new id=${targetComp.id}`);
                } else {
                    logger.info(`[CompositionSave] 🐑 Found existing target comp code=${newCode} in proposal database ${targetDb.name} id=${targetComp.id}, will overwrite`);
                    await tx.engineeringComposition.update({
                        where: { id: targetComp.id },
                        data: {
                            description: composition.description || existing.description,
                            unit: composition.unit || existing.unit,
                            totalPrice: composition.totalPrice,
                            metadata: metadata,
                            category: autoCategory
                        }
                    });
                }
                targetCompId = targetComp.id;
            } else {
                // If code is changing, check for unique constraint collision
                if (newCode !== existing.code) {
                    const conflicting = await tx.engineeringComposition.findFirst({
                        where: { databaseId: existing.databaseId, code: newCode, id: { not: id } },
                        include: { items: { select: { id: true } } }
                    });
                    if (conflicting) {
                        // Merge: delete the conflicting empty shell (usually created by budget extraction)
                        await tx.engineeringCompositionItem.deleteMany({ where: { compositionId: conflicting.id } });
                        await tx.engineeringComposition.delete({ where: { id: conflicting.id } });
                        logger.info(`[CompositionSave] 🔄 Merged: deleted conflicting shell code=${newCode} id=${conflicting.id} (had ${conflicting.items.length} items)`);
                    }
                }

                await tx.engineeringComposition.update({
                    where: { id },
                    data: {
                        code: newCode,
                        totalPrice: composition.totalPrice !== undefined ? composition.totalPrice : existing.totalPrice,
                        description: composition.description || existing.description,
                        unit: composition.unit || existing.unit,
                        metadata: metadata,
                        category: autoCategory
                    }
                });
            }

            // Sync cost, BDI, precision, unit, and description to any matching EngineeringProposalItem records in this proposal
            if (proposalId) {
                const proposal = await tx.priceProposal.findUnique({
                    where: { id: proposalId },
                    select: { engineeringConfig: true, bdiConfig: true, bdiPercentage: true }
                });

                if (proposal) {
                    const engConfig = proposal.engineeringConfig ? (typeof proposal.engineeringConfig === 'string' ? JSON.parse(proposal.engineeringConfig) : proposal.engineeringConfig) as any : {};
                    const bdiConfig = proposal.bdiConfig ? (typeof proposal.bdiConfig === 'string' ? JSON.parse(proposal.bdiConfig) : proposal.bdiConfig) as any : {};
                    
                    const bdiGlobal = Number(bdiConfig?.bdiGlobal) || Number(proposal.bdiPercentage) || 0;
                    const bdiDiferenciado = !!engConfig?.bdiDiferenciado;
                    const bdiFornecimento = Number(engConfig?.bdiFornecimento) || 0;
                    const precisionConfig = engConfig?.precision || { tipo: 'ROUND', casasDecimais: 2 };

                    const getBdi = (item: any) => {
                        if (bdiDiferenciado && item.bdiCategoria === 'FORNECIMENTO') {
                            return bdiFornecimento;
                        }
                        return bdiGlobal;
                    };

                    const applyPrecision = (value: number, config: any) => {
                        const dec = config?.casasDecimais ?? 2;
                        if (config?.tipo === 'TRUNCATE') {
                            const factor = Math.pow(10, dec);
                            return Math.floor(value * factor + 1e-9) / factor;
                        }
                        return Math.round(value * Math.pow(10, dec)) / Math.pow(10, dec);
                    };

                    const applyBdi = (cost: number, bdi: number, config: any) => {
                        return applyPrecision(cost * (1 + bdi / 100), config);
                    };

                    // Resolve the divisor for the composition
                    const refDiv = composition.referenceDivisor || metadata.referenceDivisor;
                    let divisor = 1;
                    if (refDiv) {
                        if (typeof refDiv === 'object' && refDiv !== null && 'value' in refDiv) {
                            divisor = Number(refDiv.value) || 1;
                        } else if (typeof refDiv === 'number') {
                            divisor = refDiv || 1;
                        } else if (typeof refDiv === 'string') {
                            divisor = parseFloat(refDiv) || 1;
                        }
                    }

                    const rawTotal = composition.totalPrice !== undefined ? composition.totalPrice : existing.totalPrice;
                    const unitCost = divisor > 0 ? applyPrecision(rawTotal / divisor, precisionConfig) : rawTotal;

                    // Fetch all proposal items that match the composition code
                    const matchingItems = await tx.engineeringProposalItem.findMany({
                        where: {
                            proposalId,
                            code: { in: [newCode, existing.code].filter(Boolean) }
                        }
                    });

                    for (const item of matchingItems) {
                        const itemBdi = getBdi(item);
                        const unitPrice = applyPrecision(applyBdi(unitCost, itemBdi, precisionConfig) * (1 - (item.discount || 0) / 100), precisionConfig);
                        const totalPrice = applyPrecision(item.quantity * unitPrice, precisionConfig);

                        // Also refresh priceAudit extractedUnitCost
                        let updatedPriceAudit = item.priceAudit || {};
                        if (typeof updatedPriceAudit === 'string') {
                            try {
                                updatedPriceAudit = JSON.parse(updatedPriceAudit);
                            } catch {
                                updatedPriceAudit = {};
                            }
                        }
                        if (updatedPriceAudit && typeof updatedPriceAudit === 'object') {
                            (updatedPriceAudit as any).extractedUnitCost = unitCost;
                            // Re-run refreshSubmittedPriceAudit inline logic
                            const hasRegimeMismatch = Array.isArray((updatedPriceAudit as any).warnings) && (updatedPriceAudit as any).warnings.some((warning: string) => String(warning).toLowerCase().includes('regime'));
                            const hasDateMismatch = Array.isArray((updatedPriceAudit as any).warnings) && (updatedPriceAudit as any).warnings.some((warning: string) => String(warning).toLowerCase().includes('data-base'));
                            const matchedUnitCost = Number((updatedPriceAudit as any).matchedUnitCost) || 0;
                            
                            if (matchedUnitCost > 0) {
                                const deltaValue = hasRegimeMismatch ? null : unitCost - matchedUnitCost;
                                const deltaPercent = deltaValue !== null && matchedUnitCost > 0 ? (deltaValue / matchedUnitCost) * 100 : null;
                                const hasPriceDelta = !hasRegimeMismatch && deltaValue !== null && Math.abs(deltaValue) > 0.01;
                                const hasBaseWarnings = Array.isArray((updatedPriceAudit as any).warnings) && (updatedPriceAudit as any).warnings.length > 0;
                                
                                let status;
                                if (hasDateMismatch) {
                                    status = 'BASE_INDISPONIVEL';
                                } else if (hasPriceDelta) {
                                    status = 'DIVERGENT';
                                } else if (hasBaseWarnings) {
                                    status = 'BASE_INCOMPATIVEL';
                                } else {
                                    status = 'OK';
                                }
                                
                                (updatedPriceAudit as any).deltaValue = deltaValue;
                                (updatedPriceAudit as any).deltaPercent = deltaPercent;
                                (updatedPriceAudit as any).status = status;
                            }
                        }

                        await tx.engineeringProposalItem.update({
                            where: { id: item.id },
                            data: {
                                description: composition.description || existing.description,
                                unit: composition.unit || existing.unit,
                                unitCost,
                                unitPrice,
                                totalPrice,
                                // CASCA-FIX: Mark that this price was formed from composition items
                                compositionTotalPrice: rawTotal,
                                priceAudit: updatedPriceAudit as any
                            }
                        });
                    }

                    // Also recalculate proposal total value
                    const allProposalItems = await tx.engineeringProposalItem.findMany({
                        where: { proposalId }
                    });
                    const totalValue = allProposalItems
                        .filter((it: any) => it.type !== 'ETAPA' && it.type !== 'SUBETAPA')
                        .reduce((sum: number, it: any) => sum + (Number(it.totalPrice) || 0), 0);

                    await tx.priceProposal.update({
                        where: { id: proposalId },
                        data: { totalValue }
                    });

                    logger.info(`[CompositionSave] 🔄 Sync'd and recalculated ${matchingItems.length} proposal items matching proposalId=${proposalId} and code=${newCode}/${existing.code}. Proposal totalValue=${totalValue}`);
                }
            }

            if (hasGroups) {
                // Delete existing items
                await tx.engineeringCompositionItem.deleteMany({
                    where: { compositionId: targetCompId }
                });

                // Create new items — use proposal-specific or global PROPRIA database
                const txBasePropria = await getOrCreatePropriaDatabase(tx, tenantId, proposalId);
                txBasePropriaId = txBasePropria.id;

                // Loop through flatItems to sync database records
                for (const item of flatItems) {
                    // FIX AUX-LOST-01: Detect auxiliary compositions by the PRESENCE of the
                    // auxiliaryComposition object, not just its .id. When the frontend sends
                    // a newly added aux comp, .id may be undefined/temp, but the object exists.
                    let isAux = !!item.auxiliaryCompositionId || !!item.auxiliaryComposition;
                    let itemId = item.item ? item.item.id : item.itemId;
                    let auxId = item.auxiliaryComposition ? item.auxiliaryComposition.id : item.auxiliaryCompositionId;
                    const dbName = item._matchedDatabase;

                    // 🔗 Look up item/composition in official database if _matchedDatabase is official!
                    if (dbName && dbName !== 'PRÓPRIO' && dbName !== 'PROPRIA') {
                        if (isAux) {
                            const codeToFind = item.auxiliaryComposition?.code || item.code;
                            if (codeToFind) {
                                const codeLower = codeToFind.toLowerCase();
                                let matchedAux = null;
                                if (targetDatabase) {
                                    matchedAux = officialComps.find((c: any) =>
                                        c.code.toLowerCase() === codeLower &&
                                        c.database?.name === dbName &&
                                        (targetDatabase.uf ? c.database?.uf === targetDatabase.uf : true) &&
                                        (typeof targetDatabase.payrollExemption === 'boolean' ? c.database?.payrollExemption === targetDatabase.payrollExemption : true)
                                    );
                                }
                                if (!matchedAux) {
                                    matchedAux = officialComps.find((c: any) =>
                                        c.code.toLowerCase() === codeLower &&
                                        c.database?.name === dbName
                                    );
                                }
                                if (matchedAux) {
                                    auxId = matchedAux.id;
                                    isAux = true;
                                    logger.info(`[CompositionSave] 🔗 Linked temporary aux code=${codeToFind} to official ID=${auxId} in database ${dbName}`);
                                }
                            }
                        } else {
                            const codeToFind = item.item?.code || item.code;
                            if (codeToFind) {
                                const codeLower = codeToFind.toLowerCase();
                                let matchedItem = null;
                                if (targetDatabase) {
                                    matchedItem = officialItems.find((i: any) =>
                                        i.code.toLowerCase() === codeLower &&
                                        i.database?.name === dbName &&
                                        (targetDatabase.uf ? i.database?.uf === targetDatabase.uf : true) &&
                                        (typeof targetDatabase.payrollExemption === 'boolean' ? i.database?.payrollExemption === targetDatabase.payrollExemption : true)
                                    );
                                }
                                if (!matchedItem) {
                                    matchedItem = officialItems.find((i: any) =>
                                        i.code.toLowerCase() === codeLower &&
                                        i.database?.name === dbName
                                    );
                                }
                                if (matchedItem) {
                                    const typeModified = item.item?.type && item.item.type !== matchedItem.type;
                                    if (typeModified) {
                                        let existingOwnItem = localPropriaItems.get(matchedItem.code);
                                        if (!existingOwnItem) {
                                            existingOwnItem = await tx.engineeringItem.findFirst({
                                                where: { databaseId: txBasePropriaId, code: matchedItem.code }
                                            });
                                        }
                                        if (!existingOwnItem) {
                                            existingOwnItem = await tx.engineeringItem.create({
                                                data: {
                                                    databaseId: txBasePropriaId,
                                                    code: matchedItem.code,
                                                    description: item.item?.description || matchedItem.description,
                                                    unit: item.item?.unit || matchedItem.unit,
                                                    type: item.item.type,
                                                    price: item.item?.price !== undefined ? item.item.price : matchedItem.price
                                                }
                                            });
                                            localPropriaItems.set(matchedItem.code, existingOwnItem);
                                            logger.info(`[CompositionSave] 🐑 Cloned official item ${matchedItem.code} to PROPRIA with new type=${item.item.type}`);
                                        } else {
                                            existingOwnItem = await tx.engineeringItem.update({
                                                where: { id: existingOwnItem.id },
                                                data: {
                                                    type: item.item.type,
                                                    description: item.item?.description || existingOwnItem.description,
                                                    unit: item.item?.unit || existingOwnItem.unit,
                                                    price: item.item?.price !== undefined ? item.item.price : existingOwnItem.price
                                                }
                                            });
                                            localPropriaItems.set(matchedItem.code, existingOwnItem);
                                            logger.info(`[CompositionSave] 📝 Updated type of own item ${matchedItem.code} to type=${item.item.type}`);
                                        }
                                        itemId = existingOwnItem.id;
                                        isAux = false;
                                    } else {
                                        itemId = matchedItem.id;
                                        isAux = false;
                                        logger.info(`[CompositionSave] 🔗 Linked temporary item code=${codeToFind} to official ID=${itemId} in database ${dbName}`);
                                    }
                                }
                            }
                        }
                    }

                    // If a user edits an official input inside a PROPRIA composition, the line must
                    // stop pointing at the immutable official EngineeringItem. Otherwise a reload
                    // hydrates item.price from the official table and the user's saved price appears
                    // to vanish after switching proposal versions.
                    if (!isAux && itemId && !isTempId(itemId)) {
                        const dbItem = nonTempItemsMap.get(itemId);
                        const dbNameUpper = String(dbName || '').toUpperCase();
                        const isManualOwnLine = item._baseManuallySet === true ||
                            item._noBaseMatch === true ||
                            dbNameUpper === 'PRÓPRIO' ||
                            dbNameUpper === 'PROPRIA' ||
                            dbNameUpper.startsWith('PROPRIA_');
                        const isDbItemOfficial = dbItem &&
                            dbItem.database?.type !== 'PROPRIA' &&
                            !String(dbItem.database?.name || '').startsWith('PROPRIA');

                        if (dbItem && isDbItemOfficial) {
                            const submittedPrice = Number(item.item?.price ?? dbItem.price) || 0;
                            const submittedUnit = String(item.item?.unit || dbItem.unit || 'UN').trim();
                            const submittedDescription = String(item.item?.description || dbItem.description || '').trim();
                            const submittedType = String(item.item?.type || dbItem.type || 'MATERIAL').trim();
                            const priceChanged = Math.abs((Number(dbItem.price) || 0) - submittedPrice) > 0.01;
                            const unitChanged = submittedUnit.toUpperCase() !== String(dbItem.unit || 'UN').trim().toUpperCase();
                            const descriptionChanged = submittedDescription && submittedDescription !== String(dbItem.description || '').trim();
                            const typeChanged = submittedType && submittedType !== String(dbItem.type || '').trim();

                            if (isManualOwnLine || priceChanged || unitChanged || descriptionChanged || typeChanged) {
                                const resolvedItem = await getOrCreateEngineeringItemWithCollisionCheck(tx, {
                                    databaseId: txBasePropriaId,
                                    code: item.item?.code || dbItem.code,
                                    description: submittedDescription || dbItem.description,
                                    unit: submittedUnit || dbItem.unit,
                                    price: submittedPrice,
                                    type: submittedType || dbItem.type
                                });

                                const ownItem = await tx.engineeringItem.update({
                                    where: { id: resolvedItem.id },
                                    data: {
                                        description: submittedDescription || dbItem.description,
                                        unit: submittedUnit || dbItem.unit,
                                        price: submittedPrice,
                                        type: submittedType || dbItem.type
                                    }
                                });
                                localPropriaItems.set(ownItem.code, ownItem);
                                itemId = ownItem.id;
                                if (item.item) {
                                    item.item.id = ownItem.id;
                                    item.item.code = ownItem.code;
                                    item.item.price = ownItem.price;
                                    item.item.unit = ownItem.unit;
                                    item.item.description = ownItem.description;
                                    item.item.type = ownItem.type;
                                }
                                logger.info(`[CompositionSave] 🐑 Preserved edited official item ${dbItem.code} as PROPRIA item ${ownItem.code} id=${ownItem.id}`);
                            }
                        }
                    }

                    // Skip observation/etapa items that have no real item or composition data
                    if (!itemId && !auxId && !isAux) {
                        const desc = item.item?.description || item.auxiliaryComposition?.description || `coef=${item.coefficient}`;
                        saveWarnings.push(`Item sem referência válida ignorado: "${desc}"`);
                        logger.info(`[CompositionSave] ⏩ Skipping item without itemId/auxId: ${desc}`);
                        continue;
                    }
                    
                    // Dynamically create AI-extracted proprietary inputs
                    if (!isAux && itemId && isTempId(itemId)) {
                        let itemCode = item.item?.code || `AI-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;
                        if (itemCode === 'LIVRE') {
                            itemCode = `LIVRE-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;
                        }
                        if (itemCode === 'OBS' || item.item?.type === 'OBSERVACAO') {
                            itemCode = `OBS-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;
                        }
                        
                        const resolvedItem = await getOrCreateEngineeringItemWithCollisionCheck(tx, {
                            databaseId: txBasePropriaId,
                            code: itemCode,
                            description: item.item?.description || 'Novo Insumo Próprio (IA)',
                            unit: item.item?.unit || 'UN',
                            price: item.item?.price || 0,
                            type: classifyInsumoType(
                                item.item?.description || '',
                                item.item?.unit || 'UN',
                                item.item?.type
                            ).type
                        });
                        itemId = resolvedItem.id;
                        itemCode = resolvedItem.code;
                        if (item.item) item.item.code = itemCode;
                    }

                    // Dynamically create AI-extracted auxiliary compositions
                    if (isAux && auxId && isTempId(auxId)) {
                        let auxCode = item.auxiliaryComposition?.code || `AI-COMP-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;
                        if (auxCode === 'LIVRE') {
                            auxCode = `LIVRE-COMP-${Math.random().toString(36).substring(2, 9).toUpperCase()}`;
                        }
                        
                        let existingAux = localPropriaAuxs.get(auxCode);
                        if (!existingAux) {
                            existingAux = await tx.engineeringComposition.findFirst({
                                where: { databaseId: txBasePropriaId, code: auxCode }
                            });
                        }

                        if (!existingAux) {
                            existingAux = await tx.engineeringComposition.create({
                                data: {
                                    databaseId: txBasePropriaId,
                                    code: auxCode,
                                    description: item.auxiliaryComposition?.description || 'Nova Composição Auxiliar Própria (IA)',
                                    unit: item.auxiliaryComposition?.unit || 'UN',
                                    totalPrice: item.auxiliaryComposition?.totalPrice || 0
                                }
                            });
                            localPropriaAuxs.set(auxCode, existingAux);
                            logger.info(`[CompositionSave] 🆕 Created own composition: code=${auxCode} id=${existingAux.id}`);
                        } else {
                            if (item.auxiliaryComposition?.description && item.auxiliaryComposition.description !== existingAux.description) {
                                existingAux = await tx.engineeringComposition.update({
                                    where: { id: existingAux.id },
                                    data: {
                                        description: item.auxiliaryComposition.description,
                                        unit: item.auxiliaryComposition.unit || existingAux.unit,
                                    }
                                });
                                localPropriaAuxs.set(auxCode, existingAux);
                                logger.info(`[CompositionSave] 📝 Updated own composition description/unit: code=${auxCode} id=${existingAux.id}`);
                            }
                        }
                        auxId = existingAux.id;
                    }

                    // Final validation: skip if we still don't have valid references
                    if (!isAux && !itemId) {
                        const desc = item.item?.description || item.item?.code || 'desconhecido';
                        saveWarnings.push(`Insumo "${desc}" não pôde ser resolvido no banco`);
                        logger.warn(`[CompositionSave] ⚠️ Skipping item with no valid itemId after resolution: ${desc}`);
                        continue;
                    }
                    if (isAux && !auxId) {
                        const desc = item.auxiliaryComposition?.description || item.auxiliaryComposition?.code || 'desconhecido';
                        saveWarnings.push(`Composição auxiliar "${desc}" não pôde ser resolvida`);
                        logger.warn(`[CompositionSave] ⚠️ Skipping aux comp with no valid auxId after resolution: ${desc}`);
                        continue;
                    }

                    // Sanity check of coefficients (e.g. legacy data with 1000 coefficient math contradiction).
                    // Do not mutate coefficients silently here: a saved composition is a financial snapshot,
                    // and automatic scale correction can change a valid CPU without user consent.
                    let coef = Number(item.coefficient) || 0;
                    let price = Number(item.price) || 0;
                    
                    if (coef >= 10 && price > 0) {
                        const unitPrice = isAux ? (item.auxiliaryComposition?.totalPrice || 0) : (item.item?.price || 0);
                        if (unitPrice > 0) {
                            const expectedLinePrice = coef * unitPrice;
                            const priceRatio = expectedLinePrice / price;
                            if (priceRatio >= 99 && priceRatio <= 1001) {
                                const possibleFactors = [100, 1000];
                                for (const factor of possibleFactors) {
                                    if (Math.abs(priceRatio - factor) < 2) {
                                        logger.warn(`[CompositionSave] ⚠️ Detected coefficient scaling anomaly but kept user value: code=${item.item?.code || item.code} coef=${coef} suggested=${coef / factor} price=${price} unitPrice=${unitPrice}`);
                                        break;
                                    }
                                }
                            }
                        }
                    }

                    // Update description of existing proprietary items if they have changed and are not temp
                    if (!isAux && itemId && !isTempId(itemId)) {
                        const dbItem = nonTempItemsMap.get(itemId);
                        if (dbItem && (dbItem.database?.type === 'PROPRIA' || dbItem.database?.name?.startsWith('PROPRIA'))) {
                            const hasDescriptionChanged = item.item?.description && item.item.description !== dbItem.description;
                            const hasPriceChanged = item.item?.price !== undefined && item.item.price !== dbItem.price;
                            const hasUnitChanged = item.item?.unit && item.item.unit !== dbItem.unit;

                            if (hasDescriptionChanged || hasPriceChanged || hasUnitChanged) {
                                if (hasPriceChanged || hasUnitChanged) {
                                    // Price or unit changed, check for collision to avoid leaking changes globally
                                    const resolvedItem = await getOrCreateEngineeringItemWithCollisionCheck(tx, {
                                        databaseId: txBasePropriaId,
                                        code: dbItem.code,
                                        description: item.item.description || dbItem.description,
                                        unit: item.item.unit || dbItem.unit,
                                        price: item.item.price !== undefined ? item.item.price : dbItem.price,
                                        type: dbItem.type
                                    });
                                    itemId = resolvedItem.id;
                                    logger.info(`[CompositionSave] 🔄 Price/unit changed for existing proprietary item ${dbItem.code}. Resolved to ID=${itemId} (code=${resolvedItem.code}) to avoid leakage.`);
                                } else {
                                    const updatedItem = await tx.engineeringItem.update({
                                        where: { id: itemId },
                                        data: {
                                            description: item.item.description || dbItem.description
                                        }
                                    });
                                    nonTempItemsMap.set(itemId, { ...dbItem, ...updatedItem });
                                    logger.info(`[CompositionSave] 📝 Updated own item description: code=${dbItem.code} id=${itemId}`);
                                }
                            }
                        }
                    }

                    // Isolating/cloning auxiliary proprietary compositions to proposal database
                    if (isAux && auxId && !isTempId(auxId)) {
                        const referencedAux = await tx.engineeringComposition.findUnique({
                            where: { id: auxId },
                            include: { database: true }
                        });
                        
                        if (referencedAux && referencedAux.databaseId !== txBasePropriaId) {
                            logger.info(`[CompositionSave] 🐑 Auxiliary composition ID=${auxId} (code=${referencedAux.code}) belongs to database ID=${referencedAux.databaseId}. Cloning to target proposal DB.`);
                            
                            let clonedAux = await tx.engineeringComposition.findFirst({
                                where: { databaseId: txBasePropriaId, code: referencedAux.code }
                            });
                            
                            if (!clonedAux) {
                                clonedAux = await tx.engineeringComposition.create({
                                    data: {
                                        databaseId: txBasePropriaId,
                                        code: referencedAux.code,
                                        description: referencedAux.description,
                                        unit: referencedAux.unit,
                                        totalPrice: referencedAux.totalPrice,
                                        metadata: referencedAux.metadata || undefined
                                    }
                                });
                                
                                const siblingItems = await tx.engineeringCompositionItem.findMany({
                                    where: { compositionId: referencedAux.id }
                                });
                                
                                for (const sib of siblingItems) {
                                    await tx.engineeringCompositionItem.create({
                                        data: {
                                            compositionId: clonedAux.id,
                                            itemId: sib.itemId,
                                            auxiliaryCompositionId: sib.auxiliaryCompositionId,
                                            coefficient: sib.coefficient,
                                            price: sib.price,
                                            groupKey: sib.groupKey,
                                            coefficientExpression: sib.coefficientExpression
                                        }
                                    });
                                }
                                logger.info(`[CompositionSave] 🐑 Successfully cloned auxiliary composition to new ID=${clonedAux.id}`);
                            } else {
                                logger.info(`[CompositionSave] 🐑 Found existing clone ID=${clonedAux.id} in target proposal DB, reusing.`);
                            }
                            auxId = clonedAux.id;
                        }
                    }
                    
                    // Verify FK references exist in memory before inserting (eliminates DB roundtrips)
                    // FIX FK-ORPHAN: When items come from an official composition without _matchedDatabase,
                    // they won't be in our pre-loaded maps. Fall back to a direct DB lookup + auto-clone.
                    if (!isAux && itemId) {
                        const itemExists = nonTempItemsMap.has(itemId) || 
                                           [...localPropriaItems.values()].some((i: any) => i.id === itemId) ||
                                           officialItems.some((i: any) => i.id === itemId);
                        if (!itemExists) {
                            // Fallback: check DB directly — the item may exist but wasn't in our preload scope
                            const dbLookup = await tx.engineeringItem.findUnique({ where: { id: itemId }, include: { database: true } });
                            if (dbLookup) {
                                nonTempItemsMap.set(itemId, dbLookup);
                                logger.info(`[CompositionSave] 🔍 FK-ORPHAN fallback: found item id=${itemId} code=${dbLookup.code} in DB (was missing from preload)`);
                            } else {
                                // Item truly doesn't exist — try to clone by code to PROPRIA
                                const itemCode = item.item?.code;
                                if (itemCode) {
                                    const resolvedItem = await getOrCreateEngineeringItemWithCollisionCheck(tx, {
                                        databaseId: txBasePropriaId,
                                        code: itemCode,
                                        description: item.item?.description || 'Insumo (auto-clone)',
                                        unit: item.item?.unit || 'UN',
                                        price: item.item?.price || 0,
                                        type: item.item?.type || 'MATERIAL'
                                    });
                                    itemId = resolvedItem.id;
                                    localPropriaItems.set(itemCode, resolvedItem);
                                    logger.info(`[CompositionSave] 🐑 FK-ORPHAN: auto-created item code=${itemCode} in PROPRIA id=${resolvedItem.id}`);
                                } else {
                                    saveWarnings.push(`Insumo "${item.item?.code || item.item?.description || itemId}" não encontrado no banco`);
                                    logger.warn(`[CompositionSave] ⚠️ Skipping item: itemId=${itemId} does not exist. Item code=${item.item?.code}`);
                                    continue;
                                }
                            }
                        }
                    }
                    if (isAux && auxId) {
                        const auxExists = nonTempAuxsMap.has(auxId) || 
                                           [...localPropriaAuxs.values()].some((a: any) => a.id === auxId) ||
                                           officialComps.some((a: any) => a.id === auxId);
                        if (!auxExists) {
                            // Fallback: check DB directly
                            const dbLookup = await tx.engineeringComposition.findUnique({ where: { id: auxId }, include: { database: true } });
                            if (dbLookup) {
                                nonTempAuxsMap.set(auxId, dbLookup);
                                logger.info(`[CompositionSave] 🔍 FK-ORPHAN fallback: found aux id=${auxId} code=${dbLookup.code} in DB (was missing from preload)`);
                            } else {
                                // Aux truly doesn't exist — try to auto-create in PROPRIA
                                const auxCode = item.auxiliaryComposition?.code;
                                if (auxCode) {
                                    let existingAux = localPropriaAuxs.get(auxCode);
                                    if (!existingAux) {
                                        existingAux = await tx.engineeringComposition.findFirst({
                                            where: { databaseId: txBasePropriaId, code: auxCode }
                                        });
                                    }
                                    if (!existingAux) {
                                        existingAux = await tx.engineeringComposition.create({
                                            data: {
                                                databaseId: txBasePropriaId,
                                                code: auxCode,
                                                description: item.auxiliaryComposition?.description || 'Composição Auxiliar (auto-clone)',
                                                unit: item.auxiliaryComposition?.unit || 'UN',
                                                totalPrice: item.auxiliaryComposition?.totalPrice || 0
                                            }
                                        });
                                        logger.info(`[CompositionSave] 🐑 FK-ORPHAN: auto-created aux code=${auxCode} in PROPRIA id=${existingAux.id}`);
                                    }
                                    auxId = existingAux.id;
                                    localPropriaAuxs.set(auxCode, existingAux);
                                } else {
                                    saveWarnings.push(`Composição auxiliar "${item.auxiliaryComposition?.code || auxId}" não encontrada no banco`);
                                    logger.warn(`[CompositionSave] ⚠️ Skipping aux: auxId=${auxId} does not exist. Aux code=${item.auxiliaryComposition?.code}`);
                                    continue;
                                }
                            }
                        }
                    }

                    await tx.engineeringCompositionItem.create({
                        data: {
                            compositionId: targetCompId,
                            itemId: isAux ? null : itemId,
                            auxiliaryCompositionId: isAux ? auxId : null,
                            coefficient: item.coefficient,
                            price: item.price,
                            groupKey: item.groupKey || null,
                            coefficientExpression: item.coefficientExpression || null,
                        }
                    });
                    savedItemCount++;
                }
            }
        }, {
            timeout: 30000 // 30s timeout
        });

        logger.info(`[CompositionSave] ✅ PUT complete: id=${targetCompId} code=${composition.code} items=${savedItemCount}/${flatItems.length} saved, warnings=${saveWarnings.length}`);
        res.json({
            message: 'Composição updated com sucesso',
            id: targetCompId,
            savedItems: savedItemCount,
            totalItems: flatItems.length,
            warnings: saveWarnings.length > 0 ? saveWarnings : undefined
        });

    } catch (e: any) {
        console.error('Error updating custom composition:', e);
        res.status(500).json({ error: 'Erro ao atualizar composição própria', details: e.message });
    }
});

// ═══════════════════════════════════════════════════════════
// DELETE /api/engineering/compositions/:id/items
// Limpa todos os itens de uma composição PROPRIA (mantém a casca)
// Permite ao usuário reiniciar a extração IA do zero
// ═══════════════════════════════════════════════════════════
router.delete('/compositions/:id/items', async (req: any, res: any) => {
    try {
        compositionCache.flushAll();
        engineeringSearchCache.flushAll();
        const id = req.params.id;
        const proposalId = req.query.proposalId as string || req.body.proposalId as string || undefined;

        // Verify composition exists and belongs to PROPRIA
        const existing = await prisma.engineeringComposition.findUnique({
            where: { id },
            include: { database: true, items: { select: { id: true } } }
        });

        if (!existing) {
            return res.status(404).json({ error: 'Composição não encontrada' });
        }

        const existingDbName = String(existing.database.name || '').toUpperCase();
        if (existing.database.type !== 'PROPRIA' && existingDbName !== 'PROPRIA' && !existingDbName.startsWith('PROPRIA_')) {
            return res.status(403).json({ error: 'Apenas composições próprias podem ser limpas' });
        }

        // SEC-02: Verify tenant ownership
        if (existing.database.tenantId && req.user?.tenantId && existing.database.tenantId !== req.user.tenantId) {
            return res.status(403).json({ error: 'Composição pertence a outro tenant' });
        }

        const itemCount = existing.items.length;

        let targetId = id;
        const isGlobalPropria = existing.database.name === 'PROPRIA';
        if (isGlobalPropria && proposalId) {
            const tenantId = req.user?.tenantId || existing.database.tenantId;
            const targetDb = await getOrCreatePropriaDatabase(prisma, tenantId, proposalId);
            let targetComp = await prisma.engineeringComposition.findFirst({
                where: { databaseId: targetDb.id, code: existing.code }
            });
            if (!targetComp) {
                targetComp = await prisma.engineeringComposition.create({
                    data: {
                        code: existing.code,
                        description: existing.description,
                        unit: existing.unit,
                        totalPrice: 0,
                        databaseId: targetDb.id,
                        metadata: Prisma.DbNull
                    }
                });
                logger.info(`[CompositionClear] Cloned global shell code=${existing.code} to proposal database ${targetDb.name} with new id=${targetComp.id}`);
            }
            targetId = targetComp.id;
        }

        // Delete all composition items (keep the composition shell) inside a transaction to sync with proposal items
        await prisma.$transaction(async (tx: any) => {
            await tx.engineeringCompositionItem.deleteMany({
                where: { compositionId: targetId }
            });

            // Reset totalPrice to 0 and clear metadata
            await tx.engineeringComposition.update({
                where: { id: targetId },
                data: { 
                    totalPrice: 0,
                    metadata: Prisma.DbNull
                }
            });

            if (proposalId) {
                // Fetch matching items
                const matchingItems = await tx.engineeringProposalItem.findMany({
                    where: {
                        proposalId,
                        code: { in: [existing.code].filter(Boolean) }
                    }
                });

                for (const item of matchingItems) {
                    await tx.engineeringProposalItem.update({
                        where: { id: item.id },
                        data: {
                            unitCost: 0,
                            unitPrice: 0,
                            totalPrice: 0,
                            compositionTotalPrice: 0,
                            sourceName: 'PROPRIA',
                            priceAudit: {
                                status: 'SEM_MATCH',
                                warnings: ['Nenhuma composição analítica foi encontrada.'],
                                confidence: 0,
                                deltaValue: null,
                                matchMethod: 'none',
                                deltaPercent: null,
                                matchedUnitCost: null,
                                extractedUnitCost: 0
                            }
                        }
                    });
                }

                // Recalculate proposal total value
                const allProposalItems = await tx.engineeringProposalItem.findMany({
                    where: { proposalId }
                });
                const totalValue = allProposalItems
                    .filter((it: any) => it.type !== 'ETAPA' && it.type !== 'SUBETAPA')
                    .reduce((sum: number, it: any) => sum + (Number(it.totalPrice) || 0), 0);

                await tx.priceProposal.update({
                    where: { id: proposalId },
                    data: { totalValue }
                });

                logger.info(`[CompositionClear] 🔄 Sync'd proposal items matching proposalId=${proposalId} and code=${existing.code}. Proposal totalValue=${totalValue}`);
            }
        });

        logger.info(`[CompositionClear] ✅ Cleared ${itemCount} items from composition id=${targetId} code=${existing.code}`);
        res.json({ message: `${itemCount} itens removidos da composição`, clearedCount: itemCount, id: targetId });

    } catch (e: any) {
        console.error('Error clearing composition items:', e);
        res.status(500).json({ error: 'Erro ao limpar composição', details: e.message });
    }
});

// ═══════════════════════════════════════════════════════════
// DELETE /api/engineering/compositions/:id — Excluir composição própria
// ═══════════════════════════════════════════════════════════
router.delete('/compositions/:id', async (req: any, res: any) => {
    try {
        compositionCache.flushAll();
        engineeringSearchCache.flushAll();
        const id = req.params.id;

        const existing = await prisma.engineeringComposition.findUnique({
            where: { id },
            include: { database: true, items: { select: { id: true } } }
        });

        if (!existing) {
            return res.status(404).json({ error: 'Composição não encontrada' });
        }

        if (existing.database.type !== 'PROPRIA' && existing.database.name !== 'PROPRIA') {
            return res.status(403).json({ error: 'Apenas composições próprias podem ser excluídas' });
        }

        // SEC-02: Verify tenant ownership
        if (existing.database.tenantId && req.user?.tenantId && existing.database.tenantId !== req.user.tenantId) {
            return res.status(403).json({ error: 'Composição pertence a outro tenant' });
        }

        // Delete all composition items first (cascade)
        await prisma.engineeringCompositionItem.deleteMany({
            where: { compositionId: id }
        });

        // Delete the composition itself
        await prisma.engineeringComposition.delete({
            where: { id }
        });

        // Update counter
        await prisma.engineeringDatabase.update({
            where: { id: existing.databaseId },
            data: { compositionCount: { decrement: 1 } }
        });

        logger.info(`[PropriaManage] 🗑️ Deleted composition: id=${id} code=${existing.code} (${existing.items.length} items)`);
        res.json({ message: `Composição "${existing.code}" excluída com sucesso` });

    } catch (e: any) {
        console.error('Error deleting composition:', e);
        res.status(500).json({ error: 'Erro ao excluir composição', details: e.message });
    }
});

// ═══════════════════════════════════════════════════════════
// GET /api/engineering/items — Listar insumos de uma base
// ═══════════════════════════════════════════════════════════
router.get('/items', async (req: any, res: any) => {
    try {
        const databaseId = req.query.databaseId as string;
        const q = req.query.q as string || '';
        const limit = parseInt(req.query.limit as string) || 100;

        if (!databaseId) {
            return res.status(400).json({ error: 'databaseId é obrigatório' });
        }

        const tenantId = req.user?.tenantId;
        await validateDatabaseOwnership(databaseId, tenantId);

        const cacheKey = `items:list:${databaseId}:${q}:${limit}`;
        const cached = engineeringSearchCache.get(cacheKey);
        if (cached) {
            return res.json(cached);
        }

        const where: any = { databaseId };
        if (q) {
            where.OR = [
                { code: { contains: q, mode: 'insensitive' } },
                { description: { contains: q, mode: 'insensitive' } }
            ];
        }

        const items = await prisma.engineeringItem.findMany({
            where,
            take: limit,
            orderBy: { code: 'asc' },
            include: {
                _count: { select: { compositionRefs: true } }
            }
        });

        engineeringSearchCache.set(cacheKey, items);
        res.json(items);
    } catch (e: any) {
        console.error('Error listing items:', e);
        const status = e.statusCode || 500;
        res.status(status).json({ error: e.message || 'Erro ao listar insumos' });
    }
});

// ═══════════════════════════════════════════════════════════
// PUT /api/engineering/items/:id — Editar insumo próprio
// ═══════════════════════════════════════════════════════════
router.put('/items/:id', async (req: any, res: any) => {
    try {
        compositionCache.flushAll();
        engineeringSearchCache.flushAll();
        const id = req.params.id;
        const { code, description, unit, price, type } = req.body;

        const existing = await prisma.engineeringItem.findUnique({
            where: { id },
            include: { database: true }
        });

        if (!existing) {
            return res.status(404).json({ error: 'Insumo não encontrado' });
        }

        if (existing.database.type !== 'PROPRIA' && existing.database.name !== 'PROPRIA') {
            return res.status(403).json({ error: 'Apenas insumos próprios podem ser editados' });
        }

        if (existing.database.tenantId && req.user?.tenantId && existing.database.tenantId !== req.user.tenantId) {
            return res.status(403).json({ error: 'Insumo pertence a outro tenant' });
        }

        const updated = await prisma.engineeringItem.update({
            where: { id },
            data: {
                ...(code !== undefined && { code }),
                ...(description !== undefined && { description }),
                ...(unit !== undefined && { unit }),
                ...(price !== undefined && { price: parseFloat(price) || 0 }),
                ...(type !== undefined && { type }),
            }
        });

        logger.info(`[PropriaManage] ✏️ Updated item: id=${id} code=${updated.code}`);
        res.json({ message: 'Insumo atualizado com sucesso', item: updated });

    } catch (e: any) {
        console.error('Error updating item:', e);
        res.status(500).json({ error: 'Erro ao atualizar insumo', details: e.message });
    }
});

// ═══════════════════════════════════════════════════════════
// DELETE /api/engineering/items/:id — Excluir insumo próprio
// ═══════════════════════════════════════════════════════════
router.delete('/items/:id', async (req: any, res: any) => {
    try {
        compositionCache.flushAll();
        engineeringSearchCache.flushAll();
        const id = req.params.id;

        const existing = await prisma.engineeringItem.findUnique({
            where: { id },
            include: { database: true, compositionRefs: { select: { id: true } } }
        });

        if (!existing) {
            return res.status(404).json({ error: 'Insumo não encontrado' });
        }

        if (existing.database.type !== 'PROPRIA' && existing.database.name !== 'PROPRIA') {
            return res.status(403).json({ error: 'Apenas insumos próprios podem ser excluídos' });
        }

        if (existing.database.tenantId && req.user?.tenantId && existing.database.tenantId !== req.user.tenantId) {
            return res.status(403).json({ error: 'Insumo pertence a outro tenant' });
        }

        // Delete composition item references that point to this item
        if (existing.compositionRefs.length > 0) {
            await prisma.engineeringCompositionItem.deleteMany({
                where: { itemId: id }
            });
            logger.info(`[PropriaManage] 🔗 Removed ${existing.compositionRefs.length} composition refs for item ${existing.code}`);
        }

        await prisma.engineeringItem.delete({
            where: { id }
        });

        // Update counter
        await prisma.engineeringDatabase.update({
            where: { id: existing.databaseId },
            data: { itemCount: { decrement: 1 } }
        });

        logger.info(`[PropriaManage] 🗑️ Deleted item: id=${id} code=${existing.code} (was in ${existing.compositionRefs.length} compositions)`);
        res.json({ message: `Insumo "${existing.code}" excluído com sucesso`, removedRefs: existing.compositionRefs.length });

    } catch (e: any) {
        console.error('Error deleting item:', e);
        res.status(500).json({ error: 'Erro ao excluir insumo', details: e.message });
    }
});

// ═══════════════════════════════════════════════════════════
// POST /api/engineering/proposals/:proposalId/recalculate-prices
// G1-FIX: Reconcile proposal item prices with actual composition data
// Detects and fixes stale prices (composition edited after budget creation)
// ═══════════════════════════════════════════════════════════
router.post('/proposals/:proposalId/recalculate-prices', async (req: any, res: any) => {
    try {
        const { proposalId } = req.params;
        const tenantId = req.user?.tenantId;

        const proposal = await prisma.priceProposal.findFirst({
            where: { id: proposalId, ...(tenantId ? { tenantId } : {}) },
            select: { id: true, engineeringConfig: true, bdiConfig: true, bdiPercentage: true }
        });
        if (!proposal) return res.status(404).json({ error: 'Proposta não encontrada' });

        const engConfig = proposal.engineeringConfig ? (typeof proposal.engineeringConfig === 'string' ? JSON.parse(proposal.engineeringConfig as string) : proposal.engineeringConfig) as any : {};
        const bdiConfig = proposal.bdiConfig ? (typeof proposal.bdiConfig === 'string' ? JSON.parse(proposal.bdiConfig as string) : proposal.bdiConfig) as any : {};
        const bdiGlobal = Number(bdiConfig?.bdiGlobal) || Number(proposal.bdiPercentage) || 0;
        const bdiDiferenciado = !!engConfig?.bdiDiferenciado;
        const bdiFornecimento = Number(engConfig?.bdiFornecimento) || 0;
        const precisionConfig = engConfig?.precision || { tipo: 'ROUND', casasDecimais: 2 };

        const applyPrecision = (value: number, config: any) => {
            const dec = config?.casasDecimais ?? 2;
            if (config?.tipo === 'TRUNCATE') {
                const factor = Math.pow(10, dec);
                return Math.floor(value * factor + 1e-9) / factor;
            }
            return Math.round(value * Math.pow(10, dec)) / Math.pow(10, dec);
        };
        const applyBdi = (cost: number, bdi: number) => applyPrecision(cost * (1 + bdi / 100), precisionConfig);

        // Get all billable items in proposal
        const items = await prisma.engineeringProposalItem.findMany({
            where: { proposalId },
        });

        // Get all unique codes from items that have compositions
        const compositionCodes = [...new Set(items.filter(i => i.code && i.type !== 'ETAPA' && i.type !== 'SUBETAPA').map(i => i.code!.toUpperCase()))];

        // Batch load compositions matching codes
        const compositions = await prisma.engineeringComposition.findMany({
            where: {
                code: { in: compositionCodes, mode: 'insensitive' }
            },
            include: { database: true, items: { include: { item: true } } }
        });

        const compsByCode = new Map<string, any[]>();
        for (const comp of compositions) {
            const codeKey = comp.code.toUpperCase();
            if (!compsByCode.has(codeKey)) {
                compsByCode.set(codeKey, []);
            }
            compsByCode.get(codeKey)!.push(comp);
        }

        const targetDate = parseDataBaseMonth(engConfig?.dataBase);
        const changes: { itemId: string; code: string; oldUnitCost: number; newUnitCost: number; delta: number }[] = [];

        for (const item of items) {
            if (!item.code || item.type === 'ETAPA' || item.type === 'SUBETAPA') continue;
            const candidates = compsByCode.get(item.code.toUpperCase()) || [];
            if (candidates.length === 0) continue;

            // Use chooseBestCandidate from priceEnricher to find the best composition match
            const bestMatch = chooseBestCandidate(
                candidates.map(c => ({ ...c, matchedPrice: Number(c.totalPrice) || 0 })),
                item,
                engConfig,
                targetDate
            );

            if (!bestMatch) continue;
            const comp = bestMatch.candidate;
            if (!comp) continue;

            // Calculate divisor from composition metadata
            let divisor = 1;
            if (comp.metadata) {
                try {
                    const meta = typeof comp.metadata === 'string' ? JSON.parse(comp.metadata) : comp.metadata;
                    if (meta?.referenceDivisor?.value > 0) divisor = Number(meta.referenceDivisor.value) || 1;
                } catch {}
            }

            // Calculate real sum from composition items
            const realTotal = Array.isArray(comp.items) ? comp.items.reduce((sum: number, ci: any) => {
                if (ci.item) return sum + (ci.item.price * ci.coefficient);
                return sum + (ci.price || 0);
            }, 0) : 0;
            const effectiveTotal = realTotal > 0 ? realTotal : (Number(comp.totalPrice) || 0);
            const newUnitCost = applyPrecision(effectiveTotal / divisor, precisionConfig);
            const oldUnitCost = Number(item.unitCost) || 0;

            if (Math.abs(newUnitCost - oldUnitCost) > 0.01 || oldUnitCost === 0) {
                const itemBdi = bdiDiferenciado && (item as any).bdiCategoria === 'FORNECIMENTO' ? bdiFornecimento : bdiGlobal;
                const unitPrice = applyBdi(newUnitCost, itemBdi);
                const totalPrice = applyPrecision(item.quantity * unitPrice, precisionConfig);

                const isOfficial = comp.database?.type === 'OFICIAL';

                await prisma.engineeringProposalItem.update({
                    where: { id: item.id },
                    data: {
                        unitCost: newUnitCost,
                        unitPrice,
                        totalPrice,
                        compositionTotalPrice: effectiveTotal,
                        priceOrigin: isOfficial ? 'BASE' : 'PROPRIA'
                    }
                });

                changes.push({
                    itemId: item.id,
                    code: item.code,
                    oldUnitCost,
                    newUnitCost,
                    delta: newUnitCost - oldUnitCost
                });
            }
        }

        // Recalculate proposal total if any changes were made
        if (changes.length > 0) {
            const allItems = await prisma.engineeringProposalItem.findMany({ where: { proposalId } });
            const totalValue = allItems
                .filter((it: any) => it.type !== 'ETAPA' && it.type !== 'SUBETAPA')
                .reduce((sum: number, it: any) => sum + (Number(it.totalPrice) || 0), 0);
            await prisma.priceProposal.update({ where: { id: proposalId }, data: { totalValue } });
            logger.info(`[RecalculatePrices] ✅ Reconciled ${changes.length} items in proposal ${proposalId}. New total: ${totalValue}`);
        }

        res.json({
            message: `${changes.length} preço(s) reconciliado(s)`,
            changes,
            totalChanges: changes.length
        });
    } catch (e: any) {
        logger.error('[RecalculatePrices] Error:', e);
        res.status(500).json({ error: 'Erro ao reconciliar preços', details: e.message });
    }
});

// ═══════════════════════════════════════════════════════════
// POST /api/engineering/propria/cleanup — Limpeza batch da base própria
// Remove itens órfãos e composições vazias
// ═══════════════════════════════════════════════════════════
router.post('/propria/cleanup', async (req: any, res: any) => {
    try {
        compositionCache.flushAll();
        engineeringSearchCache.flushAll();
        const tenantId = req.user?.tenantId;
        if (!tenantId) return res.status(401).json({ error: 'Não autenticado' });

        const proposalId = req.query.proposalId as string || req.body.proposalId as string || undefined;
        const targetDbName = getPropriaDatabaseName(proposalId);
        const propriaDb = await prisma.engineeringDatabase.findFirst({
            where: { name: targetDbName, tenantId }
        });

        if (!propriaDb) return res.json({ message: 'Base própria não encontrada', cleaned: { compositions: 0, items: 0 } });

        // 1. Find and remove empty compositions (0 items)
        const emptyComps = await prisma.engineeringComposition.findMany({
            where: { databaseId: propriaDb.id },
            include: { _count: { select: { items: true } } }
        });
        const compsToDelete = emptyComps.filter(c => c._count.items === 0);
        let deletedComps = 0;
        for (const c of compsToDelete) {
            await prisma.engineeringComposition.delete({ where: { id: c.id } });
            deletedComps++;
        }

        // 2. Find and remove orphan items (not referenced by any composition)
        const allItems = await prisma.engineeringItem.findMany({
            where: { databaseId: propriaDb.id },
            include: { _count: { select: { compositionRefs: true } } }
        });
        const orphanItems = allItems.filter(i => i._count.compositionRefs === 0);
        let deletedItems = 0;
        for (const i of orphanItems) {
            await prisma.engineeringItem.delete({ where: { id: i.id } });
            deletedItems++;
        }

        // 3. Update counters
        const [remainingComps, remainingItems] = await Promise.all([
            prisma.engineeringComposition.count({ where: { databaseId: propriaDb.id } }),
            prisma.engineeringItem.count({ where: { databaseId: propriaDb.id } }),
        ]);
        await prisma.engineeringDatabase.update({
            where: { id: propriaDb.id },
            data: { compositionCount: remainingComps, itemCount: remainingItems }
        });

        logger.info(`[PropriaCleanup] 🧹 Cleaned: ${deletedComps} empty compositions, ${deletedItems} orphan items. Remaining: ${remainingComps} comps, ${remainingItems} items`);
        res.json({
            message: `Limpeza concluída: ${deletedComps} composições vazias e ${deletedItems} insumos órfãos removidos`,
            cleaned: { compositions: deletedComps, items: deletedItems },
            remaining: { compositions: remainingComps, items: remainingItems }
        });

    } catch (e: any) {
        console.error('Error cleaning propria:', e);
        res.status(500).json({ error: 'Erro ao limpar base própria', details: e.message });
    }
});


// ═══════════════════════════════════════════════════════════
// POST /api/engineering/bases/:databaseId/reclassify
// Reclassify items and compositions in a database using the centralized classifiers
// ═══════════════════════════════════════════════════════════
router.post('/bases/:databaseId/reclassify', async (req: any, res: any) => {
    try {
        const user = req.user;
        if (user?.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Apenas SUPER_ADMIN pode reclassificar bases' });
        }

        const { databaseId } = req.params;
        const { scope = 'all' } = req.body; // 'items' | 'compositions' | 'all'

        const database = await prisma.engineeringDatabase.findUnique({ where: { id: databaseId } });
        if (!database) {
            return res.status(404).json({ error: 'Base não encontrada' });
        }

        logger.info(`[Reclassify] 🔄 Starting reclassification of "${database.name}" (${database.uf || 'N/A'}), scope=${scope}`);

        const report: any = {
            database: { id: database.id, name: database.name, uf: database.uf },
            scope,
            items: { processed: 0, changed: 0, byType: { MAO_DE_OBRA: 0, EQUIPAMENTO: 0, SERVICO: 0, MATERIAL: 0 } },
            compositions: { processed: 0, changed: 0, byCategory: {} as Record<string, number> },
        };

        // ── Reclassify Items ──
        if (scope === 'items' || scope === 'all') {
            const BATCH = 5000;
            let offset = 0;
            while (true) {
                const items = await prisma.engineeringItem.findMany({
                    where: { databaseId },
                    select: { id: true, description: true, unit: true, type: true },
                    skip: offset,
                    take: BATCH,
                });
                if (!items.length) break;

                for (const item of items) {
                    const classification = classifyInsumoType(item.description, item.unit);
                    if (classification.type !== item.type && classification.confidence !== 'LOW') {
                        await prisma.engineeringItem.update({
                            where: { id: item.id },
                            data: { type: classification.type },
                        });
                        report.items.changed++;
                        report.items.byType[classification.type] = (report.items.byType[classification.type] || 0) + 1;
                    }
                }
                report.items.processed += items.length;
                offset += BATCH;

                if (offset % 50000 === 0) {
                    logger.info(`[Reclassify] Items: ${offset} processed, ${report.items.changed} changed`);
                }
            }
        }

        // ── Reclassify Compositions ──
        if (scope === 'compositions' || scope === 'all') {
            const BATCH = 2000;
            let offset = 0;
            while (true) {
                const compositions = await prisma.engineeringComposition.findMany({
                    where: { databaseId },
                    select: { id: true, code: true, description: true, category: true },
                    skip: offset,
                    take: BATCH,
                });
                if (!compositions.length) break;

                for (const comp of compositions) {
                    const classification = classifyComposition(comp.description, comp.code);
                    const currentCategory = comp.category || 'GERAL';
                    if (classification.category !== currentCategory && classification.confidence !== 'LOW') {
                        await prisma.engineeringComposition.update({
                            where: { id: comp.id },
                            data: { category: classification.category },
                        });
                        report.compositions.changed++;
                        report.compositions.byCategory[classification.category] = (report.compositions.byCategory[classification.category] || 0) + 1;
                    }
                }
                report.compositions.processed += compositions.length;
                offset += BATCH;

                if (offset % 10000 === 0) {
                    logger.info(`[Reclassify] Compositions: ${offset} processed, ${report.compositions.changed} changed`);
                }
            }
        }

        logger.info(`[Reclassify] ✅ Done "${database.name}": ${report.items.changed} items + ${report.compositions.changed} compositions reclassified`);
        res.json({
            message: `Reclassificação concluída: ${report.items.changed} insumos e ${report.compositions.changed} composições alterados`,
            report,
        });

    } catch (e: any) {
        logger.error(`[Reclassify] ❌ Error: ${e.message}`);
        res.status(500).json({ error: 'Erro ao reclassificar', details: e.message });
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
        const tenantId = req.user?.tenantId;
        await validateProposalOwnership(proposalId, tenantId);

        // 1. Load all engineering items for this proposal
        const proposalItems = await prisma.engineeringProposalItem.findMany({
            where: { proposalId },
            orderBy: { sortOrder: 'asc' },
        });

        if (proposalItems.length === 0) {
            return res.json({ insumos: [], stats: { totalInsumos: 0, totalCusto: 0 } });
        }

        // 2. Load compositions in batch to avoid N+1 queries
        const rawInsumos: any[] = [];
        const uniqueCodes = Array.from(new Set(proposalItems.map(i => i.code).filter((c): c is string => !!c && c !== 'N/A')));

        const compositions = uniqueCodes.length > 0 ? await prisma.engineeringComposition.findMany({
            where: {
                code: { in: uniqueCodes }
            },
            include: {
                items: { include: { item: true } },
                database: { select: { name: true, uf: true } },
            }
        }) : [];

        // Map compositions by upper-case code for fast in-memory lookup
        const compositionMap = new Map<string, any>();
        for (const comp of compositions) {
            compositionMap.set(comp.code.toUpperCase(), comp);
        }

        for (const item of proposalItems) {
            if (!item.code || item.code === 'N/A') continue;

            const composition = compositionMap.get(item.code.toUpperCase());
            if (!composition) continue;

            const compDbName = composition.database?.name || '';
            const isCompPropriaDb = compDbName === 'PROPRIA' || compDbName.startsWith('PROPRIA_');

            for (const ci of composition.items) {
                if (ci.item) {
                    let unitPrice = ci.item.price;
                    if (isCompPropriaDb && ci.price !== undefined && ci.coefficient > 0) {
                        unitPrice = ci.price / ci.coefficient;
                    }
                    rawInsumos.push({
                        insumoCode: ci.item.code,
                        insumoDescription: ci.item.description,
                        insumoUnit: ci.item.unit,
                        insumoPrice: unitPrice,
                        insumoType: ci.item.type,
                        coefficient: ci.coefficient,
                        compositionCode: composition.code,
                        compositionDescription: composition.description,
                        // FIX-HUB-05: Resolve display base from code pattern when PROPRIA
                        base: resolveDisplayBase(composition.database?.name, item.sourceName, composition.code),
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
                // FIX-05: Track custoTotal as running sum to handle same insumo with different prices across compositions
                existing.custoTotal += raw.insumoPrice * weightedCoef;
                existing.precoOriginal = existing.custoTotal / existing.coeficienteTotal;
                existing.precoFinal = existing.precoOriginal;
                if (!existing.composicoesVinculadas.includes(raw.compositionCode)) {
                    existing.composicoesVinculadas.push(raw.compositionCode);
                }
                if (!existing.composicoesDetalhes) existing.composicoesDetalhes = [];
                existing.composicoesDetalhes.push({ code: raw.compositionCode, description: raw.compositionDescription });
            } else {
                // FIX-HUB-03: Use intelligent classifier instead of raw normalizeInsumoType
                const dbType = normalizeInsumoType(raw.insumoType);
                const classification = classifyInsumoType(raw.insumoDescription, raw.insumoUnit, raw.insumoType);
                // Use classifier result when DB type is default MATERIAL but classifier found something better
                const finalCategoria = (dbType === 'MATERIAL' && classification.type !== 'MATERIAL' && classification.confidence !== 'LOW')
                    ? classification.type
                    : dbType;
                consolidated.set(key, {
                    id: key,
                    codigo: raw.insumoCode,
                    descricao: raw.insumoDescription,
                    categoria: finalCategoria,
                    tipoDetalhado: raw.insumoType,
                    tipoConfianca: classification.confidence,
                    tipoOrigem: classification.source,
                    unidade: raw.insumoUnit,
                    precoOriginal: raw.insumoPrice,
                    desconto: 0,
                    precoFinal: raw.insumoPrice,
                    base: raw.base,
                    composicoesVinculadas: [raw.compositionCode],
                    composicoesDetalhes: [{ code: raw.compositionCode, description: raw.compositionDescription }],
                    coeficienteTotal: weightedCoef,
                    custoTotal: raw.insumoPrice * weightedCoef,
                });
            }
        }

        // Build final array with already-tracked custoTotal rounded
        const insumos = Array.from(consolidated.values()).map(ins => ({
            ...ins,
            custoTotal: Math.round(ins.custoTotal * 100) / 100,
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
        const status = e.statusCode || 500;
        res.status(status).json({ error: 'Erro ao consolidar insumos', details: e.message });
    }
});

// ═══════════════════════════════════════════════════════════
// GET /api/engineering/proposals/:id/health-check
// Auditoria matemática Hub de Insumos ↔ Planilha de Orçamento
// ═══════════════════════════════════════════════════════════
router.get('/proposals/:id/health-check', async (req: any, res: any) => {
    try {
        const proposalId = req.params.id;
        const tenantId = req.user?.tenantId;
        await validateProposalOwnership(proposalId, tenantId);

        // 1. Load all engineering items for this proposal
        const proposalItems = await prisma.engineeringProposalItem.findMany({
            where: { proposalId },
            orderBy: { sortOrder: 'asc' },
        });

        if (proposalItems.length === 0) {
            return res.json({ status: 'OK', budgetTotal: 0, insumosTotal: 0, difference: 0, divergences: [] });
        }

        // 2. Load compositions in batch to avoid N+1 queries
        const uniqueCodes = Array.from(new Set(proposalItems.map(i => i.code).filter((c): c is string => !!c && c !== 'N/A')));

        const compositions = uniqueCodes.length > 0 ? await prisma.engineeringComposition.findMany({
            where: { code: { in: uniqueCodes } },
            include: {
                items: { include: { item: true } },
                database: { select: { name: true, uf: true } },
            }
        }) : [];

        // Map compositions by upper-case code for fast in-memory lookup
        const compositionMap = new Map<string, any>();
        for (const comp of compositions) {
            compositionMap.set(comp.code.toUpperCase(), comp);
        }

        let budgetTotal = 0;
        let insumosTotal = 0;
        const divergences = [];

        // Track consolidated insumos exactly like insumos-hub does
        const consolidatedInsumos = new Map<string, { price: number; quantity: number }>();

        for (const item of proposalItems) {
            if (item.type === 'ETAPA' || item.type === 'SUBETAPA') continue;
            
            const itemQty = Number(item.quantity) || 1;
            const itemUnitCost = Number(item.unitCost) || 0;
            budgetTotal += itemQty * itemUnitCost;

            const code = (item.code || '').trim();
            if (!code || code === 'N/A') {
                // If there's no composition, the item acts as its own insumo
                const key = (item.code || `ITEM-${item.sortOrder + 1}`).toUpperCase();
                const existing = consolidatedInsumos.get(key);
                if (existing) {
                    existing.quantity += itemQty;
                } else {
                    consolidatedInsumos.set(key, { price: itemUnitCost, quantity: itemQty });
                }
                continue;
            }

            const composition = compositionMap.get(code.toUpperCase());
            if (!composition) {
                // No composition in DB, means it has no sub-items. Item acts as insumo.
                const key = code.toUpperCase();
                const existing = consolidatedInsumos.get(key);
                if (existing) {
                    existing.quantity += itemQty;
                } else {
                    consolidatedInsumos.set(key, { price: itemUnitCost, quantity: itemQty });
                }
                
                divergences.push({
                    itemNumber: item.itemNumber,
                    code: item.code,
                    description: item.description,
                    type: 'MISSING_COMPOSITION',
                    budgetUnitCost: itemUnitCost,
                    compositionUnitCost: 0,
                    difference: itemUnitCost,
                    totalDifference: itemUnitCost * itemQty,
                    message: 'Composição analítica não encontrada no banco de dados.'
                });
                continue;
            }

            const compDbName = composition.database?.name || '';
            const isCompPropriaDb = compDbName === 'PROPRIA' || compDbName.startsWith('PROPRIA_');
            
            const meta = composition.metadata ? (typeof composition.metadata === 'string' ? JSON.parse(composition.metadata) : composition.metadata) as any : {};
            const divisor = Number(meta?.referenceDivisor?.value) || 1;
            const effectiveQty = itemQty / divisor;

            let compositionSimulatedUnitCost = 0;

            for (const ci of composition.items) {
                if (ci.item) {
                    let unitPrice = ci.item.price;
                    if (isCompPropriaDb && ci.price !== undefined && ci.coefficient > 0) {
                        unitPrice = ci.price / ci.coefficient;
                    }
                    
                    compositionSimulatedUnitCost += (ci.coefficient / divisor) * unitPrice;

                    const insumoKey = ci.item.code.toUpperCase();
                    const existing = consolidatedInsumos.get(insumoKey);
                    const weightedQty = ci.coefficient * effectiveQty;
                    if (existing) {
                        existing.quantity += weightedQty;
                    } else {
                        consolidatedInsumos.set(insumoKey, { price: unitPrice, quantity: weightedQty });
                    }
                } else if (ci.auxiliaryCompositionId) {
                    const resolveAuxiliary = async (auxId: string, parentCoef: number) => {
                        const auxComp = await prisma.engineeringComposition.findUnique({
                            where: { id: auxId },
                            include: { items: { include: { item: true } }, database: true },
                        });
                        if (!auxComp) return;

                        const auxDbName = auxComp.database?.name || '';
                        const isAuxPropriaDb = auxDbName === 'PROPRIA' || auxDbName.startsWith('PROPRIA_');

                        const auxMeta = auxComp.metadata ? (typeof auxComp.metadata === 'string' ? JSON.parse(auxComp.metadata) : auxComp.metadata) as any : {};
                        const auxDivisor = Number(auxMeta?.referenceDivisor?.value) || 1;
                        const effectiveParentCoef = parentCoef / auxDivisor;

                        for (const auxCi of auxComp.items) {
                            if (auxCi.item) {
                                let unitPrice = auxCi.item.price;
                                if (isAuxPropriaDb && auxCi.price !== undefined && auxCi.coefficient > 0) {
                                    unitPrice = auxCi.price / auxCi.coefficient;
                                }
                                compositionSimulatedUnitCost += (auxCi.coefficient / divisor) * effectiveParentCoef * unitPrice;

                                const insumoKey = auxCi.item.code.toUpperCase();
                                const existing = consolidatedInsumos.get(insumoKey);
                                const weightedQty = auxCi.coefficient * effectiveQty * effectiveParentCoef;
                                if (existing) {
                                    existing.quantity += weightedQty;
                                } else {
                                    consolidatedInsumos.set(insumoKey, { price: unitPrice, quantity: weightedQty });
                                }
                            } else if (auxCi.auxiliaryCompositionId) {
                                await resolveAuxiliary(auxCi.auxiliaryCompositionId, auxCi.coefficient * effectiveParentCoef);
                            }
                        }
                    };
                    await resolveAuxiliary(ci.auxiliaryCompositionId, ci.coefficient);
                }
            }

            const itemDiff = Math.abs(compositionSimulatedUnitCost - itemUnitCost);
            if (itemDiff > 0.01) {
                divergences.push({
                    itemNumber: item.itemNumber,
                    code: item.code,
                    description: item.description,
                    type: 'PRICE_MISMATCH',
                    budgetUnitCost: itemUnitCost,
                    compositionUnitCost: Math.round(compositionSimulatedUnitCost * 10000) / 10000,
                    difference: Math.round(itemDiff * 10000) / 10000,
                    totalDifference: Math.round((itemDiff * itemQty) * 100) / 100,
                    message: `Custo unitário da planilha (R$ ${itemUnitCost.toFixed(2)}) diverge da soma da composição (R$ ${compositionSimulatedUnitCost.toFixed(2)}).`
                });
            }
        }

        // Calculate insumos total from consolidated map
        for (const [, ins] of consolidatedInsumos) {
            insumosTotal += ins.price * ins.quantity;
        }

        const absoluteDiff = Math.abs(insumosTotal - budgetTotal);
        const status = absoluteDiff <= 1.0 ? 'OK' : 'DIVERGENT';

        res.json({
            status,
            budgetTotal: Math.round(budgetTotal * 100) / 100,
            insumosTotal: Math.round(insumosTotal * 100) / 100,
            difference: Math.round(absoluteDiff * 100) / 100,
            divergences
        });

    } catch (e: any) {
        console.error('[Health Check] Error:', e);
        res.status(500).json({ error: 'Erro ao executar auditoria matemática da proposta', details: e.message });
    }
});

function normalizeInsumoType(type: string): string {
    const upper = (type || '').toUpperCase().trim();
    switch (upper) {
        case 'MÃO DE OBRA':
        case 'MAO DE OBRA':
        case 'MAO_DE_OBRA':
            return 'MAO_DE_OBRA';
            
        case 'MATERIAL':
        case 'EQUIPAMENTO PARA AQUISIÇÃO PERMANENTE':
        case 'EQUIPAMENTO PARA AQUISICAO PERMANENTE':
            return 'MATERIAL';
            
        case 'EQUIPAMENTO':
        case 'ALUGUEL':
        case 'TRANSPORTE':
            return 'EQUIPAMENTO';
            
        case 'SERVIÇOS':
        case 'SERVICOS':
        case 'SERVICO':
        case 'TAXAS':
        case 'ADMINISTRAÇÃO':
        case 'ADMINISTRACAO':
        case 'VERBA':
        case 'CONSULTORIA':
        case 'ENCARGOS COMPLEMENTARES':
        case 'FRANQUIA':
        case 'OUTROS':
            return 'SERVICO';
            
        default:
            // Fallback rules for legacy values
            if (upper.includes('MAO') || upper.includes('MÃO')) return 'MAO_DE_OBRA';
            if (upper.includes('EQUIP') && !upper.includes('PERMANENTE')) return 'EQUIPAMENTO';
            if (upper.includes('MATERIAL')) return 'MATERIAL';
            return 'SERVICO';
    }
}

// ═══════════════════════════════════════════════════════════
// GET /api/engineering/proposals/:id/analytical-report
// Gera o relatório analítico no Padrão TCU (Composições Principais + Auxiliares)
// ═══════════════════════════════════════════════════════════
router.post('/proposals/:id/analytical-report', async (req: any, res: any) => {
    try {
        const proposalId = req.params.id;
        const tenantId = req.user?.tenantId;
        await validateProposalOwnership(proposalId, tenantId);

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
        const status = e.statusCode || 500;
        res.status(status).json({ error: 'Erro ao gerar relatório analítico', details: e.message });
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
        const { items, proposalId } = req.body; // [{ code, quantity, sourceName }], optional proposalId

        if (!Array.isArray(items) || items.length === 0) {
            return res.json({ insumos: [], stats: { totalInsumos: 0, totalCusto: 0 }, mode: 'empty' });
        }

        // Map: insumoCode → consolidated data
        const consolidated = new Map<string, {
            id: string; codigo: string; descricao: string; categoria: string;
            tipoDetalhado?: string;
            tipoConfianca?: string;
            tipoOrigem?: string;
            unidade: string; precoOriginal: number; base: string;
            composicoesVinculadas: string[];
            coeficientesPorComposicao: { compCode: string; coef: number; qty: number }[];
            coeficienteTotal: number;
            custoTotal: number;
        }>();

        let compositionsFound = 0;
        let itemsWithoutComposition = 0;

        for (const clientItem of items) {
            const code = (clientItem.code || '').trim();
            if (!code || code === 'N/A') { itemsWithoutComposition++; continue; }

            // Search composition by code across all databases, prioritizing proposal-specific PROPRIA db
            const codeVariants = buildCompositionCodeVariants(code, clientItem.sourceName);
            const tenantId = req.user?.tenantId;
            let composition = await findBestAnalyticalComposition(codeVariants, undefined, clientItem.sourceName, tenantId, proposalId);
            if (!composition) {
                composition = await findFallbackComposition(codeVariants, undefined, clientItem.sourceName, tenantId, proposalId);
            }

            if (!composition) {
                itemsWithoutComposition++;
                continue;
            }

            compositionsFound++;
            const serviceQty = Number(clientItem.quantity) || 1;
            // FIX-HUB-05: Resolve display base from code pattern when PROPRIA
            const baseName = resolveDisplayBase(composition.database?.name, clientItem.sourceName, composition.code);

            // Check if main composition has reference divisor
            const meta = composition.metadata ? (typeof composition.metadata === 'string' ? JSON.parse(composition.metadata) : composition.metadata) as any : {};
            const divisor = Number(meta?.referenceDivisor?.value) || 1;
            const effectiveServiceQty = serviceQty / divisor;

            // FIX-04: Helper to add an insumo to the consolidated map
            const addInsumo = (insumoCode: string, insumo: any, coef: number, parentCompCode: string, overridePrice?: number) => {
                const insumoKey = insumoCode.toUpperCase();
                const existing = consolidated.get(insumoKey);
                const weightedCoef = coef * effectiveServiceQty;
                const priceToUse = overridePrice !== undefined ? overridePrice : insumo.price;

                if (existing) {
                    existing.coeficienteTotal += weightedCoef;
                    // FIX-05: Track custoTotal as running sum to handle same insumo with different prices across compositions
                    existing.custoTotal += priceToUse * weightedCoef;
                    existing.precoOriginal = existing.custoTotal / existing.coeficienteTotal;
                    existing.coeficientesPorComposicao.push({
                        compCode: parentCompCode,
                        coef,
                        qty: effectiveServiceQty,
                    });
                    if (!existing.composicoesVinculadas.includes(parentCompCode)) {
                        existing.composicoesVinculadas.push(parentCompCode);
                    }
                } else {
                    // FIX-HUB-03: Use intelligent classifier for better type detection
                    const dbType = normalizeInsumoType(insumo.type);
                    const classification = classifyInsumoType(insumo.description, insumo.unit, insumo.type);
                    const finalCategoria = (dbType === 'MATERIAL' && classification.type !== 'MATERIAL' && classification.confidence !== 'LOW')
                        ? classification.type
                        : dbType;

                    const insumoBaseName = resolveDisplayBase(insumo.database?.name, undefined, insumo.code);

                    consolidated.set(insumoKey, {
                        id: insumoKey,
                        codigo: insumo.code,
                        descricao: insumo.description,
                        categoria: finalCategoria,
                        tipoDetalhado: insumo.type,
                        tipoConfianca: classification.confidence,
                        tipoOrigem: classification.source,
                        unidade: insumo.unit,
                        precoOriginal: priceToUse,
                        base: insumoBaseName,
                        composicoesVinculadas: [parentCompCode],
                        coeficientesPorComposicao: [{
                            compCode: parentCompCode,
                            coef,
                            qty: effectiveServiceQty,
                        }],
                        coeficienteTotal: weightedCoef,
                        custoTotal: priceToUse * weightedCoef,
                    });
                }
            };

            // Drill into each insumo of the composition
            const isPropriaDb = baseName === 'PROPRIA' || baseName.startsWith('PROPRIA_');

            for (const ci of composition.items) {
                if (ci.item) {
                    // Direct insumo (material, MO, equipment)
                    let unitPrice = ci.item.price;
                    if (isPropriaDb && ci.price !== undefined && ci.coefficient > 0) {
                        unitPrice = ci.price / ci.coefficient;
                    }
                    addInsumo(ci.item.code, ci.item, ci.coefficient, composition.code, unitPrice);
                } else if (ci.auxiliaryCompositionId) {
                    // FIX-04: Resolve auxiliary composition recursively
                    const visitedAux = new Set<string>();
                    const resolveAuxiliary = async (auxId: string, parentCoef: number, parentCompCode: string) => {
                        if (visitedAux.has(auxId)) return; // Prevent infinite loops
                        visitedAux.add(auxId);

                        const auxComp = await prisma.engineeringComposition.findUnique({
                            where: { id: auxId },
                            include: { items: { include: { item: true } }, database: true },
                        });
                        if (!auxComp) return;

                        const auxDbName = auxComp.database?.name || '';
                        const isAuxPropriaDb = auxDbName === 'PROPRIA' || auxDbName.startsWith('PROPRIA_');

                        // Check if auxiliary composition itself has a reference divisor
                        const auxMeta = auxComp.metadata ? (typeof auxComp.metadata === 'string' ? JSON.parse(auxComp.metadata) : auxComp.metadata) as any : {};
                        const auxDivisor = Number(auxMeta?.referenceDivisor?.value) || 1;
                        const effectiveParentCoef = parentCoef / auxDivisor;

                        for (const auxCi of auxComp.items) {
                            if (auxCi.item) {
                                let unitPrice = auxCi.item.price;
                                if (isAuxPropriaDb && auxCi.price !== undefined && auxCi.coefficient > 0) {
                                    unitPrice = auxCi.price / auxCi.coefficient;
                                }
                                addInsumo(auxCi.item.code, auxCi.item, auxCi.coefficient * effectiveParentCoef, parentCompCode, unitPrice);
                            } else if (auxCi.auxiliaryCompositionId) {
                                await resolveAuxiliary(auxCi.auxiliaryCompositionId, auxCi.coefficient * effectiveParentCoef, parentCompCode);
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
            custoTotal: Math.round(ins.custoTotal * 100) / 100,
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

// POST /api/engineering/proposals/:proposalId/reclassify-insumo
// Reclassifica o tipo de um insumo consolidated e propaga para todas as composições
router.post('/proposals/:proposalId/reclassify-insumo', async (req: any, res: any) => {
    try {
        const { proposalId } = req.params;
        const { insumoCode, newType } = req.body;
        const tenantId = req.user?.tenantId;

        await validateProposalOwnership(proposalId, tenantId);

        if (!insumoCode || !newType) {
            return res.status(400).json({ error: 'Código do insumo e novo tipo são obrigatórios' });
        }

        const basePropria = await getOrCreatePropriaDatabase(prisma, tenantId, proposalId);

        const result = await prisma.$transaction(async (tx: any) => {
            // FIX-HUB-04: Try exact match first, then fuzzy match for suffixed codes (-C1, -H-AJ, etc.)
            let propriaItem = await tx.engineeringItem.findFirst({
                where: { databaseId: basePropria.id, code: insumoCode }
            });

            // If not found by exact match, try searching by code prefix (handles suffixed codes)
            if (!propriaItem) {
                propriaItem = await tx.engineeringItem.findFirst({
                    where: { databaseId: basePropria.id, code: { startsWith: insumoCode } }
                });
                if (propriaItem) {
                    logger.info(`[Reclassify] Found suffixed item: searched "${insumoCode}" → found "${propriaItem.code}"`);
                }
            }

            // Also try across ALL databases for the insumo (not just PROPRIA)
            if (!propriaItem) {
                const anyItem = await tx.engineeringItem.findFirst({
                    where: { code: { equals: insumoCode, mode: 'insensitive' } }
                });
                if (anyItem) {
                    logger.info(`[Reclassify] Item "${insumoCode}" found in other database, cloning to PROPRIA`);
                }
            }

            if (!propriaItem) {
                const officialItem = await tx.engineeringItem.findFirst({
                    where: { code: insumoCode, database: { type: 'OFICIAL' } },
                    include: { database: true }
                });

                if (officialItem) {
                    const resolved = await getOrCreateEngineeringItemWithCollisionCheck(tx, {
                        databaseId: basePropria.id,
                        code: insumoCode,
                        description: officialItem.description,
                        unit: officialItem.unit,
                        price: officialItem.price,
                        type: newType,
                    });
                    propriaItem = await tx.engineeringItem.findUnique({ where: { id: resolved.id } });
                    logger.info(`[Reclassify] Cloned official item ${insumoCode} to own item with type=${newType}`);
                } else {
                    const resolved = await getOrCreateEngineeringItemWithCollisionCheck(tx, {
                        databaseId: basePropria.id,
                        code: insumoCode,
                        description: 'Insumo Reclassificado',
                        unit: 'UN',
                        price: 0,
                        type: newType,
                    });
                    propriaItem = await tx.engineeringItem.findUnique({ where: { id: resolved.id } });
                }
            } else {
                propriaItem = await tx.engineeringItem.update({
                    where: { id: propriaItem.id },
                    data: { type: newType }
                });
                logger.info(`[Reclassify] Updated existing own item ${insumoCode} type to ${newType}`);
            }

            const compositionItems = await tx.engineeringCompositionItem.findMany({
                where: {
                    item: { code: insumoCode }
                },
                include: {
                    composition: {
                        include: { database: true }
                    },
                    item: {
                        include: { database: true }
                    }
                }
            });

            for (const ci of compositionItems) {
                const comp = ci.composition;
                const db = comp.database;

                if (db.type === 'PROPRIA' && db.tenantId === tenantId && db.name !== `PROPRIA_${proposalId}`) {
                    continue;
                }

                if (db.type === 'OFICIAL') {
                    let clonedComp = await tx.engineeringComposition.findFirst({
                        where: { databaseId: basePropria.id, code: comp.code }
                    });

                    if (!clonedComp) {
                        clonedComp = await tx.engineeringComposition.create({
                            data: {
                                databaseId: basePropria.id,
                                code: comp.code,
                                description: comp.description,
                                unit: comp.unit,
                                totalPrice: comp.totalPrice,
                                metadata: comp.metadata || undefined
                            }
                        });

                        const siblingItems = await tx.engineeringCompositionItem.findMany({
                            where: { compositionId: comp.id }
                        });

                        for (const sib of siblingItems) {
                            const isTarget = sib.itemId === ci.itemId;
                            await tx.engineeringCompositionItem.create({
                                data: {
                                    compositionId: clonedComp.id,
                                    itemId: isTarget ? propriaItem.id : sib.itemId,
                                    auxiliaryCompositionId: sib.auxiliaryCompositionId,
                                    coefficient: sib.coefficient,
                                    price: sib.price,
                                    groupKey: sib.groupKey,
                                    coefficientExpression: sib.coefficientExpression
                                }
                            });
                        }

                        await tx.engineeringProposalItem.updateMany({
                            where: { proposalId, code: comp.code },
                            data: { sourceName: 'PROPRIA' }
                        });
                        logger.info(`[Reclassify] Cloned composition ${comp.code} because of insumo reclassification`);
                    } else {
                        await tx.engineeringCompositionItem.updateMany({
                            where: { compositionId: clonedComp.id, itemId: ci.itemId },
                            data: { itemId: propriaItem.id }
                        });
                    }
                } else if (db.name === `PROPRIA_${proposalId}`) {
                    await tx.engineeringCompositionItem.updateMany({
                        where: { compositionId: comp.id, itemId: ci.itemId },
                        data: { itemId: propriaItem.id }
                    });
                }
            }

            return propriaItem;
        });

        compositionCache.flushAll();
        engineeringSearchCache.flushAll();

        res.json({ success: true, insumoId: result.id, type: result.type });

    } catch (e: any) {
        console.error('[Reclassify Insumo] Error:', e);
        res.status(500).json({ error: 'Erro ao reclassificar insumo', details: e.message });
    }
});

// POST /api/engineering/proposals/:proposalId/update-insumo
// Lightweight endpoint for inline editing of insumo price/type/unit from the Hub
router.post('/proposals/:proposalId/update-insumo', async (req: any, res: any) => {
    try {
        const { proposalId } = req.params;
        const { insumoCode, updates } = req.body; // updates: { price?, type?, unit? }
        const tenantId = req.user?.tenantId;

        await validateProposalOwnership(proposalId, tenantId);

        if (!insumoCode || !updates || typeof updates !== 'object') {
            return res.status(400).json({ error: 'Código do insumo e atualizações são obrigatórios' });
        }

        const basePropria = await getOrCreatePropriaDatabase(prisma, tenantId, proposalId);

        // Find the item in PROPRIA db (exact or fuzzy match for suffixed codes)
        let item = await prisma.engineeringItem.findFirst({
            where: { databaseId: basePropria.id, code: insumoCode }
        });

        if (!item) {
            item = await prisma.engineeringItem.findFirst({
                where: { databaseId: basePropria.id, code: { startsWith: insumoCode } }
            });
        }

        // If not found in PROPRIA, clone from any database
        if (!item) {
            const sourceItem = await prisma.engineeringItem.findFirst({
                where: { code: { equals: insumoCode, mode: 'insensitive' } },
                include: { database: true }
            });

            if (sourceItem) {
                const resolved = await getOrCreateEngineeringItemWithCollisionCheck(prisma, {
                    databaseId: basePropria.id,
                    code: insumoCode,
                    description: sourceItem.description,
                    unit: updates.unit || sourceItem.unit,
                    price: updates.price !== undefined ? updates.price : sourceItem.price,
                    type: updates.type || sourceItem.type,
                });
                item = await prisma.engineeringItem.findUnique({ where: { id: resolved.id } });
                logger.info(`[Update Insumo] Cloned item ${insumoCode} from ${sourceItem.database?.name} to PROPRIA`);
            }
        }

        if (!item) {
            return res.status(404).json({ error: `Insumo com código "${insumoCode}" não encontrado` });
        }

        // Build update data
        const updateData: any = {};
        if (updates.price !== undefined && updates.price !== null) updateData.price = Number(updates.price);
        if (updates.type) updateData.type = updates.type;
        if (updates.unit) updateData.unit = updates.unit;

        if (Object.keys(updateData).length === 0) {
            return res.status(400).json({ error: 'Nenhuma atualização fornecida' });
        }

        // Update the item
        const updated = await prisma.engineeringItem.update({
            where: { id: item.id },
            data: updateData,
        });

        // Recalculate price snapshots in all composition items that reference this insumo
        if (updateData.price !== undefined) {
            const compositionItems = await prisma.engineeringCompositionItem.findMany({
                where: { itemId: item.id },
            });
            for (const ci of compositionItems) {
                const newPrice = ci.coefficient * updateData.price;
                await prisma.engineeringCompositionItem.update({
                    where: { id: ci.id },
                    data: { price: newPrice },
                });
            }
            logger.info(`[Update Insumo] Updated ${compositionItems.length} composition item snapshots for ${insumoCode}`);
        }

        compositionCache.flushAll();
        engineeringSearchCache.flushAll();

        logger.info(`[Update Insumo] ✅ Updated ${insumoCode}: ${JSON.stringify(updateData)}`);
        res.json({ success: true, item: updated });

    } catch (e: any) {
        console.error('[Update Insumo] Error:', e);
        res.status(500).json({ error: 'Erro ao atualizar insumo', details: e.message });
    }
});

// POST /api/engineering/proposals/:proposalId/ajuste-inteligente
// Motor de descontos e ajustes baseado em jurisprudência do TCU/TST
router.post('/proposals/:proposalId/ajuste-inteligente', async (req: any, res: any) => {
    try {
        const { proposalId } = req.params;
        const { targetValue, strategy } = req.body; // strategy: 'LINEAR_SEGURO' | 'CURVA_ABC' | 'COEFICIENTES' | 'BDI'
        const tenantId = req.user?.tenantId;

        await validateProposalOwnership(proposalId, tenantId);

        if (!targetValue || isNaN(targetValue) || targetValue <= 0) {
            return res.status(400).json({ error: 'Valor alvo inválido' });
        }

        const proposal = await prisma.priceProposal.findUnique({
            where: { id: proposalId },
            include: { engineeringItems: true }
        });

        if (!proposal) {
            return res.status(404).json({ error: 'Proposta não encontrada' });
        }

        const engineeringConfig = proposal.engineeringConfig ? (typeof proposal.engineeringConfig === 'string' ? JSON.parse(proposal.engineeringConfig) : proposal.engineeringConfig) as any : {};
        const bdiConfig = proposal.bdiConfig ? (typeof proposal.bdiConfig === 'string' ? JSON.parse(proposal.bdiConfig) : proposal.bdiConfig) as any : {};
        
        const bdiGlobal = Number(bdiConfig?.bdiGlobal) || Number(proposal.bdiPercentage) || 0;
        const bdiDiferenciado = !!engineeringConfig?.bdiDiferenciado;
        const bdiFornecimento = Number(engineeringConfig?.bdiFornecimento) || 0;
        const precisionConfig = engineeringConfig?.precision || { tipo: 'ROUND', casasDecimais: 2 };
        
        const getBdi = (item: any) => {
            if (bdiDiferenciado && item.bdiCategoria === 'FORNECIMENTO') {
                return bdiFornecimento;
            }
            return bdiGlobal;
        };

        const applyPrecision = (value: number, config: any) => {
            const dec = config?.casasDecimais ?? 2;
            if (config?.tipo === 'TRUNCATE') {
                const factor = Math.pow(10, dec);
                return Math.floor(value * factor + 1e-9) / factor;
            }
            return Math.round(value * Math.pow(10, dec)) / Math.pow(10, dec);
        };

        const applyBdi = (cost: number, bdi: number, config: any) => {
            return applyPrecision(cost * (1 + bdi / 100), config);
        };

        // 1. STRATEGY: BDI
        if (strategy === 'BDI') {
            let sumFornecimentoPrice = 0;
            let sumObraCost = 0;
            for (const item of proposal.engineeringItems) {
                if (item.type === 'ETAPA' || item.type === 'SUBETAPA') continue;
                const cost = item.unitCost || 0;
                const qty = item.quantity || 0;
                const disc = item.discount || 0;
                const isFornecimento = bdiDiferenciado && item.bdiCategoria === 'FORNECIMENTO';
                
                if (isFornecimento) {
                    const itemUnitPrice = applyBdi(cost, bdiFornecimento, precisionConfig) * (1 - disc / 100);
                    sumFornecimentoPrice += qty * itemUnitPrice;
                } else {
                    const itemFactor = qty * cost * (1 - disc / 100);
                    sumObraCost += itemFactor;
                }
            }

            if (sumObraCost === 0) {
                return res.status(400).json({ error: 'Não há itens com BDI de Obra para reajustar' });
            }

            const targetObraValue = targetValue - sumFornecimentoPrice;
            if (targetObraValue <= 0) {
                return res.status(400).json({ error: 'O valor alvo é muito baixo para o BDI configurado de fornecimento' });
            }

            const newBdiGlobal = ((targetObraValue / sumObraCost) - 1) * 100;
            if (newBdiGlobal < 0) {
                return res.status(400).json({ error: 'O valor alvo resultaria em um BDI negativo. Proposta inexequível!' });
            }

            const updatedBdiConfig = { ...bdiConfig, bdiGlobal: applyPrecision(newBdiGlobal, { tipo: 'ROUND', casasDecimais: 2 }) };

            await prisma.priceProposal.update({
                where: { id: proposalId },
                data: {
                    bdiConfig: updatedBdiConfig,
                    bdiPercentage: updatedBdiConfig.bdiGlobal
                }
            });

            await prisma.$transaction(async (tx: any) => {
                for (const item of proposal.engineeringItems) {
                    if (item.type === 'ETAPA' || item.type === 'SUBETAPA') continue;
                    const itemBdi = bdiDiferenciado && item.bdiCategoria === 'FORNECIMENTO' ? bdiFornecimento : updatedBdiConfig.bdiGlobal;
                    const unitPrice = applyPrecision(applyBdi(item.unitCost, itemBdi, precisionConfig) * (1 - (item.discount || 0) / 100), precisionConfig);
                    await tx.engineeringProposalItem.update({
                        where: { id: item.id },
                        data: {
                            unitPrice,
                            totalPrice: applyPrecision(item.quantity * unitPrice, precisionConfig)
                        }
                    });
                }
            });

            compositionCache.flushAll();
            engineeringSearchCache.flushAll();

            return res.json({ success: true, message: 'BDI reajustado com sucesso' });
        }

        // 2. STRATEGIES THAT MODIFY INSUMOS: LINEAR_SEGURO, CURVA_ABC, COEFICIENTES
        const basePropria = await getOrCreatePropriaDatabase(prisma, tenantId, proposalId);

        const leafInsumos = new Map<string, {
            code: string;
            description: string;
            unit: string;
            type: string;
            price: number;
            totalWeightedQty: number;
            totalCostInProposal: number;
            abcClass?: 'A' | 'B' | 'C';
        }>();

        const visitedComps = new Set<string>();

        const resolveLeafInsumosRecursive = async (compCode: string, parentQty: number, itemBdi: number, itemDiscount: number) => {
            const compKey = compCode.toUpperCase();
            if (visitedComps.has(compKey)) return;
            visitedComps.add(compKey);

            const composition = await prisma.engineeringComposition.findFirst({
                where: {
                    code: compCode,
                    database: {
                        OR: [
                            { type: 'OFICIAL' },
                            { name: `PROPRIA_${proposalId}` }
                        ]
                    }
                },
                include: {
                    items: {
                        include: { item: true }
                    }
                }
            });

            if (!composition) return;

            // Check reference divisor
            const meta = composition.metadata ? (typeof composition.metadata === 'string' ? JSON.parse(composition.metadata) : composition.metadata) as any : {};
            const divisor = Number(meta?.referenceDivisor?.value) || 1;
            const effectiveParentQty = parentQty / divisor;

            for (const ci of composition.items) {
                if (ci.item) {
                    const insumo = ci.item;
                    const codeKey = insumo.code.toUpperCase();
                    const coef = ci.coefficient || 0;
                    const weightedQty = effectiveParentQty * coef;

                    const existing = leafInsumos.get(codeKey);
                    if (existing) {
                        existing.totalWeightedQty += weightedQty;
                        existing.totalCostInProposal += weightedQty * insumo.price;
                    } else {
                        leafInsumos.set(codeKey, {
                            code: insumo.code,
                            description: insumo.description,
                            unit: insumo.unit,
                            type: insumo.type,
                            price: insumo.price,
                            totalWeightedQty: weightedQty,
                            totalCostInProposal: weightedQty * insumo.price
                        });
                    }
                } else if (ci.auxiliaryCompositionId) {
                    const auxComp = await prisma.engineeringComposition.findUnique({
                        where: { id: ci.auxiliaryCompositionId }
                    });
                    if (auxComp) {
                        await resolveLeafInsumosRecursive(auxComp.code, effectiveParentQty * ci.coefficient, itemBdi, itemDiscount);
                    }
                }
            }
        };

        for (const item of proposal.engineeringItems) {
            if (item.type !== 'COMPOSICAO' || !item.code) continue;
            await resolveLeafInsumosRecursive(item.code, item.quantity, getBdi(item), item.discount || 0);
        }

        const insumosList = Array.from(leafInsumos.values());

        insumosList.sort((a, b) => b.totalCostInProposal - a.totalCostInProposal);
        const totalInsumosCost = insumosList.reduce((s, i) => s + i.totalCostInProposal, 0);
        if (totalInsumosCost > 0) {
            let accum = 0;
            for (const ins of insumosList) {
                accum += ins.totalCostInProposal;
                const pct = (accum / totalInsumosCost) * 100;
                ins.abcClass = pct <= 80 ? 'A' : pct <= 95 ? 'B' : 'C';
            }
        }

        const insumoPriceImpacts = new Map<string, number>();
        const insumoIsLaborOrEncargo = new Map<string, boolean>();

        const calculatePriceImpactsRecursive = async (compCode: string, parentQty: number, itemBdi: number, itemDiscount: number) => {
            const comp = await prisma.engineeringComposition.findFirst({
                where: {
                    code: compCode,
                    database: {
                        OR: [
                            { type: 'OFICIAL' },
                            { name: `PROPRIA_${proposalId}` }
                        ]
                    }
                },
                include: { items: { include: { item: true } } }
            });
            if (!comp) return;

            const meta = comp.metadata ? (typeof comp.metadata === 'string' ? JSON.parse(comp.metadata) : comp.metadata) as any : {};
            const divisor = Number(meta?.referenceDivisor?.value) || 1;
            const effectiveParentQty = parentQty / divisor;

            for (const ci of comp.items) {
                if (ci.item) {
                    const ins = ci.item;
                    const codeKey = ins.code.toUpperCase();
                    const coef = ci.coefficient || 0;
                    
                    const metaCat = normalizeInsumoType(ins.type);
                    const isLabor = metaCat === 'MAO_DE_OBRA' || ins.type === 'Encargos Complementares';
                    insumoIsLaborOrEncargo.set(codeKey, isLabor);

                    const factor = (1 + itemBdi / 100) * (1 - itemDiscount / 100);
                    const impact = effectiveParentQty * coef * ins.price * factor;

                    insumoPriceImpacts.set(codeKey, (insumoPriceImpacts.get(codeKey) || 0) + impact);
                } else if (ci.auxiliaryCompositionId) {
                    const aux = await prisma.engineeringComposition.findUnique({
                        where: { id: ci.auxiliaryCompositionId }
                    });
                    if (aux) {
                        await calculatePriceImpactsRecursive(aux.code, effectiveParentQty * ci.coefficient, itemBdi, itemDiscount);
                    }
                }
            }
        };

        for (const item of proposal.engineeringItems) {
            if (item.type !== 'COMPOSICAO' || !item.code) continue;
            await calculatePriceImpactsRecursive(item.code, item.quantity, getBdi(item), item.discount || 0);
        }

        let totalPriceLabor = 0;
        let totalPriceNonLabor = 0;
        let totalPriceNonLaborA = 0;
        let totalPriceNonLaborB = 0;
        let totalPriceNonLaborC = 0;

        for (const ins of insumosList) {
            const codeKey = ins.code.toUpperCase();
            const impact = insumoPriceImpacts.get(codeKey) || 0;
            const isLabor = insumoIsLaborOrEncargo.get(codeKey) || false;

            if (isLabor) {
                totalPriceLabor += impact;
            } else {
                totalPriceNonLabor += impact;
                if (ins.abcClass === 'A') totalPriceNonLaborA += impact;
                else if (ins.abcClass === 'B') totalPriceNonLaborB += impact;
                else totalPriceNonLaborC += impact;
            }
        }

        const currentTotalPrice = totalPriceLabor + totalPriceNonLabor;
        const totalDiscountRequired = currentTotalPrice - targetValue;

        if (totalDiscountRequired <= 0) {
            return res.json({ success: true, message: 'Nenhum reajuste necessário, a proposta já está dentro ou abaixo do valor alvo.' });
        }

        if (targetValue < totalPriceLabor) {
            return res.status(400).json({
                error: `O valor alvo é menor que o custo total da mão de obra obrigatória + encargos (R$ ${totalPriceLabor.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}). Reduzir além deste valor causará desclassificação automática por inexequibilidade trabalhista (Acórdão TCU 1097/2019-Plenário).`
            });
        }

        const insumoDiscountsToApply = new Map<string, number>();
        let coefficientDiscountFactor = 0;

        if (strategy === 'LINEAR_SEGURO') {
            if (totalPriceNonLabor === 0) {
                return res.status(400).json({ error: 'Não há insumos de materiais/equipamentos/serviços para aplicar desconto' });
            }
            const discountPercent = (totalDiscountRequired / totalPriceNonLabor) * 100;
            for (const ins of insumosList) {
                const codeKey = ins.code.toUpperCase();
                const isLabor = insumoIsLaborOrEncargo.get(codeKey) || false;
                insumoDiscountsToApply.set(codeKey, isLabor ? 0 : discountPercent);
            }
        } else if (strategy === 'CURVA_ABC') {
            let discA = totalDiscountRequired * 0.80;
            let discB = totalDiscountRequired * 0.15;
            let discC = totalDiscountRequired * 0.05;

            if (discA > totalPriceNonLaborA) {
                const excess = discA - totalPriceNonLaborA;
                discA = totalPriceNonLaborA;
                discB += excess * 0.75;
                discC += excess * 0.25;
            }
            if (discB > totalPriceNonLaborB) {
                const excess = discB - totalPriceNonLaborB;
                discB = totalPriceNonLaborB;
                discC += excess;
            }
            if (discC > totalPriceNonLaborC) {
                return res.status(400).json({ error: 'O desconto solicitado é muito alto para ser absorvido na curva ABC sem zerar os insumos!' });
            }

            const pctA = totalPriceNonLaborA > 0 ? (discA / totalPriceNonLaborA) * 100 : 0;
            const pctB = totalPriceNonLaborB > 0 ? (discB / totalPriceNonLaborB) * 100 : 0;
            const pctC = totalPriceNonLaborC > 0 ? (discC / totalPriceNonLaborC) * 100 : 0;

            for (const ins of insumosList) {
                const codeKey = ins.code.toUpperCase();
                const isLabor = insumoIsLaborOrEncargo.get(codeKey) || false;
                if (isLabor) {
                    insumoDiscountsToApply.set(codeKey, 0);
                } else {
                    insumoDiscountsToApply.set(codeKey, ins.abcClass === 'A' ? pctA : ins.abcClass === 'B' ? pctB : pctC);
                }
            }
        } else if (strategy === 'COEFICIENTES') {
            if (totalPriceNonLabor === 0) {
                return res.status(400).json({ error: 'Não há insumos de materiais/equipamentos/serviços para aplicar otimização de coeficientes' });
            }
            coefficientDiscountFactor = totalDiscountRequired / totalPriceNonLabor;
        }

        await prisma.$transaction(async (tx: any) => {
            if (strategy === 'LINEAR_SEGURO' || strategy === 'CURVA_ABC') {
                for (const ins of insumosList) {
                    const codeKey = ins.code.toUpperCase();
                    const discount = insumoDiscountsToApply.get(codeKey) || 0;
                    if (discount === 0) continue;

                    let ownItem = await tx.engineeringItem.findFirst({
                        where: { databaseId: basePropria.id, code: ins.code }
                    });

                    if (!ownItem) {
                        const official = await tx.engineeringItem.findFirst({
                            where: { code: ins.code, database: { type: 'OFICIAL' } }
                        });
                        const basePrice = official ? official.price : ins.price;
                        const newPrice = applyPrecision(basePrice * (1 - discount / 100), precisionConfig);
                        ownItem = await tx.engineeringItem.create({
                            data: {
                                databaseId: basePropria.id,
                                code: ins.code,
                                description: ins.description,
                                unit: ins.unit,
                                type: ins.type,
                                price: newPrice
                            }
                        });
                    } else {
                        const newPrice = applyPrecision(ins.price * (1 - discount / 100), precisionConfig);
                        ownItem = await tx.engineeringItem.update({
                            where: { id: ownItem.id },
                            data: { price: newPrice }
                        });
                    }

                    const compsToUpdate = await tx.engineeringCompositionItem.findMany({
                        where: {
                            item: { code: ins.code },
                            composition: {
                                database: {
                                    OR: [
                                        { type: 'OFICIAL' },
                                        { name: `PROPRIA_${proposalId}` }
                                    ]
                                }
                            }
                        },
                        include: { composition: { include: { database: true } } }
                    });

                    for (const ci of compsToUpdate) {
                        const comp = ci.composition;
                        if (comp.database.type === 'OFICIAL') {
                            let clonedComp = await tx.engineeringComposition.findFirst({
                                where: { databaseId: basePropria.id, code: comp.code }
                            });

                            if (!clonedComp) {
                                clonedComp = await tx.engineeringComposition.create({
                                    data: {
                                        databaseId: basePropria.id,
                                        code: comp.code,
                                        description: comp.description,
                                        unit: comp.unit,
                                        totalPrice: comp.totalPrice,
                                        metadata: comp.metadata || undefined
                                    }
                                });

                                const siblingItems = await tx.engineeringCompositionItem.findMany({
                                    where: { compositionId: comp.id }
                                });

                                for (const sib of siblingItems) {
                                    const isTarget = sib.itemId === ci.itemId;
                                    await tx.engineeringCompositionItem.create({
                                        data: {
                                            compositionId: clonedComp.id,
                                            itemId: isTarget ? ownItem.id : sib.itemId,
                                            auxiliaryCompositionId: sib.auxiliaryCompositionId,
                                            coefficient: sib.coefficient,
                                            price: isTarget ? applyPrecision(sib.coefficient * ownItem.price, precisionConfig) : sib.price,
                                            groupKey: sib.groupKey,
                                            coefficientExpression: sib.coefficientExpression
                                        }
                                    });
                                }

                                await tx.engineeringProposalItem.updateMany({
                                    where: { proposalId, code: comp.code },
                                    data: { sourceName: 'PROPRIA' }
                                });
                            } else {
                                await tx.engineeringCompositionItem.updateMany({
                                    where: { compositionId: clonedComp.id, itemId: ci.itemId },
                                    data: {
                                        itemId: ownItem.id,
                                        price: applyPrecision(ci.coefficient * ownItem.price, precisionConfig)
                                    }
                                });
                            }
                        } else if (comp.database.name === `PROPRIA_${proposalId}`) {
                            await tx.engineeringCompositionItem.updateMany({
                                where: { compositionId: comp.id, itemId: ci.itemId },
                                data: {
                                    itemId: ownItem.id,
                                    price: applyPrecision(ci.coefficient * ownItem.price, precisionConfig)
                                }
                            });
                        }
                    }
                }
            }

            if (strategy === 'COEFICIENTES') {
                for (const item of proposal.engineeringItems) {
                    if (item.type !== 'COMPOSICAO' || !item.code) continue;

                    const comp = await tx.engineeringComposition.findFirst({
                        where: {
                            code: item.code,
                            database: {
                                OR: [
                                    { type: 'OFICIAL' },
                                    { name: `PROPRIA_${proposalId}` }
                                ]
                            }
                        },
                        include: { database: true }
                    });

                    if (!comp) continue;

                    let targetCompId = comp.id;

                    if (comp.database.type === 'OFICIAL') {
                        let cloned = await tx.engineeringComposition.findFirst({
                            where: { databaseId: basePropria.id, code: comp.code }
                        });

                        if (!cloned) {
                            cloned = await tx.engineeringComposition.create({
                                data: {
                                    databaseId: basePropria.id,
                                    code: comp.code,
                                    description: comp.description,
                                    unit: comp.unit,
                                    totalPrice: comp.totalPrice,
                                    metadata: comp.metadata || undefined
                                }
                            });

                            const siblings = await tx.engineeringCompositionItem.findMany({
                                where: { compositionId: comp.id },
                                include: { item: true }
                            });

                            for (const sib of siblings) {
                                const isLabor = sib.item ? (normalizeInsumoType(sib.item.type) === 'MAO_DE_OBRA' || sib.item.type === 'Encargos Complementares') : false;
                                const newCoef = isLabor ? sib.coefficient : applyPrecision(sib.coefficient * (1 - coefficientDiscountFactor), { tipo: 'ROUND', casasDecimais: 4 });
                                await tx.engineeringCompositionItem.create({
                                    data: {
                                        compositionId: cloned.id,
                                        itemId: sib.itemId,
                                        auxiliaryCompositionId: sib.auxiliaryCompositionId,
                                        coefficient: newCoef,
                                        price: applyPrecision(newCoef * sib.price / sib.coefficient, precisionConfig),
                                        groupKey: sib.groupKey,
                                        coefficientExpression: sib.coefficientExpression
                                    }
                                });
                            }

                            await tx.engineeringProposalItem.updateMany({
                                where: { proposalId, code: comp.code },
                                data: { sourceName: 'PROPRIA' }
                            });
                            targetCompId = cloned.id;
                        } else {
                            targetCompId = cloned.id;
                        }
                    }

                    const ownItems = await tx.engineeringCompositionItem.findMany({
                        where: { compositionId: targetCompId },
                        include: { item: true }
                    });

                    for (const ownCi of ownItems) {
                        const isLabor = ownCi.item ? (normalizeInsumoType(ownCi.item.type) === 'MAO_DE_OBRA' || ownCi.item.type === 'Encargos Complementares') : false;
                        if (isLabor) continue;

                        const newCoef = applyPrecision(ownCi.coefficient * (1 - coefficientDiscountFactor), { tipo: 'ROUND', casasDecimais: 4 });
                        const unitPrice = ownCi.item ? ownCi.item.price : (ownCi.price / ownCi.coefficient || 0);

                        await tx.engineeringCompositionItem.update({
                            where: { id: ownCi.id },
                            data: {
                                coefficient: newCoef,
                                price: applyPrecision(newCoef * unitPrice, precisionConfig)
                            }
                        });
                    }
                }
            }

            const ownComps = await tx.engineeringComposition.findMany({
                where: { databaseId: basePropria.id },
                include: { items: true }
            });

            for (const oc of ownComps) {
                const totalPrice = oc.items.reduce((s: number, i: any) => s + (i.price || 0), 0);
                await tx.engineeringComposition.update({
                    where: { id: oc.id },
                    data: { totalPrice: applyPrecision(totalPrice, precisionConfig) }
                });
            }

            const updatedProposalItems = await tx.engineeringProposalItem.findMany({
                where: { proposalId }
            });

            let newProposalTotal = 0;

            for (const item of updatedProposalItems) {
                if (item.type === 'ETAPA' || item.type === 'SUBETAPA') continue;
                
                const comp = await tx.engineeringComposition.findFirst({
                    where: {
                        code: item.code,
                        database: {
                            OR: [
                                { type: 'OFICIAL' },
                                { name: `PROPRIA_${proposalId}` }
                            ]
                        }
                    }
                });

                if (comp) {
                    const itemBdi = getBdi(item);
                    const unitCost = comp.totalPrice;
                    const unitPrice = applyPrecision(applyBdi(unitCost, itemBdi, precisionConfig) * (1 - (item.discount || 0) / 100), precisionConfig);
                    const totalPrice = applyPrecision(item.quantity * unitPrice, precisionConfig);

                    await tx.engineeringProposalItem.update({
                        where: { id: item.id },
                        data: {
                            unitCost,
                            unitPrice,
                            totalPrice
                        }
                    });

                    newProposalTotal += totalPrice;
                }
            }

            await tx.priceProposal.update({
                where: { id: proposalId },
                data: { totalValue: newProposalTotal }
            });
        });

        compositionCache.flushAll();
        engineeringSearchCache.flushAll();

        res.json({ success: true, message: 'Ajuste inteligente concluído com sucesso' });

    } catch (e: any) {
        console.error('[Ajuste Inteligente] Error:', e);
        res.status(500).json({ error: 'Erro ao aplicar ajuste inteligente', details: e.message });
    }
});

// GET /api/engineering/proposals/:id/items — Carregar todos os itens
router.get('/proposals/:id/items', async (req: any, res: any) => {
    try {
        const proposalId = req.params.id;
        const tenantId = req.user?.tenantId;
        await validateProposalOwnership(proposalId, tenantId);

        const metaOnly = req.query.metaOnly === '1';

        // PERF-01: metaOnly mode — skip heavy item fetch, only return extractionMeta + itemCount.
        // Used by EngineeringProposalEditor when running inside the Wizard (items already loaded).
        if (metaOnly) {
            const [itemCount, proposal] = await Promise.all([
                prisma.engineeringProposalItem.count({ where: { proposalId } }),
                prisma.priceProposal.findUnique({
                    where: { id: proposalId },
                    select: {
                        biddingProcess: {
                            select: {
                                aiAnalysis: { select: { schemaV2: true } }
                            }
                        }
                    }
                })
            ]);
            let extractionMeta = null;
            if (proposal?.biddingProcess?.aiAnalysis?.schemaV2) {
                const schemaV2 = proposal.biddingProcess.aiAnalysis.schemaV2 as any;
                extractionMeta = schemaV2?._engineeringExtractionMeta || null;
            }
            return res.json({ itemCount, extractionMeta });
        }

        const [items, proposal] = await Promise.all([
            prisma.engineeringProposalItem.findMany({
                where: { proposalId },
                orderBy: { sortOrder: 'asc' }
            }),
            prisma.priceProposal.findUnique({
                where: { id: proposalId },
                select: { 
                    bdiConfig: true, 
                    engineeringConfig: true,
                    biddingProcess: {
                        select: {
                            aiAnalysis: { select: { schemaV2: true } }
                        }
                    }
                }
            })
        ]);
        
        let extractionMeta = null;
        if (proposal?.biddingProcess?.aiAnalysis?.schemaV2) {
            const schemaV2 = proposal.biddingProcess.aiAnalysis.schemaV2 as any;
            extractionMeta = schemaV2?._engineeringExtractionMeta || null;
        }

        res.json({ 
            items, 
            bdiConfig: proposal?.bdiConfig,
            engineeringConfig: proposal?.engineeringConfig,
            extractionMeta
        });
    } catch (e: any) {
        console.error('Error loading engineering items:', e);
        const status = e.statusCode || 500;
        res.status(status).json({ error: e.message || 'Erro ao carregar itens de engenharia' });
    }
});

router.post('/proposals/:id/items', async (req: any, res: any) => {
    try {
        const proposalId = req.params.id;
        const tenantId = req.user?.tenantId;
        await validateProposalOwnership(proposalId, tenantId);

        const { items, bdiConfig, engineeringConfig, cronogramaData } = req.body;

        const oldProposal = await prisma.priceProposal.findUnique({
            where: { id: proposalId },
            select: { engineeringConfig: true, bdiPercentage: true }
        });
        const oldConfig = (oldProposal?.engineeringConfig as any) || {};
        const oldRegime = oldConfig.regimeOneracao || 'DESONERADO';
        const newRegime = engineeringConfig?.regimeOneracao || 'DESONERADO';

        let activeItems = items;
        if (oldRegime !== newRegime && Array.isArray(items) && items.length > 0) {
            const officialItems = items.filter((it: any) => it.type !== 'ETAPA' && it.type !== 'SUBETAPA' && it.sourceName !== 'PROPRIA');
            if (officialItems.length > 0) {
                const tempItems: any[] = officialItems.map((it: any) => ({
                    code: it.code,
                    sourceName: it.sourceName,
                    unitCost: it.unitCost,
                    type: it.type,
                    description: it.description,
                }));

                await enrichWithOfficialPrices(tempItems, engineeringConfig, { tenantId, proposalId });

                const costMap = new Map<string, number>();
                const auditMap = new Map<string, any>();
                for (const enriched of tempItems) {
                    if (enriched.priceAudit?.matchedUnitCost && enriched.priceAudit.matchedUnitCost > 0) {
                        costMap.set(enriched.code, enriched.priceAudit.matchedUnitCost);
                        auditMap.set(enriched.code, enriched.priceAudit);
                    }
                }

                activeItems = items.map((it: any) => {
                    if (it.type !== 'ETAPA' && it.type !== 'SUBETAPA' && it.sourceName !== 'PROPRIA' && costMap.has(it.code)) {
                        const newCost = costMap.get(it.code)!;
                        const newAudit = auditMap.get(it.code);
                        const bdiGlobal = Number(bdiConfig?.bdiGlobal) || Number(oldProposal?.bdiPercentage) || 0;
                        const bdiDiferenciado = !!engineeringConfig?.bdiDiferenciado;
                        const bdiFornecimento = Number(engineeringConfig?.bdiFornecimento) || 0;
                        const itemBdi = bdiDiferenciado && it.bdiCategoria === 'FORNECIMENTO' ? bdiFornecimento : bdiGlobal;
                        
                        const precisionConfig = engineeringConfig?.precision || { tipo: 'ROUND', casasDecimais: 2 };
                        
                        const applyPrecision = (value: number, config: any) => {
                            const dec = config?.casasDecimais ?? 2;
                            const factor = Math.pow(10, dec);
                            if (config?.tipo === 'TRUNCATE') {
                                return Math.floor(value * factor + 1e-9) / factor;
                            }
                            return Math.round(value * factor) / factor;
                        };

                        const upWithoutDiscount = applyPrecision(newCost * (1 + itemBdi / 100), precisionConfig);
                        const unitPrice = applyPrecision(upWithoutDiscount * (1 - (it.discount || 0) / 100), precisionConfig);
                        const totalPrice = applyPrecision(it.quantity * unitPrice, precisionConfig);

                        return {
                            ...it,
                            unitCost: newCost,
                            unitPrice,
                            totalPrice,
                            priceOrigin: 'BASE',
                            priceAudit: newAudit || it.priceAudit,
                        };
                    }
                    return it;
                });
            }
        }

        // Transaction: delete all old items + insert new ones + update BDI config
        // FIX TX-01: Increased timeout from default 5s to 60s — large proposals (80+ items)
        // can take 30-40s to save with price audit enrichment + BDI config update.
        const result = await prisma.$transaction(async (tx) => {
            // Clear existing items for this proposal
            await tx.engineeringProposalItem.deleteMany({
                where: { proposalId }
            });

            // Insert all items
            const created = await tx.engineeringProposalItem.createMany({
                data: activeItems.map((item: any, index: number) => ({
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
                    multiplicationFactor: item.multiplicationFactor != null ? Number(item.multiplicationFactor) || null : null,
                    notes: item.notes || null,
                    discount: item.discount != null ? Number(item.discount) || null : null,
                    calculationMemory: item.calculationMemory || null,
                    // CASCA-FIX: Persist reference and formed prices
                    editalUnitCost: item.editalUnitCost != null ? Number(item.editalUnitCost) || null : null,
                    compositionTotalPrice: item.compositionTotalPrice != null ? Number(item.compositionTotalPrice) || 0 : null,
                    sortOrder: index,
                }))
            });

            // Load existing proposal to get previous cronogramaData if not sent in request
            let activeCronogramaData = cronogramaData;
            if (!activeCronogramaData) {
                const existingProposal = await tx.priceProposal.findUnique({
                    where: { id: proposalId },
                    select: { engineeringConfig: true }
                });
                const existingConfig = (existingProposal?.engineeringConfig as any) || {};
                if (existingConfig.cronogramaData) {
                    activeCronogramaData = existingConfig.cronogramaData;
                }
            }

            if (activeCronogramaData && Array.isArray(activeCronogramaData.etapas)) {
                // Compute subtotals per etapa from child items
                const etapaTotals = new Map<string, { name: string; total: number }>();
                let currentEtapa = '';
                for (const it of activeItems) {
                    if (it.type === 'ETAPA') {
                        currentEtapa = (it.itemNumber || '').split('.')[0] || it.itemNumber || '';
                        if (currentEtapa) {
                            etapaTotals.set(currentEtapa, { name: it.description || '', total: 0 });
                        }
                    } else if (it.type !== 'ETAPA' && it.type !== 'SUBETAPA' && currentEtapa) {
                        const entry = etapaTotals.get(currentEtapa);
                        if (entry) entry.total += Number(it.totalPrice) || 0;
                    }
                }

                const isAutomaticEtapaId = (id: string) => {
                    const num = Number(id);
                    return !isNaN(num) && num < 1000000;
                };

                const prevEtapas = activeCronogramaData.etapas || [];

                // Filter out automatic stages that no longer exist
                const filtered = prevEtapas.filter((e: any) => {
                    if (isAutomaticEtapaId(String(e.id))) {
                        return etapaTotals.has(String(e.id));
                    }
                    return true; // Keep manual stages
                });

                // Update existing stages' valorTotal and name
                const updated = filtered.map((e: any) => {
                    const match = etapaTotals.get(String(e.id));
                    if (match) {
                        return {
                            ...e,
                            valorTotal: match.total,
                            nome: match.name || e.nome,
                        };
                    }
                    return e;
                });

                // Add any missing new automatic stages
                const existingIds = new Set(prevEtapas.map((e: any) => String(e.id)));
                for (const [id, data] of etapaTotals) {
                    if (!existingIds.has(id)) {
                        updated.push({
                            id,
                            nome: data.name,
                            valorTotal: data.total,
                            percentuais: Array(12).fill(0),
                        });
                    }
                }

                activeCronogramaData = {
                    ...activeCronogramaData,
                    etapas: updated,
                };
            }

            // Calculate and update proposal totals (excluding groupers)
            const totalValue = activeItems
                .filter((it: any) => it.type !== 'ETAPA' && it.type !== 'SUBETAPA')
                .reduce((sum: number, it: any) => sum + (Number(it.totalPrice) || 0), 0);

            // FIX ARQ-04: Persist cronograma data alongside engineering config
            const engConfigToSave = {
                ...(engineeringConfig || {}),
                ...(activeCronogramaData ? { cronogramaData: activeCronogramaData } : {})
            };

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
        }, {
            maxWait: 10000,  // max time to acquire connection
            timeout: 60000,  // max time for the transaction to complete
        });

        // PERF-04: Skip redundant findMany after save.
        // The frontend already has the items in memory and only needs the count/message.
        res.json({
            count: result.count,
            totalValue: result.totalValue,
            items: activeItems,
            message: oldRegime !== newRegime
                ? `Regime alterado para ${newRegime}. Custos de mão de obra e composições atualizados.`
                : `${result.count} itens salvos com sucesso`
        });

    } catch (e: any) {
        console.error('Error saving engineering items:', e);
        const status = e.statusCode || 500;
        res.status(status).json({ error: e.message || 'Erro ao salvar itens de engenharia', details: e.message });
    }
});

// DELETE /api/engineering/proposals/:id/items/:itemId — Remover um item
router.delete('/proposals/:id/items/:itemId', async (req: any, res: any) => {
    try {
        const proposalId = req.params.id;
        const itemId = req.params.itemId;
        const tenantId = req.user?.tenantId;
        
        await validateProposalOwnership(proposalId, tenantId);

        const item = await prisma.engineeringProposalItem.findUnique({
            where: { id: itemId },
            select: { proposalId: true }
        });

        if (!item || item.proposalId !== proposalId) {
            return res.status(404).json({ error: 'Item não encontrado nesta proposta' });
        }

        await prisma.engineeringProposalItem.delete({
            where: { id: itemId }
        });
        res.json({ ok: true });
    } catch (e: any) {
        console.error('Error deleting engineering item:', e);
        const status = e.statusCode || 500;
        res.status(status).json({ error: e.message || 'Erro ao remover item' });
    }
});

// GET /api/engineering/proposals/:id/reconciliation-report
router.get('/proposals/:id/reconciliation-report', async (req: any, res: any) => {
    try {
        const proposalId = req.params.id;
        const tenantId = req.user?.tenantId;
        await validateProposalOwnership(proposalId, tenantId);

        const report = await getReconciliationReport(proposalId, tenantId);
        res.json(report);
    } catch (e: any) {
        console.error('[Reconciliation Report] Error:', e);
        const status = e.statusCode || 500;
        res.status(status).json({ error: e.message || 'Erro ao gerar relatório de conciliação' });
    }
});

// POST /api/engineering/proposals/:id/reconcile
router.post('/proposals/:id/reconcile', async (req: any, res: any) => {
    try {
        const proposalId = req.params.id;
        const tenantId = req.user?.tenantId;
        await validateProposalOwnership(proposalId, tenantId);

        const { actionType, alertId } = req.body;
        const result = await reconcileProposal(proposalId, tenantId, actionType, alertId);

        // Flush caches to ensure frontend sees fresh resolved data
        compositionCache.flushAll();
        engineeringSearchCache.flushAll();

        res.json(result);
    } catch (e: any) {
        console.error('[Reconcile Action] Error:', e);
        const status = e.statusCode || 500;
        res.status(status).json({ error: e.message || 'Erro ao executar conciliação', details: e.message });
    }
});

// POST /api/engineering/price-audit
// Recalcula o match dos itens contra as bases oficiais respeitando data-base e regime.
router.post('/price-audit', async (req: any, res: any) => {
    try {
        const { items, engineeringConfig, proposalId } = req.body || {};
        if (!Array.isArray(items)) {
            return res.status(400).json({ error: 'items deve ser um array' });
        }

        const audited = items.map((item: any) => ({ ...item }));
        await enrichWithOfficialPrices(audited, engineeringConfig, { tenantId: req.user?.tenantId, proposalId });

        // FIX AUDIT-01: Log result for diagnostic
        const nonGroupItems = audited.filter((it: any) => it.type !== 'ETAPA' && it.type !== 'SUBETAPA');
        const matched = nonGroupItems.filter((it: any) => it.priceAudit?.matchedUnitCost > 0).length;
        const okCount = nonGroupItems.filter((it: any) => it.priceAudit?.status === 'OK').length;
        const divCount = nonGroupItems.filter((it: any) => it.priceAudit?.status === 'DIVERGENT').length;
        console.log(`[Price Audit] 📊 ${matched}/${nonGroupItems.length} matched (${okCount} OK, ${divCount} DIVERGENT)`);

        res.json({ items: audited, summary: { matched, total: nonGroupItems.length, ok: okCount, divergent: divCount } });
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
        const { biddingId, target } = req.body;
        if (!biddingId) return res.status(400).json({ error: 'biddingId é obrigatório' });
        
        const bdiTarget = target === 'SERVICOS' || target === 'FORNECIMENTO' || target === 'ALL' ? target : 'ALL';
        const bdiData = await extractBdiFromBidding(biddingId, bdiTarget);
        
        if (!bdiData || !bdiData.found) {
            console.log(`[BDI-Route] ❌ BDI não encontrado para ${biddingId} target=${bdiTarget}`);
            return res.json({ found: false, message: 'Nenhuma tabela de BDI explícita encontrada no edital.' });
        }
        
        // Detailed logging of what we're sending to frontend
        console.log(`[BDI-Route] ✅ BDI encontrado: global=${bdiData.globalBdi}%, tcu=${bdiData.tcu ? 'SIM' : 'NÃO'}`);
        if (bdiData.tcu) {
            const t = bdiData.tcu;
            console.log(`[BDI-Route] 📊 TCU: AC=${t.adminCentral} S=${t.seguros} G=${t.garantias} R=${t.riscos} DF=${t.despFinanceiras} L=${t.lucro} PIS=${t.pis} COFINS=${t.cofins} ISS=${t.iss} CSLL=${t.csll}`);
        } else {
            console.log(`[BDI-Route] ⚠️ TCU=null → frontend usará autoDistributeBdi(${bdiData.globalBdi})`);
        }
        
        return res.json({ found: true, data: bdiData });
    } catch (e: any) {
        console.error('[Engineering AI BDI] Error:', e);
        res.status(500).json({ error: 'Erro ao extrair BDI', details: e.message });
    }
});

// ═══════════════════════════════════════════════════════════
// POST /api/engineering/ai-extract-config
// Extrai configurações do orçamento (objeto, UF, bases, data, regime) via IA
// ═══════════════════════════════════════════════════════════
import { extractConfigFromBidding, extractEncargosFromBidding } from '../services/engineering/configAiExtractor';

router.post('/ai-extract-config', async (req: any, res: any) => {
    try {
        const { biddingId } = req.body;
        if (!biddingId) return res.status(400).json({ error: 'biddingId é obrigatório' });
        const data = await extractConfigFromBidding(biddingId);
        if (!data || !data.found) return res.json({ found: false, message: 'Configurações não encontradas no edital.' });
        return res.json({ found: true, data });
    } catch (e: any) {
        console.error('[Engineering AI Config] Error:', e);
        res.status(500).json({ error: 'Erro ao extrair configurações', details: e.message });
    }
});

// ═══════════════════════════════════════════════════════════
// POST /api/engineering/ai-extract-encargos
// Extrai encargos sociais (composição analítica) via IA
// ═══════════════════════════════════════════════════════════
router.post('/ai-extract-encargos', async (req: any, res: any) => {
    try {
        const { biddingId } = req.body;
        if (!biddingId) return res.status(400).json({ error: 'biddingId é obrigatório' });
        const data = await extractEncargosFromBidding(biddingId);
        if (!data || !data.found) {
            const details = data?.details || data?.error || '';
            const message = details
                ? `Encargos sociais não encontrados no edital. ${details}`
                : 'Encargos sociais não encontrados no edital. Tente usar o botão "Colar Imagem" para extrair de uma captura da tabela de encargos.';
            return res.json({ found: false, message });
        }
        // P4: Check for additional encargos tables (e.g., SINAPI + SEINFRA)
        if (data.additionalTables && Array.isArray(data.additionalTables) && data.additionalTables.length > 0) {
            return res.json({ found: true, data, additional: data.additionalTables });
        }
        return res.json({ found: true, data });
    } catch (e: any) {
        console.error('[Engineering AI Encargos] Error:', e);
        res.status(500).json({ error: 'Erro ao extrair encargos', details: e.message });
    }
});

// ═══════════════════════════════════════════════════════════
// POST /api/engineering/ai-extract-encargos-image
// Extrai encargos sociais a partir de imagem (clipboard/upload)
// ═══════════════════════════════════════════════════════════
router.post('/ai-extract-encargos-image', async (req: any, res: any) => {
    try {
        const { imageBase64, mimeType, label } = req.body;
        if (!imageBase64) return res.status(400).json({ error: 'imageBase64 é obrigatório' });
        const { extractEncargosFromImage } = await import('../services/engineering/configAiExtractor');
        const data = await extractEncargosFromImage(imageBase64, mimeType || 'image/png', label);
        if (!data || !data.found) return res.json({ found: false, message: 'Não foi possível extrair encargos da imagem.' });
        return res.json({ found: true, data });
    } catch (e: any) {
        console.error('[Engineering AI Encargos-Image] Error:', e);
        res.status(500).json({ error: 'Erro ao extrair encargos da imagem', details: e.message });
    }
});

// ═══════════════════════════════════════════════════════════
// POST /api/engineering/ai-extract-config-image
// Extrai configurações do orçamento a partir de imagem
// ═══════════════════════════════════════════════════════════
router.post('/ai-extract-config-image', async (req: any, res: any) => {
    try {
        const { imageBase64, mimeType } = req.body;
        if (!imageBase64) return res.status(400).json({ error: 'imageBase64 é obrigatório' });
        const { extractConfigFromImage } = await import('../services/engineering/configAiExtractor');
        const data = await extractConfigFromImage(imageBase64, mimeType || 'image/png');
        if (!data || !data.found) return res.json({ found: false, message: 'Não foi possível extrair configurações da imagem.' });
        return res.json({ found: true, data });
    } catch (e: any) {
        console.error('[Engineering AI Config-Image] Error:', e);
        res.status(500).json({ error: 'Erro ao extrair configurações da imagem', details: e.message });
    }
});

// ═══════════════════════════════════════════════════════════
// POST /api/engineering/ai-extract-bdi-image
// Extrai tabela de BDI a partir de imagem
// ═══════════════════════════════════════════════════════════
router.post('/ai-extract-bdi-image', async (req: any, res: any) => {
    try {
        const { imageBase64, mimeType, isOnerado } = req.body;
        if (!imageBase64) return res.status(400).json({ error: 'imageBase64 é obrigatório' });
        const { extractBdiFromImage } = await import('../services/engineering/configAiExtractor');
        const data = await extractBdiFromImage(imageBase64, mimeType || 'image/png', isOnerado);
        if (!data || !data.found) return res.json({ found: false, message: 'Não foi possível extrair BDI da imagem.' });
        return res.json({ found: true, data });
    } catch (e: any) {
        console.error('[Engineering AI BDI-Image] Error:', e);
        res.status(500).json({ error: 'Erro ao extrair BDI da imagem', details: e.message });
    }
});

// ═══════════════════════════════════════════════════════════
// POST /api/engineering/ai-extract-cronograma-image
// Extrai cronograma físico-financeiro a partir de imagem
// ═══════════════════════════════════════════════════════════
router.post('/ai-extract-cronograma-image', async (req: any, res: any) => {
    try {
        const { imageBase64, mimeType, existingEtapas } = req.body;
        if (!imageBase64) return res.status(400).json({ error: 'imageBase64 é obrigatório' });
        const { extractCronogramaFromImage } = await import('../services/engineering/configAiExtractor');
        const data = await extractCronogramaFromImage(imageBase64, mimeType || 'image/png', existingEtapas);
        if (!data || !data.found) return res.json({ found: false, message: 'Não foi possível extrair cronograma da imagem.' });
        return res.json({ found: true, data });
    } catch (e: any) {
        console.error('[Engineering AI Cronograma-Image] Error:', e);
        res.status(500).json({ error: 'Erro ao extrair cronograma da imagem', details: e.message });
    }
});

// ═══════════════════════════════════════════════════════════
// POST /api/engineering/ai-populate
// Extrai itens de engenharia via IA a partir do edital
// Pipeline: V2 itens_licitados → AI extraction (fallback)
// ═══════════════════════════════════════════════════════════
router.post('/ai-populate', async (req: any, res: any) => {
    try {
        const { textChunk, biddingId, engineeringConfig, forceRefresh, proposalId } = req.body;
        
        let extractionText = textChunk;

        if (biddingId) {
            const bidding = await prisma.biddingProcess.findFirst({
                where: { id: biddingId, tenantId: req.user?.tenantId },
                include: { aiAnalysis: true }
            });

            if (!bidding) {
                console.warn(`[Engineering AI-Populate] ⚠️ BiddingProcess ${biddingId} not found or tenant mismatch`);
                return res.status(404).json({ error: 'Processo licitatório não encontrado' });
            }

            // ═══════════════════════════════════════════════════
            // PASSO 1: Tentar usar dados de engenharia pré-extraídos (Etapa 1.5)
            // A Etapa 1.5 do pipeline PNCP usa o engineeringPromptV1 dedicado
            // para extrair a planilha completa. Se disponível, é SEMPRE superior.
            // ═══════════════════════════════════════════════════
            const schemaV2 = bidding?.aiAnalysis?.schemaV2 as any;
            const extractionMeta = schemaV2?._engineeringExtractionMeta;
            const currentProposal = proposalId
                ? await prisma.priceProposal.findFirst({
                    where: { id: proposalId, tenantId: req.user?.tenantId },
                    select: { id: true, version: true, createdAt: true },
                })
                : null;
            const extractionCacheDate = extractionMeta?.extractedAt ? new Date(extractionMeta.extractedAt) : null;
            const failedCacheStatus = extractionMeta?.status === 'empty_extraction' || extractionMeta?.status === 'quality_quarantine';
            const proposalStartedAfterFailedCache = Boolean(
                currentProposal &&
                failedCacheStatus &&
                extractionCacheDate &&
                !Number.isNaN(extractionCacheDate.getTime()) &&
                currentProposal.createdAt > extractionCacheDate
            );
            const canUseFailedExtractionCache = !forceRefresh && !proposalStartedAfterFailedCache;

            if (proposalStartedAfterFailedCache) {
                console.log(
                    `[Engineering AI-Populate] 🔄 Proposta v${currentProposal?.version} criada após falha ${extractionMeta?.status}; ignorando cache para permitir nova extração.`
                );
            }
            
            // Priority 0: Quarantined extraction must never autopublish cached items.
            // FIX VER-04: We still return the items from quarantine, but with source='quality_quarantine'
            // so the frontend can display them to the user (with a warning) instead of leaving an empty table.
            if (canUseFailedExtractionCache && extractionMeta?.status === 'quality_quarantine') {
                const quarantinedItems = schemaV2?._engineeringBudgetItemsQuarantine || [];
                console.log(`[Engineering AI-Populate] ⚠️ Extração anterior em quarentena. Retornando ${quarantinedItems.length} itens para revisão.`);
                if (quarantinedItems.length > 0) {
                    postClassifyTypes(quarantinedItems);
                    await enrichWithOfficialPrices(quarantinedItems, engineeringConfig, { tenantId: req.user?.tenantId });
                }
                return res.json({
                    items: quarantinedItems,
                    source: 'quality_quarantine',
                    count: quarantinedItems.length,
                    validation: schemaV2?._engineeringValidation || null,
                    diagnostic: schemaV2?._engineeringValidation?.issues || [],
                    message: 'A extração foi colocada em quarentena por baixa qualidade. Revise os alertas antes de publicar itens na proposta.'
                });
            }
            
            // Priority 1: Use _engineeringBudgetItems from Etapa 1.5 (dedicated extraction)
            const engBudgetItems = schemaV2?._engineeringBudgetItems;
            if (Array.isArray(engBudgetItems) && engBudgetItems.length > 0 && !forceRefresh) {
                // Apply post-classification to fix cached items from before the type-fix
                postClassifyTypes(engBudgetItems);
                console.log(`[Engineering AI-Populate] 🏗️ Usando ${engBudgetItems.length} itens da Etapa 1.5 (extração dedicada)`);
                await enrichWithOfficialPrices(engBudgetItems, engineeringConfig, { tenantId: req.user?.tenantId });
                return res.json({ items: engBudgetItems, source: 'v2_engineering_budget', count: engBudgetItems.length });
            }
            
            // Priority 1.1: If extraction ran but found 0 items, check diagnostics to avoid infinite loop
            if (Array.isArray(engBudgetItems) && engBudgetItems.length === 0 && canUseFailedExtractionCache && extractionMeta?.status === 'empty_extraction') {
                console.log(`[Engineering AI-Populate] ⚠️ Extração anterior retornou 0 itens. Repassando diagnóstico ao frontend.`);
                return res.json({ 
                    items: [], 
                    source: 'empty_extraction', 
                    count: 0, 
                    diagnostic: extractionMeta.possibleCauses || [],
                    message: `A IA não encontrou a planilha. Possíveis causas: ${(extractionMeta.possibleCauses || []).join('; ')}`
                });
            }
            
            if (forceRefresh) {
                console.log(`[Engineering AI-Populate] 🔄 forceRefresh=true — invalidando cache e forçando nova extração`);
                // FIX DOC-03: Limpar cache de empty_extraction/quarantine para permitir nova tentativa
                // O schemaV2 está na tabela AiAnalysis (não BiddingProcess!)
                try {
                    const aiAnalysis = await prisma.aiAnalysis.findFirst({
                        where: {
                            biddingProcessId: biddingId,
                            biddingProcess: { tenantId: req.user?.tenantId }
                        }
                    });
                    if (aiAnalysis?.schemaV2) {
                        const schema = aiAnalysis.schemaV2 as any;
                        delete schema._engineeringExtractionMeta;
                        delete schema._engineeringBudgetItems;
                        delete schema._engineeringBudgetItemsQuarantine; // Limpa também a quarentena!
                        delete schema._engineeringValidation;
                        // FIX CACHE-01: Also clear V2 itens_licitados to prevent stale fallback
                        if (schema.proposal_analysis?.itens_licitados) {
                            delete schema.proposal_analysis.itens_licitados;
                            console.log(`[Engineering AI-Populate] 🧹 Também limpou itens_licitados V2 do cache`);
                        }
                        await prisma.aiAnalysis.update({
                            where: { id: aiAnalysis.id },
                            data: { schemaV2: schema }
                        });
                        console.log(`[Engineering AI-Populate] 🧹 Cache de extração limpo para ${biddingId}`);
                    }
                } catch (clearErr: any) {
                    console.warn(`[Engineering AI-Populate] ⚠️ Falha ao limpar cache: ${clearErr.message}`);
                }
            }

            // Priority 2: Use V2 itens_licitados if they have enough items
            // Guard: V2 items must be real budget items, NOT high-level stages/chapters
            // FIX CACHE-01: Skip V2 fallback entirely when forceRefresh is true — we want a fresh AI extraction
            const itensV2 = forceRefresh ? undefined : schemaV2?.proposal_analysis?.itens_licitados;
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
                    const items = await mapV2ToEngineering(itensV2, engineeringConfig, req.user?.tenantId);
                    return res.json({ items, source: 'v2_itens_licitados', count: items.length });
                }
            }

            console.log(`[Engineering AI-Populate] ⚠️ Dados V2 insuficientes (engBudget=${engBudgetItems?.length || 0}, itensV2=${itensV2?.length || 0}).`);

            // ═══════════════════════════════════════════════════
            // RE-READ: A BG job may have completed and written fresh items
            // since our initial schemaV2 read. Re-check before falling through.
            // FIX CACHE-02: Skip RE-READ when forceRefresh=true — user explicitly
            // requested a fresh extraction, so we must NOT serve stale cached items
            // that may have been written by a concurrent/previous job.
            // ═══════════════════════════════════════════════════
            const freshAiAnalysis = !forceRefresh
                ? await prisma.aiAnalysis.findFirst({
                    where: {
                        biddingProcessId: biddingId,
                        biddingProcess: { tenantId: req.user?.tenantId }
                    }
                })
                : null;
            const freshSchema = freshAiAnalysis?.schemaV2 as any;
            const freshBudgetItems = freshSchema?._engineeringBudgetItems;
            const freshMeta = freshSchema?._engineeringExtractionMeta;
            
            if (!forceRefresh && Array.isArray(freshBudgetItems) && freshBudgetItems.length > 0) {
                postClassifyTypes(freshBudgetItems);
                console.log(`[Engineering AI-Populate] 🔄 RE-READ: Encontrou ${freshBudgetItems.length} itens frescos (escritos por job concluído)`);
                await enrichWithOfficialPrices(freshBudgetItems, engineeringConfig, { tenantId: req.user?.tenantId });
                return res.json({ items: freshBudgetItems, source: 'v2_engineering_budget_fresh', count: freshBudgetItems.length });
            }
            
            if (freshMeta?.status === 'quality_quarantine') {
                const quarantinedFresh = freshSchema?._engineeringBudgetItemsQuarantine || [];
                console.log(`[Engineering AI-Populate] 🔄 RE-READ: Extração concluída, mas em quarentena. Retornando ${quarantinedFresh.length} itens para revisão.`);
                if (quarantinedFresh.length > 0) {
                    postClassifyTypes(quarantinedFresh);
                    await enrichWithOfficialPrices(quarantinedFresh, engineeringConfig, { tenantId: req.user?.tenantId });
                }
                return res.json({
                    items: quarantinedFresh,
                    source: 'quality_quarantine',
                    count: quarantinedFresh.length,
                    validation: freshSchema?._engineeringValidation || null,
                    diagnostic: freshSchema?._engineeringValidation?.issues || [],
                    message: 'A extração foi colocada em quarentena por baixa qualidade. Revise os alertas antes de publicar itens na proposta.'
                });
            }
            
            if (freshMeta?.status === 'empty_extraction') {
                console.log(`[Engineering AI-Populate] 🔄 RE-READ: Extração concluída sem itens. Repassando diagnóstico ao frontend.`);
                return res.json({ 
                    items: [], 
                    source: 'empty_extraction', 
                    count: 0, 
                    diagnostic: freshMeta.possibleCauses || [],
                    message: `A IA não encontrou a planilha. Possíveis causas: ${(freshMeta.possibleCauses || []).join('; ')}`
                });
            }

            // ═══════════════════════════════════════════════════
            // GUARDA: Se há um job de engenharia ativo, NÃO re-extrair
            // O background job vai popular _engineeringBudgetItems quando concluir.
            // Re-extrair aqui duplica custo de IA e cria duas fontes de verdade.
            // ═══════════════════════════════════════════════════
            
            // Step 0: If forceRefresh, cancel ALL active jobs (we need a fresh start)
            if (forceRefresh) {
                const allActiveJobs = await prisma.backgroundJob.findMany({
                    where: {
                        targetId: biddingId,
                        type: 'engineering_extraction',
                        status: { in: ['QUEUED', 'PROCESSING'] },
                    },
                    select: { id: true },
                });
                if (allActiveJobs.length > 0) {
                    await prisma.backgroundJob.updateMany({
                        where: { id: { in: allActiveJobs.map(j => j.id) } },
                        data: { status: 'FAILED', error: 'Cancelled: forceRefresh requested', progress: 0 },
                    });
                    console.log(`[Engineering AI-Populate] 🧹 forceRefresh: cancelled ${allActiveJobs.length} active jobs for ${biddingId}`);
                }
            } else {
                // Step 1: Cancel stale jobs (> 15 minutes old) that are stuck in QUEUED/PROCESSING
                const STALE_JOB_THRESHOLD = 15 * 60 * 1000; // 15 minutes
                const staleThreshold = new Date(Date.now() - STALE_JOB_THRESHOLD);
                const staleJobs = await prisma.backgroundJob.findMany({
                    where: {
                        targetId: biddingId,
                        type: 'engineering_extraction',
                        status: { in: ['QUEUED', 'PROCESSING'] },
                        createdAt: { lt: staleThreshold },
                    },
                    select: { id: true },
                });
                if (staleJobs.length > 0) {
                    await prisma.backgroundJob.updateMany({
                        where: { id: { in: staleJobs.map(j => j.id) } },
                        data: { status: 'FAILED', error: 'Auto-cancelled: stale job (>15 min)', progress: 0 },
                    });
                    console.log(`[Engineering AI-Populate] 🧹 Auto-cancelled ${staleJobs.length} stale jobs for ${biddingId}`);
                }
                
                // Step 2: Check for RECENT active job (created within threshold)
                const activeJob = await prisma.backgroundJob.findFirst({
                    where: {
                        targetId: biddingId,
                        type: 'engineering_extraction',
                        status: { in: ['QUEUED', 'PROCESSING'] },
                        createdAt: { gte: staleThreshold },
                    },
                    select: { id: true, status: true, progress: true, progressMsg: true },
                    orderBy: { createdAt: 'desc' },
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
            }

            console.log(`[Engineering AI-Populate] ⚠️ Sem job ativo. Iniciando extração em background.`);

            // PASSO 2: Criar o job em background se ainda não existe.
            // Antes de submeter, ranqueia anexos para evitar mandar edital/atas
            // genéricos ao extrator multimodal de engenharia.
            const attachments = schemaV2?.pncp_source?.attachments || [];
            const classifiedDocs = classifyEngineeringAttachments(attachments, { maxDocuments: 4 });
            const selectedDocs = classifiedDocs.selected.length > 0
                ? classifiedDocs.selected
                : classifiedDocs.all.filter(doc => doc.score > (classifiedDocs.summary.total <= 1 ? -999 : -20)).slice(0, 4);
            let pdfUrls = selectedDocs.map(doc => doc.url);

            // FIX DOC-06: Se TODOS os docs selecionados têm score negativo, eles são 
            // provavelmente documentos irrelevantes (parecer, ata, etc.). Descarte-os
            // e force o fallback para API PNCP que busca os anexos corretos do edital.
            const allNegativeScores = selectedDocs.length > 0 && selectedDocs.every(doc => doc.score < 0);
            if (allNegativeScores) {
                console.log(
                    `[Engineering AI-Populate] ⚠️ Todos os ${selectedDocs.length} doc(s) selecionados têm score negativo ` +
                    `(${selectedDocs.map(d => `"${d.title}"=${d.score}`).join(', ')}). ` +
                    `Descartando e ativando fallback PNCP API.`
                );
                pdfUrls = []; // Reset — force PNCP API fallback below
            }

            // FIX DOC-04: Se nenhum anexo válido, construir URLs diretamente da API PNCP
            if (pdfUrls.length === 0 && bidding?.pncpLink) {
                const linkMatch = bidding.pncpLink.match(/(\d{14})\/(\d{4})\/(\d+)/);
                if (linkMatch) {
                    const [, cnpj, ano, seq] = linkMatch;
                    try {
                        const arquivosUrl = `https://pncp.gov.br/api/pncp/v1/orgaos/${cnpj}/compras/${ano}/${seq}/arquivos`;
                        const apiRes = await (await import('axios')).default.get(arquivosUrl, { timeout: 20000 });
                        const arquivos = Array.isArray(apiRes.data) ? apiRes.data : [];
                        console.log(`[Engineering AI-Populate] 📎 PNCP API retornou ${arquivos.length} arquivo(s) via pncpLink fallback`);
                        
                        // Re-classify the fresh PNCP attachments
                        const apiClassified = classifyEngineeringAttachments(arquivos, { maxDocuments: 4 });
                        const apiSelected = apiClassified.selected.length > 0
                            ? apiClassified.selected
                            : apiClassified.all.filter(doc => doc.score > (arquivos.length <= 1 ? -999 : -20)).slice(0, 4);
                        
                        if (apiSelected.length > 0) {
                            pdfUrls = apiSelected.map(doc => doc.url);
                            console.log(
                                `[Engineering AI-Populate] 📎 PNCP API classificou ${apiSelected.length}/${arquivos.length}: ` +
                                apiSelected.map(d => `"${d.title}" (${d.score})`).join(', ')
                            );
                        } else {
                            // Fallback: send all files including .rar/.zip (handler supports them via ARCH-03)
                            // Only skip truly unsupported archive formats (.7z, .tar.gz, etc.)
                            const UNSUPPORTED_ARCHIVE_RE = /\.(7z|tar|gz|bz2|xz)($|\?)/i;
                            for (const arq of arquivos) {
                                const fileUrl = arq.url || '';
                                const fileTitle = String(arq.titulo || arq.title || fileUrl);
                                if (UNSUPPORTED_ARCHIVE_RE.test(fileTitle) || UNSUPPORTED_ARCHIVE_RE.test(fileUrl)) {
                                    console.log(`[Engineering AI-Populate] ⚠️ Ignorando formato não suportado: "${fileTitle}"`);
                                    continue;
                                }
                                const correctedUrl = fileUrl.includes('pncp-api/v1') ? fileUrl.replace('pncp-api/v1', 'api/pncp/v1') : fileUrl;
                                if (correctedUrl) pdfUrls.push(correctedUrl);
                            }
                        }
                    } catch (e: any) {
                        console.warn(`[Engineering AI-Populate] ⚠️ PNCP API fallback falhou: ${e.message}`);
                    }
                }
            }

            console.log(
                `[Engineering AI-Populate] 📎 Classificador selecionou ${selectedDocs.length}/${classifiedDocs.summary.total} anexo(s), pdfUrls final: ${pdfUrls.length}: ` +
                (pdfUrls.length > 0 && selectedDocs.length > 0 && !allNegativeScores 
                    ? selectedDocs.map(doc => `"${doc.title}" (${doc.score})`).join(', ') 
                    : pdfUrls.map(u => u.substring(u.lastIndexOf('/') - 20)).join(', '))
            );

            const user = req.user || { tenantId: bidding?.tenantId || 'unknown', userId: 'system' };
            
            // FIX ARCH-02 + ARCH-05: Only list truly unsupported archives in diagnostics
            // .rar and .zip are now processable (ARCH-03), so exclude them from "filtered" list
            const allAttachments = schemaV2?.pncp_source?.attachments || [];
            const UNSUPPORTED_ARCHIVE_EXT_RE = /\.(7z|tar|gz|bz2|xz)($|\?)/i;
            const filteredArchiveNames = allAttachments
                .filter((att: any) => {
                    const t = String(att?.titulo || att?.title || att?.url || '');
                    return UNSUPPORTED_ARCHIVE_EXT_RE.test(t);
                })
                .map((att: any) => String(att?.titulo || att?.title || 'arquivo'))
                .slice(0, 10);

            const newJob = await submitJob({
                tenantId: user.tenantId,
                userId: user.userId || user.id || 'system',
                type: 'engineering_extraction',
                targetId: biddingId,
                targetTitle: `Planilha Orçamentária — ${bidding?.processNumber || bidding?.title || 'Edital'}`,
                input: {
                    biddingId,
                    proposalId,
                    pdfUrls,
                    forceRefresh: Boolean(forceRefresh),
                    documentSelection: {
                        total: classifiedDocs.summary.total,
                        selected: selectedDocs.length,
                        titles: selectedDocs.map(doc => doc.title),
                        scores: selectedDocs.map(doc => doc.score),
                        filteredArchives: filteredArchiveNames,
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
                            responseMimeType: 'application/json',
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
                    responseMimeType: 'application/json',
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
                            responseMimeType: 'application/json',
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
        await enrichWithOfficialPrices(items, engineeringConfig, { tenantId: req.user?.tenantId });

        // Auto-save composições PRÓPRIAS to the database
        // FIX: Filter out spurious items (declarations, admin, etapas) that shouldn't be in PROPRIA
        const SPURIOUS_CODE_PATTERNS = /^(DC-|ADM-|CP-0[1-9]$|CXXXXX|ETAPA)/i;
        const ownComps = items.filter((it: any) => {
            if (it.type !== 'COMPOSICAO') return false;
            if (it.type === 'ETAPA' || it.type === 'SUBETAPA') return false;
            const code = (it.code || it.item || '').trim();
            if (!code || SPURIOUS_CODE_PATTERNS.test(code)) return false;
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
                    const propriaDb = await getOrCreatePropriaDatabase(prisma, bidding.tenantId, proposalId);
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
                             let insumoIndex = 0;
                             for (const ins of (comp.insumos || [])) {
                                 // FIX-HUB-01: Preserve original insumo code when available; generate meaningful code otherwise
                                 const rawInsCode = (ins.code || '').trim();
                                 const insCode = rawInsCode && rawInsCode !== 'PROPRIO' && rawInsCode.length > 1
                                     ? rawInsCode  // Use real insumo code (e.g., "40918", "I6519")
                                     : `${comp.code || comp.item}-INS-${insumoIndex + 1}`;  // Readable code with per-insumo index
                                 // FIX-HUB-02: Use intelligent classifier instead of fallback to MATERIAL
                                 const typeMap: Record<string, string> = { 'MAO_DE_OBRA': 'MAO_DE_OBRA', 'EQUIPAMENTO': 'EQUIPAMENTO', 'MATERIAL': 'MATERIAL', 'OBSERVACAO': 'OBSERVACAO' };
                                 let resolvedType = typeMap[ins.type] || '';
                                 if (!resolvedType || resolvedType === 'MATERIAL') {
                                     const classification = classifyInsumoType(ins.description || '', ins.unit || 'UN', ins.type);
                                     resolvedType = classification.type;
                                 }
                                 const resolvedInsumo = await getOrCreateEngineeringItemWithCollisionCheck(prisma, {
                                     databaseId: propriaDb.id,
                                     code: insCode,
                                     description: ins.description || '',
                                     unit: ins.unit || 'UN',
                                     price: ins.unitPrice || 0,
                                     type: resolvedType || 'MATERIAL'
                                 });
                                 await prisma.engineeringCompositionItem.create({
                                     data: { compositionId: compRecord.id, itemId: resolvedInsumo.id, coefficient: ins.coefficient || 0, price: ins.type === 'OBSERVACAO' ? 0 : (ins.coefficient || 0) * (ins.unitPrice || 0) }
                                 });
                                 insumoIndex++;
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
        res.status(500).json({ error: 'Falha ao extrair itens via Inteligência Artificial' });
    }
});

// ═══════════════════════════════════════════════════════════
// POST /api/engineering/ai-extract-compositions
// Extrai Composições de Preços Unitários (CPUs) via IA
// a partir do texto do edital/projeto básico
// ═══════════════════════════════════════════════════════════
router.post('/ai-extract-compositions', async (req: any, res: any) => {
    try {
        const { biddingId, engineeringConfig, proposalItems, allContext, proposalId } = req.body;
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

        // Build context: items that NEED composition extraction
        let itemsContext = '';
        const budgetItemCodes: string[] = [];
        const budgetItemDescriptions: string[] = [];
        if (Array.isArray(proposalItems) && proposalItems.length > 0) {
            // Only include COMPOSICAO/INSUMO items — NEVER send ETAPAs/SUBETAPAs as candidates
            const validCandidates = proposalItems.filter((it: any) => {
                const type = String(it.type || '').toUpperCase();
                return type !== 'ETAPA' && type !== 'SUBETAPA';
            });
            if (validCandidates.length > 0) {
                itemsContext = '\n\n═══════════════════════════════════════════════════════\n🎯 ITENS QUE PRECISAM DE COMPOSIÇÃO ANALÍTICA (EXTRAIA PARA ESTES)\n═══════════════════════════════════════════════════════\n';
                itemsContext += validCandidates.map((it: any, idx: number) => {
                    const itemCode = it.code && it.code !== 'N/A' ? it.code : `CPU-${String(idx + 1).padStart(2, '0')}`;
                    budgetItemCodes.push(itemCode);
                    budgetItemDescriptions.push(String(it.description || '').trim().toUpperCase().substring(0, 80));
                    return `- ID: ${itemCode} | Descrição: ${it.description} | Unidade: ${it.unit || 'UN'} | Qtd: ${it.quantity || 1} | Base: ${it.sourceName || 'PROPRIA'}`;
                }).join('\n');
                itemsContext += `\n\nREGRA OBRIGATÓRIA:\n- Use como "code" no JSON o ID exato listado acima (ex: CPU-01, CPU-02, ou o código SINAPI/SEINFRA se existir)\n- Extraia composição analítica APENAS para os itens listados acima\n- NÃO crie composições para ETAPAs, SUBETAPAs ou títulos de seção\n- Se não encontrar dados de composição para um item, NÃO o inclua\n- Se nenhum item tiver composição encontrada no documento, retorne: {"compositions": []}`;
            }
            console.log(`[Engineering AI-Compositions] 🎯 ${validCandidates.length}/${proposalItems.length} candidatos válidos (excluídos ETAPA/SUBETAPA)`);
        }

        // Add context of items that ALREADY have compositions (for the AI to avoid duplicating)
        if (Array.isArray(allContext) && allContext.length > 0) {
            const withComp = allContext.filter((it: any) => it.hasComposition);
            if (withComp.length > 0) {
                itemsContext += '\n\n═══════════════════════════════════════════════════════\n✅ ITENS QUE JÁ POSSUEM COMPOSIÇÃO (NÃO EXTRAIR)\n═══════════════════════════════════════════════════════\n';
                itemsContext += withComp.map((it: any) => `- ${it.code}: ${it.description} (${it.sourceName})`).join('\n');
                itemsContext += '\n\n⚠️ NÃO gere composições para estes itens acima. Foque APENAS nos itens marcados com 🎯.';
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
                        responseMimeType: 'application/json',
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
                        responseMimeType: 'application/json',
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

        console.log(`[Engineering AI-Compositions] 📋 ${compositions.length} composições encontradas (bruto)`);

        // ═══ VALIDATION STEP 1: Filter by candidate matching ═══
        // Only keep compositions that match a candidate from the budget
        if (budgetItemCodes.length > 0) {
            const codeSet = new Set(budgetItemCodes.map(c => c.trim().toUpperCase()));
            const descSet = new Set(budgetItemDescriptions); // Already uppercased and trimmed
            const beforeCount = compositions.length;
            compositions = compositions.filter((c: any) => {
                const code = String(c.code || '').trim().toUpperCase();
                // Match by code first
                if (code && code !== 'N/A' && codeSet.has(code)) return true;
                // Check if code starts with CPU- (our assigned IDs)
                if (code.startsWith('CPU-') && codeSet.has(code)) return true;
                // Fallback: match by description similarity (first 80 chars)
                const desc = String(c.description || '').trim().toUpperCase().substring(0, 80);
                if (desc && descSet.has(desc)) return true;
                return false;
            });
            if (compositions.length < beforeCount) {
                console.log(`[Engineering AI-Compositions] 🔽 Filtro código+descrição: ${beforeCount} → ${compositions.length} (descartadas ${beforeCount - compositions.length} não-candidatas)`);
            }
        }

        // ═══ VALIDATION STEP 2: Reject hallucinated compositions ═══
        // A real composition must have at least 1 insumo with coefficient > 0 AND unitPrice > 0
        {
            const beforeCount = compositions.length;
            compositions = compositions.filter((c: any) => {
                if (!c.groups || typeof c.groups !== 'object') {
                    console.log(`[Engineering AI-Compositions] ❌ Rejeitada "${c.code}" — sem groups`);
                    return false;
                }
                // Count valid insumos (with real coefficient AND price)
                let validInsumoCount = 0;
                for (const [groupKey, groupItems] of Object.entries(c.groups)) {
                    if (!Array.isArray(groupItems)) continue;
                    for (const gi of groupItems as any[]) {
                        const coeff = Number(gi.coefficient || 0);
                        const price = Number(gi.unitPrice || 0);
                        if (coeff > 0 && price > 0) validInsumoCount++;
                    }
                }
                if (validInsumoCount === 0) {
                    console.log(`[Engineering AI-Compositions] ❌ Rejeitada "${c.code}: ${(c.description || '').substring(0, 60)}" — 0 insumos com coeficiente e preço > 0 (alucinação)`);
                    return false;
                }
                return true;
            });
            if (compositions.length < beforeCount) {
                console.log(`[Engineering AI-Compositions] 🔽 Validação anti-alucinação: ${beforeCount} → ${compositions.length} (rejeitadas ${beforeCount - compositions.length} composições sem dados reais)`);
            }
        }

        if (compositions.length === 0) {
            return res.json({ compositions: [], saved: 0, message: 'Nenhuma composição válida encontrada no documento para os itens solicitados. Verifique se o edital contém tabelas de CPU (Composição de Preços Unitários).' });
        }

        // Store extracted compositions in the database as "PROPRIA"
        // Find or create a "PROPRIA" database for this tenant
        const tenantId = bidding.tenantId;
        const propriaDb = await getOrCreatePropriaDatabase(prisma, tenantId, proposalId);
        const dbId: string = propriaDb.id;

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
                        const resolvedInsumo = await getOrCreateEngineeringItemWithCollisionCheck(prisma, {
                            databaseId: dbId,
                            code: item.code,
                            description: item.description,
                            unit: item.unit || 'UN',
                            price: item.unitPrice || 0,
                            type: groupKey,
                        });

                        const itemPrice = (item.coefficient || 0) * (item.unitPrice || 0);
                        await prisma.engineeringCompositionItem.create({
                            data: {
                                compositionId: compRecord.id, itemId: resolvedInsumo.id,
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
async function mapV2ToEngineering(itensV2: any[], engineeringConfig?: any, tenantId?: string | null): Promise<any[]> {
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
            // FIX ORSE-01: detect ORSE from /ORSE suffix but strip it from code
            sourceName = /\/ORSE$/i.test(code)
                ? 'ORSE'
                : code.match(/^[CI]\d/i)
                    ? 'SEINFRA'
                    : 'SINAPI';
            if (sourceName === 'ORSE') code = code.replace(/\/ORSE$/i, '').replace(/^0+(\d)/, '$1');
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
            unitPrice: type === 'ETAPA' || type === 'SUBETAPA' ? 0 : (item.unitPriceWithBdi || item.unitPrice || 0),
            totalPrice: type === 'ETAPA' || type === 'SUBETAPA' ? 0 : (item.totalPrice || 0),
        };
    });

    // Enrich with official database prices
    await enrichWithOfficialPrices(items, engineeringConfig, { tenantId });
    
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
            // FIX ORSE-01: Return only numeric code for ORSE
            code: sourceName === 'ORSE'
                ? String(numericCode).replace(/^0+(\d)/, '$1')
                : String(numericCode),
        };
    }

    // If itemNumber has a code-like pattern (e.g., C0054)
    if (itemNumber && /^[CI]\d{3,5}$/i.test(itemNumber.trim())) {
        return { sourceName: 'SEINFRA', code: itemNumber.trim().toUpperCase() };
    }
    // FIX ORSE-01: detect ORSE from itemNumber format, return just the number
    if (itemNumber && /^0*\d{1,6}\/ORSE$/i.test(itemNumber.trim())) {
        return { sourceName: 'ORSE', code: itemNumber.trim().toUpperCase().replace(/\/ORSE$/i, '').replace(/^0+(\d)/, '$1') };
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
        if (req.user?.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Acesso restrito ao Super Administrador' });
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
// G6-FIX: Base sync/import routes moved to engineering/baseSyncRoutes.ts
// ═══════════════════════════════════════════════════════════
import baseSyncRoutes from './engineering/baseSyncRoutes';
router.use('/', baseSyncRoutes);

export default router;
