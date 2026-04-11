"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const prisma_1 = __importDefault(require("../lib/prisma"));
const auth_1 = require("../middlewares/auth");
const crypto_1 = require("../lib/crypto");
const router = express_1.default.Router();
// ── Companies CRUD ──
// PUT Company Proposal Template — save default header/footer
router.put('/companies/:id/proposal-template', auth_1.authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { headerImage, footerImage, headerHeight, footerHeight, defaultLetterContent, defaultSignatureConfig, contactName, contactCpf, } = req.body;
        const updateData = {
            defaultProposalHeader: headerImage,
            defaultProposalFooter: footerImage,
            defaultProposalHeaderHeight: headerHeight,
            defaultProposalFooterHeight: footerHeight,
            defaultLetterContent: defaultLetterContent,
        };
        if (contactName !== undefined)
            updateData.contactName = contactName;
        if (contactCpf !== undefined)
            updateData.contactCpf = contactCpf;
        if (defaultSignatureConfig !== undefined)
            updateData.defaultSignatureConfig = defaultSignatureConfig;
        await prisma_1.default.companyProfile.update({
            where: { id, tenantId: req.user.tenantId },
            data: updateData
        });
        res.json({ message: 'Template padrão salvo com sucesso!' });
    }
    catch (error) {
        console.error('[API] Save company template error:', error);
        res.status(500).json({ error: 'Erro ao salvar template: ' + error.message });
    }
});
// List companies
router.get('/companies', auth_1.authenticateToken, async (req, res) => {
    try {
        console.log(`[API] Fetching companies for tenant: ${req.user.tenantId}`);
        const companies = await prisma_1.default.companyProfile.findMany({
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
                    }
                },
                credentials: true
            }
        });
        console.log(`[API] Found ${companies.length} companies.`);
        // Dynamically compute and update Document statuses based on current date
        const toValido = [];
        const toVencendo = [];
        const toVencido = [];
        try {
            const config = await prisma_1.default.globalConfig.findUnique({
                where: { tenantId: req.user.tenantId }
            });
            const parsedConfig = config ? JSON.parse(config.config) : { defaultAlertDays: 15 };
            const defaultAlertDays = parsedConfig.defaultAlertDays || 15;
            for (const company of companies) {
                if (company.documents) {
                    for (const doc of company.documents) {
                        let status = 'Válido';
                        if (doc.expirationDate) {
                            const diffTime = new Date(doc.expirationDate).getTime() - new Date().getTime();
                            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                            if (diffDays < 0)
                                status = 'Vencido';
                            else if (diffDays <= (doc.alertDays || defaultAlertDays))
                                status = 'Vencendo';
                        }
                        if (doc.status !== status) {
                            doc.status = status; // update model in memory immediately
                            if (status === 'Válido')
                                toValido.push(doc.id);
                            else if (status === 'Vencendo')
                                toVencendo.push(doc.id);
                            else if (status === 'Vencido')
                                toVencido.push(doc.id);
                        }
                    }
                }
            }
            // Fire-and-forget background update to keep DB in sync
            Promise.resolve().then(async () => {
                if (toValido.length > 0)
                    await prisma_1.default.document.updateMany({ where: { id: { in: toValido } }, data: { status: 'Válido' } });
                if (toVencendo.length > 0)
                    await prisma_1.default.document.updateMany({ where: { id: { in: toVencendo } }, data: { status: 'Vencendo' } });
                if (toVencido.length > 0)
                    await prisma_1.default.document.updateMany({ where: { id: { in: toVencido } }, data: { status: 'Vencido' } });
                if (toValido.length > 0 || toVencendo.length > 0 || toVencido.length > 0) {
                    console.log(`[API] Auto-updated document statuses on read: Válido(${toValido.length}), Vencendo(${toVencendo.length}), Vencido(${toVencido.length})`);
                }
            }).catch(e => console.error("Auto DB Update error:", e));
        }
        catch (e) {
            console.error("Failed to recompute document statuses dynamically:", e);
        }
        // Decrypt credentials before sending to client
        if ((0, crypto_1.isEncryptionConfigured)()) {
            for (const company of companies) {
                if (company.credentials) {
                    for (const cred of company.credentials) {
                        try {
                            if (cred.login && (0, crypto_1.isEncrypted)(cred.login))
                                cred.login = (0, crypto_1.decryptCredential)(cred.login);
                            if (cred.password && (0, crypto_1.isEncrypted)(cred.password))
                                cred.password = (0, crypto_1.decryptCredential)(cred.password);
                        }
                        catch (e) {
                            console.warn(`[Crypto] Failed to decrypt credential ${cred.id}:`, e);
                        }
                    }
                }
            }
        }
        res.json(companies);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch companies' });
    }
});
// Update company
router.put('/companies/:id', auth_1.authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const tenantId = req.user.tenantId;
        const company = await prisma_1.default.companyProfile.findUnique({ where: { id } });
        if (!company || company.tenantId !== tenantId) {
            return res.status(404).json({ error: 'Company not found or unauthorized' });
        }
        const { razaoSocial, cnpj, isHeadquarters, qualification, technicalQualification, contactName, contactEmail, contactPhone, contactCpf, address, city, state, defaultSignatureConfig, strengths, knownWeaknesses } = req.body;
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
        if (defaultSignatureConfig !== undefined)
            safeData.defaultSignatureConfig = defaultSignatureConfig;
        if (strengths !== undefined)
            safeData.strengths = strengths;
        if (knownWeaknesses !== undefined)
            safeData.knownWeaknesses = knownWeaknesses;
        const updatedCompany = await prisma_1.default.companyProfile.update({
            where: { id },
            data: safeData,
            include: { credentials: true, documents: { select: { id: true, tenantId: true, companyProfileId: true, docType: true, fileUrl: true, uploadDate: true, expirationDate: true, status: true, autoRenew: true, docGroup: true, issuerLink: true, fileName: true, alertDays: true } } }
        });
        // Decrypt credentials before sending to client
        if ((0, crypto_1.isEncryptionConfigured)() && updatedCompany.credentials) {
            for (const cred of updatedCompany.credentials) {
                try {
                    if (cred.login && (0, crypto_1.isEncrypted)(cred.login))
                        cred.login = (0, crypto_1.decryptCredential)(cred.login);
                    if (cred.password && (0, crypto_1.isEncrypted)(cred.password))
                        cred.password = (0, crypto_1.decryptCredential)(cred.password);
                }
                catch (e) {
                    console.warn(`[Crypto] Failed to decrypt credential ${cred.id}:`, e);
                }
            }
        }
        res.json(updatedCompany);
    }
    catch (error) {
        console.error("Update company error:", error);
        res.status(500).json({ error: 'Failed to update company', details: error.message });
    }
});
// Create company
router.post('/companies', auth_1.authenticateToken, async (req, res) => {
    try {
        const tenantId = req.user.tenantId;
        const company = await prisma_1.default.companyProfile.create({
            data: { ...req.body, tenantId }
        });
        res.json(company);
    }
    catch (error) {
        console.error("Create company error:", error);
        res.status(500).json({ error: 'Failed to create company' });
    }
});
// Delete company
router.delete('/companies/:id', auth_1.authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const company = await prisma_1.default.companyProfile.findUnique({ where: { id } });
        if (company && company.tenantId === req.user.tenantId) {
            await prisma_1.default.companyProfile.delete({ where: { id } });
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
// ── Credentials CRUD ──
router.post('/credentials', auth_1.authenticateToken, async (req, res) => {
    try {
        const { companyProfileId, login, password, ...rest } = req.body;
        const company = await prisma_1.default.companyProfile.findUnique({
            where: { id: companyProfileId }
        });
        if (!company || company.tenantId !== req.user.tenantId) {
            return res.status(403).json({ error: 'Unauthorized: Company does not belong to your tenant' });
        }
        const encLogin = (0, crypto_1.isEncryptionConfigured)() ? (0, crypto_1.encryptCredential)(login) : login;
        const encPassword = (0, crypto_1.isEncryptionConfigured)() ? (0, crypto_1.encryptCredential)(password) : password;
        const credential = await prisma_1.default.companyCredential.create({
            data: { ...rest, companyProfileId, login: encLogin, password: encPassword }
        });
        res.json({ ...credential, login, password });
    }
    catch (error) {
        console.error("Create credential error:", error);
        res.status(500).json({ error: 'Failed to create credential' });
    }
});
router.put('/credentials/:id', auth_1.authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const credential = await prisma_1.default.companyCredential.findUnique({
            where: { id },
            include: { company: true }
        });
        if (!credential || credential.company.tenantId !== req.user.tenantId) {
            return res.status(403).json({ error: 'Unauthorized to update this credential' });
        }
        const updateData = { ...req.body };
        if (updateData.login && (0, crypto_1.isEncryptionConfigured)()) {
            updateData.login = (0, crypto_1.encryptCredential)(updateData.login);
        }
        if (updateData.password && (0, crypto_1.isEncryptionConfigured)()) {
            updateData.password = (0, crypto_1.encryptCredential)(updateData.password);
        }
        const updated = await prisma_1.default.companyCredential.update({
            where: { id },
            data: updateData
        });
        if ((0, crypto_1.isEncryptionConfigured)()) {
            if ((0, crypto_1.isEncrypted)(updated.login))
                updated.login = (0, crypto_1.decryptCredential)(updated.login);
            if ((0, crypto_1.isEncrypted)(updated.password))
                updated.password = (0, crypto_1.decryptCredential)(updated.password);
        }
        res.json(updated);
    }
    catch (error) {
        console.error("Update credential error:", error);
        res.status(500).json({ error: 'Failed to update credential' });
    }
});
router.delete('/credentials/:id', auth_1.authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const credential = await prisma_1.default.companyCredential.findUnique({
            where: { id },
            include: { company: true }
        });
        if (!credential || credential.company.tenantId !== req.user.tenantId) {
            return res.status(403).json({ error: 'Unauthorized to delete this credential' });
        }
        await prisma_1.default.companyCredential.delete({ where: { id } });
        res.json({ success: true });
    }
    catch (error) {
        console.error("Delete credential error:", error);
        res.status(500).json({ error: 'Failed to delete credential' });
    }
});
// ── Config / Alert Settings ──
router.get('/config/alerts', auth_1.authenticateToken, async (req, res) => {
    try {
        const config = await prisma_1.default.globalConfig.findUnique({
            where: { tenantId: req.user.tenantId }
        });
        const parsed = config ? JSON.parse(config.config) : { defaultAlertDays: 15 };
        res.json(parsed);
    }
    catch (error) {
        res.status(500).json({ error: 'Failed to fetch config' });
    }
});
router.post('/config/alerts', auth_1.authenticateToken, async (req, res) => {
    try {
        const { defaultAlertDays, groupAlertDays, applyToExisting } = req.body;
        const configStr = JSON.stringify({ defaultAlertDays, groupAlertDays });
        const config = await prisma_1.default.globalConfig.upsert({
            where: { tenantId: req.user.tenantId },
            create: { tenantId: req.user.tenantId, config: configStr },
            update: { config: configStr }
        });
        if (applyToExisting) {
            console.log(`[Config Alerts] Updating documents for tenant ${req.user.tenantId}`);
            if (groupAlertDays && Object.keys(groupAlertDays).length > 0) {
                for (const [group, days] of Object.entries(groupAlertDays)) {
                    await prisma_1.default.document.updateMany({
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
            await prisma_1.default.document.updateMany({
                where: excludeWhere,
                data: { alertDays: Number(defaultAlertDays) }
            });
            console.log(`[Config Alerts] Recalculating statuses...`);
            const allDocs = await prisma_1.default.document.findMany({
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
                await prisma_1.default.document.updateMany({ where: { id: { in: toValido } }, data: { status: 'Válido' } });
            }
            if (toVencendo.length > 0) {
                await prisma_1.default.document.updateMany({ where: { id: { in: toVencendo } }, data: { status: 'Vencendo' } });
            }
            if (toVencido.length > 0) {
                await prisma_1.default.document.updateMany({ where: { id: { in: toVencido } }, data: { status: 'Vencido' } });
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
exports.default = router;
