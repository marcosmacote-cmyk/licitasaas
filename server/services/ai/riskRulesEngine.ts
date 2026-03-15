/**
 * ══════════════════════════════════════════════════════════════════
 *  Risk Rules Engine — Regras Determinísticas de Domínio
 * ══════════════════════════════════════════════════════════════════
 *
 *  Complementa a IA com validações objetivas e repetíveis.
 *  Executa pós-normalização para reforçar coerência.
 */

import { AnalysisSchemaV1 } from './analysis-schema-v1';

export interface RuleFinding {
  code: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  category: string;
  message: string;
  affectedFields: string[];
  recommendation?: string;
}

type RuleFunction = (schema: AnalysisSchemaV1) => RuleFinding[];

// ── Regras ──

const rules: { name: string; fn: RuleFunction }[] = [

  // R01 — CAT mencionada mas sem técnica profissional
  {
    name: 'R01-CAT-sem-profissional',
    fn: (s) => {
      const findings: RuleFinding[] = [];
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
      const findings: RuleFinding[] = [];
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
      const findings: RuleFinding[] = [];
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
      const findings: RuleFinding[] = [];
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
      const findings: RuleFinding[] = [];
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
      const findings: RuleFinding[] = [];
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
      if (!s.timeline.data_sessao) return [];
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
      const findings: RuleFinding[] = [];
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
      const findings: RuleFinding[] = [];
      const referencedIds = new Set<string>();
      // Collect all evidence_refs from requirements
      Object.values(s.requirements).flat().forEach(r => r.evidence_refs?.forEach((id: string) => referencedIds.add(id)));
      s.technical_analysis.parcelas_relevantes.forEach(p => p.evidence_refs?.forEach((id: string) => referencedIds.add(id)));
      s.economic_financial_analysis.indices_exigidos.forEach(i => i.evidence_refs?.forEach((id: string) => referencedIds.add(id)));
      s.legal_risk_review.critical_points.forEach(cp => cp.evidence_refs?.forEach((id: string) => referencedIds.add(id)));

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
  },

  // R16 — Firma reconhecida / assinatura comprovada do RT
  {
    name: 'R16-firma-reconhecida-rt',
    fn: (s) => {
      const allReqs = Object.values(s.requirements).flat();
      const firmaReqs = allReqs.filter(r => {
        const text = `${r.title || ''} ${r.description || ''}`.toLowerCase();
        return text.includes('firma reconhec') || text.includes('reconhecimento de firma') || text.includes('assinatura autenticada') || text.includes('autenticação de assinatura');
      });
      if (firmaReqs.length > 0) {
        return [{
          code: 'R16', severity: 'high', category: 'qualificacao_tecnica',
          message: `Exigência de firma reconhecida/assinatura autenticada identificada (${firmaReqs.map(r => r.requirement_id).join(', ')}). Requer providência presencial em cartório com antecedência.`,
          affectedFields: firmaReqs.map(r => `requirements.${r.requirement_id}`),
          recommendation: 'Providenciar reconhecimento de firma em cartório com antecedência. Se houver dúvida sobre base legal, avaliar esclarecimento ao órgão antes de impugnar.'
        }];
      }
      return [];
    }
  },

  // R17 — Vínculo do RT não comprovado / não especificado
  {
    name: 'R17-vinculo-rt',
    fn: (s) => {
      const qtpReqs = s.requirements.qualificacao_tecnica_profissional || [];
      const vinculoReq = qtpReqs.find(r => {
        const text = `${r.title || ''} ${r.description || ''}`.toLowerCase();
        return text.includes('vínculo') || text.includes('quadro permanente') || text.includes('quadro técnico') || text.includes('ctps') || text.includes('contrato de trabalho');
      });
      if (vinculoReq) {
        return [{
          code: 'R17', severity: 'high', category: 'qualificacao_tecnica',
          message: `Exigência de comprovação de vínculo do responsável técnico (${vinculoReq.requirement_id}). Formas aceitas: CTPS, contrato social, contrato de prestação de serviços. Verificar se o edital restringe as formas admissíveis.`,
          affectedFields: [`requirements.qualificacao_tecnica_profissional.${vinculoReq.requirement_id}`],
          recommendation: 'Verificar antecipadamente que a forma de vínculo do RT atende aos termos do edital. Se restrito a CTPS, preparar documentação comprobatória junto ao RH.'
        }];
      }
      return [];
    }
  },

  // R18 — Garantia de proposta como requisito de habilitação
  {
    name: 'R18-garantia-proposta-habilitacao',
    fn: (s) => {
      if (s.participation_conditions.exige_garantia_proposta) {
        const detalhes = s.participation_conditions.garantia_proposta_detalhes || '';
        const qefReqs = s.requirements.qualificacao_economico_financeira || [];
        const garantiaReq = qefReqs.find(r => {
          const text = `${r.title || ''} ${r.description || ''}`.toLowerCase();
          return text.includes('garantia de proposta') || text.includes('garantia da proposta');
        });
        return [{
          code: 'R18', severity: 'high', category: 'economico_financeira',
          message: `Garantia de proposta exigida${detalhes ? ` (${detalhes})` : ''}${garantiaReq ? ` — ${garantiaReq.requirement_id}` : ''}. Requisito de habilitação: ausência = inabilitação imediata. Exige modalidade correta (seguro-garantia, fiança bancária ou caução) e upload no prazo.`,
          affectedFields: ['participation_conditions.exige_garantia_proposta', ...(garantiaReq ? [`requirements.qualificacao_economico_financeira.${garantiaReq.requirement_id}`] : [])],
          recommendation: 'Confirmar modalidade aceita, valor exato, e prazo de validade. Providenciar documento junto à seguradora/banco com antecedência.'
        }];
      }
      return [];
    }
  },

  // R19 — Quantitativos técnicos com potencial de barreira
  {
    name: 'R19-quantitativos-tecnicos',
    fn: (s) => {
      const findings: RuleFinding[] = [];
      for (const p of s.technical_analysis.parcelas_relevantes) {
        const percentual = parseFloat((p.percentual_minimo || '').replace(/[^0-9.,]/g, '').replace(',', '.'));
        if (percentual && percentual >= 50) {
          findings.push({
            code: 'R19', severity: 'high', category: 'qualificacao_tecnica',
            message: `Parcela "${p.item}: ${p.descricao}" exige comprovação de ${p.percentual_minimo} (${percentual}%) sobre o quantitativo. Percentuais elevados (≥50%) podem extrapolar o razoável.`,
            affectedFields: ['technical_analysis.parcelas_relevantes'],
            recommendation: `Avaliar se o quantitativo de ${p.quantitativo_minimo || 'N/I'} ${p.unidade || ''} corresponde ao percentual normativamente aceito. Se houver extrapolação, fundamentar impugnação.`
          });
        }
      }
      if (s.technical_analysis.parcelas_relevantes.length > 0 && findings.length === 0) {
        findings.push({
          code: 'R19', severity: 'medium', category: 'qualificacao_tecnica',
          message: `${s.technical_analysis.parcelas_relevantes.length} parcela(s) de maior relevância identificadas. Verificar se os quantitativos mínimos correspondem ao percentual legalmente aceito (normalmente ≤50% do item relevante).`,
          affectedFields: ['technical_analysis.parcelas_relevantes'],
          recommendation: 'Comparar quantitativos com o orçamento e verificar se estão restritos às parcelas de maior relevância.'
        });
      }
      return findings;
    }
  },

  // R20 — Visita técnica com prazo possivelmente curto
  {
    name: 'R20-visita-tecnica-prazo',
    fn: (s) => {
      if (s.participation_conditions.exige_visita_tecnica) {
        const detalhes = s.participation_conditions.visita_tecnica_detalhes || '';
        return [{
          code: 'R20', severity: 'medium', category: 'participacao',
          message: `Visita técnica exigida${detalhes ? ` — ${detalhes}` : ''}. Verificar se há data-limite e se há declaração substitutiva disponível.`,
          affectedFields: ['participation_conditions.exige_visita_tecnica'],
          recommendation: 'Agendar visita imediatamente ou verificar possibilidade de declaração substitutiva (Súmula TCU 289). Atenção ao prazo e documentação necessária para comprovação.'
        }];
      }
      return [];
    }
  },

  // R21 — Proposta com anexos obrigatórios e assinados
  {
    name: 'R21-proposta-anexos-obrigatorios',
    fn: (s) => {
      const findings: RuleFinding[] = [];
      const pcReqs = s.requirements.proposta_comercial || [];
      // Check if there are proposta requirements with "assinatura" or "rubrica" requirements
      const assinaturaReqs = pcReqs.filter(r => {
        const text = `${r.title || ''} ${r.description || ''}`.toLowerCase();
        return text.includes('assinad') || text.includes('rubricad') || text.includes('assinatura') || text.includes('rubrica');
      });
      if (assinaturaReqs.length > 0) {
        findings.push({
          code: 'R21', severity: 'medium', category: 'proposta',
          message: `Proposta exige documentos assinados/rubricados (${assinaturaReqs.map(r => r.requirement_id).join(', ')}). Ausência de assinatura é causa frequente de desclassificação.`,
          affectedFields: assinaturaReqs.map(r => `requirements.proposta_comercial.${r.requirement_id}`),
          recommendation: 'Listar todos os documentos da proposta que exigem assinatura. Preparar checklist de conferência antes do envio.'
        });
      }
      // Check for planilha/BDI/cronograma
      const annexCount = pcReqs.filter(r => {
        const text = `${r.title || ''} ${r.description || ''}`.toLowerCase();
        return text.includes('planilha') || text.includes('bdi') || text.includes('cronograma') || text.includes('composição');
      }).length;
      if (annexCount >= 2) {
        findings.push({
          code: 'R21b', severity: 'medium', category: 'proposta',
          message: `Proposta exige ${annexCount} documentos técnicos/financeiros (planilha, BDI, cronograma). Conferir completude antes do envio.`,
          affectedFields: ['requirements.proposta_comercial'],
          recommendation: 'Preparar todos os anexos com antecedência e conferir formatação conforme modelo do edital.'
        });
      }
      return findings;
    }
  },

  // R22 — Excessão declaração ME/EPP sem rubrica
  {
    name: 'R22-inexequibilidade-potencial',
    fn: (s) => {
      const tipo = s.process_identification.tipo_objeto;
      if (tipo === 'obra_engenharia' || tipo === 'servico_comum_engenharia') {
        const criterio = (s.process_identification.criterio_julgamento || '').toLowerCase();
        if (criterio.includes('menor preço') || criterio.includes('maior desconto')) {
          return [{
            code: 'R22', severity: 'medium', category: 'proposta',
            message: `Licitação de ${tipo === 'obra_engenharia' ? 'obra' : 'serviço de engenharia'} com critério "${s.process_identification.criterio_julgamento}". Há risco de análise de inexequibilidade sobre propostas com desconto elevado.`,
            affectedFields: ['process_identification.criterio_julgamento'],
            recommendation: 'Para obras/serviços de engenharia, proposta abaixo de 75% do orçamento referencial gera presunção de inexequibilidade (art. 59, §3º da Lei 14.133/21). Fundamentar BDI e composições unitárias.'
          }];
        }
      }
      return [];
    }
  }
];

// ── Executor ──

/**
 * Executa todas as regras sobre o schema e retorna findings.
 */
export function executeRiskRules(schema: AnalysisSchemaV1): RuleFinding[] {
  const findings: RuleFinding[] = [];

  for (const rule of rules) {
    try {
      const result = rule.fn(schema);
      findings.push(...result);
    } catch (err: any) {
      console.warn(`[RiskRules] Regra ${rule.name} falhou: ${err.message}`);
    }
  }

  // Sort by severity
  const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  findings.sort((a, b) => (severityOrder[a.severity] || 3) - (severityOrder[b.severity] || 3));

  console.log(`[RiskRules] ${findings.length} findings (${findings.filter(f => f.severity === 'critical').length} critical, ${findings.filter(f => f.severity === 'high').length} high)`);

  return findings;
}
