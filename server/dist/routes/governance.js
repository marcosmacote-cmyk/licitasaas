"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
// Type-safe extracted route module
/**
 * Governance, Company Profile & Strategy routes
 * Extracted from server/index.ts
 */
const express_1 = __importDefault(require("express"));
const auth_1 = require("../middlewares/auth");
const security_1 = require("../lib/security");
const prisma_1 = require("../lib/prisma");
const router = express_1.default.Router();
const feedbackService_1 = require("../services/ai/governance/feedbackService");
const operationalMetrics_1 = require("../services/ai/governance/operationalMetrics");
const versionGovernance_1 = require("../services/ai/governance/versionGovernance");
const improvementInsights_1 = require("../services/ai/governance/improvementInsights");
const companyProfileService_1 = require("../services/ai/company/companyProfileService");
const participationEngine_1 = require("../services/ai/strategy/participationEngine");
const companyLearningInsights_1 = require("../services/ai/strategy/companyLearningInsights");
// ── Sprint 7 — Governance API Endpoints ──
// ══════════════════════════════════════════════════════════════════
// POST /api/ai/feedback — Submit structured feedback
router.post('/ai/feedback', auth_1.authenticateToken, async (req, res) => {
    try {
        const feedback = (0, feedbackService_1.submitFeedback)(req.body);
        res.json({ success: true, feedbackId: feedback.feedbackId });
    }
    catch (err) {
        res.status(500).json({ error: err?.message || 'Erro interno' });
    }
});
// GET /api/ai/feedback/:moduleName — Get feedback by module
router.get('/ai/feedback/:moduleName', auth_1.authenticateToken, async (req, res) => {
    try {
        const items = (0, feedbackService_1.getFeedbackByModule)(req.params.moduleName);
        const stats = (0, feedbackService_1.getFeedbackStats)(req.params.moduleName);
        res.json({ items, stats });
    }
    catch (err) {
        res.status(500).json({ error: err?.message || 'Erro interno' });
    }
});
// GET /api/ai/metrics — System operational report
router.get('/ai/metrics', auth_1.authenticateToken, async (_req, res) => {
    try {
        const report = (0, operationalMetrics_1.generateSystemReport)(30);
        res.json(report);
    }
    catch (err) {
        res.status(500).json({ error: err?.message || 'Erro interno' });
    }
});
// GET /api/ai/versions — Version catalog
router.get('/ai/versions', auth_1.authenticateToken, async (_req, res) => {
    try {
        const versions = (0, versionGovernance_1.getAllVersions)();
        const promotions = (0, versionGovernance_1.getPromotionHistory)();
        res.json({ versions, promotions });
    }
    catch (err) {
        res.status(500).json({ error: err?.message || 'Erro interno' });
    }
});
// GET /api/ai/insights — Improvement insights
router.get('/ai/insights', auth_1.authenticateToken, async (_req, res) => {
    try {
        const report = (0, improvementInsights_1.generateImprovementInsights)(30);
        res.json(report);
    }
    catch (err) {
        res.status(500).json({ error: err?.message || 'Erro interno' });
    }
});
// POST /api/ai/golden-cases/convert — Convert feedback to golden cases
router.post('/ai/golden-cases/convert', auth_1.authenticateToken, async (_req, res) => {
    try {
        const converted = (0, improvementInsights_1.convertFeedbackToGoldenCases)();
        res.json({ success: true, converted: converted.length, cases: converted });
    }
    catch (err) {
        res.status(500).json({ error: err?.message || 'Erro interno' });
    }
});
// ══════════════════════════════════════════════════════════════════
//  Sprint 8 — Strategic Company API Endpoints
// ══════════════════════════════════════════════════════════════════
// POST /api/company/profile — Create or update company profile
router.post('/company/profile', auth_1.authenticateToken, async (req, res) => {
    try {
        const profile = await (0, companyProfileService_1.createOrUpdateProfile)(req.body);
        res.json({ success: true, companyId: profile.companyId });
    }
    catch (err) {
        res.status(500).json({ error: err?.message || 'Erro interno' });
    }
});
// GET /api/company/profiles — List all company profiles
router.get('/company/profiles', auth_1.authenticateToken, async (_req, res) => {
    try {
        res.json(await (0, companyProfileService_1.getAllProfiles)());
    }
    catch (err) {
        res.status(500).json({ error: err?.message || 'Erro interno' });
    }
});
// GET /api/company/:companyId — Get company profile
router.get('/company/:companyId', auth_1.authenticateToken, async (req, res) => {
    try {
        const profile = await (0, companyProfileService_1.getProfile)(req.params.companyId);
        if (!profile)
            return res.status(404).json({ error: 'Company not found' });
        res.json(profile);
    }
    catch (err) {
        res.status(500).json({ error: err?.message || 'Erro interno' });
    }
});
// POST /api/strategy/analyze — Full strategic analysis: match + score + action plan
router.post('/strategy/analyze', auth_1.authenticateToken, security_1.aiLimiter, async (req, res) => {
    try {
        const { companyId, biddingProcessId } = req.body;
        if (!companyId || !biddingProcessId) {
            return res.status(400).json({ error: 'companyId and biddingProcessId are required' });
        }
        const bidding = await prisma_1.prisma.biddingProcess.findUnique({
            where: { id: biddingProcessId },
            include: { aiAnalysis: true }
        });
        if (!bidding?.aiAnalysis?.schemaV2) {
            return res.status(404).json({ error: 'Bidding process or schemaV2 not found' });
        }
        const schemaV2 = bidding.aiAnalysis.schemaV2;
        const matchResult = await (0, participationEngine_1.matchCompanyToEdital)(companyId, schemaV2, biddingProcessId);
        const assessment = (0, participationEngine_1.calculateParticipationScore)(matchResult, schemaV2);
        const actionPlan = (0, participationEngine_1.generateActionPlan)(matchResult, assessment, schemaV2);
        // Record for learning
        await (0, companyLearningInsights_1.recordMatchHistory)(companyId, biddingProcessId, {
            doc: matchResult.documentaryFit.score,
            tech: matchResult.technicalFit.score,
            ef: matchResult.economicFinancialFit.score,
            prop: matchResult.proposalFit.score,
            overall: assessment.overallScore
        }, assessment.recommendation);
        res.json({ matchResult, assessment, actionPlan });
    }
    catch (err) {
        res.status(500).json({ error: err?.message || 'Erro interno' });
    }
});
// GET /api/company/:companyId/insights — Company learning insights
router.get('/company/:companyId/insights', auth_1.authenticateToken, async (req, res) => {
    try {
        const report = await (0, companyLearningInsights_1.generateCompanyInsights)(req.params.companyId);
        res.json(report);
    }
    catch (err) {
        res.status(500).json({ error: err?.message || 'Erro interno' });
    }
});
exports.default = router;
