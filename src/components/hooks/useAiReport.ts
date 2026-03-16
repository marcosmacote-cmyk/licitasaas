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

    // Metadados fixos do processo — sempre exibidos no painel, com fonte quando disponível
    const processMetadata = useMemo(() => {
        const pi = v2?.process_identification || {};
        const tl = v2?.timeline || {};
        const sessionDateStr = tl.data_sessao || (process?.sessionDate
            ? new Date(process.sessionDate).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
            : null);
        const valueStr = process?.estimatedValue
            ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(process.estimatedValue)
            : null;
        return {
            objeto: pi.objeto_completo || pi.objeto_resumido || safeText(process?.title) || null,
            orgao: pi.orgao || pi.unidade_compradora || null,
            numeroProcesso: pi.numero_processo || pi.numero_edital || null,
            modalidade: pi.modalidade || null,
            criterioJulgamento: pi.criterio_julgamento || null,
            regimeExecucao: pi.regime_execucao || null,
            local: pi.municipio_uf || null,
            dataSessao: sessionDateStr || null,
            valorEstimado: valueStr || null,
            fonteOficial: pi.fonte_oficial || null,
        };
    }, [v2, process]);



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

    // Penalties: 5 ordered legal categories
    const penaltiesStructured = useMemo(() => {
        const result = {
            advertencia: [] as string[],
            multas: [] as string[],
            impedimento: [] as string[],
            inidoneidade: [] as string[],
            rescisao: [] as string[],
            outros: [] as string[]
        };
        const penalidades = v2?.contractual_analysis?.penalidades || [];
        if (penalidades.length === 0) return result;

        penalidades.forEach((p: any) => {
            const text = typeof p === 'string' ? p : (p.descricao || p.description || safeText(p));
            const lower = text.toLowerCase();
            const normalized = lower.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            // Also check tipo/categoria fields from AI extraction
            const tipo = ((p.tipo || p.categoria || p.type || '') as string).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

            // Order matters: most specific first
            if (normalized.includes('advertencia') || tipo.includes('advertencia')) {
                result.advertencia.push(text);
            } else if (lower.includes('multa') || lower.includes('percentual') || /\d+[.,]?\d*\s*%/.test(normalized) || tipo.includes('multa')) {
                result.multas.push(text);
            } else if (normalized.includes('impedimento') || normalized.includes('suspensao') || lower.includes('suspensão')
                || normalized.includes('proibicao') || lower.includes('proibição')
                || (normalized.includes('licitar') && normalized.includes('contratar'))
                || tipo.includes('impedimento') || tipo.includes('suspensao')) {
                result.impedimento.push(text);
            } else if (normalized.includes('inidoneidade') || normalized.includes('inidone')
                || tipo.includes('inidoneidade') || tipo.includes('declaracao de inidoneidade')) {
                result.inidoneidade.push(text);
            } else if (normalized.includes('rescis') || normalized.includes('resolucao') || lower.includes('resolução')
                || normalized.includes('extincao') || lower.includes('extinção') || lower.includes('efeito')
                || normalized.includes('inexecucao') || lower.includes('inexecução')
                || tipo.includes('rescis') || tipo.includes('extincao')) {
                result.rescisao.push(text);
            } else {
                result.outros.push(text);
            }
        });
        return result;
    }, [v2]);

    const penaltiesText = useMemo(() => {
        const parts: string[] = [];
        if (penaltiesStructured.advertencia.length > 0) parts.push(...penaltiesStructured.advertencia.map(a => `• ${a}`));
        if (penaltiesStructured.multas.length > 0) parts.push(...penaltiesStructured.multas.map(m => `• ${m}`));
        if (penaltiesStructured.impedimento.length > 0) parts.push(...penaltiesStructured.impedimento.map(i => `• ${i}`));
        if (penaltiesStructured.inidoneidade.length > 0) parts.push(...penaltiesStructured.inidoneidade.map(i => `• ${i}`));
        if (penaltiesStructured.rescisao.length > 0) parts.push(...penaltiesStructured.rescisao.map(r => `• ${r}`));
        if (penaltiesStructured.outros.length > 0) parts.push(...penaltiesStructured.outros.map(o => `• ${o}`));
        if (parts.length > 0) return parts.join('\n');
        const legacy = analysis?.penalties;
        if (legacy === null || legacy === undefined) return '';
        return safeText(legacy);
    }, [penaltiesStructured, analysis?.penalties]);

    // Pricing: from V2 economic + contractual or legacy
    const financialText = useMemo(() => {
        const parts: string[] = [];
        if (v2?.economic_financial_analysis) {
            const efa = v2.economic_financial_analysis;
            if (efa.indices_exigidos?.length > 0) {
                parts.push('Índices exigidos:');
                efa.indices_exigidos.forEach((idx: any) => {
                    const operador = idx.operador || (idx.indice?.toUpperCase() === 'EG' ? '<=' : '>=');
                    const valor = idx.valor_referencia || idx.valor_minimo || 'N/I';
                    const label = operador === '<=' ? 'máx' : 'mín';
                    const symbol = operador === '<=' ? '≤' : '≥';
                    parts.push(`• ${idx.indice}: ${idx.formula_ou_descricao || ''} (${label}: ${valor} — ${idx.indice} ${symbol} ${valor})`);
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

    // Deadlines: single flat list, ALL visible, with dedup
    const deadlineList = useMemo(() => {
        if (v2?.timeline) {
            const tl = v2.timeline;
            const items: string[] = [];
            // Marcos críticos licitatórios
            if (tl.data_sessao) items.push(`📅 ${tl.data_sessao} — Sessão Pública`);
            if (tl.prazo_impugnacao) items.push(`⚖️ ${tl.prazo_impugnacao} — Impugnação`);
            if (tl.prazo_esclarecimento) items.push(`❓ ${tl.prazo_esclarecimento} — Esclarecimento`);
            if (tl.prazo_envio_proposta) items.push(`📄 ${tl.prazo_envio_proposta} — Envio de Proposta`);
            if (tl.prazo_envio_habilitacao) items.push(`📋 ${tl.prazo_envio_habilitacao} — Envio Habilitação`);
            // Prazos processuais
            const isDatePattern = /^\d{2}\/\d{2}\/\d{4}/;
            if (tl.prazo_recurso) {
                const isFixed = isDatePattern.test(tl.prazo_recurso);
                items.push(isFixed
                    ? `📝 ${tl.prazo_recurso} — Prazo Recursal`
                    : `📝 Prazo Recursal: ${tl.prazo_recurso}`);
            }
            if (tl.prazo_contrarrazoes) {
                const isFixed = isDatePattern.test(tl.prazo_contrarrazoes);
                items.push(isFixed
                    ? `📝 ${tl.prazo_contrarrazoes} — Contrarrazões`
                    : `📝 Contrarrazões: ${tl.prazo_contrarrazoes}`);
            }
            // Prazos contratuais
            if (v2.contractual_analysis?.prazo_execucao) items.push(`🔧 Execução: ${v2.contractual_analysis.prazo_execucao}`);
            if (v2.contractual_analysis?.prazo_vigencia) items.push(`📆 Vigência: ${v2.contractual_analysis.prazo_vigencia}`);
            // Outros prazos
            if (tl.outros_prazos?.length > 0) {
                tl.outros_prazos.forEach((p: any) => {
                    if (p.descricao) items.push(`• ${p.data || ''} — ${p.descricao}`);
                });
            }
            // M7: Enhanced dedup — also catches near-duplicates like same deadline/duration
            const seen = new Set<string>();
            const deduped = items.filter(item => {
                // Strip emojis, whitespace, lowercase
                let normalized = item.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}]/gu, '').replace(/\s+/g, ' ').trim().toLowerCase();
                // Also strip accent marks for comparison
                normalized = normalized.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                if (seen.has(normalized)) return false;
                seen.add(normalized);
                return true;
            });
            if (deduped.length > 0) return deduped;
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
                sourceRef: cp.source_ref || '',
                evidenceRefs: cp.evidence_refs || [],
            }));
        }
        const legacy = parseArray(analysis?.irregularitiesFlags);
        return legacy.map(f => ({ title: '', text: f, severity: 'media', action: '', reason: '', sourceRef: '', evidenceRefs: [] as string[] }));
    }, [v2, analysis?.irregularitiesFlags]);

    // Conditions (V2 only)
    const conditions = useMemo(() => {
        if (!v2?.participation_conditions) return [];
        const pc = v2.participation_conditions;
        const items: { label: string; value: string; type: 'info' | 'warning' | 'danger'; sourceRef?: string }[] = [];

        // Helper: find source_ref using 3 fallback strategies
        const findSourceRef = (...keywords: string[]): string => {
            // Strategy 1: search requirements by keyword in title/description
            if (v2?.requirements) {
                const allReqs = Object.values(v2.requirements).flat() as any[];
                for (const kw of keywords) {
                    const match = allReqs.find((r: any) => {
                        const text = `${r.title || ''} ${r.description || ''}`.toLowerCase();
                        return text.includes(kw.toLowerCase());
                    });
                    if (match?.source_ref && match.source_ref !== 'referência não localizada') return match.source_ref;
                }
            }
            // Strategy 2: search evidence_registry by normalized_topic
            if (v2?.evidence_registry) {
                for (const kw of keywords) {
                    const ev = (v2.evidence_registry as any[]).find(e =>
                        (e.normalized_topic || '').toLowerCase().includes(kw.toLowerCase())
                    );
                    if (ev) {
                        const doc = ev.document_type === 'edital' ? 'Edital' : ev.document_type === 'tr' ? 'TR' : ev.document_type || 'Edital';
                        const loc = ev.section ? `seção ${ev.section}` : ev.page ? `p. ${ev.page}` : '';
                        if (loc) return `${doc}, ${loc}`;
                    }
                }
            }
            // Strategy 3: extract ref from any detalhes string that contains a localizador
            if (keywords.length > 0) {
                const detalhesField = Object.entries(pc).find(([k]) => k.includes('detalhes'))?.[1] as string || '';
                const refMatch = detalhesField.match(/(item|seção|art\.|cláusula)\s+[\d.]+/i);
                if (refMatch) return `Edital, ${refMatch[0]}`;
            }
            return '';
        };

        if (pc.permite_consorcio !== null) items.push({ label: 'Consórcio', value: pc.permite_consorcio ? 'Permitido' : 'Não permitido', type: pc.permite_consorcio ? 'info' : 'warning', sourceRef: findSourceRef('consórcio', 'consorcio') });
        if (pc.permite_subcontratacao !== null) {
            let subSourceRef = findSourceRef('subcontrat', 'subcontratação');
            // Extra strategy: parse subcontratacao_detalhes for source ref
            if (!subSourceRef && pc.subcontratacao_detalhes) {
                const refMatch = (pc.subcontratacao_detalhes as string).match(/(item|seção|art\.|cláusula|edital)\s*,?\s*[\d.]+/i);
                if (refMatch) subSourceRef = `Edital, ${refMatch[0]}`;
            }
            // Extra strategy: search outras_condicoes
            if (!subSourceRef && pc.outras_condicoes && Array.isArray(pc.outras_condicoes)) {
                const subCond = (pc.outras_condicoes as any[]).find((c: any) =>
                    (c.descricao || c.condicao || '').toLowerCase().includes('subcontrat')
                );
                if (subCond?.fonte || subCond?.source_ref) subSourceRef = subCond.fonte || subCond.source_ref;
            }
            items.push({ label: 'Subcontratação', value: pc.permite_subcontratacao ? 'Permitida' : 'Não permitida', type: 'info', sourceRef: subSourceRef });
        }
        if (pc.exige_visita_tecnica) items.push({ label: 'Visita Técnica', value: pc.visita_tecnica_detalhes || 'Obrigatória', type: 'warning', sourceRef: findSourceRef('visita técnica', 'visita tecnica') });
        if (pc.exige_garantia_proposta) items.push({ label: 'Garantia de Proposta', value: pc.garantia_proposta_detalhes || 'Exigida', type: 'warning', sourceRef: findSourceRef('garantia de proposta', 'garantia da proposta') });
        if (pc.exige_garantia_contratual) {
            let garantiaRef = findSourceRef('garantia contratual', 'garantia de execução', 'garantia de contrato', 'seguro-garantia', 'caução');
            // Extra: parse garantia_contratual_detalhes for inline source ref
            if (!garantiaRef && pc.garantia_contratual_detalhes) {
                const refMatch = (pc.garantia_contratual_detalhes as string).match(/(item|seção|art\.|cláusula|edital)\s*,?\s*[\d.]+/i);
                if (refMatch) garantiaRef = `Edital, ${refMatch[0]}`;
            }
            items.push({ label: 'Garantia Contratual', value: pc.garantia_contratual_detalhes || 'Exigida', type: 'warning', sourceRef: garantiaRef });
        }
        if (pc.exige_amostra) items.push({ label: 'Amostra', value: pc.amostra_detalhes || 'Exigida', type: 'warning', sourceRef: findSourceRef('amostra') });
        if (pc.tratamento_me_epp) items.push({ label: 'ME/EPP', value: pc.tratamento_me_epp, type: 'info', sourceRef: findSourceRef('me/epp', 'microempresa', 'pequeno porte', 'benefício') });
        if (pc.participacao_restrita) {
            // Split participação restrita into individual vedações
            const participacaoText = pc.participacao_restrita as string;
            const vedacoes = participacaoText.split(/[;\n•\-]/).map((v: string) => v.replace(/^\d+[\.\)]\s*/, '').trim()).filter((v: string) => v.length > 5);
            const participacaoRef = findSourceRef('participação restrita', 'exclusivo', 'restrita', 'vedação', 'impedido', 'não poderão');
            if (vedacoes.length > 1) {
                vedacoes.forEach((vedacao: string, idx: number) => {
                    items.push({ label: `Vedação ${idx + 1}`, value: vedacao, type: 'warning', sourceRef: idx === 0 ? participacaoRef : '' });
                });
            } else {
                items.push({ label: 'Participação', value: participacaoText, type: 'warning', sourceRef: participacaoRef });
            }
        }
        return items;
    }, [v2]);

    // Pipeline metadata (V2)
    const pipelineMeta = useMemo(() => {
        if (!v2?.analysis_meta) return null;
        const am = v2.analysis_meta;
        const health = (v2.confidence as any)?.pipeline_health || null;
        const traceability = (v2.confidence as any)?.traceability || null;
        return {
            confidence: v2.confidence?.overall_confidence || analysis?.overallConfidence || '',
            scorePercentage: (v2.confidence as any)?.score_percentage || null,
            model: am.model_used || analysis?.modelUsed || '',
            promptVersion: (am as any)?.prompt_version || analysis?.promptVersion || '',
            stageTimes: (am as any)?.stage_times || null,
            qualityScore: (am as any)?.quality_report?.overallScore || null,
            evidenceCount: traceability?.evidence_registry_count ?? (v2.evidence_registry?.length || 0),
            tracedRequirements: traceability?.traced_requirements ?? 0,
            totalRequirements: traceability?.total_requirements ?? 0,
            traceabilityPercentage: traceability?.traceability_percentage ?? null,
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
                'documentos_complementares': 'Declarações e Documentos Complementares',
            };

            const result: Record<string, { item: string; title: string; description: string; hasMatch: boolean; obligationType?: string; phase?: string; riskIfMissing?: string; sourceRef?: string; entryType?: string; parentId?: string | null }[]> = {};

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
                    // Backward compat: if obligation_type missing, infer from mandatory boolean
                    const obligationType = r.obligation_type || (r.mandatory === false ? 'se_aplicavel' : 'obrigatoria_universal');
                    return {
                        item: r.requirement_id || '-',
                        title: r.title || '',
                        description: r.description || '',
                        hasMatch,
                        obligationType,
                        phase: r.phase || 'habilitacao',
                        riskIfMissing: r.risk_if_missing,
                        sourceRef: r.source_ref || '',
                        entryType: r.entry_type || 'exigencia_principal',
                        parentId: r.parent_id || null,
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
    // Count only main requirements (exigencia_principal or entries without entry_type for backwards compat)
    const mainRequirementCount = useMemo(() => {
        return allDocsList.filter((d: any) => !d.entryType || d.entryType === 'exigencia_principal').length;
    }, [allDocsList]);
    // Per-category main count
    const mainCountPerCategory = useMemo(() => {
        const result: Record<string, number> = {};
        for (const [cat, docs] of Object.entries(categorizedDocs)) {
            result[cat] = (docs as any[]).filter((d: any) => !d.entryType || d.entryType === 'exigencia_principal').length;
        }
        return result;
    }, [categorizedDocs]);
    const readinessScore = allDocsList.length > 0
        ? Math.round((allDocsList.filter(d => d.hasMatch).length / allDocsList.length) * 100)
        : 0;

    return {
        // V2-aware data
        executiveSummary,
        processMetadata,
        technicalOpinion,
        penaltiesText,
        penaltiesStructured,
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
        mainRequirementCount, mainCountPerCategory,
    };
}
