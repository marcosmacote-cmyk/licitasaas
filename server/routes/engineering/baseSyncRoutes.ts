/**
 * baseSyncRoutes.ts — Sub-router for base sync/import routes.
 *
 * G6-FIX: Extracted from engineering.ts to reduce monolith (7K → ~6K lines).
 * Covers: Excel import, SINAPI/SICRO/SBC/CAERN/ORSE/SICOR-MG/SEINFRA sync,
 * AI extraction upload routes, and base status endpoint.
 */
import { Router } from 'express';
import { logger } from '../../lib/logger';
import { prisma } from '../../lib/prisma';
import multer from 'multer';
import * as XLSX from 'xlsx';
import fs from 'fs';
import { downloadAndParseSeinfra, getSeinfraRegimeMeta, type SeinfraRegime } from '../../services/engineering/seinfra-scraper';
import { syncSinapi, importFromBuffer as importSinapiFromBuffer } from '../../services/engineering/sinapiCrawler';
import { getLatestOrsePeriods, hydrateOrseCompositionDetails, searchOrseInsumos, searchOrseServices, syncOrse } from '../../services/engineering/orseCrawler';
import { getLatestSicorPublications, getSicorRegions, hasConfiguredSicorAuthToken, syncSicorMg, validateSicorAuthToken } from '../../services/engineering/sicorMgSync';
import { syncSicro } from '../../services/engineering/sicroCrawler';
import { syncSbc, getSbcRegions } from '../../services/engineering/sbcCrawler';
import { syncCaern } from '../../services/engineering/caernCrawler';
import { extractCompositionFromImage } from '../../services/ai/engineering/compositionExtractor';
import { extractItemsFromImage } from '../../services/ai/engineering/budgetItemsImageExtractor';

const router = Router();
const xlsUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
const aiUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

let sinapiSyncJob: { startedAt: string; requestedBy?: string; description: string } | null = null;

router.post('/bases/import', xlsUpload.single('file'), async (req: any, res: any) => {
    try {
        if (req.user?.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Acesso restrito ao Super Administrador' });
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
                // Fallback para planilhas FNDE (onde o código/descrição não têm nomes explícitos no cabeçalho)
                for (let i = 0; i < Math.min(rows.length, 15); i++) {
                    const row = rows[i].map((c: any) => String(c).trim().toUpperCase());
                    const hasFonte = row.includes('FONTE');
                    const unitIdx = row.findIndex((c: string) => c.includes('UNID') || c === 'UN' || c === 'UND' || c.includes('UNIDADE'));
                    const priceIdx = row.findIndex((c: string) => c.includes('PRECO') || c.includes('PREÇO') || c.includes('CUSTO') || c.includes('VALOR') || c.includes('PREÇO UNITÁRIO') || c.includes('MEDIANA'));

                    if (hasFonte && priceIdx >= 0) {
                        headerRowIdx = i;
                        colMap = { code: 0, desc: 1, unit: unitIdx >= 0 ? unitIdx : -1, price: priceIdx };
                        console.log(`[Eng Import] Fallback FNDE ativado na linha ${i + 1} para a aba "${sheetName}"`);
                        break;
                    }
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


router.post('/bases/sync-sinapi', async (req: any, res: any) => {
    try {
        if (req.user?.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Acesso restrito ao Super Administrador' });
        }

        if (sinapiSyncJob) {
            return res.status(409).json({
                error: 'Sync SINAPI já está em execução',
                status: 'running',
                job: sinapiSyncJob,
            });
        }

        const { ufs = ['CE'], months = 36, includeDesonerado = true, force = false, targetPeriods } = req.body;
        const periods = Array.isArray(targetPeriods)
            ? targetPeriods
                .map((p: any) => ({ month: Number(p.month), year: Number(p.year) }))
                .filter((p: any) => p.month >= 1 && p.month <= 12 && p.year >= 2009)
            : undefined;
        const description = periods?.length
            ? `${ufs.join(',')} ${periods.map((p: any) => `${String(p.month).padStart(2, '0')}/${p.year}`).join(',')} ${includeDesonerado ? 'Onerado+Desonerado' : 'Apenas Onerado'}${force ? ' force' : ''}`
            : `${ufs.join(',')} ${months} meses ${includeDesonerado ? 'Onerado+Desonerado' : 'Apenas Onerado'}${force ? ' force' : ''}`;

        console.log(`[SINAPI Sync] 🚀 Admin ${req.user?.email} disparou sync: ${description}`);
        sinapiSyncJob = { startedAt: new Date().toISOString(), requestedBy: req.user?.email, description };

        // Run in background — don't block the HTTP response
        res.json({
            message: `Sync SINAPI iniciado em background: ${description}`,
            status: 'started',
            job: sinapiSyncJob,
        });

        // Fire and forget
        syncSinapi({ ufs, months, includeDesonerado, force, targetPeriods: periods }).then(report => {
            console.log(`[SINAPI Sync] 🏁 Relatório final: ${report.totalSuccess}/${report.totalAttempted} sucesso em ${report.finished}`);
        }).catch(err => {
            console.error(`[SINAPI Sync] ❌ Erro fatal:`, err);
        }).finally(() => {
            sinapiSyncJob = null;
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

router.post('/bases/sync-sicro', async (req: any, res: any) => {
    try {
        if (req.user?.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Acesso restrito ao Super Administrador' });
        }

        const { ufs = ['ALL'], months = 36, force = false, targetPeriods } = req.body;
        const periods = Array.isArray(targetPeriods)
            ? targetPeriods
                .map((p: any) => ({ month: Number(p.month), year: Number(p.year) }))
                .filter((p: any) => p.month >= 1 && p.month <= 12 && p.year >= 2009)
            : undefined;

        const description = periods?.length
            ? `UFs=${Array.isArray(ufs) ? ufs.join(',') : ufs}, períodos=${periods.map((p: any) => `${String(p.month).padStart(2, '0')}/${p.year}`).join(',')}${force ? ' (FORÇADO)' : ''}`
            : `UFs=${Array.isArray(ufs) ? ufs.join(',') : ufs}, meses=${months}${force ? ' (FORÇADO)' : ''}`;

        console.log(`[SICRO Sync] 🚀 Admin ${req.user?.email} disparou sync SICRO: ${description}`);

        res.json({
            message: `Sync SICRO iniciado em background para ${description}`,
            status: 'started',
        });

        // Fire and forget
        syncSicro({ 
            ufs: Array.isArray(ufs) ? ufs : ['ALL'], 
            months, 
            force, 
            targetPeriods: periods 
        }).then(report => {
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

router.post('/bases/sync-sbc', async (req: any, res: any) => {
    try {
        if (req.user?.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Acesso restrito ao Super Administrador' });
        }

        const sbcEmail = process.env.SBC_EMAIL;
        const sbcPassword = process.env.SBC_PASSWORD;
        if (!sbcEmail || !sbcPassword) {
            return res.status(400).json({ error: 'Credenciais SBC não configuradas. Defina SBC_EMAIL e SBC_PASSWORD nas variáveis de ambiente.' });
        }

        const { regions = ['ALL'], months = 36 } = req.body;

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

router.post('/bases/sync-caern', async (req: any, res: any) => {
    try {
        if (req.user?.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Acesso restrito ao Super Administrador' });
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
        const months = Math.max(1, Math.min(Number(req.query.months || 36), 48));
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
        if (req.user?.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Acesso restrito ao Super Administrador' });
        }

        const months = Math.max(1, Math.min(Number(req.body?.months || 36), 48));
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
        if (req.user?.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Acesso restrito ao Super Administrador' });
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
        if (req.user?.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Acesso restrito ao Super Administrador' });
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
        if (req.user?.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Acesso restrito ao Super Administrador' });
        }
        const authToken = String(req.headers['x-sicor-token'] || req.query.authToken || '') || undefined;
        const months = Math.max(1, Math.min(Number(req.query.months || 36), 48));
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
        if (req.user?.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Acesso restrito ao Super Administrador' });
        }

        const months = Math.max(1, Math.min(Number(req.body?.months || 36), 48));
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
        if (req.user?.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Acesso restrito ao Super Administrador' });
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

            // FIX DATE-01: SEINFRA 028 doesn't have monthly cadence like SINAPI,
            // but the enricher's date scoring needs referenceMonth/referenceYear.
            // Use current month when importing since SIPROCE always serves latest version.
            const now = new Date();
            const refYear = now.getFullYear();
            const refMonth = now.getMonth() + 1; // 1-based

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
                        referenceYear: refYear,
                        referenceMonth: refMonth,
                    }
                });
            } else {
                db = await prisma.engineeringDatabase.update({
                    where: { id: db.id },
                    data: {
                        version: meta.version,
                        payrollExemption: meta.payrollExemption,
                        referenceYear: refYear,
                        referenceMonth: refMonth,
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


router.post('/ai/extract-composition', aiUpload.single('file'), async (req: any, res: any) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Nenhum arquivo enviado' });
        }

        const { code, proposalId } = req.body;
        const engineeringConfig = req.body.engineeringConfig ? JSON.parse(req.body.engineeringConfig) : undefined;
        const result = await extractCompositionFromImage(req.file.buffer, req.file.mimetype, code, engineeringConfig, req.user?.tenantId, proposalId);
        
        res.json(result);
    } catch (e: any) {
        console.error('[AI Extract Composition] Error:', e);
        res.status(500).json({ error: 'Falha na extração por IA', details: e.message });
    } finally {
        if (req.file && req.file.path) {
            try {
                fs.unlinkSync(req.file.path);
            } catch (err) {
                console.error('[AI Extract Composition] Error deleting temp file:', err);
            }
        }
    }
});

router.post('/ai/extract-items-image', aiUpload.single('file'), async (req: any, res: any) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'Nenhum arquivo enviado' });
        }

        const engineeringConfig = req.body.engineeringConfig ? JSON.parse(req.body.engineeringConfig) : undefined;
        const result = await extractItemsFromImage(req.file.buffer, req.file.mimetype, engineeringConfig, req.user?.tenantId);
        
        res.json(result);
    } catch (e: any) {
        console.error('[AI Extract Items Image] Error:', e);
        res.status(500).json({ error: 'Falha na extração por IA', details: e.message });
    } finally {
        if (req.file && req.file.path) {
            try {
                fs.unlinkSync(req.file.path);
            } catch (err) {
                console.error('[AI Extract Items Image] Error deleting temp file:', err);
            }
        }
    }
});

// ═══════════════════════════════════════════════════════════
// POST /api/engineering/bases/import-excel
// Upload manual de planilha SINAPI/SEINFRA/ORSE/SICRO (.xlsx)
// Para quando download automático não funcionar
// ═══════════════════════════════════════════════════════════
router.post('/bases/import-excel', aiUpload.single('file'), async (req: any, res: any) => {
    try {
        if (req.user?.role !== 'SUPER_ADMIN') {
            return res.status(403).json({ error: 'Acesso restrito ao Super Administrador' });
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
    } finally {
        if (req.file && req.file.path) {
            try {
                fs.unlinkSync(req.file.path);
            } catch (err) {
                console.error('[Base Import] Error deleting temp file:', err);
            }
        }
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

        // Check coverage for last 36 months (3 years)
        const now = new Date();
        const expectedMonths: string[] = [];
        for (let i = 0; i < 36; i++) {
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
