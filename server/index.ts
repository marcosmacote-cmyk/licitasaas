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
    try {
        const { email, password } = req.body;
        const user = await prisma.user.findUnique({
            where: { email },
            include: { tenant: true }
        });

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
    genAI = new GoogleGenAI({ apiKey });
}

// Serve uploaded files statically
app.use('/uploads', express.static(uploadDir));

// Configure Multer storage to use Memory (for cloud readiness)
const upload = multer({ storage: multer.memoryStorage() });

// Basic health check
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'LicitaSaaS API is running' });
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
        const companies = await prisma.companyProfile.findMany({
            where: { tenantId: req.user.tenantId },
            include: { documents: true, credentials: true }
        });
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
            fileData = { fileUrl, fileName: req.file.originalname };
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
        const { defaultAlertDays } = req.body;
        const configStr = JSON.stringify({ defaultAlertDays });

        const config = await prisma.globalConfig.upsert({
            where: { tenantId: req.user.tenantId },
            create: { tenantId: req.user.tenantId, config: configStr },
            update: { config: configStr }
        });

        res.json({ success: true, config: JSON.parse(config.config) });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update config' });
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
        const techQual = company.technicalQualification || '';

        let issuerBlock = '';
        if (isTechnical && techQual) {
            issuerBlock = `EMITENTE: O PROFISSIONAL TÉCNICO abaixo qualificado, prestando declaração com anuência e responsabilidade técnica.

DADOS DO PROFISSIONAL TÉCNICO (usar no corpo como declarante):
${techQual}

DADOS DA EMPRESA VINCULADA:
${company.razaoSocial} | CNPJ: ${company.cnpj}
${company.qualification || ''}

INSTRUÇÃO ESPECIAL: O texto deve ser escrito na PRIMEIRA PESSOA do profissional técnico. Exemplo: "[Nome], [qualificação CREA/CAU], responsável técnico junto à empresa [Razão Social], DECLARA..."`;
        } else {
            issuerBlock = `EMITENTE: A EMPRESA, por seu representante legal.

DADOS DA EMPRESA:
${company.razaoSocial} | CNPJ: ${company.cnpj}
${company.qualification || ''}`;
        }

        const prompt = `Você é um advogado especialista em licitações. Redija o corpo de uma declaração formal.

TIPO: "${declarationType}"

${issuerBlock}

LICITAÇÃO:
Objeto: ${bidding.title}
Órgão: ${bidding.portal || ''}
Modalidade: ${bidding.modality || ''}

EDITAL (resumo):
${(bidding.aiAnalysis?.fullSummary || bidding.summary || '').substring(0, 2000)}

${customPrompt ? `INSTRUÇÃO DO USUÁRIO: ${customPrompt}` : ''}

FORMATO OBRIGATÓRIO:

1) UM ÚNICO parágrafo de identificação ${isTechnical ? 'do profissional técnico com sua qualificação completa (CREA/CAU, CPF, etc.) e vínculo com a empresa' : 'da empresa com qualificação COMPLETA do representante legal'}, terminando com ", DECLARAR, para os devidos fins e sob as penas da lei, que:"

2) Lista numerada (1., 2., 3., etc.) com os itens declarados — concisos e diretos.

3) Encerre com: "Por ser expressão da verdade, firma-se a presente declaração para que produza seus efeitos legais."

REGRAS:
- NÃO inclua título, cabeçalho, destinatário, local/data ou assinatura.
- Use de 2 a 5 itens numerados.
- Texto limpo, sem markdown, sem negrito (**).`;

        if (!genAI) {
            return res.status(500).json({ error: 'GEMINI_API_KEY não configurada no servidor.' });
        }

        const result = await callGeminiWithRetry(genAI.models, {
            model: 'gemini-2.5-flash',
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            config: { temperature: 0.4, maxOutputTokens: 3072 }
        });

        let text = (result.text || '').trim();

        // Post-processing: clean up AI artifacts
        const lines = text.split('\n');
        const cleaned: string[] = [];
        let started = false;
        for (const line of lines) {
            const t = line.trim();
            if (!started && !t) continue;
            if (t.startsWith('#')) continue;
            // Skip title-like lines at the beginning
            if (!started && /^DECLARA[ÇC][ÃA]O/i.test(t) && t.length < 120) continue;
            if (!started && t === t.toUpperCase() && !t.includes('.') && t.length > 3 && t.length < 100) continue;
            started = true;
            cleaned.push(t.replace(/\*\*/g, ''));
        }
        text = cleaned.join('\n').trim();

        console.log(`[Declaration] Generated ${text.length} chars for "${declarationType}"`);
        res.json({ text });
    } catch (error: any) {
        console.error("Declaration generation error:", error);
        res.status(500).json({ error: 'Failed to generate declaration', details: error?.message || 'Erro desconhecido' });
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
        if (Array.isArray(payload.deadlines)) {
            payload.deadlines = JSON.stringify(payload.deadlines);
        }
        if (Array.isArray(payload.chatHistory)) {
            payload.chatHistory = JSON.stringify(payload.chatHistory);
        }

        const analysis = await prisma.aiAnalysis.upsert({
            where: {
                biddingProcessId: payload.biddingProcessId
            },
            create: payload,
            update: payload
        });
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
            where: { tenantId: req.user.tenantId }
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
const GEMINI_MODELS = ['gemini-2.5-flash', 'gemini-flash-latest'];

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
                console.error(`[Gemini] Non-retryable error on '${modelName}': ${error?.message}`);
                break;
            }
        }
        console.warn(`[Gemini] All retries exhausted for model '${modelName}', trying next model...`);
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
        for (let fileName of fileNames) {
            // Decode in case it's stored/sent with URI encoding
            fileName = decodeURIComponent(fileName).split('?')[0];

            // Security: Verify if file belongs to tenant
            const doc = await prisma.document.findFirst({
                where: {
                    fileUrl: { contains: fileName },
                    tenantId: req.user.tenantId
                }
            });

            const belongsToTenant = doc || fileName.startsWith(`${req.user.tenantId}_`);

            if (!belongsToTenant) {
                console.warn(`[AI] Unauthorized access attempt to file: ${fileName} by tenant: ${req.user.tenantId}`);
                continue;
            }

            const filePath = path.join(uploadDir, fileName);
            if (!fs.existsSync(filePath)) {
                console.error(`[AI] File not found on disk: ${filePath}`);
                continue;
            }

            const pdfBuffer = fs.readFileSync(filePath);
            console.log(`[AI] Read file ${fileName} (${pdfBuffer.length} bytes)`);

            // Add as native PDF part for Gemini
            pdfParts.push({
                inlineData: {
                    data: pdfBuffer.toString('base64'),
                    mimeType: 'application/pdf'
                }
            });
        }

        if (pdfParts.length === 0) {
            console.warn(`[AI] No valid files found for analysis.`);
            return res.status(400).json({ error: 'Nenhum arquivo válido encontrado para análise.' });
        }

        // 2. Setup Gemini AI
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            console.error(`[AI] GEMINI_API_KEY is missing!`);
            return res.status(500).json({ error: 'GEMINI_API_KEY is not configured in the backend' });
        }
        const ai = new GoogleGenAI({ apiKey });

        // 3. System Prompt & Strict JSON Schema Definition (Enhanced)
        const systemInstruction = `
Você é um consultor jurídico sênior especializado em licitações públicas brasileiras (Lei 14.133/2021).
SUA MISSÃO É extrair INDIVIDUALmente cada documento exigido.
NÃO AGRUPE documentos em uma única string. Se o edital pede "Certidão Federal, Estadual e Municipal", você deve criar TRÊS entradas separadas no JSON.

REGRAS CRÍTICAS:
1. Responda APENAS com um objeto JSON válido. Não adicione crases Markdown ou textos antes/depois.
2. Não invente dados. Se não encontrar, retorne string vazia.
3. O campo 'risk' deve ser obrigatoriamente: "Baixo", "Médio", "Alto" ou "Crítico".
4. Nos documentos exigidos ('requiredDocuments'), COLOQUE A REFERÊNCIA EXATA do item do edital (Ex: "9.1.5") no campo 'item', e o nome do documento no campo 'description' (Ex: "Certidão Negativa Estadual").
5. CRIE UMA ENTRADA PARA CADA DOCUMENTO. Se um item do edital (ex: 9.1) listar 5 documentos, retorne 5 objetos no array da categoria correspondente.
6. Detalhe os itens licitados no campo 'biddingItems', extraindo as quantias e descrições técnicas do Termo de Referência.
7. FUGA ASPAS DUPLAS INTERNAS: NUNCA use aspas duplas dentro dos valores de texto do seu JSON.

EXTRAIA OS DADOS SEGUINDO ESTE FORMATO EXATO DE SAÍDA JSON:
{
  "process": {
    "title": "Extraia o número e órgão emissor (Ex: Pregão Eletrônico 01/2026 - Ministério da Saúde)",
    "summary": "Resuma detalhadamente o que está sendo comprado com base no TR",
    "modality": "Pregão Eletrônico, Concorrência, Dispensa, etc",
    "portal": "Nome do Portal compras gov br, PNCP, etc",
    "estimatedValue": 100000.50,
    "sessionDate": "2026-03-15T09:00:00Z",
    "risk": "Baixo"
  },
  "analysis": {
    "requiredDocuments": {
       "Habilitação Jurídica": [ { "item": "9.1.1", "description": "Certidão A" }, { "item": "9.1.1", "description": "Certidão B" } ],
       "Regularidade Fiscal, Social e Trabalhista": [ { "item": "9.2.1", "description": "Documento X" } ],
       "Qualificação Técnica": [ { "item": "9.3.1", "description": "Atestado Y" } ],
       "Qualificação Econômica Financeira": [ { "item": "9.4.1", "description": "Balanço Z" } ],
       "Outros": [ { "item": "9.5.1", "description": "Declaração W" } ]
    },
    "biddingItems": "Detalhe extensivo de todos os itens sendo licitados...",
    "pricingConsiderations": "Resumo em uma string sobre formação de preços...",
    "irregularitiesFlags": [ "Array de strings..." ],
    "fullSummary": "Parecer opinativo profissional...",
    "deadlines": [ "Ex: 10/10/2026 - Prazo final para impugnação" ],
    "penalties": "Resumo das penalidades...",
    "qualificationRequirements": "Resumo da Qualificação Técnica..."
  }
}
`;

        console.log(`[AI] Calling Gemini API(${pdfParts.length} PDF parts)...`);
        // 4. Call Gemini with Multi-modal Support (with retry)
        const startTime = Date.now();
        const response = await callGeminiWithRetry(ai.models, {
            model: 'gemini-2.0-flash',
            contents: [
                {
                    role: 'user',
                    parts: [
                        { text: "Analise os documentos em anexo (PDFs) e retorne exclusivamente o JSON seguindo as instruções do sistema." },
                        ...pdfParts
                    ]
                }
            ],
            config: {
                systemInstruction,
                responseMimeType: "application/json",
                temperature: 0.1,
                topP: 0.8,
                topK: 40,
                maxOutputTokens: 65536,
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

        // Clean potentially prefixed markdown (though responseMimeType usually prevents this)
        let cleanedJson = rawText.replace(/```json/g, '').replace(/```/g, '').trim();

        const firstBrace = cleanedJson.indexOf('{');
        const lastBrace = cleanedJson.lastIndexOf('}');

        if (firstBrace !== -1 && lastBrace !== -1) {
            cleanedJson = cleanedJson.substring(firstBrace, lastBrace + 1);
        }

        try {
            const finalPayload = JSON.parse(cleanedJson);
            console.log(`[AI] Successfully parsed JSON. Sending response.`);
            res.json(finalPayload);
        } catch (parseError: any) {
            // Dump the raw string to file for debugging
            fs.writeFileSync(path.join(uploadDir, 'failed-json-dump.txt'), cleanedJson);
            console.error("[AI] JSON PARSE ERROR. Dumped raw output to failed-json-dump.txt");
            throw parseError; // Re-throw to be caught by outer catch
        }

    } catch (error: any) {
        console.error("AI Analysis Error:", error?.message || error);
        const logMsg = `[${new Date().toISOString()}] AI Error: ${error?.message || String(error)}\nStack: ${error?.stack || 'No stack'}\n\n`;
        fs.appendFileSync(path.join(uploadDir, 'debug-analysis.log'), logMsg);

        // Return more descriptive error to frontend
        let userMessage = 'Falha ao analisar o PDF com IA.';
        if (error?.message?.includes('503') || error?.message?.includes('high demand')) {
            userMessage = 'O serviço de IA está temporariamente sobrecarregado. Tente novamente em alguns segundos.';
        } else if (error?.message?.includes('429')) {
            userMessage = 'Limite de requisições da IA atingido. Aguarde um momento e tente novamente.';
        } else if (error?.message?.includes('API key')) {
            userMessage = 'Chave da API do Gemini inválida ou ausente. Verifique a configuração.';
        }
        res.status(500).json({ error: userMessage });
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

            // 2. Does it start with tenantId prefix?
            const hasPrefix = fileName.startsWith(`${req.user.tenantId}_`);

            // 3. Is it explicitly linked in the bidding process we already authorized?
            const isExplicitlyLinked = biddingLinks.includes(fileName);

            const belongsToTenant = !!doc || hasPrefix || isExplicitlyLinked;
            traceLog(`Security Check: doc=${!!doc}, prefix=${hasPrefix}, linked=${isExplicitlyLinked} -> Result: ${belongsToTenant}`);

            if (!belongsToTenant) {
                traceLog(`REJECTED: Unauthorized or unmapped`);
                continue;
            }

            const filePath = path.join(uploadDir, fileName);
            const exists = fs.existsSync(filePath);
            traceLog(`Checking disk at: "${filePath}" - EXISTS: ${exists}`);

            if (!exists) {
                traceLog(`ERROR: Not found on disk.`);
                continue;
            }

            const pdfBuffer = fs.readFileSync(filePath);
            traceLog(`LOADED: ${fileName} (${pdfBuffer.length} bytes)`);

            pdfParts.push({
                inlineData: {
                    data: pdfBuffer.toString('base64'),
                    mimeType: 'application/pdf'
                }
            });
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

        const response = await callGeminiWithRetry(ai.models, {
            model: 'gemini-2.5-flash',
            contents: historyWithContext,
            config: {
                systemInstruction,
                temperature: 0.35,
                maxOutputTokens: 32768
            }
        });

        res.json({ text: response.text });
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
    app.get('*', (req, res) => {
        if (!req.path.startsWith('/api') && !req.path.startsWith('/uploads')) {
            res.sendFile(path.join(publicDir, 'index.html'));
        }
    });
}

// Start server
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
});

// Keep event loop alive (required in this environment)
setInterval(() => { }, 1 << 30);
