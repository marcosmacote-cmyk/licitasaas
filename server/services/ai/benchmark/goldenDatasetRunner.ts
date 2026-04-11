/**
 * ══════════════════════════════════════════════════════════════════
 *  Golden Dataset Runner — Validação de Output Real vs Anotação Humana
 * ══════════════════════════════════════════════════════════════════
 *
 *  USAGE:
 *    npx tsx server/services/ai/benchmark/goldenDatasetRunner.ts
 *
 *  MODE 1 — Snapshot Mode (when golden/*.snapshot.json files exist):
 *    Loads real pipeline outputs, runs them through enforceSchema,
 *    then validates against annotations.json expectations.
 *
 *  MODE 2 — Annotation-Only Mode (no snapshots yet):
 *    Validates the annotations themselves for consistency.
 *    Once snapshots are captured, switch to Mode 1.
 *
 *  HOW TO CAPTURE SNAPSHOTS:
 *    1. After a real analysis, the schemaV2 JSON is saved in AiAnalysis.schemaV2
 *    2. Use the /api/admin/capture-golden endpoint to save it
 *    3. Or manually copy schemaV2 from DB to golden/<id>.snapshot.json
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { enforceSchema } from '../schemaEnforcer';

// ── Types ──

interface CategoryExpectation {
    min_count: number;
    max_count: number;
    must_contain_keywords?: string[];
    must_not_contain_keywords?: string[];
}

interface GoldenAnnotation {
    id: string;
    name: string;
    orgao: string;
    processo: string;
    modalidade: string;
    portal: string;
    tipo_objeto: string;
    valor_estimado: number;
    audit_score: number;
    expected: {
        categories: Record<string, CategoryExpectation>;
        participation_conditions?: Record<string, boolean>;
        min_total_requirements: number;
        min_evidences: number;
        min_risks: number;
        must_detect_risks?: string[];
    };
}

interface TestResult {
    caseId: string;
    caseName: string;
    mode: 'snapshot' | 'annotation_only';
    assertions: number;
    passed: number;
    failed: number;
    warnings: number;
    details: string[];
}

// ── Runner ──

const GOLDEN_DIR = join(__dirname, 'golden');
const annotationsPath = join(GOLDEN_DIR, 'annotations.json');

function loadAnnotations(): GoldenAnnotation[] {
    const raw = readFileSync(annotationsPath, 'utf-8');
    const parsed = JSON.parse(raw);
    return parsed.cases;
}

function loadSnapshot(caseId: string): any | null {
    const snapshotPath = join(GOLDEN_DIR, `${caseId}.snapshot.json`);
    if (!existsSync(snapshotPath)) return null;
    return JSON.parse(readFileSync(snapshotPath, 'utf-8'));
}

function validateSnapshot(snapshot: any, annotation: GoldenAnnotation): TestResult {
    const result: TestResult = {
        caseId: annotation.id,
        caseName: annotation.name,
        mode: 'snapshot',
        assertions: 0,
        passed: 0,
        failed: 0,
        warnings: 0,
        details: [],
    };

    const pass = (msg: string) => { result.assertions++; result.passed++; result.details.push(`   ✅ ${msg}`); };
    const fail = (msg: string) => { result.assertions++; result.failed++; result.details.push(`   ❌ ${msg}`); };
    const warn = (msg: string) => { result.assertions++; result.warnings++; result.details.push(`   ⚠️ ${msg}`); };

    // Run through enforcer (same as production pipeline)
    const { schema: enforced, corrections } = enforceSchema(snapshot);

    // ── Total requirements ──
    const reqs: Record<string, any[]> = (enforced.requirements || {}) as any;
    const totalReqs = Object.values(reqs).reduce((sum: number, arr: any) => sum + (Array.isArray(arr) ? arr.length : 0), 0);
    if (totalReqs >= annotation.expected.min_total_requirements) {
        pass(`Total requirements: ${totalReqs} (min: ${annotation.expected.min_total_requirements})`);
    } else {
        fail(`Total requirements: ${totalReqs} < ${annotation.expected.min_total_requirements} min`);
    }

    // ── Category counts ──
    for (const [catKey, catExp] of Object.entries(annotation.expected.categories)) {
        const items: any[] = reqs[catKey] || [];
        const count = items.length;

        if (count >= catExp.min_count && count <= catExp.max_count) {
            pass(`${catKey}: ${count} items (range: ${catExp.min_count}-${catExp.max_count})`);
        } else if (count < catExp.min_count) {
            fail(`${catKey}: ${count} items < ${catExp.min_count} min`);
        } else {
            warn(`${catKey}: ${count} items > ${catExp.max_count} max (may indicate over-extraction)`);
        }

        // Must-contain keyword check
        if (catExp.must_contain_keywords) {
            const allText = items.map((i: any) => `${i.title || ''} ${i.description || ''}`).join(' ').toLowerCase();
            for (const kw of catExp.must_contain_keywords) {
                if (allText.includes(kw.toLowerCase())) {
                    pass(`${catKey} contains "${kw}"`);
                } else {
                    fail(`${catKey} MISSING keyword "${kw}"`);
                }
            }
        }

        // Must-NOT-contain check
        if (catExp.must_not_contain_keywords) {
            const allText = items.map((i: any) => `${i.title || ''} ${i.description || ''}`).join(' ').toLowerCase();
            for (const kw of catExp.must_not_contain_keywords) {
                if (!allText.includes(kw.toLowerCase())) {
                    pass(`${catKey} correctly excludes "${kw}"`);
                } else {
                    fail(`${catKey} CONTAINS banned keyword "${kw}" (PC pollution?)`);
                }
            }
        }
    }

    // ── Participation conditions ──
    if (annotation.expected.participation_conditions) {
        const pc = enforced.participation_conditions || {};
        for (const [field, expected] of Object.entries(annotation.expected.participation_conditions)) {
            const actual = (pc as any)[field];
            if (actual === expected) {
                pass(`participation_conditions.${field}: ${actual} === ${expected}`);
            } else {
                fail(`participation_conditions.${field}: ${actual} !== ${expected} (expected)`);
            }
        }
    }

    // ── Evidence count ──
    const evidences = enforced.evidence_registry?.length || 0;
    if (evidences >= annotation.expected.min_evidences) {
        pass(`Evidences: ${evidences} (min: ${annotation.expected.min_evidences})`);
    } else {
        warn(`Evidences: ${evidences} < ${annotation.expected.min_evidences} min`);
    }

    // ── Risk count ──
    const risks = enforced.legal_risk_review?.critical_points?.length || 0;
    if (risks >= annotation.expected.min_risks) {
        pass(`Risks: ${risks} (min: ${annotation.expected.min_risks})`);
    } else {
        warn(`Risks: ${risks} < ${annotation.expected.min_risks} min`);
    }

    // ── Must-detect risks ──
    if (annotation.expected.must_detect_risks) {
        const allRiskText = (enforced.legal_risk_review?.critical_points || [])
            .map((r: any) => `${r.title || ''} ${r.description || ''} ${r.recommendation || ''}`).join(' ').toLowerCase();
        for (const riskKw of annotation.expected.must_detect_risks) {
            if (allRiskText.includes(riskKw.toLowerCase())) {
                pass(`Detected risk containing "${riskKw}"`);
            } else {
                warn(`Risk keyword "${riskKw}" not found in ${risks} risks`);
            }
        }
    }

    // ── Enforcer corrections summary ──
    result.details.push(`   📊 Enforcer: ${corrections} corrections applied`);

    return result;
}

function validateAnnotationOnly(annotation: GoldenAnnotation): TestResult {
    const result: TestResult = {
        caseId: annotation.id,
        caseName: annotation.name,
        mode: 'annotation_only',
        assertions: 0,
        passed: 0,
        failed: 0,
        warnings: 0,
        details: [],
    };

    const pass = (msg: string) => { result.assertions++; result.passed++; result.details.push(`   ✅ ${msg}`); };
    const fail = (msg: string) => { result.assertions++; result.failed++; result.details.push(`   ❌ ${msg}`); };

    // Validate annotation consistency
    if (annotation.expected.min_total_requirements > 0) pass(`min_total_requirements: ${annotation.expected.min_total_requirements}`);
    else fail(`min_total_requirements must be > 0`);

    if (annotation.expected.min_evidences > 0) pass(`min_evidences: ${annotation.expected.min_evidences}`);
    else fail(`min_evidences must be > 0`);

    if (annotation.expected.min_risks > 0) pass(`min_risks: ${annotation.expected.min_risks}`);
    else fail(`min_risks must be > 0`);

    const catCount = Object.keys(annotation.expected.categories).length;
    if (catCount >= 4) pass(`Categories defined: ${catCount}`);
    else fail(`Categories defined: ${catCount} < 4 min`);

    // Check ranges are valid
    for (const [cat, exp] of Object.entries(annotation.expected.categories)) {
        if (exp.min_count <= exp.max_count) pass(`${cat}: range ${exp.min_count}-${exp.max_count} valid`);
        else fail(`${cat}: min (${exp.min_count}) > max (${exp.max_count})`);
    }

    result.details.push(`   📋 Snapshot NOT found — annotation-only validation`);

    return result;
}

// ── Main ──

console.log(`\n🧪 GOLDEN DATASET RUNNER — V5.0`);
console.log(`════════════════════════════════════════════════════════════`);

const annotations = loadAnnotations();
const snapshotsDir = readdirSync(GOLDEN_DIR).filter(f => f.endsWith('.snapshot.json'));
const snapshotCount = snapshotsDir.length;

console.log(`\n📂 Loaded ${annotations.length} annotations, ${snapshotCount} snapshots\n`);

const results: TestResult[] = [];

for (const annotation of annotations) {
    const snapshot = loadSnapshot(annotation.id);
    let result: TestResult;

    if (snapshot) {
        result = validateSnapshot(snapshot, annotation);
    } else {
        result = validateAnnotationOnly(annotation);
    }

    console.log(`\n📋 ${annotation.id}: ${annotation.name}`);
    console.log(`   Mode: ${result.mode} | Score auditado: ${annotation.audit_score}/10`);
    for (const detail of result.details) {
        console.log(detail);
    }

    results.push(result);
}

// ── Summary ──
const totalAssertions = results.reduce((s, r) => s + r.assertions, 0);
const totalPassed = results.reduce((s, r) => s + r.passed, 0);
const totalFailed = results.reduce((s, r) => s + r.failed, 0);
const totalWarnings = results.reduce((s, r) => s + r.warnings, 0);
const snapshotTests = results.filter(r => r.mode === 'snapshot').length;
const annotationOnlyTests = results.filter(r => r.mode === 'annotation_only').length;

console.log(`\n════════════════════════════════════════════════════════════`);
console.log(`TOTAL: ${results.length} cases | ${totalAssertions} assertions | ✅ ${totalPassed} passed | ❌ ${totalFailed} critical | ⚠️ ${totalWarnings} warnings`);
console.log(`MODE: ${snapshotTests} with snapshots, ${annotationOnlyTests} annotation-only`);

if (snapshotTests === 0) {
    console.log(`\n📌 No snapshots found. To capture snapshots:`);
    console.log(`   1. Analyze editais in production`);
    console.log(`   2. GET /api/admin/capture-golden/:processId`);
    console.log(`   3. Save response as golden/<id>.snapshot.json`);
}

if (totalFailed > 0) {
    console.log(`\n❌ ${totalFailed} CRITICAL failure(s) — review before deploying.`);
    process.exit(1);
} else if (totalWarnings > 0) {
    console.log(`\n⚠️ ${totalWarnings} warning(s) — review manually.`);
} else {
    console.log(`\n✅ ALL TESTS PASSED`);
}
