/**
 * BudgetDocsPanel.tsx — Painel do Caderno de Orçamento
 * Lista os 8 documentos obrigatórios com geração PDF individual.
 */
import { useState } from 'react';
import { FileText, Download, Loader2, BookOpen, BarChart3, Calendar, Calculator, Layers, Package, TrendingDown, ClipboardList } from 'lucide-react';
import { docOrcamentoResumido, docOrcamentoSintetico, docOrcamentoAnalitico, docCpuBatch, docCurvaAbcServicos, docCurvaAbcInsumos, docCronograma, docBdiEncargos } from './budgetDocGenerator';
import type { BdiConfig } from './bdiEngine';
import type { InsumoConsolidado } from './insumoEngine';
import type { CronogramaResult } from './cronogramaEngine';
import type { EngItem, EngineeringConfig } from './types';

interface Props {
    items: EngItem[];
    bdiConfig: BdiConfig;
    effectiveBdi: number;
    insumos: InsumoConsolidado[];
    cronogramaResult: CronogramaResult | null;
    proposalId: string;
    engineeringConfig?: EngineeringConfig;
    proposal?: any;
    company?: any;
    bidding?: any;
}

const DOCS = [
    { id: 'resumido', label: 'Orçamento Resumido', desc: 'Totais por etapa/capítulo', icon: ClipboardList, color: '#1e40af' },
    { id: 'sintetico', label: 'Orçamento Sintético', desc: 'Todos os itens com preços, sem composição', icon: FileText, color: '#2563eb' },
    { id: 'analitico', label: 'Orçamento Analítico', desc: 'Itens + composição detalhada de cada serviço', icon: BookOpen, color: '#7c3aed', async: true },
    { id: 'cpu', label: 'Composição de Custos Unitários', desc: 'CPUs de todos os serviços em lote', icon: Layers, color: '#0891b2', async: true },
    { id: 'abc_servicos', label: 'Curva ABC de Serviços', desc: 'Análise Pareto dos serviços do orçamento', icon: BarChart3, color: '#dc2626' },
    { id: 'abc_insumos', label: 'Curva ABC de Insumos', desc: 'Análise Pareto dos insumos consolidados', icon: Package, color: '#d97706' },
    { id: 'cronograma', label: 'Cronograma Físico-Financeiro', desc: 'Distribuição mensal de desembolso', icon: Calendar, color: '#059669' },
    { id: 'bdi', label: 'BDI e Encargos Sociais', desc: 'Detalhamento BDI (TCU) + tabela de encargos', icon: Calculator, color: '#475569' },
];

export function BudgetDocsPanel({ items, bdiConfig, effectiveBdi, insumos, cronogramaResult, proposalId, engineeringConfig, proposal, company, bidding }: Props) {
    const [generating, setGenerating] = useState<string | null>(null);

    const handleExportCarta = async () => {
        setGenerating('carta');
        try {
            // Fetch the latest proposal to get up-to-date letterContent
            const res = await fetch(`/api/proposals/detail/${proposalId}`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}`, 'Content-Type': 'application/json' }
            });
            if (!res.ok) throw new Error('Falha ao buscar detalhes da proposta.');
            const data = await res.json();

            if (!data.letterContent) {
                alert('A Carta Proposta ainda não foi gerada ou salva. Retorne ao Passo 4 e clique em "Concluir Carta".');
                return;
            }

            let envelope;
            try {
                envelope = JSON.parse(data.letterContent);
            } catch {
                throw new Error('Falha ao decodificar dados da carta salva.');
            }

            const { LetterDataNormalizer } = await import('../letter/LetterDataNormalizer');
            const { LetterPdfExporter } = await import('../letter/LetterPdfExporter');

            const totalValue = items.reduce((s, i) => s + i.totalPrice, 0);

            const normalizer = new LetterDataNormalizer();
            const effectiveData = normalizer.normalize({
                bidding: data.biddingProcess,
                company: data.company,
                proposal: data,
                items: [], // Let items table be empty for letter only mode
                totalValue,
                signatureMode: envelope.cockpit?.signatureMode || 'BOTH',
                validityDays: envelope.cockpit?.validityDays || 60,
                bdiPercentage: effectiveBdi,
                bankingData: envelope.cockpit?.bankingData,
            });

            // Ensure we use the exact structure expected by LetterPdfExporter
            const exporter = new LetterPdfExporter();
            exporter.export({
                result: { 
                    blocks: envelope.blocks || [], 
                    plainText: envelope.plainText || '', 
                    htmlContent: '', 
                    validation: { isValid: true, errors: [], warnings: [] }, 
                    meta: { generatedAt: new Date().toISOString(), builderVersion: '1', aiBlockIds: [], dataHash: '' } 
                },
                data: effectiveData,
                items: [], 
                mode: 'LETTER', // Carta apenas
                headerImage: data.company.defaultProposalHeader || '',
                footerImage: data.company.defaultProposalFooter || '',
                headerImageHeight: data.company.defaultProposalHeaderHeight || 80,
                footerImageHeight: data.company.defaultProposalFooterHeight || 40,
                printLandscape: false,
                engineeringConfig,
            });

        } catch (e: any) {
            console.error(e);
            alert('Erro ao exportar carta: ' + e.message);
        } finally {
            setGenerating(null);
        }
    };

    const handleGenerate = async (docId: string) => {
        setGenerating(docId);
        try {
            switch (docId) {
                case 'resumido': docOrcamentoResumido(items, effectiveBdi, engineeringConfig); break;
                case 'sintetico': docOrcamentoSintetico(items, effectiveBdi, engineeringConfig); break;
                case 'analitico': await docOrcamentoAnalitico(proposalId, items, effectiveBdi, engineeringConfig); break;
                case 'cpu': await docCpuBatch(proposalId, items, effectiveBdi, engineeringConfig); break;
                case 'abc_servicos': docCurvaAbcServicos(items, engineeringConfig); break;
                case 'abc_insumos': docCurvaAbcInsumos(insumos, engineeringConfig); break;
                case 'cronograma':
                    if (cronogramaResult) docCronograma({ ...cronogramaResult, engineeringConfig } as any);
                    else alert('Configure o cronograma na aba "Cronograma" primeiro.');
                    break;
                case 'bdi': docBdiEncargos(bdiConfig, effectiveBdi, engineeringConfig); break;
            }
        } catch (e) { console.error('Erro ao gerar documento:', e); }
        setGenerating(null);
    };

    const total = items.reduce((s, i) => s + i.totalPrice, 0);
    const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            
            {/* Seção 1: Documentação Principal (Carta) */}
            <div style={{
                padding: 'var(--space-5)', borderRadius: 'var(--radius-lg)',
                background: 'linear-gradient(135deg, rgba(16,185,129,0.06), rgba(5,150,105,0.04))',
                border: '1px solid rgba(16,185,129,0.12)',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{ background: 'rgba(16,185,129,0.1)', padding: 10, borderRadius: 'var(--radius-md)' }}>
                            <FileText size={22} color="#059669" />
                        </div>
                        <div>
                            <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>Documentação Principal</h3>
                            <span style={{ fontSize: '0.78rem', color: 'var(--color-text-tertiary)' }}>
                                Carta proposta com declarações embutidas e termos do edital
                            </span>
                        </div>
                    </div>
                    <button
                        onClick={handleExportCarta}
                        disabled={generating === 'carta'}
                        style={{
                            padding: '10px 18px', borderRadius: 'var(--radius-md)',
                            border: `none`, background: `#059669`,
                            color: '#fff', cursor: generating === 'carta' ? 'not-allowed' : 'pointer',
                            display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem',
                            fontWeight: 700, transition: 'all 0.15s',
                        }}
                    >
                        {generating === 'carta' ? <Loader2 size={16} className="spin" /> : <Download size={16} />}
                        {generating === 'carta' ? 'Gerando...' : 'Exportar Carta Proposta'}
                    </button>
                </div>
            </div>

            {/* Seção 2: Header do Caderno de Orçamento */}
            <div style={{
                padding: 'var(--space-5)', borderRadius: 'var(--radius-lg)',
                background: 'linear-gradient(135deg, rgba(30,64,175,0.06), rgba(124,58,237,0.04))',
                border: '1px solid rgba(30,64,175,0.12)',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ background: 'rgba(30,64,175,0.1)', padding: 10, borderRadius: 'var(--radius-md)' }}>
                        <BookOpen size={22} color="#1e40af" />
                    </div>
                    <div>
                        <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>Caderno de Orçamento</h3>
                        <span style={{ fontSize: '0.78rem', color: 'var(--color-text-tertiary)' }}>
                            8 documentos operacionais e financeiros · {items.length} itens · {insumos.length} insumos · Total: {fmt(total)}
                        </span>
                    </div>
                </div>
            </div>

            {/* Document Grid (Caderno) */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 'var(--space-3)' }}>
                {DOCS.map(doc => {
                    const Icon = doc.icon;
                    const isGenerating = generating === doc.id;
                    const isDisabled = doc.id === 'abc_insumos' && insumos.length === 0;

                    return (
                        <div key={doc.id} style={{
                            display: 'flex', alignItems: 'center', gap: 14, padding: 'var(--space-4)',
                            background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-lg)',
                            border: '1px solid var(--color-border)', transition: 'all 0.15s',
                            opacity: isDisabled ? 0.4 : 1,
                        }}>
                            <div style={{
                                background: `${doc.color}12`, padding: 10, borderRadius: 'var(--radius-md)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                            }}>
                                <Icon size={20} color={doc.color} />
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-text-primary)' }}>
                                    {doc.label}
                                </div>
                                <div style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                                    {doc.desc}
                                </div>
                            </div>
                            <button
                                onClick={() => handleGenerate(doc.id)}
                                disabled={isGenerating || isDisabled}
                                style={{
                                    padding: '6px 14px', borderRadius: 'var(--radius-sm)',
                                    border: `1px solid ${doc.color}40`, background: `${doc.color}08`,
                                    color: doc.color, cursor: isDisabled ? 'not-allowed' : 'pointer',
                                    display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem',
                                    fontWeight: 600, transition: 'all 0.15s', flexShrink: 0,
                                }}
                            >
                                {isGenerating ? <Loader2 size={13} className="spin" /> : <Download size={13} />}
                                {isGenerating ? 'Gerando...' : 'PDF'}
                            </button>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
