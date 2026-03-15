"use strict";
/**
 * ══════════════════════════════════════════════════════════════════
 *  Risk Rules Engine — Regras Determinísticas de Domínio
 * ══════════════════════════════════════════════════════════════════
 *
 *  Complementa a IA com validações objetivas e repetíveis.
 *  Executa pós-normalização para reforçar coerência.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeRiskRules = executeRiskRules;
// ── Regras ──
const rules = [
    // R01 — CAT mencionada mas sem técnica profissional
    {
        name: 'R01-CAT-sem-profissional',
        fn: (s) => {
            const findings = [];
            if (s.technical_analysis.exige_cat && s.requirements.qualificacao_tecnica_profissional.length === 0) {
                findings.push({
                    code: 'R01', severity: 'high', category: 'qualificacao_tecnica',
                    message: 'Edital exige CAT mas nenhuma exigência de Qualificação Técnica Profissional foi identificada. Verifique se há exigência de acervo de profissional que não foi classificada.',
                    affectedFields: ['technical_analysis.exige_cat', 'requirements.qualificacao_tecnica_profissional'],
                    recommendation: 'Revisar se a CAT exigida é da empresa (operacional) ou do profissional (profissional).'
                });
            }
            return findings;
        }
    },
    // R02 — Atestado operacional sem evidence_refs
    {
        name: 'R02-atestado-sem-evidencia',
        fn: (s) => {
            const findings = [];
            for (const req of s.requirements.qualificacao_tecnica_operacional) {
                if (!req.evidence_refs || req.evidence_refs.length === 0) {
                    findings.push({
                        code: 'R02', severity: 'medium', category: 'evidencia',
                        message: `Exigência técnica operacional "${req.title}" (${req.requirement_id}) sem evidência textual vinculada.`,
                        affectedFields: [`requirements.qualificacao_tecnica_operacional.${req.requirement_id}`],
                        recommendation: 'Vincular trecho do edital que fundamenta esta exigência.'
                    });
                }
            }
            return findings;
        }
    },
    // R03 — Índice econômico sem fórmula
    {
        name: 'R03-indice-sem-formula',
        fn: (s) => {
            const findings = [];
            for (const idx of s.economic_financial_analysis.indices_exigidos) {
                if (!idx.formula_ou_descricao || idx.formula_ou_descricao.trim() === '') {
                    findings.push({
                        code: 'R03', severity: 'medium', category: 'economico_financeira',
                        message: `Índice "${idx.indice}" exigido sem fórmula ou descrição especificada.`,
                        affectedFields: ['economic_financial_analysis.indices_exigidos'],
                        recommendation: 'Buscar no edital a fórmula exata do índice.'
                    });
                }
            }
            return findings;
        }
    },
    // R04 — Visita técnica obrigatória = ponto crítico
    {
        name: 'R04-visita-tecnica-obrigatoria',
        fn: (s) => {
            const findings = [];
            if (s.participation_conditions.exige_visita_tecnica === true) {
                findings.push({
                    code: 'R04', severity: 'high', category: 'participacao',
                    message: 'Edital exige visita técnica obrigatória. Atenção ao prazo e local para não perder a oportunidade.',
                    affectedFields: ['participation_conditions.exige_visita_tecnica'],
                    recommendation: 'Verificar se há justificativa adequada e se a visita pode ser substituída por declaração (Súmula TCU 289).'
                });
            }
            return findings;
        }
    },
    // R05 — Parcela relevante sem quantitativo
    {
        name: 'R05-parcela-sem-quantitativo',
        fn: (s) => {
            const findings = [];
            for (const p of s.technical_analysis.parcelas_relevantes) {
                if (!p.quantitativo_minimo || p.quantitativo_minimo.trim() === '') {
                    findings.push({
                        code: 'R05', severity: 'medium', category: 'qualificacao_tecnica',
                        message: `Parcela relevante "${p.item}: ${p.descricao}" identificada sem quantitativo mínimo.`,
                        affectedFields: ['technical_analysis.parcelas_relevantes'],
                        recommendation: 'Buscar no TR/anexos o quantitativo mínimo exigido.'
                    });
                }
            }
            return findings;
        }
    },
    // R06 — Ponto crítico sem evidence_refs
    {
        name: 'R06-risco-sem-evidencia',
        fn: (s) => {
            const findings = [];
            for (const cp of s.legal_risk_review.critical_points) {
                if (!cp.evidence_refs || cp.evidence_refs.length === 0) {
                    findings.push({
                        code: 'R06', severity: 'medium', category: 'risk_review',
                        message: `Ponto crítico "${cp.title}" (${cp.severity}) sem evidência textual que o sustente.`,
                        affectedFields: ['legal_risk_review.critical_points'],
                        recommendation: 'Vincular trecho do edital que fundamenta o risco.'
                    });
                }
            }
            return findings;
        }
    },
    // R07 — Critério de julgamento não identificado
    {
        name: 'R07-criterio-ausente',
        fn: (s) => {
            if (!s.process_identification.criterio_julgamento) {
                return [{
                        code: 'R07', severity: 'high', category: 'identificacao',
                        message: 'Critério de julgamento não identificado (menor preço, técnica e preço, maior desconto, etc.).',
                        affectedFields: ['process_identification.criterio_julgamento'],
                        recommendation: 'Informação essencial para a estratégia de precificação.'
                    }];
            }
            return [];
        }
    },
    // R08 — Garantia contratual sem percentual
    {
        name: 'R08-garantia-sem-detalhe',
        fn: (s) => {
            if (s.participation_conditions.exige_garantia_contratual && !s.participation_conditions.garantia_contratual_detalhes) {
                return [{
                        code: 'R08', severity: 'medium', category: 'participacao',
                        message: 'Garantia contratual exigida mas percentual/valor não especificado.',
                        affectedFields: ['participation_conditions.garantia_contratual_detalhes']
                    }];
            }
            return [];
        }
    },
    // R09 — Engenharia sem parcela relevante
    {
        name: 'R09-engenharia-sem-parcela',
        fn: (s) => {
            const tipo = s.process_identification.tipo_objeto;
            if ((tipo === 'engenharia' || tipo === 'obra' || tipo === 'obra_engenharia' || tipo === 'servico_comum_engenharia') && s.technical_analysis.parcelas_relevantes.length === 0) {
                return [{
                        code: 'R09', severity: 'high', category: 'qualificacao_tecnica',
                        message: 'Edital de engenharia/obra sem parcelas de maior relevância identificadas. Provável falha na extração ou omissão.',
                        affectedFields: ['technical_analysis.parcelas_relevantes'],
                        recommendation: 'Verificar Termo de Referência e anexos para parcelas de maior relevância.'
                    }];
            }
            return [];
        }
    },
    // R10 — Data da sessão no passado
    {
        name: 'R10-sessao-passado',
        fn: (s) => {
            if (!s.timeline.data_sessao)
                return [];
            // Tenta parsear vários formatos
            const dateStr = s.timeline.data_sessao;
            const match = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
            if (match) {
                const parsed = new Date(`${match[3]}-${match[2]}-${match[1]}`);
                if (parsed < new Date()) {
                    return [{
                            code: 'R10', severity: 'critical', category: 'timeline',
                            message: `Data da sessão (${dateStr}) aparenta estar no passado.`,
                            affectedFields: ['timeline.data_sessao'],
                            recommendation: 'Verificar se a data extraída está correta ou se houve suspensão/adiamento.'
                        }];
                }
            }
            return [];
        }
    },
    // R11 — Exigência sem mandatory flag
    {
        name: 'R11-obrigatoriedade-incerta',
        fn: (s) => {
            const findings = [];
            const allReqs = Object.values(s.requirements).flat();
            const uncertain = allReqs.filter(r => r.mandatory === undefined || r.mandatory === null);
            if (uncertain.length > 3) {
                findings.push({
                    code: 'R11', severity: 'medium', category: 'normalizacao',
                    message: `${uncertain.length} exigências sem indicação se são obrigatórias ou não.`,
                    affectedFields: ['requirements'],
                    recommendation: 'Na maioria dos editais, exigências de habilitação são obrigatórias por padrão.'
                });
            }
            return findings;
        }
    },
    // R12 — Evidência órfã (sem referência)
    {
        name: 'R12-evidencia-orfa',
        fn: (s) => {
            const findings = [];
            const referencedIds = new Set();
            // Collect all evidence_refs from requirements
            Object.values(s.requirements).flat().forEach(r => r.evidence_refs?.forEach((id) => referencedIds.add(id)));
            s.technical_analysis.parcelas_relevantes.forEach(p => p.evidence_refs?.forEach((id) => referencedIds.add(id)));
            s.economic_financial_analysis.indices_exigidos.forEach(i => i.evidence_refs?.forEach((id) => referencedIds.add(id)));
            s.legal_risk_review.critical_points.forEach(cp => cp.evidence_refs?.forEach((id) => referencedIds.add(id)));
            const orphans = s.evidence_registry.filter(e => !referencedIds.has(e.evidence_id));
            if (orphans.length > 5) {
                findings.push({
                    code: 'R12', severity: 'low', category: 'evidencia',
                    message: `${orphans.length} evidências no registry sem referência de nenhuma exigência ou ponto crítico.`,
                    affectedFields: ['evidence_registry']
                });
            }
            return findings;
        }
    },
    // R13 — Subcontratação permitida mas sem limites
    {
        name: 'R13-subcontratacao-sem-limite',
        fn: (s) => {
            if (s.participation_conditions.permite_subcontratacao === true) {
                const details = s.participation_conditions.outras_condicoes?.join(' ').toLowerCase() || '';
                if (!details.includes('subcontrat') && !details.includes('limite') && !details.includes('percentual')) {
                    return [{
                            code: 'R13', severity: 'low', category: 'participacao',
                            message: 'Subcontratação permitida mas sem limites/condições claramente identificados.',
                            affectedFields: ['participation_conditions.permite_subcontratacao'],
                            recommendation: 'Verificar no edital os percentuais e condições para subcontratação.'
                        }];
                }
            }
            return [];
        }
    },
    // R14 — Proposta exige BDI mas sem composição
    {
        name: 'R14-bdi-sem-composicao',
        fn: (s) => {
            if (s.proposal_analysis.exige_composicao_bdi && !s.proposal_analysis.exige_planilha_orcamentaria) {
                return [{
                        code: 'R14', severity: 'medium', category: 'proposta',
                        message: 'Edital exige composição de BDI mas aparentemente não exige planilha orçamentária.',
                        affectedFields: ['proposal_analysis'],
                        recommendation: 'Normalmente BDI acompanha planilha orçamentária. Verificar se há exigência implícita.'
                    }];
            }
            return [];
        }
    },
    // R15 — Muitas exigências sem risk_if_missing
    {
        name: 'R15-risco-ausencia-nao-mapeado',
        fn: (s) => {
            const allReqs = Object.values(s.requirements).flat();
            const withoutRisk = allReqs.filter(r => !r.risk_if_missing || r.risk_if_missing.trim() === '');
            if (withoutRisk.length > 5) {
                return [{
                        code: 'R15', severity: 'low', category: 'normalizacao',
                        message: `${withoutRisk.length} exigências sem risk_if_missing preenchido.`,
                        affectedFields: ['requirements'],
                        recommendation: 'Cada exigência deve indicar a consequência de não atendê-la.'
                    }];
            }
            return [];
        }
    }
];
// ── Executor ──
/**
 * Executa todas as regras sobre o schema e retorna findings.
 */
function executeRiskRules(schema) {
    const findings = [];
    for (const rule of rules) {
        try {
            const result = rule.fn(schema);
            findings.push(...result);
        }
        catch (err) {
            console.warn(`[RiskRules] Regra ${rule.name} falhou: ${err.message}`);
        }
    }
    // Sort by severity
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    findings.sort((a, b) => (severityOrder[a.severity] || 3) - (severityOrder[b.severity] || 3));
    console.log(`[RiskRules] ${findings.length} findings (${findings.filter(f => f.severity === 'critical').length} critical, ${findings.filter(f => f.severity === 'high').length} high)`);
    return findings;
}
