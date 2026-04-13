"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const multer_1 = __importDefault(require("multer"));
const prisma_1 = __importDefault(require("../lib/prisma"));
const auth_1 = require("../middlewares/auth");
const security_1 = require("../lib/security");
const storage_1 = require("../storage");
const genai_1 = require("@google/genai");
const parser_service_1 = require("../services/ai/parser.service");
const gemini_service_1 = require("../services/ai/gemini.service");
const openai_service_1 = require("../services/ai/openai.service");
const prompt_service_1 = require("../services/ai/prompt.service");
const moduleContextContracts_1 = require("../services/ai/modules/moduleContextContracts");
const router = express_1.default.Router();
const upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } }); // 30MB max
// ── Documents CRUD ──
// Create document
router.post('/documents', auth_1.authenticateToken, upload.single('file'), async (req, res) => {
    try {
        const { companyProfileId, docType, expirationDate, status, docGroup, issuerLink } = req.body;
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        const tenantId = req.user.tenantId;
        const { url: fileUrl } = await storage_1.storageService.uploadFile(req.file, tenantId);
        const doc = await prisma_1.default.document.create({
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
                fileContent: req.file.buffer,
                alertDays: req.body.alertDays ? parseInt(req.body.alertDays) : 15
            }
        });
        res.json(doc);
    }
    catch (error) {
        console.error("Upload error:", error);
        res.status(500).json({ error: 'Failed to upload document', details: error instanceof Error ? error.message : String(error) });
    }
});
// Update document
router.put('/documents/:id', auth_1.authenticateToken, upload.single('file'), async (req, res) => {
    try {
        const { id } = req.params;
        const tenantId = req.user.tenantId;
        const { docType, expirationDate, status, docGroup, issuerLink } = req.body;
        const doc = await prisma_1.default.document.findUnique({
            where: { id }
        });
        if (!doc || doc.tenantId !== tenantId) {
            return res.status(404).json({ error: 'Document not found or unauthorized' });
        }
        let fileData = {};
        if (req.file) {
            try {
                await storage_1.storageService.deleteFile(doc.fileUrl);
            }
            catch (e) {
                console.warn("Could not delete old file:", doc.fileUrl);
            }
            const { url: fileUrl } = await storage_1.storageService.uploadFile(req.file, tenantId);
            fileData = {
                fileUrl,
                fileName: req.file.originalname,
                fileContent: req.file.buffer
            };
        }
        const updatedDoc = await prisma_1.default.document.update({
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
    }
    catch (error) {
        console.error("Update doc error:", error);
        res.status(500).json({ error: 'Failed to update document' });
    }
});
// Delete document
router.delete('/documents/:id', auth_1.authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const doc = await prisma_1.default.document.findUnique({
            where: { id }
        });
        if (doc && doc.tenantId === req.user.tenantId) {
            await storage_1.storageService.deleteFile(doc.fileUrl);
            await prisma_1.default.document.delete({ where: { id } });
            res.json({ success: true });
        }
        else {
            res.status(404).json({ error: 'Document not found or unauthorized' });
        }
    }
    catch (error) {
        console.error("Delete doc error:", error);
        res.status(500).json({ error: 'Failed to delete document' });
    }
});
// ── Technical Certificates (Oráculo de Atestados) ──
router.get('/technical-certificates', auth_1.authenticateToken, async (req, res) => {
    try {
        const certificates = await prisma_1.default.technicalCertificate.findMany({
            where: { tenantId: req.user.tenantId },
            include: { experiences: true, company: true },
            orderBy: { createdAt: 'desc' }
        });
        res.json(certificates);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch certificates' });
    }
});
router.post('/technical-certificates', auth_1.authenticateToken, security_1.aiLimiter, upload.single('file'), async (req, res) => {
    try {
        const { companyProfileId, title, type, category } = req.body;
        if (!req.file)
            return res.status(400).json({ error: 'File is required' });
        const { url: fileUrl } = await storage_1.storageService.uploadFile(req.file, req.user.tenantId);
        // AI Extraction with Gemini → OpenAI fallback
        const apiKey = process.env.GEMINI_API_KEY;
        const ai = new genai_1.GoogleGenAI({ apiKey: apiKey });
        const pdfParts = [{ inlineData: { data: req.file.buffer.toString('base64'), mimeType: req.file.mimetype } }];
        const userInstruction = "Extraia os dados técnicos deste documento seguindo o formato JSON especificado.";
        console.log(`[AI Oracle] Analyzing certificate: ${req.file.originalname} (${(req.file.size / 1024).toFixed(0)}KB)`);
        let result;
        try {
            result = await (0, gemini_service_1.callGeminiWithRetry)(ai.models, {
                model: 'gemini-2.5-flash',
                contents: [{
                        role: 'user',
                        parts: [...pdfParts, { text: userInstruction }]
                    }],
                config: {
                    systemInstruction: prompt_service_1.EXTRACT_CERTIFICATE_SYSTEM_PROMPT,
                    temperature: 0.1,
                    responseMimeType: 'application/json'
                }
            }, 3, { tenantId: req.user.tenantId, operation: 'process_document', metadata: { docType: 'technical_certificate' } });
        }
        catch (geminiErr) {
            console.warn(`[AI Oracle] Gemini falhou na extração: ${geminiErr.message}. Fallback → OpenAI...`);
            const oaiResult = await (0, openai_service_1.fallbackToOpenAiV2)({
                systemPrompt: prompt_service_1.EXTRACT_CERTIFICATE_SYSTEM_PROMPT,
                userPrompt: userInstruction,
                pdfParts,
                temperature: 0.1,
                stageName: 'oracle-extract'
            });
            result = { text: oaiResult.text };
        }
        const extracted = (0, parser_service_1.robustJsonParse)(result.text);
        const certificate = await prisma_1.default.technicalCertificate.create({
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
                    create: (extracted.experiences || []).map((exp) => ({
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
    }
    catch (error) {
        console.error("Certificate upload error:", error);
        res.status(500).json({ error: 'Failed to process certificate', details: error.message });
    }
});
router.delete('/technical-certificates/:id', auth_1.authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const cert = await prisma_1.default.technicalCertificate.findUnique({ where: { id } });
        if (cert && cert.tenantId === req.user.tenantId) {
            await storage_1.storageService.deleteFile(cert.fileUrl);
            await prisma_1.default.technicalCertificate.delete({ where: { id } });
            res.json({ success: true });
        }
        else {
            res.status(404).json({ error: 'Certificate not found' });
        }
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to delete certificate' });
    }
});
router.post('/technical-certificates/compare', auth_1.authenticateToken, security_1.aiLimiter, async (req, res) => {
    try {
        const { biddingProcessId, technicalCertificateIds, disabledRequirements } = req.body;
        const tenantId = req.user.tenantId;
        const bidding = await prisma_1.default.biddingProcess.findUnique({
            where: { id: biddingProcessId, tenantId },
            include: { aiAnalysis: true }
        });
        const certificates = await prisma_1.default.technicalCertificate.findMany({
            where: { id: { in: technicalCertificateIds }, tenantId },
            include: { experiences: true }
        });
        if (!bidding || certificates.length === 0) {
            return res.status(404).json({ error: 'Processo ou atestados não encontrados.' });
        }
        let requirements;
        if (bidding.aiAnalysis?.schemaV2) {
            let schemaToUse = bidding.aiAnalysis.schemaV2;
            if (typeof schemaToUse === 'string') {
                try {
                    schemaToUse = JSON.parse(schemaToUse);
                }
                catch (e) { }
            }
            if (disabledRequirements && Array.isArray(disabledRequirements) && disabledRequirements.length > 0) {
                schemaToUse = JSON.parse(JSON.stringify(schemaToUse));
                ['qualificacao_tecnica_operacional', 'qualificacao_tecnica_profissional'].forEach(key => {
                    if (schemaToUse?.requirements?.[key]) {
                        schemaToUse.requirements[key] = schemaToUse.requirements[key].filter((r) => !disabledRequirements.includes(r.requirement_id || r.title));
                    }
                });
                if (schemaToUse?.technical_analysis?.parcelas_relevantes) {
                    schemaToUse.technical_analysis.parcelas_relevantes = schemaToUse.technical_analysis.parcelas_relevantes.filter((p) => !disabledRequirements.includes(p.item || p.descricao));
                }
            }
            requirements = (0, moduleContextContracts_1.buildModuleContext)(schemaToUse, 'oracle');
            console.log(`[AI Oracle] Using buildModuleContext('oracle') for comparison`);
        }
        else {
            requirements = bidding.aiAnalysis?.qualificationRequirements || bidding.summary || "";
        }
        const aggregatedCertData = certificates.map(cert => ({
            atestado_titulo: cert.title,
            objeto: cert.object,
            executingCompany: cert.executingCompany || null,
            technicalResponsible: cert.technicalResponsible || null,
            experiencias: cert.experiences.map(e => ({
                description: e.description,
                quantity: e.quantity,
                unit: e.unit,
                category: e.category
            }))
        }));
        const apiKey = process.env.GEMINI_API_KEY;
        const ai = new genai_1.GoogleGenAI({ apiKey: apiKey });
        const userContent = `EXIGÊNCIAS DO EDITAL:\n${requirements}\n\nACERVO TÉCNICO DISPONÍVEL (JSON):\n${JSON.stringify(aggregatedCertData, null, 2)}`;
        console.log(`[AI Oracle] Comparing ${certificates.length} certs with bidding ${bidding.title}`);
        let result;
        try {
            result = await (0, gemini_service_1.callGeminiWithRetry)(ai.models, {
                model: 'gemini-2.5-flash',
                contents: [{ role: 'user', parts: [{ text: userContent }] }],
                config: {
                    systemInstruction: prompt_service_1.COMPARE_CERTIFICATE_SYSTEM_PROMPT,
                    temperature: 0.1,
                    responseMimeType: 'application/json'
                }
            }, 3, { tenantId: req.user.tenantId, operation: 'bidding_matching', metadata: { type: 'certificate_comparison' } });
        }
        catch (geminiErr) {
            console.warn(`[AI Oracle] Gemini falhou na comparação: ${geminiErr.message}. Fallback → OpenAI...`);
            const oaiResult = await (0, openai_service_1.fallbackToOpenAiV2)({
                systemPrompt: prompt_service_1.COMPARE_CERTIFICATE_SYSTEM_PROMPT,
                userPrompt: userContent,
                temperature: 0.1,
                stageName: 'oracle-compare'
            });
            result = { text: oaiResult.text };
        }
        const analysis = (0, parser_service_1.robustJsonParse)(result.text);
        res.json(analysis);
    }
    catch (error) {
        console.error("Comparison error:", error);
        res.status(500).json({ error: 'Failed to analyze compatibility', details: error.message });
    }
});
// ═══════════════════════════════════════════
// Documents List + Upload (extracted from index.ts)
// ═══════════════════════════════════════════
router.get('/', auth_1.authenticateToken, async (req, res) => {
    try {
        const documents = await prisma_1.default.document.findMany({
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
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch documents' });
    }
});
// File Upload endpoint (Protected)
router.post('/upload', auth_1.authenticateToken, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        const { url: fileUrl, fileName } = await storage_1.storageService.uploadFile(req.file, req.user.tenantId);
        // Register in Document table (Crucial for security and context mapping)
        const document = await prisma_1.default.document.create({
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
    }
    catch (error) {
        console.error("Upload error:", error);
        res.status(500).json({ error: 'File upload failed' });
    }
});
exports.default = router;
