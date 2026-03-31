"use strict";
/**
 * ══════════════════════════════════════════════════════════════════
 *  Module Context Contracts — Contratos de Contexto por Módulo
 * ══════════════════════════════════════════════════════════════════
 *
 *  Define explicitamente qual recorte do schemaV2 cada módulo
 *  consumidor deve receber. Evita excesso, omissão ou mistura.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MODULE_CONTRACTS = void 0;
exports.buildModuleContext = buildModuleContext;
// ── Contratos ──
exports.MODULE_CONTRACTS = {
    chat: {
        moduleName: 'chat',
        description: 'Consultor técnico-licitatório que responde perguntas do usuário sobre o edital',
        contextStrategy: 'full',
        maxTokenEstimate: 4000,
        requiredSections: [
            'process_identification',
            'timeline',
            'participation_conditions',
            'requirements',
            'technical_analysis',
            'legal_risk_review.critical_points',
            'legal_risk_review.ambiguities',
            'legal_risk_review.inconsistencies',
            'confidence'
        ],
        optionalSections: [
            'economic_financial_analysis',
            'proposal_analysis',
            'contractual_analysis',
            'legal_risk_review.omissions',
            'legal_risk_review.points_for_impugnation_or_clarification',
            'evidence_registry'
        ],
        forbiddenSections: [
            'analysis_meta.rule_findings',
            'analysis_meta.quality_report'
        ]
    },
    petition: {
        moduleName: 'petition',
        description: 'Redator técnico-jurídico de impugnações, esclarecimentos e recursos',
        contextStrategy: 'risk_focused',
        maxTokenEstimate: 5000,
        requiredSections: [
            'process_identification',
            'timeline',
            'legal_risk_review.critical_points',
            'legal_risk_review.possible_restrictive_clauses',
            'legal_risk_review.ambiguities',
            'legal_risk_review.inconsistencies',
            'legal_risk_review.omissions',
            'legal_risk_review.points_for_impugnation_or_clarification',
            'evidence_registry'
        ],
        optionalSections: [
            'participation_conditions',
            'requirements',
            'technical_analysis',
            'confidence'
        ],
        forbiddenSections: [
            'operational_outputs',
            'analysis_meta.rule_findings',
            'analysis_meta.quality_report'
        ]
    },
    oracle: {
        moduleName: 'oracle',
        description: 'Comparador técnico entre exigências do edital e acervo/atestados da empresa',
        contextStrategy: 'technical_focused',
        maxTokenEstimate: 3500,
        requiredSections: [
            'process_identification',
            'requirements.qualificacao_tecnica_operacional',
            'requirements.qualificacao_tecnica_profissional',
            'technical_analysis',
            'evidence_registry',
            'participation_conditions'
        ],
        optionalSections: [
            'requirements.qualificacao_economico_financeira',
            'legal_risk_review.critical_points',
            'proposal_analysis'
        ],
        forbiddenSections: [
            'operational_outputs',
            'contractual_analysis',
            'timeline',
            'analysis_meta'
        ]
    },
    dossier: {
        moduleName: 'dossier',
        description: 'Organizador de documentação e prontidão licitatória',
        contextStrategy: 'document_focused',
        maxTokenEstimate: 3500,
        requiredSections: [
            'process_identification',
            'requirements',
            'operational_outputs.documents_to_prepare',
            'operational_outputs.internal_checklist',
            'evidence_registry',
            'timeline'
        ],
        optionalSections: [
            'technical_analysis',
            'participation_conditions',
            'legal_risk_review.critical_points',
            'economic_financial_analysis'
        ],
        forbiddenSections: [
            'contractual_analysis',
            'proposal_analysis',
            'analysis_meta.quality_report'
        ]
    },
    declaration: {
        moduleName: 'declaration',
        description: 'Gerador formal de declarações licitatórias com alta precisão e baixa criatividade',
        contextStrategy: 'compact',
        maxTokenEstimate: 2500,
        requiredSections: [
            'process_identification',
            'participation_conditions',
            'operational_outputs.declaration_routes'
        ],
        optionalSections: [
            'requirements.habilitacao_juridica',
            'requirements.documentos_complementares',
            'requirements.qualificacao_tecnica_profissional',
            'requirements.qualificacao_tecnica_operacional',
            'requirements.qualificacao_economico_financeira',
            'requirements.regularidade_fiscal_trabalhista',
            'timeline',
            'evidence_registry'
        ],
        forbiddenSections: [
            'legal_risk_review',
            'technical_analysis',
            'contractual_analysis',
            'analysis_meta'
        ]
    },
    proposal: {
        moduleName: 'proposal',
        description: 'Estruturador de insumos para proposta comercial e documental',
        contextStrategy: 'proposal_focused',
        maxTokenEstimate: 4000,
        requiredSections: [
            'process_identification',
            'requirements.proposta_comercial',
            'proposal_analysis',
            'operational_outputs.proposal_routes',
            'timeline',
            'evidence_registry'
        ],
        optionalSections: [
            'economic_financial_analysis',
            'technical_analysis.parcelas_relevantes',
            'legal_risk_review.critical_points',
            'legal_risk_review.inconsistencies',
            'requirements.qualificacao_tecnica_operacional'
        ],
        forbiddenSections: [
            'participation_conditions',
            'analysis_meta.quality_report'
        ]
    }
};
/**
 * Monta contexto textual especializado a partir do schema,
 * respeitando o contrato do módulo.
 */
function buildModuleContext(schema, moduleName) {
    if (!schema)
        return '';
    const contract = exports.MODULE_CONTRACTS[moduleName];
    const sections = [];
    // ── Identificação (todos os módulos) ──
    if (contract.requiredSections.some(s => s.startsWith('process_identification'))) {
        const pid = schema.process_identification || {};
        sections.push(`══ IDENTIFICAÇÃO DO PROCESSO ══
Órgão: ${pid.orgao || 'N/A'}
Edital: ${pid.numero_edital || 'N/A'} | Processo: ${pid.numero_processo || 'N/A'}
Modalidade: ${pid.modalidade || 'N/A'} | Critério: ${pid.criterio_julgamento || 'N/A'}
Objeto: ${pid.objeto_completo || pid.objeto_resumido || 'N/A'}
Tipo: ${pid.tipo_objeto || 'N/A'} | UF: ${pid.municipio_uf || 'N/A'}`);
    }
    // ── Timeline ──
    if (contract.requiredSections.includes('timeline') || contract.optionalSections.includes('timeline')) {
        const tl = schema.timeline || {};
        if (tl.data_sessao) {
            sections.push(`══ PRAZOS ══
Sessão: ${tl.data_sessao || 'N/A'}
Publicação: ${tl.data_publicacao || 'N/A'}
Impugnação: ${tl.prazo_impugnacao || 'N/A'}
Esclarecimento: ${tl.prazo_esclarecimento || 'N/A'}
Proposta: ${tl.prazo_envio_proposta || 'N/A'}
Recurso: ${tl.prazo_recurso || 'N/A'}`);
        }
    }
    // ── Cond. Participação ──
    if (contract.requiredSections.includes('participation_conditions') || contract.optionalSections.includes('participation_conditions')) {
        const pc = schema.participation_conditions || {};
        sections.push(`══ CONDIÇÕES DE PARTICIPAÇÃO ══
Consórcio: ${pc.permite_consorcio === null ? 'N.I.' : pc.permite_consorcio ? 'SIM' : 'NÃO'}
Subcontratação: ${pc.permite_subcontratacao === null ? 'N.I.' : pc.permite_subcontratacao ? 'SIM' : 'NÃO'}
Visita Técnica: ${pc.exige_visita_tecnica === null ? 'N.I.' : pc.exige_visita_tecnica ? 'SIM — ' + (pc.visita_tecnica_detalhes || '') : 'NÃO'}
Garantia Proposta: ${pc.exige_garantia_proposta ? 'SIM — ' + (pc.garantia_proposta_detalhes || '') : 'NÃO'}
Garantia Contratual: ${pc.exige_garantia_contratual ? 'SIM — ' + (pc.garantia_contratual_detalhes || '') : 'NÃO'}
ME/EPP: ${pc.tratamento_me_epp || 'N/A'}`);
    }
    // ── Exigências ──
    const reqSectionsNeeded = contract.requiredSections.filter(s => s.startsWith('requirements'));
    if (reqSectionsNeeded.length > 0) {
        const reqs = schema.requirements || {};
        const categoryMap = {
            'habilitacao_juridica': 'Habilitação Jurídica',
            'regularidade_fiscal_trabalhista': 'Regularidade Fiscal/Trabalhista',
            'qualificacao_economico_financeira': 'Qualif. Econômico-Financeira',
            'qualificacao_tecnica_operacional': 'Qualif. Técnica Operacional',
            'qualificacao_tecnica_profissional': 'Qualif. Técnica Profissional',
            'proposta_comercial': 'Proposta Comercial',
            'documentos_complementares': 'Documentos Complementares'
        };
        // Determine which categories to include
        const includeAll = reqSectionsNeeded.includes('requirements');
        const specificCats = reqSectionsNeeded.filter(s => s.startsWith('requirements.')).map(s => s.replace('requirements.', ''));
        let reqText = '══ EXIGÊNCIAS ══\n';
        for (const [key, label] of Object.entries(categoryMap)) {
            if (!includeAll && !specificCats.includes(key))
                continue;
            const items = reqs[key];
            if (Array.isArray(items) && items.length > 0) {
                reqText += `\n▸ ${label}:\n`;
                for (const r of items) {
                    reqText += `  [${r.requirement_id || '?'}] ${r.title || ''}: ${r.description || ''}`;
                    if (r.mandatory)
                        reqText += ' (OBRIGATÓRIO)';
                    if (r.risk_if_missing)
                        reqText += ` [risco: ${r.risk_if_missing}]`;
                    reqText += '\n';
                }
            }
        }
        sections.push(reqText);
    }
    // ── Análise Técnica ──
    if (contract.requiredSections.some(s => s.startsWith('technical_analysis')) || contract.optionalSections.some(s => s.startsWith('technical_analysis'))) {
        const ta = schema.technical_analysis || {};
        let taText = '══ ANÁLISE TÉCNICA ══\n';
        taText += `Atestado: ${ta.exige_atestado_capacidade_tecnica ? 'SIM' : 'N.I.'} | CAT: ${ta.exige_cat ? 'SIM' : 'N.I.'} | ART: ${ta.exige_art ? 'SIM' : 'N.I.'}\n`;
        taText += `Acervo Profissional: ${ta.exige_acervo_profissional ? 'SIM' : 'N.I.'} | RT: ${ta.exige_responsavel_tecnico ? 'SIM' : 'N.I.'}\n`;
        if (ta.parcelas_relevantes?.length > 0) {
            taText += 'Parcelas Relevantes:\n';
            for (const p of ta.parcelas_relevantes) {
                taText += `  • ${p.item}: ${p.descricao} (mín: ${p.quantitativo_minimo || '?'} ${p.unidade || ''}) [${p.tipo || '?'}]\n`;
            }
        }
        if (ta.responsavel_tecnico_detalhes?.length > 0) {
            taText += `RT: ${ta.responsavel_tecnico_detalhes.join('; ')}\n`;
        }
        sections.push(taText);
    }
    // ── Econômico-Financeira ──
    if (contract.requiredSections.some(s => s.startsWith('economic_financial')) || contract.optionalSections.some(s => s.startsWith('economic_financial'))) {
        const ef = schema.economic_financial_analysis || {};
        let efText = '══ ECONÔMICO-FINANCEIRA ══\n';
        if (ef.indices_exigidos?.length > 0) {
            for (const idx of ef.indices_exigidos) {
                efText += `  • ${idx.indice}: ${idx.formula_ou_descricao || 'sem fórmula'} (mín: ${idx.valor_minimo || '?'})\n`;
            }
        }
        if (ef.patrimonio_liquido_minimo)
            efText += `PL Mínimo: ${ef.patrimonio_liquido_minimo}\n`;
        if (ef.capital_social_minimo)
            efText += `Capital Social Mínimo: ${ef.capital_social_minimo}\n`;
        sections.push(efText);
    }
    // ── Proposta ──
    if (contract.requiredSections.some(s => s.startsWith('proposal_analysis')) || contract.optionalSections.some(s => s.startsWith('proposal_analysis'))) {
        const pa = schema.proposal_analysis || {};
        let paText = '══ PROPOSTA COMERCIAL ══\n';
        paText += `Planilha: ${pa.exige_planilha_orcamentaria ? 'SIM' : 'N.I.'} | Carta: ${pa.exige_carta_proposta ? 'SIM' : 'N.I.'}\n`;
        paText += `BDI: ${pa.exige_composicao_bdi ? 'SIM' : 'N.I.'} | Cronograma: ${pa.exige_cronograma ? 'SIM' : 'N.I.'}\n`;
        paText += `Marca/Modelo: ${pa.exige_marca_modelo_fabricante ? 'SIM' : 'N.I.'} | Catálogo: ${pa.exige_catalogo_ficha_tecnica_manual ? 'SIM' : 'N.I.'}\n`;
        if (pa.criterios_desclassificacao_proposta?.length > 0) {
            paText += 'Desclassificação:\n';
            pa.criterios_desclassificacao_proposta.forEach((c) => paText += `  ⚠️ ${c}\n`);
        }
        if (pa.criterios_exequibilidade?.length > 0) {
            paText += 'Exequibilidade:\n';
            pa.criterios_exequibilidade.forEach((c) => paText += `  📐 ${c}\n`);
        }
        sections.push(paText);
    }
    // ── Riscos ──
    if (contract.requiredSections.some(s => s.startsWith('legal_risk_review')) || contract.optionalSections.some(s => s.startsWith('legal_risk_review'))) {
        const rr = schema.legal_risk_review || {};
        if (rr.critical_points?.length > 0) {
            let rrText = '══ RISCOS E PONTOS CRÍTICOS ══\n';
            for (const cp of rr.critical_points) {
                rrText += `  🔴 [${(cp.severity || '').toUpperCase()}] ${cp.title}\n`;
                rrText += `     ${cp.description || ''}\n`;
                if (cp.reason)
                    rrText += `     Razão: ${cp.reason}\n`;
                rrText += `     ➜ ${cp.recommended_action || 'Sem ação definida'}\n`;
            }
            sections.push(rrText);
        }
        if (rr.ambiguities?.length > 0) {
            sections.push('Ambiguidades:\n' + rr.ambiguities.map((a) => `  ⚠️ ${a}`).join('\n'));
        }
        if (rr.inconsistencies?.length > 0) {
            sections.push('Inconsistências:\n' + rr.inconsistencies.map((i) => `  ❌ ${i}`).join('\n'));
        }
        if (rr.omissions?.length > 0) {
            sections.push('Omissões:\n' + rr.omissions.map((o) => `  ❓ ${o}`).join('\n'));
        }
        if (rr.points_for_impugnation_or_clarification?.length > 0) {
            sections.push('Impugnação/Esclarecimento:\n' + rr.points_for_impugnation_or_clarification.map((p) => `  📌 ${p}`).join('\n'));
        }
    }
    // ── Outputs Operacionais ──
    if (contract.requiredSections.some(s => s.startsWith('operational_outputs')) || contract.optionalSections.some(s => s.startsWith('operational_outputs'))) {
        const oo = schema.operational_outputs || {};
        if (oo.documents_to_prepare?.length > 0) {
            let ooText = '══ DOCUMENTOS A PREPARAR ══\n';
            for (const doc of oo.documents_to_prepare) {
                ooText += `  📋 ${doc.document_name} [${(doc.priority || '').toUpperCase()}] — ${doc.responsible_area || 'N/A'}\n`;
            }
            sections.push(ooText);
        }
        if (oo.declaration_routes?.length > 0) {
            sections.push('Declarações Necessárias:\n' + oo.declaration_routes.map((d) => `  📝 ${typeof d === 'string' ? d : d.name || d.title || JSON.stringify(d)}`).join('\n'));
        }
        if (oo.proposal_routes?.length > 0) {
            sections.push('Itens da Proposta:\n' + oo.proposal_routes.map((p) => `  📦 ${typeof p === 'string' ? p : p.name || p.title || JSON.stringify(p)}`).join('\n'));
        }
        if (oo.internal_checklist?.length > 0) {
            sections.push('Checklist Interno:\n' + oo.internal_checklist.map((c) => `  ☐ ${typeof c === 'string' ? c : c.item || JSON.stringify(c)}`).join('\n'));
        }
    }
    // ── Evidências (quando requerido) ──
    if (contract.requiredSections.includes('evidence_registry') || contract.optionalSections.includes('evidence_registry')) {
        const ev = schema.evidence_registry || [];
        if (ev.length > 0) {
            let evText = `══ EVIDÊNCIAS (${ev.length} registros) ══\n`;
            // Limitar a 15 para não estourar tokens
            const displayed = ev.slice(0, 15);
            for (const e of displayed) {
                evText += `  [${e.evidence_id}] ${e.section || ''} p.${e.page || '?'}: "${(e.excerpt || '').substring(0, 80)}"\n`;
            }
            if (ev.length > 15)
                evText += `  ... e mais ${ev.length - 15} evidências\n`;
            sections.push(evText);
        }
    }
    // ── Confiança ──
    if (contract.requiredSections.includes('confidence') || contract.optionalSections.includes('confidence')) {
        const conf = schema.confidence || {};
        sections.push(`══ CONFIANÇA ══
Nível: ${conf.overall_confidence || 'N/A'}${conf.score_percentage ? ` (${conf.score_percentage}%)` : ''}`);
    }
    return sections.join('\n\n');
}
