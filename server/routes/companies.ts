import express from 'express';
import prisma from '../lib/prisma';
import { authenticateToken } from '../middlewares/auth';
import { encryptCredential, decryptCredential, isEncrypted, isEncryptionConfigured } from '../lib/crypto';

const router = express.Router();

// ── Companies CRUD ──

// PUT Company Proposal Template — save default header/footer
router.put('/companies/:id/proposal-template', authenticateToken, async (req: any, res) => {
    try {
        const { id } = req.params;
        const {
            headerImage, footerImage, headerHeight, footerHeight,
            defaultLetterContent, defaultSignatureConfig,
            contactName, contactCpf,
        } = req.body;

        const updateData: any = {
            defaultProposalHeader: headerImage,
            defaultProposalFooter: footerImage,
            defaultProposalHeaderHeight: headerHeight,
            defaultProposalFooterHeight: footerHeight,
            defaultLetterContent: defaultLetterContent,
        };

        if (contactName !== undefined) updateData.contactName = contactName;
        if (contactCpf !== undefined) updateData.contactCpf = contactCpf;
        if (defaultSignatureConfig !== undefined) updateData.defaultSignatureConfig = defaultSignatureConfig;

        await prisma.companyProfile.update({
            where: { id, tenantId: req.user.tenantId },
            data: updateData
        });

        res.json({ message: 'Template padrão salvo com sucesso!' });
    } catch (error: any) {
        console.error('[API] Save company template error:', error);
        res.status(500).json({ error: 'Erro ao salvar template: ' + error.message });
    }
});

// ── Cache per-tenant para GET /companies (30s TTL) ──
// Este endpoint é chamado a cada ~5-10s pelo frontend.
// Cada chamada faz: Prisma JOIN + crypto decrypt (sync!) + document status update.
// Sem cache, as operações crypto bloqueiam o event loop constantemente.
const companiesCache = new Map<string, { data: any; timestamp: number }>();
const COMPANIES_CACHE_TTL_MS = 30_000; // 30 segundos

function invalidateCompaniesCache(tenantId: string) {
    companiesCache.delete(tenantId);
}

// List companies
router.get('/companies', authenticateToken, async (req: any, res) => {
    try {
        const tenantId = req.user.tenantId;
        
        // Servir do cache se fresco
        const cached = companiesCache.get(tenantId);
        if (cached && (Date.now() - cached.timestamp) < COMPANIES_CACHE_TTL_MS) {
            return res.json(cached.data);
        }

        const companies = await prisma.companyProfile.findMany({
            where: { tenantId },
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
        
        // Dynamically compute and update Document statuses based on current date
        const toValido: string[] = [];
        const toVencendo: string[] = [];
        const toVencido: string[] = [];

        try {
            const config = await prisma.globalConfig.findUnique({
                where: { tenantId }
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
                            if (diffDays < 0) status = 'Vencido';
                            else if (diffDays <= (doc.alertDays || defaultAlertDays)) status = 'Vencendo';
                        }
                        
                        if (doc.status !== status) {
                            doc.status = status; // update model in memory immediately
                            if (status === 'Válido') toValido.push(doc.id);
                            else if (status === 'Vencendo') toVencendo.push(doc.id);
                            else if (status === 'Vencido') toVencido.push(doc.id);
                        }
                    }
                }
            }

            // Fire-and-forget background update to keep DB in sync
            Promise.resolve().then(async () => {
                if (toValido.length > 0) await prisma.document.updateMany({ where: { id: { in: toValido } }, data: { status: 'Válido' } });
                if (toVencendo.length > 0) await prisma.document.updateMany({ where: { id: { in: toVencendo } }, data: { status: 'Vencendo' } });
                if (toVencido.length > 0) await prisma.document.updateMany({ where: { id: { in: toVencido } }, data: { status: 'Vencido' } });
            }).catch(e => console.error("Auto DB Update error:", e));

        } catch (e) {
            console.error("Failed to recompute document statuses dynamically:", e);
        }

        // Decrypt credentials before sending to client
        if (isEncryptionConfigured()) {
            for (const company of companies) {
                if ((company as any).credentials) {
                    for (const cred of (company as any).credentials) {
                        try {
                            if (cred.login && isEncrypted(cred.login)) cred.login = decryptCredential(cred.login);
                            if (cred.password && isEncrypted(cred.password)) cred.password = decryptCredential(cred.password);
                        } catch (e) {
                            console.warn(`[Crypto] Failed to decrypt credential ${cred.id}:`, e);
                        }
                    }
                }
            }
        }
        
        // Salvar no cache
        companiesCache.set(tenantId, { data: companies, timestamp: Date.now() });
        
        res.json(companies);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch companies' });
    }
});

// Update company
router.put('/companies/:id', authenticateToken, async (req: any, res) => {
    try {
        const { id } = req.params;
        const tenantId = req.user.tenantId;

        const company = await prisma.companyProfile.findUnique({ where: { id } });

        if (!company || company.tenantId !== tenantId) {
            return res.status(404).json({ error: 'Company not found or unauthorized' });
        }

        const { razaoSocial, cnpj, isHeadquarters, qualification, technicalQualification, contactName, contactEmail, contactPhone, contactCpf, address, city, state, defaultSignatureConfig, strengths, knownWeaknesses } = req.body;
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
        if (defaultSignatureConfig !== undefined) safeData.defaultSignatureConfig = defaultSignatureConfig;
        if (strengths !== undefined) safeData.strengths = strengths;
        if (knownWeaknesses !== undefined) safeData.knownWeaknesses = knownWeaknesses;

        const updatedCompany = await prisma.companyProfile.update({
            where: { id },
            data: safeData,
            include: { credentials: true, documents: { select: { id: true, tenantId: true, companyProfileId: true, docType: true, fileUrl: true, uploadDate: true, expirationDate: true, status: true, autoRenew: true, docGroup: true, issuerLink: true, fileName: true, alertDays: true } } }
        });
        invalidateCompaniesCache(tenantId);
        
        // Decrypt credentials before sending to client
        if (isEncryptionConfigured() && (updatedCompany as any).credentials) {
            for (const cred of (updatedCompany as any).credentials) {
                try {
                    if (cred.login && isEncrypted(cred.login)) cred.login = decryptCredential(cred.login);
                    if (cred.password && isEncrypted(cred.password)) cred.password = decryptCredential(cred.password);
                } catch (e) {
                    console.warn(`[Crypto] Failed to decrypt credential ${cred.id}:`, e);
                }
            }
        }
        
        res.json(updatedCompany);
    } catch (error: any) {
        console.error("Update company error:", error);
        res.status(500).json({ error: 'Failed to update company', details: error.message });
    }
});

// Create company
router.post('/companies', authenticateToken, async (req: any, res) => {
    try {
        const tenantId = req.user.tenantId;

        const company = await prisma.companyProfile.create({
            data: { ...req.body, tenantId }
        });
        invalidateCompaniesCache(tenantId);
        res.json(company);
    } catch (error) {
        console.error("Create company error:", error);
        res.status(500).json({ error: 'Failed to create company' });
    }
});

// Delete company
router.delete('/companies/:id', authenticateToken, async (req: any, res) => {
    try {
        const { id } = req.params;
        const company = await prisma.companyProfile.findUnique({ where: { id } });

        if (company && company.tenantId === req.user.tenantId) {
            await prisma.companyProfile.delete({ where: { id } });
            invalidateCompaniesCache(company.tenantId);
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'Company not found or unauthorized' });
        }
    } catch (error) {
        console.error("Delete company error:", error);
        res.status(500).json({ error: 'Failed to delete company' });
    }
});

// ── Credentials CRUD ──

router.post('/credentials', authenticateToken, async (req: any, res) => {
    try {
        const { companyProfileId, login, password, ...rest } = req.body;
        const company = await prisma.companyProfile.findUnique({
            where: { id: companyProfileId }
        });

        if (!company || company.tenantId !== req.user.tenantId) {
            return res.status(403).json({ error: 'Unauthorized: Company does not belong to your tenant' });
        }

        const encLogin = isEncryptionConfigured() ? encryptCredential(login) : login;
        const encPassword = isEncryptionConfigured() ? encryptCredential(password) : password;

        const credential = await prisma.companyCredential.create({
            data: { ...rest, companyProfileId, login: encLogin, password: encPassword }
        });
        invalidateCompaniesCache(company.tenantId);
        res.json({ ...credential, login, password });
    } catch (error) {
        console.error("Create credential error:", error);
        res.status(500).json({ error: 'Failed to create credential' });
    }
});

router.put('/credentials/:id', authenticateToken, async (req: any, res) => {
    try {
        const { id } = req.params;
        const credential = await prisma.companyCredential.findUnique({
            where: { id },
            include: { company: true }
        });

        if (!credential || credential.company.tenantId !== req.user.tenantId) {
            return res.status(403).json({ error: 'Unauthorized to update this credential' });
        }

        const updateData = { ...req.body };
        if (updateData.login && isEncryptionConfigured()) {
            updateData.login = encryptCredential(updateData.login);
        }
        if (updateData.password && isEncryptionConfigured()) {
            updateData.password = encryptCredential(updateData.password);
        }

        const updated = await prisma.companyCredential.update({
            where: { id },
            data: updateData
        });
        invalidateCompaniesCache(credential.company.tenantId);
        if (isEncryptionConfigured()) {
            if (isEncrypted(updated.login)) updated.login = decryptCredential(updated.login);
            if (isEncrypted(updated.password)) updated.password = decryptCredential(updated.password);
        }
        res.json(updated);
    } catch (error) {
        console.error("Update credential error:", error);
        res.status(500).json({ error: 'Failed to update credential' });
    }
});

router.delete('/credentials/:id', authenticateToken, async (req: any, res) => {
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
        invalidateCompaniesCache(credential.company.tenantId);
        res.json({ success: true });
    } catch (error) {
        console.error("Delete credential error:", error);
        res.status(500).json({ error: 'Failed to delete credential' });
    }
});

// ── Config / Alert Settings ──

router.get('/config/alerts', authenticateToken, async (req: any, res) => {
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

router.post('/config/alerts', authenticateToken, async (req: any, res) => {
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

export default router;
