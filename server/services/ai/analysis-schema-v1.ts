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

// ── Tipos auxiliares ──

export type WorkflowStageStatus = 'pending' | 'done' | 'failed';
export type SourceType = 'upload_manual' | 'pncp_download';
export type TipoObjeto = 'servico' | 'obra' | 'engenharia' | 'fornecimento' | 'locacao' | 'servico_comum' | 'servico_comum_engenharia' | 'obra_engenharia' | 'outro';
export type AplicaA = 'licitante' | 'consorcio' | 'subcontratada' | 'nao_informado';
export type TipoParcela = 'operacional' | 'profissional' | 'nao_informado';
export type SeveridadeRisco = 'baixa' | 'media' | 'alta' | 'critica';
export type CategoriaRisco = 'habilitacao' | 'proposta' | 'tecnica' | 'economico_financeira' | 'prazo' | 'contratual' | 'outro';
export type Prioridade = 'baixa' | 'media' | 'alta' | 'critica';
export type AreaResponsavel = 'juridico' | 'contabil' | 'engenharia' | 'comercial' | 'administrativo' | 'licitacoes' | 'diretoria' | 'outro';
export type TipoDocumentoFonte = 'edital' | 'tr' | 'pb' | 'minuta' | 'anexo' | 'planilha' | 'outro';
export type NivelConfianca = 'baixa' | 'media' | 'alta';

// ── Interfaces do Schema ──

export interface AnalysisMeta {
  analysis_id: string;
  analysis_version: string;   // Sempre "1.0" nesta versão
  generated_at: string;       // ISO 8601
  source_type: SourceType;
  source_files: string[];
  model_used: string;
  workflow_stage_status: {
    extraction: WorkflowStageStatus;
    normalization: WorkflowStageStatus;
    risk_review: WorkflowStageStatus;
    validation: WorkflowStageStatus;
  };
}

export interface ProcessIdentification {
  orgao: string;
  unidade_compradora: string;
  numero_processo: string;
  numero_edital: string;
  modalidade: string;
  forma_disputa: string;
  criterio_julgamento: string;
  regime_execucao: string;
  tipo_objeto: TipoObjeto;
  objeto_resumido: string;
  objeto_completo: string;
  fonte_oficial: string;
  municipio_uf: string;
  valor_estimado_global: number;
  portal_licitacao: string;
  link_sistema: string | null;
  numero_comprasnet?: string;
}

export interface Timeline {
  data_publicacao: string;
  data_sessao: string;
  prazo_impugnacao: string;
  prazo_esclarecimento: string;
  prazo_envio_proposta: string;
  prazo_envio_habilitacao: string;
  prazo_amostra: string;
  prazo_recurso: string;
  prazo_contrarrazoes: string;
  outros_prazos: Array<{ descricao: string; data: string; evidence_refs?: string[] }>;
}

export interface ParticipationConditions {
  permite_consorcio: boolean | null;
  permite_subcontratacao: boolean | null;
  exige_visita_tecnica: boolean | null;
  visita_tecnica_detalhes: string;
  exige_garantia_proposta: boolean | null;
  garantia_proposta_detalhes: string;
  exige_garantia_contratual: boolean | null;
  garantia_contratual_detalhes: string;
  exige_amostra: boolean | null;
  amostra_detalhes: string;
  tratamento_me_epp: string;
  participacao_restrita: string;
  outras_condicoes: string[];
}

export interface Requirement {
  requirement_id: string;
  title: string;
  description: string;
  mandatory: boolean;
  applies_to: AplicaA;
  risk_if_missing: string;
  evidence_refs: string[];  // IDs do evidence_registry
}

export interface Requirements {
  habilitacao_juridica: Requirement[];
  regularidade_fiscal_trabalhista: Requirement[];
  qualificacao_economico_financeira: Requirement[];
  qualificacao_tecnica_operacional: Requirement[];
  qualificacao_tecnica_profissional: Requirement[];
  proposta_comercial: Requirement[];
  documentos_complementares: Requirement[];
}

export interface ParcelaRelevante {
  item: string;
  descricao: string;
  quantitativo_minimo: string;
  unidade: string;
  percentual_minimo: string;
  tipo: TipoParcela;
  evidence_refs: string[];
}

export interface TechnicalAnalysis {
  exige_atestado_capacidade_tecnica: boolean | null;
  exige_comprovacao_parcelas_relevantes: boolean | null;
  parcelas_relevantes: ParcelaRelevante[];
  exige_cat: boolean | null;
  exige_art: boolean | null;
  exige_rrt: boolean | null;
  exige_acervo_profissional: boolean | null;
  exige_responsavel_tecnico: boolean | null;
  responsavel_tecnico_detalhes: string[];
  exige_registro_conselho: boolean | null;
  registro_conselho_detalhes: string[];
  exigencias_tecnicas_especificas: string[];
}

export interface IndiceExigido {
  indice: string;
  formula_ou_descricao: string;
  valor_minimo: string;
  evidence_refs: string[];
}

export interface EconomicFinancialAnalysis {
  exige_balanco: boolean | null;
  exige_indices: boolean | null;
  indices_exigidos: IndiceExigido[];
  exige_patrimonio_liquido_minimo: boolean | null;
  patrimonio_liquido_minimo: string;
  exige_capital_social_minimo: boolean | null;
  capital_social_minimo: string;
  exige_garantias_adicionais: boolean | null;
  outras_exigencias_ef: string[];
}

export interface ProposalAnalysis {
  exige_planilha_orcamentaria: boolean | null;
  exige_carta_proposta: boolean | null;
  exige_composicao_bdi: boolean | null;
  exige_cronograma: boolean | null;
  exige_marca_modelo_fabricante: boolean | null;
  exige_catalogo_ficha_tecnica_manual: boolean | null;
  exige_declaracao_fabricante: boolean | null;
  criterios_desclassificacao_proposta: string[];
  criterios_exequibilidade: string[];
  criterios_desempate: string[];
  observacoes_proposta: string[];
  itens_licitados: Array<{ itemNumber: string; description: string; unit: string; quantity: number; referencePrice: number; multiplier?: number; multiplierLabel?: string }>;
}

export interface ContractualAnalysis {
  prazo_execucao: string;
  prazo_vigencia: string;
  reajuste: string;
  repactuacao: string;
  medicao_pagamento: string;
  penalidades: string[];
  obrigacoes_contratada: string[];
  obrigacoes_contratante: string[];
  matriz_risco_contratual: string[];
}

export interface CriticalPoint {
  title: string;
  category: CategoriaRisco;
  severity: SeveridadeRisco;
  description: string;
  reason: string;
  recommended_action: string;
  evidence_refs: string[];
}

export interface LegalRiskReview {
  critical_points: CriticalPoint[];
  possible_restrictive_clauses: string[];
  ambiguities: string[];
  inconsistencies: string[];
  omissions: string[];
  points_for_impugnation_or_clarification: string[];
}

export interface DocumentToPrepare {
  document_name: string;
  category: string;
  priority: Prioridade;
  responsible_area: AreaResponsavel;
  notes: string;
}

export interface OperationalOutputs {
  documents_to_prepare: DocumentToPrepare[];
  technical_documents_needed: string[];
  proposal_inputs_needed: string[];
  internal_checklist: string[];
  questions_for_consultor_chat: string[];
  possible_petition_routes: string[];
  declaration_routes: string[];
  proposal_routes: string[];
}

export interface EvidenceEntry {
  evidence_id: string;
  document_type: TipoDocumentoFonte;
  document_name: string;
  page: string;
  section: string;
  excerpt: string;
  normalized_topic: string;
}

export interface ConfidenceScore {
  overall_confidence: NivelConfianca;
  section_confidence: {
    identification: NivelConfianca;
    timeline: NivelConfianca;
    technical: NivelConfianca;
    economic_financial: NivelConfianca;
    proposal: NivelConfianca;
    contractual: NivelConfianca;
    risk_review: NivelConfianca;
  };
  missing_sections: string[];
  warnings: string[];
}

// ══════════════════════════════════════════════════════════════════
// Schema Principal — AnalysisSchemaV1
// ══════════════════════════════════════════════════════════════════

export interface AnalysisSchemaV1 {
  analysis_meta: AnalysisMeta;
  process_identification: ProcessIdentification;
  timeline: Timeline;
  participation_conditions: ParticipationConditions;
  requirements: Requirements;
  technical_analysis: TechnicalAnalysis;
  economic_financial_analysis: EconomicFinancialAnalysis;
  proposal_analysis: ProposalAnalysis;
  contractual_analysis: ContractualAnalysis;
  legal_risk_review: LegalRiskReview;
  operational_outputs: OperationalOutputs;
  evidence_registry: EvidenceEntry[];
  confidence: ConfidenceScore;
}

// ── Factory: Schema vazio para inicialização ──

export function createEmptyAnalysisSchema(): AnalysisSchemaV1 {
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
