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
            const r = await prisma.engineeringItem.createMany({
                data: cfg.items.map(it => ({
                    databaseId: db!.id, code: it.code, description: it.desc,
                    unit: it.unit, price: it.price, type: it.type
                })),
                skipDuplicates: true,
            });
            results[key] = r.count;
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
        let inserted = 0;
        for (let i = 0; i < allItems.length; i += BATCH) {
            const batch = allItems.slice(i, i + BATCH);
            const result = await prisma.engineeringItem.createMany({
                data: batch.map(it => ({ databaseId: db!.id, ...it })),
                skipDuplicates: true,
            });
            inserted += result.count;
            if (i + BATCH < allItems.length) {
                console.log(`[Eng Import] Batch ${Math.floor(i / BATCH) + 1}: ${result.count} inseridos (${inserted}/${allItems.length})...`);
            }
        }

        const stats = {
            MATERIAL: allItems.filter(i => i.type === 'MATERIAL').length,
            MAO_DE_OBRA: allItems.filter(i => i.type === 'MAO_DE_OBRA').length,
            EQUIPAMENTO: allItems.filter(i => i.type === 'EQUIPAMENTO').length,
            SERVICO: allItems.filter(i => i.type === 'SERVICO').length,
        };

        console.log(`[Eng Import] ✅ Concluído! ${inserted} itens na base "${db.name} ${db.uf}".`);

        res.json({
            message: `Importação concluída: ${inserted} itens na base ${db.name} ${db.uf || ''}`,
            databaseId: db.id,
            totalParsed: allItems.length,
            totalInserted: inserted,
            breakdown: stats,
            sheets: workbook.SheetNames,
        });

    } catch (e: any) {
        console.error('[Eng Import] Error:', e);
        res.status(500).json({ error: 'Erro na importação', details: e.message });
    }
});

export default router;
