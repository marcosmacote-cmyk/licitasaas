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

interface EngItem {
    id: string; itemNumber: string; code: string; sourceName: string;
    description: string; unit: string; quantity: number;
    unitCost: number; unitPrice: number; totalPrice: number;
}

interface Props {
    items: EngItem[];
    bdiConfig: BdiConfig;
    effectiveBdi: number;
    insumos: InsumoConsolidado[];
    cronogramaResult: CronogramaResult | null;
    proposalId: string;
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

export function BudgetDocsPanel({ items, bdiConfig, effectiveBdi, insumos, cronogramaResult, proposalId }: Props) {
    const [generating, setGenerating] = useState<string | null>(null);

    const handleGenerate = async (docId: string) => {
        setGenerating(docId);
        try {
            switch (docId) {
                case 'resumido': docOrcamentoResumido(items, effectiveBdi); break;
                case 'sintetico': docOrcamentoSintetico(items, effectiveBdi); break;
                case 'analitico': await docOrcamentoAnalitico(proposalId, items, effectiveBdi); break;
                case 'cpu': await docCpuBatch(items); break;
                case 'abc_servicos': docCurvaAbcServicos(items); break;
                case 'abc_insumos': docCurvaAbcInsumos(insumos); break;
                case 'cronograma':
                    if (cronogramaResult) docCronograma(cronogramaResult);
                    else alert('Configure o cronograma na aba "Cronograma" primeiro.');
                    break;
                case 'bdi': docBdiEncargos(bdiConfig, effectiveBdi); break;
            }
        } catch (e) { console.error('Erro ao gerar documento:', e); }
        setGenerating(null);
    };

    const total = items.reduce((s, i) => s + i.totalPrice, 0);
    const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            {/* Header */}
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
                            8 documentos · {items.length} itens · {insumos.length} insumos · Total: {fmt(total)}
                        </span>
                    </div>
                </div>
            </div>

            {/* Document Grid */}
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
