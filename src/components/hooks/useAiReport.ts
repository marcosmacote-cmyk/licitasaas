import { useState, useEffect, useMemo } from 'react';
import type { AiAnalysis, BiddingProcess, CompanyDocument } from '../../types';
import { API_BASE_URL } from '../../config';

interface UseAiReportOptions {
    analysis: AiAnalysis;
    process: BiddingProcess;
}

/** Safely stringify any value into a human-readable string. Never returns [object Object]. */
function safeText(val: any): string {
    if (val === null || val === undefined) return '';
    if (typeof val === 'string') return val.trim();
    if (typeof val === 'number' || typeof val === 'boolean') return String(val);
    if (Array.isArray(val)) {
        return val
            .map(item => {
                if (typeof item === 'string') return `• ${item}`;
                if (typeof item === 'object' && item !== null) {
                    // Common patterns: {title, description}, {descricao, data}, {item, description}
                    const desc = item.description || item.descricao || item.title || item.titulo || item.text || '';
                    const label = item.item || item.requirement_id || item.indice || '';
                    const severity = item.severity || item.severidade || '';
                    const action = item.recommended_action || '';
                    let line = '';
                    if (label) line += `[${label}] `;
                    if (severity) line += `(${severity.toUpperCase()}) `;
                    line += typeof desc === 'string' ? desc : JSON.stringify(desc);
                    if (action) line += ` → ${action}`;
                    return `• ${line.trim()}`;
                }
                return `• ${String(item)}`;
            })
            .filter(Boolean)
            .join('\n');
    }
    if (typeof val === 'object') {
        // Try common readable fields first
        const readable = val.description || val.descricao || val.title || val.titulo || val.text || val.name;
        if (readable && typeof readable === 'string') return readable;
        // Fallback: render key-value pairs
        return Object.entries(val)
            .filter(([, v]) => v !== null && v !== undefined && v !== '')
            .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
            .join('\n');
    }
    return String(val);
}

/** Check if a value has meaningful content */
function hasContent(val: any): boolean {
    if (val === null || val === undefined) return false;
    if (typeof val === 'string') return val.trim().length > 0;
    if (Array.isArray(val)) return val.length > 0;
    if (typeof val === 'object') return Object.keys(val).length > 0;
    return true;
}

/** Parse array from string or value */
function parseArray(data: any): string[] {
    if (!data) return [];
    if (Array.isArray(data)) {
        return data.map(item => {
            if (typeof item === 'string') return item;
            if (typeof item === 'object' && item !== null) {
                return safeText(item);
            }
            return String(item);
        }).filter(Boolean);
    }
    try {
        const parsed = JSON.parse(data);
        if (Array.isArray(parsed)) return parseArray(parsed);
        if (typeof parsed === 'string') return parsed.trim() ? [parsed] : [];
        return [];
    } catch {
        return typeof data === 'string' && data.trim() ? [data] : [];
    }
}

export function useAiReport({ analysis, process }: UseAiReportOptions) {
    const v2 = analysis?.schemaV2 as any;

    // ══════════════════════════════════════════════════════════════
    //  V2-aware data extraction
    // ══════════════════════════════════════════════════════════════

    // Summary: prefer V2 objeto_completo, fall back to process.summary
    const executiveSummary = useMemo(() => {
        if (v2?.process_identification?.objeto_completo) {
            const pi = v2.process_identification;
            const parts = [
                pi.objeto_completo,
                pi.modalidade ? `\nModalidade: ${pi.modalidade}` : '',
                pi.criterio_julgamento ? `Critério de julgamento: ${pi.criterio_julgamento}` : '',
                pi.regime_execucao ? `Regime de execução: ${pi.regime_execucao}` : '',
                pi.municipio_uf ? `Local: ${pi.municipio_uf}` : '',
            ].filter(Boolean).join('\n');
            return parts;
        }
        return safeText(process?.summary) || safeText(analysis?.fullSummary) || '';
    }, [v2, process?.summary, analysis?.fullSummary]);

    // Parecer: from V2 risk review or legacy fullSummary
    const technicalOpinion = useMemo(() => {
        if (v2?.legal_risk_review?.critical_points?.length > 0) {
            const cps = v2.legal_risk_review.critical_points as any[];
            const lines = [
                '## Pontos Críticos Identificados\n',
                ...cps.map((cp: any, i: number) =>
                    `${i + 1}. **[${(cp.severity || '').toUpperCase()}]** ${cp.title}\n   ${cp.description}\n   → Ação: ${cp.recommended_action || 'Nenhuma ação específica'}`
                ),
            ];
            // Add ambiguities, inconsistencies, omissions
            const lr = v2.legal_risk_review;
            if (lr.ambiguities?.length > 0) {
                lines.push('\n## Ambiguidades', ...lr.ambiguities.map((a: string) => `• ${a}`));
            }
            if (lr.inconsistencies?.length > 0) {
                lines.push('\n## Inconsistências', ...lr.inconsistencies.map((i: string) => `• ${i}`));
            }
            if (lr.omissions?.length > 0) {
                lines.push('\n## Omissões', ...lr.omissions.map((o: string) => `• ${o}`));
            }
            return lines.join('\n');
        }
        return safeText(analysis?.fullSummary) || '';
    }, [v2, analysis?.fullSummary]);

    // Penalties: from V2 contractual or legacy
    const penaltiesText = useMemo(() => {
        if (v2?.contractual_analysis?.penalidades?.length > 0) {
            return v2.contractual_analysis.penalidades.map((p: any) => {
                if (typeof p === 'string') return `• ${p}`;
                // Handle object: {tipo, descricao, percentual, etc.}
                return `• ${safeText(p)}`;
            }).join('\n');
        }
        const legacy = analysis?.penalties;
        if (legacy === null || legacy === undefined) return '';
        return safeText(legacy);
    }, [v2, analysis?.penalties]);

    // Pricing: from V2 economic + contractual or legacy
    const financialText = useMemo(() => {
        const parts: string[] = [];
        if (v2?.economic_financial_analysis) {
            const efa = v2.economic_financial_analysis;
            if (efa.indices_exigidos?.length > 0) {
                parts.push('Índices exigidos:');
                efa.indices_exigidos.forEach((idx: any) => {
                    parts.push(`• ${idx.indice}: ${idx.formula_ou_descricao || ''} (mín: ${idx.valor_minimo || 'N/I'})`);
                });
            }
            if (efa.patrimonio_liquido_minimo) parts.push(`Patrimônio Líquido Mínimo: ${efa.patrimonio_liquido_minimo}`);
            if (efa.capital_social_minimo) parts.push(`Capital Social Mínimo: ${efa.capital_social_minimo}`);
        }
        if (v2?.contractual_analysis) {
            const ca = v2.contractual_analysis;
            if (ca.medicao_pagamento) parts.push(`Pagamento: ${ca.medicao_pagamento}`);
            if (ca.reajuste) parts.push(`Reajuste: ${ca.reajuste}`);
        }
        if (parts.length > 0) return parts.join('\n');
        return safeText(analysis?.pricingConsiderations) || '';
    }, [v2, analysis?.pricingConsiderations]);

    // Deadlines: from V2 timeline or legacy
    const deadlineList = useMemo(() => {
        if (v2?.timeline) {
            const tl = v2.timeline;
            const items: string[] = [];
            if (tl.data_sessao) items.push(`📅 ${tl.data_sessao} — Sessão Pública`);
            if (tl.prazo_impugnacao) items.push(`⚖️ ${tl.prazo_impugnacao} — Impugnação`);
            if (tl.prazo_esclarecimento) items.push(`❓ ${tl.prazo_esclarecimento} — Esclarecimento`);
            if (tl.prazo_envio_proposta) items.push(`📄 ${tl.prazo_envio_proposta} — Envio de Proposta`);
            if (tl.prazo_envio_habilitacao) items.push(`📋 ${tl.prazo_envio_habilitacao} — Envio Habilitação`);
            if (v2.contractual_analysis?.prazo_execucao) items.push(`🔧 Prazo de Execução: ${v2.contractual_analysis.prazo_execucao}`);
            if (v2.contractual_analysis?.prazo_vigencia) items.push(`📆 Vigência: ${v2.contractual_analysis.prazo_vigencia}`);
            if (tl.outros_prazos?.length > 0) {
                tl.outros_prazos.forEach((p: any) => {
                    if (p.descricao) items.push(`• ${p.data || ''} — ${p.descricao}`);
                });
            }
            if (items.length > 0) return items;
        }
        return parseArray(analysis?.deadlines);
    }, [v2, analysis?.deadlines]);

    // Risk flags: from V2 critical points or legacy
    const flagList = useMemo(() => {
        if (v2?.legal_risk_review?.critical_points?.length > 0) {
            return v2.legal_risk_review.critical_points.map((cp: any) => ({
                title: cp.title || '',
                text: cp.description || '',
                severity: cp.severity || 'media',
                action: cp.recommended_action || '',
                reason: cp.reason || '',
            }));
        }
        const legacy = parseArray(analysis?.irregularitiesFlags);
        return legacy.map(f => ({ title: '', text: f, severity: 'media', action: '', reason: '' }));
    }, [v2, analysis?.irregularitiesFlags]);

    // Conditions (V2 only)
    const conditions = useMemo(() => {
        if (!v2?.participation_conditions) return [];
        const pc = v2.participation_conditions;
        const items: { label: string; value: string; type: 'info' | 'warning' | 'danger' }[] = [];
        if (pc.permite_consorcio !== null) items.push({ label: 'Consórcio', value: pc.permite_consorcio ? 'Permitido' : 'Não permitido', type: pc.permite_consorcio ? 'info' : 'warning' });
        if (pc.permite_subcontratacao !== null) items.push({ label: 'Subcontratação', value: pc.permite_subcontratacao ? 'Permitida' : 'Não permitida', type: 'info' });
        if (pc.exige_visita_tecnica) items.push({ label: 'Visita Técnica', value: pc.visita_tecnica_detalhes || 'Obrigatória', type: 'warning' });
        if (pc.exige_garantia_proposta) items.push({ label: 'Garantia de Proposta', value: pc.garantia_proposta_detalhes || 'Exigida', type: 'warning' });
        if (pc.exige_garantia_contratual) items.push({ label: 'Garantia Contratual', value: pc.garantia_contratual_detalhes || 'Exigida', type: 'warning' });
        if (pc.exige_amostra) items.push({ label: 'Amostra', value: pc.amostra_detalhes || 'Exigida', type: 'warning' });
        if (pc.tratamento_me_epp) items.push({ label: 'ME/EPP', value: pc.tratamento_me_epp, type: 'info' });
        return items;
    }, [v2]);

    // Pipeline metadata (V2)
    const pipelineMeta = useMemo(() => {
        if (!v2?.analysis_meta) return null;
        const am = v2.analysis_meta;
        const health = (v2.confidence as any)?.pipeline_health || null;
        return {
            confidence: v2.confidence?.overall_confidence || analysis?.overallConfidence || '',
            scorePercentage: (v2.confidence as any)?.score_percentage || null,
            model: am.model_used || analysis?.modelUsed || '',
            promptVersion: (am as any)?.prompt_version || analysis?.promptVersion || '',
            stageTimes: (am as any)?.stage_times || null,
            qualityScore: (am as any)?.quality_report?.overallScore || null,
            evidenceCount: v2.evidence_registry?.length || 0,
            pipelineHealth: health,
        };
    }, [v2, analysis]);

    // Items: from V2 proposal or legacy
    const biddingItemsText = useMemo(() => {
        if (v2?.proposal_analysis?.observacoes_proposta?.length > 0) {
            return v2.proposal_analysis.observacoes_proposta.map((o: any) => {
                if (typeof o === 'string') return `• ${o}`;
                return `• ${safeText(o)}`;
            }).join('\n');
        }
        const legacy = analysis?.biddingItems;
        if (legacy === null || legacy === undefined) return '';
        return safeText(legacy);
    }, [v2, analysis?.biddingItems]);

    // Qualification: from V2 requirements or legacy
    const qualificationText = useMemo(() => {
        if (v2?.requirements) {
            const allReqs = Object.values(v2.requirements).flat() as any[];
            const techReqs = allReqs.filter((r: any) => r.requirement_id?.startsWith('QTO') || r.requirement_id?.startsWith('QTP'));
            if (techReqs.length > 0) {
                return techReqs.map((r: any) => `[${r.requirement_id}] ${r.title || ''}: ${r.description || ''}`).join('\n\n');
            }
        }
        return safeText(analysis?.qualificationRequirements) || '';
    }, [v2, analysis?.qualificationRequirements]);

    // ══════════════════════════════════════════════════════════════
    //  Company docs & readiness matching (unchanged logic)
    // ══════════════════════════════════════════════════════════════
    const [companyDocs, setCompanyDocs] = useState<CompanyDocument[]>([]);
    const [isLoadingDocs, setIsLoadingDocs] = useState(false);

    useEffect(() => {
        if (process?.companyProfileId) {
            setIsLoadingDocs(true);
            fetch(`${API_BASE_URL}/api/documents`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
            })
                .then(res => res.json())
                .then((data: CompanyDocument[]) => {
                    const tiedDocs = data.filter(d => d.companyProfileId === process?.companyProfileId);
                    setCompanyDocs(tiedDocs);
                })
                .catch(err => console.error("Failed to fetch company docs:", err))
                .finally(() => setIsLoadingDocs(false));
        }
    }, [process?.companyProfileId]);

    // Categorized documents — now V2 aware
    const categorizedDocs = useMemo(() => {
        // V2 requirements are already categorized
        if (v2?.requirements) {
            const v2Categories: Record<string, string> = {
                'habilitacao_juridica': 'Habilitação Jurídica',
                'regularidade_fiscal_trabalhista': 'Regularidade Fiscal, Social e Trabalhista',
                'qualificacao_economico_financeira': 'Qualificação Econômico-Financeira',
                'qualificacao_tecnica_operacional': 'Qualificação Técnica — Operacional',
                'qualificacao_tecnica_profissional': 'Qualificação Técnica — Profissional',
                'proposta_comercial': 'Proposta Comercial',
                'documentos_complementares': 'Declarações e Outros',
            };

            const result: Record<string, { item: string; title: string; description: string; hasMatch: boolean; mandatory?: boolean; riskIfMissing?: string }[]> = {};

            for (const [key, label] of Object.entries(v2Categories)) {
                const reqs = v2.requirements[key];
                if (!Array.isArray(reqs) || reqs.length === 0) continue;
                result[label] = reqs.map((r: any) => {
                    const textToMatch = `${r.requirement_id || ''} ${r.title || ''} ${r.description || ''}`.toLowerCase();
                    const hasMatch = companyDocs.some(cDoc => {
                        const docType = cDoc.docType.toLowerCase();
                        if (textToMatch.includes('trabalhista') && docType.includes('trabalhista')) return true;
                        if (textToMatch.includes('fgts') && docType.includes('fgts')) return true;
                        if (textToMatch.includes('federal') && docType.includes('federal')) return true;
                        if (textToMatch.includes('estadual') && docType.includes('estadual')) return true;
                        if (textToMatch.includes('municipal') && docType.includes('municipal')) return true;
                        if (textToMatch.includes('falência') && docType.includes('falência')) return true;
                        if (textToMatch.includes('balanço') && docType.includes('balanço')) return true;
                        if (textToMatch.includes('contrato social') && docType.includes('contrato social')) return true;
                        return false;
                    });
                    return {
                        item: r.requirement_id || '-',
                        title: r.title || '',
                        description: r.description || '',
                        hasMatch,
                        mandatory: r.mandatory,
                        riskIfMissing: r.risk_if_missing,
                    };
                });
            }

            // Only return categories with content
            return Object.fromEntries(Object.entries(result).filter(([, docs]) => docs.length > 0));
        }

        // Legacy fallback
        let rawData: any = {};
        try {
            if (analysis?.requiredDocuments) {
                rawData = typeof analysis?.requiredDocuments === 'string'
                    ? JSON.parse(analysis?.requiredDocuments)
                    : analysis?.requiredDocuments;
            }
            if (!rawData) rawData = {};
            if (Array.isArray(rawData)) {
                rawData = { "Documentos Exigidos": rawData.map((d: any) => typeof d === 'string' ? { item: '-', description: d } : d) };
            }
        } catch {
            rawData = {};
        }

        const categories = ["Habilitação Jurídica", "Regularidade Fiscal, Social e Trabalhista", "Qualificação Técnica", "Qualificação Econômica Financeira", "Declarações e Outros"];
        const result: Record<string, { item: string; description: string; hasMatch: boolean }[]> = {};

        categories.forEach(cat => {
            const docs = Array.isArray(rawData[cat]) ? rawData[cat] : [];
            if (docs.length === 0) return; // skip empty
            result[cat] = docs.map((doc: any) => {
                const docObj = typeof doc === 'string' ? { item: '-', description: doc } : doc;
                const textToMatch = `${docObj.item} ${docObj.description}`.toLowerCase();
                const hasMatch = companyDocs.some(cDoc => {
                    const docType = cDoc.docType.toLowerCase();
                    if (textToMatch.includes('trabalhista') && docType.includes('trabalhista')) return true;
                    if (textToMatch.includes('fgts') && docType.includes('fgts')) return true;
                    if (textToMatch.includes('federal') && docType.includes('federal')) return true;
                    if (textToMatch.includes('estadual') && docType.includes('estadual')) return true;
                    if (textToMatch.includes('municipal') && docType.includes('municipal')) return true;
                    if (textToMatch.includes('falência') && docType.includes('falência')) return true;
                    if (textToMatch.includes('balanço') && docType.includes('balanço')) return true;
                    if (textToMatch.includes('contrato social') && docType.includes('contrato social')) return true;
                    return false;
                });
                return { ...docObj, hasMatch };
            });
        });
        return result;
    }, [v2, analysis?.requiredDocuments, companyDocs]);

    const allDocsList = useMemo(() => Object.values(categorizedDocs).flat(), [categorizedDocs]);
    const readinessScore = allDocsList.length > 0
        ? Math.round((allDocsList.filter(d => d.hasMatch).length / allDocsList.length) * 100)
        : 0;

    return {
        // V2-aware data
        executiveSummary,
        technicalOpinion,
        penaltiesText,
        financialText,
        deadlineList,
        flagList,
        conditions,
        pipelineMeta,
        biddingItemsText,
        qualificationText,
        // Helpers
        safeText,
        hasContent,
        parseArray,
        // Legacy compat
        renderTextValue: safeText,
        // Company docs
        companyDocs, isLoadingDocs,
        categorizedDocs, allDocsList, readinessScore,
    };
}
