import { robustJsonParse, robustJsonParseDetailed } from "./services/ai/parser.service";
import { callGeminiWithRetry } from "./services/ai/gemini.service";
import { ANALYZE_EDITAL_SYSTEM_PROMPT, USER_ANALYSIS_INSTRUCTION, EXTRACT_CERTIFICATE_SYSTEM_PROMPT, COMPARE_CERTIFICATE_SYSTEM_PROMPT, MASTER_PETITION_SYSTEM_PROMPT, PETITION_USER_INSTRUCTION, V2_EXTRACTION_PROMPT, V2_NORMALIZATION_PROMPT, V2_RISK_REVIEW_PROMPT, V2_EXTRACTION_USER_INSTRUCTION, V2_NORMALIZATION_USER_INSTRUCTION, V2_RISK_REVIEW_USER_INSTRUCTION, V2_PROMPT_VERSION, getDomainRoutingInstruction, NORM_CATEGORIES, buildCategoryNormPrompt, buildCategoryNormUser } from "./services/ai/prompt.service";
import { AnalysisSchemaV1, createEmptyAnalysisSchema } from "./services/ai/analysis-schema-v1";
import { fallbackToOpenAi, fallbackToOpenAiV2 } from "./services/ai/openai.service";
import { indexDocumentChunks, searchSimilarChunks } from "./services/ai/rag.service";
import { executeRiskRules } from "./services/ai/riskRulesEngine";
import { evaluateAnalysisQuality } from "./services/ai/analysisQualityEvaluator";
import { buildModuleContext, ModuleName } from "./services/ai/modules/moduleContextContracts";
import { CHAT_SYSTEM_PROMPT, CHAT_USER_INSTRUCTION } from "./services/ai/modules/prompts/chatPromptV2";
import { PETITION_SYSTEM_PROMPT, PETITION_USER_INSTRUCTION as PETITION_V2_USER_INSTRUCTION } from "./services/ai/modules/prompts/petitionPromptV2";
import { ORACLE_SYSTEM_PROMPT } from "./services/ai/modules/prompts/oraclePromptV2";
import { DECLARATION_SYSTEM_PROMPT } from "./services/ai/modules/prompts/declarationPromptV2";
import { evaluateModuleQuality } from "./services/ai/modules/moduleQualityEvaluator";
import { evaluateHumanReview } from "./services/ai/modules/humanReviewPolicy";
import { submitFeedback, getFeedbackByModule, getFeedbackStats, AIExecutionFeedback } from "./services/ai/governance/feedbackService";
import { generateSystemReport, recordExecution } from "./services/ai/governance/operationalMetrics";
import { registerInitialVersions, getAllVersions, getPromotionHistory } from "./services/ai/governance/versionGovernance";
import { generateImprovementInsights, convertFeedbackToGoldenCases } from "./services/ai/governance/improvementInsights";
import { createOrUpdateProfile, getProfile, getAllProfiles, createEmptyProfile, CompanyLicitationProfile } from "./services/ai/company/companyProfileService";
import { matchCompanyToEdital, calculateParticipationScore, generateActionPlan } from "./services/ai/strategy/participationEngine";
import { buildHybridContext } from "./services/ai/strategy/companyAwareContext";
import { generateCompanyInsights, recordMatchHistory } from "./services/ai/strategy/companyLearningInsights";
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

        // Prefer V2 structured context for oracle (technical focus)
        let requirements: string;
        if (bidding.aiAnalysis?.schemaV2) {
            requirements = buildModuleContext(bidding.aiAnalysis.schemaV2, 'oracle');
            console.log(`[AI Oracle] Using buildModuleContext('oracle') for comparison`);
        } else {
            requirements = bidding.aiAnalysis?.qualificationRequirements || bidding.summary || "";
        }

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
${bidding.aiAnalysis?.schemaV2 ? buildModuleContext(bidding.aiAnalysis.schemaV2, 'declaration') : (bidding.aiAnalysis?.fullSummary || bidding.summary || '').substring(0, 3500)}

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

// ── Update a single saved search ──
app.put('/api/pncp/searches/:id', authenticateToken, async (req: any, res) => {
    try {
        const id = req.params.id;
        const tenantId = req.user.tenantId;
        const { name, keywords, status, states, listName, companyProfileId } = req.body;
        const data: any = {};
        if (name !== undefined) data.name = name;
        if (keywords !== undefined) data.keywords = keywords;
        if (status !== undefined) data.status = status;
        if (states !== undefined) data.states = states;
        if (listName !== undefined) data.listName = listName;
        if (companyProfileId !== undefined) data.companyProfileId = companyProfileId || null;
        await prisma.pncpSavedSearch.updateMany({
            where: { id, tenantId },
            data
        });
        res.json({ success: true });
    } catch (error) {
        console.error("Update saved search error:", error);
        res.status(500).json({ error: 'Failed to update saved search' });
    }
});

// ── Rename a saved search list (bulk update listName) ──
app.put('/api/pncp/searches/list/rename', authenticateToken, async (req: any, res) => {
    try {
        const tenantId = req.user.tenantId;
        const { oldName, newName } = req.body;
        if (!oldName || !newName) return res.status(400).json({ error: 'oldName and newName required' });
        await prisma.pncpSavedSearch.updateMany({
            where: { tenantId, listName: oldName },
            data: { listName: newName.trim() }
        });
        res.json({ success: true });
    } catch (error) {
        console.error("Rename search list error:", error);
        res.status(500).json({ error: 'Failed to rename list' });
    }
});

// ── Delete a saved search list (migrate items to default) ──
app.delete('/api/pncp/searches/list/:name', authenticateToken, async (req: any, res) => {
    try {
        const tenantId = req.user.tenantId;
        const listName = decodeURIComponent(req.params.name);
        if (listName === 'Pesquisas Gerais') return res.status(400).json({ error: 'Cannot delete default list' });
        // Move all searches from this list to the default list
        await prisma.pncpSavedSearch.updateMany({
            where: { tenantId, listName },
            data: { listName: 'Pesquisas Gerais' }
        });
        res.json({ success: true });
    } catch (error) {
        console.error("Delete search list error:", error);
        res.status(500).json({ error: 'Failed to delete list' });
    }
});

app.post('/api/pncp/search', authenticateToken, async (req: any, res) => {
    try {
        const { keywords, status, uf, pagina = 1, modalidade, dataInicio, dataFim, esfera, orgao, orgaosLista, excludeKeywords } = req.body;
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

        // Merge single orgao into orgaosLista if it contains commas
        let effectiveOrgao = orgao || '';
        let effectiveOrgaosLista = orgaosLista || '';
        if (effectiveOrgao.includes(',')) {
            effectiveOrgaosLista = effectiveOrgaosLista
                ? `${effectiveOrgaosLista},${effectiveOrgao}`
                : effectiveOrgao;
            effectiveOrgao = '';
        }

        // Expand region UF groups into individual UFs for separate fetches
        let ufsToIterate: string[] = [];
        if (uf && uf.includes(',')) {
            ufsToIterate = uf.split(',').map((u: string) => u.trim()).filter(Boolean);
        } else if (uf) {
            ufsToIterate = [uf];
        }

        const buildBaseUrl = (qItems: string[], overrideCnpj?: string, singleUf?: string) => {
            let url = `https://pncp.gov.br/api/search/?tipos_documento=edital&ordenacao=-data&tam_pagina=${overrideCnpj ? 100 : 500}&pagina=1`;
            if (overrideCnpj) {
                url += `&cnpj=${overrideCnpj}`;
            }
            if (qItems.length > 0) {
                url += `&q=${encodeURIComponent(qItems.join(' '))}`;
            }
            if (status && status !== 'todas') url += `&status=${status}`;
            // Use single UF per request (region groups are split upstream)
            if (singleUf) url += `&ufs=${singleUf}`;
            if (modalidade && modalidade !== 'todas') url += `&modalidades_licitacao=${encodeURIComponent(modalidade)}`;
            if (dataInicio) url += `&data_inicio=${dataInicio}`;
            if (dataFim) url += `&data_fim=${dataFim}`;
            if (esfera && esfera !== 'todas') url += `&esferas=${esfera}`;
            return url;
        };

        let extractedNames: string[] = [];
        if (effectiveOrgaosLista) {
            extractedNames = effectiveOrgaosLista.split(/[\n,;]+/).map((s: string) => s.trim().replace(/^"|"$/g, '')).filter((s: string) => s.length > 0);
            extractedNames = [...new Set(extractedNames)]; // Remove duplicates
        }

        let urlsToFetch: string[] = [];
        const keywordsToIterate = kwList.length > 0 ? kwList : [null];
        const orgaosToIterate = extractedNames.length > 0 ? extractedNames : (effectiveOrgao ? [effectiveOrgao] : [null]);
        const ufsForIteration = ufsToIterate.length > 0 ? ufsToIterate : [null];

        for (const kw of keywordsToIterate) {
            for (const org of orgaosToIterate) {
                for (const singleUf of ufsForIteration) {
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

                    urlsToFetch.push(buildBaseUrl(localParams, overrideCnpj, singleUf || undefined));
                }
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

            // Extract value from all possible fields aggressively (null-safe)
            const rawVal = item.valor_estimado ?? item.valor_global ?? item.valorTotalEstimado
                ?? item.valorTotalHomologado ?? item.amountInfo?.amount ?? item.valorTotalLicitacao ?? null;
            const valorEstimado = rawVal != null ? (Number(rawVal) || 0) : 0;

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

        // ── Post-filter by modalidade (API may not filter precisely) ──
        const modalidadeMap: Record<string, string> = {
            '1': 'Pregão - Eletrônico', '2': 'Concorrência', '3': 'Concurso',
            '4': 'Leilão', '5': 'Diálogo Competitivo', '6': 'Dispensa de Licitação',
            '7': 'Inexigibilidade', '8': 'Tomada de Preços', '9': 'Convite',
        };
        let filteredItems = items;
        if (modalidade && modalidade !== 'todas') {
            const modalidadeLabel = (modalidadeMap[modalidade] || '').toLowerCase();
            if (modalidadeLabel) {
                filteredItems = filteredItems.filter((it: any) => {
                    const nome = (it.modalidade_nome || '').toLowerCase();
                    return nome.includes(modalidadeLabel.split(' - ')[0]) || nome.includes(modalidadeLabel);
                });
            }
        }

        // ── Post-filter by exclude keywords (remove results with unwanted terms in objeto) ──
        if (excludeKeywords && typeof excludeKeywords === 'string' && excludeKeywords.trim()) {
            const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            const excludeTerms = excludeKeywords.split(',')
                .map((t: string) => normalize(t.trim()))
                .filter((t: string) => t.length > 0);
            if (excludeTerms.length > 0) {
                filteredItems = filteredItems.filter((it: any) => {
                    const objNorm = normalize((it.objeto || '') + ' ' + (it.titulo || ''));
                    return !excludeTerms.some((term: string) => objNorm.includes(term));
                });
            }
        }

        // ── Post-filter by esfera (additional accuracy) ──
        // The PNCP API esfera param works on the search API but results may leak
        // We don't post-filter esfera since the API handles it and we don't have esfera in results

        // GLOBAL sort ALL items by closest deadline using search API dates
        const now = Date.now();
        filteredItems.sort((a: any, b: any) => {
            const dateA = new Date(a.data_encerramento_proposta || a.data_abertura || '9999').getTime();
            const dateB = new Date(b.data_encerramento_proposta || b.data_abertura || '9999').getTime();
            const absA = isNaN(dateA) ? Infinity : Math.abs(dateA - now);
            const absB = isNaN(dateB) ? Infinity : Math.abs(dateB - now);
            return absA - absB;
        });

        // Paginate first, then hydrate ONLY the page items (fast!)
        const totalResults = filteredItems.length;
        const startIdx = (Number(pagina) - 1) * pageSize;
        const pageItems = filteredItems.slice(startIdx, startIdx + pageSize);

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
        // Sort by legal/technical priority: Edital > TR > Projeto Básico > Planilhas > Proposta > Minuta > outros
        arquivos.sort((a: any, b: any) => {
            const nameScore = (name: string): number => {
                const n = (name || '').toLowerCase();
                if (n.includes('edital') && !n.includes('anexo')) return 0;
                if (n.includes('termo_referencia') || n.includes('termo de referencia') || n.includes('tr_') || (a.tipoDocumentoId === 4)) return 1;
                if (n.includes('projeto_basico') || n.includes('projeto basico')) return 2;
                if (n.includes('planilha') || n.includes('orcamento')) return 3;
                if (n.includes('proposta') || n.includes('modelo_proposta')) return 4;
                if (n.includes('etp') || n.includes('estudo_tecnico')) return 5;
                if (n.includes('minuta') || n.includes('contrato')) return 8;
                if (n.includes('anexo')) return 6;
                return 7;
            };
            const pa = (a.tipoDocumentoId === 2) ? -1 : nameScore(a.titulo || a.nomeArquivo || '');
            const pb = (b.tipoDocumentoId === 2) ? -1 : nameScore(b.titulo || b.nomeArquivo || '');
            return pa - pb;
        });

        // 3. Download and process files — SMART PDF FILTER
        // Only download PDFs that contribute to habilitação extraction
        const MAX_PDF_PARTS = 3; // Reduced from 5 — edital + TR + 1 extra is enough
        const MAX_TOTAL_PDF_SIZE_KB = 15000; // Reduced from 30MB — 15MB budget
        let totalPdfSizeAccum = 0;
        const pdfParts: any[] = [];
        const downloadedFiles: string[] = [];
        const discardedFiles: string[] = [];

        // Pre-filter: exclude templates, project drawings, and irrelevant attachments BEFORE download
        const EXCLUDE_PATTERNS = [
            // Templates / Modelos
            'modelo_proposta', 'modelo_de_proposta', 'modelo proposta',
            'modelo_recibo', 'modelo recibo', 'modelo_declarac', 'modelo declarac',
            'modelo_ata', 'modelo ata', 'modelo_contrato', 'modelo_carta',
            'carta_fian', 'carta fian',
            // Publicações / Atas / Avisos
            'aviso_publicac', 'aviso publicac', 'aviso_licitac',
            'aviso_de_licit', 'aviso de licit', 'aviso_licit',
            'quadro_de_aviso', 'quadro de aviso',
            'd.o.u', 'diario_oficial', 'diario oficial',
            'retificac', 'errata', 'ata_sessao', 'ata_da_sessao',
            'comprovante', 'recibo_garantia', 'modelo_recibo_garantia',
            'minuta_contrato', 'minuta contrato', 'minuta_de_contrato',
            // Projetos de engenharia / plantas / memoriais (não contribuem para habilitação)
            'projeto_arq', 'projeto arq', 'planta_', 'planta ',
            'memorial_descritivo', 'memorial descritivo',
            'croqui', 'layout_', 'layout ',
            'detalhamento_', 'det_arq', 'det arq',
        ];

        // Keywords that indicate edital/TR content (should NOT be excluded even if "Outros Documentos")
        const ESSENTIAL_KEYWORDS = [
            'edital', 'termo_referencia', 'termo de referencia', 'tr_',
            'projeto_basico', 'projeto basico', 'planilha', 'orcamento',
            'cronograma', 'bdi', 'etp', 'estudo_tecnico',
        ];

        const filteredArquivos = arquivos.filter((arq: any) => {
            const name = (arq.titulo || arq.nomeArquivo || arq.nome || '').toLowerCase()
                .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            const tipoDesc = (arq.tipoDocumentoDescricao || '').toLowerCase();
            const tipoId = arq.tipoDocumentoId;

            // Rule 1: Exclude by explicit pattern match
            const isExcludedByPattern = EXCLUDE_PATTERNS.some(pat => name.includes(pat));
            if (isExcludedByPattern) {
                console.log(`[PNCP-AI] 🚫 Excluído (template/padrão): "${arq.titulo}" (tipo: ${tipoDesc || tipoId})`);
                discardedFiles.push(`${arq.titulo} (excluído: template/padrão)`);
                return false;
            }

            // Rule 2: "Outros Documentos" with generic "ANEXO" names and no essential keywords → likely project files
            const isOutros = tipoDesc.includes('outros') || (tipoId !== 2 && tipoId !== 4); // Not Edital (2) nor TR (4)
            const hasEssentialKeyword = ESSENTIAL_KEYWORDS.some(kw => name.includes(kw));
            const isGenericAnexo = /^anexo[_\s]+(i|ii|iii|iv|v|vi|vii|viii|ix|x|[0-9])/.test(name);

            if (isOutros && isGenericAnexo && !hasEssentialKeyword) {
                console.log(`[PNCP-AI] 🚫 Excluído (anexo genérico/projeto): "${arq.titulo}" (tipo: ${tipoDesc || tipoId})`);
                discardedFiles.push(`${arq.titulo} (excluído: anexo genérico)`);
                return false;
            }

            return true;
        });

        // ── BUILD FULL ATTACHMENT CATALOG (for Proposal module) ──
        // Classifies ALL files by purpose so they can be downloaded on demand later
        const classifyAttachment = (arq: any): string => {
            const n = (arq.titulo || arq.nomeArquivo || '').toLowerCase()
                .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            const tipoId = arq.tipoDocumentoId;
            if (tipoId === 2 || (n.includes('edital') && !n.includes('anexo'))) return 'edital';
            if (tipoId === 4 || n.includes('termo_referencia') || n.includes('tr_')) return 'termo_referencia';
            if (n.includes('planilha') || n.includes('orcamento') || n.includes('orçamento')) return 'planilha_orcamentaria';
            if (n.includes('cronograma')) return 'cronograma';
            if (n.includes('bdi') || n.includes('encargos')) return 'bdi_encargos';
            if (n.includes('modelo_proposta') || n.includes('modelo de proposta') || n.includes('modelo_carta')) return 'modelo_proposta';
            if (n.includes('modelo_recibo') || n.includes('modelo_garantia')) return 'modelo_documento';
            if (n.includes('minuta') || n.includes('contrato')) return 'minuta_contrato';
            if (n.includes('projeto') || n.includes('planta') || n.includes('memorial')) return 'projeto_engenharia';
            if (n.includes('aviso')) return 'aviso_publicacao';
            if (n.includes('composic') || n.includes('custo')) return 'composicao_custos';
            return 'anexo_geral';
        };

        const pncpAttachments = arquivos.map((arq: any) => {
            const name = arq.titulo || arq.nomeArquivo || arq.nome || 'arquivo';
            const purpose = classifyAttachment(arq);
            const isDownloaded = filteredArquivos.includes(arq);
            return {
                titulo: name,
                url: arq.url || arq.uri || '',
                tipoDocumentoId: arq.tipoDocumentoId,
                tipoDocumentoDescricao: arq.tipoDocumentoDescricao || '',
                purpose,
                downloaded: isDownloaded,
                sequencial: arq.sequencialDocumento || arq.sequencial || null,
                ativo: arq.statusAtivo ?? true,
            };
        });

        const purposeCounts = pncpAttachments.reduce((acc: Record<string, number>, a: any) => {
            acc[a.purpose] = (acc[a.purpose] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);
        console.log(`[PNCP-AI] 📋 Catálogo completo: ${pncpAttachments.length} arquivos — ${JSON.stringify(purposeCounts)}`);

        console.log(`[PNCP-AI] 📊 Filtro inteligente: ${arquivos.length} anexos → ${filteredArquivos.length} relevantes (${arquivos.length - filteredArquivos.length} excluídos)`);

        for (const arq of filteredArquivos) {
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
                    // Budget check: skip if adding this PDF would exceed total size limit
                    const bufferSizeKB = buffer.length / 1024;
                    if (totalPdfSizeAccum + bufferSizeKB > MAX_TOTAL_PDF_SIZE_KB && pdfParts.length > 0) {
                        console.warn(`[PNCP-AI] \u26a0\ufe0f Or\u00e7amento de ${MAX_TOTAL_PDF_SIZE_KB}KB atingido (${Math.round(totalPdfSizeAccum)}KB acumulado). Ignorando "${fileName}" (${Math.round(bufferSizeKB)}KB)`);
                        discardedFiles.push(`${fileName} (${Math.round(bufferSizeKB)}KB)`);
                        continue;
                    }
                    totalPdfSizeAccum += bufferSizeKB;
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

        // ═══════════════════════════════════════════════════════════════════════
        // V2 PIPELINE — 3-Stage Analysis (migrated from /api/analyze-edital/v2)
        // ═══════════════════════════════════════════════════════════════════════
        
        // ── MODEL CONFIGURATION ──
        // Each pipeline stage uses the optimal model for its task
        const PIPELINE_MODELS = {
            extraction: 'gemini-2.5-flash',         // Etapa 1: PDF parsing (multimodal, proven)
            reExtraction: 'gemini-2.5-flash',       // Re-extraction fallback  
            normalization: 'gemini-2.5-flash-lite',  // Etapa 2: text-only JSON→JSON (fast, cheap)
            normQtp: 'gemini-2.5-flash',             // Etapa 2 QTP: needs full Flash for Rule 18 (CAT explosion)
            riskReview: 'gemini-2.5-flash-lite',     // Etapa 3: text-only risk analysis (fast, cheap)
        };
        console.log(`[PNCP-V2] 🤖 Modelos: E1=${PIPELINE_MODELS.extraction} | E2=${PIPELINE_MODELS.normalization} (QTP=${PIPELINE_MODELS.normQtp}) | E3=${PIPELINE_MODELS.riskReview}`);

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: 'GEMINI_API_KEY não configurada' });
        }
        const ai = new GoogleGenAI({ apiKey });
        const analysisStartTime = Date.now();

        // Initialize V2 result schema
        const v2Result = createEmptyAnalysisSchema();
        v2Result.analysis_meta.analysis_id = `pncp_${Date.now()}_${Math.random().toString(36).substring(7)}`;
        v2Result.analysis_meta.generated_at = new Date().toISOString();
        v2Result.analysis_meta.source_files = downloadedFiles;
        v2Result.analysis_meta.source_type = 'pncp_download';

        let modelsUsed: string[] = [];
        const stageTimes: Record<string, number> = {};
        // Pipeline health tracking for honest confidence scoring
        const pipelineHealth = {
            parseRepairs: 0,
            fallbacksUsed: 0,
            stagesFailed: 0,
        };

        console.log(`[PNCP-V2] ═══ PIPELINE INICIADO ═══ (${pdfParts.length} PDFs, ${downloadedFiles.join(', ')})`);

        // ── Stage 1: Factual Extraction (with PDFs) ──
        // Log diagnostic info about PDFs being sent
        const pdfSizes = pdfParts.map((p: any, i: number) => {
            const sizeKB = Math.round(Buffer.from(p.inlineData.data, 'base64').length / 1024);
            return `Doc${i + 1}: ${sizeKB}KB`;
        });
        const totalPdfSizeKB = pdfParts.reduce((sum: number, p: any) => sum + Buffer.from(p.inlineData.data, 'base64').length, 0) / 1024;
        console.log(`[PNCP-V2] ── Etapa 1/3: Extração Factual (${pdfParts.length} PDFs, ${Math.round(totalPdfSizeKB)}KB total — ${pdfSizes.join(', ')})...`);
        let extractionJson: any;
        const t1Start = Date.now();

        try {
            const extractionResponse = await callGeminiWithRetry(ai.models, {
                model: PIPELINE_MODELS.extraction,
                contents: [{
                    role: 'user',
                    parts: [
                        ...pdfParts,
                        { text: V2_EXTRACTION_USER_INSTRUCTION.replace('{domainReinforcement}', '') }
                    ]
                }],
                config: {
                    systemInstruction: V2_EXTRACTION_PROMPT,
                    temperature: 0.05,
                    maxOutputTokens: 65536,
                    responseMimeType: 'application/json'
                }
            });
            const extractionText = extractionResponse.text;
            if (!extractionText) throw new Error('Etapa 1 retornou vazio');
            const parseResult1 = robustJsonParseDetailed(extractionText, 'PNCP-V2-Extraction');
            extractionJson = parseResult1.data;
            if (parseResult1.repaired) pipelineHealth.parseRepairs++;
            v2Result.analysis_meta.workflow_stage_status.extraction = 'done';
            modelsUsed.push(PIPELINE_MODELS.extraction);
            stageTimes.extraction = (Date.now() - t1Start) / 1000;
            console.log(`[PNCP-V2] ✅ Etapa 1 em ${stageTimes.extraction.toFixed(1)}s — ${(extractionJson.evidence_registry || []).length} evidências, ${Object.values(extractionJson.requirements || {}).flat().length} exigências`);
        } catch (err: any) {
            console.warn(`[PNCP-V2] ⚠️ Etapa 1 Gemini falhou: ${err.message}. Tentando OpenAI...`);
            pipelineHealth.fallbacksUsed++;
            try {
                const openAiResult = await fallbackToOpenAiV2({
                    systemPrompt: V2_EXTRACTION_PROMPT,
                    userPrompt: V2_EXTRACTION_USER_INSTRUCTION.replace('{domainReinforcement}', ''),
                    pdfParts,
                    temperature: 0.05,
                    stageName: 'PNCP Etapa 1 (Extração)'
                });
                if (!openAiResult.text) throw new Error('OpenAI retornou vazio');
                extractionJson = robustJsonParse(openAiResult.text, 'PNCP-V2-Extraction-OpenAI');
                v2Result.analysis_meta.workflow_stage_status.extraction = 'done';
                modelsUsed.push(openAiResult.model);
                stageTimes.extraction = (Date.now() - t1Start) / 1000;
                console.log(`[PNCP-V2] ✅ Etapa 1 via OpenAI em ${stageTimes.extraction.toFixed(1)}s`);
            } catch (openAiErr: any) {
                console.error(`[PNCP-V2] ❌ Etapa 1 falhou (ambos modelos)`);
                throw new Error(`Etapa 1 (Extração) falhou. Gemini: ${err.message} | OpenAI: ${openAiErr.message}`);
            }
        }

        // Merge extraction into V2 result
        if (extractionJson.process_identification) v2Result.process_identification = extractionJson.process_identification;
        if (extractionJson.timeline) v2Result.timeline = extractionJson.timeline;
        if (extractionJson.participation_conditions) v2Result.participation_conditions = extractionJson.participation_conditions;
        if (extractionJson.requirements) v2Result.requirements = extractionJson.requirements;
        if (extractionJson.technical_analysis) v2Result.technical_analysis = extractionJson.technical_analysis;
        if (extractionJson.economic_financial_analysis) v2Result.economic_financial_analysis = extractionJson.economic_financial_analysis;
        if (extractionJson.proposal_analysis) v2Result.proposal_analysis = extractionJson.proposal_analysis;
        if (extractionJson.contractual_analysis) v2Result.contractual_analysis = extractionJson.contractual_analysis;
        if (extractionJson.evidence_registry) v2Result.evidence_registry = extractionJson.evidence_registry;

        // ── MANDATORY RFT COMPLETENESS INJECTION ──
        // The AI model consistently omits "obvious" fiscal documents (CNPJ, inscrições).
        // This server-side safety net ensures they're always present.
        const rftItems = Array.isArray((extractionJson.requirements as any)?.regularidade_fiscal_trabalhista)
            ? (extractionJson.requirements as any).regularidade_fiscal_trabalhista as any[]
            : [];
        const rftTexts = rftItems.map((r: any) => `${r.title || ''} ${r.description || ''}`.toLowerCase()).join(' ');

        // Find an existing source_ref from RFT items to reuse
        const existingRftSourceRef = rftItems.find((r: any) => r.source_ref && r.source_ref !== 'referência não localizada')?.source_ref || 'Edital, seção de habilitação';

        const mandatoryRftDocs = [
            {
                keywords: ['cnpj', 'cadastro nacional'],
                item: { requirement_id: 'RFT-CNPJ', title: 'Prova de inscrição no CNPJ', description: 'Comprovação de inscrição e situação cadastral no Cadastro Nacional da Pessoa Jurídica (CNPJ)', obligation_type: 'obrigatoria_universal', phase: 'habilitacao', applies_to: 'licitante', risk_if_missing: 'inabilitacao', source_ref: existingRftSourceRef, entry_type: 'exigencia_principal' }
            },
            {
                keywords: ['inscrição estadual', 'inscricao estadual', 'cadastro estadual'],
                item: { requirement_id: 'RFT-IE', title: 'Inscrição estadual no cadastro de contribuintes', description: 'Prova de inscrição no cadastro de contribuintes estadual, relativo ao domicílio ou sede do licitante, pertinente ao seu ramo de atividade', obligation_type: 'se_aplicavel', phase: 'habilitacao', applies_to: 'licitante', risk_if_missing: 'inabilitacao', source_ref: existingRftSourceRef, entry_type: 'exigencia_principal' }
            },
            {
                keywords: ['inscrição municipal', 'inscricao municipal', 'cadastro municipal'],
                item: { requirement_id: 'RFT-IM', title: 'Inscrição municipal no cadastro de contribuintes', description: 'Prova de inscrição no cadastro de contribuintes municipal, relativo ao domicílio ou sede do licitante, pertinente ao seu ramo de atividade', obligation_type: 'se_aplicavel', phase: 'habilitacao', applies_to: 'licitante', risk_if_missing: 'inabilitacao', source_ref: existingRftSourceRef, entry_type: 'exigencia_principal' }
            },
        ];

        let injectedCount = 0;
        for (const doc of mandatoryRftDocs) {
            const alreadyExists = doc.keywords.some(kw => rftTexts.includes(kw));
            if (!alreadyExists) {
                // CNPJ is always mandatory; inscrições only if edital has habilitação section
                const isCnpj = doc.item.requirement_id === 'RFT-CNPJ';
                const hasHabilitacao = rftItems.length > 0; // If there are ANY RFT items, habilitação exists
                if (isCnpj || hasHabilitacao) {
                    rftItems.push(doc.item);
                    injectedCount++;
                }
            }
        }

        if (injectedCount > 0) {
            (extractionJson.requirements as any).regularidade_fiscal_trabalhista = rftItems;
            (v2Result.requirements as any).regularidade_fiscal_trabalhista = rftItems;
            console.log(`[PNCP-V2] 🔧 RFT completude: +${injectedCount} doc(s) injetado(s) (CNPJ/inscrições omitidos pela IA)`);
        }

        // ── M3: DEDUP — remove generic "estadual ou municipal" if IE/IM are separate ──
        const hasIE = rftItems.some((r: any) => r.requirement_id === 'RFT-IE' || /inscri[çc][ãa]o\s+estadual/i.test(r.title || ''));
        const hasIM = rftItems.some((r: any) => r.requirement_id === 'RFT-IM' || /inscri[çc][ãa]o\s+municipal/i.test(r.title || ''));
        if (hasIE && hasIM) {
            // Remove generic combined IE+IM items ("estadual ou municipal" / "estadual e municipal")
            const beforeLen = rftItems.length;
            const dedupedRft = rftItems.filter((r: any) => {
                const title = (r.title || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                const isGenericCombined = (title.includes('estadual') && title.includes('municipal'))
                    && r.requirement_id !== 'RFT-IE' && r.requirement_id !== 'RFT-IM';
                return !isGenericCombined;
            });
            if (dedupedRft.length < beforeLen) {
                (extractionJson.requirements as any).regularidade_fiscal_trabalhista = dedupedRft;
                (v2Result.requirements as any).regularidade_fiscal_trabalhista = dedupedRft;
                console.log(`[PNCP-V2] 🧹 Dedup IE/IM: removido(s) ${beforeLen - dedupedRft.length} item(ns) genérico(s) (IE+IM separados existem)`);
            }
        }


        // ── HARD FAILURE GATE: Check extraction quality ──
        const extractedReqs = Object.values(extractionJson.requirements || {}).flat().length;
        const extractedEvidence = (extractionJson.evidence_registry || []).length;
        const hasProcessId = !!(extractionJson.process_identification?.objeto_resumido || extractionJson.process_identification?.objeto_completo);

        // Log detailed per-category extraction
        if (extractionJson.requirements) {
            const catCounts = Object.entries(extractionJson.requirements)
                .map(([cat, items]: [string, any]) => `${cat}: ${Array.isArray(items) ? items.length : 0}`)
                .join(' | ');
            console.log(`[PNCP-V2] 📋 Exigências por categoria: ${catCounts}`);
        }
        console.log(`[PNCP-V2] 📊 Extração: ${extractedReqs} exigências, ${extractedEvidence} evidências, processo=${hasProcessId}`);

        // Hard failure: Extraction returned materially empty content
        const MIN_REQUIREMENTS = 3;
        const MIN_EVIDENCE = 1;
        if (extractedReqs < MIN_REQUIREMENTS && extractedEvidence < MIN_EVIDENCE && !hasProcessId) {
            console.error(`[PNCP-V2] ❌ FALHA FACTUAL DURA: ${extractedReqs} exigências (mín: ${MIN_REQUIREMENTS}), ${extractedEvidence} evidências (mín: ${MIN_EVIDENCE}), sem identificação do processo`);
            v2Result.analysis_meta.workflow_stage_status.extraction = 'failed';
            const totalDuration = ((Date.now() - analysisStartTime) / 1000).toFixed(1);
            return res.status(422).json({
                error: 'Extração factual insuficiente',
                details: `A IA não conseguiu extrair dados suficientes dos ${pdfParts.length} documento(s). ` +
                    `Foram encontradas apenas ${extractedReqs} exigência(s) e ${extractedEvidence} evidência(s). ` +
                    `Isso pode indicar que os documentos estão escaneados com baixa qualidade, protegidos, ou em formato não-textual.`,
                diagnostics: {
                    pdfs_sent: pdfParts.length,
                    pdf_sizes: pdfSizes,
                    requirements_found: extractedReqs,
                    evidence_found: extractedEvidence,
                    has_process_id: hasProcessId,
                    parse_repaired: pipelineHealth.parseRepairs > 0,
                    time_seconds: parseFloat(totalDuration),
                    downloaded_files: downloadedFiles
                },
                _extraction_insufficient: true
            });
        }

        // Soft warning: Low quality extraction (still continues)
        if (extractedReqs < MIN_REQUIREMENTS || extractedEvidence < MIN_EVIDENCE) {
            console.warn(`[PNCP-V2] ⚠️ Extração abaixo do ideal: ${extractedReqs} exigências, ${extractedEvidence} evidências — pipeline continua com degradação`);
            v2Result.confidence.warnings.push(`Extração com qualidade reduzida: ${extractedReqs} exigências, ${extractedEvidence} evidências`);
            if (extractedReqs < MIN_REQUIREMENTS) {
                v2Result.confidence.warnings.push(`Extração retornou apenas ${extractedReqs} exigência(s) — possível truncamento ou PDF protegido`);
            }
        }

        // Domain Routing
        const detectedObjectType = v2Result.process_identification?.tipo_objeto || 'outro';
        const domainReinforcement = getDomainRoutingInstruction(detectedObjectType);
        if (domainReinforcement) {
            console.log(`[PNCP-V2] 🎯 Roteamento por tipo: ${detectedObjectType}`);
        }

        // ── CATEGORY GAP DETECTION + TARGETED RE-EXTRACTION ──
        // Detect if critical categories are missing (likely due to output truncation)
        const expectedCategories: Record<string, string[]> = {
            'obra_engenharia': ['qualificacao_tecnica_operacional', 'qualificacao_tecnica_profissional', 'qualificacao_economico_financeira', 'proposta_comercial'],
            'servico_comum_engenharia': ['qualificacao_tecnica_operacional', 'qualificacao_tecnica_profissional', 'qualificacao_economico_financeira', 'proposta_comercial'],
            'servico_comum': ['qualificacao_tecnica_operacional', 'qualificacao_economico_financeira', 'proposta_comercial'],
            'fornecimento': ['qualificacao_economico_financeira', 'proposta_comercial'],
            'outro': ['proposta_comercial'],
        };
        const objType = detectedObjectType || 'outro';
        const expected = expectedCategories[objType] || expectedCategories['outro'];
        const missingCategories = expected.filter(cat => {
            const items = Array.isArray((extractionJson.requirements as any)?.[cat]) ? (extractionJson.requirements as any)[cat] : [];
            return items.length === 0;
        });

        if (missingCategories.length > 0) {
            console.warn(`[PNCP-V2] 🔍 GAP DETECTADO: ${missingCategories.length} categorias vazias para ${objType}: ${missingCategories.join(', ')}`);
            console.log(`[PNCP-V2] ── Re-extração focada para categorias faltantes...`);

            const missingCatLabels: Record<string, string> = {
                'qualificacao_tecnica_operacional': 'Qualificação Técnica Operacional (atestados da empresa, parcelas relevantes, visita técnica)',
                'qualificacao_tecnica_profissional': 'Qualificação Técnica Profissional (RT, CAT, acervo técnico do profissional)',
                'qualificacao_economico_financeira': 'Qualificação Econômico-Financeira (balanço, índices, garantia, certidão falência)',
                'proposta_comercial': 'Proposta Comercial (envelope de preços, planilha, BDI, validade, formato)',
                'documentos_complementares': 'Documentos Complementares e Declarações (declarações, procurações, docs auxiliares)',
            };
            const catDescriptions = missingCategories.map(c => `- ${missingCatLabels[c] || c}`).join('\n');

            const reExtractionPrompt = `ATENÇÃO: a extração anterior capturou apenas ${extractedReqs} exigências e OMITIU categorias inteiras.
As seguintes categorias estão VAZIAS e precisam ser extraídas:
${catDescriptions}

Extraia APENAS as exigências dessas categorias faltantes. NÃO re-extraia habilitação jurídica ou regularidade fiscal (já capturadas).
Use o mesmo formato JSON de saída mas incluindo apenas as categorias listadas acima em "requirements".
Para QTO/QTP, transcreva LITERALMENTE cada parcela de maior relevância com quantitativos exatos.
Inclua evidence_registry com ao menos 1 evidência por exigência principal.

Retorne JSON com: { "requirements": { ... apenas categorias faltantes ... }, "evidence_registry": [...] }`;

            try {
                // Use only the first PDF (edital) for re-extraction — reduces context size
                const editalPdf = pdfParts[0];
                const reExtractionResponse = await callGeminiWithRetry(ai.models, {
                    model: PIPELINE_MODELS.reExtraction,
                    contents: [{
                        role: 'user',
                        parts: [
                            editalPdf,
                            { text: reExtractionPrompt }
                        ]
                    }],
                    config: {
                        systemInstruction: V2_EXTRACTION_PROMPT,
                        temperature: 0.05,
                        maxOutputTokens: 65536,
                        responseMimeType: 'application/json'
                    }
                });
                const reText = reExtractionResponse.text;
                if (reText) {
                    const reParseResult = robustJsonParseDetailed(reText, 'PNCP-V2-ReExtraction');
                    const reData = reParseResult.data;
                    if (reParseResult.repaired) pipelineHealth.parseRepairs++;

                    // Merge re-extracted categories into the main extraction
                    let reExtractedCount = 0;
                    if (reData.requirements) {
                        for (const [cat, items] of Object.entries(reData.requirements)) {
                            if (Array.isArray(items) && items.length > 0) {
                                const existing = Array.isArray((extractionJson.requirements as any)?.[cat]) ? (extractionJson.requirements as any)[cat] : [];
                                if (existing.length === 0) {
                                    (extractionJson.requirements as any)[cat] = items;
                                    (v2Result.requirements as any)[cat] = items;
                                    reExtractedCount += items.length;
                                    console.log(`[PNCP-V2] ✅ Re-extração ${cat}: +${items.length} itens`);
                                }
                            }
                        }
                    }
                    // Merge evidence_registry
                    if (reData.evidence_registry && Array.isArray(reData.evidence_registry)) {
                        extractionJson.evidence_registry = [
                            ...(extractionJson.evidence_registry || []),
                            ...reData.evidence_registry
                        ];
                        v2Result.evidence_registry = extractionJson.evidence_registry;
                    }

                    console.log(`[PNCP-V2] ✅ Re-extração concluída: +${reExtractedCount} exigências, +${(reData.evidence_registry || []).length} evidências`);
                }
            } catch (reErr: any) {
                console.warn(`[PNCP-V2] ⚠️ Re-extração falhou: ${reErr.message}. Continuando com dados parciais.`);
                v2Result.confidence.warnings.push(`Re-extração de categorias faltantes falhou: ${reErr.message}`);
            }
        }


        // ── Stages 2+3: Normalization + Risk Review (PARALLEL — text-only, no PDFs) ──
        console.log(`[PNCP-V2] ── Etapas 2+3/3: Normalização + Risco (paralelo)...`);
        let normalizationJson: any = {};
        const extractionJsonCompact = JSON.stringify(extractionJson);  // Compact — saves ~20-30% tokens
        const t2t3Start = Date.now();

        // Run both stages concurrently
        const [normSettled, riskSettled] = await Promise.allSettled([
            // ── Stage 2: Per-Category Normalization (7 parallel micro-calls) ──
            (async () => {
                const t2Start = Date.now();
                const mergedRequirements: Record<string, any[]> = {};
                const mergedDocs: any[] = [];
                let totalNormalized = 0;
                let categoriesFailed = 0;
                let categoriesSkipped = 0;
                let usedFallback = false;
                let hadRepair = false;

                // Build parallel tasks for categories that have items
                const categoryTasks = NORM_CATEGORIES.map(cat => {
                    const items = Array.isArray((extractionJson.requirements as any)?.[cat.key])
                        ? (extractionJson.requirements as any)[cat.key]
                        : [];

                    if (items.length === 0) {
                        mergedRequirements[cat.key] = [];
                        categoriesSkipped++;
                        return null; // Skip empty categories
                    }

                    // ── FAST-PATH: HJ, RFT, QEF — server-side normalization (no AI call) ──
                    const FAST_NORM_CATEGORIES = ['habilitacao_juridica', 'regularidade_fiscal_trabalhista', 'qualificacao_economico_financeira'];
                    if (FAST_NORM_CATEGORIES.includes(cat.key)) {
                        // Deterministic normalization — assign IDs, entry_type, risk_if_missing
                        const riskDefault = cat.key === 'habilitacao_juridica' ? 'inabilitacao'
                            : cat.key === 'regularidade_fiscal_trabalhista' ? 'inabilitacao'
                            : 'inabilitacao';
                        const normalized = items.map((item: any, idx: number) => ({
                            ...item,
                            requirement_id: item.requirement_id || `${cat.prefix}-${String(idx + 1).padStart(2, '0')}`,
                            entry_type: item.entry_type || 'exigencia_principal',
                            risk_if_missing: item.risk_if_missing || riskDefault,
                            applies_to: item.applies_to || 'licitante',
                            obligation_type: item.obligation_type || 'obrigatoria_universal',
                            phase: item.phase || 'habilitacao',
                            source_ref: item.source_ref || 'referência não localizada',
                        }));
                        mergedRequirements[cat.key] = normalized;
                        totalNormalized += normalized.length;
                        // Generate documents_to_prepare
                        normalized.filter((n: any) => n.entry_type === 'exigencia_principal').forEach((n: any) => {
                            mergedDocs.push({
                                document_name: n.title || n.requirement_id,
                                category: cat.key,
                                priority: n.risk_if_missing === 'inabilitacao' ? 'critica' : 'alta',
                                responsible_area: cat.key === 'regularidade_fiscal_trabalhista' ? 'contabil'
                                    : cat.key === 'qualificacao_economico_financeira' ? 'contabil'
                                    : 'juridico',
                                notes: ''
                            });
                        });
                        console.log(`[PNCP-V2] ⚡ FastNorm ${cat.prefix}: ${normalized.length} itens (server-side, 0 API calls)`);
                        return { cat: cat.key, success: true, fastPath: true };
                    }

                    // ── AI NORMALIZATION: QTO, QTP, PC, DC (interpretation needed) ──
                    // QTP uses full Flash model for Rule 18 (CAT explosion) reliability
                    const normModel = cat.key === 'qualificacao_tecnica_profissional'
                        ? PIPELINE_MODELS.normQtp
                        : PIPELINE_MODELS.normalization;
                    return (async () => {
                        const systemPrompt = buildCategoryNormPrompt(cat);
                        const userPrompt = buildCategoryNormUser(cat, items);

                        try {
                            const resp = await callGeminiWithRetry(ai.models, {
                                model: normModel,
                                contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
                                config: {
                                    systemInstruction: systemPrompt,
                                    temperature: 0.1,
                                    maxOutputTokens: 16384,
                                    responseMimeType: 'application/json'
                                }
                            }, 1);

                            const text = resp.text;
                            if (!text) throw new Error(`${cat.prefix} retornou vazio`);
                            const parsed = robustJsonParseDetailed(text, `Norm-${cat.prefix}`);
                            if (parsed.repaired) hadRepair = true;
                            const data = parsed.data;

                            // Validate block schema
                            if (Array.isArray(data.items) && data.items.length > 0) {
                                mergedRequirements[cat.key] = data.items;
                                totalNormalized += data.items.length;
                            } else {
                                // Response valid but no items — keep originals
                                mergedRequirements[cat.key] = items;
                                totalNormalized += items.length;
                            }
                            if (Array.isArray(data.documents_to_prepare)) {
                                mergedDocs.push(...data.documents_to_prepare);
                            }
                            console.log(`[PNCP-V2] ✅ Norm ${cat.prefix}: ${(data.items || []).length} itens (${normModel})`);
                            return { cat: cat.key, success: true };
                        } catch (geminiErr: any) {
                            // Per-block fallback to OpenAI
                            console.warn(`[PNCP-V2] ⚠️ Norm ${cat.prefix} Gemini falhou: ${geminiErr.message}. Fallback OpenAI...`);
                            usedFallback = true;
                            try {
                                const oaiResult = await fallbackToOpenAiV2({
                                    systemPrompt,
                                    userPrompt,
                                    temperature: 0.1,
                                    stageName: `Norm-${cat.prefix}`
                                });
                                if (!oaiResult.text) throw new Error('OpenAI vazio');
                                const parsed = robustJsonParseDetailed(oaiResult.text, `Norm-${cat.prefix}-OAI`);
                                if (parsed.repaired) hadRepair = true;
                                const data = parsed.data;
                                if (Array.isArray(data.items) && data.items.length > 0) {
                                    mergedRequirements[cat.key] = data.items;
                                    totalNormalized += data.items.length;
                                } else {
                                    mergedRequirements[cat.key] = items;
                                    totalNormalized += items.length;
                                }
                                if (Array.isArray(data.documents_to_prepare)) {
                                    mergedDocs.push(...data.documents_to_prepare);
                                }
                                console.log(`[PNCP-V2] ✅ Norm ${cat.prefix} via OpenAI: ${(data.items || []).length} itens`);
                                return { cat: cat.key, success: true, fallback: true };
                            } catch (oaiErr: any) {
                                // Both failed — keep original extraction data
                                console.error(`[PNCP-V2] ❌ Norm ${cat.prefix} falhou (ambos): ${oaiErr.message}`);
                                mergedRequirements[cat.key] = items;
                                totalNormalized += items.length;
                                categoriesFailed++;
                                return { cat: cat.key, success: false };
                            }
                        }
                    })();
                }).filter(Boolean);

                // Execute all categories in parallel
                const results = await Promise.allSettled(categoryTasks as Promise<any>[]);

                stageTimes.normalization = (Date.now() - t2Start) / 1000;
                const successCount = results.filter(r => r.status === 'fulfilled' && r.value?.success).length;
                const fastPathCount = results.filter(r => r.status === 'fulfilled' && r.value?.fastPath).length;
                const aiNormCount = successCount - fastPathCount;
                console.log(`[PNCP-V2] ✅ Etapa 2 em ${stageTimes.normalization.toFixed(1)}s — ${totalNormalized} itens normalizados, ${successCount}/${NORM_CATEGORIES.length - categoriesSkipped} OK (⚡${fastPathCount} fast + 🤖${aiNormCount} AI), ${categoriesFailed} falhas`);

                // Build merged normalization result
                const json = {
                    requirements_normalized: mergedRequirements,
                    operational_outputs: {
                        documents_to_prepare: mergedDocs,
                    },
                    confidence: {
                        overall_confidence: categoriesFailed > 2 ? 'baixa' : categoriesFailed > 0 ? 'media' : 'alta',
                        section_confidence: {} as any,
                        warnings: categoriesFailed > 0 ? [`${categoriesFailed} categoria(s) não normalizada(s) — dados originais preservados`] : [],
                    }
                };

                return { json, model: PIPELINE_MODELS.normalization, repaired: hadRepair, fallback: usedFallback };
            })(),

            // ── Stage 3: Risk Review ──
            (async () => {
                const t3Start = Date.now();
                const riskUserInstruction = V2_RISK_REVIEW_USER_INSTRUCTION
                    .replace('{extractionJson}', extractionJsonCompact)
                    .replace('{normalizationJson}', '{}')  // Norm not yet available in parallel, use empty
                    + (domainReinforcement ? `\n\n${domainReinforcement}` : '');
                try {
                    const riskResponse = await callGeminiWithRetry(ai.models, {
                        model: PIPELINE_MODELS.riskReview,
                        contents: [{ role: 'user', parts: [{ text: riskUserInstruction }] }],
                        config: {
                            systemInstruction: V2_RISK_REVIEW_PROMPT,
                            temperature: 0.2,
                            maxOutputTokens: 16384,
                            responseMimeType: 'application/json'
                        }
                    }, 2);
                    const riskText = riskResponse.text;
                    if (!riskText) throw new Error('Etapa 3 retornou vazio');
                    const parseR = robustJsonParseDetailed(riskText, 'PNCP-V2-RiskReview');
                    const json = parseR.data;
                    stageTimes.risk_review = (Date.now() - t3Start) / 1000;
                    console.log(`[PNCP-V2] ✅ Etapa 3 em ${stageTimes.risk_review.toFixed(1)}s — ${(json.legal_risk_review?.critical_points || []).length} pontos críticos`);
                    return { json, model: PIPELINE_MODELS.riskReview, repaired: parseR.repaired, fallback: false };
                } catch (err: any) {
                    console.warn(`[PNCP-V2] ⚠️ Etapa 3 Gemini falhou: ${err.message}. Tentando OpenAI...`);
                    const openAiResult = await fallbackToOpenAiV2({
                        systemPrompt: V2_RISK_REVIEW_PROMPT,
                        userPrompt: riskUserInstruction,
                        temperature: 0.2,
                        stageName: 'PNCP Etapa 3 (Risco)'
                    });
                    if (!openAiResult.text) throw new Error('OpenAI retornou vazio');
                    const parseROai = robustJsonParseDetailed(openAiResult.text, 'PNCP-V2-RiskReview-OpenAI');
                    const json = parseROai.data;
                    stageTimes.risk_review = (Date.now() - t3Start) / 1000;
                    console.log(`[PNCP-V2] ✅ Etapa 3 via OpenAI em ${stageTimes.risk_review.toFixed(1)}s`);
                    return { json, model: openAiResult.model, repaired: parseROai.repaired, fallback: true };
                }
            })()
        ]);

        console.log(`[PNCP-V2] Etapas 2+3 paralelas concluídas em ${((Date.now() - t2t3Start) / 1000).toFixed(1)}s`);

        // Process normalization result
        if (normSettled.status === 'fulfilled') {
            normalizationJson = normSettled.value.json;
            v2Result.analysis_meta.workflow_stage_status.normalization = 'done';
            modelsUsed.push(normSettled.value.model);
            if (normSettled.value.repaired) pipelineHealth.parseRepairs++;
            if (normSettled.value.fallback) pipelineHealth.fallbacksUsed++;
        } else {
            console.error(`[PNCP-V2] ❌ Etapa 2 falhou — continuando sem normalização`);
            v2Result.analysis_meta.workflow_stage_status.normalization = 'failed';
            v2Result.confidence.warnings.push(`Etapa 2 (Normalização) falhou: ${normSettled.reason?.message || 'erro desconhecido'}`);
            stageTimes.normalization = stageTimes.normalization || 0;
        }

        // Merge normalization
        if (normalizationJson.requirements_normalized) {
            v2Result.requirements = normalizationJson.requirements_normalized;
        }
        if (normalizationJson.operational_outputs) {
            v2Result.operational_outputs = { ...v2Result.operational_outputs, ...normalizationJson.operational_outputs };
        }
        if (normalizationJson.confidence) {
            v2Result.confidence = { ...v2Result.confidence, ...normalizationJson.confidence };
        }

        // Process risk review result
        if (riskSettled.status === 'fulfilled') {
            const riskJson = riskSettled.value.json;
            v2Result.analysis_meta.workflow_stage_status.risk_review = 'done';
            modelsUsed.push(riskSettled.value.model);
            if (riskSettled.value.repaired) pipelineHealth.parseRepairs++;
            if (riskSettled.value.fallback) pipelineHealth.fallbacksUsed++;
            if (riskJson.legal_risk_review) v2Result.legal_risk_review = riskJson.legal_risk_review;
            if (riskJson.operational_outputs_risk) {
                if (riskJson.operational_outputs_risk.questions_for_consultor_chat) {
                    v2Result.operational_outputs.questions_for_consultor_chat = riskJson.operational_outputs_risk.questions_for_consultor_chat;
                }
                if (riskJson.operational_outputs_risk.possible_petition_routes) {
                    v2Result.operational_outputs.possible_petition_routes = riskJson.operational_outputs_risk.possible_petition_routes;
                }
            }
            if (riskJson.confidence_update) {
                v2Result.confidence.section_confidence.risk_review = riskJson.confidence_update.risk_review || 'media';
            }
        } else {
            console.error(`[PNCP-V2] ❌ Etapa 3 falhou — continuando sem revisão de risco`);
            v2Result.analysis_meta.workflow_stage_status.risk_review = 'failed';
            v2Result.confidence.warnings.push(`Etapa 3 (Risco) falhou: ${riskSettled.reason?.message || 'erro desconhecido'}`);
            stageTimes.risk_review = stageTimes.risk_review || 0;
        }

        // ── Schema Sanitization: Safe defaults for all arrays/collections ──
        // Prevents "Cannot read properties of undefined (reading 'length')" crashes
        const reqCategories = ['habilitacao_juridica', 'regularidade_fiscal_trabalhista', 'qualificacao_economico_financeira',
            'qualificacao_tecnica_operacional', 'qualificacao_tecnica_profissional', 'proposta_comercial', 'documentos_complementares'];
        if (!v2Result.requirements) v2Result.requirements = {} as any;
        for (const cat of reqCategories) {
            if (!Array.isArray((v2Result.requirements as any)[cat])) {
                (v2Result.requirements as any)[cat] = [];
            }
        }
        if (!Array.isArray(v2Result.evidence_registry)) v2Result.evidence_registry = [];
        if (!v2Result.legal_risk_review) v2Result.legal_risk_review = { critical_points: [], ambiguities: [], inconsistencies: [], omissions: [], possible_restrictive_clauses: [], points_for_impugnation_or_clarification: [] } as any;
        if (!Array.isArray(v2Result.legal_risk_review.critical_points)) v2Result.legal_risk_review.critical_points = [];
        if (!v2Result.operational_outputs) v2Result.operational_outputs = { documents_to_prepare: [], internal_checklist: [], questions_for_consultor_chat: [], possible_petition_routes: [] } as any;
        if (!v2Result.confidence) v2Result.confidence = { overall_confidence: 'baixa', section_confidence: {} as any, warnings: [] } as any;
        if (!Array.isArray(v2Result.confidence.warnings)) v2Result.confidence.warnings = [];
        if (!v2Result.economic_financial_analysis) v2Result.economic_financial_analysis = { indices_exigidos: [] } as any;
        if (!Array.isArray(v2Result.economic_financial_analysis.indices_exigidos)) v2Result.economic_financial_analysis.indices_exigidos = [];
        if (!v2Result.technical_analysis) v2Result.technical_analysis = { parcelas_relevantes: [] } as any;
        if (!Array.isArray(v2Result.technical_analysis.parcelas_relevantes)) v2Result.technical_analysis.parcelas_relevantes = [];

        // Record discarded files in analysis metadata
        if (discardedFiles.length > 0) {
            (v2Result.analysis_meta as any).discarded_files = discardedFiles;
            v2Result.confidence.warnings.push(`${discardedFiles.length} anexo(s) ignorado(s) por limite de tamanho: ${discardedFiles.join(', ')}`);
        }

        // ── Validation (no AI) ──
        const validation = validateAnalysisCompleteness(v2Result);
        v2Result.analysis_meta.workflow_stage_status.validation = validation.valid ? 'done' : 'failed';
        if (validation.issues.length > 0) {
            v2Result.confidence.warnings.push(...validation.issues);
        }

        // ── Risk Rules Engine ──
        let ruleFindings: any[] = [];
        try {
            ruleFindings = executeRiskRules(v2Result);
            if (ruleFindings.length > 0) {
                (v2Result.analysis_meta as any).rule_findings = ruleFindings;
            }
        } catch (ruleErr: any) {
            console.warn(`[PNCP-V2] Motor de regras falhou: ${ruleErr.message}`);
        }

        // ── Quality Evaluator ──
        let qualityReport: any = null;
        try {
            qualityReport = evaluateAnalysisQuality(v2Result, ruleFindings, v2Result.analysis_meta.analysis_id);
            (v2Result.analysis_meta as any).quality_report = {
                overallScore: qualityReport.overallScore,
                categoryScores: qualityReport.categoryScores,
                issueCount: qualityReport.issues.length,
                summary: qualityReport.summary
            };
        } catch (qualErr: any) {
            console.warn(`[PNCP-V2] Avaliador de qualidade falhou: ${qualErr.message}`);
        }

        // ── Confidence Score (honest — penalizes repairs, fallbacks, missing traceability) ──
        const stagesDone = Object.values(v2Result.analysis_meta.workflow_stage_status).filter(s => s === 'done').length;
        const stageScore = (stagesDone / 4) * 100;
        const qualityScore = qualityReport?.overallScore || 50;
        let combinedScore = Math.round((stageScore * 0.25) + (validation.confidence_score * 0.30) + (qualityScore * 0.30));

        // Traceability assessment: count requirements with valid source_ref
        const evidenceCount = v2Result.evidence_registry?.length || 0;
        const allReqArrays = Object.values(v2Result.requirements || {}).flat() as any[];
        // Use same base (principals only) for both numerator and denominator
        const principalReqs = allReqArrays.filter((r: any) => !r.entry_type || r.entry_type === 'exigencia_principal');
        const requirementCount = principalReqs.length;
        const tracedCount = principalReqs.filter((r: any) => r.source_ref && r.source_ref !== 'referência não localizada' && r.source_ref.trim() !== '').length;
        const traceabilityRatio = requirementCount > 0 ? tracedCount / requirementCount : 0;

        // Traceability penalty: if many requirements lack source_ref, penalize
        if (traceabilityRatio < 0.5 && requirementCount > 5) {
            combinedScore -= 15;
            v2Result.confidence.warnings.push(`Apenas ${Math.round(traceabilityRatio * 100)}% das exigências têm referência documental — rastreabilidade comprometida`);
        } else if (traceabilityRatio < 0.8 && requirementCount > 5) {
            combinedScore -= 5;
            v2Result.confidence.warnings.push(`${Math.round(traceabilityRatio * 100)}% das exigências têm referência documental`);
        }

        // Evidence registry penalty (secondary — source_ref is primary traceability)
        if (evidenceCount === 0 && requirementCount > 5 && traceabilityRatio < 0.8) {
            combinedScore -= 10;
            v2Result.confidence.warnings.push(`0 evidências no registro com ${requirementCount} exigências`);
        }

        // Parse repair penalty: each repair indicates fragile response
        if (pipelineHealth.parseRepairs > 0) {
            const repairPenalty = Math.min(pipelineHealth.parseRepairs * 5, 15);
            combinedScore -= repairPenalty;
            v2Result.confidence.warnings.push(`${pipelineHealth.parseRepairs} reparos de JSON foram necessários`);
        }

        // Fallback penalty: each fallback indicates primary model failure
        if (pipelineHealth.fallbacksUsed > 0) {
            const fallbackPenalty = Math.min(pipelineHealth.fallbacksUsed * 8, 20);
            combinedScore -= fallbackPenalty;
            v2Result.confidence.warnings.push(`${pipelineHealth.fallbacksUsed} fallback(s) para OpenAI acionado(s)`);
        }

        // Stage failure penalty
        const stagesFailed = Object.values(v2Result.analysis_meta.workflow_stage_status).filter(s => s === 'failed').length;
        if (stagesFailed > 0) {
            combinedScore -= stagesFailed * 12;
        }

        combinedScore = Math.max(5, Math.min(100, combinedScore));

        // Confidence level: 'alta' requires both good score AND good traceability
        if (combinedScore >= 75 && pipelineHealth.fallbacksUsed === 0 && pipelineHealth.parseRepairs === 0 && traceabilityRatio >= 0.8) {
            v2Result.confidence.overall_confidence = 'alta';
        } else if (combinedScore >= 50) {
            v2Result.confidence.overall_confidence = 'media';
        } else {
            v2Result.confidence.overall_confidence = 'baixa';
        }
        (v2Result.confidence as any).score_percentage = combinedScore;
        (v2Result.confidence as any).pipeline_health = pipelineHealth;
        (v2Result.confidence as any).traceability = {
            total_requirements: requirementCount,
            traced_requirements: tracedCount,
            traceability_percentage: Math.round(traceabilityRatio * 100),
            evidence_registry_count: evidenceCount,
        };

        const uniqueModels = [...new Set(modelsUsed)];
        v2Result.analysis_meta.model_used = uniqueModels.join('+');
        (v2Result.analysis_meta as any).prompt_version = V2_PROMPT_VERSION;
        (v2Result.analysis_meta as any).models_per_stage = {
            extraction: modelsUsed[0] || 'failed',
            normalization: modelsUsed[1] || 'failed',
            risk_review: modelsUsed[2] || 'failed'
        };
        (v2Result.analysis_meta as any).stage_times = stageTimes;

        const totalDuration = ((Date.now() - analysisStartTime) / 1000).toFixed(1);
        const totalReqs = Object.values(v2Result.requirements).reduce((sum, arr) => sum + arr.length, 0);
        console.log(`[PNCP-V2] ═══ PIPELINE CONCLUÍDO ═══ ${totalDuration}s total | ` +
            `Modelos: ${uniqueModels.join('+')} | ` +
            `${totalReqs} exigências | ${v2Result.legal_risk_review.critical_points.length} riscos | ` +
            `${v2Result.evidence_registry.length} evidências | Score: ${combinedScore}% (${v2Result.confidence.overall_confidence})`);

        // ── Legacy V1 Compatibility ──
        // Build process/analysis format expected by frontend
        const allReqs = Object.entries(v2Result.requirements).reduce((acc: Record<string, any[]>, [cat, items]) => {
            acc[cat] = items.map((r: any) => ({ item: r.requirement_id, description: `${r.title}: ${r.description}` }));
            return acc;
        }, {} as Record<string, any[]>);

        const legacyProcess = {
            title: v2Result.process_identification.numero_edital
                ? `${v2Result.process_identification.modalidade} ${v2Result.process_identification.numero_edital} - ${v2Result.process_identification.orgao}`
                : v2Result.process_identification.objeto_resumido || '',
            summary: `${v2Result.process_identification.objeto_completo || v2Result.process_identification.objeto_resumido || ''}\n\n` +
                `Modalidade: ${v2Result.process_identification.modalidade || ''}\n` +
                `Critério: ${v2Result.process_identification.criterio_julgamento || ''}\n` +
                `Regime: ${v2Result.process_identification.regime_execucao || ''}\n` +
                `Município: ${v2Result.process_identification.municipio_uf || ''}\n` +
                `Sessão: ${v2Result.timeline.data_sessao || ''}\n` +
                (v2Result.participation_conditions.exige_visita_tecnica ? `Visita Técnica: ${v2Result.participation_conditions.visita_tecnica_detalhes}\n` : '') +
                (v2Result.participation_conditions.exige_garantia_proposta ? `Garantia de Proposta: ${v2Result.participation_conditions.garantia_proposta_detalhes}\n` : '') +
                (v2Result.participation_conditions.exige_garantia_contratual ? `Garantia Contratual: ${v2Result.participation_conditions.garantia_contratual_detalhes}\n` : '') +
                `\n--- RISCOS CRÍTICOS (${v2Result.legal_risk_review.critical_points.length}) ---\n` +
                v2Result.legal_risk_review.critical_points.map(cp =>
                    `[${(cp.severity || '').toUpperCase()}] ${cp.title}: ${cp.description} → ${cp.recommended_action}`
                ).join('\n'),
            modality: v2Result.process_identification.modalidade || '',
            portal: v2Result.process_identification.fonte_oficial || 'PNCP',
            estimatedValue: 0,
            risk: v2Result.legal_risk_review.critical_points.some(cp => cp.severity === 'critica') ? 'Crítico'
                : v2Result.legal_risk_review.critical_points.some(cp => cp.severity === 'alta') ? 'Alto'
                : v2Result.legal_risk_review.critical_points.length > 0 ? 'Médio' : 'Baixo',
            sessionDate: v2Result.timeline.data_sessao || ''
        };

        const legacyAnalysis = {
            requiredDocuments: allReqs,
            pricingConsiderations: v2Result.economic_financial_analysis.indices_exigidos
                .map(i => `${i.indice}: ${i.formula_ou_descricao} (mín: ${i.valor_minimo})`).join('\n')
                + (v2Result.contractual_analysis.medicao_pagamento ? `\nPagamento: ${v2Result.contractual_analysis.medicao_pagamento}` : '')
                + (v2Result.contractual_analysis.reajuste ? `\nReajuste: ${v2Result.contractual_analysis.reajuste}` : ''),
            irregularitiesFlags: v2Result.legal_risk_review.critical_points.map(cp => `[${(cp.severity || '').toUpperCase()}] ${cp.title}: ${cp.description}`),
            fullSummary: `ANÁLISE V2 PIPELINE — ${v2Result.process_identification.objeto_resumido || ''}\n\n` +
                `Objeto: ${v2Result.process_identification.objeto_completo || ''}\n` +
                `Órgão: ${v2Result.process_identification.orgao || ''}\n` +
                `Sessão: ${v2Result.timeline.data_sessao || ''}\n\n` +
                `--- CONDIÇÕES ---\n` +
                `Consórcio: ${v2Result.participation_conditions.permite_consorcio ?? 'Não informado'}\n` +
                `Subcontratação: ${v2Result.participation_conditions.permite_subcontratacao ?? 'Não informado'}\n` +
                `Visita Técnica: ${v2Result.participation_conditions.exige_visita_tecnica ?? 'Não informado'}\n\n` +
                `--- PENALIDADES ---\n` +
                (v2Result.contractual_analysis.penalidades || []).join('\n') +
                `\n\n--- RISCOS (${v2Result.legal_risk_review.critical_points.length}) ---\n` +
                v2Result.legal_risk_review.critical_points.map(cp =>
                    `[${(cp.severity || '').toUpperCase()}] ${cp.title}: ${cp.description} → ${cp.recommended_action}`
                ).join('\n'),
            deadlines: [
                v2Result.timeline.data_sessao ? `${v2Result.timeline.data_sessao} - Sessão Pública` : '',
                v2Result.timeline.prazo_impugnacao ? `${v2Result.timeline.prazo_impugnacao} - Impugnação` : '',
                v2Result.timeline.prazo_esclarecimento ? `${v2Result.timeline.prazo_esclarecimento} - Esclarecimento` : '',
                v2Result.timeline.prazo_envio_proposta ? `${v2Result.timeline.prazo_envio_proposta} - Envio de Proposta` : '',
                v2Result.contractual_analysis.prazo_execucao ? `Prazo de Execução: ${v2Result.contractual_analysis.prazo_execucao}` : '',
                v2Result.contractual_analysis.prazo_vigencia ? `Vigência: ${v2Result.contractual_analysis.prazo_vigencia}` : '',
                ...(v2Result.timeline.outros_prazos || []).map(p => `${p.data || ''} - ${p.descricao || ''}`)
            ].filter(Boolean),
            penalties: (v2Result.contractual_analysis.penalidades || []).join('\n'),
            qualificationRequirements: Object.values(v2Result.requirements)
                .flat()
                .map(r => `[${r.requirement_id}] ${r.title}: ${r.description}`)
                .join('\n'),
            biddingItems: (v2Result.proposal_analysis.observacoes_proposta || []).join('\n')
        };

        // Embed pncpSource inside schemaV2 so it's persisted in the DB
        (v2Result as any).pncp_source = {
            link_sistema,
            downloaded_files: downloadedFiles,
            discarded_files: discardedFiles,
            attachments: pncpAttachments,
            analyzed_at: new Date().toISOString()
        };

        // Build final response with both V1 compat and V2 schema
        const finalPayload = {
            process: legacyProcess,
            analysis: legacyAnalysis,
            schemaV2: v2Result,
            pncpSource: {
                link_sistema,
                downloadedFiles,
                discardedFiles,
                attachments: pncpAttachments,  // Full catalog with URLs for proposal module
                analyzedAt: new Date().toISOString()
            },
            _version: '2.0',
            _pipeline_duration_s: parseFloat(totalDuration),
            _prompt_version: V2_PROMPT_VERSION,
            _model_used: uniqueModels.join('+'),
            _overall_confidence: v2Result.confidence.overall_confidence,
            _stage_times: stageTimes,
            _quality_score: qualityReport?.overallScore || null,
            _evidence_count: v2Result.evidence_registry.length,
            _risk_count: v2Result.legal_risk_review.critical_points.length,
            _requirement_count: totalReqs
        };

        console.log(`[PNCP-V2] SUCCESS — Score: ${combinedScore}% | ${totalReqs} exigências | ${v2Result.evidence_registry.length} evidências`);
        res.json(finalPayload);

    } catch (error: any) {
        console.error('[PNCP-V2] Error:', error?.message || error);
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

        // V2 fields — persist structured schema and metadata
        const v2Fields: any = {};
        if (payload.schemaV2 && typeof payload.schemaV2 === 'object') {
            v2Fields.schemaV2 = payload.schemaV2;
        }
        if (payload.promptVersion) v2Fields.promptVersion = payload.promptVersion;
        if (payload.modelUsed) v2Fields.modelUsed = payload.modelUsed;
        if (payload.pipelineDurationS !== undefined) v2Fields.pipelineDurationS = parseFloat(payload.pipelineDurationS);
        if (payload.overallConfidence) v2Fields.overallConfidence = payload.overallConfidence;

        // Remove V2 fields from payload to avoid Prisma unknown field error
        delete payload.schemaV2;
        delete payload.promptVersion;
        delete payload.modelUsed;
        delete payload.pipelineDurationS;
        delete payload.overallConfidence;

        const mergedPayload = { ...payload, ...v2Fields };

        console.log(`[Analysis] Upserting analysis for process ${mergedPayload.biddingProcessId}. Payload summary length: ${mergedPayload.fullSummary?.length || 0}. Files: ${mergedPayload.sourceFileNames}. V2: ${!!v2Fields.schemaV2}`);

        const analysis = await prisma.aiAnalysis.upsert({
            where: {
                biddingProcessId: mergedPayload.biddingProcessId
            },
            create: mergedPayload,
            update: mergedPayload
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

// GET structured analysis for a process (frontend consumption)
app.get('/api/analysis/:processId', authenticateToken, async (req: any, res) => {
    try {
        const { processId } = req.params;
        const tenantId = req.user.tenantId;

        // Verify process ownership
        const process = await prisma.biddingProcess.findUnique({
            where: { id: processId, tenantId }
        });
        if (!process) {
            return res.status(404).json({ error: 'Processo não encontrado' });
        }

        const analysis = await prisma.aiAnalysis.findUnique({
            where: { biddingProcessId: processId }
        });

        if (!analysis) {
            return res.status(404).json({ error: 'Análise não encontrada para este processo' });
        }

        res.json({
            id: analysis.id,
            biddingProcessId: analysis.biddingProcessId,
            schemaV2: analysis.schemaV2 || null,
            promptVersion: analysis.promptVersion || null,
            modelUsed: analysis.modelUsed || null,
            pipelineDurationS: analysis.pipelineDurationS || null,
            overallConfidence: analysis.overallConfidence || null,
            analyzedAt: analysis.analyzedAt,
            hasV2: !!analysis.schemaV2,
            // Legacy fields for backward compatibility
            fullSummary: analysis.fullSummary,
            qualificationRequirements: analysis.qualificationRequirements,
            biddingItems: analysis.biddingItems,
        });
    } catch (error: any) {
        console.error("Get analysis error:", error);
        res.status(500).json({ error: 'Failed to fetch analysis' });
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

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
        const ai = new GoogleGenAI({ apiKey });

        const biddingItems = bidding.aiAnalysis.biddingItems || '';
        const pricingInfo = bidding.aiAnalysis.pricingConsiderations || '';
        const schemaV2 = bidding.aiAnalysis.schemaV2 as any;

        // ── Strategy 1: Legacy biddingItems (text-based, from older analyses) ──
        if (biddingItems && biddingItems.trim().length >= 10) {
            console.log(`[AI Populate] Using legacy biddingItems (${biddingItems.length} chars)`);

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

            const result = await callGeminiWithRetry(ai.models, {
                model: 'gemini-2.5-flash',
                contents: prompt,
                config: { temperature: 0.05, maxOutputTokens: 8192 },
            });

            const responseText = result.text?.trim() || '';
            let jsonStr = responseText;
            const jsonMatch = responseText.match(/\[[\s\S]*\]/);
            if (jsonMatch) jsonStr = jsonMatch[0];

            let items: any[];
            try { items = JSON.parse(jsonStr); }
            catch { return res.status(500).json({ error: 'AI returned invalid format', raw: responseText.substring(0, 200) }); }

            console.log(`[AI Populate] Extracted ${items.length} items (legacy mode)`);
            return res.json({ items, totalItems: items.length, source: 'legacy_biddingItems' });
        }

        // ── Strategy 2: Download planilhas from PNCP catalog (new analyses) ──
        const pncpSource = schemaV2?.pncp_source;
        const attachments = pncpSource?.attachments || [];
        
        // Find planilha/orçamento files in the catalog
        const planilhaFiles = attachments.filter((a: any) => 
            a.ativo && a.url && (
                a.purpose === 'planilha_orcamentaria' || 
                a.purpose === 'composicao_custos' ||
                a.purpose === 'bdi_encargos' ||
                // Also try generic annexes that might contain budget data
                (a.purpose === 'anexo_geral' && !a.downloaded)
            )
        );

        if (planilhaFiles.length === 0) {
            return res.status(400).json({ 
                error: 'Nenhuma planilha orçamentária encontrada. Este processo não possui itens de orçamento no edital nem planilhas anexas no PNCP.',
                hint: 'Para obras de engenharia, as planilhas geralmente estão nos Anexos do edital.',
                attachments_found: attachments.length,
                attachments_purposes: [...new Set(attachments.map((a: any) => a.purpose))]
            });
        }

        console.log(`[AI Populate] Found ${planilhaFiles.length} planilha candidates in PNCP catalog`);

        // Download planilha PDFs on demand
        const pdfParts: any[] = [];
        const downloadedNames: string[] = [];
        const agent = new (require('https').Agent)({ rejectUnauthorized: false });

        for (const pf of planilhaFiles.slice(0, 5)) { // Max 5 files
            try {
                console.log(`[AI Populate] Downloading: "${pf.titulo}" (${pf.purpose}) from ${pf.url}`);
                const fileRes = await axios.get(pf.url, {
                    httpsAgent: agent,
                    timeout: 60000,
                    responseType: 'arraybuffer',
                    maxRedirects: 5
                } as any);

                const buffer = Buffer.from(fileRes.data as ArrayBuffer);
                if (buffer.length === 0) continue;

                // Check if PDF
                const isPdf = buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46;
                if (isPdf) {
                    pdfParts.push({
                        inlineData: { data: buffer.toString('base64'), mimeType: 'application/pdf' }
                    });
                    downloadedNames.push(pf.titulo);
                    console.log(`[AI Populate] ✅ PDF: ${pf.titulo} (${(buffer.length / 1024).toFixed(0)} KB)`);
                } else {
                    console.log(`[AI Populate] ⚠️ Not a PDF: ${pf.titulo} — skipping`);
                }
            } catch (err: any) {
                console.warn(`[AI Populate] ⚠️ Failed to download ${pf.titulo}: ${err.message}`);
            }
        }

        if (pdfParts.length === 0) {
            return res.status(400).json({ 
                error: 'Não foi possível baixar nenhuma planilha do PNCP. Tente novamente ou adicione a planilha manualmente.',
                attempted: planilhaFiles.map((p: any) => p.titulo)
            });
        }

        // Extract items from planilha PDFs using Gemini multimodal
        const extractPrompt = `Você é um especialista em licitações brasileiras de obras e serviços de engenharia.
Analise a(s) planilha(s) orçamentária(s) abaixo e extraia TODOS os itens/serviços com seus dados.

REGRAS:
1. Extraia CADA serviço/item individualmente — NÃO agrupe
2. Para cada item identifique: número, descrição técnica COMPLETA, unidade de medida, quantidade, preço unitário de referência
3. Mantenha a hierarquia: Grupo/Subgrupo (se houver) como prefixo na descrição
4. NÃO inclua subtotais, totais gerais, BDI ou encargos como itens — apenas serviços
5. Se a quantidade ou unidade não estiver clara, use quantidade=1 e unidade="UN"
6. Para valores monetários, use ponto como separador decimal (ex: 1234.56)
7. Multiplier = 1 para itens de obra (não há recorrência mensal)

${pricingInfo ? `INFORMAÇÕES ADICIONAIS DE PREÇO:\n${pricingInfo}\n` : ''}

Responda APENAS com um JSON array válido:
[{"itemNumber":"1.1","description":"Descrição completa do serviço incluindo grupo","unit":"M²","quantity":100,"multiplier":1,"multiplierLabel":"","referencePrice":45.67}]`;

        console.log(`[AI Populate] Sending ${pdfParts.length} PDFs to Gemini for item extraction...`);
        const result = await callGeminiWithRetry(ai.models, {
            model: 'gemini-2.5-flash',
            contents: [{
                role: 'user',
                parts: [
                    ...pdfParts,
                    { text: extractPrompt }
                ]
            }],
            config: { 
                temperature: 0.05, 
                maxOutputTokens: 65536,
                responseMimeType: 'application/json'
            }
        });

        const responseText = result.text?.trim() || '';
        console.log(`[AI Populate] Response length: ${responseText.length} chars (first 300): ${responseText.substring(0, 300)}`);

        let items: any[];
        try {
            const parsed = JSON.parse(responseText);
            items = Array.isArray(parsed) ? parsed : (parsed.items || parsed.data || []);
        } catch {
            // Try regex extract
            const jsonMatch = responseText.match(/\[[\s\S]*\]/);
            if (jsonMatch) {
                try { items = JSON.parse(jsonMatch[0]); }
                catch { return res.status(500).json({ error: 'AI returned invalid JSON from planilha', raw: responseText.substring(0, 300) }); }
            } else {
                return res.status(500).json({ error: 'AI returned no extractable data from planilha' });
            }
        }

        console.log(`[AI Populate] ✅ Extracted ${items.length} items from ${downloadedNames.length} planilha(s): ${downloadedNames.join(', ')}`);
        res.json({ 
            items, 
            totalItems: items.length, 
            source: 'pncp_planilha',
            planilhas: downloadedNames
        });
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

// ══════════════════════════════════════════════════════════════════════════
// V2 — Análise de Edital em Pipeline (3 Etapas)
// ══════════════════════════════════════════════════════════════════════════

/**
 * Gera contexto textual estruturado a partir do schemaV2 para consumo
 * por módulos downstream (Chat, Petições, Oráculo, Dossiê, Declarações, Proposta).
 * 
 * @param schema - O objeto AnalysisSchemaV1 (ou JSON equivalente)
 * @param focus  - Opcional: foco do contexto para reduzir tokens
 */
function buildSchemaV2Context(schema: any, focus?: 'full' | 'chat' | 'petition' | 'oracle' | 'dossier' | 'proposal' | 'declaration'): string {
    if (!schema) return '';
    const f = focus || 'full';
    const sections: string[] = [];

    // ── Identificação (sempre incluso) ──
    const pid = schema.process_identification || {};
    sections.push(`══ IDENTIFICAÇÃO DO PROCESSO ══
Órgão: ${pid.orgao || 'N/A'}
Edital: ${pid.numero_edital || 'N/A'} | Processo: ${pid.numero_processo || 'N/A'}
Modalidade: ${pid.modalidade || 'N/A'} | Critério: ${pid.criterio_julgamento || 'N/A'}
Objeto: ${pid.objeto_completo || pid.objeto_resumido || 'N/A'}
Tipo: ${pid.tipo_objeto || 'N/A'} | Município/UF: ${pid.municipio_uf || 'N/A'}`);

    // ── Timeline (chat, petition, full) ──
    if (['full', 'chat', 'petition'].includes(f)) {
        const tl = schema.timeline || {};
        sections.push(`══ PRAZOS E DATAS ══
Sessão: ${tl.data_sessao || 'N/A'}
Publicação: ${tl.data_publicacao || 'N/A'}
Impugnação: ${tl.prazo_impugnacao || 'N/A'}
Esclarecimento: ${tl.prazo_esclarecimento || 'N/A'}
Proposta: ${tl.prazo_envio_proposta || 'N/A'}
Recurso: ${tl.prazo_recurso || 'N/A'}`);
    }

    // ── Condições de Participação (chat, petition, declaration, full) ──
    if (['full', 'chat', 'petition', 'declaration'].includes(f)) {
        const pc = schema.participation_conditions || {};
        sections.push(`══ CONDIÇÕES DE PARTICIPAÇÃO ══
Consórcio: ${pc.permite_consorcio === null ? 'Não informado' : pc.permite_consorcio ? 'SIM' : 'NÃO'}
Subcontratação: ${pc.permite_subcontratacao === null ? 'Não informado' : pc.permite_subcontratacao ? 'SIM' : 'NÃO'}
Visita Técnica: ${pc.exige_visita_tecnica === null ? 'Não informado' : pc.exige_visita_tecnica ? 'SIM' : 'NÃO'}${pc.visita_tecnica_detalhes ? ' — ' + pc.visita_tecnica_detalhes : ''}
Garantia Proposta: ${pc.exige_garantia_proposta ? 'SIM — ' + pc.garantia_proposta_detalhes : 'NÃO'}
Garantia Contratual: ${pc.exige_garantia_contratual ? 'SIM — ' + pc.garantia_contratual_detalhes : 'NÃO'}
Tratamento ME/EPP: ${pc.tratamento_me_epp || 'N/A'}`);
    }

    // ── Exigências de Habilitação (chat, dossier, oracle, declaration, full) ──
    if (['full', 'chat', 'dossier', 'oracle', 'declaration'].includes(f)) {
        const reqs = schema.requirements || {};
        const reqSections = [
            ['Habilitação Jurídica', reqs.habilitacao_juridica],
            ['Regularidade Fiscal/Trabalhista', reqs.regularidade_fiscal_trabalhista],
            ['Qualificação Econômico-Financeira', reqs.qualificacao_economico_financeira],
            ['Qualificação Técnica Operacional', reqs.qualificacao_tecnica_operacional],
            ['Qualificação Técnica Profissional', reqs.qualificacao_tecnica_profissional],
            ['Proposta Comercial', reqs.proposta_comercial],
            ['Documentos Complementares', reqs.documentos_complementares],
        ];
        let reqText = '══ EXIGÊNCIAS DE HABILITAÇÃO ══\n';
        for (const [cat, items] of reqSections) {
            if (Array.isArray(items) && items.length > 0) {
                reqText += `\n▸ ${cat}:\n`;
                for (const r of items) {
                    const oblLabel = r.obligation_type || (r.mandatory ? 'obrigatória' : 'opcional');
                    const srcLabel = r.source_ref ? ` — 📄 ${r.source_ref}` : '';
                    reqText += `  [${r.requirement_id}] ${r.title}: ${r.description} (${oblLabel})${srcLabel}\n`;
                }
            }
        }
        sections.push(reqText);
    }

    // ── Análise Técnica (oracle, dossier, full) ──
    if (['full', 'oracle', 'dossier', 'chat'].includes(f)) {
        const ta = schema.technical_analysis || {};
        let taText = '══ ANÁLISE TÉCNICA ══\n';
        taText += `Atestado Capacidade Técnica: ${ta.exige_atestado_capacidade_tecnica ? 'SIM' : 'NÃO/N.I.'}\n`;
        if (ta.parcelas_relevantes?.length > 0) {
            taText += 'Parcelas Relevantes:\n';
            for (const p of ta.parcelas_relevantes) {
                taText += `  • ${p.item}: ${p.descricao} (mín: ${p.quantitativo_minimo} ${p.unidade})\n`;
            }
        }
        sections.push(taText);
    }

    // ── Econômico-Financeira (chat, proposal, full) ──
    if (['full', 'chat', 'proposal'].includes(f)) {
        const ef = schema.economic_financial_analysis || {};
        let efText = '══ ANÁLISE ECONÔMICO-FINANCEIRA ══\n';
        if (ef.indices_exigidos?.length > 0) {
            for (const idx of ef.indices_exigidos) {
                efText += `  • ${idx.indice}: ${idx.formula_ou_descricao} (mín: ${idx.valor_minimo})\n`;
            }
        }
        if (ef.patrimonio_liquido_minimo) efText += `Patrimônio Líquido Mínimo: ${ef.patrimonio_liquido_minimo}\n`;
        if (ef.capital_social_minimo) efText += `Capital Social Mínimo: ${ef.capital_social_minimo}\n`;
        sections.push(efText);
    }

    // ── Proposta (proposal, chat, full) ──
    if (['full', 'chat', 'proposal'].includes(f)) {
        const pa = schema.proposal_analysis || {};
        let paText = '══ ANÁLISE DA PROPOSTA ══\n';
        paText += `Planilha Orçamentária: ${pa.exige_planilha_orcamentaria ? 'SIM' : 'NÃO/N.I.'}\n`;
        paText += `Carta Proposta: ${pa.exige_carta_proposta ? 'SIM' : 'NÃO/N.I.'}\n`;
        paText += `Composição BDI: ${pa.exige_composicao_bdi ? 'SIM' : 'NÃO/N.I.'}\n`;
        if (pa.criterios_desclassificacao_proposta?.length > 0) {
            paText += 'Critérios de Desclassificação:\n';
            pa.criterios_desclassificacao_proposta.forEach((c: string) => paText += `  ⚠️ ${c}\n`);
        }
        sections.push(paText);
    }

    // ── Riscos Críticos (petition, chat, full) ──
    if (['full', 'chat', 'petition'].includes(f)) {
        const rr = schema.legal_risk_review || {};
        if (rr.critical_points?.length > 0) {
            let rrText = '══ PONTOS CRÍTICOS E RISCOS ══\n';
            for (const cp of rr.critical_points) {
                rrText += `  🔴 [${cp.severity?.toUpperCase()}] ${cp.title}\n`;
                rrText += `     ${cp.description}\n`;
                rrText += `     ➜ Ação: ${cp.recommended_action}\n`;
            }
            sections.push(rrText);
        }
        if (rr.ambiguities?.length > 0) {
            sections.push('Ambiguidades:\n' + rr.ambiguities.map((a: string) => `  ⚠️ ${a}`).join('\n'));
        }
        if (rr.points_for_impugnation_or_clarification?.length > 0) {
            sections.push('Pontos para Impugnação/Esclarecimento:\n' +
                rr.points_for_impugnation_or_clarification.map((p: string) => `  📌 ${p}`).join('\n'));
        }
    }

    // ── Outputs Operacionais (dossier, declaration, full) ──
    if (['full', 'dossier', 'declaration'].includes(f)) {
        const oo = schema.operational_outputs || {};
        if (oo.documents_to_prepare?.length > 0) {
            let ooText = '══ DOCUMENTOS A PREPARAR ══\n';
            for (const doc of oo.documents_to_prepare) {
                ooText += `  📋 ${doc.document_name} [${doc.priority?.toUpperCase()}] — ${doc.responsible_area}\n`;
            }
            sections.push(ooText);
        }
    }

    // ── Confiança (sempre) ──
    const conf = schema.confidence || {};
    sections.push(`══ CONFIANÇA DA ANÁLISE ══
Nível: ${conf.overall_confidence || 'N/A'}${conf.score_percentage ? ` (${conf.score_percentage}%)` : ''}
Modelo: ${schema.analysis_meta?.model_used || 'N/A'}
Prompt: ${(schema.analysis_meta as any)?.prompt_version || 'N/A'}`);

    return sections.join('\n\n');
}


/**
 * Validador automático de completude (sem IA).
 * Verifica se o JSON extraído está minimamente preenchido.
 */
function validateAnalysisCompleteness(schema: AnalysisSchemaV1): { valid: boolean; issues: string[]; confidence_score: number } {
    const issues: string[] = [];
    let totalChecks = 0;
    let passedChecks = 0;

    const check = (condition: boolean, message: string) => {
        totalChecks++;
        if (condition) {
            passedChecks++;
        } else {
            issues.push(message);
        }
    };

    // ── 1. Identificação do Processo (peso alto) ──
    check(
        !!(schema.process_identification?.objeto_resumido || schema.process_identification?.objeto_completo),
        'Objeto da licitação não identificado'
    );
    check(!!schema.process_identification?.modalidade, 'Modalidade não identificada');
    check(!!schema.process_identification?.orgao, 'Órgão licitante não identificado');
    check(!!schema.process_identification?.numero_edital, 'Número do edital não identificado');

    // ── 2. Timeline ──
    check(!!schema.timeline?.data_sessao, 'Data da sessão não identificada');
    check(
        !!(schema.timeline?.data_publicacao || schema.timeline?.prazo_impugnacao || schema.timeline?.prazo_esclarecimento),
        'Nenhum prazo relevante identificado (publicação, impugnação ou esclarecimento)'
    );

    // ── 3. Exigências de Habilitação ──
    const allReqItems = Object.values(schema.requirements || {}).reduce((acc: any[], arr) => acc.concat(Array.isArray(arr) ? arr : []), [] as any[]);
    const totalReqs = allReqItems.filter((r: any) => !r.entry_type || r.entry_type === 'exigencia_principal').length;
    check(totalReqs > 0, 'Nenhuma exigência de habilitação identificada');
    check(totalReqs >= 3, `Pouquíssimas exigências identificadas (apenas ${totalReqs}), possível extração incompleta`);

    // ── 4. Condições de Participação ──
    check(
        schema.participation_conditions?.permite_consorcio !== null ||
        schema.participation_conditions?.permite_subcontratacao !== null ||
        !!schema.participation_conditions?.tratamento_me_epp,
        'Nenhuma condição de participação identificada'
    );

    // ── 5. Análise Técnica ──
    check(
        (schema.requirements?.qualificacao_tecnica_operacional?.length || 0) > 0 ||
        (schema.requirements?.qualificacao_tecnica_profissional?.length || 0) > 0 ||
        schema.technical_analysis?.exige_atestado_capacidade_tecnica === true,
        'Nenhuma exigência técnica ou atestado identificado'
    );

    // ── 6. Análise Econômico-Financeira ──
    check(
        (schema.economic_financial_analysis?.indices_exigidos?.length || 0) > 0 ||
        !!schema.economic_financial_analysis?.capital_social_minimo ||
        !!schema.economic_financial_analysis?.patrimonio_liquido_minimo,
        'Nenhuma exigência econômico-financeira identificada'
    );

    // ── 7. Proposta/Preço ──
    check(
        !!schema.process_identification?.criterio_julgamento,
        'Critério de julgamento não identificado'
    );

    // ── 8. Evidências ──
    const evCount = schema.evidence_registry?.length || 0;
    check(evCount > 0, 'Nenhuma evidência textual registrada');
    check(
        evCount >= 5,
        `Poucas evidências registradas (apenas ${evCount}), rastreabilidade comprometida`
    );

    // ── 9. Outputs Operacionais ──
    check(
        (schema.operational_outputs?.documents_to_prepare?.length || 0) > 0,
        'Lista de documentos a preparar não gerada'
    );

    // ── 10. Revisão de Risco ──
    check(
        (schema.legal_risk_review?.critical_points?.length || 0) > 0 ||
        (schema.legal_risk_review?.ambiguities?.length || 0) > 0,
        'Nenhum ponto crítico ou ambiguidade identificada (análise de risco pode estar incompleta)'
    );

    const confidence_score = totalChecks > 0 ? Math.round((passedChecks / totalChecks) * 100) : 0;

    return {
        valid: confidence_score >= 60, // 60%+ das checagens passaram
        issues,
        confidence_score
    };
}

app.post('/api/analyze-edital/v2', authenticateToken, async (req: any, res) => {
    const analysisStartTime = Date.now();
    const result = createEmptyAnalysisSchema();
    result.analysis_meta.analysis_id = `analysis_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    result.analysis_meta.generated_at = new Date().toISOString();

    try {
        const { fileNames, biddingProcessId } = req.body;
        if (!fileNames || !Array.isArray(fileNames) || fileNames.length === 0) {
            return res.status(400).json({ error: 'fileNames array is required' });
        }

        // ── 1. Ingestão Documental (Etapa 0) ──
        const pdfParts: any[] = [];
        const sourceFiles: string[] = [];

        for (let fileNameSource of fileNames) {
            const fileName = decodeURIComponent(fileNameSource).split('?')[0];

            const doc = await prisma.document.findFirst({
                where: {
                    fileUrl: { contains: fileName },
                    tenantId: req.user.tenantId
                }
            });

            const belongsToTenant = doc || fileName.startsWith(`${req.user.tenantId}_`) || fileName.includes(`${req.user.tenantId}/`);
            if (!belongsToTenant) {
                console.warn(`[AI-V2] Unauthorized access attempt to file: ${fileName}`);
                continue;
            }

            const fileToFetch = doc ? doc.fileUrl : fileName;
            const pdfBuffer = await getFileBufferSafe(fileToFetch, req.user.tenantId);

            if (pdfBuffer) {
                console.log(`[AI-V2] Read file ${fileName} (${(pdfBuffer.length / 1024).toFixed(0)} KB)`);
                pdfParts.push({
                    inlineData: {
                        data: pdfBuffer.toString('base64'),
                        mimeType: 'application/pdf'
                    }
                });
                sourceFiles.push(fileName);
            } else {
                console.error(`[AI-V2] Could not find file: ${fileName}`);
            }
        }

        if (pdfParts.length === 0) {
            return res.status(400).json({ error: 'Nenhum arquivo válido encontrado para análise.' });
        }

        result.analysis_meta.source_files = sourceFiles;
        result.analysis_meta.source_type = 'upload_manual';

        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            return res.status(500).json({ error: 'GEMINI_API_KEY não configurada' });
        }
        const ai = new GoogleGenAI({ apiKey });

        console.log(`[AI-V2] ═══ PIPELINE INICIADO ═══ (${pdfParts.length} PDFs, ${sourceFiles.join(', ')})`);

        // ── 2. Etapa 1: Extração Factual ──
        console.log(`[AI-V2] ── Etapa 1/3: Extração Factual...`);
        let extractionJson: any;
        const t1Start = Date.now();

        let modelsUsed: string[] = [];

        try {
            const extractionResponse = await callGeminiWithRetry(ai.models, {
                model: 'gemini-2.5-flash',
                contents: [{
                    role: 'user',
                    parts: [
                        ...pdfParts,
                        { text: V2_EXTRACTION_USER_INSTRUCTION.replace('{domainReinforcement}', '') }
                    ]
                }],
                config: {
                    systemInstruction: V2_EXTRACTION_PROMPT,
                    temperature: 0.05,
                    maxOutputTokens: 32768,
                    responseMimeType: 'application/json'
                }
            });

            const extractionText = extractionResponse.text;
            if (!extractionText) throw new Error('Etapa 1 retornou vazio');

            extractionJson = robustJsonParse(extractionText, 'V2-Extraction');
            result.analysis_meta.workflow_stage_status.extraction = 'done';
            modelsUsed.push('gemini-2.5-flash');
            console.log(`[AI-V2] ✅ Etapa 1 concluída em ${((Date.now() - t1Start) / 1000).toFixed(1)}s — ` +
                `${(extractionJson.evidence_registry || []).length} evidências, ` +
                `${Object.values(extractionJson.requirements || {}).flat().length} exigências`);

        } catch (err: any) {
            console.warn(`[AI-V2] ⚠️ Etapa 1 Gemini falhou: ${err.message}. Tentando OpenAI...`);

            try {
                const openAiResult = await fallbackToOpenAiV2({
                    systemPrompt: V2_EXTRACTION_PROMPT,
                    userPrompt: V2_EXTRACTION_USER_INSTRUCTION.replace('{domainReinforcement}', ''),
                    pdfParts,
                    temperature: 0.05,
                    stageName: 'Etapa 1 (Extração)'
                });

                if (!openAiResult.text) throw new Error('OpenAI retornou vazio');

                extractionJson = robustJsonParse(openAiResult.text, 'V2-Extraction-OpenAI');
                result.analysis_meta.workflow_stage_status.extraction = 'done';
                modelsUsed.push(openAiResult.model);
                console.log(`[AI-V2] ✅ Etapa 1 concluída via OpenAI em ${((Date.now() - t1Start) / 1000).toFixed(1)}s`);

            } catch (openAiErr: any) {
                console.error(`[AI-V2] ❌ Etapa 1 falhou (Gemini + OpenAI): ${openAiErr.message}`);
                result.analysis_meta.workflow_stage_status.extraction = 'failed';
                result.confidence.warnings.push(`Etapa 1 (Extração) falhou em ambos os modelos: Gemini: ${err.message} | OpenAI: ${openAiErr.message}`);
                result.confidence.overall_confidence = 'baixa';
                result.analysis_meta.model_used = 'gemini-2.5-flash+openai-failed';
                return res.json({ schemaV2: result, partial: true, error: `Etapa 1 falhou` });
            }
        }

        // Merge extraction into result
        if (extractionJson.process_identification) result.process_identification = extractionJson.process_identification;
        if (extractionJson.timeline) result.timeline = extractionJson.timeline;
        if (extractionJson.participation_conditions) result.participation_conditions = extractionJson.participation_conditions;
        if (extractionJson.requirements) result.requirements = extractionJson.requirements;
        if (extractionJson.technical_analysis) result.technical_analysis = extractionJson.technical_analysis;
        if (extractionJson.economic_financial_analysis) result.economic_financial_analysis = extractionJson.economic_financial_analysis;
        if (extractionJson.proposal_analysis) result.proposal_analysis = extractionJson.proposal_analysis;
        if (extractionJson.contractual_analysis) result.contractual_analysis = extractionJson.contractual_analysis;
        if (extractionJson.evidence_registry) result.evidence_registry = extractionJson.evidence_registry;

        // ── 2.5. Domain Routing — Reforço por Tipo de Objeto ──
        const detectedObjectType = result.process_identification?.tipo_objeto || 'outro';
        const domainReinforcement = getDomainRoutingInstruction(detectedObjectType);
        if (domainReinforcement) {
            console.log(`[AI-V2] 🎯 Roteamento por tipo: ${detectedObjectType} — reforço aplicado nas Etapas 2 e 3`);
        }

        // ── 3. Etapa 2: Normalização por Categoria (paralela) ──
        console.log(`[AI-V2] ── Etapa 2/3: Normalização por Categoria...`);
        let normalizationJson: any = {};
        const t2Start = Date.now();

        try {
            const mergedRequirements: Record<string, any[]> = {};
            const mergedDocs: any[] = [];
            let totalNormalized = 0;
            let categoriesFailed = 0;

            const categoryTasks = NORM_CATEGORIES.map(cat => {
                const items = Array.isArray((extractionJson.requirements as any)?.[cat.key])
                    ? (extractionJson.requirements as any)[cat.key]
                    : [];

                if (items.length === 0) {
                    mergedRequirements[cat.key] = [];
                    return null;
                }

                // ── FAST-PATH: HJ, RFT, QEF — server-side normalization ──
                const FAST_NORM_CATS = ['habilitacao_juridica', 'regularidade_fiscal_trabalhista', 'qualificacao_economico_financeira'];
                if (FAST_NORM_CATS.includes(cat.key)) {
                    const normalized = items.map((item: any, idx: number) => ({
                        ...item,
                        requirement_id: item.requirement_id || `${cat.prefix}-${String(idx + 1).padStart(2, '0')}`,
                        entry_type: item.entry_type || 'exigencia_principal',
                        risk_if_missing: item.risk_if_missing || 'inabilitacao',
                        applies_to: item.applies_to || 'licitante',
                        obligation_type: item.obligation_type || 'obrigatoria_universal',
                        phase: item.phase || 'habilitacao',
                        source_ref: item.source_ref || 'referência não localizada',
                    }));
                    mergedRequirements[cat.key] = normalized;
                    totalNormalized += normalized.length;
                    normalized.filter((n: any) => n.entry_type === 'exigencia_principal').forEach((n: any) => {
                        mergedDocs.push({
                            document_name: n.title || n.requirement_id,
                            category: cat.key,
                            priority: 'critica',
                            responsible_area: cat.key === 'habilitacao_juridica' ? 'juridico' : 'contabil',
                            notes: ''
                        });
                    });
                    console.log(`[AI-V2] ⚡ FastNorm ${cat.prefix}: ${normalized.length} itens (server-side)`);
                    return { success: true, fastPath: true };
                }

                // ── AI normalization for QTO, QTP, PC, DC ──
                return (async () => {
                    const systemPrompt = buildCategoryNormPrompt(cat);
                    const userPrompt = buildCategoryNormUser(cat, items);

                    try {
                        const resp = await callGeminiWithRetry(ai.models, {
                            model: 'gemini-2.5-flash',
                            contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
                            config: {
                                systemInstruction: systemPrompt,
                                temperature: 0.1,
                                maxOutputTokens: 16384,
                                responseMimeType: 'application/json'
                            }
                        }, 1);
                        const text = resp.text;
                        if (!text) throw new Error(`${cat.prefix} vazio`);
                        const data = robustJsonParse(text, `Norm-${cat.prefix}`);
                        if (Array.isArray(data.items) && data.items.length > 0) {
                            mergedRequirements[cat.key] = data.items;
                            totalNormalized += data.items.length;
                        } else {
                            mergedRequirements[cat.key] = items;
                            totalNormalized += items.length;
                        }
                        if (Array.isArray(data.documents_to_prepare)) mergedDocs.push(...data.documents_to_prepare);
                        return { success: true };
                    } catch (gErr: any) {
                        console.warn(`[AI-V2] ⚠️ Norm ${cat.prefix} Gemini falhou. Fallback OpenAI...`);
                        try {
                            const oai = await fallbackToOpenAiV2({ systemPrompt, userPrompt, temperature: 0.1, stageName: `Norm-${cat.prefix}` });
                            if (!oai.text) throw new Error('OpenAI vazio');
                            const data = robustJsonParse(oai.text, `Norm-${cat.prefix}-OAI`);
                            if (Array.isArray(data.items) && data.items.length > 0) {
                                mergedRequirements[cat.key] = data.items;
                                totalNormalized += data.items.length;
                            } else {
                                mergedRequirements[cat.key] = items;
                                totalNormalized += items.length;
                            }
                            if (Array.isArray(data.documents_to_prepare)) mergedDocs.push(...data.documents_to_prepare);
                            modelsUsed.push('gpt-4o-mini');
                            return { success: true };
                        } catch {
                            mergedRequirements[cat.key] = items;
                            totalNormalized += items.length;
                            categoriesFailed++;
                            return { success: false };
                        }
                    }
                })();
            }).filter(Boolean);

            await Promise.allSettled(categoryTasks as Promise<any>[]);

            normalizationJson = {
                requirements_normalized: mergedRequirements,
                operational_outputs: { documents_to_prepare: mergedDocs },
            };
            result.analysis_meta.workflow_stage_status.normalization = 'done';
            modelsUsed.push('gemini-2.5-flash');
            console.log(`[AI-V2] ✅ Etapa 2 em ${((Date.now() - t2Start) / 1000).toFixed(1)}s — ${totalNormalized} itens, ${categoriesFailed} falhas`);

            if (categoriesFailed > 0) {
                result.confidence.warnings.push(`${categoriesFailed} categoria(s) não normalizada(s)`);
            }
        } catch (err: any) {
            console.error(`[AI-V2] ❌ Etapa 2 falhou: ${err.message}`);
            result.analysis_meta.workflow_stage_status.normalization = 'failed';
            result.confidence.warnings.push(`Etapa 2 falhou: ${err.message}`);
        }

        // Merge normalization — requirements normalizados sobrescrevem os da extração
        if (normalizationJson.requirements_normalized) {
            result.requirements = normalizationJson.requirements_normalized;
        }
        if (normalizationJson.operational_outputs) {
            result.operational_outputs = { ...result.operational_outputs, ...normalizationJson.operational_outputs };
        }
        if (normalizationJson.confidence) {
            result.confidence = { ...result.confidence, ...normalizationJson.confidence };
        }

        // ── 4. Etapa 3: Revisão de Risco ──
        console.log(`[AI-V2] ── Etapa 3/3: Revisão de Risco...`);
        const t3Start = Date.now();

        try {
            const riskUserInstruction = V2_RISK_REVIEW_USER_INSTRUCTION
                .replace('{extractionJson}', JSON.stringify(extractionJson, null, 2))
                .replace('{normalizationJson}', JSON.stringify(normalizationJson, null, 2))
                + (domainReinforcement ? `\n\n${domainReinforcement}` : '');

            const riskResponse = await callGeminiWithRetry(ai.models, {
                model: 'gemini-2.5-flash',
                contents: [{
                    role: 'user',
                    parts: [{ text: riskUserInstruction }]
                }],
                config: {
                    systemInstruction: V2_RISK_REVIEW_PROMPT,
                    temperature: 0.2,
                    maxOutputTokens: 16384,
                    responseMimeType: 'application/json'
                }
            });

            const riskText = riskResponse.text;
            if (!riskText) throw new Error('Etapa 3 retornou vazio');

            const riskJson = robustJsonParse(riskText, 'V2-RiskReview');
            result.analysis_meta.workflow_stage_status.risk_review = 'done';
            modelsUsed.push('gemini-2.5-flash');
            console.log(`[AI-V2] ✅ Etapa 3 concluída em ${((Date.now() - t3Start) / 1000).toFixed(1)}s — ` +
                `${(riskJson.legal_risk_review?.critical_points || []).length} pontos críticos`);

            // Merge risk review
            if (riskJson.legal_risk_review) {
                result.legal_risk_review = riskJson.legal_risk_review;
            }
            if (riskJson.operational_outputs_risk) {
                if (riskJson.operational_outputs_risk.questions_for_consultor_chat) {
                    result.operational_outputs.questions_for_consultor_chat = riskJson.operational_outputs_risk.questions_for_consultor_chat;
                }
                if (riskJson.operational_outputs_risk.possible_petition_routes) {
                    result.operational_outputs.possible_petition_routes = riskJson.operational_outputs_risk.possible_petition_routes;
                }
            }
            if (riskJson.confidence_update) {
                result.confidence.section_confidence.risk_review = riskJson.confidence_update.risk_review || 'media';
            }

        } catch (err: any) {
            console.warn(`[AI-V2] ⚠️ Etapa 3 Gemini falhou: ${err.message}. Tentando OpenAI...`);

            try {
                const riskUserInstruction = V2_RISK_REVIEW_USER_INSTRUCTION
                    .replace('{extractionJson}', JSON.stringify(extractionJson, null, 2))
                    .replace('{normalizationJson}', JSON.stringify(normalizationJson, null, 2))
                    + (domainReinforcement ? `\n\n${domainReinforcement}` : '');

                const openAiResult = await fallbackToOpenAiV2({
                    systemPrompt: V2_RISK_REVIEW_PROMPT,
                    userPrompt: riskUserInstruction,
                    temperature: 0.2,
                    stageName: 'Etapa 3 (Risco)'
                });

                if (!openAiResult.text) throw new Error('OpenAI retornou vazio');

                const riskJson = robustJsonParse(openAiResult.text, 'V2-RiskReview-OpenAI');
                result.analysis_meta.workflow_stage_status.risk_review = 'done';
                modelsUsed.push(openAiResult.model);
                console.log(`[AI-V2] ✅ Etapa 3 concluída via OpenAI em ${((Date.now() - t3Start) / 1000).toFixed(1)}s`);

                if (riskJson.legal_risk_review) result.legal_risk_review = riskJson.legal_risk_review;
                if (riskJson.operational_outputs_risk) {
                    if (riskJson.operational_outputs_risk.questions_for_consultor_chat) {
                        result.operational_outputs.questions_for_consultor_chat = riskJson.operational_outputs_risk.questions_for_consultor_chat;
                    }
                    if (riskJson.operational_outputs_risk.possible_petition_routes) {
                        result.operational_outputs.possible_petition_routes = riskJson.operational_outputs_risk.possible_petition_routes;
                    }
                }
                if (riskJson.confidence_update) {
                    result.confidence.section_confidence.risk_review = riskJson.confidence_update.risk_review || 'media';
                }

            } catch (openAiErr: any) {
                console.error(`[AI-V2] ❌ Etapa 3 falhou (Gemini + OpenAI): ${openAiErr.message}`);
                result.analysis_meta.workflow_stage_status.risk_review = 'failed';
                result.confidence.warnings.push(`Etapa 3 (Risco) falhou: Gemini: ${err.message} | OpenAI: ${openAiErr.message}`);
            }
        }

        // ── 5. Validação Automática (sem IA) ──
        const validation = validateAnalysisCompleteness(result);
        result.analysis_meta.workflow_stage_status.validation = validation.valid ? 'done' : 'failed';
        if (validation.issues.length > 0) {
            result.confidence.warnings.push(...validation.issues);
            console.log(`[AI-V2] ⚠️ Validação: ${validation.confidence_score}% (${validation.issues.length} problemas: ${validation.issues.join('; ')})`);
        } else {
            console.log(`[AI-V2] ✅ Validação: ${validation.confidence_score}% — todas as checagens passaram`);
        }

        // ── 5.5. Motor de Regras de Domínio ──
        let ruleFindings: any[] = [];
        try {
            ruleFindings = executeRiskRules(result);
            if (ruleFindings.length > 0) {
                (result.analysis_meta as any).rule_findings = ruleFindings;
                const criticalFindings = ruleFindings.filter(f => f.severity === 'critical' || f.severity === 'high');
                if (criticalFindings.length > 0) {
                    result.confidence.warnings.push(`Motor de regras: ${criticalFindings.length} findings críticos/altos`);
                }
            }
            console.log(`[AI-V2] 🔧 Motor de Regras: ${ruleFindings.length} findings`);
        } catch (ruleErr: any) {
            console.warn(`[AI-V2] ⚠️ Motor de regras falhou: ${ruleErr.message}`);
        }

        // ── 5.6. Avaliador de Qualidade ──
        let qualityReport: any = null;
        try {
            qualityReport = evaluateAnalysisQuality(result, ruleFindings, result.analysis_meta.analysis_id);
            (result.analysis_meta as any).quality_report = {
                overallScore: qualityReport.overallScore,
                categoryScores: qualityReport.categoryScores,
                issueCount: qualityReport.issues.length,
                summary: qualityReport.summary
            };
            console.log(`[AI-V2] 📊 Qualidade: ${qualityReport.overallScore}% | ${qualityReport.summary}`);
        } catch (qualErr: any) {
            console.warn(`[AI-V2] ⚠️ Avaliador de qualidade falhou: ${qualErr.message}`);
        }

        // ── 6. Confidence Score Final ──
        // Combina: pipeline stages (30%) + validação de conteúdo (35%) + quality score (35%)
        const stagesDone = Object.values(result.analysis_meta.workflow_stage_status).filter(s => s === 'done').length;
        const stagesTotal = 4;
        const stageScore = (stagesDone / stagesTotal) * 100;
        const qualityScore = qualityReport?.overallScore || 50;
        let combinedScore = Math.round((stageScore * 0.30) + (validation.confidence_score * 0.35) + (qualityScore * 0.35));

        // Traceability assessment — same base (principals) for numerator and denominator
        const allReqArrays = Object.values(result.requirements || {}).flat() as any[];
        const principalReqs = allReqArrays.filter((r: any) => !r.entry_type || r.entry_type === 'exigencia_principal');
        const reqCount = principalReqs.length;
        const tracedCount = principalReqs.filter((r: any) => r.source_ref && r.source_ref !== 'referência não localizada' && r.source_ref.trim() !== '').length;
        const traceabilityRatio = reqCount > 0 ? tracedCount / reqCount : 0;

        if (traceabilityRatio < 0.5 && reqCount > 5) {
            combinedScore -= 10;
        }
        combinedScore = Math.max(5, Math.min(100, combinedScore));

        if (combinedScore >= 80 && traceabilityRatio >= 0.8) {
            result.confidence.overall_confidence = 'alta';
        } else if (combinedScore >= 50) {
            result.confidence.overall_confidence = 'media';
        } else {
            result.confidence.overall_confidence = 'baixa';
        }
        (result.confidence as any).score_percentage = combinedScore;
        (result.confidence as any).traceability = {
            total_requirements: reqCount,
            traced_requirements: tracedCount,
            traceability_percentage: Math.round(traceabilityRatio * 100),
            evidence_registry_count: result.evidence_registry?.length || 0,
        };

        // Track all models used (deduped)
        const uniqueModels = [...new Set(modelsUsed)];
        result.analysis_meta.model_used = uniqueModels.join('+');
        (result.analysis_meta as any).prompt_version = V2_PROMPT_VERSION;
        (result.analysis_meta as any).models_per_stage = {
            extraction: modelsUsed[0] || 'failed',
            normalization: modelsUsed[1] || 'failed',
            risk_review: modelsUsed[2] || 'failed'
        };

        // ── 7. Indexação RAG ──
        if (biddingProcessId && pdfParts.length > 0) {
            try {
                await indexDocumentChunks(biddingProcessId, pdfParts);
                console.log(`[AI-V2] 🔗 RAG indexado para processo ${biddingProcessId}`);
            } catch (ragErr: any) {
                console.warn(`[AI-V2] RAG indexação falhou: ${ragErr.message}`);
            }
        }

        const totalDuration = ((Date.now() - analysisStartTime) / 1000).toFixed(1);
        const totalReqs = Object.values(result.requirements).reduce((sum, arr) => sum + arr.length, 0);
        console.log(`[AI-V2] ═══ PIPELINE CONCLUÍDO ═══ ${totalDuration}s total | ` +
            `Modelos: ${uniqueModels.join('+')} | ` +
            `${totalReqs} exigências | ${result.legal_risk_review.critical_points.length} riscos | ` +
            `${result.evidence_registry.length} evidências | Score: ${combinedScore}% (${result.confidence.overall_confidence})`);

        // ── 8. Compatibilidade V1 ──
        // Gera campos legacy para consumo pelos módulos que ainda usam o formato antigo
        const legacyCompat = {
            process: {
                title: result.process_identification.objeto_resumido || result.process_identification.numero_edital,
                modality: result.process_identification.modalidade,
                object: result.process_identification.objeto_completo,
                agency: result.process_identification.orgao,
                estimatedValue: '',
                sessionDate: result.timeline.data_sessao,
            },
            analysis: {
                fullSummary: `ANÁLISE V2 — ${result.process_identification.objeto_resumido}\n\n` +
                    `Modalidade: ${result.process_identification.modalidade}\n` +
                    `Órgão: ${result.process_identification.orgao}\n` +
                    `Sessão: ${result.timeline.data_sessao}\n\n` +
                    `Objeto: ${result.process_identification.objeto_completo}\n\n` +
                    `--- CONDIÇÕES ---\n` +
                    `Consórcio: ${result.participation_conditions.permite_consorcio ?? 'Não informado'}\n` +
                    `Subcontratação: ${result.participation_conditions.permite_subcontratacao ?? 'Não informado'}\n` +
                    `Visita Técnica: ${result.participation_conditions.exige_visita_tecnica ?? 'Não informado'}\n\n` +
                    `--- RISCOS CRÍTICOS (${result.legal_risk_review.critical_points.length}) ---\n` +
                    result.legal_risk_review.critical_points.map(cp =>
                        `[${cp.severity.toUpperCase()}] ${cp.title}: ${cp.description} → ${cp.recommended_action}`
                    ).join('\n'),
                qualificationRequirements: Object.values(result.requirements)
                    .flat()
                    .map(r => `[${r.requirement_id}] ${r.title}: ${r.description}`)
                    .join('\n'),
                biddingItems: result.proposal_analysis.observacoes_proposta.join('\n'),
                pricingConsiderations: result.economic_financial_analysis.indices_exigidos
                    .map(i => `${i.indice}: ${i.formula_ou_descricao} (mín: ${i.valor_minimo})`)
                    .join('\n'),
            }
        };

        res.json({
            ...legacyCompat,          // Campos V1 para compatibilidade
            schemaV2: result,          // Schema completo V2
            _version: '2.0',
            _pipeline_duration_s: parseFloat(totalDuration),
            _prompt_version: V2_PROMPT_VERSION,
            _model_used: uniqueModels.join('+'),
            _overall_confidence: result.confidence.overall_confidence
        });

    } catch (error: any) {
        console.error(`[AI-V2] ERRO FATAL:`, error?.message || error);
        const logMsg = `[${new Date().toISOString()}] V2 Pipeline Error: ${error?.message || String(error)}\n${error?.stack || ''}\n\n`;
        fs.appendFileSync(path.join(uploadDir, 'debug-analysis.log'), logMsg);
        res.status(500).json({
            error: `Erro no pipeline V2: ${error?.message || 'Erro desconhecido'}`,
            schemaV2: result  // Retorna o que conseguiu mesmo em erro
        });
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
            // Prefer V2 structured context for petitions (risk + impugnation focus)
            if (aiAnalysis.schemaV2) {
                biddingAnalysisText = `
${buildModuleContext(aiAnalysis.schemaV2, 'petition')}

Resumo Executivo: ${aiAnalysis.fullSummary || 'N/A'}
`.trim();
                console.log(`[Petition] Using buildModuleContext('petition') for generation`);
            } else {
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

        // Fetch analysis data for context AND source file names
        let analysisContext = "";
        let sourceFileNamesFromAnalysis: string[] = [];
        if (biddingProcessId) {
            const analysis = await prisma.aiAnalysis.findUnique({
                where: { biddingProcessId }
            });
            if (analysis) {
                // Prefer V2 structured context when available
                if (analysis.schemaV2) {
                    analysisContext = `
ANÁLISE ESTRUTURADA V2 DO EDITAL (confiança: ${(analysis.schemaV2 as any)?.confidence?.overall_confidence || 'N/A'}):

${buildModuleContext(analysis.schemaV2, 'chat')}
`;
                    traceLog(`[V2] Chat context loaded via buildModuleContext (${analysisContext.length} chars). Confidence: ${(analysis.schemaV2 as any)?.confidence?.overall_confidence}`);
                } else {
                    // Fallback to legacy V1 fields
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
                    traceLog("Legacy V1 analysis context loaded.");
                }

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

// GET: /api/chat-monitor/logs - Histórico de atividade do Agente Local (Fase 4)
app.get('/api/chat-monitor/logs', authenticateToken, async (req, res) => {
    try {
        const tenantId = (req as any).user.tenantId;
        const limit = parseInt(req.query.limit as string) || 50;

        const logs = await prisma.chatMonitorLog.findMany({
            where: { tenantId },
            include: {
                biddingProcess: {
                    select: {
                        processNumber: true,
                        processYear: true,
                        title: true,
                        uasg: true
                    }
                }
            },
            orderBy: { createdAt: 'desc' },
            take: limit
        });

        res.json(logs);
    } catch (error: any) {
        console.error('[Chat Monitor Logs] Error:', error.message);
        res.status(500).json({ error: 'Failed to fetch monitor logs' });
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
// ══════════════════════════════════════════════════════════════════
//  Sprint 7 — Governance API Endpoints
// ══════════════════════════════════════════════════════════════════

// POST /api/ai/feedback — Submit structured feedback
app.post('/api/ai/feedback', async (req: any, res: any) => {
    try {
        const feedback = submitFeedback(req.body as AIExecutionFeedback);
        res.json({ success: true, feedbackId: feedback.feedbackId });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/ai/feedback/:moduleName — Get feedback by module
app.get('/api/ai/feedback/:moduleName', async (req: any, res: any) => {
    try {
        const items = getFeedbackByModule(req.params.moduleName);
        const stats = getFeedbackStats(req.params.moduleName);
        res.json({ items, stats });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/ai/metrics — System operational report
app.get('/api/ai/metrics', async (_req: any, res: any) => {
    try {
        const report = generateSystemReport(30);
        res.json(report);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/ai/versions — Version catalog
app.get('/api/ai/versions', async (_req: any, res: any) => {
    try {
        const versions = getAllVersions();
        const promotions = getPromotionHistory();
        res.json({ versions, promotions });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/ai/insights — Improvement insights
app.get('/api/ai/insights', async (_req: any, res: any) => {
    try {
        const report = generateImprovementInsights(30);
        res.json(report);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/ai/golden-cases/convert — Convert feedback to golden cases
app.post('/api/ai/golden-cases/convert', async (_req: any, res: any) => {
    try {
        const converted = convertFeedbackToGoldenCases();
        res.json({ success: true, converted: converted.length, cases: converted });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// ══════════════════════════════════════════════════════════════════
//  Sprint 8 — Strategic Company API Endpoints
// ══════════════════════════════════════════════════════════════════

// POST /api/company/profile — Create or update company profile
app.post('/api/company/profile', async (req: any, res: any) => {
    try {
        const profile = createOrUpdateProfile(req.body as CompanyLicitationProfile);
        res.json({ success: true, companyId: profile.companyId });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/company/profiles — List all company profiles
app.get('/api/company/profiles', async (_req: any, res: any) => {
    try {
        res.json(getAllProfiles());
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/company/:companyId — Get company profile
app.get('/api/company/:companyId', async (req: any, res: any) => {
    try {
        const profile = getProfile(req.params.companyId);
        if (!profile) return res.status(404).json({ error: 'Company not found' });
        res.json(profile);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// POST /api/strategy/analyze — Full strategic analysis: match + score + action plan
app.post('/api/strategy/analyze', async (req: any, res: any) => {
    try {
        const { companyId, biddingProcessId } = req.body;
        if (!companyId || !biddingProcessId) {
            return res.status(400).json({ error: 'companyId and biddingProcessId are required' });
        }

        const bidding = await prisma.biddingProcess.findUnique({
            where: { id: biddingProcessId },
            include: { aiAnalysis: true }
        });

        if (!bidding?.aiAnalysis?.schemaV2) {
            return res.status(404).json({ error: 'Bidding process or schemaV2 not found' });
        }

        const schemaV2 = bidding.aiAnalysis.schemaV2;
        const matchResult = matchCompanyToEdital(companyId, schemaV2, biddingProcessId);
        const assessment = calculateParticipationScore(matchResult, schemaV2);
        const actionPlan = generateActionPlan(matchResult, assessment, schemaV2);

        // Record for learning
        recordMatchHistory(companyId, biddingProcessId, {
            doc: matchResult.documentaryFit.score,
            tech: matchResult.technicalFit.score,
            ef: matchResult.economicFinancialFit.score,
            prop: matchResult.proposalFit.score,
            overall: assessment.overallScore
        }, assessment.recommendation);

        res.json({ matchResult, assessment, actionPlan });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

// GET /api/company/:companyId/insights — Company learning insights
app.get('/api/company/:companyId/insights', async (req: any, res: any) => {
    try {
        const report = generateCompanyInsights(req.params.companyId);
        res.json(report);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, async () => {
    console.log(`Server is running on port ${PORT} (mode: ${process.env.NODE_ENV || 'development'})`);
    console.log(`Upload directory: ${uploadDir}`);
    await runAutoSetup();

    // Initialize version catalog
    registerInitialVersions();
    console.log(`[Governance] Version catalog initialized with ${getAllVersions().length} components`);
    
    // Start Chat Monitor Polling
    pncpMonitor.startPolling(5); // Run every 5 minutes
});

// Keep event loop alive (required in this environment)
setInterval(() => { }, 1 << 30);
