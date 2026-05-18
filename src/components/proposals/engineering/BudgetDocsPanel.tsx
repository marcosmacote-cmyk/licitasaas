/**
 * BudgetDocsPanel.tsx — Painel do Caderno de Orçamento (v2)
 * 
 * FIX A1: Documentos agrupados por seção temática
 * FIX A2: Botões multi-formato (PDF/Excel)
 * FIX A3: Botão "Exportar Caderno Completo"
 * FIX A5: Carta Proposta integrada ao caderno
 */
import { useState, useCallback, useMemo } from 'react';
import { FileText, Download, Loader2, BookOpen, BarChart3, Calendar, Calculator, Layers, Package, ClipboardList, FileSpreadsheet, Printer, Archive, Settings } from 'lucide-react';
import { docOrcamentoResumido, docOrcamentoSintetico, docOrcamentoAnalitico, docCpuBatch, docCurvaAbcServicos, docCurvaAbcInsumos, docCronograma, docBdiEncargos, docPropostaCompleta } from './budgetDocGenerator';
import type { PropostaSectionId } from './budgetDocGenerator';
import { xlsOrcamentoResumido, xlsOrcamentoSintetico, xlsOrcamentoAnalitico, xlsCpuBatch, xlsCurvaAbcServicos, xlsCurvaAbcInsumos, xlsCronograma, xlsBdiEncargos } from './budgetExcelExporter';
import { ReportConfigPanel } from './ReportConfigPanel';
import type { BdiConfig } from './bdiEngine';
import type { InsumoConsolidado } from './insumoEngine';
import type { CronogramaResult } from './cronogramaEngine';
import type { EngItem, EngineeringConfig } from './types';
import { isGrouper } from './types';

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
    onConfigChange?: (config: any) => void;
}

// FIX A1: Grouped document definitions
const DOC_SECTIONS = [
    {
        id: 'orcamentos',
        title: 'Orçamentos',
        desc: 'Planilhas orçamentárias em diferentes níveis de detalhamento',
        color: '#2563eb',
        icon: ClipboardList,
        docs: [
            { id: 'resumido', label: 'Orçamento Resumido', desc: 'Totais por etapa/capítulo', icon: ClipboardList, color: '#1e40af' },
            { id: 'sintetico', label: 'Orçamento Sintético', desc: 'Itens com preços, sem composição', icon: FileText, color: '#2563eb' },
            { id: 'analitico', label: 'Orçamento Analítico', desc: 'Itens + composição detalhada de cada serviço', icon: BookOpen, color: '#7c3aed', async: true },
        ],
    },
    {
        id: 'composicoes',
        title: 'Composições e Análises',
        desc: 'CPUs detalhadas e análise de distribuição de custos',
        color: '#0891b2',
        icon: Layers,
        docs: [
            { id: 'cpu', label: 'Composição de Custos Unitários', desc: 'CPUs de todos os serviços em lote', icon: Layers, color: '#0891b2', async: true },
            { id: 'abc_servicos', label: 'Curva ABC de Serviços', desc: 'Análise Pareto dos serviços', icon: BarChart3, color: '#dc2626' },
            { id: 'abc_insumos', label: 'Curva ABC de Insumos', desc: 'Análise Pareto dos insumos consolidados', icon: Package, color: '#d97706' },
        ],
    },
    {
        id: 'planejamento',
        title: 'Planejamento',
        desc: 'Distribuição temporal de recursos e desembolsos',
        color: '#059669',
        icon: Calendar,
        docs: [
            { id: 'cronograma', label: 'Cronograma Físico-Financeiro', desc: 'Distribuição mensal de desembolso', icon: Calendar, color: '#059669' },
        ],
    },
    {
        id: 'encargos',
        title: 'Encargos e BDI',
        desc: 'Detalhamento tributário e de encargos sociais',
        color: '#475569',
        icon: Calculator,
        docs: [
            { id: 'bdi', label: 'BDI e Encargos Sociais', desc: 'Detalhamento BDI (TCU) + tabela de encargos', icon: Calculator, color: '#475569' },
        ],
    },
];

export function BudgetDocsPanel({ items, bdiConfig, effectiveBdi, insumos, cronogramaResult, proposalId, engineeringConfig, proposal, company, bidding, onConfigChange }: Props) {
    const [generating, setGenerating] = useState<string | null>(null);
    const [generated, setGenerated] = useState<Record<string, string>>({}); // A4: Track generated docs
    const [activeTab, setActiveTab] = useState<'docs' | 'config'>('docs');
    const [showPropostaModal, setShowPropostaModal] = useState(false);
    const [propostaSections, setPropostaSections] = useState<PropostaSectionId[]>(['sintetico', 'analitico', 'cpu', 'abc_servicos', 'abc_insumos', 'cronograma', 'bdi']);
    const [includeCartaProposta, setIncludeCartaProposta] = useState(true);

    const billable = items.filter(it => !isGrouper(it.type));
    const total = billable.reduce((s, i) => s + i.totalPrice, 0);
    const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    // Inject company logo into reportConfig at runtime (not persisted — Base64 too large for JSON)
    const engConfigWithLogo = useMemo((): EngineeringConfig | undefined => {
        if (!engineeringConfig) return engineeringConfig;
        const logoBase64 = company?.defaultProposalHeader || '';
        if (!logoBase64) return engineeringConfig;
        return {
            ...engineeringConfig,
            reportConfig: {
                ...(engineeringConfig.reportConfig || {}),
                logoBase64,
            },
        };
    }, [engineeringConfig, company?.defaultProposalHeader]);

    const handleExportCarta = useCallback(async () => {
        setGenerating('carta');
        try {
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
                items: [],
                totalValue,
                signatureMode: envelope.cockpit?.signatureMode || 'BOTH',
                validityDays: envelope.cockpit?.validityDays || 60,
                bdiPercentage: effectiveBdi,
                bankingData: envelope.cockpit?.bankingData,
            });

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
                mode: 'LETTER',
                headerImage: data.company.defaultProposalHeader || '',
                footerImage: data.company.defaultProposalFooter || '',
                headerImageHeight: data.company.defaultProposalHeaderHeight || 80,
                footerImageHeight: data.company.defaultProposalFooterHeight || 40,
                printLandscape: false,
                engineeringConfig,
            });

            markGenerated('carta');
        } catch (e: any) {
            console.error(e);
            alert('Erro ao exportar carta: ' + e.message);
        } finally {
            setGenerating(null);
        }
    }, [proposalId, items, effectiveBdi, engineeringConfig]);

    const markGenerated = (docId: string) => {
        setGenerated(prev => ({ ...prev, [docId]: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) }));
    };

    const handleGenerate = async (docId: string, format: 'pdf' | 'excel' = 'pdf') => {
        setGenerating(docId + (format === 'excel' ? '_xls' : ''));
        try {
            if (format === 'excel') {
                // Fase 3/C1: Excel export
                switch (docId) {
                    case 'resumido': xlsOrcamentoResumido(items, engConfigWithLogo, effectiveBdi); break;
                    case 'sintetico': xlsOrcamentoSintetico(items, engConfigWithLogo, effectiveBdi); break;
                    case 'analitico': await xlsOrcamentoAnalitico(proposalId, items, engConfigWithLogo, effectiveBdi); break;
                    case 'cpu': await xlsCpuBatch(proposalId, items, engConfigWithLogo, effectiveBdi); break;
                    case 'abc_servicos': xlsCurvaAbcServicos(items, engConfigWithLogo, effectiveBdi); break;
                    case 'abc_insumos': xlsCurvaAbcInsumos(insumos, engConfigWithLogo); break;
                    case 'cronograma':
                        if (cronogramaResult) xlsCronograma(cronogramaResult, engConfigWithLogo);
                        else alert('Configure o cronograma primeiro.');
                        break;
                    case 'bdi': xlsBdiEncargos(engConfigWithLogo, effectiveBdi); break;
                }
            } else {
                switch (docId) {
                    case 'resumido': docOrcamentoResumido(items, effectiveBdi, engConfigWithLogo); break;
                    case 'sintetico': docOrcamentoSintetico(items, effectiveBdi, engConfigWithLogo); break;
                    case 'analitico': await docOrcamentoAnalitico(proposalId, items, effectiveBdi, engConfigWithLogo); break;
                    case 'cpu': await docCpuBatch(proposalId, items, effectiveBdi, engConfigWithLogo); break;
                    case 'abc_servicos': docCurvaAbcServicos(items, engConfigWithLogo); break;
                    case 'abc_insumos': docCurvaAbcInsumos(insumos, engConfigWithLogo); break;
                    case 'cronograma':
                        if (cronogramaResult) docCronograma({ ...cronogramaResult, engineeringConfig: engConfigWithLogo } as any);
                        else { alert('Configure o cronograma na aba "Cronograma" primeiro.'); break; }
                        break;
                    case 'bdi': docBdiEncargos(bdiConfig, effectiveBdi, engConfigWithLogo); break;
                }
            }
            markGenerated(docId + (format === 'excel' ? '_xls' : ''));
        } catch (e) { console.error('Erro ao gerar documento:', e); }
        setGenerating(null);
    };

    // FIX A3: Generate all documents sequentially
    const handleExportAll = async () => {
        setGenerating('all');
        const allDocIds = DOC_SECTIONS.flatMap(s => s.docs.map(d => d.id));
        for (const docId of allDocIds) {
            if (docId === 'abc_insumos' && insumos.length === 0) continue;
            if (docId === 'cronograma' && !cronogramaResult) continue;
            await handleGenerate(docId);
        }
        setGenerating(null);
    };

    // Generate unified proposal PDF
    const handlePropostaCompleta = async () => {
        setShowPropostaModal(false);
        setGenerating('proposta');
        try {
            let cartaHtml: string | undefined;
            if (includeCartaProposta) {
                try {
                    const res = await fetch(`/api/proposals/detail/${proposalId}`, {
                        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}`, 'Content-Type': 'application/json' }
                    });
                    if (res.ok) {
                        const data = await res.json();
                        if (data.letterContent) {
                            const envelope = JSON.parse(data.letterContent);
                            const { LetterRenderer } = await import('../letter/LetterRenderer');
                            const renderer = new LetterRenderer();
                            const letterBodyHtml = renderer.renderToHtml({
                                blocks: envelope.blocks || [],
                                plainText: envelope.plainText || '',
                                htmlContent: '',
                                validation: { isValid: true, errors: [], warnings: [] },
                                meta: { generatedAt: new Date().toISOString(), builderVersion: '1', aiBlockIds: [], dataHash: '' },
                            });
                            cartaHtml = `<div style="font-family:Arial,sans-serif;font-size:10.5px;line-height:1.3;">
                                <h1 style="font-size:14px;text-align:center;margin-bottom:12px;">CARTA PROPOSTA</h1>
                                ${letterBodyHtml}
                            </div>`;
                        }
                    }
                } catch { /* Carta not available — skip silently */ }
            }
            await docPropostaCompleta({
                sections: propostaSections,
                items, bdi: effectiveBdi, insumos,
                cronogramaResult,
                bdiConfig,
                proposalId,
                engineeringConfig: engConfigWithLogo,
                cartaHtml,
            });
            markGenerated('proposta');
        } catch (e: any) {
            console.error('Erro ao gerar proposta:', e);
            alert('Erro ao gerar proposta completa: ' + e.message);
        } finally {
            setGenerating(null);
        }
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>

            {/* ═══ Tab Bar ═══ */}
            <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid var(--color-border)' }}>
                {[
                    { id: 'docs' as const, label: 'Documentos', icon: FileText },
                    { id: 'config' as const, label: 'Configurar Relatórios', icon: Settings },
                ].map(tab => {
                    const TabIcon = tab.icon;
                    const isActive = activeTab === tab.id;
                    return (
                        <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 6,
                                padding: '10px 20px', border: 'none', cursor: 'pointer',
                                background: isActive ? 'var(--color-bg-surface)' : 'transparent',
                                borderBottom: isActive ? '2px solid var(--color-primary)' : '2px solid transparent',
                                marginBottom: -2, fontSize: '0.85rem',
                                fontWeight: isActive ? 700 : 500,
                                color: isActive ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                                transition: 'all 0.15s',
                            }}>
                            <TabIcon size={15} />
                            {tab.label}
                        </button>
                    );
                })}
            </div>

            {/* ═══ Config Tab ═══ */}
            {activeTab === 'config' && (
                <ReportConfigPanel
                    config={engineeringConfig?.reportConfig || {}}
                    onChange={(rc) => onConfigChange?.({ ...engineeringConfig, reportConfig: rc })}
                    companyName={company?.razaoSocial || company?.nomeFantasia}
                    logoBase64={company?.defaultProposalHeader || ''}
                />
            )}

            {/* ═══ Documents Tab ═══ */}
            {activeTab === 'docs' && (<>            
            {/* ═══ Seção Master: Carta Proposta + Caderno Completo ═══ */}
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
                            <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700 }}>Caderno de Orçamento</h3>
                            <span style={{ fontSize: '0.78rem', color: 'var(--color-text-tertiary)' }}>
                                9 documentos · {billable.length} itens · {insumos.length} insumos · Total: {fmt(total)}
                            </span>
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                        {/* Gerar Proposta button */}
                        <button
                            onClick={() => setShowPropostaModal(true)}
                            disabled={generating === 'proposta' || !!generating}
                            style={{
                                padding: '10px 18px', borderRadius: 'var(--radius-md)',
                                border: 'none',
                                background: 'linear-gradient(135deg, #7c3aed, #6d28d9)',
                                color: '#fff', cursor: (generating === 'proposta' || !!generating) ? 'not-allowed' : 'pointer',
                                display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.82rem',
                                fontWeight: 700, transition: 'all 0.15s',
                                boxShadow: '0 2px 8px rgba(124,58,237,0.3)',
                            }}
                        >
                            {generating === 'proposta' ? <Loader2 size={16} className="spin" /> : <Layers size={16} />}
                            {generating === 'proposta' ? 'Gerando...' : 'Gerar Proposta'}
                        </button>
                        {/* Carta Proposta button */}
                        <button
                            onClick={handleExportCarta}
                            disabled={generating === 'carta'}
                            style={{
                                padding: '10px 18px', borderRadius: 'var(--radius-md)',
                                border: 'none', background: '#059669',
                                color: '#fff', cursor: generating === 'carta' ? 'not-allowed' : 'pointer',
                                display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.82rem',
                                fontWeight: 700, transition: 'all 0.15s',
                            }}
                        >
                            {generating === 'carta' ? <Loader2 size={16} className="spin" /> : <FileText size={16} />}
                            Carta Proposta
                            {generated['carta'] && <span style={{ fontSize: '0.6rem', opacity: 0.7 }}>✓ {generated['carta']}</span>}
                        </button>
                        {/* FIX A3: Export all button */}
                        <button
                            onClick={handleExportAll}
                            disabled={generating === 'all' || !!generating}
                            style={{
                                padding: '10px 18px', borderRadius: 'var(--radius-md)',
                                border: 'none', background: '#1e40af',
                                color: '#fff', cursor: (generating === 'all' || !!generating) ? 'not-allowed' : 'pointer',
                                display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.82rem',
                                fontWeight: 700, transition: 'all 0.15s',
                            }}
                        >
                            {generating === 'all' ? <Loader2 size={16} className="spin" /> : <Archive size={16} />}
                            {generating === 'all' ? 'Gerando Caderno...' : 'Exportar Tudo (PDF)'}
                        </button>
                    </div>
                </div>
            </div>

            {/* ═══ FIX A1: Seções temáticas agrupadas ═══ */}
            {DOC_SECTIONS.map(section => {
                const SectionIcon = section.icon;
                return (
                    <div key={section.id} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                        {/* Section header */}
                        <div style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            padding: '8px 14px',
                            background: `${section.color}08`,
                            borderRadius: 'var(--radius-md)',
                            borderLeft: `3px solid ${section.color}`,
                        }}>
                            <SectionIcon size={16} color={section.color} />
                            <div>
                                <span style={{ fontSize: '0.82rem', fontWeight: 700, color: section.color }}>{section.title}</span>
                                <span style={{ fontSize: '0.68rem', color: 'var(--color-text-tertiary)', marginLeft: 8 }}>{section.desc}</span>
                            </div>
                        </div>

                        {/* Documents grid within section */}
                        <div style={{ display: 'grid', gridTemplateColumns: section.docs.length === 1 ? '1fr' : 'repeat(auto-fit, minmax(300px, 1fr))', gap: 'var(--space-2)', paddingLeft: 6 }}>
                            {section.docs.map(doc => {
                                const Icon = doc.icon;
                                const isGenerating = generating === doc.id;
                                const isDisabled = doc.id === 'abc_insumos' && insumos.length === 0;
                                const wasGenerated = generated[doc.id];

                                return (
                                    <div key={doc.id} style={{
                                        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
                                        background: wasGenerated ? 'rgba(16,185,129,0.03)' : 'var(--color-bg-surface)',
                                        borderRadius: 'var(--radius-md)',
                                        border: `1px solid ${wasGenerated ? 'rgba(16,185,129,0.15)' : 'var(--color-border)'}`,
                                        transition: 'all 0.15s',
                                        opacity: isDisabled ? 0.4 : 1,
                                    }}>
                                        <div style={{
                                            background: `${doc.color}12`, padding: 8, borderRadius: 'var(--radius-sm)',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                                        }}>
                                            <Icon size={18} color={doc.color} />
                                        </div>
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--color-text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                                {doc.label}
                                                {/* A4: Generated badge */}
                                                {wasGenerated && (
                                                    <span style={{ fontSize: '0.6rem', color: '#059669', fontWeight: 500, background: 'rgba(16,185,129,0.08)', padding: '1px 6px', borderRadius: 10 }}>
                                                        ✓ {wasGenerated}
                                                    </span>
                                                )}
                                            </div>
                                            <div style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)', marginTop: 1 }}>
                                                {doc.desc}
                                            </div>
                                        </div>
                                        {/* FIX A2: Multi-format export buttons */}
                                        <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                                            <button
                                                onClick={() => handleGenerate(doc.id, 'pdf')}
                                                disabled={isGenerating || isDisabled}
                                                title="Exportar PDF"
                                                style={{
                                                    padding: '5px 12px', borderRadius: 'var(--radius-sm)',
                                                    border: `1px solid ${doc.color}40`, background: `${doc.color}08`,
                                                    color: doc.color, cursor: isDisabled ? 'not-allowed' : 'pointer',
                                                    display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.72rem',
                                                    fontWeight: 600, transition: 'all 0.15s',
                                                }}
                                            >
                                                {isGenerating ? <Loader2 size={12} className="spin" /> : <Download size={12} />}
                                                PDF
                                            </button>
                                            {/* FIX A2/C1: Excel export button — now functional */}
                                            <button
                                                onClick={() => handleGenerate(doc.id, 'excel')}
                                                disabled={isGenerating || isDisabled}
                                                title="Exportar Excel"
                                                style={{
                                                    padding: '5px 10px', borderRadius: 'var(--radius-sm)',
                                                    border: '1px solid rgba(16,185,129,0.3)', background: 'rgba(16,185,129,0.05)',
                                                    color: '#059669', cursor: isDisabled ? 'not-allowed' : 'pointer',
                                                    display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.72rem',
                                                    fontWeight: 600, opacity: isDisabled ? 0.5 : 1,
                                                    transition: 'all 0.15s',
                                                }}
                                            >
                                                {generating === doc.id + '_xls' ? <Loader2 size={12} className="spin" /> : <FileSpreadsheet size={12} />}
                                                XLS
                                            </button>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                );
            })}
            </>)}

            {/* ═══ Modal: Seletor de Seções da Proposta ═══ */}
            {showPropostaModal && (
                <div style={{
                    position: 'fixed', inset: 0, zIndex: 10000,
                    background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    backdropFilter: 'blur(3px)',
                }} onClick={() => setShowPropostaModal(false)}>
                    <div style={{
                        background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-xl)',
                        padding: '24px', width: '100%', maxWidth: 520, maxHeight: '80vh', overflow: 'auto',
                        boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
                        border: '1px solid var(--color-border)',
                    }} onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
                            <div style={{ background: 'linear-gradient(135deg, #7c3aed, #6d28d9)', padding: 8, borderRadius: 'var(--radius-md)' }}>
                                <Layers size={20} color="#fff" />
                            </div>
                            <div>
                                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>Gerar Proposta Completa</h3>
                                <span style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>Selecione os documentos que farão parte do PDF unificado</span>
                            </div>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 18 }}>
                            {([
                                { id: '_carta', label: 'Carta Proposta', desc: 'Carta formal gerada no Passo 4', icon: '📄' },
                                { id: 'sintetico', label: 'Orçamento Sintético', desc: 'Itens agrupados por etapa com totais', icon: '📊' },
                                { id: 'analitico', label: 'Orçamento Analítico', desc: 'Composições detalhadas com insumos', icon: '📋' },
                                { id: 'cpu', label: 'Composições de Custo (CPU)', desc: 'Caderno completo de composições unitárias', icon: '🧮' },
                                { id: 'abc_servicos', label: 'Curva ABC de Serviços', desc: 'Ranking Pareto dos serviços', icon: '📈' },
                                { id: 'abc_insumos', label: 'Curva ABC de Insumos', desc: `${insumos.length} insumos classificados`, icon: '📦', disabled: insumos.length === 0 },
                                { id: 'cronograma', label: 'Cronograma Físico-Financeiro', desc: 'Distribuição mensal dos valores', icon: '📅', disabled: !cronogramaResult },
                                { id: 'bdi', label: 'BDI e Encargos Sociais', desc: 'Composição detalhada do BDI', icon: '🔢' },
                            ] as { id: string; label: string; desc: string; icon: string; disabled?: boolean }[]).map(item => {
                                const isCarta = item.id === '_carta';
                                const isChecked = isCarta ? includeCartaProposta : propostaSections.includes(item.id as PropostaSectionId);
                                const isDisabled = item.disabled;
                                return (
                                    <label key={item.id} style={{
                                        display: 'flex', alignItems: 'center', gap: 10,
                                        padding: '10px 12px', borderRadius: 'var(--radius-md)',
                                        border: isChecked ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                                        background: isChecked ? 'rgba(37,99,235,0.04)' : 'var(--color-bg-base)',
                                        cursor: isDisabled ? 'not-allowed' : 'pointer',
                                        opacity: isDisabled ? 0.4 : 1,
                                        transition: 'all 0.15s',
                                    }}>
                                        <input type="checkbox" checked={isChecked} disabled={isDisabled}
                                            onChange={() => {
                                                if (isCarta) { setIncludeCartaProposta(!includeCartaProposta); return; }
                                                const sid = item.id as PropostaSectionId;
                                                setPropostaSections(prev => prev.includes(sid) ? prev.filter(s => s !== sid) : [...prev, sid]);
                                            }}
                                            style={{ accentColor: 'var(--color-primary)', width: 16, height: 16 }} />
                                        <span style={{ fontSize: '1.1rem' }}>{item.icon}</span>
                                        <div style={{ flex: 1 }}>
                                            <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>{item.label}</div>
                                            <div style={{ fontSize: '0.68rem', color: 'var(--color-text-tertiary)' }}>{item.desc}</div>
                                        </div>
                                    </label>
                                );
                            })}
                        </div>

                        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                            <button onClick={() => setShowPropostaModal(false)}
                                style={{ padding: '8px 18px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'var(--color-bg-base)', color: 'var(--color-text-secondary)', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600 }}>
                                Cancelar
                            </button>
                            <button onClick={handlePropostaCompleta}
                                disabled={propostaSections.length === 0 && !includeCartaProposta}
                                style={{
                                    padding: '8px 22px', borderRadius: 'var(--radius-md)', border: 'none',
                                    background: 'linear-gradient(135deg, #7c3aed, #6d28d9)',
                                    color: '#fff', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 700,
                                    display: 'flex', alignItems: 'center', gap: 6,
                                    opacity: (propostaSections.length === 0 && !includeCartaProposta) ? 0.5 : 1,
                                }}>
                                <Layers size={14} />
                                Gerar PDF ({(includeCartaProposta ? 1 : 0) + propostaSections.length} seções)
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
