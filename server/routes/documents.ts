import express from 'express';
import multer from 'multer';
import prisma from '../lib/prisma';
import { authenticateToken } from '../middlewares/auth';
import { storageService } from '../storage';
import { GoogleGenAI } from '@google/genai';
import { robustJsonParse } from '../services/ai/parser.service';
import { callGeminiWithRetry } from '../services/ai/gemini.service';
import { EXTRACT_CERTIFICATE_SYSTEM_PROMPT, COMPARE_CERTIFICATE_SYSTEM_PROMPT } from '../services/ai/prompt.service';
import { buildModuleContext } from '../services/ai/modules/moduleContextContracts';

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// ── Documents CRUD ──

// Create document
router.post('/documents', authenticateToken, upload.single('file'), async (req: any, res) => {
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
                fileContent: req.file.buffer,
                alertDays: req.body.alertDays ? parseInt(req.body.alertDays) : 15
            }
        });

        res.json(doc);
    } catch (error) {
        console.error("Upload error:", error);
        res.status(500).json({ error: 'Failed to upload document', details: error instanceof Error ? error.message : String(error) });
    }
});

// Update document
router.put('/documents/:id', authenticateToken, upload.single('file'), async (req: any, res) => {
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
            try {
                await storageService.deleteFile(doc.fileUrl);
            } catch (e) {
                console.warn("Could not delete old file:", doc.fileUrl);
            }
            const { url: fileUrl } = await storageService.uploadFile(req.file, tenantId);
            fileData = {
                fileUrl,
                fileName: req.file.originalname,
                fileContent: req.file.buffer
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

// Delete document
router.delete('/documents/:id', authenticateToken, async (req: any, res) => {
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

// ── Technical Certificates (Oráculo de Atestados) ──

router.get('/technical-certificates', authenticateToken, async (req: any, res) => {
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

router.post('/technical-certificates', authenticateToken, upload.single('file'), async (req: any, res: any) => {
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
        }, 3, { tenantId: req.user.tenantId, operation: 'process_document', metadata: { docType: 'technical_certificate' } });

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

router.delete('/technical-certificates/:id', authenticateToken, async (req: any, res) => {
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

router.post('/technical-certificates/compare', authenticateToken, async (req: any, res) => {
    try {
        const { biddingProcessId, technicalCertificateIds } = req.body;
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

        let requirements: string;
        if (bidding.aiAnalysis?.schemaV2) {
            requirements = buildModuleContext(bidding.aiAnalysis.schemaV2, 'oracle');
            console.log(`[AI Oracle] Using buildModuleContext('oracle') for comparison`);
        } else {
            requirements = bidding.aiAnalysis?.qualificationRequirements || bidding.summary || "";
        }

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
        }, 3, { tenantId: req.user.tenantId, operation: 'bidding_matching', metadata: { type: 'certificate_comparison' } });

        const analysis = robustJsonParse(result.text);
        res.json(analysis);
    } catch (error: any) {
        console.error("Comparison error:", error);
        res.status(500).json({ error: 'Failed to analyze compatibility', details: error.message });
    }
});

export default router;
