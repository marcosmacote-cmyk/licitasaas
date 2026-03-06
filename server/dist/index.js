"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const parser_service_1 = require("./services/ai/parser.service");
const gemini_service_1 = require("./services/ai/gemini.service");
const prompt_service_1 = require("./services/ai/prompt.service");
const openai_service_1 = require("./services/ai/openai.service");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const dotenv_1 = __importDefault(require("dotenv"));
const axios_1 = __importDefault(require("axios"));
const https_1 = __importDefault(require("https"));
const client_1 = require("@prisma/client");
const multer_1 = __importDefault(require("multer"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const genai_1 = require("@google/genai");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const storage_1 = require("./storage");
const node_unrar_js_1 = require("node-unrar-js");
// Resolve server root (handles both ts-node and compiled dist/)
const SERVER_ROOT = __dirname.endsWith('dist') ? path_1.default.resolve(__dirname, '..') : __dirname;
// Load .env only if it exists (don't override Railway/Docker env vars)
dotenv_1.default.config({ path: path_1.default.join(SERVER_ROOT, '.env'), override: false });
const app = (0, express_1.default)();
const prisma = new client_1.PrismaClient();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret';
app.use((0, cors_1.default)());
app.use(express_1.default.json({ limit: '50mb' }));
app.use(express_1.default.urlencoded({ extended: true, limit: '50mb' }));
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
        if (!user || !(await bcryptjs_1.default.compare(password, user.passwordHash))) {
            return res.status(401).json({ error: 'Email ou senha inválidos' });
        }
        const token = jsonwebtoken_1.default.sign({ userId: user.id, tenantId: user.tenantId, role: user.role }, JWT_SECRET, { expiresIn: '8h' });
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
    }
    catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ error: 'Erro interno ao realizar login' });
    }
});
// Middleware de Autenticação
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (!token)
        return res.status(401).json({ error: 'Token não fornecido' });
    jsonwebtoken_1.default.verify(token, JWT_SECRET, (err, decoded) => {
        if (err)
            return res.status(403).json({ error: 'Token inválido ou expirado' });
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
async function getFileBufferSafe(fileNameOrUrl, tenantId) {
    try {
        // Try Storage Service first
        return await storage_1.storageService.getFileBuffer(fileNameOrUrl);
    }
    catch (err) {
        console.warn(`[Storage] StorageService failed for ${fileNameOrUrl}, trying fallbacks...`);
        // 1. Local disk fallback (legacy or local mode)
        const pureName = path_1.default.basename(fileNameOrUrl).split('?')[0];
        const localPath = path_1.default.join(uploadDir, pureName);
        if (fs_1.default.existsSync(localPath)) {
            return fs_1.default.readFileSync(localPath);
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
const uploadDir = path_1.default.join(SERVER_ROOT, 'uploads');
if (!fs_1.default.existsSync(uploadDir)) {
    fs_1.default.mkdirSync(uploadDir, { recursive: true });
}
// Gemini Setup (lazy - don't crash if key missing)
const apiKey = process.env.GEMINI_API_KEY || '';
console.log('Gemini API Key present:', !!apiKey);
let genAI = null;
if (apiKey) {
    genAI = new genai_1.GoogleGenAI({
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
        const filePath = path_1.default.join(uploadDir, filename);
        // If file exists on disk (cache hit), serve it immediately
        if (fs_1.default.existsSync(filePath)) {
            return res.sendFile(filePath);
        }
        // Recovery mode: If file is missing on disk, search in Database
        // We match by the end of the URL (filename)
        const doc = await prisma.document.findFirst({
            where: { fileUrl: { endsWith: filename } }
        });
        if (doc && doc.fileContent) {
            console.log(`[Persistence] Recovering ${filename} from database to disk...`);
            fs_1.default.writeFileSync(filePath, doc.fileContent);
            return res.sendFile(filePath);
        }
        next();
    }
    catch (error) {
        console.error(`[Persistence] Error during file recovery:`, error);
        next();
    }
});
// Fallback static serving (still good for files that ARE there)
app.use('/uploads', express_1.default.static(uploadDir));
// Configure Multer storage to use Memory (for cloud readiness)
const upload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage() });
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
    }
    catch (e) {
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
    }
    catch (e) {
        res.status(400).json({ error: e.message });
    }
});
// Tenants (Seed support or manual creation)
app.post('/api/tenants', async (req, res) => {
    try {
        const tenant = await prisma.tenant.create({ data: req.body });
        res.json(tenant);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to create tenant' });
    }
});
// Companies
app.get('/api/companies', authenticateToken, async (req, res) => {
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
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch companies' });
    }
});
// Documents
app.post('/api/documents', authenticateToken, upload.single('file'), async (req, res) => {
    try {
        const { companyProfileId, docType, expirationDate, status, docGroup, issuerLink } = req.body;
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        const tenantId = req.user.tenantId;
        const { url: fileUrl } = await storage_1.storageService.uploadFile(req.file, tenantId);
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
    }
    catch (error) {
        console.error("Upload error:", error);
        res.status(500).json({ error: 'Failed to upload document', details: error instanceof Error ? error.message : String(error) });
    }
});
app.put('/api/documents/:id', authenticateToken, upload.single('file'), async (req, res) => {
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
                await storage_1.storageService.deleteFile(doc.fileUrl);
            }
            catch (e) {
                console.warn("Could not delete old file:", doc.fileUrl);
            }
            const { url: fileUrl } = await storage_1.storageService.uploadFile(req.file, tenantId);
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
    }
    catch (error) {
        console.error("Update doc error:", error);
        res.status(500).json({ error: 'Failed to update document' });
    }
});
app.delete('/api/documents/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const doc = await prisma.document.findUnique({
            where: { id }
        });
        if (doc && doc.tenantId === req.user.tenantId) {
            await storage_1.storageService.deleteFile(doc.fileUrl);
            await prisma.document.delete({ where: { id } });
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
app.put('/api/companies/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const tenantId = req.user.tenantId;
        const company = await prisma.companyProfile.findUnique({ where: { id } });
        if (!company || company.tenantId !== tenantId) {
            return res.status(404).json({ error: 'Company not found or unauthorized' });
        }
        // Only allow updating editable fields — strip out id, tenantId, relations
        const { razaoSocial, cnpj, isHeadquarters, qualification, technicalQualification, contactName, contactEmail, contactPhone, contactCpf, address, city, state } = req.body;
        const safeData = {};
        if (razaoSocial !== undefined)
            safeData.razaoSocial = razaoSocial;
        if (cnpj !== undefined)
            safeData.cnpj = cnpj;
        if (isHeadquarters !== undefined)
            safeData.isHeadquarters = isHeadquarters;
        if (qualification !== undefined)
            safeData.qualification = qualification;
        if (technicalQualification !== undefined)
            safeData.technicalQualification = technicalQualification;
        if (contactName !== undefined)
            safeData.contactName = contactName;
        if (contactEmail !== undefined)
            safeData.contactEmail = contactEmail;
        if (contactPhone !== undefined)
            safeData.contactPhone = contactPhone;
        if (contactCpf !== undefined)
            safeData.contactCpf = contactCpf;
        if (address !== undefined)
            safeData.address = address;
        if (city !== undefined)
            safeData.city = city;
        if (state !== undefined)
            safeData.state = state;
        const updatedCompany = await prisma.companyProfile.update({
            where: { id },
            data: safeData,
            include: { credentials: true, documents: { select: { id: true, tenantId: true, companyProfileId: true, docType: true, fileUrl: true, uploadDate: true, expirationDate: true, status: true, autoRenew: true, docGroup: true, issuerLink: true, fileName: true, alertDays: true } } }
        });
        res.json(updatedCompany);
    }
    catch (error) {
        console.error("Update company error:", error);
        res.status(500).json({ error: 'Failed to update company', details: error.message });
    }
});
app.post('/api/companies', authenticateToken, async (req, res) => {
    try {
        const tenantId = req.user.tenantId;
        const company = await prisma.companyProfile.create({
            data: { ...req.body, tenantId }
        });
        res.json(company);
    }
    catch (error) {
        console.error("Create company error:", error);
        res.status(500).json({ error: 'Failed to create company' });
    }
});
app.delete('/api/companies/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const company = await prisma.companyProfile.findUnique({ where: { id } });
        if (company && company.tenantId === req.user.tenantId) {
            await prisma.companyProfile.delete({ where: { id } });
            res.json({ success: true });
        }
        else {
            res.status(404).json({ error: 'Company not found or unauthorized' });
        }
    }
    catch (error) {
        console.error("Delete company error:", error);
        res.status(500).json({ error: 'Failed to delete company' });
    }
});
// Credentials
app.post('/api/credentials', authenticateToken, async (req, res) => {
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
    }
    catch (error) {
        console.error("Create credential error:", error);
        res.status(500).json({ error: 'Failed to create credential' });
    }
});
app.put('/api/credentials/:id', authenticateToken, async (req, res) => {
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
    }
    catch (error) {
        console.error("Update credential error:", error);
        res.status(500).json({ error: 'Failed to update credential' });
    }
});
app.delete('/api/credentials/:id', authenticateToken, async (req, res) => {
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
    }
    catch (error) {
        console.error("Delete credential error:", error);
        res.status(500).json({ error: 'Failed to delete credential' });
    }
});
// App Config / Settings
app.get('/api/config/alerts', authenticateToken, async (req, res) => {
    try {
        const config = await prisma.globalConfig.findUnique({
            where: { tenantId: req.user.tenantId }
        });
        const parsed = config ? JSON.parse(config.config) : { defaultAlertDays: 15 };
        res.json(parsed);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch config' });
    }
});
app.post('/api/config/alerts', authenticateToken, async (req, res) => {
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
            const excludeWhere = { tenantId: req.user.tenantId };
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
            const toValido = [];
            const toVencendo = [];
            const toVencido = [];
            for (const doc of allDocs) {
                let status = 'Válido';
                if (doc.expirationDate) {
                    const diffTime = new Date(doc.expirationDate).getTime() - new Date().getTime();
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                    if (diffDays < 0)
                        status = 'Vencido';
                    else if (diffDays <= (doc.alertDays || Number(defaultAlertDays)))
                        status = 'Vencendo';
                }
                if (doc.status !== status) {
                    if (status === 'Válido')
                        toValido.push(doc.id);
                    else if (status === 'Vencendo')
                        toVencendo.push(doc.id);
                    else if (status === 'Vencido')
                        toVencido.push(doc.id);
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
    }
    catch (error) {
        console.error("Config save error:", error);
        res.status(500).json({ error: error.message || 'Failed to update config' });
    }
});
app.post('/api/generate-declaration', authenticateToken, async (req, res) => {
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
        }
        else {
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
        const result = await (0, gemini_service_1.callGeminiWithRetry)(genAI.models, {
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
        }
        catch (e) {
            res.json({ text: rawResponse.replace(/\*\*/g, ''), title: declarationType.substring(0, 50) });
        }
    }
    catch (error) {
        console.error("Declaration generation error:", error);
        res.status(500).json({ error: 'Failed to generate declaration', details: error?.message || 'Erro desconhecido' });
    }
});
// PNCP Proxy and Saved Searches
app.get('/api/pncp/searches', authenticateToken, async (req, res) => {
    try {
        const searches = await prisma.pncpSavedSearch.findMany({
            where: { tenantId: req.user.tenantId },
            include: { company: true },
            orderBy: { createdAt: 'desc' }
        });
        res.json(searches);
    }
    catch (error) {
        console.error("Fetch saved searches error:", error);
        res.status(500).json({ error: 'Failed to fetch saved searches' });
    }
});
app.post('/api/pncp/searches', authenticateToken, async (req, res) => {
    try {
        const tenantId = req.user.tenantId;
        const search = await prisma.pncpSavedSearch.create({
            data: { ...req.body, tenantId }
        });
        res.json(search);
    }
    catch (error) {
        console.error("Create saved search error:", error);
        res.status(500).json({ error: 'Failed to create saved search' });
    }
});
app.delete('/api/pncp/searches/:id', authenticateToken, async (req, res) => {
    try {
        const id = req.params.id;
        const tenantId = req.user.tenantId;
        await prisma.pncpSavedSearch.deleteMany({
            where: { id, tenantId }
        });
        res.json({ success: true });
    }
    catch (error) {
        console.error("Delete saved search error:", error);
        res.status(500).json({ error: 'Failed to delete saved search' });
    }
});
app.post('/api/pncp/search', authenticateToken, async (req, res) => {
    try {
        const { keywords, status, uf, pagina = 1, modalidade, dataInicio, dataFim, esfera, orgao, orgaosLista } = req.body;
        const pageSize = 10;
        let kwList = [];
        if (keywords) {
            if (keywords.includes(',')) {
                kwList = keywords.split(',')
                    .map((k) => k.trim().replace(/^"|"$/g, ''))
                    .filter((k) => k.length > 0)
                    .map((k) => k.includes(' ') ? `"${k}"` : k);
            }
            else {
                kwList = [keywords.includes(' ') && !keywords.startsWith('"') ? `"${keywords}"` : keywords];
            }
        }
        const buildBaseUrl = (qItems, overrideCnpj) => {
            let url = `https://pncp.gov.br/api/search/?tipos_documento=edital&ordenacao=-data&tam_pagina=${overrideCnpj ? 100 : 500}&pagina=1`;
            if (overrideCnpj) {
                url += `&cnpj=${overrideCnpj}`;
            }
            if (qItems.length > 0) {
                url += `&q=${encodeURIComponent(qItems.join(' AND '))}`;
            }
            if (status && status !== 'todas')
                url += `&status=${status}`;
            if (uf)
                url += `&ufs=${uf}`; // Allow comma-separated UFs
            if (modalidade && modalidade !== 'todas')
                url += `&modalidades_licitacao=${encodeURIComponent(modalidade)}`;
            if (dataInicio)
                url += `&data_inicio=${dataInicio}`;
            if (dataFim)
                url += `&data_fim=${dataFim}`;
            if (esfera && esfera !== 'todas')
                url += `&esferas=${esfera}`;
            return url;
        };
        let extractedNames = [];
        if (orgaosLista) {
            extractedNames = orgaosLista.split(/[\n,;]+/).map((s) => s.trim().replace(/^"|"$/g, '')).filter((s) => s.length > 0);
            extractedNames = [...new Set(extractedNames)]; // Remove duplicates
        }
        let urlsToFetch = [];
        const keywordsToIterate = kwList.length > 0 ? kwList : [null];
        const orgaosToIterate = extractedNames.length > 0 ? extractedNames : (orgao ? [orgao] : [null]);
        for (const kw of keywordsToIterate) {
            for (const org of orgaosToIterate) {
                let localParams = [];
                let overrideCnpj = undefined;
                if (kw)
                    localParams.push(kw);
                if (org) {
                    const onlyNumbers = org.replace(/\D/g, '');
                    if (onlyNumbers.length === 14) {
                        overrideCnpj = onlyNumbers;
                    }
                    else {
                        const exactOrgName = org.includes(' ') && !org.startsWith('"') ? `"${org}"` : org;
                        localParams.push(exactOrgName);
                    }
                }
                urlsToFetch.push(buildBaseUrl(localParams, overrideCnpj));
            }
        }
        // Limit max generated combinations to 1000 to avoid complete application DOS (extreme user input).
        urlsToFetch = urlsToFetch.slice(0, 1000);
        const agent = new https_1.default.Agent({ rejectUnauthorized: false });
        const startTime = Date.now();
        console.log(`[PNCP] START GET ${urlsToFetch.length} url(s) in batches...`);
        let rawItems = [];
        const chunkSize = 60;
        for (let i = 0; i < urlsToFetch.length; i += chunkSize) {
            const chunk = urlsToFetch.slice(i, i + chunkSize);
            const responses = await Promise.allSettled(chunk.map(u => axios_1.default.get(u, {
                headers: { 'Accept': 'application/json' },
                httpsAgent: agent,
                timeout: 25000
            })));
            responses.forEach((res) => {
                if (res.status === 'fulfilled') {
                    const data = res.value.data;
                    const items = Array.isArray(data?.items) ? data.items : (Array.isArray(data?.data) ? data.data : []);
                    rawItems = rawItems.concat(items);
                }
                else {
                    console.error('[PNCP] Request failed:', res.reason?.message);
                }
            });
        }
        // First pass: extract what we can from search results
        // Also ensure no duplicate results based on PNCP ID just in case
        const seenIds = new Set();
        const items = rawItems.filter(item => item != null).map((item) => {
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
            if (seenIds.has(item.id))
                return false;
            seenIds.add(item.id);
            return true;
        });
        // GLOBAL sort ALL items by closest deadline using search API dates
        const now = Date.now();
        items.sort((a, b) => {
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
        const hydratedPageItems = await Promise.all(pageItems.map(async (item) => {
            if (item.orgao_cnpj && item.ano && item.numero_sequencial) {
                try {
                    const detailUrl = `https://pncp.gov.br/api/consulta/v1/orgaos/${item.orgao_cnpj}/compras/${item.ano}/${item.numero_sequencial}`;
                    const detailRes = await axios_1.default.get(detailUrl, { httpsAgent: agent, timeout: 5000 });
                    const d = detailRes.data;
                    if (d) {
                        if (!item.valor_estimado) {
                            const v = Number(d.valorTotalEstimado ?? d.valorTotalHomologado ?? d.valorGlobal ?? 0);
                            if (v > 0)
                                item.valor_estimado = v;
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
                }
                catch (e) {
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
    }
    catch (error) {
        console.error("PNCP search error:", error?.message || error);
        res.status(502).json({ error: 'Falha ao comunicar com a API do PNCP', details: error?.message || 'Erro desconhecido' });
    }
});
// ─── AI Services Imports estão no topo do arquivo ───
// PNCP AI Analysis — analyzes a PNCP edital directly by fetching its PDF files
app.post('/api/pncp/analyze', authenticateToken, async (req, res) => {
    try {
        const { orgao_cnpj, ano, numero_sequencial, link_sistema } = req.body;
        if (!orgao_cnpj || !ano || !numero_sequencial) {
            return res.status(400).json({ error: 'orgao_cnpj, ano e numero_sequencial são obrigatórios' });
        }
        const agent = new https_1.default.Agent({ rejectUnauthorized: false });
        const JSZip = require('jszip');
        // 1. Fetch edital attachments from PNCP API (correct endpoint: /api/pncp/v1/)
        const arquivosUrl = `https://pncp.gov.br/api/pncp/v1/orgaos/${orgao_cnpj}/compras/${ano}/${numero_sequencial}/arquivos`;
        console.log(`[PNCP-AI] Fetching attachments: ${arquivosUrl}`);
        let arquivos = [];
        try {
            const arquivosRes = await axios_1.default.get(arquivosUrl, { httpsAgent: agent, timeout: 10000 });
            arquivos = Array.isArray(arquivosRes.data) ? arquivosRes.data : [];
            console.log(`[PNCP-AI] Found ${arquivos.length} attachments`);
        }
        catch (e) {
            console.warn(`[PNCP-AI] Failed to fetch attachments: ${e.message}`);
        }
        // 2. Sort to prioritize: Edital (tipoDocumentoId=2) > Termo de Referência (4) > Others
        arquivos.sort((a, b) => {
            const priority = { 2: 0, 4: 1 }; // Edital, TR
            const pa = priority[a.tipoDocumentoId] ?? 99;
            const pb = priority[b.tipoDocumentoId] ?? 99;
            return pa - pb;
        });
        // 3. Download and process files (PDF, ZIP, or RAR containing PDFs)
        const MAX_PDF_PARTS = 5; // Increased from 3 to handle complex editals
        const pdfParts = [];
        const downloadedFiles = [];
        for (const arq of arquivos) {
            if (pdfParts.length >= MAX_PDF_PARTS)
                break;
            const fileUrl = arq.url || arq.uri || '';
            const fileName = arq.titulo || arq.nomeArquivo || arq.nome || 'arquivo';
            if (!fileUrl || !arq.statusAtivo)
                continue;
            try {
                console.log(`[PNCP-AI] Downloading: "${fileName}" (tipo: ${arq.tipoDocumentoDescricao || arq.tipoDocumentoId}) from ${fileUrl}`);
                const fileRes = await axios_1.default.get(fileUrl, {
                    httpsAgent: agent,
                    timeout: 90000,
                    responseType: 'arraybuffer',
                    maxRedirects: 5
                });
                const buffer = Buffer.from(fileRes.data);
                if (buffer.length === 0)
                    continue;
                // Detect file type by magic bytes
                const isPdf = buffer[0] === 0x25 && buffer[1] === 0x50 && buffer[2] === 0x44 && buffer[3] === 0x46; // %PDF
                const isZip = buffer[0] === 0x50 && buffer[1] === 0x4B; // PK
                const isRar = buffer[0] === 0x52 && buffer[1] === 0x61 && buffer[2] === 0x72 && buffer[3] === 0x21; // Rar!
                if (isPdf) {
                    const safeFileName = `pncp_${req.user.tenantId}_${fileName.replace(/[^a-z0-9._-]/gi, '_')}`;
                    fs_1.default.writeFileSync(path_1.default.join(uploadDir, safeFileName), buffer);
                    pdfParts.push({
                        inlineData: { data: buffer.toString('base64'), mimeType: 'application/pdf' }
                    });
                    downloadedFiles.push(safeFileName);
                    console.log(`[PNCP-AI] ✅ PDF: ${fileName} saved as ${safeFileName} (${(buffer.length / 1024).toFixed(0)} KB)`);
                }
                else if (isZip) {
                    console.log(`[PNCP-AI] 📦 ZIP detected: ${fileName} (${(buffer.length / 1024).toFixed(0)} KB) — extracting PDFs...`);
                    try {
                        const zip = await JSZip.loadAsync(buffer);
                        const zipEntries = Object.keys(zip.files).filter((name) => name.toLowerCase().endsWith('.pdf') && !zip.files[name].dir);
                        console.log(`[PNCP-AI] ZIP contains ${zipEntries.length} PDF(s): ${zipEntries.join(', ')}`);
                        for (const entryName of zipEntries) {
                            if (pdfParts.length >= MAX_PDF_PARTS)
                                break;
                            const pdfBuffer = await zip.files[entryName].async('nodebuffer');
                            if (pdfBuffer.length > 0) {
                                const safeName = `pncp_${req.user.tenantId}_${entryName.replace(/[^a-z0-9._-]/gi, '_')}`;
                                fs_1.default.writeFileSync(path_1.default.join(uploadDir, safeName), pdfBuffer);
                                pdfParts.push({
                                    inlineData: { data: pdfBuffer.toString('base64'), mimeType: 'application/pdf' }
                                });
                                downloadedFiles.push(safeName);
                                console.log(`[PNCP-AI] ✅ Extracted from ZIP: ${entryName} saved as ${safeName} (${(pdfBuffer.length / 1024).toFixed(0)} KB)`);
                            }
                        }
                    }
                    catch (zipErr) {
                        console.warn(`[PNCP-AI] Failed to extract ZIP ${fileName}: ${zipErr.message}`);
                    }
                }
                else if (isRar) {
                    console.log(`[PNCP-AI] 📦 RAR detected: ${fileName} (${(buffer.length / 1024).toFixed(0)} KB) — extracting PDFs...`);
                    try {
                        const extractor = await (0, node_unrar_js_1.createExtractorFromData)({ data: new Uint8Array(buffer).buffer });
                        const extracted = extractor.extract({});
                        const files = [...extracted.files];
                        const pdfFiles = files.filter(f => f.fileHeader.name.toLowerCase().endsWith('.pdf') &&
                            !f.fileHeader.flags.directory &&
                            f.extraction);
                        console.log(`[PNCP-AI] RAR contains ${pdfFiles.length} PDF(s): ${pdfFiles.map(f => f.fileHeader.name).join(', ')}`);
                        for (const rarFile of pdfFiles) {
                            if (pdfParts.length >= MAX_PDF_PARTS)
                                break;
                            if (rarFile.extraction && rarFile.extraction.length > 0) {
                                const pdfBuffer = Buffer.from(rarFile.extraction);
                                pdfParts.push({
                                    inlineData: { data: pdfBuffer.toString('base64'), mimeType: 'application/pdf' }
                                });
                                downloadedFiles.push(`${fileName}/${rarFile.fileHeader.name}`);
                                console.log(`[PNCP-AI] ✅ Extracted from RAR: ${rarFile.fileHeader.name} (${(pdfBuffer.length / 1024).toFixed(0)} KB)`);
                            }
                        }
                    }
                    catch (rarErr) {
                        console.warn(`[PNCP-AI] Failed to extract RAR ${fileName}: ${rarErr.message}`);
                    }
                }
                else {
                    console.log(`[PNCP-AI] ⏭️ Skipped non-PDF/non-ZIP/non-RAR: ${fileName} (first bytes: ${buffer[0].toString(16)} ${buffer[1].toString(16)})`);
                }
            }
            catch (dlErr) {
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
        const ai = new genai_1.GoogleGenAI({ apiKey });
        // 4. Use enhanced analysis prompt with strict precision for financial data, deadlines, OCR, and Qualificação Técnica
        const systemInstruction = prompt_service_1.ANALYZE_EDITAL_SYSTEM_PROMPT;
        console.log(`[PNCP-AI] Calling Gemini with ${pdfParts.length} PDF parts (files: ${downloadedFiles.join(', ')})...`);
        let response;
        const startTime = Date.now();
        try {
            response = await (0, gemini_service_1.callGeminiWithRetry)(ai.models, {
                model: 'gemini-2.5-flash',
                contents: [{
                        role: 'user',
                        parts: [
                            ...pdfParts,
                            { text: prompt_service_1.USER_ANALYSIS_INSTRUCTION }
                        ]
                    }],
                config: {
                    systemInstruction,
                    temperature: 0.1,
                    maxOutputTokens: 32768,
                    responseMimeType: 'application/json'
                }
            });
        }
        catch (geminiError) {
            console.warn(`[PNCP-AI] Gemini falhou miseravelmente: ${geminiError.message}. Tentando OpenAI gpt-4o-mini Fallback...`);
            try {
                response = await (0, openai_service_1.fallbackToOpenAi)(pdfParts, systemInstruction, prompt_service_1.USER_ANALYSIS_INSTRUCTION);
            }
            catch (openAiError) {
                console.error(`[PNCP-AI] O Fallback via OpenAI também falhou: ${openAiError.message}`);
                throw new Error(`Ambas IAs falharam. Gemini: ${geminiError.message} | OpenAI: ${openAiError.message}`);
            }
        }
        const duration = (Date.now() - startTime) / 1000;
        console.log(`[PNCP-AI] Gemini responded in ${duration.toFixed(1)}s`);
        const rawText = response.text;
        if (!rawText)
            throw new Error('A IA não retornou nenhum texto.');
        // 5. Parse JSON with robust multi-strategy parser
        const finalPayload = (0, parser_service_1.robustJsonParse)(rawText, 'PNCP-AI');
        // Add source info
        finalPayload.pncpSource = {
            link_sistema,
            downloadedFiles,
            analyzedAt: new Date().toISOString()
        };
        console.log(`[PNCP-AI] SUCCESS — process keys: ${Object.keys(finalPayload.process || {}).join(', ')}`);
        res.json(finalPayload);
    }
    catch (error) {
        console.error('[PNCP-AI] Error:', error?.message || error);
        res.status(500).json({ error: `Erro na análise IA do PNCP: ${error?.message || 'Erro desconhecido'}` });
    }
});
// Bidding Processes
app.get('/api/biddings', authenticateToken, async (req, res) => {
    try {
        const biddings = await prisma.biddingProcess.findMany({
            where: { tenantId: req.user.tenantId },
            include: { aiAnalysis: true }
        });
        res.json(biddings);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch biddings' });
    }
});
app.post('/api/biddings', authenticateToken, async (req, res) => {
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
    }
    catch (error) {
        console.error("Create bidding error:", error);
        res.status(500).json({ error: 'Failed to create bidding', details: error instanceof Error ? error.message : String(error) });
    }
});
app.put('/api/biddings/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const tenantId = req.user.tenantId;
        // Remove relation fields and id to avoid Prisma update errors
        const { aiAnalysis, company, tenant, id: _id, tenantId: _tId, companyProfileId, ...biddingData } = req.body;
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
    }
    catch (error) {
        console.error("Update bidding error:", error);
        res.status(500).json({ error: 'Failed to update bidding', details: error instanceof Error ? error.message : String(error) });
    }
});
app.delete('/api/biddings/:id', authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const bidding = await prisma.biddingProcess.findUnique({ where: { id } });
        if (bidding && bidding.tenantId === req.user.tenantId) {
            await prisma.biddingProcess.delete({ where: { id } });
            res.json({ success: true });
        }
        else {
            res.status(404).json({ error: 'Bidding not found or unauthorized' });
        }
    }
    catch (error) {
        console.error("Delete bidding error:", error);
        res.status(500).json({ error: 'Failed to delete bidding' });
    }
});
// Ai Analysis
app.post('/api/analysis', authenticateToken, async (req, res) => {
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
        const stringifyIfObject = (field) => {
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
    }
    catch (error) {
        console.error("Create analysis error:", error);
        res.status(500).json({ error: 'Failed to save AI analysis' });
    }
});
// Basic Documents Fetch (Scoped)
app.get('/api/documents', authenticateToken, async (req, res) => {
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
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch documents' });
    }
});
// File Upload endpoint (Protected)
app.post('/api/upload', authenticateToken, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        const { url: fileUrl, fileName } = await storage_1.storageService.uploadFile(req.file, req.user.tenantId);
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
    }
    catch (error) {
        console.error("Upload error:", error);
        res.status(500).json({ error: 'File upload failed' });
    }
});
// ═══════════════════════════════════════════════════════════════════════
// Price Proposal CRUD + AI Populate
// ═══════════════════════════════════════════════════════════════════════
// GET proposals for a bidding process
app.get('/api/proposals/:biddingId', authenticateToken, async (req, res) => {
    try {
        const proposals = await prisma.priceProposal.findMany({
            where: { biddingProcessId: req.params.biddingId, tenantId: req.user.tenantId },
            include: { items: { orderBy: { sortOrder: 'asc' } }, company: true },
            orderBy: { version: 'desc' },
        });
        res.json(proposals);
    }
    catch (error) {
        console.error('[Proposals] GET error:', error.message);
        res.status(500).json({ error: 'Failed to fetch proposals' });
    }
});
// GET single proposal with items
app.get('/api/proposals/detail/:id', authenticateToken, async (req, res) => {
    try {
        const proposal = await prisma.priceProposal.findFirst({
            where: { id: req.params.id, tenantId: req.user.tenantId },
            include: { items: { orderBy: { sortOrder: 'asc' } }, company: true, biddingProcess: true },
        });
        if (!proposal)
            return res.status(404).json({ error: 'Proposal not found' });
        res.json(proposal);
    }
    catch (error) {
        console.error('[Proposals] GET detail error:', error.message);
        res.status(500).json({ error: 'Failed to fetch proposal' });
    }
});
// POST create proposal
app.post('/api/proposals', authenticateToken, async (req, res) => {
    try {
        const { biddingProcessId, companyProfileId, bdiPercentage, taxPercentage, socialCharges, validityDays, notes } = req.body;
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
            },
            include: { items: true, company: true },
        });
        console.log(`[Proposals] Created proposal ${proposal.id} v${proposal.version} for bidding ${biddingProcessId}`);
        res.status(201).json(proposal);
    }
    catch (error) {
        console.error('[Proposals] POST error:', error.message);
        res.status(500).json({ error: 'Failed to create proposal' });
    }
});
// PUT update proposal
app.put('/api/proposals/:id', authenticateToken, async (req, res) => {
    try {
        const { bdiPercentage, taxPercentage, socialCharges, validityDays, notes, status, letterContent, companyLogo, headerImage, footerImage, headerImageHeight, footerImageHeight, signatureMode, signatureCity } = req.body;
        const existing = await prisma.priceProposal.findFirst({
            where: { id: req.params.id, tenantId: req.user.tenantId },
        });
        if (!existing)
            return res.status(404).json({ error: 'Proposal not found' });
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
        const totalValue = updated.items.reduce((sum, item) => sum + (item.totalPrice || 0), 0);
        await prisma.priceProposal.update({ where: { id: req.params.id }, data: { totalValue } });
        updated.totalValue = totalValue;
        res.json(updated);
    }
    catch (error) {
        console.error('[Proposals] PUT error:', error.message);
        res.status(500).json({ error: 'Failed to update proposal' });
    }
});
// DELETE proposal
app.delete('/api/proposals/:id', authenticateToken, async (req, res) => {
    try {
        const existing = await prisma.priceProposal.findFirst({
            where: { id: req.params.id, tenantId: req.user.tenantId },
        });
        if (!existing)
            return res.status(404).json({ error: 'Proposal not found' });
        await prisma.priceProposal.delete({ where: { id: req.params.id } });
        res.json({ success: true });
    }
    catch (error) {
        console.error('[Proposals] DELETE error:', error.message);
        res.status(500).json({ error: 'Failed to delete proposal' });
    }
});
// POST add/replace items in bulk (used by AI populate and manual add)
app.post('/api/proposals/:id/items', authenticateToken, async (req, res) => {
    try {
        const { items, replaceAll } = req.body;
        const proposalId = req.params.id;
        const existing = await prisma.priceProposal.findFirst({
            where: { id: proposalId, tenantId: req.user.tenantId },
        });
        if (!existing)
            return res.status(404).json({ error: 'Proposal not found' });
        // Optionally clear existing items
        if (replaceAll) {
            await prisma.proposalItem.deleteMany({ where: { proposalId } });
        }
        // Create items
        const created = [];
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const bdi = existing.bdiPercentage || 0;
            const unitPrice = item.unitCost * (1 + bdi / 100);
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
                    brand: item.brand || null,
                    model: item.model || null,
                    sortOrder: item.sortOrder ?? i,
                },
            });
            created.push(dbItem);
        }
        // Recalculate total
        const allItems = await prisma.proposalItem.findMany({ where: { proposalId } });
        const totalValue = allItems.reduce((sum, it) => sum + (it.totalPrice || 0), 0);
        await prisma.priceProposal.update({ where: { id: proposalId }, data: { totalValue } });
        console.log(`[Proposals] Added ${created.length} items to proposal ${proposalId}, total: R$ ${totalValue.toFixed(2)}`);
        res.json({ items: created, totalValue });
    }
    catch (error) {
        console.error('[Proposals] POST items error:', error.message);
        res.status(500).json({ error: 'Failed to add items' });
    }
});
// PUT update single item
app.put('/api/proposals/:id/items/:itemId', authenticateToken, async (req, res) => {
    try {
        const { itemNumber, description, unit, quantity, multiplier, multiplierLabel, unitCost, referencePrice, brand, model } = req.body;
        const proposalId = req.params.id;
        const itemId = req.params.itemId;
        const proposal = await prisma.priceProposal.findFirst({
            where: { id: proposalId, tenantId: req.user.tenantId },
        });
        if (!proposal)
            return res.status(404).json({ error: 'Proposal not found' });
        const bdi = proposal.bdiPercentage || 0;
        const finalUnitCost = unitCost !== undefined ? unitCost : 0;
        const finalQuantity = quantity !== undefined ? quantity : 0;
        const finalMultiplier = multiplier !== undefined ? multiplier : 1;
        const unitPrice = finalUnitCost * (1 + bdi / 100);
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
                brand: brand ?? null,
                model: model ?? null,
            },
        });
        // Recalculate total
        const allItems = await prisma.proposalItem.findMany({ where: { proposalId } });
        const totalValue = allItems.reduce((sum, it) => sum + (it.totalPrice || 0), 0);
        await prisma.priceProposal.update({ where: { id: proposalId }, data: { totalValue } });
        res.json({ item: updated, totalValue });
    }
    catch (error) {
        console.error('[Proposals] PUT item error:', error.message);
        res.status(500).json({ error: 'Failed to update item' });
    }
});
// DELETE single item
app.delete('/api/proposals/:id/items/:itemId', authenticateToken, async (req, res) => {
    try {
        const proposalId = req.params.id;
        const proposal = await prisma.priceProposal.findFirst({
            where: { id: proposalId, tenantId: req.user.tenantId },
        });
        if (!proposal)
            return res.status(404).json({ error: 'Proposal not found' });
        await prisma.proposalItem.delete({ where: { id: req.params.itemId } });
        // Recalculate total
        const allItems = await prisma.proposalItem.findMany({ where: { proposalId } });
        const totalValue = allItems.reduce((sum, it) => sum + (it.totalPrice || 0), 0);
        await prisma.priceProposal.update({ where: { id: proposalId }, data: { totalValue } });
        res.json({ success: true, totalValue });
    }
    catch (error) {
        console.error('[Proposals] DELETE item error:', error.message);
        res.status(500).json({ error: 'Failed to delete item' });
    }
});
// POST AI Populate — extract items from AI analysis
app.post('/api/proposals/ai-populate', authenticateToken, async (req, res) => {
    try {
        const { biddingProcessId } = req.body;
        // Get bidding with AI analysis
        const bidding = await prisma.biddingProcess.findFirst({
            where: { id: biddingProcessId, tenantId: req.user.tenantId },
            include: { aiAnalysis: true },
        });
        if (!bidding)
            return res.status(404).json({ error: 'Bidding process not found' });
        if (!bidding.aiAnalysis)
            return res.status(400).json({ error: 'No AI analysis found for this bidding. Run the AI analysis first.' });
        const biddingItems = bidding.aiAnalysis.biddingItems || '';
        const pricingInfo = bidding.aiAnalysis.pricingConsiderations || '';
        if (!biddingItems || biddingItems.trim().length < 10) {
            return res.status(400).json({ error: 'AI analysis has no bidding items to extract.' });
        }
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey)
            return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
        const ai = new genai_1.GoogleGenAI({ apiKey });
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
        const result = await (0, gemini_service_1.callGeminiWithRetry)(ai.models, {
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: { temperature: 0.05, maxOutputTokens: 8192 },
        });
        const responseText = result.text?.trim() || '';
        console.log(`[AI Populate] Response (first 300): ${responseText.substring(0, 300)}`);
        let jsonStr = responseText;
        const jsonMatch = responseText.match(/\[[\s\S]*\]/);
        if (jsonMatch)
            jsonStr = jsonMatch[0];
        let items;
        try {
            items = JSON.parse(jsonStr);
        }
        catch {
            console.error('[AI Populate] Failed to parse JSON');
            return res.status(500).json({ error: 'AI returned invalid format', raw: responseText.substring(0, 200) });
        }
        console.log(`[AI Populate] Extracted ${items.length} items from edital`);
        res.json({ items, totalItems: items.length });
    }
    catch (error) {
        console.error('[AI Populate] Error:', error.message);
        res.status(500).json({ error: 'AI populate failed: ' + (error.message || 'Unknown') });
    }
});
// POST AI Letter — generate proposal letter
app.post('/api/proposals/ai-letter', authenticateToken, async (req, res) => {
    try {
        const { biddingProcessId, companyProfileId, totalValue, validityDays, itemsSummary } = req.body;
        const bidding = await prisma.biddingProcess.findFirst({
            where: { id: biddingProcessId, tenantId: req.user.tenantId },
            include: { aiAnalysis: true }
        });
        const company = await prisma.companyProfile.findFirst({
            where: { id: companyProfileId, tenantId: req.user.tenantId },
        });
        if (!bidding || !company)
            return res.status(404).json({ error: 'Bidding or company not found' });
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey)
            return res.status(500).json({ error: 'GEMINI_API_KEY not configured' });
        const ai = new genai_1.GoogleGenAI({ apiKey });
        const prompt = `Gere uma CARTA PROPOSTA formal para licitacao publica brasileira baseada estritamente na Lei 14.133/2021.
Você deve adequar sua carta ao OBJETO e às EXIGÊNCIAS detalhadas abaixo, priorizando o Modelo de Carta Proposta do edital (caso esteja no Resumo do Edital).

DADOS DA LICITAÇÃO E EMPRESA:
- Licitacao: ${bidding.title}
- Modalidade: ${bidding.modality}
- Orgao: Conforme edital
- Empresa: ${company.razaoSocial}
- CNPJ: ${company.cnpj}
- Contato: ${company.contactName || 'Representante Legal'}
- Email: ${company.contactEmail || '-'}
- Telefone: ${company.contactPhone || '-'}
- Valor Total da Proposta: R$ ${totalValue?.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) || '0,00'}
- Validade da Proposta: ${validityDays || 60} dias
- Resumo dos Itens: ${itemsSummary || 'Conforme planilha de precos em anexo'}

RESUMO DO EDITAL (Se baseie nestas informações para o conteúdo da carta, especialmente o Termo de Referência):
${bidding.aiAnalysis?.fullSummary || 'Não disponível'}

INSTRUÇÕES (CRÍTICAS):
1. Use formato formal de carta comercial.
2. Enderece ao Pregoeiro/Comissao de Licitacao.
3. Inclua: referência explícita ao processo, objeto claro, valor total numérico e por extenso EXATOS.
4. Declare todas as condições exigidas na Lei 14.133/2021: que nos preços estão inclusos todos os custos diretos e indiretos, tributos, taxas, fretes, encargos, etc.
5. DECLARE o prazo de validade da proposta (mínimo de ${validityDays || 60} dias).
6. Inclua espaço para inserir DADOS BANCÁRIOS (ex: Banco, Agência, Conta Corrente) a ser preenchido.
7. ATENÇÃO CRÍTICA: NUNCA crie um campo de assinatura no final. NUNCA inclua Local e Data (ex: "Cidade, XX de XXXX de XXXX") no corpo da carta. Eu irei anexar Local, Data e Assinatura fisicamente depois da planilha de preços. Termine o documento em "Atenciosamente," e PARE. Não inclua linhas de assinatura "____________________", nem Local/Data de espécie alguma.
8. NÃO repita no topo da carta o cabeçalho da empresa (razão social, CNPJ, endereço, email, telefone) pois isso já consta no timbrado fixo do documento. Comece endereçando diretamente a Comissão/Pregoeiro.
9. NUNCA LISTE OS ITENS OU PRODUTOS NA CARTA. Não crie listas de materiais ou serviços. Os itens já estarão dispostos na planilha de preços que acompanha a carta. Cite apenas o objeto da licitação de forma resumida no primeiro parágrafo.
10. Evite repetições óbvias, use linguagem jurídica formal, clara e coesa.
11. Retorne APENAS o texto da carta, sem nenhum tipo de markdown (não coloque tags \`\`\` nem títulos HTML nem asteriscos). 

IMPORTANTE: Escreva o valor por extenso de forma impecável. Não coloque campos de assinatura, Local ou Data, nem listas de itens.`;
        const result = await (0, gemini_service_1.callGeminiWithRetry)(ai.models, {
            model: 'gemini-2.5-flash',
            contents: prompt,
            config: { temperature: 0.2, maxOutputTokens: 4096 },
        });
        const letterContent = result.text?.trim() || '';
        console.log(`[AI Letter] Generated letter (${letterContent.length} chars) for bidding ${biddingProcessId}`);
        res.json({ letterContent });
    }
    catch (error) {
        console.error('[AI Letter] Error:', error.message);
        res.status(500).json({ error: 'Letter generation failed: ' + (error.message || 'Unknown') });
    }
});
// ═══════════════════════════════════════════════════════════════════════
// Dossier AI Matching — Gemini-powered document-to-requirement matching
// ═══════════════════════════════════════════════════════════════════════
app.post('/api/dossier/ai-match', authenticateToken, async (req, res) => {
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
        const ai = new genai_1.GoogleGenAI({ apiKey });
        // Build compact document list
        const docListStr = documents.map((d, i) => `  DOC[${i}]: Tipo="${d.docType}" | Arquivo="${d.fileName}" | Grupo="${d.docGroup || 'N/A'}" | Vencimento="${d.expirationDate || 'Sem vencimento'}"`).join('\n');
        // Build compact requirements list
        const reqListStr = requirements.map((r, i) => `  REQ[${i}]: "${r}"`).join('\n');
        const prompt = `# TAREFA
Você é um especialista sênior em licitações públicas brasileiras com 20 anos de experiência em habilitação documental. Sua tarefa é vincular DOCUMENTOS de uma empresa às EXIGÊNCIAS DE HABILITAÇÃO de um edital.

# PRINCÍPIOS FUNDAMENTAIS
1. **MAXIMIZE as vinculações corretas.** Se existe um documento que pode atender uma exigência, VINCULE-O. Não deixe exigências simples sem vínculo.
2. **Um mesmo documento PODE atender múltiplas exigências** quando faz sentido (ex: Contrato Social atende tanto "ato constitutivo" quanto "comprovação do ramo de atividade").
3. **NÃO vincule quando claramente não há documento compatível** na lista.
4. **Priorize documentos NÃO vencidos** sobre vencidos. Se só há documento vencido, ainda assim vincule (o usuário revisará).

# TABELA DE EQUIVALÊNCIAS IMPORTANTES
Use esta tabela como referência para fazer correspondências semânticas:

| Exigência do Edital | Documentos que atendem |
|---|---|
| Ato constitutivo / Estatuto / Contrato social | Contrato Social, Estatuto, Ato Constitutivo, Requerimento de Empresário |
| Registro comercial (empresário individual) | Contrato Social, Registro Junta Comercial, Requerimento Empresário (NÃO é CNH, RG ou CPF) |
| Inscrição do ato constitutivo (sociedades civis) | Contrato Social, Estatuto Social, Ato Constitutivo |
| Decreto de autorização (empresa estrangeira) | Somente para empresas estrangeiras — se não houver doc específico, docIndex=null |
| Inscrição no CNPJ | Cartão CNPJ, Comprovante CNPJ |
| Inscrição no cadastro de contribuintes estadual | Inscrição Estadual, Cadastro ICMS (NÃO é Carteira Administradora) |
| Inscrição no cadastro de contribuintes municipal | Inscrição Municipal, Cadastro ISS, Alvará Municipal |
| Regularidade Fazenda Federal / Tributos Federais | CND Federal, Certidão Conjunta RFB/PGFN, Certidão Negativa Federal |
| Regularidade Fazenda Estadual | CND Estadual, Certidão Negativa Estadual, SEFAZ |
| Regularidade Fazenda Municipal | CND Municipal, Certidão Negativa Municipal, ISS (NÃO é Inscrição Municipal) |
| Regularidade FGTS | CRF, Certificado Regularidade FGTS, Comprovante FGTS |
| Regularidade trabalhista / CNDT | CNDT, Certidão Negativa Débitos Trabalhistas |
| Regularidade INSS / previdenciária | CND INSS, Certidão Previdenciária (geralmente embutida na Conjunta Federal) |
| Certidão de falência / recuperação judicial | Certidão Negativa de Falência, Recuperação Judicial |
| Balanço patrimonial | Balanço Patrimonial, Demonstrações Contábeis |
| Atestado de capacidade técnica | Atestado Técnico, Certidão de Acervo, CAT |
| Registro no CREA/CAU/conselho | Registro CREA, Registro CAU, Certidão conselho |
| Declaração de não emprego de menores | Declaração de Menores, Declaração Lei 9.854 |
| Declaração de impedimento | Declaração de Idoneidade, Declaração não impedido |
| Declaração de visita/vistoria técnica | Declaração de Vistoria, Atestado de Visita |
| Certidão/registro ARCE/agência reguladora | Registro Cadastral ARCE, Certificado Agência Reguladora |
| Alvará de funcionamento | Alvará, Licença de Funcionamento |
| Identidade do sócio/representante | RG, CNH, Documento de Identidade |
| CPF do sócio/representante | CPF, pode estar no RG |
| Procuração / credenciamento | Procuração, Carta de Preposto, Credenciamento |

# REGRAS DE DECISÃO
- Analise o SIGNIFICADO da exigência, não apenas palavras-chave
- Considere o nome do arquivo (fileName) como pista complementar ao tipo (docType)
- Se a exigência menciona "no caso de" uma situação específica (estrangeira, MEI, etc), vincule null se não houver doc correspondente
- Se há múltiplos documentos candidatos para uma exigência, escolha o mais específico

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
        const result = await (0, gemini_service_1.callGeminiWithRetry)(ai.models, {
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
        let matchResults;
        try {
            matchResults = JSON.parse(jsonStr);
        }
        catch (parseErr) {
            console.error('[Dossier AI Match] Failed to parse JSON:', responseText.substring(0, 500));
            return res.status(500).json({ error: 'AI returned invalid JSON', raw: responseText.substring(0, 200) });
        }
        // Convert to { requirementText -> [docId] } map
        const matches = {};
        for (const m of matchResults) {
            // Support both {"reqIndex":0} and {"r":0} formats
            const reqIdx = typeof m.r === 'number' ? m.r
                : typeof m.reqIndex === 'number' ? m.reqIndex
                    : parseInt(String(m.r ?? m.reqIndex ?? '').replace('R', ''));
            if (isNaN(reqIdx) || reqIdx < 0 || reqIdx >= requirements.length)
                continue;
            const reqText = requirements[reqIdx];
            const docIdxRaw = m.d ?? m.docIndex;
            if (docIdxRaw === null || docIdxRaw === undefined || docIdxRaw === 'SKIP' || docIdxRaw === -1) {
                continue;
            }
            const docIdx = typeof docIdxRaw === 'number' ? docIdxRaw : parseInt(docIdxRaw);
            if (isNaN(docIdx) || docIdx < 0 || docIdx >= documents.length)
                continue;
            matches[reqText] = [documents[docIdx].id];
            const reason = m.m || m.reason || '';
            console.log(`[Dossier AI Match] ✅ R${reqIdx} → DOC[${docIdx}] "${documents[docIdx].docType}" | ${reason}`);
        }
        const matchCount = Object.keys(matches).length;
        const skipped = matchResults.filter((m) => {
            const d = m.d ?? m.docIndex;
            return d === null || d === undefined || d === 'SKIP' || d === -1;
        }).length;
        console.log(`[Dossier AI Match] Result: ${matchCount} matched, ${skipped} skipped, ${requirements.length - matchCount - skipped} unhandled`);
        res.json({ matches, matchCount, totalRequirements: requirements.length });
    }
    catch (error) {
        console.error('[Dossier AI Match] Error:', error?.message || error);
        res.status(500).json({ error: 'AI matching failed: ' + (error?.message || 'Unknown error') });
    }
});
// AI Services imports movidos para cima
// AI Analysis Endpoint
app.post('/api/analyze-edital', authenticateToken, async (req, res) => {
    try {
        const { fileNames } = req.body;
        if (!fileNames || !Array.isArray(fileNames) || fileNames.length === 0) {
            return res.status(400).json({ error: 'fileNames array is required' });
        }
        let fullText = "";
        const pdfParts = [];
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
            }
            else {
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
        const ai = new genai_1.GoogleGenAI({ apiKey });
        // 3. System Prompt & Strict JSON Schema Definition (Enhanced with precision rules)
        const systemInstruction = prompt_service_1.ANALYZE_EDITAL_SYSTEM_PROMPT;
        console.log(`[AI] Calling Gemini API(${pdfParts.length} PDF parts)...`);
        let response;
        const startTime = Date.now();
        try {
            response = await (0, gemini_service_1.callGeminiWithRetry)(ai.models, {
                model: 'gemini-2.5-flash',
                contents: [
                    {
                        role: 'user',
                        parts: [
                            ...pdfParts,
                            { text: prompt_service_1.USER_ANALYSIS_INSTRUCTION }
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
        }
        catch (geminiError) {
            console.warn(`[AI] Gemini falhou: ${geminiError.message}. Realizando Fallback automático para OpenAI (gpt-4o-mini)...`);
            try {
                response = await (0, openai_service_1.fallbackToOpenAi)(pdfParts, systemInstruction, prompt_service_1.USER_ANALYSIS_INSTRUCTION);
            }
            catch (openAiError) {
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
        const finalPayload = (0, parser_service_1.robustJsonParse)(rawText, 'AI-Edital');
        console.log(`[AI] Successfully parsed JSON. Top-level keys: ${Object.keys(finalPayload).join(', ')}`);
        if (finalPayload.process) {
            console.log(`[AI] process keys: ${Object.keys(finalPayload.process).join(', ')}`);
        }
        if (finalPayload.analysis) {
            console.log(`[AI] analysis keys: ${Object.keys(finalPayload.analysis).join(', ')}`);
        }
        res.json(finalPayload);
    }
    catch (error) {
        console.error("AI Analysis Error (FULL):", JSON.stringify({ message: error?.message, status: error?.status, code: error?.code, stack: error?.stack?.substring(0, 500) }));
        const logMsg = `[${new Date().toISOString()}] AI Error: ${error?.message || String(error)}\nStatus: ${error?.status}\nCode: ${error?.code}\nStack: ${error?.stack || 'No stack'}\n\n`;
        fs_1.default.appendFileSync(path_1.default.join(uploadDir, 'debug-analysis.log'), logMsg);
        // Return the REAL error message for debugging
        const realError = error?.message || String(error);
        res.status(500).json({ error: `Erro na IA: ${realError}` });
    }
});
// AI Chat Endpoint
app.post('/api/analyze-edital/chat', authenticateToken, async (req, res) => {
    try {
        const traceLog = (msg) => {
            const timestamp = new Date().toISOString();
            fs_1.default.appendFileSync(path_1.default.join(uploadDir, 'chat-trace.log'), `[${timestamp}] ${msg}\n`);
            console.log(msg);
        };
        let { fileNames, biddingProcessId, messages } = req.body;
        traceLog(`Chat Request Received. processId: ${biddingProcessId}, messages: ${messages?.length}`);
        // Fetch analysis data for fallback context AND source file names
        let analysisContext = "";
        let sourceFileNamesFromAnalysis = [];
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
                    }
                    catch (e) {
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
                        return path_1.default.basename(pathname).split('?')[0];
                    }
                    catch (e) {
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
        const pdfParts = [];
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
            }
            else {
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
        const ai = new genai_1.GoogleGenAI({ apiKey });
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
        }
        else {
            // Fallback: add as a separate user message if history is empty (shouldn't happen)
            historyWithContext.unshift({
                role: 'user',
                parts: [...pdfParts, { text: "Estes são os documentos para nossa conversa." }]
            });
        }
        const chatResult = await (0, gemini_service_1.callGeminiWithRetry)(ai.models, {
            model: 'gemini-2.5-flash',
            contents: historyWithContext,
            config: {
                systemInstruction,
                temperature: 0.35,
                maxOutputTokens: 32768
            }
        });
        res.json({ text: chatResult.text });
    }
    catch (error) {
        console.error("AI Chat Error:", error?.message || error);
        res.status(500).json({ error: 'Failed to answer via AI chat' });
    }
});
// ── Serve Frontend in Production ──
if (process.env.NODE_ENV === 'production') {
    const publicDir = path_1.default.join(SERVER_ROOT, 'public');
    app.use(express_1.default.static(publicDir));
    // SPA fallback: send index.html for any non-API route
    app.use((req, res) => {
        if (!req.path.startsWith('/api') && !req.path.startsWith('/uploads')) {
            const publicDir = path_1.default.join(SERVER_ROOT, 'public');
            res.sendFile(path_1.default.join(publicDir, 'index.html'));
        }
        else if (req.path.startsWith('/uploads')) {
            res.status(404).json({
                error: 'Arquivo não encontrado',
                message: 'O documento solicitado não existe fisicamente no servidor. Como o sistema está no Railway sem volumes persistentes, arquivos são apagados a cada nova atualização/redeploy.',
                path: req.path
            });
        }
        else {
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
            const salt = await bcryptjs_1.default.genSalt(10);
            const passwordHash = await bcryptjs_1.default.hash('admin123', salt);
            await prisma.user.create({
                data: {
                    email: adminEmail,
                    name: 'Administrador',
                    passwordHash,
                    role: 'ADMIN',
                    tenantId: tenant.id
                }
            });
        }
        else if (admin.tenantId !== tenant.id) {
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
    }
    catch (error) {
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
