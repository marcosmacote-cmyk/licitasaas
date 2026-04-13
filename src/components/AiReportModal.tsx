import { useState, useCallback } from 'react';
import { ScanSearch, FileCheck, X, MessageSquare, Plus, FileDown, ArrowLeft } from 'lucide-react';
import type { AiAnalysis } from '../types';
import { useAiChat } from './hooks/useAiChat';
import { useAiReport } from './hooks/useAiReport';
import { exportAiReportPdf } from './report/AiReportPdfExporter';
import { EducationalPopover } from './ui';
import type { ReportPdfData } from './report/AiReportPdfExporter';
import { AiReportTabAnalytics } from './report/AiReportTabAnalytics';
import { AiReportTabChat } from './report/AiReportTabChat';

interface Props {
    analysis: AiAnalysis;
    process: any;
    onClose: () => void;
    onUpdate: () => void;
    onImport?: () => void;
    onBackToHub?: () => void;
}

export function AiReportModal({ analysis, process, onClose, onUpdate, onImport, onBackToHub }: Props) {
    const [activeTab, setActiveTab] = useState<'report' | 'chat'>('report');

    const chat = useAiChat({ analysis, process, onUpdate });
    const report = useAiReport({ analysis, process });

    const handleExportPdf = useCallback(() => {
        const pdfData: ReportPdfData = {
            processTitle: process?.title || '',
            confidence: report.pipelineMeta?.confidence || null,
            scorePercentage: report.pipelineMeta?.scorePercentage ?? null,
            metadata: report.processMetadata,
            executiveSummary: report.executiveSummary,
            risks: report.flagList.map((f: any) => ({
                severity: f.severity || 'media',
                title: f.title || '',
                text: f.text || '',
                action: f.action || '',
                sourceRef: f.sourceRef || '',
            })),
            conditions: report.conditions.map((c: any) => ({
                label: c.label || '',
                value: c.value || '',
                sourceRef: c.sourceRef || '',
                type: c.type || 'info',
            })),
            categorizedDocs: Object.fromEntries(
                Object.entries(report.categorizedDocs).map(([cat, docs]) => [
                    cat,
                    (docs as any[]).map((d: any) => ({
                        item: d.item || '',
                        title: d.title || '',
                        description: d.description || '',
                        obligationType: d.obligationType || 'obrigatoria_universal',
                        phase: d.phase || '',
                        riskIfMissing: d.riskIfMissing || '',
                        sourceRef: d.sourceRef || '',
                        entryType: d.entryType || 'exigencia_principal',
                        parentId: d.parentId || null,
                    })),
                ])
            ),
            financialText: report.financialText,
            deadlineList: report.deadlineList,
            penaltiesStructured: report.penaltiesStructured,
            penaltiesText: report.penaltiesText,
            pipelineDurationS: analysis?.pipelineDurationS ?? null,
            traceability: report.pipelineMeta?.traceabilityPercentage !== null
                ? `${report.pipelineMeta?.tracedRequirements}/${report.pipelineMeta?.totalRequirements} (${report.pipelineMeta?.traceabilityPercentage}%)`
                : report.pipelineMeta?.evidenceCount ? `${report.pipelineMeta.evidenceCount} evidências` : '',
            qualityScore: report.pipelineMeta?.qualityScore !== null ? `${report.pipelineMeta?.qualityScore}%` : null,
            model: report.pipelineMeta?.model || analysis?.modelUsed || null,
        };
        exportAiReportPdf(pdfData);
    }, [report, process, analysis]);

    return (
        <div className="modal-overlay" style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            backgroundColor: 'rgba(0, 0, 0, 0.4)', backdropFilter: 'blur(8px)', animation: 'fadeIn 0.25s ease-out'
        }}>
            <div className="modal-content" style={{
                maxWidth: '1060px', width: '95%', height: '92vh', borderRadius: 'var(--radius-xl)',
                boxShadow: 'var(--shadow-xl), 0 0 0 1px var(--color-border)', overflow: 'hidden', backgroundColor: 'var(--color-bg-surface)',
                border: 'none', animation: 'slideUp 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
                display: 'flex', flexDirection: 'column'
            }}>
                {/* Header */}
                <div style={{
                    position: 'relative', zIndex: 10,
                    padding: 'var(--space-6) var(--space-10)',
                    background: 'linear-gradient(135deg, var(--color-text-primary) 0%, var(--color-bg-surface-hover) 100%)',
                    color: 'white', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)',
                    boxShadow: '0 4px 20px rgba(0,0,0,0.08)'
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
                            <div style={{ padding: 'var(--space-3)', background: 'linear-gradient(135deg, var(--color-primary), var(--color-ai))', borderRadius: 'var(--radius-xl)', boxShadow: '0 0 20px rgba(59, 130, 246, 0.4)' }}>
                                <ScanSearch size={24} color="white" />
                            </div>
                            <div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                                    <h2 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, margin: 0, letterSpacing: '-0.025em' }}>
                                        Análise Estratégica <span style={{ color: 'var(--color-primary-border)' }}>IA</span>
                                    </h2>
                                    <EducationalPopover
                                        id="edu_aireport_overview"
                                        title="Raio-X do Edital"
                                        content={
                                            <>
                                                <p style={{ marginTop: 0 }}>A IA leu todo o PDF e estruturou este documento técnico.</p>
                                                <ul style={{ paddingLeft: 'var(--space-4)', margin: 'var(--space-2) 0 0 0' }}>
                                                    <li><b>Riscos e Vedações:</b> Identificamos na hora armadilhas que te impedem de participar.</li>
                                                    <li><b>Exigências:</b> Tudo mastigado para montar sua pasta de documentos.</li>
                                                    <li><b>Consultor:</b> Use a aba do lado para fazer perguntas diretas como: "Qual a data da visita técnica?".</li>
                                                </ul>
                                            </>
                                        }
                                    >
                                        <span style={{ fontSize: 'var(--text-xl)', filter: 'drop-shadow(0 0 4px rgba(255,255,255,0.2))' }}>💡</span>
                                    </EducationalPopover>
                                </div>
                                <p style={{ color: 'var(--color-text-tertiary)', fontSize: 'var(--text-sm)', marginTop: '2px', maxWidth: '500px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {process?.title}
                                </p>
                            </div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                            {report.pipelineMeta && (
                                <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                                    {report.pipelineMeta.confidence && (
                                        <span style={{
                                            padding: '4px 12px', borderRadius: 'var(--radius-full)', fontSize: '0.75rem', fontWeight: 700,
                                            background: report.pipelineMeta.confidence === 'alta' ? 'rgba(34,197,94,0.2)' : report.pipelineMeta.confidence === 'media' ? 'rgba(234,179,8,0.2)' : 'rgba(239,68,68,0.2)',
                                            color: report.pipelineMeta.confidence === 'alta' ? '#4ade80' : report.pipelineMeta.confidence === 'media' ? '#fbbf24' : '#f87171',
                                            border: `1px solid ${report.pipelineMeta.confidence === 'alta' ? 'rgba(34,197,94,0.3)' : report.pipelineMeta.confidence === 'media' ? 'rgba(234,179,8,0.3)' : 'rgba(239,68,68,0.3)'}`
                                        }}>
                                            {report.pipelineMeta.confidence === 'alta' ? '●' : report.pipelineMeta.confidence === 'media' ? '●' : '●'} Confiança {report.pipelineMeta.confidence}
                                        </span>
                                    )}
                                    {report.pipelineMeta.scorePercentage !== null && (
                                        <span style={{ padding: '4px 10px', borderRadius: 'var(--radius-full)', fontSize: '0.7rem', fontWeight: 700, background: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.7)' }}>
                                            {report.pipelineMeta.scorePercentage}%
                                        </span>
                                    )}
                                </div>
                            )}
                            <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.1)', border: 'none', color: 'white', cursor: 'pointer', padding: '8px', borderRadius: '50%', transition: 'all 0.2s' }}
                                onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.2)'}
                                onMouseOut={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.1)'}>
                                <X size={20} />
                            </button>
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: '4px', background: 'rgba(0,0,0,0.2)', padding: '4px', borderRadius: 'var(--radius-full)', border: '1px solid rgba(255,255,255,0.05)', alignSelf: 'flex-start' }}>
                        <button onClick={() => setActiveTab('report')}
                            style={{ 
                                display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 16px', borderRadius: 'var(--radius-full)', border: 'none', cursor: 'pointer',
                                fontSize: '0.85rem', fontWeight: 700, transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                                color: activeTab === 'report' ? '#fff' : 'rgba(255,255,255,0.6)',
                                background: activeTab === 'report' ? 'rgba(255,255,255,0.15)' : 'transparent',
                                boxShadow: activeTab === 'report' ? '0 2px 8px rgba(0,0,0,0.2), inset 0 1px rgba(255,255,255,0.1)' : 'none'
                             }}>
                            <FileCheck size={16} /> Relatório Analítico
                        </button>
                        <button onClick={() => { setActiveTab('chat'); setTimeout(() => chat.scrollToBottom(), 50); }}
                            style={{ 
                                display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 16px', borderRadius: 'var(--radius-full)', border: 'none', cursor: 'pointer',
                                fontSize: '0.85rem', fontWeight: 700, transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                                color: activeTab === 'chat' ? '#fff' : 'rgba(255,255,255,0.6)',
                                background: activeTab === 'chat' ? 'rgba(255,255,255,0.15)' : 'transparent',
                                boxShadow: activeTab === 'chat' ? '0 2px 8px rgba(0,0,0,0.2), inset 0 1px rgba(255,255,255,0.1)' : 'none'
                             }}>
                            <MessageSquare size={16} /> Consultor de Edital
                        </button>
                    </div>
                </div>

                {/* Content Area */}
                <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
                    {activeTab === 'report' ? 
                        <AiReportTabAnalytics report={report} process={process} analysis={analysis} /> 
                        : 
                        <AiReportTabChat chat={chat} />
                    }
                </div>

                {/* Footer */}
                <div style={{ padding: 'var(--space-5) var(--space-10)', background: 'var(--color-bg-surface)', boxShadow: '0 -1px 0 var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--color-text-tertiary)', fontSize: 'var(--text-xs)' }}>
                        <span style={{ fontWeight: 'var(--font-semibold)' }}>ID: {analysis?.id.slice(0, 8)}</span>
                        <span>•</span>
                        <span>{new Date(analysis?.analyzedAt).toLocaleString('pt-BR')}</span>
                        {analysis?.modelUsed && (<><span>•</span><span>{analysis.modelUsed}</span></>)}
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
                        {onBackToHub && (
                            <button onClick={onBackToHub} style={{
                                display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-3) var(--space-6)', borderRadius: 'var(--radius-lg)',
                                border: '1px solid var(--color-primary)', background: 'var(--color-bg-surface)', color: 'var(--color-primary)', fontWeight: 'var(--font-semibold)',
                                fontSize: 'var(--text-md)', cursor: 'pointer', transition: 'var(--transition-fast)'
                            }}
                                onMouseOver={(e) => { e.currentTarget.style.background = 'var(--color-primary)'; e.currentTarget.style.color = '#ffffff'; }}
                                onMouseOut={(e) => { e.currentTarget.style.background = 'var(--color-bg-surface)'; e.currentTarget.style.color = 'var(--color-primary)'; }}>
                                <ArrowLeft size={16} /> Voltar ao Hub
                            </button>
                        )}
                        <button onClick={handleExportPdf} style={{
                            display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-3) var(--space-6)', borderRadius: 'var(--radius-lg)',
                            border: '1px solid var(--color-border)', background: 'var(--color-bg-surface)', color: 'var(--color-text-secondary)', fontWeight: 'var(--font-semibold)',
                            fontSize: 'var(--text-md)', cursor: 'pointer', transition: 'var(--transition-fast)'
                        }}
                            onMouseOver={(e) => { e.currentTarget.style.borderColor = 'var(--color-primary)'; e.currentTarget.style.color = 'var(--color-primary)'; e.currentTarget.style.background = 'var(--color-primary-light)'; }}
                            onMouseOut={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.color = 'var(--color-text-secondary)'; e.currentTarget.style.background = 'var(--color-bg-surface)'; }}>
                            <FileDown size={16} /> Exportar Relatório
                        </button>
                        {onImport && (
                            <button onClick={onImport} style={{
                                display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-3) var(--space-6)', borderRadius: 'var(--radius-lg)',
                                border: 'none', background: 'linear-gradient(135deg, var(--color-primary), var(--color-ai))', color: 'white', fontWeight: 'var(--font-bold)',
                                fontSize: 'var(--text-md)', cursor: 'pointer', boxShadow: 'var(--shadow-md)', transition: 'var(--transition-fast)'
                            }}
                                onMouseOver={(e) => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 6px 20px rgba(59, 130, 246, 0.45)'; }}
                                onMouseOut={(e) => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(59, 130, 246, 0.35)'; }}>
                                <Plus size={16} /> Importar para o Funil
                            </button>
                        )}
                        <button className="btn btn-outline" onClick={onClose} style={{ borderRadius: 'var(--radius-lg)', padding: 'var(--space-3) var(--space-6)' }}>Fechar Painel</button>
                    </div>
                </div>
            </div>

            <style>{`
                @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
                @keyframes slideUp { from { transform: translateY(30px) scale(0.98); opacity: 0; } to { transform: translateY(0) scale(1); opacity: 1; } }
                .quick-reply-btn { padding: var(--space-3) var(--space-5); border-radius: var(--radius-lg); background: var(--color-bg-surface); border: 1px solid var(--color-border); color: var(--color-text-secondary); font-size: 0.875rem; cursor: pointer; transition: var(--transition-fast); }
                .quick-reply-btn:hover { border-color: var(--color-primary); color: var(--color-primary); background: var(--color-primary-light); }
            `}</style>
        </div>
    );
}
