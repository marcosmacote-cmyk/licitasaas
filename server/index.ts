import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';
import https from 'https';
import { PrismaClient } from '@prisma/client';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

import { GoogleGenAI } from '@google/genai';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

import { storageService } from './storage';
import { createExtractorFromData } from 'node-unrar-js';

// Resolve server root (handles both ts-node and compiled dist/)
const SERVER_ROOT = __dirname.endsWith('dist') ? path.resolve(__dirname, '..') : __dirname;

// Load .env only if it exists (don't override Railway/Docker env vars)
dotenv.config({ path: path.join(SERVER_ROOT, '.env'), override: false });

const app = express();
const prisma = new PrismaClient();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret';

app.use(cors());
app.use(express.json());

// Auth
app.post('/api/auth/login', async (req, res) => {
    console.log("==> LOGIN HIT! Body:", req.body);
    try {
        const { email, password } = req.body;
        console.log("Looking up user for email:", email);
        const user = await prisma.user.findUnique({
            where: { email },
            include: { tenant: true }
        });
        console.log("Found user:", user?.id || 'No user found');

        if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
            return res.status(401).json({ error: 'Email ou senha inválidos' });
        }

        const token = jwt.sign(
            { userId: user.id, tenantId: user.tenantId, role: user.role },
            JWT_SECRET,
            { expiresIn: '8h' }
        );

        res.json({
            token,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                role: user.role,
                tenantId: user.tenantId,
                tenantName: user.tenant.razaoSocial
            }
        });
    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ error: 'Erro interno ao realizar login' });
    }
});

// Middleware de Autenticação
const authenticateToken = (req: any, res: any, next: any) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.status(401).json({ error: 'Token não fornecido' });

    jwt.verify(token, JWT_SECRET, (err: any, decoded: any) => {
        if (err) return res.status(403).json({ error: 'Token inválido ou expirado' });
        req.user = decoded;
        next();
    });
};

/**
 * Helper to fetch file buffer from multiple sources:
 * 1. Storage Service (Supabase/Local)
 * 2. Local File System Fallback
 * 3. Database Blob Fallback (if applicable)
 */
async function getFileBufferSafe(fileNameOrUrl: string, tenantId?: string): Promise<Buffer | null> {
    try {
        // Try Storage Service first
        return await storageService.getFileBuffer(fileNameOrUrl);
    } catch (err) {
        console.warn(`[Storage] StorageService failed for ${fileNameOrUrl}, trying fallbacks...`);

        // 1. Local disk fallback (legacy or local mode)
        const pureName = path.basename(fileNameOrUrl).split('?')[0];
        const localPath = path.join(uploadDir, pureName);
        if (fs.existsSync(localPath)) {
            return fs.readFileSync(localPath);
        }

        // 2. Database fallback (recovering from blob if exists)
        if (tenantId) {
            const doc = await prisma.document.findFirst({
                where: {
                    OR: [
                        { fileUrl: { contains: pureName } },
                        { fileName: pureName }
                    ],
                    tenantId
                }
            });
            if (doc && doc.fileContent) {
                return Buffer.from(doc.fileContent);
            }
        }
    }
    return null;
}

// Setup uploads directory for Mock Bucket
const uploadDir = path.join(SERVER_ROOT, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

// Gemini Setup (lazy - don't crash if key missing)
const apiKey = process.env.GEMINI_API_KEY || '';
console.log('Gemini API Key present:', !!apiKey);
let genAI: GoogleGenAI | null = null;
if (apiKey) {
    genAI = new GoogleGenAI({
        apiKey,
        // Increased timeout for large scanned PDFs (3 minutes)
        httpOptions: {
            timeout: 180000
        }
    });
}

// Custom route for /uploads with database fallback for ephemeral storage recovery
app.get('/uploads/:filename', async (req, res, next) => {
    try {
        const { filename } = req.params;
        const filePath = path.join(uploadDir, filename);

        // If file exists on disk (cache hit), serve it immediately
        if (fs.existsSync(filePath)) {
            return res.sendFile(filePath);
        }

        // Recovery mode: If file is missing on disk, search in Database
        // We match by the end of the URL (filename)
        const doc = await prisma.document.findFirst({
            where: { fileUrl: { endsWith: filename } }
        });

        if (doc && doc.fileContent) {
            console.log(`[Persistence] Recovering ${filename} from database to disk...`);
            fs.writeFileSync(filePath, doc.fileContent);
            return res.sendFile(filePath);
        }

        next();
    } catch (error) {
        console.error(`[Persistence] Error during file recovery:`, error);
        next();
    }
});

// Fallback static serving (still good for files that ARE there)
app.use('/uploads', express.static(uploadDir));

// Configure Multer storage to use Memory (for cloud readiness)
const upload = multer({ storage: multer.memoryStorage() });

// Basic health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'LicitaSaaS API is running' });
});

// Debug endpoint to check DB contents
app.get('/api/debug-db', async (req, res) => {
    try {
        const counts = {
            tenants: await prisma.tenant.count(),
            companies: await prisma.companyProfile.count(),
            documents: await prisma.document.count(),
            users: await prisma.user.count(),
            biddings: await prisma.biddingProcess.count(),
            credentials: await prisma.companyCredential.count()
        };
        const users = await prisma.user.findMany({
            select: { id: true, email: true, tenantId: true }
        });
        const tenants = await prisma.tenant.findMany();
        const companies = await prisma.companyProfile.findMany();
        const credentials = await prisma.companyCredential.findMany();
        res.json({ counts, users, tenants, companies, credentials });
    } catch (e: any) {
        res.status(500).json({ error: e.message });
    }
});

// Diagnostic route to check if files actually exist on disk
app.get('/api/debug-uploads', (req, res) => {
    try {
        const fs = require('fs');
        if (!fs.existsSync(uploadDir)) {
            return res.json({ error: 'Upload directory does not exist', path: uploadDir });
        }
        const files = fs.readdirSync(uploadDir);
        res.json({
            count: files.length,
            path: uploadDir,
            version: '1.0.5-supabase-fix',
            storageType: process.env.STORAGE_TYPE || 'LOCAL',
            supabaseConfigured: !!(process.env.SUPABASE_URL && process.env.SUPABASE_KEY),
            node_env: process.env.NODE_ENV,
            cwd: process.cwd(),
            server_root: SERVER_ROOT
        });
    } catch (e: any) {
        res.status(400).json({ error: e.message });
    }
});

// Tenants (Seed support or manual creation)
app.post('/api/tenants', async (req, res) => {
    try {
        const tenant = await prisma.tenant.create({ data: req.body });
        res.json(tenant);
    } catch (error) {
        res.status(500).json({ error: 'Failed to create tenant' });
    }
});

// Companies
app.get('/api/companies', authenticateToken, async (req: any, res) => {
    try {
        console.log(`[API] Fetching companies for tenant: ${req.user.tenantId}`);
        const companies = await prisma.companyProfile.findMany({
            where: { tenantId: req.user.tenantId },
            include: {
                documents: {
                    select: {
                        id: true,
                        tenantId: true,
                        companyProfileId: true,
                        docType: true,
                        fileUrl: true,
                        uploadDate: true,
                        expirationDate: true,
                        status: true,
                        autoRenew: true,
                        docGroup: true,
                        issuerLink: true,
                        fileName: true,
                        alertDays: true
                        // Exclude fileContent here to avoid OOM
                    }
                },
                credentials: true
            }
        });
        console.log(`[API] Found ${companies.length} companies.`);
        res.json(companies);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch companies' });
    }
});

// Documents
app.post('/api/documents', authenticateToken, upload.single('file'), async (req: any, res) => {
    try {
        const { companyProfileId, docType, expirationDate, status, docGroup, issuerLink } = req.body;

        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const tenantId = req.user.tenantId;
        const { url: fileUrl } = await storageService.uploadFile(req.file, tenantId);

        const doc = await prisma.document.create({
            data: {
                tenantId,
                companyProfileId,
                docType,
                docGroup: docGroup || 'Outros',
                issuerLink,
                fileName: req.file.originalname,
                fileUrl,
                expirationDate: new Date(expirationDate),
                status,
                fileContent: req.file.buffer, // Save to DB for persistence on ephemeral storage
                alertDays: req.body.alertDays ? parseInt(req.body.alertDays) : 15
            }
        });

        res.json(doc);
    } catch (error) {
        console.error("Upload error:", error);
        res.status(500).json({ error: 'Failed to upload document', details: error instanceof Error ? error.message : String(error) });
    }
});

app.put('/api/documents/:id', authenticateToken, upload.single('file'), async (req: any, res) => {
    try {
        const { id } = req.params;
        const tenantId = req.user.tenantId;
        const { docType, expirationDate, status, docGroup, issuerLink } = req.body;

        const doc = await prisma.document.findUnique({
            where: { id }
        });

        if (!doc || doc.tenantId !== tenantId) {
            return res.status(404).json({ error: 'Document not found or unauthorized' });
        }

        let fileData = {};
        if (req.file) {
            // Delete old file safely if it exists and is local (optional but good practice)
            try {
                await storageService.deleteFile(doc.fileUrl);
            } catch (e) {
                console.warn("Could not delete old file:", doc.fileUrl);
            }
            const { url: fileUrl } = await storageService.uploadFile(req.file, tenantId);
            fileData = {
                fileUrl,
                fileName: req.file.originalname,
                fileContent: req.file.buffer // Update DB persistence
            };
        }

        const updatedDoc = await prisma.document.update({
            where: { id },
            data: {
                docType,
                docGroup,
                issuerLink,
                expirationDate: expirationDate ? new Date(expirationDate) : undefined,
                status,
                alertDays: req.body.alertDays ? parseInt(req.body.alertDays) : undefined,
                ...fileData
            }
        });

        res.json(updatedDoc);
    } catch (error) {
        console.error("Update doc error:", error);
        res.status(500).json({ error: 'Failed to update document' });
    }
});

app.delete('/api/documents/:id', authenticateToken, async (req: any, res) => {
    try {
        const { id } = req.params;
        const doc = await prisma.document.findUnique({
            where: { id }
        });

        if (doc && doc.tenantId === req.user.tenantId) {
            await storageService.deleteFile(doc.fileUrl);
            await prisma.document.delete({ where: { id } });
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'Document not found or unauthorized' });
        }
    } catch (error: any) {
        console.error("Delete doc error:", error);
        res.status(500).json({ error: 'Failed to delete document' });
    }
});

app.put('/api/companies/:id', authenticateToken, async (req: any, res) => {
    try {
        const { id } = req.params;
        const tenantId = req.user.tenantId;

        const company = await prisma.companyProfile.findUnique({ where: { id } });

        if (!company || company.tenantId !== tenantId) {
            return res.status(404).json({ error: 'Company not found or unauthorized' });
        }

        // Only allow updating editable fields — strip out id, tenantId, relations
        const { razaoSocial, cnpj, isHeadquarters, qualification, technicalQualification, contactName, contactEmail, contactPhone } = req.body;
        const safeData: any = {};
        if (razaoSocial !== undefined) safeData.razaoSocial = razaoSocial;
        if (cnpj !== undefined) safeData.cnpj = cnpj;
        if (isHeadquarters !== undefined) safeData.isHeadquarters = isHeadquarters;
        if (qualification !== undefined) safeData.qualification = qualification;
        if (technicalQualification !== undefined) safeData.technicalQualification = technicalQualification;
        if (contactName !== undefined) safeData.contactName = contactName;
        if (contactEmail !== undefined) safeData.contactEmail = contactEmail;
        if (contactPhone !== undefined) safeData.contactPhone = contactPhone;

        const updatedCompany = await prisma.companyProfile.update({
            where: { id },
            data: safeData,
            include: { credentials: true, documents: true }
        });
        res.json(updatedCompany);
    } catch (error: any) {
        console.error("Update company error:", error);
        res.status(500).json({ error: 'Failed to update company', details: error.message });
    }
});

app.post('/api/companies', authenticateToken, async (req: any, res) => {
    try {
        const tenantId = req.user.tenantId;

        const company = await prisma.companyProfile.create({
            data: { ...req.body, tenantId }
        });
        res.json(company);
    } catch (error) {
        console.error("Create company error:", error);
        res.status(500).json({ error: 'Failed to create company' });
    }
});

app.delete('/api/companies/:id', authenticateToken, async (req: any, res) => {
    try {
        const { id } = req.params;
        const company = await prisma.companyProfile.findUnique({ where: { id } });

        if (company && company.tenantId === req.user.tenantId) {
            await prisma.companyProfile.delete({ where: { id } });
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'Company not found or unauthorized' });
        }
    } catch (error) {
        console.error("Delete company error:", error);
        res.status(500).json({ error: 'Failed to delete company' });
    }
});

// Credentials
app.post('/api/credentials', authenticateToken, async (req: any, res) => {
    try {
        const { companyProfileId } = req.body;
        // Verify if companyProfileId belongs to the tenant
        const company = await prisma.companyProfile.findUnique({
            where: { id: companyProfileId }
        });

        if (!company || company.tenantId !== req.user.tenantId) {
            return res.status(403).json({ error: 'Unauthorized: Company does not belong to your tenant' });
        }

        const credential = await prisma.companyCredential.create({
            data: { ...req.body }
        });
        res.json(credential);
    } catch (error) {
        console.error("Create credential error:", error);
        res.status(500).json({ error: 'Failed to create credential' });
    }
});

app.put('/api/credentials/:id', authenticateToken, async (req: any, res) => {
    try {
        const { id } = req.params;
        const credential = await prisma.companyCredential.findUnique({
            where: { id },
            include: { company: true }
        });

        if (!credential || credential.company.tenantId !== req.user.tenantId) {
            return res.status(403).json({ error: 'Unauthorized to update this credential' });
        }

        const updated = await prisma.companyCredential.update({
            where: { id },
            data: req.body
        });
        res.json(updated);
    } catch (error) {
        console.error("Update credential error:", error);
        res.status(500).json({ error: 'Failed to update credential' });
    }
});

app.delete('/api/credentials/:id', authenticateToken, async (req: any, res) => {
    try {
        const { id } = req.params;
        const credential = await prisma.companyCredential.findUnique({
            where: { id },
            include: { company: true }
        });

        if (!credential || credential.company.tenantId !== req.user.tenantId) {
            return res.status(403).json({ error: 'Unauthorized to delete this credential' });
        }

        await prisma.companyCredential.delete({ where: { id } });
        res.json({ success: true });
    } catch (error) {
        console.error("Delete credential error:", error);
        res.status(500).json({ error: 'Failed to delete credential' });
    }
});

// App Config / Settings
app.get('/api/config/alerts', authenticateToken, async (req: any, res) => {
    try {
        const config = await prisma.globalConfig.findUnique({
            where: { tenantId: req.user.tenantId }
        });

        const parsed = config ? JSON.parse(config.config) : { defaultAlertDays: 15 };
        res.json(parsed);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch config' });
    }
});

app.post('/api/config/alerts', authenticateToken, async (req: any, res) => {
    try {
        const { defaultAlertDays, groupAlertDays, applyToExisting } = req.body;
        const configStr = JSON.stringify({ defaultAlertDays, groupAlertDays });

        const config = await prisma.globalConfig.upsert({
            where: { tenantId: req.user.tenantId },
            create: { tenantId: req.user.tenantId, config: configStr },
            update: { config: configStr }
        });

        if (applyToExisting) {
            console.log(`[Config Alerts] Updating documents for tenant ${req.user.tenantId}`);
            if (groupAlertDays && Object.keys(groupAlertDays).length > 0) {
                for (const [group, days] of Object.entries(groupAlertDays)) {
                    await prisma.document.updateMany({
                        where: { tenantId: req.user.tenantId, docGroup: group },
                        data: { alertDays: Number(days) }
                    });
                }
            }

            const groupsToExclude = groupAlertDays ? Object.keys(groupAlertDays) : [];
            const excludeWhere: any = { tenantId: req.user.tenantId };
            if (groupsToExclude.length > 0) {
                excludeWhere.docGroup = { notIn: groupsToExclude };
            }

            await prisma.document.updateMany({
                where: excludeWhere,
                data: { alertDays: Number(defaultAlertDays) }
            });

            console.log(`[Config Alerts] Recalculating statuses...`);
            const allDocs = await prisma.document.findMany({
                where: { tenantId: req.user.tenantId },
                select: { id: true, expirationDate: true, alertDays: true, status: true }
            });

            const toValido: string[] = [];
            const toVencendo: string[] = [];
            const toVencido: string[] = [];

            for (const doc of allDocs) {
                let status = 'Válido';
                if (doc.expirationDate) {
                    const diffTime = new Date(doc.expirationDate).getTime() - new Date().getTime();
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                    if (diffDays < 0) status = 'Vencido';
                    else if (diffDays <= (doc.alertDays || Number(defaultAlertDays))) status = 'Vencendo';
                }

                if (doc.status !== status) {
                    if (status === 'Válido') toValido.push(doc.id);
                    else if (status === 'Vencendo') toVencendo.push(doc.id);
                    else if (status === 'Vencido') toVencido.push(doc.id);
                }
            }

            if (toValido.length > 0) {
                await prisma.document.updateMany({ where: { id: { in: toValido } }, data: { status: 'Válido' } });
            }
            if (toVencendo.length > 0) {
                await prisma.document.updateMany({ where: { id: { in: toVencendo } }, data: { status: 'Vencendo' } });
            }
            if (toVencido.length > 0) {
                await prisma.document.updateMany({ where: { id: { in: toVencido } }, data: { status: 'Vencido' } });
            }
            console.log(`[Config Alerts] Finished bulk update. (Válido: ${toValido.length}, Vencendo: ${toVencendo.length}, Vencido: ${toVencido.length})`);
        }

        res.json({ success: true, config: JSON.parse(config.config) });
    } catch (error: any) {
        console.error("Config save error:", error);
        res.status(500).json({ error: error.message || 'Failed to update config' });
    }
});

app.post('/api/generate-declaration', authenticateToken, async (req: any, res) => {
    try {
        const { biddingProcessId, companyId, declarationType, issuerType, customPrompt } = req.body;
        console.log(`[Declaration] Generating "${declarationType}" (${issuerType || 'company'}) for Company: ${companyId}`);

        if (!biddingProcessId || !companyId || !declarationType) {
            return res.status(400).json({ error: 'Missing required parameters' });
        }

        const bidding = await prisma.biddingProcess.findUnique({
            where: { id: biddingProcessId, tenantId: req.user.tenantId },
            include: { aiAnalysis: true }
        });

        const company = await prisma.companyProfile.findUnique({
            where: { id: companyId, tenantId: req.user.tenantId }
        });

        if (!bidding || !company) {
            return res.status(404).json({ error: 'Bidding or Company not found' });
        }

        const isTechnical = issuerType === 'technical';
        let issuerBlock = '';

        if (isTechnical) {
            const techQual = company.technicalQualification || '';
            issuerBlock = `EMITENTE: PROFISSIONAL TÉCNICO (Responsável Técnico)

DADOS DO PROFISSIONAL TÉCNICO:
${techQual || 'Dados cadastrados na qualificação técnica da empresa.'}

DADOS DA EMPRESA VINCULADA:
${company.razaoSocial} | CNPJ: ${company.cnpj}
${company.qualification || ''}

INSTRUÇÃO ESPECIAL (RT): A declaração DEVE ser redigida na PRIMEIRA PESSOA do profissional técnico. Ele é o declarante principal.
Exemplo: "Eu, [Nome], [Nacionalidade], [Estado Civil], [Engenheiro Civil], inscrito no CREA sob nº [Nº], CPF nº [CPF], Responsável Técnico pela empresa [Razão Social], DECLARO..."`;
        } else {
            issuerBlock = `EMITENTE: A EMPRESA (por seu representante legal)

DADOS DA EMPRESA:
${company.razaoSocial} | CNPJ: ${company.cnpj}
${company.qualification || ''}

DADOS DO RESPONSÁVEL TÉCNICO VINCULADO:
${company.technicalQualification || 'Nenhum profissional técnico cadastrado no sistema.'}`;
        }

        const prompt = `Você é um Advogado Sênior especializado em Direito Administrativo e Contratações Públicas, com enfoque na Lei nº 14.133/2021.
Sua tarefa é redigir uma declaração com RIGOR JURÍDICO MÁXIMO e absoluta fidelidade aos requisitos do edital.

TIPO ORIGINAL: "${declarationType}"

${issuerBlock}

LICITAÇÃO:
Objeto: ${bidding.title}
Modalidade/Nº: ${bidding.modality || ''}

RESUMO ESTRUTURADO DO EDITAL (Base compulsória):
${(bidding.aiAnalysis?.fullSummary || bidding.summary || '').substring(0, 3500)}

INSTRUÇÕES DE EXCELÊNCIA JURÍDICA:
1. FIDELIDADE AO EDITAL: Analise o resumo acima em busca de modelos ou exigências específicas para esta declaração (Tipo: ${declarationType}). Se o edital impuser um texto específico, transcreva-o integralmente, adaptando apenas o estritamente necessário para conferir validade perante a Lei 14.133/2021.
2. PRECISÃO TÉCNICA: Utilize terminologia jurídica moderna da nova Lei de Licitações. Evite termos arcaicos, mas mantenha a sobriedade e a autoridade de um documento oficial.
3. TÍTULO: Gere um título técnico e resumido. NUNCA inclua citações de artigos de lei, incisos ou parágrafos no TÍTULO (Ex: NÃO use "Art. 63" ou "Lei 14.133" no título). O título deve ser puramente descritivo (Ex: "DECLARAÇÃO DE INDEFERIMENTO" ou "DECLARAÇÃO DE TRABALHO INFANTIL").
4. NOMES COMPLETOS: No corpo do texto, NUNCA abrevie nomes de pessoas ou da empresa. Transcreva exatamente como fornecido na qualificação.

5. DECLARAÇÃO DE EQUIPE TÉCNICA: Se o tipo for referente à "Indicação de Pessoal Técnico" ou "Equipe Técnica", a declaração DEVE citar nominalmente os dados do "RESPONSÁVEL TÉCNICO VINCULADO" fornecidos acima. NÃO utilize placeholders (Ex: [NOME]) se os dados estiverem disponíveis no contexto. Utilize espaços extras apenas para membros ADICIONAIS além do RT principal.

${customPrompt ? `INSTRUÇÃO ESPECÍFICA DO USUÁRIO (PRIMEIRA PRIORIDADE): ${customPrompt}` : ''}

6. REGRAS CRÍTICAS DE SAÍDA (FORMATO JSON):
- Sua resposta DEVE conter APENAS o objeto JSON puro.
- NUNCA use blocos de código markdown (como \`\`\`json ou \`\`\`).
- FORMATO OBRIGATÓRIO: { "title": "...", "text": "..." }
- O campo "text" deve começar DIRETAMENTE com a qualificação unificada: "${isTechnical ? '[Nome], [nacionalidade], [CREA/CAU], etc, DECLARA...' : 'A empresa [Razão Social], CNPJ [CNPJ], DECLARA...'}"
- PROIBIÇÃO ABSOLUTA: NÃO inclua Local, Data, Nome do Signatário ou Cargo ao final do "text". O corpo deve terminar no ponto final da última frase da declaração. QUALQUER menção a "Lugar, Data" ou "Nome da Empresa" no final será considerada um erro grave.
- EQUIPE TÉCNICA: Se for sobre pessoal técnico, APÓS citar o RT principal, adicione OBRIGATORIAMENTE um parágrafo: "[INDICAR AQUI OUTROS MEMBROS DA EQUIPE SE HOUVER: Nome, CPF e Qualificação]".
- Texto LIMPO, sem negritos (**), sem aspas extras, sem quebras de linha desnecessárias dentro do JSON.`;

        if (!genAI) {
            return res.status(500).json({ error: 'GEMINI_API_KEY não configurada no servidor.' });
        }

        const result = await callGeminiWithRetry(genAI.models, {
            model: 'gemini-2.5-flash',
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            config: { temperature: 0.7, maxOutputTokens: 4096 }
        });

        let rawResponse = (result.text || '').trim();
        // Extract JSON if it has markdown or extra text
        const jsonMatch = rawResponse.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            return res.json({ text: rawResponse.replace(/\*\*/g, ''), title: declarationType.substring(0, 50) });
        }

        try {
            const parsed = JSON.parse(jsonMatch[0]);
            res.json({
                text: parsed.text.replace(/\*\*/g, '').trim(),
                title: parsed.title.replace(/\*\*/g, '').trim()
            });
        } catch (e) {
            res.json({ text: rawResponse.replace(/\*\*/g, ''), title: declarationType.substring(0, 50) });
        }
    } catch (error: any) {
        console.error("Declaration generation error:", error);
        res.status(500).json({ error: 'Failed to generate declaration', details: error?.message || 'Erro desconhecido' });
    }
});

// PNCP Proxy and Saved Searches
app.get('/api/pncp/searches', authenticateToken, async (req: any, res) => {
    try {
        const searches = await prisma.pncpSavedSearch.findMany({
            where: { tenantId: req.user.tenantId },
            include: { company: true },
            orderBy: { createdAt: 'desc' }
        });
        res.json(searches);
    } catch (error) {
        console.error("Fetch saved searches error:", error);
        res.status(500).json({ error: 'Failed to fetch saved searches' });
    }
});

app.post('/api/pncp/searches', authenticateToken, async (req: any, res) => {
    try {
        const tenantId = req.user.tenantId;
        const search = await prisma.pncpSavedSearch.create({
            data: { ...req.body, tenantId }
        });
        res.json(search);
    } catch (error) {
        console.error("Create saved search error:", error);
        res.status(500).json({ error: 'Failed to create saved search' });
    }
});

app.delete('/api/pncp/searches/:id', authenticateToken, async (req: any, res) => {
    try {
        const id = req.params.id;
        const tenantId = req.user.tenantId;
        await prisma.pncpSavedSearch.deleteMany({
            where: { id, tenantId }
        });
        res.json({ success: true });
    } catch (error) {
        console.error("Delete saved search error:", error);
        res.status(500).json({ error: 'Failed to delete saved search' });
    }
});

app.post('/api/pncp/search', authenticateToken, async (req: any, res) => {
    try {
        const { keywords, status, uf, pagina = 1, modalidade, dataInicio, dataFim } = req.body;
        const pageSize = 10;

        // Fetch a large batch from PNCP to enable global sorting (max 500)
        let url = `https://pncp.gov.br/api/search/?tipos_documento=edital&ordenacao=-data&tam_pagina=500&pagina=1`;
        if (keywords) {
            url += `&q=${encodeURIComponent(keywords)}`;
        }
        if (status && status !== 'todas') {
            url += `&status=${status}`;
        }
        if (uf) {
            url += `&ufs=${uf}`;
        }
        if (modalidade && modalidade !== 'todas') {
            url += `&modalidades_licitacao=${encodeURIComponent(modalidade)}`;
        }
        if (dataInicio) {
            url += `&data_inicio=${dataInicio}`;
        }
        if (dataFim) {
            url += `&data_fim=${dataFim}`;
        }

        const agent = new https.Agent({
            rejectUnauthorized: false
        });

        const startTime = Date.now();
        console.log(`[PNCP] START GET ${url}`);

        const response = await axios.get(url, {
            headers: { 'Accept': 'application/json' },
            httpsAgent: agent,
            timeout: 15000
        } as any);

        const data = response.data as any;

        // Debug: log raw structure of first item to understand API format
        const rawItems = Array.isArray(data?.items) ? data.items : (Array.isArray(data?.data) ? data.data : []);
        if (rawItems.length > 0) {
            console.log('[PNCP] RAW first item keys:', Object.keys(rawItems[0]));
            console.log('[PNCP] RAW first item sample:', JSON.stringify(rawItems[0]).substring(0, 500));
        }

        // First pass: extract what we can from search results
        const items = rawItems.map((item: any) => {
            const cnpj = item.orgao_cnpj || item.orgaoEntidade?.cnpj || item.cnpj || '';
            const ano = item.ano || item.anoCompra || '';
            const nSeq = item.numero_sequencial || item.sequencialCompra || item.numero_compra || '';

            // Extract value from all possible fields aggressively
            const rawVal = item.valor_estimado ?? item.valor_global ?? item.valorTotalEstimado
                ?? item.valorTotalHomologado ?? item.amountInfo?.amount ?? item.valorTotalLicitacao ?? 0;
            const valorEstimado = Number(rawVal) || 0;

            // Extract modalidade from API response
            const modalidadeNome = item.modalidade_licitacao_nome || item.modalidade_nome || item.modalidadeNome
                || item.modalidadeLicitacaoNome || '';

            const pncpId = item.numeroControlePNCP || (cnpj && ano && nSeq ? `${cnpj}-${ano}-${nSeq}` : null) || item.id || Math.random().toString();
            return {
                id: pncpId,
                orgao_nome: item.orgao_nome || item.orgaoEntidade?.razaoSocial || item.nomeOrgao || 'Órgão não informado',
                orgao_cnpj: cnpj,
                ano,
                numero_sequencial: nSeq,
                titulo: item.title || item.titulo || item.identificador || 'Sem título',
                objeto: item.description || item.objetoCompra || item.objeto || item.resumo || 'Sem objeto',
                data_publicacao: item.createdAt || item.dataPublicacaoPncp || item.data_publicacao || new Date().toISOString(),
                data_abertura: item.dataAberturaProposta || item.data_inicio_vigencia || item.data_abertura || '',
                data_encerramento_proposta: item.dataEncerramentoProposta || item.data_fim_vigencia || '',
                valor_estimado: valorEstimado,
                uf: item.uf || item.unidadeOrgao?.ufSigla || uf || '--',
                municipio: item.municipio_nome || item.unidadeOrgao?.municipioNome || item.municipio || '--',
                modalidade_nome: modalidadeNome,
                link_sistema: (cnpj && ano && nSeq)
                    ? `https://pncp.gov.br/app/editais/${cnpj}/${ano}/${nSeq}`
                    : (item.linkSistemaOrigem || item.link || ''),
                status: item.situacao_nome || item.situacaoCompraNome || item.status || status || ''
            };
        });
        // GLOBAL sort ALL items by closest deadline using search API dates
        const now = Date.now();
        items.sort((a: any, b: any) => {
            const dateA = new Date(a.data_encerramento_proposta || a.data_abertura || '9999').getTime();
            const dateB = new Date(b.data_encerramento_proposta || b.data_abertura || '9999').getTime();
            const absA = isNaN(dateA) ? Infinity : Math.abs(dateA - now);
            const absB = isNaN(dateB) ? Infinity : Math.abs(dateB - now);
            return absA - absB;
        });

        // Paginate first, then hydrate ONLY the page items (fast!)
        const totalResults = items.length;
        const startIdx = (Number(pagina) - 1) * pageSize;
        const pageItems = items.slice(startIdx, startIdx + pageSize);

        // Hydrate only the 10 items on this page from detail API
        const hydratedPageItems = await Promise.all(pageItems.map(async (item: any) => {
            if (item.orgao_cnpj && item.ano && item.numero_sequencial) {
                try {
                    const detailUrl = `https://pncp.gov.br/api/consulta/v1/orgaos/${item.orgao_cnpj}/compras/${item.ano}/${item.numero_sequencial}`;
                    const detailRes = await axios.get(detailUrl, { httpsAgent: agent, timeout: 5000 } as any);
                    const d: any = detailRes.data;
                    if (d) {
                        if (!item.valor_estimado) {
                            const v = Number(d.valorTotalEstimado ?? d.valorTotalHomologado ?? d.valorGlobal ?? 0);
                            if (v > 0) item.valor_estimado = v;
                        }
                        if (!item.modalidade_nome) {
                            item.modalidade_nome = d.modalidadeNome || d.modalidadeLicitacaoNome || d.modalidade?.nome || '';
                        }
                        // Hydrate dates from detail API
                        if (d.dataEncerramentoProposta) {
                            item.data_encerramento_proposta = d.dataEncerramentoProposta;
                        }
                        if (d.dataAberturaProposta) {
                            item.data_abertura = d.dataAberturaProposta;
                        }
                    }
                } catch (e) {
                    // Safe mute — detail endpoint can fail for some items
                }
            }
            return item;
        }));

        const endTime = Date.now();
        console.log(`[PNCP] END GET (${endTime - startTime}ms) - Total: ${totalResults}, Page ${pagina}: items ${startIdx}-${startIdx + hydratedPageItems.length}`);

        res.json({
            items: hydratedPageItems,
            total: totalResults
        });
    } catch (error: any) {
        console.error("PNCP search error:", error?.message || error);
        res.status(502).json({ error: 'Falha ao comunicar com a API do PNCP', details: error?.message || 'Erro desconhecido' });
    }
});

// ─── Robust JSON Parser (handles Gemini's tendency to append text after JSON) ───
function robustJsonParse(rawText: string, label = 'AI'): any {
    // Step 1: Clean markdown wrappers and control chars
    let cleaned = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
    const firstBrace = cleaned.indexOf('{');
    if (firstBrace === -1) throw new Error('JSON inválido retornado pela IA (no opening brace)');
    cleaned = cleaned.substring(firstBrace);
    cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ' ');

    // Step 2: Try direct parse first (fastest path)
    try {
        return JSON.parse(cleaned);
    } catch (directErr) {
        console.log(`[${label}] Direct JSON.parse failed: ${(directErr as Error).message}. Attempting repair...`);
    }

    // Step 3: Depth-tracked truncation — find where the outermost {} closes
    let depth = 0, inString = false, escape = false;
    let lastValidClose = -1;
    for (let i = 0; i < cleaned.length; i++) {
        const c = cleaned[i];
        if (escape) { escape = false; continue; }
        if (c === '\\') { escape = true; continue; }
        if (c === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (c === '{' || c === '[') depth++;
        if (c === '}' || c === ']') { depth--; if (depth === 0) lastValidClose = i; }
    }

    if (depth === 0 && lastValidClose !== -1) {
        const truncated = cleaned.substring(0, lastValidClose + 1);
        try {
            const result = JSON.parse(truncated);
            console.log(`[${label}] ✅ JSON parsed after depth-tracked truncation at position ${lastValidClose}`);
            return result;
        } catch (truncErr) {
            console.log(`[${label}] Depth-tracked truncation failed: ${(truncErr as Error).message}`);
        }
    }

    // Step 4: Error-position-based truncation — use the position from the JSON error
    try {
        const posMatch = (cleaned.match(/"[^"]*$/) || [null])[0];
        // Try to find the last complete JSON by searching backwards for the last }
        const lastBrace = cleaned.lastIndexOf('}');
        if (lastBrace > 0) {
            let attempt = cleaned.substring(0, lastBrace + 1);
            // Remove trailing comma before closing brace/bracket
            attempt = attempt.replace(/,\s*([}\]])/, '$1');
            try {
                const result = JSON.parse(attempt);
                console.log(`[${label}] ✅ JSON parsed after lastBrace truncation at position ${lastBrace}`);
                return result;
            } catch { /* continue */ }
        }
    } catch { /* continue */ }

    // Step 5: Stack-based bracket repair — close unclosed structures
    console.log(`[${label}] Attempting stack-based bracket repair...`);
    let repaired = cleaned;
    // Remove trailing commas
    repaired = repaired.replace(/,\s*$/, '');
    depth = 0; inString = false; escape = false;
    let stack: string[] = [];
    for (let i = 0; i < repaired.length; i++) {
        const c = repaired[i];
        if (escape) { escape = false; continue; }
        if (c === '\\') { escape = true; continue; }
        if (c === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (c === '{') stack.push('}');
        if (c === '[') stack.push(']');
        if (c === '}' || c === ']') stack.pop();
    }
    if (inString) repaired += '"';
    while (stack.length > 0) repaired += stack.pop();

    try {
        const result = JSON.parse(repaired);
        console.log(`[${label}] ✅ JSON parsed after stack-based repair (added ${stack.length} closers)`);
        return result;
    } catch (finalErr) {
        console.error(`[${label}] ❌ ALL JSON repair strategies failed. Raw length: ${rawText.length}, Error: ${(finalErr as Error).message}`);
        // Log first/last 200 chars for debugging
        console.error(`[${label}] First 200 chars: ${cleaned.substring(0, 200)}`);
        console.error(`[${label}] Last 200 chars: ${cleaned.substring(cleaned.length - 200)}`);
        throw new Error(`Falha ao interpretar resposta da IA (JSON inválido após múltiplas tentativas de reparo)`);
    }
}

// PNCP AI Analysis — analyzes a PNCP edital directly by fetching its PDF files
app.post('/api/pncp/analyze', authenticateToken, async (req: any, res) => {
    try {
        const { orgao_cnpj, ano, numero_sequencial, link_sistema } = req.body;
        if (!orgao_cnpj || !ano || !numero_sequencial) {
            return res.status(400).json({ error: 'orgao_cnpj, ano e numero_sequencial são obrigatórios' });
        }

        const agent = new https.Agent({ rejectUnauthorized: false });
        const JSZip = require('jszip');

        // 1. Fetch edital attachments from PNCP API (correct endpoint: /api/pncp/v1/)
        const arquivosUrl = `https://pncp.gov.br/api/pncp/v1/orgaos/${orgao_cnpj}/compras/${ano}/${numero_sequencial}/arquivos`;
        console.log(`[PNCP-AI] Fetching attachments: ${arquivosUrl}`);

        let arquivos: any[] = [];
        try {
            const arquivosRes = await axios.get(arquivosUrl, { httpsAgent: agent, timeout: 10000 } as any);
            arquivos = Array.isArray(arquivosRes.data) ? arquivosRes.data : [];
            console.log(`[PNCP-AI] Found ${arquivos.length} attachments`);
        } catch (e: any) {
            console.warn(`[PNCP-AI] Failed to fetch attachments: ${e.message}`);
        }

        // 2. Sort to prioritize: Edital (tipoDocumentoId=2) > Termo de Referência (4) > Others
        arquivos.sort((a: any, b: any) => {
            const priority: Record<number, number> = { 2: 0, 4: 1 }; // Edital, TR
            const pa = priority[a.tipoDocumentoId] ?? 99;
            const pb = priority[b.tipoDocumentoId] ?? 99;
            return pa - pb;
        });

        // 3. Download and process files (PDF, ZIP, or RAR containing PDFs)
        const MAX_PDF_PARTS = 5; // Increased from 3 to handle complex editals
        const pdfParts: any[] = [];
        const downloadedFiles: string[] = [];

        for (const arq of arquivos) {
            if (pdfParts.length >= MAX_PDF_PARTS) break;

            const fileUrl = arq.url || arq.uri || '';
            const fileName = arq.titulo || arq.nomeArquivo || arq.nome || 'arquivo';
            if (!fileUrl || !arq.statusAtivo) continue;

            try {
                console.log(`[PNCP-AI] Downloading: "${fileName}" (tipo: ${arq.tipoDocumentoDescricao || arq.tipoDocumentoId}) from ${fileUrl}`);
                const fileRes = await axios.get(fileUrl, {
                    httpsAgent: agent,
                    timeout: 90000,
                    responseType: 'arraybuffer',
                    maxRedirects: 5
                } as any);

                const buffer = Buffer.from(fileRes.data as ArrayBuffer);
                if (buffer.length === 0) continue;

                // Detect file type by magic bytes
                const isPdf = buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46; // %PDF
                const isZip = buffer[0] === 0x50 && buffer[1] === 0x4B; // PK
                const isRar = buffer[0] === 0x52 && buffer[1] === 0x61 && buffer[2] === 0x72 && buffer[3] === 0x21; // Rar!

                if (isPdf) {
                    const safeFileName = `pncp_${req.user.tenantId}_${fileName.replace(/[^a-z0-9._-]/gi, '_')}`;
                    fs.writeFileSync(path.join(uploadDir, safeFileName), buffer);

                    pdfParts.push({
                        inlineData: { data: buffer.toString('base64'), mimeType: 'application/pdf' }
                    });
                    downloadedFiles.push(safeFileName);
                    console.log(`[PNCP-AI] ✅ PDF: ${fileName} saved as ${safeFileName} (${(buffer.length / 1024).toFixed(0)} KB)`);
                } else if (isZip) {
                    console.log(`[PNCP-AI] 📦 ZIP detected: ${fileName} (${(buffer.length / 1024).toFixed(0)} KB) — extracting PDFs...`);
                    try {
                        const zip = await JSZip.loadAsync(buffer);
                        const zipEntries = Object.keys(zip.files).filter((name: string) =>
                            name.toLowerCase().endsWith('.pdf') && !zip.files[name].dir
                        );
                        console.log(`[PNCP-AI] ZIP contains ${zipEntries.length} PDF(s): ${zipEntries.join(', ')}`);

                        for (const entryName of zipEntries) {
                            if (pdfParts.length >= MAX_PDF_PARTS) break;
                            const pdfBuffer = await zip.files[entryName].async('nodebuffer');
                            if (pdfBuffer.length > 0) {
                                const safeName = `pncp_${req.user.tenantId}_${entryName.replace(/[^a-z0-9._-]/gi, '_')}`;
                                fs.writeFileSync(path.join(uploadDir, safeName), pdfBuffer);

                                pdfParts.push({
                                    inlineData: { data: pdfBuffer.toString('base64'), mimeType: 'application/pdf' }
                                });
                                downloadedFiles.push(safeName);
                                console.log(`[PNCP-AI] ✅ Extracted from ZIP: ${entryName} saved as ${safeName} (${(pdfBuffer.length / 1024).toFixed(0)} KB)`);
                            }
                        }
                    } catch (zipErr: any) {
                        console.warn(`[PNCP-AI] Failed to extract ZIP ${fileName}: ${zipErr.message}`);
                    }
                } else if (isRar) {
                    console.log(`[PNCP-AI] 📦 RAR detected: ${fileName} (${(buffer.length / 1024).toFixed(0)} KB) — extracting PDFs...`);
                    try {
                        const extractor = await createExtractorFromData({ data: new Uint8Array(buffer).buffer });
                        const extracted = extractor.extract({});
                        const files = [...extracted.files];
                        const pdfFiles = files.filter(f =>
                            f.fileHeader.name.toLowerCase().endsWith('.pdf') &&
                            !f.fileHeader.flags.directory &&
                            f.extraction
                        );
                        console.log(`[PNCP-AI] RAR contains ${pdfFiles.length} PDF(s): ${pdfFiles.map(f => f.fileHeader.name).join(', ')}`);

                        for (const rarFile of pdfFiles) {
                            if (pdfParts.length >= MAX_PDF_PARTS) break;
                            if (rarFile.extraction && rarFile.extraction.length > 0) {
                                const pdfBuffer = Buffer.from(rarFile.extraction);
                                pdfParts.push({
                                    inlineData: { data: pdfBuffer.toString('base64'), mimeType: 'application/pdf' }
                                });
                                downloadedFiles.push(`${fileName}/${rarFile.fileHeader.name}`);
                                console.log(`[PNCP-AI] ✅ Extracted from RAR: ${rarFile.fileHeader.name} (${(pdfBuffer.length / 1024).toFixed(0)} KB)`);
                            }
                        }
                    } catch (rarErr: any) {
                        console.warn(`[PNCP-AI] Failed to extract RAR ${fileName}: ${rarErr.message}`);
                    }
                } else {
                    console.log(`[PNCP-AI] ⏭️ Skipped non-PDF/non-ZIP/non-RAR: ${fileName} (first bytes: ${buffer[0].toString(16)} ${buffer[1].toString(16)})`);
                }
            } catch (dlErr: any) {
                console.warn(`[PNCP-AI] Failed to download ${fileName}: ${dlErr.message}`);
            }
        }

        if (pdfParts.length === 0) {
            return res.status(400).json({
                error: 'Nenhum arquivo PDF encontrado para este edital no PNCP.',
                details: `Encontramos ${arquivos.length} arquivo(s) mas nenhum era PDF ou ZIP com PDFs.`
            });
        }

        // 3. Setup Gemini AI
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: 'GEMINI_API_KEY não configurada' });
        }
        const ai = new GoogleGenAI({ apiKey });

        // 4. Use enhanced analysis prompt with strict precision for financial data, deadlines, OCR, and Qualificação Técnica
        const systemInstruction = `
Você é um consultor jurídico sênior e analista financeiro especializado em licitações públicas brasileiras (Lei 14.133/2021 e Lei 8.666/1993).
SUA MISSÃO É realizar uma ANÁLISE PROFUNDA, PRECISA E EXAUSTIVA do edital, com atenção especial a:
- Resumo executivo detalhado e profissional
- Dados financeiros EXATOS (valores, garantias, reajustes)
- Prazos com datas e horários PRECISOS
- Documentos de habilitação com referência EXATA ao item do edital
- Qualificação técnica SEM QUALQUER RESUMO

=== REGRAS CRÍTICAS ===
1. Responda APENAS com um objeto JSON válido. NUNCA adicione crases Markdown, textos explicativos, ou qualquer conteúdo antes ou depois do JSON.
2. NUNCA invente dados. Se uma informação não estiver no documento, retorne string vazia ou array vazio.
3. O campo 'risk' deve ser obrigatoriamente: "Baixo", "Médio", "Alto" ou "Crítico".
4. FUJA DE ASPAS DUPLAS INTERNAS: NUNCA use aspas duplas dentro dos valores de texto do seu JSON. Use aspas simples.

=== REGRAS PARA OCR E DOCUMENTOS DIGITALIZADOS ===
5. ATENÇÃO MÁXIMA A PDFs DE IMAGEM: Alguns documentos são PDFs escaneados (imagens). Você DEVE ler cuidadosamente cada página como imagem, realizando OCR visual.
6. Em documentos digitalizados, ignore marcas d'água, carimbos, logomarcas e numeração de páginas.
7. Se a qualidade do scan for baixa, esforce-se ao máximo para interpretar o texto. Indique no fullSummary se houve dificuldade de leitura.
8. ESTRATÉGIA DE BUSCA: Analise o índice/sumário do documento (se houver) para localizar rapidamente as seções de HABILITAÇÃO, QUALIFICAÇÃO TÉCNICA, TERMO DE REFERÊNCIA e CLÁUSULAS FINANCEIRAS.

=== REGRAS PARA RESUMO EXECUTIVO (summary) ===
9. O campo 'summary' deve ser um RESUMO EXECUTIVO PROFISSIONAL com no mínimo 300 palavras, contendo:
   a) OBJETO DETALHADO: Descrição completa e precisa do que está sendo licitado (não apenas o título).
   b) ESCOPO DOS SERVIÇOS/FORNECIMENTO: Detalhamento do que será executado/fornecido.
   c) LOCAL DE EXECUÇÃO: Onde os serviços serão prestados ou onde os bens serão entregues.
   d) PRAZO DE VIGÊNCIA/EXECUÇÃO: Duração do contrato ou prazo de entrega.
   e) CONDIÇÕES ESPECIAIS: Requisitos particulares deste edital.
   f) CRITÉRIO DE JULGAMENTO: Menor preço, técnica e preço, maior desconto, etc.

=== REGRAS PARA DADOS FINANCEIROS (PRECISÃO OBRIGATÓRIA) ===
10. O campo 'estimatedValue' DEVE conter o valor EXATO em formato numérico (sem formatação). Se houver valor total estimado e valor por lote, use o valor TOTAL.
11. O campo 'pricingConsiderations' deve conter uma ANÁLISE FINANCEIRA DETALHADA incluindo:
    a) Valor total estimado da contratação e como foi composto (média de cotações, tabela SINAPI, etc.).
    b) Critério de aceitabilidade de preços (preço máximo, valor de referência).
    c) Condições de pagamento (prazo, forma, nota fiscal requerida).
    d) Existência de garantia contratual e percentual exigido.
    e) Critérios de reajuste/reequilíbrio econômico-financeiro.
    f) Existe BDI (Bonificação e Despesas Indiretas)? Taxa exigida?
    g) Dotação orçamentária mencionada.
    h) Desconto ofertado sobre tabela (se aplicável).

=== REGRAS PARA PRAZOS (deadlines) — PRECISÃO TOTAL ===
12. O campo 'deadlines' deve ser um ARRAY com CADA prazo importante EXATAMENTE como consta no edital:
    a) Data e hora de ABERTURA DA SESSÃO PÚBLICA (obrigatório se existir)
    b) Prazo para IMPUGNAÇÃO do edital (com data limite calculada)
    c) Prazo para ESCLARECIMENTOS (com data limite)
    d) Prazo de ENTREGA DE PROPOSTAS (data/hora início e fim)
    e) Prazo de VIGÊNCIA CONTRATUAL
    f) Prazo de ENTREGA DOS BENS ou EXECUÇÃO DOS SERVIÇOS
    g) Prazo para assinatura do contrato após homologação
    h) Quaisquer outros prazos mencionados no edital
    FORMATO: "DD/MM/AAAA HH:MM - Descrição completa do prazo" (use 24h)

=== REGRAS PARA DOCUMENTOS EXIGIDOS (requiredDocuments) ===
13. COLOQUE A REFERÊNCIA EXATA do item do edital no campo 'item' (Ex: "6.1.1.a", "9.2.3").
14. CRIE UMA ENTRADA SEPARADA PARA CADA DOCUMENTO. Se um item lista 5 documentos, retorne 5 objetos.
15. A 'description' deve conter o NOME COMPLETO do documento como descrito no edital, incluindo detalhes de validade se mencionados.

=== REGRAS PARA QUALIFICAÇÃO TÉCNICA (ABSOLUTAMENTE PROIBIDO RESUMIR) ===
16. TRANSCREVA LITERALMENTE cada exigência de Qualificação Técnica como consta no edital.
17. NUNCA resuma, agrupe ou simplifique os atestados de capacidade técnica.
18. Se o edital exige "atestado de capacidade técnica comprovando execução de serviço compatível com pavimentação asfáltica em área mínima de 5.000m²", transcreva EXATAMENTE isso — não resuma como "Atestado de capacidade técnica".
19. Inclua TODAS as quantidades mínimas, percentuais, áreas, volumes e especificações técnicas mencionadas.
20. Para cada profissional exigido (RT/engenheiro), detalhe: formação, registro no conselho (CREA/CAU), experiência mínima.
21. Transcreva separadamente cada atestado exigido, com suas particularidades (tipo de serviço, quantidades, parcela de maior relevância).
22. Se o edital menciona CAT (Certidão de Acervo Técnico), detalhe exatamente qual tipo de acervo é exigido.
23. O campo 'qualificationRequirements' deve conter a transcrição COMPLETA e LITERAL de TODA a seção de Qualificação Técnica do edital — sem qualquer resumo.

=== REGRAS PARA ITENS LICITADOS (biddingItems) ===
24. Se houver tabelas de itens (lotes), extraia TODOS os itens com: número do item/lote, descrição técnica completa, unidade de medida, quantidade e valor unitário estimado (se disponível).
25. NÃO limite a 3 itens. Se o edital tiver 50 itens, transcreva todos.

=== REGRAS PARA PARECER (fullSummary) ===
26. O campo 'fullSummary' deve conter um PARECER TÉCNICO-JURÍDICO de no mínimo 400 palavras, incluindo:
    a) Análise da viabilidade de participação.
    b) Pontos de atenção jurídica e riscos.
    c) Análise das exigências de habilitação (se são proporcionais).
    d) Análise das condições contratuais.
    e) Recomendações estratégicas para o licitante.
    f) Avaliação do regime de execução.

=== REGRAS PARA PENALIDADES (penalties) ===
27. Extrair TODAS as penalidades com valores/percentuais EXATOS: multas (% sobre valor contratual), advertências, suspensão (prazo), impedimento (prazo), declaração de inidoneidade.

FORMATO DE SAÍDA JSON:
{
  "process": {
    "title": "Número EXATO e órgão emissor (Ex: Pregão Eletrônico nº 01/2026 - Prefeitura Municipal de Fortaleza/CE)",
    "summary": "RESUMO EXECUTIVO detalhado com mínimo 300 palavras contendo: objeto, escopo, local de execução, prazo de vigência, condições especiais e critério de julgamento",
    "modality": "Modalidade EXATA (Pregão Eletrônico, Concorrência Eletrônica, Dispensa, RDC, etc.)",
    "portal": "PNCP",
    "estimatedValue": 100000.50,
    "sessionDate": "2026-03-15T09:00:00Z",
    "risk": "Baixo"
  },
  "analysis": {
    "requiredDocuments": {
       "Habilitação Jurídica": [ { "item": "6.1.1", "description": "Nome EXATO e completo do documento conforme edital" } ],
       "Regularidade Fiscal, Social e Trabalhista": [ { "item": "6.2.1", "description": "Certidão Conjunta de Débitos Relativos a Tributos Federais e à Dívida Ativa da União" } ],
       "Qualificação Técnica": [ { "item": "6.3.1", "description": "TRANSCRIÇÃO LITERAL E COMPLETA da exigência, incluindo quantidades mínimas, especificações e parcelas de maior relevância" } ],
       "Qualificação Econômica Financeira": [ { "item": "6.4.1", "description": "Balanço patrimonial e demonstrações contábeis do último exercício social com índice de LG >= 1,0" } ],
       "Declarações e Outros": [ { "item": "6.5.1", "description": "Declaração de inexistência de fato superveniente impeditivo" } ]
    },
    "biddingItems": "Detalhamento extensivo de TODOS os itens/lotes licitados com: número do item, descrição técnica completa, unidade, quantidade e valor unitário estimado",
    "pricingConsiderations": "ANÁLISE FINANCEIRA DETALHADA: valor total, composição de preço, critério de aceitabilidade, condições de pagamento, garantia contratual, reajuste, BDI, dotação orçamentária",
    "irregularitiesFlags": [ "Pontos de atenção, riscos e possíveis irregularidades identificados no edital" ],
    "fullSummary": "PARECER TÉCNICO-JURÍDICO de mínimo 400 palavras com: análise de viabilidade, pontos jurídicos, proporcionalidade das exigências, condições contratuais, recomendações estratégicas",
    "deadlines": [ "DD/MM/AAAA HH:MM - Descrição completa do prazo (abertura, impugnação, esclarecimento, propostas, vigência, entrega, etc.)" ],
    "penalties": "Detalhamento COMPLETO das penalidades com valores/percentuais EXATOS: multas, advertências, suspensão, impedimento, inidoneidade",
    "qualificationRequirements": "TRANSCRIÇÃO COMPLETA E LITERAL de TODA a seção de Qualificação Técnica, incluindo cada atestado exigido com quantidades mínimas, parcelas de maior relevância, profissionais exigidos com registros em conselhos, CATs, e quaisquer requisitos técnicos. NÃO RESUMA."
  }
}`;

        console.log(`[PNCP-AI] Calling Gemini with ${pdfParts.length} PDF parts (files: ${downloadedFiles.join(', ')})...`);
        const startTime = Date.now();

        const response = await callGeminiWithRetry(ai.models, {
            model: 'gemini-2.5-flash',
            contents: [{
                role: 'user',
                parts: [
                    ...pdfParts,
                    { text: `Analise este(s) edital(is) de licitação com MÁXIMA PROFUNDIDADE e PRECISÃO. Os documentos podem ser PDFs nativos ou PDFs de imagem (escaneados/digitalizados) — em caso de imagens, realize OCR visual cuidadoso.\n\nRETORNE EXCLUSIVAMENTE o objeto JSON especificado nas instruções do sistema. NÃO adicione texto explicativo antes ou depois do JSON.\n\nATENÇÃO ESPECIAL:\n1. Extraia TODOS os prazos com datas e horários EXATOS\n2. Extraia o valor estimado EXATO (numérico)\n3. Detalhe CADA documento de habilitação com referência do item do edital\n4. O resumo executivo deve ter no mínimo 300 palavras\n5. O parecer (fullSummary) deve ter no mínimo 400 palavras\n6. Extraia TODAS as penalidades com percentuais exatos\n7. NÃO resuma a Qualificação Técnica — transcreva literalmente` }
                ]
            }],
            config: {
                systemInstruction,
                temperature: 0.1,
                maxOutputTokens: 32768,
                responseMimeType: 'application/json'
            }
        });

        const duration = (Date.now() - startTime) / 1000;
        console.log(`[PNCP-AI] Gemini responded in ${duration.toFixed(1)}s`);

        const rawText = response.text;
        if (!rawText) throw new Error('A IA não retornou nenhum texto.');

        // 5. Parse JSON with robust multi-strategy parser
        const finalPayload = robustJsonParse(rawText, 'PNCP-AI');

        // Add source info
        finalPayload.pncpSource = {
            link_sistema,
            downloadedFiles,
            analyzedAt: new Date().toISOString()
        };

        console.log(`[PNCP-AI] SUCCESS — process keys: ${Object.keys(finalPayload.process || {}).join(', ')}`);
        res.json(finalPayload);

    } catch (error: any) {
        console.error('[PNCP-AI] Error:', error?.message || error);
        res.status(500).json({ error: `Erro na análise IA do PNCP: ${error?.message || 'Erro desconhecido'}` });
    }
});

// Bidding Processes
app.get('/api/biddings', authenticateToken, async (req: any, res) => {
    try {
        const biddings = await prisma.biddingProcess.findMany({
            where: { tenantId: req.user.tenantId },
            include: { aiAnalysis: true }
        });
        res.json(biddings);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch biddings' });
    }
});

app.post('/api/biddings', authenticateToken, async (req: any, res) => {
    try {
        let { companyProfileId, ...biddingData } = req.body;
        const tenantId = req.user.tenantId;

        if (companyProfileId === '') {
            companyProfileId = null;
        }

        const bidding = await prisma.biddingProcess.create({
            data: { ...biddingData, tenantId, companyProfileId }
        });
        res.json(bidding);
    } catch (error) {
        console.error("Create bidding error:", error);
        res.status(500).json({ error: 'Failed to create bidding', details: error instanceof Error ? error.message : String(error) });
    }
});

app.put('/api/biddings/:id', authenticateToken, async (req: any, res) => {
    try {
        const { id } = req.params;
        const tenantId = req.user.tenantId;

        // Remove relation fields and id to avoid Prisma update errors
        const {
            aiAnalysis,
            company,
            tenant,
            id: _id,
            tenantId: _tId,
            companyProfileId,
            ...biddingData
        } = req.body;

        const bidding = await prisma.biddingProcess.update({
            where: {
                id,
                tenantId // Ensure user can only update their own tenant's data
            },
            data: {
                ...biddingData,
                companyProfileId: companyProfileId === '' ? null : companyProfileId
            }
        });
        res.json(bidding);
    } catch (error) {
        console.error("Update bidding error:", error);
        res.status(500).json({ error: 'Failed to update bidding', details: error instanceof Error ? error.message : String(error) });
    }
});

app.delete('/api/biddings/:id', authenticateToken, async (req: any, res) => {
    try {
        const { id } = req.params;
        const bidding = await prisma.biddingProcess.findUnique({ where: { id } });

        if (bidding && bidding.tenantId === req.user.tenantId) {
            await prisma.biddingProcess.delete({ where: { id } });
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'Bidding not found or unauthorized' });
        }
    } catch (error) {
        console.error("Delete bidding error:", error);
        res.status(500).json({ error: 'Failed to delete bidding' });
    }
});

// Ai Analysis
app.post('/api/analysis', authenticateToken, async (req: any, res) => {
    try {
        const payload = { ...req.body };

        // Verify if biddingProcess belongs to the tenant
        const bidding = await prisma.biddingProcess.findUnique({
            where: { id: payload.biddingProcessId }
        });

        if (!bidding || bidding.tenantId !== req.user.tenantId) {
            return res.status(403).json({ error: 'Unauthorized to add analysis to this process' });
        }

        if (typeof payload.requiredDocuments === 'object') {
            payload.requiredDocuments = JSON.stringify(payload.requiredDocuments);
        }
        if (typeof payload.deadlines === 'object') {
            payload.deadlines = JSON.stringify(payload.deadlines);
        }
        if (typeof payload.chatHistory === 'object') {
            payload.chatHistory = JSON.stringify(payload.chatHistory);
        }

        const stringifyIfObject = (field: string) => {
            if (payload[field] && typeof payload[field] === 'object') {
                payload[field] = JSON.stringify(payload[field]);
            }
        };

        ['biddingItems', 'pricingConsiderations', 'fullSummary', 'penalties', 'qualificationRequirements', 'irregularitiesFlags', 'sourceFileNames'].forEach(stringifyIfObject);

        console.log(`[Analysis] Upserting analysis for process ${payload.biddingProcessId}. Payload summary length: ${payload.fullSummary?.length || 0}. Files: ${payload.sourceFileNames}`);

        const analysis = await prisma.aiAnalysis.upsert({
            where: {
                biddingProcessId: payload.biddingProcessId
            },
            create: payload,
            update: payload
        });

        // Debug log to confirm what was actually saved
        console.log(`[Analysis] SUCCESS for ${payload.biddingProcessId}. Saved sourceFiles: ${analysis.sourceFileNames?.substring(0, 100)}`);

        res.json(analysis);
    } catch (error) {
        console.error("Create analysis error:", error);
        res.status(500).json({ error: 'Failed to save AI analysis' });
    }
});

// Basic Documents Fetch (Scoped)
app.get('/api/documents', authenticateToken, async (req: any, res) => {
    try {
        const documents = await prisma.document.findMany({
            where: { tenantId: req.user.tenantId },
            select: {
                id: true,
                tenantId: true,
                companyProfileId: true,
                docType: true,
                fileUrl: true,
                expirationDate: true,
                status: true,
                autoRenew: true,
                docGroup: true,
                issuerLink: true,
                fileName: true,
                alertDays: true,
                uploadDate: true
            },
            orderBy: { uploadDate: 'desc' }
        });
        res.json(documents);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch documents' });
    }
});

// File Upload endpoint (Protected)
app.post('/api/upload', authenticateToken, upload.single('file'), async (req: any, res: any) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const { url: fileUrl, fileName } = await storageService.uploadFile(req.file, req.user.tenantId);

        // Register in Document table (Crucial for security and context mapping)
        const document = await prisma.document.create({
            data: {
                tenantId: req.user.tenantId,
                docType: "Edital/Anexo",
                fileUrl: fileUrl,
                fileName: req.file.originalname,
                expirationDate: new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
                status: "Válido"
            }
        });

        res.json({
            message: 'File uploaded successfully',
            fileUrl,
            fileName: req.file.originalname,
            storageName: fileName,
            originalName: req.file.originalname,
            documentId: document.id
        });
    } catch (error) {
        console.error("Upload error:", error);
        res.status(500).json({ error: 'File upload failed' });
    }
});


// Helper for Gemini with retry (for 503/429 errors) + model fallback
const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'];

async function callGeminiWithRetry(model: any, options: any, maxRetries = 4) {
    let lastError;
    for (const modelName of GEMINI_MODELS) {
        const attemptOptions = { ...options, model: modelName };
        for (let i = 0; i < maxRetries; i++) {
            try {
                console.log(`[Gemini] Trying model '${modelName}' (attempt ${i + 1}/${maxRetries})`);
                return await model.generateContent(attemptOptions);
            } catch (error: any) {
                lastError = error;
                const isRetryable = error?.message?.includes('503') || error?.message?.includes('429') ||
                    error?.status === 503 || error?.code === 503 ||
                    error?.status === 429 || error?.code === 429;
                if (isRetryable) {
                    const delay = Math.min((i + 1) * 3000, 15000); // exponential backoff, max 15s
                    console.warn(`[Gemini] ${error?.status || '503/429'} error on '${modelName}', retrying in ${delay}ms... (Attempt ${i + 1}/${maxRetries})`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    continue;
                }
                // Non-retryable error: break inner loop, try next model
                const errorMsg = error?.message || String(error);
                console.error(`[Gemini] Non-retryable error on '${modelName}': ${errorMsg}`);
                break;
            }
        }
        console.warn(`[Gemini] All retries exhausted for model '${modelName}', trying next model...`);
    }

    const finalErrorMsg = lastError?.message || String(lastError);
    if (finalErrorMsg.includes('leaked') || lastError?.status === 403) {
        console.error("!!! CRITICAL: GEMINI API KEY IS LEAKED OR INVALID !!!", lastError);
        throw new Error("A chave da API Gemini foi bloqueada por razões de segurança ou é inválida. Por favor, atualize a GEMINI_API_KEY no arquivo .env.");
    }

    throw lastError;
}

// AI Analysis Endpoint
app.post('/api/analyze-edital', authenticateToken, async (req: any, res) => {
    try {
        const { fileNames } = req.body;
        if (!fileNames || !Array.isArray(fileNames) || fileNames.length === 0) {
            return res.status(400).json({ error: 'fileNames array is required' });
        }

        let fullText = "";
        const pdfParts: any[] = [];

        // 1. Prepare files for Gemini (and verify tenant ownership)
        for (let fileNameSource of fileNames) {
            const fileName = decodeURIComponent(fileNameSource).split('?')[0];

            // Security: Verify if file belongs to tenant
            const doc = await prisma.document.findFirst({
                where: {
                    fileUrl: { contains: fileName },
                    tenantId: req.user.tenantId
                }
            });

            const belongsToTenant = doc || fileName.startsWith(`${req.user.tenantId}_`) || fileName.includes(`${req.user.tenantId}/`);

            if (!belongsToTenant) {
                console.warn(`[AI] Unauthorized access attempt to file: ${fileName} by tenant: ${req.user.tenantId}`);
                continue;
            }

            const fileToFetch = doc ? doc.fileUrl : fileName;
            const pdfBuffer = await getFileBufferSafe(fileToFetch, req.user.tenantId);

            if (pdfBuffer) {
                console.log(`[AI] Read file ${fileName} (${pdfBuffer.length} bytes)`);
                pdfParts.push({
                    inlineData: {
                        data: pdfBuffer.toString('base64'),
                        mimeType: 'application/pdf'
                    }
                });
            } else {
                console.error(`[AI] Could not find file anywhere: ${fileName}`);
            }
        }

        if (pdfParts.length === 0) {
            console.warn(`[AI] No valid files found for analysis among: ${fileNames.join(', ')}`);
            return res.status(400).json({
                error: 'Nenhum arquivo válido encontrado para análise no servidor.',
                details: `Foram processados ${fileNames.length} arquivos, mas nenhum pôde ser resgatado do armazenamento. Verifique se o bucket do Supabase está correto.`
            });
        }

        // 2. Setup Gemini AI
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            console.error(`[AI] GEMINI_API_KEY is missing!`);
            return res.status(500).json({ error: 'GEMINI_API_KEY is not configured in the backend' });
        }
        const ai = new GoogleGenAI({ apiKey });

        // 3. System Prompt & Strict JSON Schema Definition (Enhanced with precision rules)
        const systemInstruction = `
Você é um consultor jurídico sênior e analista financeiro especializado em licitações públicas brasileiras (Lei 14.133/2021 e Lei 8.666/1993).
SUA MISSÃO É realizar uma ANÁLISE PROFUNDA, PRECISA E EXAUSTIVA do edital, com atenção especial a:
- Resumo executivo detalhado e profissional
- Dados financeiros EXATOS (valores, garantias, reajustes)
- Prazos com datas e horários PRECISOS
- Documentos de habilitação com referência EXATA ao item do edital
- Qualificação técnica SEM QUALQUER RESUMO

NÃO AGRUPE documentos em uma única string. Se o edital pede "Certidão Federal, Estadual e Municipal", você deve criar TRÊS entradas separadas no JSON.

=== REGRAS CRÍTICAS ===
1. Responda APENAS com um objeto JSON válido. NUNCA adicione crases Markdown, textos explicativos, ou qualquer conteúdo antes ou depois do JSON.
2. NUNCA invente dados. Se uma informação não estiver no documento, retorne string vazia ou array vazio.
3. O campo 'risk' deve ser obrigatoriamente: "Baixo", "Médio", "Alto" ou "Crítico".
4. FUJA DE ASPAS DUPLAS INTERNAS: NUNCA use aspas duplas dentro dos valores de texto do seu JSON. Use aspas simples.

=== REGRAS PARA OCR E DOCUMENTOS DIGITALIZADOS ===
5. ATENÇÃO MÁXIMA A PDFs DE IMAGEM: Alguns documentos são PDFs escaneados (imagens/fotografias de páginas). Você DEVE ler cuidadosamente cada página como imagem, realizando OCR visual.
6. Em documentos digitalizados, ignore marcas d'água, carimbos, logomarcas e numeração de páginas.
7. Se a qualidade do scan for baixa, esforce-se ao máximo para interpretar o texto. Indique no fullSummary se houve dificuldade de leitura.
8. ESTRATÉGIA DE BUSCA: Analise o índice/sumário do documento (se houver) para localizar rapidamente as seções de HABILITAÇÃO, QUALIFICAÇÃO TÉCNICA, TERMO DE REFERÊNCIA e CLÁUSULAS FINANCEIRAS.

=== REGRAS PARA RESUMO EXECUTIVO (summary) ===
9. O campo 'summary' deve ser um RESUMO EXECUTIVO PROFISSIONAL com no mínimo 300 palavras, contendo:
   a) OBJETO DETALHADO: Descrição completa e precisa do que está sendo licitado (não apenas o título).
   b) ESCOPO DOS SERVIÇOS/FORNECIMENTO: Detalhamento do que será executado/fornecido.
   c) LOCAL DE EXECUÇÃO: Onde os serviços serão prestados ou onde os bens serão entregues.
   d) PRAZO DE VIGÊNCIA/EXECUÇÃO: Duração do contrato ou prazo de entrega.
   e) CONDIÇÕES ESPECIAIS: Requisitos particulares deste edital.
   f) CRITÉRIO DE JULGAMENTO: Menor preço, técnica e preço, maior desconto, etc.

=== REGRAS PARA DADOS FINANCEIROS (PRECISÃO OBRIGATÓRIA) ===
10. O campo 'estimatedValue' DEVE conter o valor EXATO em formato numérico (sem formatação). Se houver valor total estimado e valor por lote, use o valor TOTAL.
11. O campo 'pricingConsiderations' deve conter uma ANÁLISE FINANCEIRA DETALHADA incluindo:
    a) Valor total estimado da contratação e como foi composto (média de cotações, tabela SINAPI, etc.).
    b) Critério de aceitabilidade de preços (preço máximo, valor de referência).
    c) Condições de pagamento (prazo, forma, nota fiscal requerida).
    d) Existência de garantia contratual e percentual exigido.
    e) Critérios de reajuste/reequilíbrio econômico-financeiro.
    f) Existe BDI (Bonificação e Despesas Indiretas)? Taxa exigida?
    g) Dotação orçamentária mencionada.
    h) Desconto ofertado sobre tabela (se aplicável).

=== REGRAS PARA PRAZOS (deadlines) — PRECISÃO TOTAL ===
12. O campo 'deadlines' deve ser um ARRAY com CADA prazo importante EXATAMENTE como consta no edital:
    a) Data e hora de ABERTURA DA SESSÃO PÚBLICA (obrigatório se existir)
    b) Prazo para IMPUGNAÇÃO do edital (com data limite calculada)
    c) Prazo para ESCLARECIMENTOS (com data limite)
    d) Prazo de ENTREGA DE PROPOSTAS (data/hora início e fim)
    e) Prazo de VIGÊNCIA CONTRATUAL
    f) Prazo de ENTREGA DOS BENS ou EXECUÇÃO DOS SERVIÇOS
    g) Prazo para assinatura do contrato após homologação
    h) Quaisquer outros prazos mencionados no edital
    FORMATO: "DD/MM/AAAA HH:MM - Descrição completa do prazo" (use 24h)

=== REGRAS PARA DOCUMENTOS EXIGIDOS (requiredDocuments) ===
13. COLOQUE A REFERÊNCIA EXATA do item do edital no campo 'item' (Ex: "6.1.1.a", "9.2.3").
14. CRIE UMA ENTRADA SEPARADA PARA CADA DOCUMENTO. Se um item lista 5 documentos, retorne 5 objetos.
15. A 'description' deve conter o NOME COMPLETO do documento como descrito no edital, incluindo detalhes de validade se mencionados.
16. Detalhe os itens licitados no campo 'biddingItems', extraindo as quantias e descrições técnicas do Termo de Referência.
17. TRANSCRIÇÃO DE ITENS: Se houver tabelas de itens (lotes) no TR, extraia TODOS os dados técnicos e quantidades.

=== REGRAS PARA QUALIFICAÇÃO TÉCNICA (ABSOLUTAMENTE PROIBIDO RESUMIR) ===
18. TRANSCREVA LITERALMENTE cada exigência de Qualificação Técnica como consta no edital.
19. NUNCA resuma, agrupe ou simplifique os atestados de capacidade técnica.
20. Se o edital exige "atestado de capacidade técnica comprovando execução de serviço compatível com pavimentação asfáltica em área mínima de 5.000m²", transcreva EXATAMENTE isso — não resuma como "Atestado de capacidade técnica".
21. Inclua TODAS as quantidades mínimas, percentuais, áreas, volumes e especificações técnicas mencionadas.
22. Para cada profissional exigido (RT/engenheiro), detalhe: formação, registro no conselho (CREA/CAU), experiência mínima.
23. Transcreva separadamente cada atestado exigido, com suas particularidades (tipo de serviço, quantidades, parcela de maior relevância).
24. Se o edital menciona CAT (Certidão de Acervo Técnico), detalhe exatamente qual tipo de acervo é exigido.
25. O campo 'qualificationRequirements' deve conter a transcrição COMPLETA e LITERAL de TODA a seção de Qualificação Técnica — sem qualquer resumo.
26. Se a resposta ficar longa, resuma "biddingItems" mas NUNCA resuma a Qualificação Técnica nem o resumo executivo.

=== REGRAS PARA PARECER (fullSummary) ===
27. O campo 'fullSummary' deve conter um PARECER TÉCNICO-JURÍDICO de no mínimo 400 palavras, incluindo:
    a) Análise da viabilidade de participação.
    b) Pontos de atenção jurídica e riscos.
    c) Análise das exigências de habilitação (se são proporcionais).
    d) Análise das condições contratuais.
    e) Recomendações estratégicas para o licitante.
    f) Avaliação do regime de execução.

=== REGRAS PARA PENALIDADES (penalties) ===
28. Extrair TODAS as penalidades com valores/percentuais EXATOS: multas (% sobre valor contratual), advertências, suspensão (prazo), impedimento (prazo), declaração de inidoneidade.

EXTRAIA OS DADOS SEGUINDO ESTE FORMATO EXATO DE SAÍDA JSON:
{
  "process": {
    "title": "Número EXATO e órgão emissor (Ex: Pregão Eletrônico nº 01/2026 - Prefeitura Municipal de Fortaleza/CE)",
    "summary": "RESUMO EXECUTIVO detalhado com mínimo 300 palavras contendo: objeto, escopo, local de execução, prazo de vigência, condições especiais e critério de julgamento",
    "modality": "Modalidade EXATA (Pregão Eletrônico, Concorrência Eletrônica, Dispensa, RDC, etc.)",
    "portal": "Nome do Portal (Compras.gov.br, PNCP, BEC, Licitanet, etc.)",
    "estimatedValue": 100000.50,
    "sessionDate": "2026-03-15T09:00:00Z",
    "risk": "Baixo"
  },
  "analysis": {
    "requiredDocuments": {
       "Habilitação Jurídica": [ { "item": "6.1.1", "description": "Nome EXATO e completo do documento conforme edital" } ],
       "Regularidade Fiscal, Social e Trabalhista": [ { "item": "6.2.1", "description": "Certidão Conjunta de Débitos Relativos a Tributos Federais e à Dívida Ativa da União" } ],
       "Qualificação Técnica": [ { "item": "6.3.1", "description": "TRANSCRIÇÃO LITERAL E COMPLETA da exigência, incluindo quantidades mínimas, especificações e parcelas de maior relevância" } ],
       "Qualificação Econômica Financeira": [ { "item": "6.4.1", "description": "Balanço patrimonial e demonstrações contábeis do último exercício social com índice de LG >= 1,0" } ],
       "Declarações e Outros": [ { "item": "6.5.1", "description": "Declaração de inexistência de fato superveniente impeditivo" } ]
    },
    "biddingItems": "Detalhamento extensivo de TODOS os itens/lotes licitados com: número do item, descrição técnica completa, unidade, quantidade e valor unitário estimado",
    "pricingConsiderations": "ANÁLISE FINANCEIRA DETALHADA: valor total, composição de preço, critério de aceitabilidade, condições de pagamento, garantia contratual, reajuste, BDI, dotação orçamentária",
    "irregularitiesFlags": [ "Pontos de atenção, riscos e possíveis irregularidades identificados no edital" ],
    "fullSummary": "PARECER TÉCNICO-JURÍDICO de mínimo 400 palavras com: análise de viabilidade, pontos jurídicos, proporcionalidade das exigências, condições contratuais, recomendações estratégicas",
    "deadlines": [ "DD/MM/AAAA HH:MM - Descrição completa do prazo (abertura, impugnação, esclarecimento, propostas, vigência, entrega, etc.)" ],
    "penalties": "Detalhamento COMPLETO das penalidades com valores/percentuais EXATOS: multas, advertências, suspensão, impedimento, inidoneidade",
    "qualificationRequirements": "TRANSCRIÇÃO COMPLETA E LITERAL de TODA a seção de Qualificação Técnica, incluindo cada atestado com quantidades, parcelas de maior relevância, profissionais exigidos, CATs, e todos os requisitos técnicos. NÃO RESUMA."
  }
}
`;

        console.log(`[AI] Calling Gemini API(${pdfParts.length} PDF parts)...`);
        // 4. Call Gemini with Multi-modal Support (with retry)
        const startTime = Date.now();
        const response = await callGeminiWithRetry(ai.models, {
            model: 'gemini-2.5-flash',
            contents: [
                {
                    role: 'user',
                    parts: [
                        ...pdfParts,
                        { text: `Analise este(s) edital(is) de licitação com MÁXIMA PROFUNDIDADE e PRECISÃO. Os documentos podem ser PDFs nativos ou PDFs de imagem (escaneados/digitalizados) — em caso de imagens, realize OCR visual cuidadoso.\n\nRETORNE EXCLUSIVAMENTE o objeto JSON especificado nas instruções do sistema. NÃO adicione texto explicativo antes ou depois do JSON.\n\nATENÇÃO ESPECIAL:\n1. Extraia TODOS os prazos com datas e horários EXATOS\n2. Extraia o valor estimado EXATO (numérico)\n3. Detalhe CADA documento de habilitação com referência do item do edital\n4. O resumo executivo deve ter no mínimo 300 palavras\n5. O parecer (fullSummary) deve ter no mínimo 400 palavras\n6. Extraia TODAS as penalidades com percentuais exatos\n7. NÃO resuma a Qualificação Técnica — transcreva literalmente` }
                    ]
                }
            ],
            config: {
                systemInstruction,
                temperature: 0.1,
                maxOutputTokens: 32768,
                responseMimeType: 'application/json'
            }
        });
        const duration = (Date.now() - startTime) / 1000;
        console.log(`[AI] Gemini responded in ${duration.toFixed(1)} s`);

        const rawText = response.text;
        if (!rawText) {
            console.error(`[AI] Empty response text from Gemini.`);
            throw new Error("A IA não retornou nenhum texto.");
        }

        console.log(`[AI] Raw response length: ${rawText.length} `);

        // ---- Robust JSON extraction and repair ----
        const finalPayload = robustJsonParse(rawText, 'AI-Edital');

        console.log(`[AI] Successfully parsed JSON. Top-level keys: ${Object.keys(finalPayload).join(', ')}`);
        if (finalPayload.process) {
            console.log(`[AI] process keys: ${Object.keys(finalPayload.process).join(', ')}`);
        }
        if (finalPayload.analysis) {
            console.log(`[AI] analysis keys: ${Object.keys(finalPayload.analysis).join(', ')}`);
        }
        res.json(finalPayload);

    } catch (error: any) {
        console.error("AI Analysis Error (FULL):", JSON.stringify({ message: error?.message, status: error?.status, code: error?.code, stack: error?.stack?.substring(0, 500) }));
        const logMsg = `[${new Date().toISOString()}] AI Error: ${error?.message || String(error)}\nStatus: ${error?.status}\nCode: ${error?.code}\nStack: ${error?.stack || 'No stack'}\n\n`;
        fs.appendFileSync(path.join(uploadDir, 'debug-analysis.log'), logMsg);

        // Return the REAL error message for debugging
        const realError = error?.message || String(error);
        res.status(500).json({ error: `Erro na IA: ${realError}` });
    }
});

// AI Chat Endpoint
app.post('/api/analyze-edital/chat', authenticateToken, async (req: any, res) => {
    try {
        const traceLog = (msg: string) => {
            const timestamp = new Date().toISOString();
            fs.appendFileSync(path.join(uploadDir, 'chat-trace.log'), `[${timestamp}] ${msg}\n`);
            console.log(msg);
        };

        let { fileNames, biddingProcessId, messages } = req.body;
        traceLog(`Chat Request Received. processId: ${biddingProcessId}, messages: ${messages?.length}`);

        // Fetch analysis data for fallback context AND source file names
        let analysisContext = "";
        let sourceFileNamesFromAnalysis: string[] = [];
        if (biddingProcessId) {
            const analysis = await prisma.aiAnalysis.findUnique({
                where: { biddingProcessId }
            });
            if (analysis) {
                analysisContext = `
CONTEÚDO DO RELATÓRIO ANALÍTICO EXISTENTE:
Resumo Executivo: ${analysis.fullSummary || 'N/A'}
Itens Licitados: ${analysis.biddingItems || 'N/A'}
Requisitos de Qualificação Técnica: ${analysis.qualificationRequirements || 'N/A'}
Considerações de Preço: ${analysis.pricingConsiderations || 'N/A'}
Penalidades: ${analysis.penalties || 'N/A'}
Documentos Exigidos: ${analysis.requiredDocuments || '[]'}
Prazos: ${analysis.deadlines || '[]'}
Riscos e Irregularidades: ${analysis.irregularitiesFlags || '[]'}
`;
                traceLog("Analysis context loaded for fallback.");

                // Retrieve the original PDF file names used during analysis
                if (analysis.sourceFileNames) {
                    try {
                        sourceFileNamesFromAnalysis = JSON.parse(analysis.sourceFileNames);
                        traceLog(`Source file names from analysis: ${JSON.stringify(sourceFileNamesFromAnalysis)}`);
                    } catch (e) {
                        traceLog(`Failed to parse sourceFileNames: ${analysis.sourceFileNames}`);
                    }
                }
            }
        }

        // If processId is provided, lookup fileNames in DB (more robust)
        if (biddingProcessId) {
            const process = await prisma.biddingProcess.findUnique({
                where: { id: biddingProcessId, tenantId: req.user.tenantId }
            });
            traceLog(`Process lookup: ${process ? 'FOUND' : 'NOT FOUND'} for tenant ${req.user.tenantId}`);
            if (process && process.link) {
                traceLog(`Process links found: ${process.link}`);
                const urls = process.link.split(',').map(u => u.trim());
                const dbFileNames = urls.map(url => {
                    // Only process URLs that look like local uploads
                    if (!url.includes('/uploads/') && !url.includes(req.user.tenantId)) {
                        traceLog(`Skipping external/non-pdf link: ${url}`);
                        return null;
                    }
                    try {
                        const urlObj = new URL(url);
                        const pathname = urlObj.pathname;
                        return path.basename(pathname).split('?')[0];
                    } catch (e) {
                        // Fallback for malformed URLs or non-URL strings
                        return url.split('/').pop()?.split('?')[0] || '';
                    }
                }).filter(Boolean);
                traceLog(`Derived valid dbFileNames: ${JSON.stringify(dbFileNames)}`);
                // Merge or override
                fileNames = [...new Set([...(fileNames || []), ...dbFileNames])];
            }
        }

        // Merge sourceFileNames from analysis (most reliable source of uploaded PDFs)
        if (sourceFileNamesFromAnalysis.length > 0) {
            fileNames = [...new Set([...(fileNames || []), ...sourceFileNamesFromAnalysis])];
            traceLog(`Merged sourceFileNames from analysis. Final fileNames: ${JSON.stringify(fileNames)}`);
        }

        if ((!fileNames || !Array.isArray(fileNames) || fileNames.length === 0) && !analysisContext) {
            traceLog(`ERROR: No fileNames found and no analysis context.`);
            return res.status(400).json({ error: 'Nenhum contexto de documento (fileNames ou biddingProcessId) foi fornecido.' });
        }
        if (!messages || !Array.isArray(messages)) {
            return res.status(400).json({ error: 'messages array is required' });
        }

        const pdfParts: any[] = [];
        traceLog(`Final fileNames for Gemini: ${JSON.stringify(fileNames)}`);

        // 1. Prepare files for Gemini (and verify tenant ownership)
        const biddingLinks = biddingProcessId ? (await prisma.biddingProcess.findUnique({ where: { id: biddingProcessId } }))?.link || "" : "";

        for (let fileName of fileNames) {
            traceLog(`Processing segment: "${fileName}"`);
            // Decode in case it's stored/sent with URI encoding
            fileName = decodeURIComponent(fileName).split('?')[0];
            traceLog(`Decoded name: "${fileName}"`);

            // Security check candidates:
            // 1. Is it registered in Document table for this tenant?
            const doc = await prisma.document.findFirst({
                where: {
                    fileUrl: { contains: fileName },
                    tenantId: req.user.tenantId
                }
            });

            // 2. Does it have the tenantId prefix (standard or PNCP cache)?
            const hasPrefix = fileName.startsWith(`${req.user.tenantId}_`) || fileName.startsWith(`pncp_${req.user.tenantId}_`);

            // 3. Is it explicitly linked in the bidding process we already authorized?
            const isExplicitlyLinked = biddingLinks.includes(fileName);

            const belongsToTenant = !!doc || hasPrefix || isExplicitlyLinked;
            traceLog(`Security Check: doc=${!!doc}, prefix=${hasPrefix}, linked=${isExplicitlyLinked} -> Result: ${belongsToTenant}`);

            if (!belongsToTenant) {
                traceLog(`REJECTED: Unauthorized or unmapped`);
                continue;
            }

            const fileToFetch = doc ? doc.fileUrl : fileName;
            const pdfBuffer = await getFileBufferSafe(fileToFetch, req.user.tenantId);

            if (pdfBuffer) {
                traceLog(`LOADED: ${fileName} (${pdfBuffer.length} bytes)`);
                pdfParts.push({
                    inlineData: {
                        data: pdfBuffer.toString('base64'),
                        mimeType: 'application/pdf'
                    }
                });
            } else {
                traceLog(`ERROR: Could not find file anywhere: ${fileName}`);
            }
        }

        if (pdfParts.length === 0 && !analysisContext) {
            traceLog(`CRITICAL: No PDF parts and no analysis context found.`);
            return res.status(400).json({ error: 'Nenhum contexto de documento ou análise encontrado para este chat.' });
        }

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: 'GEMINI_API_KEY is not configured in the backend' });
        }
        const ai = new GoogleGenAI({ apiKey });

        const systemInstruction = `
Você é um CONSULTOR JURÍDICO SÊNIOR ESPECIALIZADO em licitações públicas brasileiras, com profundo conhecimento da Lei 14.133/2021 (Nova Lei de Licitações), Lei 8.666/93, e legislação complementar.

O usuário está analisando um edital de licitação e precisa de respostas DETALHADAS, PRECISAS e ESTRATÉGICAS para vencer a licitação.

CONDIÇÕES DE CONTEXTO:
${pdfParts.length > 0 ? "- Documentos PDF originais do edital estão disponíveis para consulta direta." : "- Documentos PDF originais AUSENTES. Use exclusivamente os dados do relatório analítico abaixo como fonte."}

${analysisContext}

REGRAS IMPERATIVAS DE QUALIDADE:

1. **CITE SEMPRE A FONTE**: Para TODA afirmação, cite o número exato do item/subitem do edital (Ex: "Conforme item 9.1.2.1 do Edital", "De acordo com o subitem 14.3 alínea 'b'"). Se citar uma cláusula do Termo de Referência, especifique (Ex: "Seção 5.2 do Termo de Referência").

2. **SEJA EXAUSTIVO**: Não resuma demais. Se perguntarem sobre documentos de habilitação, liste CADA UM individualmente com seu item de referência. Não agrupe em categorias genéricas sem detalhar.

3. **FORMATO ESTRUTURADO**: Use formatação estruturada nas respostas:
   - Use **negrito** para termos-chave e referências importantes
   - Use listas numeradas para documentos ou requisitos
   - Use marcadores (•) para sub-itens
   - Separe seções com cabeçalhos quando a resposta for longa
   - Use "⚠️" para alertas e pontos de atenção críticos
   - Use "📋" para listas de documentos
   - Use "📅" para prazos e datas

4. **ANÁLISE ESTRATÉGICA**: Além de responder o que foi perguntado, adicione:
   - Riscos ocultos ou cláusulas restritivas que possam prejudicar o licitante
   - Dicas práticas para cumprimento dos requisitos
   - Alertas sobre prazos críticos relacionados à pergunta
   - Sugestões de documentos que podem ser substituídos ou complementados

5. **PRECISÃO JURÍDICA**: Use terminologia jurídica correta. Cite artigos de lei quando relevante (Ex: "conforme Art. 63 da Lei 14.133/2021").

6. **RESPONDA EM PORTUGUÊS DO BRASIL**: De forma profissional, clara e completa.

7. **NÃO INVENTE**: Se uma informação não consta no edital ou no relatório, diga explicitamente: "Esta informação não foi localizada no edital analisado."

8. **VALORES E QUANTIDADES**: Sempre inclua valores monetários exatos, quantidades e métricas quando disponíveis no edital.

OBJETIVO: Suas respostas devem ter a qualidade de um parecer jurídico profissional que custe R$ 5.000, não um resumo genérico de chatbot.
`;

        // Using standard format {role, parts:[{text}]} mandated by the new genai SDK
        const formattedHistory = messages.map(msg => ({
            role: msg.role === 'user' ? 'user' : 'model',
            parts: [{ text: msg.text }]
        }));

        // Prepend the PDF parts to the first user message or as a context message
        // Better: In Gemini 2.0+, we can just include them in the contents.
        const historyWithContext = [...formattedHistory];
        if (historyWithContext.length > 0 && historyWithContext[0].role === 'user') {
            // Add PDF context to the very first user message to establish base knowledge
            historyWithContext[0].parts = [...pdfParts, ...historyWithContext[0].parts];
        } else {
            // Fallback: add as a separate user message if history is empty (shouldn't happen)
            historyWithContext.unshift({
                role: 'user',
                parts: [...pdfParts, { text: "Estes são os documentos para nossa conversa." }]
            });
        }

        const chatResult = await callGeminiWithRetry(ai.models, {
            model: 'gemini-2.5-flash',
            contents: historyWithContext,
            config: {
                systemInstruction,
                temperature: 0.35,
                maxOutputTokens: 32768
            }
        });

        res.json({ text: chatResult.text });
    } catch (error: any) {
        console.error("AI Chat Error:", error?.message || error);
        res.status(500).json({ error: 'Failed to answer via AI chat' });
    }
});

// ── Serve Frontend in Production ──
if (process.env.NODE_ENV === 'production') {
    const publicDir = path.join(SERVER_ROOT, 'public');
    app.use(express.static(publicDir));
    // SPA fallback: send index.html for any non-API route
    app.use((req, res) => {
        if (!req.path.startsWith('/api') && !req.path.startsWith('/uploads')) {
            const publicDir = path.join(SERVER_ROOT, 'public');
            res.sendFile(path.join(publicDir, 'index.html'));
        } else if (req.path.startsWith('/uploads')) {
            res.status(404).json({
                error: 'Arquivo não encontrado',
                message: 'O documento solicitado não existe fisicamente no servidor. Como o sistema está no Railway sem volumes persistentes, arquivos são apagados a cada nova atualização/redeploy.',
                path: req.path
            });
        } else {
            res.status(404).json({ error: 'Rota não encontrada', path: req.path });
        }
    });
}

// Start server
// Função de Auto-Setup para o primeiro acesso e Recuperação de Dados
async function runAutoSetup() {
    try {
        console.log('🔍 Verificando integridade dos dados e tenants...');

        // 1. Garantir que o Tenant Padrão existe (usando rootCnpj como chave estável)
        let tenant = await prisma.tenant.findUnique({
            where: { rootCnpj: '00000000' }
        });

        if (!tenant) {
            console.log('🏗️ Criando Tenant Principal...');
            tenant = await prisma.tenant.create({
                data: {
                    razaoSocial: 'LicitaSaaS Brasil',
                    rootCnpj: '00000000'
                }
            });
        }

        // 2. Garantir que o Usuário Admin existe
        const adminEmail = 'admin@licitasaas.com';
        const admin = await prisma.user.findUnique({
            where: { email: adminEmail }
        });

        if (!admin) {
            console.log('🏗️ Criando Usuário Administrador...');
            const salt = await bcrypt.genSalt(10);
            const passwordHash = await bcrypt.hash('admin123', salt);
            await prisma.user.create({
                data: {
                    email: adminEmail,
                    name: 'Administrador',
                    passwordHash,
                    role: 'ADMIN',
                    tenantId: tenant.id
                }
            });
        } else if (admin.tenantId !== tenant.id) {
            console.log('🏗️ Atualizando Tenant do Administrador para o ID estável...');
            await prisma.user.update({
                where: { email: adminEmail },
                data: { tenantId: tenant.id }
            });
        }

        // 🛠️ MÓDULO DE RESTAURAÇÃO (CORREÇÃO DE DADOS MIGRADOS INDEVIDAMENTE)
        // Como o antigo script roubou os dados para o tenant padrão, precisamos devolvê-los
        // para o seu usuário (Marcos ou conta primária criada no painel).
        const realUser = await prisma.user.findFirst({
            where: { email: { not: 'admin@licitasaas.com' } }
        });

        const targetTenantId = realUser ? realUser.tenantId : tenant.id;

        const results = {
            companies: await prisma.companyProfile.updateMany({
                where: { tenantId: tenant.id },
                data: { tenantId: targetTenantId }
            }),
            biddings: await prisma.biddingProcess.updateMany({
                where: { tenantId: tenant.id },
                data: { tenantId: targetTenantId }
            }),
            documents: await prisma.document.updateMany({
                where: { tenantId: tenant.id },
                data: { tenantId: targetTenantId }
            })
        };

        if (results.companies.count > 0 || results.biddings.count > 0 || results.documents.count > 0) {
            console.log(`✅ RESTAURAÇÃO: ${results.companies.count} empresas, ${results.biddings.count} licitações devolvidas ao seu painel principal!`);
        }

        console.log('🚀 Sistema pronto e sincronizado.');
    } catch (error) {
        console.error('❌ Erro no runAutoSetup:', error);
    }
}

app.listen(PORT, async () => {
    console.log(`Server is running on port ${PORT} (mode: ${process.env.NODE_ENV || 'development'})`);
    console.log(`Upload directory: ${uploadDir}`);
    await runAutoSetup();
});

// Keep event loop alive (required in this environment)
setInterval(() => { }, 1 << 30);
