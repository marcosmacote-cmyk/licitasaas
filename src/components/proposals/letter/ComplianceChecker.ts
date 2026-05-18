/**
 * ══════════════════════════════════════════════════════════════
 * ComplianceChecker — Motor de Conformidade Edital
 * Verifica se a carta proposta atende às exigências do edital.
 * Cruza dados do schemaV2 (IA) com os blocos gerados e cockpit.
 * ══════════════════════════════════════════════════════════════
 */

import type { LetterBlock, ProposalLetterData, ProposalDeclaration } from './types';

// ── Compliance Item ──
export interface ComplianceItem {
    id: string;
    category: 'document' | 'data' | 'declaration' | 'financial' | 'consistency';
    label: string;
    status: 'ok' | 'warning' | 'fail' | 'info';
    message: string;
    editalClause?: string;
    suggestion?: string;
    blockId?: string;
}

export interface ComplianceResult {
    score: number;          // 0-100
    grade: 'A' | 'B' | 'C' | 'D';
    riskLevel: 'baixo' | 'medio' | 'alto' | 'critico';
    items: ComplianceItem[];
    summary: string;
    okCount: number;
    warnCount: number;
    failCount: number;
}

interface ComplianceInput {
    blocks: LetterBlock[];
    data: ProposalLetterData;
    declarations: ProposalDeclaration[];
    bidding: any;       // BiddingProcess com aiAnalysis
    cockpit: {
        proposalTitle: string;
        executionDeadline: string;
        contractDuration: string;
        executionLocation: string;
        proposalDate: string;
    };
}

export class ComplianceChecker {
    check(input: ComplianceInput): ComplianceResult {
        const items: ComplianceItem[] = [];

        // 1. Verificações de DADOS obrigatórios
        this.checkRequiredData(input, items);

        // 2. Verificações FINANCEIRAS
        this.checkFinancial(input, items);

        // 3. Verificações de CONSISTÊNCIA entre blocos
        this.checkConsistency(input, items);

        // 4. Verificações de DECLARAÇÕES exigidas
        this.checkDeclarations(input, items);

        // 5. Verificações de DOCUMENTOS/BLOCOS
        this.checkDocumentBlocks(input, items);

        // 6. Requisitos do edital (schemaV2)
        this.checkEditalRequirements(input, items);

        // 7. Riscos de desclassificação
        this.checkDisqualificationRisks(input, items);

        // Cálculo do score
        const okCount = items.filter(i => i.status === 'ok').length;
        const warnCount = items.filter(i => i.status === 'warning').length;
        const failCount = items.filter(i => i.status === 'fail').length;
        const totalChecks = items.filter(i => i.status !== 'info').length || 1;

        const score = Math.round(
            ((okCount * 100) + (warnCount * 50)) / totalChecks
        );

        const grade: ComplianceResult['grade'] =
            score >= 90 ? 'A' : score >= 70 ? 'B' : score >= 50 ? 'C' : 'D';

        const riskLevel: ComplianceResult['riskLevel'] =
            failCount === 0 && warnCount <= 1 ? 'baixo' :
            failCount === 0 ? 'medio' :
            failCount <= 2 ? 'alto' : 'critico';

        const summary =
            failCount === 0 && warnCount === 0
                ? 'Proposta em plena conformidade com o edital.'
                : failCount === 0
                ? `${warnCount} ponto(s) de atenção identificado(s).`
                : `${failCount} item(ns) faltante(s) — risco de desclassificação.`;

        return { score, grade, riskLevel, items, summary, okCount, warnCount, failCount };
    }

    // ════════════════════════════════════════
    // 1. DADOS OBRIGATÓRIOS
    // ════════════════════════════════════════
    private checkRequiredData(input: ComplianceInput, items: ComplianceItem[]) {
        const { data, cockpit } = input;

        // CNPJ
        items.push({
            id: 'cnpj', category: 'data', blockId: 'qualificationBlock',
            label: 'CNPJ da empresa',
            ...(data.company?.cnpj?.trim()
                ? { status: 'ok', message: `CNPJ: ${data.company.cnpj}` }
                : { status: 'fail', message: 'CNPJ não informado', suggestion: 'Cadastre o CNPJ no perfil da empresa.' }),
        });

        // Representante Legal
        items.push({
            id: 'rep_legal', category: 'data', blockId: 'signatureBlock',
            label: 'Representante legal identificado',
            ...(data.company?.contactName?.trim()
                ? { status: 'ok', message: data.company.contactName }
                : { status: 'warning', message: 'Nome do representante não cadastrado', suggestion: 'A assinatura ficará genérica.' }),
        });

        // CPF do representante
        items.push({
            id: 'cpf_rep', category: 'data', blockId: 'signatureBlock',
            label: 'CPF do representante',
            ...(data.company?.contactCpf?.trim()
                ? { status: 'ok', message: `CPF informado` }
                : { status: 'warning', message: 'CPF do representante não cadastrado' }),
        });

        // Prazo de execução
        items.push({
            id: 'prazo_exec', category: 'data', blockId: 'proposalConditionsBlock',
            label: 'Prazo de execução informado',
            ...(cockpit.executionDeadline?.trim()
                ? { status: 'ok', message: cockpit.executionDeadline }
                : { status: 'warning', message: 'Prazo de execução não definido no cockpit', suggestion: 'Preencha no Data Cockpit.' }),
        });

        // Local de execução
        items.push({
            id: 'local_exec', category: 'data', blockId: 'proposalConditionsBlock',
            label: 'Local de execução',
            ...(cockpit.executionLocation?.trim()
                ? { status: 'ok', message: cockpit.executionLocation }
                : { status: 'info', message: 'Local não especificado (pode ser opcional)' }),
        });
    }

    // ════════════════════════════════════════
    // 2. VERIFICAÇÕES FINANCEIRAS
    // ════════════════════════════════════════
    private checkFinancial(input: ComplianceInput, items: ComplianceItem[]) {
        const { data } = input;
        const pricing = data.pricing;

        // Valor > 0
        items.push({
            id: 'valor_total', category: 'financial', blockId: 'pricingSummaryBlock',
            label: 'Valor total da proposta',
            ...(pricing?.totalValue > 0
                ? { status: 'ok', message: pricing.totalValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) }
                : { status: 'fail', message: 'Valor total é zero ou negativo', suggestion: 'Adicione itens à planilha de preços.' }),
        });

        // Valor vs estimado
        if (pricing?.estimatedValue && pricing.estimatedValue > 0) {
            const ratio = pricing.totalValue / pricing.estimatedValue;
            if (ratio > 1.0) {
                items.push({
                    id: 'valor_vs_estimado', category: 'financial', blockId: 'pricingSummaryBlock',
                    label: 'Valor vs. estimado',
                    status: 'warning',
                    message: `Proposta ${((ratio - 1) * 100).toFixed(1)}% acima do estimado`,
                    suggestion: 'Risco de desclassificação se o edital adotar preço máximo.',
                });
            } else {
                items.push({
                    id: 'valor_vs_estimado', category: 'financial', blockId: 'pricingSummaryBlock',
                    label: 'Valor vs. estimado',
                    status: 'ok',
                    message: `${((1 - ratio) * 100).toFixed(1)}% abaixo do estimado`,
                });
            }
        }

        // Validade mínima
        const validity = data.commercial?.validityDays || 0;
        items.push({
            id: 'validade', category: 'financial', blockId: 'validityBlock',
            label: 'Validade da proposta',
            ...(validity >= 60
                ? { status: 'ok', message: `${validity} dias` }
                : validity > 0
                ? { status: 'warning', message: `${validity} dias — abaixo do mínimo usual de 60`, suggestion: 'Verifique exigência do edital.' }
                : { status: 'warning', message: 'Validade não configurada' }),
        });

        // Extenso confere com numeral
        if (pricing?.totalValue > 0 && pricing?.totalValueExtended) {
            items.push({
                id: 'extenso', category: 'consistency', blockId: 'pricingSummaryBlock',
                label: 'Valor por extenso',
                status: 'ok',
                message: 'Extenso gerado automaticamente pelo sistema',
            });
        }
    }

    // ════════════════════════════════════════
    // 3. CONSISTÊNCIA ENTRE BLOCOS
    // ════════════════════════════════════════
    private checkConsistency(input: ComplianceInput, items: ComplianceItem[]) {
        const { blocks, data } = input;
        const visibleBlocks = blocks.filter(b => b.visible);

        // CNPJ consistente — verificar se CNPJ aparece nos blocos de qualificação e assinatura
        const qualBlock = visibleBlocks.find(b => b.id === 'qualificationBlock');
        const sigBlock = visibleBlocks.find(b => b.id === 'signatureBlock');
        if (qualBlock && sigBlock && data.company?.cnpj) {
            const cnpjClean = data.company.cnpj.replace(/[^\d]/g, '');
            const qualHas = qualBlock.content.replace(/[^\d]/g, '').includes(cnpjClean);
            const sigHas = sigBlock.content.replace(/[^\d]/g, '').includes(cnpjClean);
            if (qualHas && sigHas) {
                items.push({
                    id: 'cnpj_consistency', category: 'consistency',
                    label: 'CNPJ consistente entre blocos',
                    status: 'ok', message: 'Qualificação e assinatura com mesmo CNPJ',
                });
            } else if (!qualHas || !sigHas) {
                items.push({
                    id: 'cnpj_consistency', category: 'consistency',
                    label: 'CNPJ consistente entre blocos',
                    status: 'warning', message: 'CNPJ pode não constar em todos os blocos',
                    suggestion: 'Verifique se qualificação e assinatura possuem o CNPJ correto.',
                });
            }
        }

        // Blocos obrigatórios presentes
        const requiredTypes = ['qualificationBlock', 'objectBlock', 'pricingSummaryBlock', 'signatureBlock'];
        for (const t of requiredTypes) {
            const block = visibleBlocks.find(b => b.id === t);
            if (!block || !block.content?.trim()) {
                items.push({
                    id: `block_${t}`, category: 'document', blockId: t,
                    label: `Bloco obrigatório: ${t.replace('Block', '')}`,
                    status: 'fail', message: `Bloco "${t}" está vazio ou invisível`,
                    suggestion: 'Gere novamente a carta ou edite o bloco.',
                });
            }
        }

        // Marcadores de revisão pendentes
        for (const block of visibleBlocks) {
            if (/\[(?:texto incompleto|dado incompleto|verificar)/.test(block.content)) {
                items.push({
                    id: `review_marker_${block.id}`, category: 'consistency', blockId: block.id,
                    label: `Marcador pendente: ${block.label}`,
                    status: 'warning', message: `O bloco "${block.label}" contém marcador de revisão`,
                    suggestion: 'Edite o bloco para completar a informação.',
                });
            }
        }
    }

    // ════════════════════════════════════════
    // 4. DECLARAÇÕES EXIGIDAS
    // ════════════════════════════════════════
    private checkDeclarations(input: ComplianceInput, items: ComplianceItem[]) {
        const { declarations } = input;

        // Declarações do edital não ativadas
        const fromEdital = declarations.filter(d => d.source === 'edital');
        const enabledFromEdital = fromEdital.filter(d => d.enabled);
        const disabledFromEdital = fromEdital.filter(d => !d.enabled);

        if (fromEdital.length > 0) {
            if (disabledFromEdital.length === 0) {
                items.push({
                    id: 'decl_all_active', category: 'declaration',
                    label: 'Declarações do edital',
                    status: 'ok', message: `Todas as ${fromEdital.length} declarações detectadas estão ativas`,
                });
            } else {
                for (const d of disabledFromEdital) {
                    items.push({
                        id: `decl_missing_${d.id}`, category: 'declaration',
                        label: d.title,
                        status: 'warning',
                        message: `Declaração do edital não ativada na carta`,
                        editalClause: d.editalClause,
                        suggestion: 'Ative no cockpit se exigida pelo edital, ou confirme que é opcional.',
                    });
                }
            }
        }

        // Declarações ativas mas sem conteúdo
        const enabledEmpty = declarations.filter(d => d.enabled && !d.content?.trim());
        for (const d of enabledEmpty) {
            items.push({
                id: `decl_empty_${d.id}`, category: 'declaration',
                label: `${d.title} — sem conteúdo`,
                status: 'warning',
                message: 'Declaração ativa mas sem texto',
                suggestion: 'Preencha o texto ou gere via módulo Declarações.',
            });
        }
    }

    // ════════════════════════════════════════
    // 5. BLOCOS DA CARTA
    // ════════════════════════════════════════
    private checkDocumentBlocks(input: ComplianceInput, items: ComplianceItem[]) {
        const { blocks } = input;
        const visible = blocks.filter(b => b.visible);

        // Dados bancários
        const bankBlock = visible.find(b => b.id === 'bankingBlock');
        if (bankBlock && bankBlock.content?.trim()) {
            items.push({
                id: 'bank_data', category: 'document', blockId: 'bankingBlock',
                label: 'Dados bancários',
                status: 'ok', message: 'Dados bancários incluídos na carta',
            });
        } else {
            items.push({
                id: 'bank_data', category: 'document', blockId: 'bankingBlock',
                label: 'Dados bancários',
                status: 'info', message: 'Não incluídos (pode ser opcional)',
            });
        }
    }

    // ════════════════════════════════════════
    // 6. REQUISITOS DO EDITAL (schemaV2)
    // ════════════════════════════════════════
    private checkEditalRequirements(input: ComplianceInput, items: ComplianceItem[]) {
        const schema = input.bidding?.aiAnalysis?.schemaV2;
        if (!schema) return;

        const proposalAnalysis = schema.proposal_analysis || {};
        const requirements: any[] = proposalAnalysis.requisitos_proposta || proposalAnalysis.proposalRequirements || [];

        // Filtrar requisitos obrigatórios
        const mandatory = requirements.filter((r: any) =>
            r.mandatory === true || r.classification === 'obrigatorio' || r.classificacao === 'obrigatorio'
        );

        for (const req of mandatory) {
            const label = req.item || req.description || req.descricao || 'Requisito sem nome';
            const source = req.source || req.fonte || '';
            items.push({
                id: `req_${label.substring(0, 30).replace(/\s+/g, '_').toLowerCase()}`,
                category: 'document',
                label: label.length > 80 ? label.substring(0, 77) + '...' : label,
                status: 'info',
                message: `Requisito obrigatório do edital — verifique manualmente`,
                editalClause: source,
                suggestion: req.riskIfMissing || req.risco || undefined,
            });
        }
    }

    // ════════════════════════════════════════
    // 7. RISCOS DE DESCLASSIFICAÇÃO
    // ════════════════════════════════════════
    private checkDisqualificationRisks(input: ComplianceInput, items: ComplianceItem[]) {
        const schema = input.bidding?.aiAnalysis?.schemaV2;
        if (!schema) return;

        const proposalAnalysis = schema.proposal_analysis || {};
        const risks: any[] = proposalAnalysis.riscos_desclassificacao || proposalAnalysis.disqualificationRisks || [];

        for (const risk of risks.slice(0, 5)) {
            const riskText = typeof risk === 'string' ? risk : (risk.risk || risk.risco || '');
            const clause = typeof risk === 'string' ? '' : (risk.editalClause || risk.clausula || '');
            const action = typeof risk === 'string' ? '' : (risk.preventiveAction || risk.acao_preventiva || '');

            if (riskText) {
                items.push({
                    id: `risk_${riskText.substring(0, 25).replace(/\s+/g, '_').toLowerCase()}`,
                    category: 'financial',
                    label: riskText.length > 80 ? riskText.substring(0, 77) + '...' : riskText,
                    status: 'warning',
                    message: 'Risco de desclassificação identificado pela IA',
                    editalClause: clause,
                    suggestion: action,
                });
            }
        }
    }
}
