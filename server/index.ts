import { robustJsonParse } from "./services/ai/parser.service";
import { callGeminiWithRetry } from "./services/ai/gemini.service";
import { ANALYZE_EDITAL_SYSTEM_PROMPT, USER_ANALYSIS_INSTRUCTION, EXTRACT_CERTIFICATE_SYSTEM_PROMPT, COMPARE_CERTIFICATE_SYSTEM_PROMPT, MASTER_PETITION_SYSTEM_PROMPT, PETITION_USER_INSTRUCTION } from "./services/ai/prompt.service";
import { fallbackToOpenAi } from "./services/ai/openai.service";
import { indexDocumentChunks, searchSimilarChunks } from "./services/ai/rag.service";
import { pncpMonitor } from "./services/monitoring/pncp-monitor.service";
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
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

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
// PUT Company Proposal Template — save default header/footer
app.put('/api/companies/:id/proposal-template', authenticateToken, async (req: any, res) => {
    try {
        const { id } = req.params;
        const { headerImage, footerImage, headerHeight, footerHeight, defaultLetterContent } = req.body;

        await prisma.companyProfile.update({
            where: { id, tenantId: req.user.tenantId },
            data: {
                defaultProposalHeader: headerImage,
                defaultProposalFooter: footerImage,
                defaultProposalHeaderHeight: headerHeight,
                defaultProposalFooterHeight: footerHeight,
                defaultLetterContent: defaultLetterContent
            }
        });

        res.json({ message: 'Template padrão salvo com sucesso!' });
    } catch (error: any) {
        res.status(500).json({ error: 'Erro ao salvar template: ' + error.message });
    }
});

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

// Technical Certificates (Oráculo de Atestados)
app.get('/api/technical-certificates', authenticateToken, async (req: any, res) => {
    try {
        const certificates = await prisma.technicalCertificate.findMany({
            where: { tenantId: req.user.tenantId },
            include: { experiences: true, company: true },
            orderBy: { createdAt: 'desc' }
        });
        res.json(certificates);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch certificates' });
    }
});

app.post('/api/technical-certificates', authenticateToken, upload.single('file'), async (req: any, res: any) => {
    try {
        const { companyProfileId, title, type, category } = req.body;
        if (!req.file) return res.status(400).json({ error: 'File is required' });

        const { url: fileUrl } = await storageService.uploadFile(req.file, req.user.tenantId);

        // AI Extraction
        const apiKey = process.env.GEMINI_API_KEY;
        const ai = new GoogleGenAI({ apiKey: apiKey! });

        console.log(`[AI Oracle] Analyzing certificate: ${req.file.originalname}`);
        const result = await callGeminiWithRetry(ai.models, {
            model: 'gemini-2.0-flash',
            contents: [
                {
                    role: 'user',
                    parts: [
                        { inlineData: { data: req.file.buffer.toString('base64'), mimeType: req.file.mimetype } },
                        { text: "Extraia os dados técnicos deste documento seguindo o formato JSON especificado." }
                    ]
                }
            ],
            config: {
                systemInstruction: EXTRACT_CERTIFICATE_SYSTEM_PROMPT,
                temperature: 0.1,
                responseMimeType: 'application/json'
            }
        });

        const extracted = robustJsonParse(result.text);

        const certificate = await prisma.technicalCertificate.create({
            data: {
                tenantId: req.user.tenantId,
                companyProfileId: companyProfileId || null,
                title: title || extracted.title || req.file.originalname,
                type: type || extracted.type || 'Atestado',
                category: category || extracted.category || null,
                fileUrl,
                fileName: req.file.originalname,
                issuer: extracted.issuer || null,
                issueDate: extracted.issueDate ? new Date(extracted.issueDate) : null,
                object: extracted.object || null,
                executingCompany: extracted.executingCompany || null,
                technicalResponsible: extracted.technicalResponsible || null,
                extractedData: extracted,
                experiences: {
                    create: (extracted.experiences || []).map((exp: any) => ({
                        description: exp.description,
                        quantity: exp.quantity ? parseFloat(String(exp.quantity).replace(',', '.')) : null,
                        unit: exp.unit,
                        category: exp.category
                    }))
                }
            },
            include: { experiences: true }
        });

        res.json(certificate);
    } catch (error: any) {
        console.error("Certificate upload error:", error);
        res.status(500).json({ error: 'Failed to process certificate', details: error.message });
    }
});

app.delete('/api/technical-certificates/:id', authenticateToken, async (req: any, res) => {
    try {
        const { id } = req.params;
        const cert = await prisma.technicalCertificate.findUnique({ where: { id } });
        if (cert && cert.tenantId === req.user.tenantId) {
            await storageService.deleteFile(cert.fileUrl);
            await prisma.technicalCertificate.delete({ where: { id } });
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'Certificate not found' });
        }
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete certificate' });
    }
});

app.post('/api/technical-certificates/compare', authenticateToken, async (req: any, res) => {
    try {
        const { biddingProcessId, technicalCertificateIds } = req.body; // Accepts array
        const tenantId = req.user.tenantId;

        const bidding = await prisma.biddingProcess.findUnique({
            where: { id: biddingProcessId, tenantId },
            include: { aiAnalysis: true }
        });

        const certificates = await prisma.technicalCertificate.findMany({
            where: { id: { in: technicalCertificateIds }, tenantId },
            include: { experiences: true }
        });

        if (!bidding || certificates.length === 0) {
            return res.status(404).json({ error: 'Processo ou atestados não encontrados.' });
        }

        const requirements = bidding.aiAnalysis?.qualificationRequirements || bidding.summary || "";

        // Aggregate all experiences from all selected certificates
        const aggregatedCertData = certificates.map(cert => ({
            atestado_titulo: cert.title,
            objeto: cert.object,
            experiencias: cert.experiences.map(e => ({
                description: e.description,
                quantity: e.quantity,
                unit: e.unit,
                category: e.category
            }))
        }));

        // AI Comparison
        const apiKey = process.env.GEMINI_API_KEY;
        const ai = new GoogleGenAI({ apiKey: apiKey! });

        console.log(`[AI Oracle] Comparing ${certificates.length} certs with bidding ${bidding.title}`);
        const result = await callGeminiWithRetry(ai.models, {
            model: 'gemini-2.0-flash',
            contents: [
                {
                    role: 'user',
                    parts: [
                        { text: `EXIGÊNCIAS DO EDITAL:\n${requirements}\n\nACERVO TÉCNICO DISPONÍVEL (JSON):\n${JSON.stringify(aggregatedCertData, null, 2)}` }
                    ]
                }
            ],
            config: {
                systemInstruction: COMPARE_CERTIFICATE_SYSTEM_PROMPT,
                temperature: 0.1,
                responseMimeType: 'application/json'
            }
        });

        const analysis = robustJsonParse(result.text);
        res.json(analysis);
    } catch (error: any) {
        console.error("Comparison error:", error);
        res.status(500).json({ error: 'Failed to analyze compatibility', details: error.message });
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
        const { razaoSocial, cnpj, isHeadquarters, qualification, technicalQualification, contactName, contactEmail, contactPhone, contactCpf, address, city, state } = req.body;
        const safeData: any = {};
        if (razaoSocial !== undefined) safeData.razaoSocial = razaoSocial;
        if (cnpj !== undefined) safeData.cnpj = cnpj;
        if (isHeadquarters !== undefined) safeData.isHeadquarters = isHeadquarters;
        if (qualification !== undefined) safeData.qualification = qualification;
        if (technicalQualification !== undefined) safeData.technicalQualification = technicalQualification;
        if (contactName !== undefined) safeData.contactName = contactName;
        if (contactEmail !== undefined) safeData.contactEmail = contactEmail;
        if (contactPhone !== undefined) safeData.contactPhone = contactPhone;
        if (contactCpf !== undefined) safeData.contactCpf = contactCpf;
        if (address !== undefined) safeData.address = address;
        if (city !== undefined) safeData.city = city;
        if (state !== undefined) safeData.state = state;

        const updatedCompany = await prisma.companyProfile.update({
            where: { id },
            data: safeData,
            include: { credentials: true, documents: { select: { id: true, tenantId: true, companyProfileId: true, docType: true, fileUrl: true, uploadDate: true, expirationDate: true, status: true, autoRenew: true, docGroup: true, issuerLink: true, fileName: true, alertDays: true } } }
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
3. TÍTULO: Gere um título técnico e resumido. NUNCA inclua citações de artigos de lei, incisos ou parágrafos no TÍTULO (Ex: NÃO use "Art. 63" ou "Lei 14.133" no título). O título deve ser puramente descriptivo (Ex: "DECLARAÇÃO DE INDEFERIMENTO" ou "DECLARAÇÃO DE TRABALHO INFANTIL").
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
        const { keywords, status, uf, pagina = 1, modalidade, dataInicio, dataFim, esfera, orgao, orgaosLista } = req.body;
        const pageSize = 10;

        let kwList: string[] = [];
        if (keywords) {
            if (keywords.includes(',')) {
                kwList = keywords.split(',')
                    .map((k: string) => k.trim().replace(/^"|"$/g, ''))
                    .filter((k: string) => k.length > 0)
                    .map((k: string) => k.includes(' ') ? `"${k}"` : k);
            } else {
                kwList = [keywords.includes(' ') && !keywords.startsWith('"') ? `"${keywords}"` : keywords];
            }
        }

        const buildBaseUrl = (qItems: string[], overrideCnpj?: string) => {
            let url = `https://pncp.gov.br/api/search/?tipos_documento=edital&ordenacao=-data&tam_pagina=${overrideCnpj ? 100 : 500}&pagina=1`;
            if (overrideCnpj) {
                url += `&cnpj=${overrideCnpj}`;
            }
            if (qItems.length > 0) {
                url += `&q=${encodeURIComponent(qItems.join(' AND '))}`;
            }
            if (status && status !== 'todas') url += `&status=${status}`;
            if (uf) url += `&ufs=${uf}`; // Allow comma-separated UFs
            if (modalidade && modalidade !== 'todas') url += `&modalidades_licitacao=${encodeURIComponent(modalidade)}`;
            if (dataInicio) url += `&data_inicio=${dataInicio}`;
            if (dataFim) url += `&data_fim=${dataFim}`;
            if (esfera && esfera !== 'todas') url += `&esferas=${esfera}`;
            return url;
        };

        let extractedNames: string[] = [];
        if (orgaosLista) {
            extractedNames = orgaosLista.split(/[\n,;]+/).map((s: string) => s.trim().replace(/^"|"$/g, '')).filter((s: string) => s.length > 0);
            extractedNames = [...new Set(extractedNames)]; // Remove duplicates
        }

        let urlsToFetch: string[] = [];
        const keywordsToIterate = kwList.length > 0 ? kwList : [null];
        const orgaosToIterate = extractedNames.length > 0 ? extractedNames : (orgao ? [orgao] : [null]);

        for (const kw of keywordsToIterate) {
            for (const org of orgaosToIterate) {
                let localParams: string[] = [];
                let overrideCnpj: string | undefined = undefined;

                if (kw) localParams.push(kw);

                if (org) {
                    const onlyNumbers = org.replace(/\D/g, '');
                    if (onlyNumbers.length === 14) {
                        overrideCnpj = onlyNumbers;
                    } else {
                        const exactOrgName = org.includes(' ') && !org.startsWith('"') ? `"${org}"` : org;
                        localParams.push(exactOrgName);
                    }
                }

                urlsToFetch.push(buildBaseUrl(localParams, overrideCnpj));
            }
        }

        // Limit max generated combinations to 1000 to avoid complete application DOS (extreme user input).
        urlsToFetch = urlsToFetch.slice(0, 1000);

        const agent = new https.Agent({ rejectUnauthorized: false });
        const startTime = Date.now();
        console.log(`[PNCP] START GET ${urlsToFetch.length} url(s) in batches...`);

        let rawItems: any[] = [];
        const chunkSize = 60;

        for (let i = 0; i < urlsToFetch.length; i += chunkSize) {
            const chunk = urlsToFetch.slice(i, i + chunkSize);
            const responses = await Promise.allSettled(
                chunk.map(u => axios.get(u, {
                    headers: { 'Accept': 'application/json' },
                    httpsAgent: agent,
                    timeout: 25000
                } as any))
            );

            responses.forEach((res) => {
                if (res.status === 'fulfilled') {
                    const data = res.value.data as any;
                    const items = Array.isArray(data?.items) ? data.items : (Array.isArray(data?.data) ? data.data : []);
                    rawItems = rawItems.concat(items);
                } else {
                    console.error('[PNCP] Request failed:', res.reason?.message);
                }
            });
        }

        // First pass: extract what we can from search results
        // Also ensure no duplicate results based on PNCP ID just in case
        const seenIds = new Set<string>();
        const items = rawItems.filter(item => item != null).map((item: any) => {
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
        }).filter(item => {
            if (seenIds.has(item.id)) return false;
            seenIds.add(item.id);
            return true;
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

// ─── AI Services Imports estão no topo do arquivo ───

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

                    let storageFileName = safeFileName;
                    try {
                        const up = await storageService.uploadFile({
                            originalname: safeFileName,
                            buffer: buffer,
                            mimetype: 'application/pdf'
                        } as any, req.user.tenantId);
                        storageFileName = up.fileName;
                    } catch (e) {
                        console.error(`[PNCP-AI] Erro upload PDF Storage:`, e);
                    }

                    pdfParts.push({
                        inlineData: { data: buffer.toString('base64'), mimeType: 'application/pdf' }
                    });
                    downloadedFiles.push(storageFileName);
                    console.log(`[PNCP-AI] ✅ PDF: ${fileName} saved as ${storageFileName} (${(buffer.length / 1024).toFixed(0)} KB)`);
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

                                let storageFileName = safeName;
                                try {
                                    const up = await storageService.uploadFile({
                                        originalname: safeName,
                                        buffer: pdfBuffer,
                                        mimetype: 'application/pdf'
                                    } as any, req.user.tenantId);
                                    storageFileName = up.fileName;
                                } catch (e) {
                                    console.error(`[PNCP-AI] Erro upload ZIP-PDF Storage:`, e);
                                }

                                pdfParts.push({
                                    inlineData: { data: pdfBuffer.toString('base64'), mimeType: 'application/pdf' }
                                });
                                downloadedFiles.push(storageFileName);
                                console.log(`[PNCP-AI] ✅ Extracted from ZIP: ${entryName} saved as ${storageFileName} (${(pdfBuffer.length / 1024).toFixed(0)} KB)`);
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

                                const safeName = `pncp_${req.user.tenantId}_${rarFile.fileHeader.name.replace(/[^a-z0-9._-]/gi, '_')}`;
                                fs.writeFileSync(path.join(uploadDir, safeName), pdfBuffer);

                                let storageFileName = safeName;
                                try {
                                    const up = await storageService.uploadFile({
                                        originalname: safeName,
                                        buffer: pdfBuffer,
                                        mimetype: 'application/pdf'
                                    } as any, req.user.tenantId);
                                    storageFileName = up.fileName;
                                } catch (e) {
                                    console.error(`[PNCP-AI] Erro upload RAR-PDF Storage:`, e);
                                }

                                pdfParts.push({
                                    inlineData: { data: pdfBuffer.toString('base64'), mimeType: 'application/pdf' }
                                });
                                downloadedFiles.push(storageFileName);
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
        const systemInstruction = ANALYZE_EDITAL_SYSTEM_PROMPT;

        console.log(`[PNCP-AI] Calling Gemini with ${pdfParts.length} PDF parts (files: ${downloadedFiles.join(', ')})...`);
        let response: any;
        const startTime = Date.now();

        try {
            response = await callGeminiWithRetry(ai.models, {
                model: 'gemini-2.5-flash',
                contents: [{
                    role: 'user',
                    parts: [
                        ...pdfParts,
                        { text: USER_ANALYSIS_INSTRUCTION }
                    ]
                }],
                config: {
                    systemInstruction,
                    temperature: 0.1,
                    maxOutputTokens: 32768,
                    responseMimeType: 'application/json'
                }
            });
        } catch (geminiError: any) {
            console.warn(`[PNCP-AI] Gemini falhou miseravelmente: ${geminiError.message}. Tentando OpenAI gpt-4o-mini Fallback...`);
            try {
                response = await fallbackToOpenAi(pdfParts, systemInstruction, USER_ANALYSIS_INSTRUCTION);
            } catch (openAiError: any) {
                console.error(`[PNCP-AI] O Fallback via OpenAI também falhou: ${openAiError.message}`);
                throw new Error(`Ambas IAs falharam. Gemini: ${geminiError.message} | OpenAI: ${openAiError.message}`);
            }
        }

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

        // Fire & Forget Indexing -> Vector Database para RAG
        if (payload.biddingProcessId && payload.sourceFileNames) {
            try {
                const parsedFileNames = JSON.parse(payload.sourceFileNames);
                if (Array.isArray(parsedFileNames) && parsedFileNames.length > 0) {
                    console.log(`[Background RAG] Disparando indexação assíncrona para ${payload.biddingProcessId}...`);
                    fetchPdfPartsForProcess(payload.biddingProcessId, parsedFileNames, req.user.tenantId)
                        .then(pdfParts => {
                            if (pdfParts && pdfParts.length > 0) {
                                return indexDocumentChunks(payload.biddingProcessId, pdfParts);
                            }
                        })
                        .catch(err => console.error(`[Background RAG] Erro interno: ${err.message}`));
                }
            } catch (e) {
                console.warn(`[Background RAG] Não foi possível mapear sourceFileNames para o processo ${payload.biddingProcessId}`);
            }
        }

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


// ═══════════════════════════════════════════════════════════════════════
// Price Proposal CRUD + AI Populate
// ═══════════════════════════════════════════════════════════════════════

// GET proposals for a bidding process
app.get('/api/proposals/:biddingId', authenticateToken, async (req: any, res) => {
    try {
        const proposals = await prisma.priceProposal.findMany({
            where: { biddingProcessId: req.params.biddingId, tenantId: req.user.tenantId },
            include: { items: { orderBy: { sortOrder: 'asc' } }, company: true },
            orderBy: { version: 'desc' },
        });
        res.json(proposals);
    } catch (error: any) {
        console.error('[Proposals] GET error:', error.message);
        res.status(500).json({ error: 'Failed to fetch proposals' });
    }
});

// GET single proposal with items
app.get('/api/proposals/detail/:id', authenticateToken, async (req: any, res) => {
    try {
        const proposal = await prisma.priceProposal.findFirst({
            where: { id: req.params.id, tenantId: req.user.tenantId },
            include: { items: { orderBy: { sortOrder: 'asc' } }, company: true, biddingProcess: true },
        });
        if (!proposal) return res.status(404).json({ error: 'Proposal not found' });
        res.json(proposal);
    } catch (error: any) {
        console.error('[Proposals] GET detail error:', error.message);
        res.status(500).json({ error: 'Failed to fetch proposal' });
    }
});

// POST create proposal
app.post('/api/proposals', authenticateToken, async (req: any, res) => {
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
        console.log(`[Proposals] Created proposal ${proposal.id} v${proposal.version} for bidding ${biddingProcessId}`);
        res.status(201).json(proposal);
    } catch (error: any) {
        console.error('[Proposals] POST error:', error.message);
        res.status(500).json({ error: 'Failed to create proposal' });
    }
});

// PUT update proposal
app.put('/api/proposals/:id', authenticateToken, async (req: any, res) => {
    try {
        const { bdiPercentage, taxPercentage, socialCharges, validityDays, notes, status, letterContent, companyLogo, headerImage, footerImage, headerImageHeight, footerImageHeight, signatureMode, signatureCity } = req.body;

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
            },
            include: { items: { orderBy: { sortOrder: 'asc' } }, company: true },
        });

        // Recalculate total
        const totalValue = updated.items.reduce((sum: number, item: any) => sum + (item.totalPrice || 0), 0);
        await prisma.priceProposal.update({ where: { id: req.params.id }, data: { totalValue } });
        updated.totalValue = totalValue;

        res.json(updated);
    } catch (error: any) {
        console.error('[Proposals] PUT error:', error.message);
        res.status(500).json({ error: 'Failed to update proposal' });
    }
});

// DELETE proposal
app.delete('/api/proposals/:id', authenticateToken, async (req: any, res) => {
    try {
        const existing = await prisma.priceProposal.findFirst({
            where: { id: req.params.id, tenantId: req.user.tenantId },
        });
        if (!existing) return res.status(404).json({ error: 'Proposal not found' });

        await prisma.priceProposal.delete({ where: { id: req.params.id } });
        res.json({ success: true });
    } catch (error: any) {
        console.error('[Proposals] DELETE error:', error.message);
        res.status(500).json({ error: 'Failed to delete proposal' });
    }
});

// POST add/replace items in bulk (used by AI populate and manual add)
app.post('/api/proposals/:id/items', authenticateToken, async (req: any, res) => {
    try {
        const { items, replaceAll } = req.body;
        const proposalId = req.params.id;

        const existing = await prisma.priceProposal.findFirst({
            where: { id: proposalId, tenantId: req.user.tenantId },
        });
        if (!existing) return res.status(404).json({ error: 'Proposal not found' });

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
            const applicableDiscount = itemDisc > 0 ? itemDisc : linearDisc;

            // Unit Price including BDI and then applying either Linear or Item Discount
            // Formula: Price = Cost * (1 + BDI/100) * (1 - applicableDiscount/100)
            const unitPrice = item.unitCost * (1 + bdi / 100) * (1 - applicableDiscount / 100);

            // App-level default is 1 if not provided
            const multiplier = item.multiplier ?? 1;
            const totalPrice = item.quantity * multiplier * unitPrice;

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
                    unitPrice: Math.round(unitPrice * 100) / 100,
                    totalPrice: Math.round(totalPrice * 100) / 100,
                    referencePrice: item.referencePrice || null,
                    discountPercentage: itemDisc,
                    brand: item.brand || null,
                    model: item.model || null,
                    sortOrder: item.sortOrder ?? i,
                },
            });
            created.push(dbItem);
        }

        // Recalculate total
        const allItems = await prisma.proposalItem.findMany({ where: { proposalId } });
        const totalValue = allItems.reduce((sum: number, it: any) => sum + (it.totalPrice || 0), 0);
        await prisma.priceProposal.update({ where: { id: proposalId }, data: { totalValue } });

        console.log(`[Proposals] Added ${created.length} items to proposal ${proposalId}, total: R$ ${totalValue.toFixed(2)}`);
        res.json({ items: created, totalValue });
    } catch (error: any) {
        console.error('[Proposals] POST items error:', error.message);
        res.status(500).json({ error: 'Failed to add items' });
    }
});

// PUT update single item
app.put('/api/proposals/:id/items/:itemId', authenticateToken, async (req: any, res) => {
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
        const applicableDiscount = itemDisc > 0 ? itemDisc : linearDisc;

        const finalUnitCost = unitCost !== undefined ? unitCost : 0;
        const finalQuantity = quantity !== undefined ? quantity : 0;
        const finalMultiplier = multiplier !== undefined ? multiplier : 1;

        const unitPrice = finalUnitCost * (1 + bdi / 100) * (1 - applicableDiscount / 100);
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
        console.error('[Proposals] PUT item error:', error.message);
        res.status(500).json({ error: 'Failed to update item' });
    }
});

// DELETE single item
app.delete('/api/proposals/:id/items/:itemId', authenticateToken, async (req: any, res) => {
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
        console.error('[Proposals] DELETE item error:', error.message);
        res.status(500).json({ error: 'Failed to delete item' });
    }
});

// POST AI Populate — extract items from AI analysis
app.post('/api/proposals/ai-populate', authenticateToken, async (req: any, res) => {
    try {
        const { biddingProcessId } = req.body;

        // Get bidding with AI analysis
        const bidding = await prisma.biddingProcess.findFirst({
            where: { id: biddingProcessId, tenantId: req.user.tenantId },
            include: { aiAnalysis: true },
        });

        if (!bidding) return res.status(404).json({ error: 'Bidding process not found' });
        if (!bidding.aiAnalysis) return res.status(400).json({ error: 'No AI analysis found for this bidding. Run the AI analysis first.' });

        const biddingItems = bidding.aiAnalysis.biddingItems || '';
        const pricingInfo = bidding.aiAnalysis.pricingConsiderations || '';

        if (!biddingItems || biddingItems.trim().length < 10) {
            return res.status(400).json({ error: 'AI analysis has no bidding items to extract.' });
        }

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });

        const ai = new GoogleGenAI({ apiKey });

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

Responda APENAS com um JSON array, sem markdown:
[{"itemNumber":"1","description":"Descrição completa","unit":"Mês","quantity":3,"multiplier":12,"multiplierLabel":"Meses","referencePrice":22465.00}]`;

        console.log(`[AI Populate] Extracting items from bidding ${biddingProcessId}...`);
        const result = await callGeminiWithRetry(ai.models, {
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: { temperature: 0.05, maxOutputTokens: 8192 },
        });

        const responseText = result.text?.trim() || '';
        console.log(`[AI Populate] Response (first 300): ${responseText.substring(0, 300)}`);

        let jsonStr = responseText;
        const jsonMatch = responseText.match(/\[[\s\S]*\]/);
        if (jsonMatch) jsonStr = jsonMatch[0];

        let items: any[];
        try {
            items = JSON.parse(jsonStr);
        } catch {
            console.error('[AI Populate] Failed to parse JSON');
            return res.status(500).json({ error: 'AI returned invalid format', raw: responseText.substring(0, 200) });
        }

        console.log(`[AI Populate] Extracted ${items.length} items from edital`);
        res.json({ items, totalItems: items.length });
    } catch (error: any) {
        console.error('[AI Populate] Error:', error.message);
        res.status(500).json({ error: 'AI populate failed: ' + (error.message || 'Unknown') });
    }
});

// POST AI Letter — generate proposal letter
app.post('/api/proposals/ai-letter', authenticateToken, async (req: any, res) => {
    try {
        const { biddingProcessId, companyProfileId, totalValue, validityDays, itemsSummary } = req.body;

        const bidding = await prisma.biddingProcess.findFirst({
            where: { id: biddingProcessId, tenantId: req.user.tenantId },
            include: { aiAnalysis: true }
        });
        const company = await prisma.companyProfile.findFirst({
            where: { id: companyProfileId, tenantId: req.user.tenantId },
        });

        if (!bidding || !company) return res.status(404).json({ error: 'Bidding or company not found' });

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });

        const ai = new GoogleGenAI({ apiKey });

        const prompt = `Gere uma CARTA PROPOSTA formal para licitação pública brasileira baseada estritamente na Lei 14.133/2021.
Você deve adequar sua carta ao OBJETO e às EXIGÊNCIAS detalhadas abaixo.

REGRA DE OURO (IMPORTANTE):
1. PRIORIZE O MODELO DE CARTA PROPOSTA DO EDITAL (geralmente é um anexo do edital). Se o Resumo do Edital abaixo contiver um modelo ou exigências específicas de redação, siga-as fielmente.
2. Se não existir um modelo claro, aplique as condições exigidas em itens específicos do edital (Resumo abaixo).
3. Utilize SEMPRE o termo "Agente de Contratação". NUNCA utilize o termo "Comissão de Licitação" (não é mais usual na Nova Lei).

DADOS DA LICITAÇÃO E EMPRESA:
- Licitação: ${bidding.title}
- Modalidade: ${bidding.modality}
- Órgão: Conforme edital
- Empresa: ${company.razaoSocial}
- CNPJ: ${company.cnpj}
- Contato: ${company.contactName || 'Representante Legal'}
- Valor Total da Proposta: R$ ${totalValue?.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) || '0,00'}
- Validade da Proposta: ${validityDays || 60} dias
- Resumo dos Itens: ${itemsSummary || 'Conforme planilha de preços em anexo'}

RESUMO DO EDITAL (Use para extrair o modelo ou condições específicas):
${bidding.aiAnalysis?.fullSummary || 'Não disponível'}

INSTRUÇÕES TÉCNICAS:
1. Use formato formal de carta comercial.
2. Enderece ao Agente de Contratação / Pregoeiro.
3. Inclua: referência explícita ao processo, objeto claro, valor total numérico e por extenso EXATOS.
4. Declare todas as condições exigidas na Lei 14.133/2021: que nos preços estão inclusos todos os custos diretos e indiretos, tributos, taxas, fretes, encargos, etc.
5. DECLARE o prazo de validade da proposta (mínimo de ${validityDays || 60} dias).
6. Inclua espaço para inserir DADOS BANCÁRIOS (ex: Banco, Agência, Conta Corrente) a ser preenchido.
16. CRÍTICO: NÃO escreva a qualificação da empresa. Em vez disso, insira exatamente a tag [IDENTIFICACAO] na posição onde a qualificação deve entrar (geralmente após a Referência do processo e antes do corpo principal). O sistema substituirá essa tag pela qualificação completa do cadastro.
17. CRÍTICO: NÃO inclua Local, Data, "Atenciosamente" ou qualquer campo de assinatura ao final da carta. O sistema já adiciona esses elementos automaticamente na exportação do relatório.
18. CRÍTICO: O OBJETO da licitação deve ser extraído e transcrito NA ÍNTEGRA, conforme consta no documento original. NÃO o resuma, para que a proposta tenha validade jurídica.
19. CRÍTICO: NÃO utilize placeholders ou colchetes como "[INSERIR NÚMERO DO PROCESSO]". Se o dado (ex: nº do processo administrativo) estiver presente no "Resumo do Edital" abaixo, utilize-o. Se não estiver, omita o termo completamente em vez de deixar instruções entre colchetes.
20. Exemplo de estrutura: "Ao Agente de Contratação... Ref: Edital nº... [IDENTIFICACAO] vem perante V. Sª apresentar a proposta para o Objeto: [TRANSCRIÇÃO ÍNTEGRA DO OBJETO]... Valor Global: R$ [VALOR] ([EXTENSO])..."
21. Retorne APENAS o texto do corpo da carta, sem markdown.`;

        const result = await callGeminiWithRetry(ai.models, {
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: { temperature: 0.2, maxOutputTokens: 4096 },
        });

        const letterContent = result.text?.trim() || '';
        console.log(`[AI Letter] Generated letter (${letterContent.length} chars) for bidding ${biddingProcessId}`);
        res.json({ letterContent });
    } catch (error: any) {
        console.error('[AI Letter] Error:', error.message);
        res.status(500).json({ error: 'Letter generation failed: ' + (error.message || 'Unknown') });
    }
});

// ═══════════════════════════════════════════════════════════════════════
// Dossier AI Matching — Gemini-powered document-to-requirement matching
// ═══════════════════════════════════════════════════════════════════════
app.post('/api/dossier/ai-match', authenticateToken, async (req: any, res) => {
    try {
        const { requirements, documents } = req.body;

        if (!requirements || !Array.isArray(requirements) || requirements.length === 0) {
            return res.status(400).json({ error: 'requirements array is required' });
        }
        if (!documents || !Array.isArray(documents) || documents.length === 0) {
            return res.status(400).json({ error: 'documents array is required' });
        }

        console.log(`[Dossier AI Match] ${requirements.length} requirements × ${documents.length} docs for tenant ${req.user.tenantId}`);

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
        });

        const responseText = result.text?.trim() || '';
        console.log(`[Dossier AI Match] Raw response (first 500 chars): ${responseText.substring(0, 500)}`);

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
            console.error('[Dossier AI Match] Failed to parse JSON:', responseText.substring(0, 500));
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
            console.log(`[Dossier AI Match] ✅ R${reqIdx} → DOC[${docIdx}] "${documents[docIdx].docType}" | ${reason}`);
        }

        const matchCount = Object.keys(matches).length;
        const skipped = matchResults.filter((m: any) => {
            const d = m.d ?? m.docIndex;
            return d === null || d === undefined || d === 'SKIP' || d === -1;
        }).length;
        console.log(`[Dossier AI Match] Result: ${matchCount} matched, ${skipped} skipped, ${requirements.length - matchCount - skipped} unhandled`);

        res.json({ matches, matchCount, totalRequirements: requirements.length });

    } catch (error: any) {
        console.error('[Dossier AI Match] Error:', error?.message || error);
        res.status(500).json({ error: 'AI matching failed: ' + (error?.message || 'Unknown error') });
    }
});


// AI Services imports movidos para cima

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
        const systemInstruction = ANALYZE_EDITAL_SYSTEM_PROMPT;

        console.log(`[AI] Calling Gemini API(${pdfParts.length} PDF parts)...`);
        let response: any;
        const startTime = Date.now();

        try {
            response = await callGeminiWithRetry(ai.models, {
                model: 'gemini-2.5-flash',
                contents: [
                    {
                        role: 'user',
                        parts: [
                            ...pdfParts,
                            { text: USER_ANALYSIS_INSTRUCTION }
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
        } catch (geminiError: any) {
            console.warn(`[AI] Gemini falhou: ${geminiError.message}. Realizando Fallback automático para OpenAI (gpt-4o-mini)...`);
            try {
                response = await fallbackToOpenAi(pdfParts, systemInstruction, USER_ANALYSIS_INSTRUCTION);
            } catch (openAiError: any) {
                console.error(`[AI] Fallback via OpenAI também falhou: ${openAiError.message}`);
                throw new Error(`As duas IAs falharam. Gemini: ${geminiError.message} | OpenAI: ${openAiError.message}`);
            }
        }
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

// Petition Generation Endpoint
app.post('/api/petitions/generate', authenticateToken, async (req: any, res) => {
    try {
        const { biddingProcessId, companyId, templateType, userContext, attachments } = req.body;
        const tenantId = req.user.tenantId;

        console.log(`[Petition] Generating ${templateType} for process ${biddingProcessId} with ${attachments?.length || 0} attachments`);


        const bidding = await prisma.biddingProcess.findUnique({
            where: { id: biddingProcessId, tenantId },
            include: { aiAnalysis: true }
        });

        const company = await prisma.companyProfile.findUnique({
            where: { id: companyId, tenantId }
        });

        if (!bidding || !company) {
            return res.status(404).json({ error: 'Processo ou Empresa não encontrados.' });
        }

        if (!biddingProcessId || !companyId || (!userContext && (attachments?.length || 0) === 0)) {
            return res.status(400).json({ error: 'Por favor, selecione o processo, a empresa e descreva os fatos ou anexe documentos.' });
        }
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY is not configured' });

        const ai = new GoogleGenAI({ apiKey });
        const aiAnalysis = bidding.aiAnalysis;

        let biddingAnalysisText = 'Nenhuma análise detalhada disponível.';
        if (aiAnalysis) {
            biddingAnalysisText = `
Resumo do Edital (Card): ${bidding.summary || 'Não disponível'}
Parecer Técnico-Jurídico Profundo: ${aiAnalysis.fullSummary || 'Não disponível'}
Documentos Exigidos: ${typeof aiAnalysis.requiredDocuments === 'string' ? aiAnalysis.requiredDocuments : JSON.stringify(aiAnalysis.requiredDocuments)}
Itens e Lotes: ${aiAnalysis.biddingItems || 'Não disponível'}
Exigências de Qualificação Técnica (LITERAL): ${aiAnalysis.qualificationRequirements || 'Não disponível'}
Prazos e Datas Críticas: ${typeof aiAnalysis.deadlines === 'string' ? aiAnalysis.deadlines : JSON.stringify(aiAnalysis.deadlines)}
Considerações de Preço: ${aiAnalysis.pricingConsiderations || 'Não disponível'}
Alertas e Irregularidades: ${typeof aiAnalysis.irregularitiesFlags === 'string' ? aiAnalysis.irregularitiesFlags : JSON.stringify(aiAnalysis.irregularitiesFlags)}
Penalidades: ${aiAnalysis.penalties || 'Não disponível'}
`.trim();
        }

        const currentDateStr = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
        const repName = company.contactName || '[Nome do Representante]';
        const repCpf = company.contactCpf || '[CPF]';

        let cleanCity = (company.city || '[Cidade]').split('/')[0].trim();
        const companyState = (company.state || '[UF]').toUpperCase().trim();

        const systemInstruction = MASTER_PETITION_SYSTEM_PROMPT
            .replace(/{currentDate}/g, currentDateStr)
            .replace(/{legalRepresentativeName}/g, repName)
            .replace(/{legalRepresentativeCpf}/g, repCpf)
            .replace(/{companyCity}/g, cleanCity)
            .replace(/{companyState}/g, companyState)
            .replace(/{companyName}/g, company.razaoSocial)
            .replace(/{companyCnpj}/g, company.cnpj);

        const fullBiddingObject = bidding.summary || bidding.title;

        const userInstruction = PETITION_USER_INSTRUCTION
            .replace('{petitionType}', templateType.toUpperCase())
            .replace(/{fullBiddingObject}/g, fullBiddingObject)
            .replace('{issuer}', bidding.portal)
            .replace('{modality}', bidding.modality)
            .replace('{portal}', bidding.portal)
            .replace('{biddingAnalysis}', biddingAnalysisText)
            .replace('{companyName}', company.razaoSocial)
            .replace('{companyCnpj}', company.cnpj)
            .replace('{companyQualification}', company.qualification || 'Não informada')
            .replace(/{legalRepresentativeName}/g, repName)
            .replace(/{legalRepresentativeCpf}/g, repCpf)
            .replace(/{companyCity}/g, cleanCity)
            .replace(/{companyState}/g, companyState)
            .replace(/{currentDate}/g, currentDateStr)
            .replace('{userContext}', userContext);

        // Preparar partes para o Gemini (Texto + Arquivos PDF/Imagens)
        const parts: any[] = [{ text: userInstruction }];

        if (attachments && Array.isArray(attachments)) {
            attachments.forEach((att: any) => {
                if (att.data && att.mimeType) {
                    parts.push({
                        inlineData: {
                            data: att.data,
                            mimeType: att.mimeType
                        }
                    });
                }
            });
        }

        const result = await callGeminiWithRetry(ai.models, {
            model: 'gemini-2.0-flash',
            contents: [
                {
                    role: 'user',
                    parts: parts
                }
            ],
            config: {
                systemInstruction: systemInstruction,


                temperature: 0.2,
                maxOutputTokens: 8192
            }
        });

        res.json({ text: result.text });
    } catch (error: any) {
        console.error('[Petition] Error:', error.message);
        res.status(500).json({ error: 'Erro ao gerar petição: ' + (error.message || 'Unknown error') });
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

        // Busca Vetorial RAG
        let ragContext = "";
        try {
            const queryText = messages[messages.length - 1]?.text;
            if (queryText && biddingProcessId) {
                const similarChunks = await searchSimilarChunks(biddingProcessId, queryText, 5);
                if (similarChunks && similarChunks.length > 0) {
                    ragContext = "\n\nTRECHOS DO EDITAL MAIS RELEVANTES PARA A PERGUNTA:\n" + similarChunks.map((c: any) => c.content).join("\n\n---\n\n");
                    traceLog(`[RAG] Encontrados ${similarChunks.length} trechos vetorizados com sucesso para: "${queryText.substring(0, 30)}..."`);
                    analysisContext += ragContext;
                }
            }
        } catch (ragErr: any) {
            traceLog(`[RAG] Erro ao buscar vetores: ${ragErr.message}`);
        }

        const pdfParts: any[] = [];
        traceLog(`Final fileNames for Gemini: ${JSON.stringify(fileNames)}`);

        // DYNAMIC DECISION: Só enviamos o pesado PDF inteiro (multimodal) se o banco de vetor falhar ou não achar contexto.
        if (!ragContext || ragContext.trim() === "") {
            traceLog(`[RAG] Sem trechos vetorizados. Realizando fallback doloroso para envio completo do(s) PDF(s) para a IA...`);
            const fetched = await fetchPdfPartsForProcess(biddingProcessId, fileNames || [], req.user.tenantId);
            pdfParts.push(...fetched);
        } else {
            traceLog(`[RAG] Trechos fornecidos pela busca vetorial! Omitindo Buffer PDF da payload (Economia de tokens ativada 🚀).`);
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

// ═══════════════════════════════════════════════════════════════════════
// Chat Monitor Configuration
// ═══════════════════════════════════════════════════════════════════════
app.get('/api/chat-monitor/config', authenticateToken, async (req: any, res) => {
    try {
        const config = await prisma.chatMonitorConfig.findUnique({
            where: { tenantId: req.user.tenantId }
        });
        res.json(config || { keywords: "suspensa,reaberta,vencedora", isActive: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch chat monitor config' });
    }
});

app.post('/api/chat-monitor/config', authenticateToken, async (req: any, res) => {
    try {
        const { keywords, phoneNumber, telegramChatId, isActive } = req.body;
        const config = await prisma.chatMonitorConfig.upsert({
            where: { tenantId: req.user.tenantId },
            create: {
                tenantId: req.user.tenantId,
                keywords,
                phoneNumber,
                telegramChatId,
                isActive: isActive ?? true
            },
            update: {
                keywords,
                phoneNumber,
                telegramChatId,
                isActive: isActive ?? true
            }
        });
        res.json(config);
    } catch (error) {
        res.status(500).json({ error: 'Failed to save chat monitor config' });
    }
});

app.get('/api/chat-monitor/logs', authenticateToken, async (req: any, res) => {
    try {
        const { keyword, search, status, page = '1', limit = '20' } = req.query;
        const pageNum = Math.max(1, parseInt(page as string) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit as string) || 20));
        const skip = (pageNum - 1) * limitNum;

        // Build dynamic where clause
        const where: any = { tenantId: req.user.tenantId };

        if (keyword) {
            where.detectedKeyword = { contains: keyword as string, mode: 'insensitive' };
        }
        if (search) {
            where.content = { contains: search as string, mode: 'insensitive' };
        }
        if (status) {
            where.status = status as string;
        }

        const [logs, total] = await Promise.all([
            prisma.chatMonitorLog.findMany({
                where,
                include: { biddingProcess: true },
                orderBy: { createdAt: 'desc' },
                skip,
                take: limitNum
            }),
            prisma.chatMonitorLog.count({ where })
        ]);

        res.json({
            logs,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total,
                totalPages: Math.ceil(total / limitNum)
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch chat monitor logs' });
    }
});

// Test Notification Endpoint
app.post('/api/chat-monitor/test', authenticateToken, async (req: any, res) => {
    try {
        const { NotificationService } = await import('./services/monitoring/notification.service');
        const result = await NotificationService.sendTestNotification(req.user.tenantId);
        res.json({
            success: true,
            results: result,
            message: result.telegram === null && result.whatsapp === null
                ? 'Nenhum canal configurado. Insira um Telegram Chat ID ou WhatsApp.'
                : 'Teste de notificação enviado! Verifique seus canais.'
        });
    } catch (error: any) {
        console.error('[ChatMonitor] Test notification error:', error.message);
        res.status(500).json({ error: 'Falha ao enviar teste de notificação.' });
    }
});

// Monitor Health Status Endpoint
app.get('/api/chat-monitor/health', authenticateToken, async (req: any, res) => {
    try {
        const health = pncpMonitor.getHealthStatus();
        const monitoredCount = await prisma.biddingProcess.count({
            where: { isMonitored: true, tenantId: req.user.tenantId }
        });
        const totalAlerts = await prisma.chatMonitorLog.count({
            where: { tenantId: req.user.tenantId }
        });
        res.json({
            ...health,
            monitoredProcesses: monitoredCount,
            totalAlerts
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to get monitor health' });
    }
});

// ══════════════════════════════════════════
// ── Chat Monitor Module v2 Endpoints ──
// ══════════════════════════════════════════

// Update pncpLink for a process (manual fix when link was overwritten)
app.patch('/api/chat-monitor/pncp-link/:processId', authenticateToken, async (req: any, res) => {
    try {
        const { processId } = req.params;
        const { pncpLink } = req.body;
        if (!pncpLink?.includes('editais')) {
            return res.status(400).json({ error: 'Link PNCP inválido. Deve conter /editais/CNPJ/ANO/SEQ' });
        }
        await (prisma.biddingProcess as any).update({
            where: { id: processId },
            data: { pncpLink }
        });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Falha ao atualizar link PNCP' });
    }
});

// Get grouped processes with message counts (V3 — includes monitored processes without logs)
app.get('/api/chat-monitor/processes', authenticateToken, async (req: any, res) => {
    try {
        const { companyId, platform } = req.query;
        const tenantId = req.user.tenantId;

        // Step 1: Get ALL relevant processes — monitored OR with chat logs
        const processWhere: any = {
            tenantId,
            OR: [
                { isMonitored: true },
                { chatMonitorLogs: { some: {} } }
            ],
        };
        if (companyId) processWhere.companyProfileId = companyId as string;

        const processes = await prisma.biddingProcess.findMany({
            where: processWhere,
            select: {
                id: true, title: true, portal: true, modality: true,
                uasg: true, companyProfileId: true, isMonitored: true, link: true,
                _count: { select: { chatMonitorLogs: true } },
            }
        });

        if (processes.length === 0) {
            return res.json([]);
        }

        const processIds = processes.map(p => p.id);

        // Step 2: Get last message per process (raw SQL for performance)
        let lastMsgMap = new Map<string, any>();
        try {
            const lastMessages: any[] = await prisma.$queryRawUnsafe(`
                SELECT DISTINCT ON ("biddingProcessId") 
                    "biddingProcessId", "content", "createdAt", "authorType", "detectedKeyword"
                FROM "ChatMonitorLog" 
                WHERE "tenantId" = $1 AND "biddingProcessId" = ANY($2::text[])
                ORDER BY "biddingProcessId", "createdAt" DESC
            `, tenantId, processIds);
            lastMsgMap = new Map(lastMessages.map((m: any) => [m.biddingProcessId, m]));
        } catch (e) {
            console.log('[ChatMonitor] Raw query failed, skipping last messages:', e);
        }

        // Step 3: Safely get unread counts
        let unreadMap = new Map<string, number>();
        try {
            const unreadCounts: any[] = await (prisma.chatMonitorLog as any).groupBy({
                by: ['biddingProcessId'],
                where: { tenantId, isRead: false },
                _count: { id: true },
            });
            unreadMap = new Map(unreadCounts.map((u: any) => [u.biddingProcessId, u._count.id]));
        } catch {
            // isRead column may not exist yet
        }

        // Step 4: Get important (keyword detected) processes
        let importantSet = new Set<string>();
        try {
            const kwLogs: any[] = await prisma.chatMonitorLog.findMany({
                where: { tenantId, detectedKeyword: { not: null } },
                select: { biddingProcessId: true },
                distinct: ['biddingProcessId'],
            });
            importantSet = new Set(kwLogs.map((k: any) => k.biddingProcessId));
        } catch { /* silent */ }

        // Step 5: Build result
        const result = processes.map((p: any) => {
            const total = p._count.chatMonitorLogs || 0;
            const lastMsg = lastMsgMap.get(p.id);
            return {
                id: p.id,
                title: p.title,
                portal: p.portal,
                modality: p.modality,
                uasg: p.uasg,
                companyProfileId: p.companyProfileId,
                isMonitored: p.isMonitored,
                hasPncpLink: !!(p.link?.includes('editais')),
                totalMessages: total,
                unreadCount: unreadMap.has(p.id) ? unreadMap.get(p.id) : total,
                isImportant: importantSet.has(p.id),
                isArchived: false,
                lastMessage: lastMsg ? {
                    content: lastMsg.content,
                    createdAt: lastMsg.createdAt,
                    authorType: lastMsg.authorType,
                    detectedKeyword: lastMsg.detectedKeyword,
                } : null,
            };
        });

        // Sort: processes with messages first (by last msg date), then monitored without msgs
        result.sort((a, b) => {
            const dateA = a.lastMessage?.createdAt ? new Date(a.lastMessage.createdAt).getTime() : 0;
            const dateB = b.lastMessage?.createdAt ? new Date(b.lastMessage.createdAt).getTime() : 0;
            return dateB - dateA;
        });

        // Apply platform filter
        let filtered = result;
        if (platform) {
            const pf = (platform as string).toLowerCase();
            filtered = result.filter((p: any) => {
                const portal = (p.portal || '').toLowerCase();
                if (pf === 'comprasnet') return portal.includes('compras') || portal.includes('cnet');
                if (pf === 'pncp') return portal.includes('pncp');
                if (pf === 'bll') return portal.includes('bll');
                return true;
            });
        }

        res.json(filtered);
    } catch (error) {
        console.error('[ChatMonitor] Error fetching processes:', error);
        res.status(500).json({ error: 'Failed to fetch chat monitor processes', details: String(error) });
    }
});

// Get messages for a specific process (paginated, ordered chronologically)
app.get('/api/chat-monitor/messages/:processId', authenticateToken, async (req: any, res) => {
    try {
        const { processId } = req.params;
        const { page = '1', limit = '100' } = req.query;
        const pageNum = Math.max(1, parseInt(page as string) || 1);
        const limitNum = Math.min(500, Math.max(1, parseInt(limit as string) || 100));
        const skip = (pageNum - 1) * limitNum;

        const [messages, total] = await Promise.all([
            prisma.chatMonitorLog.findMany({
                where: { biddingProcessId: processId, tenantId: req.user.tenantId },
                orderBy: { createdAt: 'asc' },
                skip,
                take: limitNum,
            }),
            prisma.chatMonitorLog.count({
                where: { biddingProcessId: processId, tenantId: req.user.tenantId },
            }),
        ]);

        // Also get the process details
        const process = await prisma.biddingProcess.findUnique({
            where: { id: processId },
            select: {
                id: true, title: true, portal: true, modality: true,
                companyProfileId: true,
            },
        });

        res.json({
            messages,
            process: process ? { ...process, uasg: (process as any).uasg } : null,
            pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
        });
    } catch (error) {
        console.error('[ChatMonitor] Error fetching messages:', error);
        res.status(500).json({ error: 'Failed to fetch messages' });
    }
});

// Get unread count (for sidebar badge)
app.get('/api/chat-monitor/unread-count', authenticateToken, async (req: any, res) => {
    try {
        const count = await (prisma.chatMonitorLog as any).count({
            where: { tenantId: req.user.tenantId, isRead: false, isArchived: false }
        });
        res.json({ count });
    } catch {
        // isRead/isArchived columns may not exist yet
        res.json({ count: 0 });
    }
});

// Toggle read/important/archive on a log
app.put('/api/chat-monitor/log/:logId', authenticateToken, async (req: any, res) => {
    try {
        const { logId } = req.params;
        const { isRead, isImportant, isArchived } = req.body;

        const data: any = {};
        if (isRead !== undefined) data.isRead = isRead;
        if (isImportant !== undefined) data.isImportant = isImportant;
        if (isArchived !== undefined) data.isArchived = isArchived;

        const updated = await prisma.chatMonitorLog.update({
            where: { id: logId },
            data,
        });

        res.json(updated);
    } catch (error) {
        res.status(500).json({ error: 'Failed to update log' });
    }
});

// Batch mark-read all messages for a process
app.put('/api/chat-monitor/read-all/:processId', authenticateToken, async (req: any, res) => {
    try {
        const { processId } = req.params;
        const result = await (prisma.chatMonitorLog as any).updateMany({
            where: { biddingProcessId: processId, tenantId: req.user.tenantId, isRead: false } as any,
            data: { isRead: true },
        });
        res.json({ updated: result.count });
    } catch (error) {
        res.status(500).json({ error: 'Failed to mark messages as read' });
    }
});

// Batch toggle important/archive for all messages of a process
app.put('/api/chat-monitor/process-action/:processId', authenticateToken, async (req: any, res) => {
    try {
        const { processId } = req.params;
        const { isImportant, isArchived } = req.body;

        const data: any = {};
        if (isImportant !== undefined) data.isImportant = isImportant;
        if (isArchived !== undefined) data.isArchived = isArchived;

        const result = await prisma.chatMonitorLog.updateMany({
            where: { biddingProcessId: processId, tenantId: req.user.tenantId },
            data,
        });
        res.json({ updated: result.count });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update process messages' });
    }
});

// ══════════════════════════════════════════
// ── Local Watcher (Agent) Endpoints ──
// ══════════════════════════════════════════

// In-memory store for Agent Heartbeats (Phase 1)
const agentHeartbeats = new Map<string, any>(); 

// 1. Get sessions the agent should monitor
app.get('/api/chat-monitor/agents/sessions', authenticateToken, async (req: any, res) => {
    try {
        const tenantId = req.user.tenantId;
        const processes = await prisma.biddingProcess.findMany({
            where: {
                tenantId,
                isMonitored: true,
                uasg: { not: null },
                modalityCode: { not: null },
                processNumber: { not: null },
                processYear: { not: null },
            },
            select: {
                id: true,
                title: true,
                uasg: true,
                modalityCode: true,
                processNumber: true,
                processYear: true,
                portal: true
            }
        });
        res.json(processes);
    } catch (error: any) {
        console.error('[Agent /sessions] Error:', error.message);
        res.status(500).json({ error: 'Failed to fetch agent sessions' });
    }
});

// 2. Agent Heartbeat (Ping from Local Watcher)
app.post('/api/chat-monitor/agents/heartbeat', authenticateToken, async (req: any, res) => {
    try {
        const tenantId = req.user.tenantId;
        const { machineName, activeSessions, agentVersion, status } = req.body;
        
        agentHeartbeats.set(tenantId, {
            machineName: machineName || 'Local Agent',
            activeSessions: activeSessions || 0,
            agentVersion: agentVersion || '1.0.0',
            status: status || 'online',
            lastHeartbeatAt: new Date(),
        });

        res.json({ success: true, timestamp: new Date() });
    } catch (error: any) {
        res.status(500).json({ error: 'Failed to register heartbeat' });
    }
});

// 3. Agent Status (Ping from React UI)
app.get('/api/chat-monitor/agents/status', authenticateToken, async (req: any, res) => {
    try {
        const tenantId = req.user.tenantId;
        const status = agentHeartbeats.get(tenantId);
        
        if (!status) {
            return res.json({ isOnline: false });
        }
        
        // Agent is considered offline if missed heartbeat for > 3 minutes
        const isOnline = (new Date().getTime() - status.lastHeartbeatAt.getTime()) < 3 * 60 * 1000;
        
        res.json({ ...status, isOnline });
    } catch (error: any) {
        res.status(500).json({ error: 'Failed to fetch agent status' });
    }
});

// Receives messages from local ComprasNet Watcher
// ══════════════════════════════════════════

// Receives messages from local ComprasNet Watcher
app.post('/api/chat-monitor/ingest', authenticateToken, async (req: any, res) => {
    try {
        const { processId, messages } = req.body;
        const tenantId = req.user.tenantId;

        if (!processId || !Array.isArray(messages) || messages.length === 0) {
            return res.status(400).json({ error: 'processId and messages[] required' });
        }

        // Verify process belongs to tenant
        const process = await prisma.biddingProcess.findFirst({
            where: { id: processId, tenantId }
        });
        if (!process) {
            return res.status(404).json({ error: 'Process not found or not yours' });
        }

        // Get existing messageIds to deduplicate
        const existingLogs = await prisma.chatMonitorLog.findMany({
            where: { biddingProcessId: processId },
            select: { messageId: true }
        });
        const existing = new Set(existingLogs.map(l => l.messageId));

        // Get keywords config
        const config = await prisma.chatMonitorConfig.findUnique({
            where: { tenantId }
        });
        const keywords = config?.keywords?.split(',').map(k => k.trim().toLowerCase()) || [];

        const { DedupService } = require('./services/monitoring/dedup.service');

        let created = 0;
        let alerts = 0;

        for (const msg of messages) {
            const messageId = msg.messageId || null;
            const content = msg.content || '';
            const authorType = msg.authorType || 'desconhecido';
            const fingerprintHash = DedupService.generateFingerprint(processId, messageId, content, authorType);

            // Double deduplication: skip if messageId OR fingerprintHash exist
            if ((messageId && existing.has(messageId))) continue;
            
            const isDuplicate = await prisma.chatMonitorLog.findUnique({
                where: { fingerprintHash }
            });

            if (isDuplicate) continue;

            const detectedKeyword = keywords.find(k => content.toLowerCase().includes(k)) || null;
            if (detectedKeyword) alerts++;

            // Simple taxonomy logic
            let eventCategory = msg.eventCategory;
            let status = detectedKeyword ? 'PENDING_NOTIFICATION' : 'CAPTURED';

            // Enhance taxonomy based on standard patterns if eventCategory is null
            if (!eventCategory) {
              const lowerContent = content.toLowerCase();
              if (lowerContent.includes('encerrado o prazo') || lowerContent.includes('tempo aleatório')) {
                eventCategory = '13'; // encerramento_prazo
                status = 'PENDING_NOTIFICATION'; // Auto-alert for closing times
                alerts++;
              } else if (lowerContent.includes('suspenso') || lowerContent.includes('suspensão')) {
                eventCategory = '12'; // suspensao
              } else if (lowerContent.includes('bom dia') || lowerContent.includes('boa tarde')) {
                eventCategory = '10'; // saudacao  
              }
            }

            await prisma.chatMonitorLog.create({
                data: {
                    tenantId,
                    biddingProcessId: processId,
                    messageId,
                    fingerprintHash,
                    content,
                    authorType,
                    authorCnpj: msg.authorCnpj || null,
                    eventCategory: eventCategory || null,
                    itemRef: msg.itemRef || null,
                    detectedKeyword,
                    captureSource: msg.captureSource || 'local-watcher',
                    status,
                }
            });
            if (messageId) {
                existing.add(messageId);
            }
            created++;
        }

        // Trigger notifications if there were keyword matches
        if (alerts > 0) {
            try {
                const { NotificationService } = require('./services/monitoring/notification.service');
                await NotificationService.processPendingNotifications();
            } catch { /* silent */ }
        }

        console.log(`[Ingest] ${created} msgs saved for process ${processId.substring(0, 8)}... (${alerts} alerts)`);
        res.json({ success: true, created, alerts, total: messages.length });
    } catch (error: any) {
        console.error('[Ingest] Error:', error.message);
        res.status(500).json({ error: 'Failed to ingest messages', details: error.message });
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

// Helpers
async function fetchPdfPartsForProcess(biddingProcessId: string | null, fileNamesRaw: string[], tenantId: string): Promise<any[]> {
    const pdfParts: any[] = [];
    const biddingLinks = biddingProcessId ? (await prisma.biddingProcess.findUnique({ where: { id: biddingProcessId } }))?.link || "" : "";

    for (let fileName of fileNamesRaw) {
        fileName = decodeURIComponent(fileName).split('?')[0];
        const doc = await prisma.document.findFirst({
            where: {
                fileUrl: { contains: fileName },
                tenantId: tenantId
            }
        });
        const hasPrefix = fileName.startsWith(tenantId) || fileName.startsWith(`pncp_${tenantId}`);
        const isExplicitlyLinked = biddingLinks.includes(fileName);
        if (!(!!doc || hasPrefix || isExplicitlyLinked)) continue;

        const fileToFetch = doc ? doc.fileUrl : fileName;
        const pdfBuffer = await getFileBufferSafe(fileToFetch, tenantId);
        if (pdfBuffer) {
            pdfParts.push({ inlineData: { data: pdfBuffer.toString('base64'), mimeType: 'application/pdf' } });
        }
    }
    return pdfParts;
}

app.listen(PORT, async () => {
    console.log(`Server is running on port ${PORT} (mode: ${process.env.NODE_ENV || 'development'})`);
    console.log(`Upload directory: ${uploadDir}`);
    await runAutoSetup();
    
    // Start Chat Monitor Polling
    pncpMonitor.startPolling(5); // Run every 5 minutes
});

// Keep event loop alive (required in this environment)
setInterval(() => { }, 1 << 30);
