"use strict";
/**
 * ══════════════════════════════════════════════════════════════════
 *  Analysis Schema V1 — Contrato JSON Mestre do LicitaSaaS
 * ══════════════════════════════════════════════════════════════════
 *
 *  Este schema define a estrutura OBRIGATÓRIA de saída da análise
 *  de editais. Todos os módulos de IA consumem este formato.
 *
 *  Princípios:
 *  1. Separar fato, inferência e recomendação
 *  2. Classificar tudo segundo lógica licitatória
 *  3. Registrar evidência textual
 *  4. Permitir consumo por outros módulos
 *  5. Suportar análise jurídica e operacional
 *
 *  Regras de preenchimento:
 *  - Campos não identificados: null, "" ou []
 *  - Nunca inventar dado ausente
 *  - Cada ponto crítico deve apontar evidence_refs
 *  - Exigências classificadas na categoria correta
 *  - Inferências FORA dos campos factuais
 *  - Risco e recomendação SÓ nas seções analíticas
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEmptyAnalysisSchema = createEmptyAnalysisSchema;
// ── Factory: Schema vazio para inicialização ──
function createEmptyAnalysisSchema() {
    return {
        analysis_meta: {
            analysis_id: '',
            analysis_version: '1.0',
            generated_at: new Date().toISOString(),
            source_type: 'upload_manual',
            source_files: [],
            model_used: '',
            workflow_stage_status: {
                extraction: 'pending',
                normalization: 'pending',
                risk_review: 'pending',
                validation: 'pending',
            },
        },
        process_identification: {
            orgao: '', unidade_compradora: '', numero_processo: '', numero_edital: '',
            modalidade: '', forma_disputa: '', criterio_julgamento: '', regime_execucao: '',
            tipo_objeto: 'outro', objeto_resumido: '', objeto_completo: '', fonte_oficial: '', municipio_uf: '',
            valor_estimado_global: 0, portal_licitacao: '', link_sistema: null
        },
        timeline: {
            data_publicacao: '', data_sessao: '', prazo_impugnacao: '', prazo_esclarecimento: '',
            prazo_envio_proposta: '', prazo_envio_habilitacao: '', prazo_amostra: '',
            prazo_recurso: '', prazo_contrarrazoes: '', outros_prazos: [],
        },
        participation_conditions: {
            permite_consorcio: null, permite_subcontratacao: null, exige_visita_tecnica: null,
            visita_tecnica_detalhes: '', exige_garantia_proposta: null, garantia_proposta_detalhes: '',
            exige_garantia_contratual: null, garantia_contratual_detalhes: '', exige_amostra: null,
            amostra_detalhes: '', tratamento_me_epp: '', participacao_restrita: '', outras_condicoes: [],
        },
        requirements: {
            habilitacao_juridica: [], regularidade_fiscal_trabalhista: [],
            qualificacao_economico_financeira: [], qualificacao_tecnica_operacional: [],
            qualificacao_tecnica_profissional: [], proposta_comercial: [], documentos_complementares: [],
        },
        technical_analysis: {
            exige_atestado_capacidade_tecnica: null, exige_comprovacao_parcelas_relevantes: null,
            parcelas_relevantes: [], exige_cat: null, exige_art: null, exige_rrt: null,
            exige_acervo_profissional: null, exige_responsavel_tecnico: null,
            responsavel_tecnico_detalhes: [], exige_registro_conselho: null,
            registro_conselho_detalhes: [], exigencias_tecnicas_especificas: [],
        },
        economic_financial_analysis: {
            exige_balanco: null, exige_indices: null, indices_exigidos: [],
            exige_patrimonio_liquido_minimo: null, patrimonio_liquido_minimo: '',
            exige_capital_social_minimo: null, capital_social_minimo: '',
            exige_garantias_adicionais: null, outras_exigencias_ef: [],
        },
        proposal_analysis: {
            exige_planilha_orcamentaria: null, exige_carta_proposta: null,
            exige_composicao_bdi: null, exige_cronograma: null,
            exige_marca_modelo_fabricante: null, exige_catalogo_ficha_tecnica_manual: null,
            exige_declaracao_fabricante: null, criterios_desclassificacao_proposta: [],
            criterios_exequibilidade: [], criterios_desempate: [], observacoes_proposta: [],
            itens_licitados: [],
        },
        contractual_analysis: {
            prazo_execucao: '', prazo_vigencia: '', reajuste: '', repactuacao: '',
            medicao_pagamento: '', penalidades: [], obrigacoes_contratada: [],
            obrigacoes_contratante: [], matriz_risco_contratual: [],
        },
        legal_risk_review: {
            critical_points: [], possible_restrictive_clauses: [], ambiguities: [],
            inconsistencies: [], omissions: [], points_for_impugnation_or_clarification: [],
        },
        operational_outputs: {
            documents_to_prepare: [], technical_documents_needed: [],
            proposal_inputs_needed: [], internal_checklist: [],
            questions_for_consultor_chat: [], possible_petition_routes: [],
            declaration_routes: [], proposal_routes: [],
        },
        evidence_registry: [],
        confidence: {
            overall_confidence: 'media',
            section_confidence: {
                identification: 'media', timeline: 'media', technical: 'media',
                economic_financial: 'media', proposal: 'media', contractual: 'media', risk_review: 'media',
            },
            missing_sections: [],
            warnings: [],
        },
    };
}
