// Type-safe extracted route module
/**
 * Governance, Company Profile & Strategy routes
 * Extracted from server/index.ts
 */
import express from 'express';
import { authenticateToken, requireAdmin, requireSuperAdmin } from '../middlewares/auth';
import { aiLimiter } from '../lib/security';
import { prisma } from '../lib/prisma';
import { logger } from '../lib/logger';
import { handleApiError } from '../middlewares/errorHandler';

const router = express.Router();

import { submitFeedback, getFeedbackByModule, getFeedbackStats, AIExecutionFeedback } from '../services/ai/governance/feedbackService';
import { generateSystemReport } from '../services/ai/governance/operationalMetrics';
import { getAllVersions, getPromotionHistory } from '../services/ai/governance/versionGovernance';
import { generateImprovementInsights, convertFeedbackToGoldenCases } from '../services/ai/governance/improvementInsights';
import { createOrUpdateProfile, getProfile, getAllProfiles, CompanyLicitationProfile } from '../services/ai/company/companyProfileService';
import { matchCompanyToEdital, calculateParticipationScore, generateActionPlan } from '../services/ai/strategy/participationEngine';
import { generateCompanyInsights, recordMatchHistory } from '../services/ai/strategy/companyLearningInsights';

// ── Sprint 7 — Governance API Endpoints ──
// ══════════════════════════════════════════════════════════════════

// POST /api/ai/feedback — Submit structured feedback
router.post('/ai/feedback', authenticateToken, async (req: any, res: any) => {
    try {
        const feedback = submitFeedback(req.body as AIExecutionFeedback);
        res.json({ success: true, feedbackId: feedback.feedbackId });
    } catch (err: any) {
        res.status(500).json({ error: (err as Error)?.message || 'Erro interno' });
    }
});

// GET /api/ai/feedback/:moduleName — Get feedback by module
router.get('/ai/feedback/:moduleName', authenticateToken, async (req: any, res: any) => {
    try {
        const items = getFeedbackByModule(req.params.moduleName);
        const stats = getFeedbackStats(req.params.moduleName);
        res.json({ items, stats });
    } catch (err: any) {
        res.status(500).json({ error: (err as Error)?.message || 'Erro interno' });
    }
});

// GET /api/ai/metrics — System operational report
router.get('/ai/metrics', authenticateToken, async (_req: any, res: any) => {
    try {
        const report = generateSystemReport(30);
        res.json(report);
    } catch (err: any) {
        res.status(500).json({ error: (err as Error)?.message || 'Erro interno' });
    }
});

// GET /api/ai/versions — Version catalog
router.get('/ai/versions', authenticateToken, async (_req: any, res: any) => {
    try {
        const versions = getAllVersions();
        const promotions = getPromotionHistory();
        res.json({ versions, promotions });
    } catch (err: any) {
        res.status(500).json({ error: (err as Error)?.message || 'Erro interno' });
    }
});

// GET /api/ai/insights — Improvement insights
router.get('/ai/insights', authenticateToken, async (_req: any, res: any) => {
    try {
        const report = generateImprovementInsights(30);
        res.json(report);
    } catch (err: any) {
        res.status(500).json({ error: (err as Error)?.message || 'Erro interno' });
    }
});

// POST /api/ai/golden-cases/convert — Convert feedback to golden cases
router.post('/ai/golden-cases/convert', authenticateToken, async (_req: any, res: any) => {
    try {
        const converted = convertFeedbackToGoldenCases();
        res.json({ success: true, converted: converted.length, cases: converted });
    } catch (err: any) {
        res.status(500).json({ error: (err as Error)?.message || 'Erro interno' });
    }
});

// ══════════════════════════════════════════════════════════════════
//  Sprint 8 — Strategic Company API Endpoints
// ══════════════════════════════════════════════════════════════════

// POST /api/company/profile — Create or update company profile
router.post('/company/profile', authenticateToken, async (req: any, res: any) => {
    try {
        const profile = await createOrUpdateProfile(req.body as CompanyLicitationProfile);
        res.json({ success: true, companyId: profile.companyId });
    } catch (err: any) {
        res.status(500).json({ error: (err as Error)?.message || 'Erro interno' });
    }
});

// GET /api/company/profiles — List all company profiles
router.get('/company/profiles', authenticateToken, async (_req: any, res: any) => {
    try {
        res.json(await getAllProfiles());
    } catch (err: any) {
        res.status(500).json({ error: (err as Error)?.message || 'Erro interno' });
    }
});

// GET /api/company/:companyId — Get company profile
router.get('/company/:companyId', authenticateToken, async (req: any, res: any) => {
    try {
        const profile = await getProfile(req.params.companyId);
        if (!profile) return res.status(404).json({ error: 'Company not found' });
        res.json(profile);
    } catch (err: any) {
        res.status(500).json({ error: (err as Error)?.message || 'Erro interno' });
    }
});

// POST /api/strategy/analyze — Full strategic analysis: match + score + action plan
router.post('/strategy/analyze', authenticateToken, aiLimiter, async (req: any, res: any) => {
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
        const matchResult = await matchCompanyToEdital(companyId, schemaV2, biddingProcessId);
        const assessment = calculateParticipationScore(matchResult, schemaV2);
        const actionPlan = generateActionPlan(matchResult, assessment, schemaV2);

        // Record for learning
        await recordMatchHistory(companyId, biddingProcessId, {
            doc: matchResult.documentaryFit.score,
            tech: matchResult.technicalFit.score,
            ef: matchResult.economicFinancialFit.score,
            prop: matchResult.proposalFit.score,
            overall: assessment.overallScore
        }, assessment.recommendation);

        res.json({ matchResult, assessment, actionPlan });
    } catch (err: any) {
        res.status(500).json({ error: (err as Error)?.message || 'Erro interno' });
    }
});

// GET /api/company/:companyId/insights — Company learning insights
router.get('/company/:companyId/insights', authenticateToken, async (req: any, res: any) => {
    try {
        const report = await generateCompanyInsights(req.params.companyId);
        res.json(report);
    } catch (err: any) {
        res.status(500).json({ error: (err as Error)?.message || 'Erro interno' });
    }
});

export default router;
