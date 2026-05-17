import { Printer, FileText, Table2, FileStack, ListOrdered, BarChart3, Layers, ChevronLeft, Eye, X } from 'lucide-react';
import type { ProposalLetterWizardProps } from '../ProposalLetterWizard';
import type { useProposalWizard } from '../useProposalWizard';

export function WizardStepExport({ p, w }: { p: ProposalLetterWizardProps, w: ReturnType<typeof useProposalWizard> }) {
    return (
        <div>
            <h3 style={{ margin: '0 0 var(--space-4)', fontSize: 'var(--text-lg)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Printer size={18} color="var(--color-primary)" /> Exportação
            </h3>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-3)', marginBottom: 'var(--space-5)' }}>
                {([
                    { mode: 'LETTER' as const, icon: <FileText size={24} />, label: 'Carta Apenas', desc: 'Carta proposta sem planilha' },
                    { mode: 'SPREADSHEET' as const, icon: <Table2 size={24} />, label: 'Planilha Apenas', desc: 'Tabela de preços isolada' },
                    { mode: 'FULL' as const, icon: <FileStack size={24} />, label: 'Completa', desc: 'Carta + Planilha de Preços' },
                ]).map(opt => (
                    <button key={opt.mode} onClick={() => w.setSelectedExportMode(opt.mode)} style={{
                        padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)',
                        border: 'none', boxShadow: w.selectedExportMode === opt.mode ? '0 0 0 2px var(--color-primary), 0 4px 12px rgba(0,0,0,0.05)' : '0 0 0 1px var(--color-border)',
                        background: w.selectedExportMode === opt.mode ? 'var(--color-primary-light)' : 'var(--color-bg-base)',
                        cursor: 'pointer', textAlign: 'center', transition: 'all 0.2s',
                    }}>
                        <div style={{ color: w.selectedExportMode === opt.mode ? 'var(--color-primary)' : 'var(--color-text-tertiary)', marginBottom: 8 }}>{opt.icon}</div>
                        <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--color-text-primary)' }}>{opt.label}</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)', marginTop: 4 }}>{opt.desc}</div>
                    </button>
                ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 'var(--space-3)', marginBottom: 'var(--space-5)' }}>
                {([
                    { mode: 'LETTER_WITH_SUMMARY' as const, icon: <ListOrdered size={20} />, label: 'Carta c/ Resumo', desc: 'Carta com quadro resumido dos itens' },
                    { mode: 'LETTER_ANALYTICAL' as const, icon: <BarChart3 size={20} />, label: 'Carta Analítica', desc: 'Carta com detalhamento completo' },
                ]).map(opt => (
                    <button key={opt.mode} onClick={() => w.setSelectedExportMode(opt.mode)} style={{
                        padding: 'var(--space-3)', borderRadius: 'var(--radius-lg)',
                        border: 'none', boxShadow: w.selectedExportMode === opt.mode ? '0 0 0 2px var(--color-primary), 0 4px 12px rgba(0,0,0,0.05)' : '0 0 0 1px var(--color-border)',
                        background: w.selectedExportMode === opt.mode ? 'var(--color-primary-light)' : 'var(--color-bg-base)',
                        cursor: 'pointer', textAlign: 'left', transition: 'all 0.2s',
                        display: 'flex', alignItems: 'center', gap: 12,
                    }}>
                        <div style={{ color: w.selectedExportMode === opt.mode ? 'var(--color-primary)' : 'var(--color-text-tertiary)' }}>{opt.icon}</div>
                        <div>
                            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--color-text-primary)' }}>{opt.label}</div>
                            <div style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)' }}>{opt.desc}</div>
                        </div>
                    </button>
                ))}
            </div>

            {/* Composição de Preços */}
            <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-2)', paddingBottom: 'var(--space-1)', borderBottom: '1px solid var(--color-border)' }}>
                Composição de Preços
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-3)', marginBottom: 'var(--space-5)' }}>
                {([
                    { mode: 'COMPOSITION_ONLY' as const, icon: <Layers size={22} />, label: 'Composições Apenas', desc: 'Todas as composições de preços unitários' },
                    { mode: 'FULL_WITH_COMPOSITION' as const, icon: <FileStack size={22} />, label: 'Completa c/ Composição', desc: 'Carta + Planilha + Composições' },
                    { mode: 'FULL_WITHOUT_COMPOSITION' as const, icon: <FileText size={22} />, label: 'Completa s/ Composição', desc: 'Carta + Planilha (sem composições)' },
                ]).map(opt => (
                    <button key={opt.mode} onClick={() => w.setSelectedExportMode(opt.mode)} style={{
                        padding: 'var(--space-3)', borderRadius: 'var(--radius-lg)',
                        border: 'none', boxShadow: w.selectedExportMode === opt.mode ? '0 0 0 2px var(--color-primary), 0 4px 12px rgba(0,0,0,0.05)' : '0 0 0 1px var(--color-border)',
                        background: w.selectedExportMode === opt.mode ? 'var(--color-primary-light)' : 'var(--color-bg-base)',
                        cursor: 'pointer', textAlign: 'center', transition: 'all 0.2s',
                    }}>
                        <div style={{ color: w.selectedExportMode === opt.mode ? 'var(--color-primary)' : 'var(--color-text-tertiary)', marginBottom: 6 }}>{opt.icon}</div>
                        <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--color-text-primary)' }}>{opt.label}</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)', marginTop: 3 }}>{opt.desc}</div>
                    </button>
                ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--space-5)' }}>
                <button onClick={() => w.setStep('review')} className="btn btn-outline" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <ChevronLeft size={16} /> Voltar
                </button>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                    {/* Toggle Paisagem ao lado do Exportar */}
                    <label style={{
                        display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: 'pointer',
                        padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-md)',
                        backgroundColor: 'var(--color-bg-base)', border: 'none', boxShadow: '0 0 0 1px var(--color-border)',
                        fontSize: 'var(--text-sm)',
                    }}>
                        <input type="checkbox" checked={p.printLandscape || false}
                            onChange={(e) => p.setPrintLandscape?.(e.target.checked)}
                            style={{ width: '14px', height: '14px', accentColor: 'var(--color-primary)' }} />
                        <Printer size={12} style={{ color: 'var(--color-text-tertiary)' }} />
                        <span style={{ fontWeight: 500, color: 'var(--color-text-secondary)' }}>Paisagem</span>
                    </label>

                    {/* FIX F3.2: Preview button */}
                    <button onClick={w.handlePreview} disabled={!w.letterResult}
                        style={{
                            padding: 'var(--space-3) var(--space-5)', borderRadius: 'var(--radius-lg)',
                            background: 'var(--color-bg-base)', border: '1px solid var(--color-border)',
                            fontWeight: 700, fontSize: 'var(--text-sm)', cursor: w.letterResult ? 'pointer' : 'default',
                            display: 'flex', alignItems: 'center', gap: 8, color: 'var(--color-text-primary)',
                            opacity: w.letterResult ? 1 : 0.5,
                        }}>
                        <Eye size={16} /> Preview
                    </button>

                    <button onClick={w.handleExport} style={{
                        padding: 'var(--space-3) var(--space-8)', borderRadius: 'var(--radius-lg)',
                        background: 'linear-gradient(135deg, var(--color-primary), var(--color-ai))',
                        color: 'white', border: 'none', fontWeight: 700, fontSize: 'var(--text-md)',
                        cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                        boxShadow: '0 4px 14px rgba(37, 99, 235, 0.3)',
                    }}>
                        <Printer size={18} /> Exportar PDF
                    </button>

                </div>
            </div>

            {/* FIX F3.2: Preview Modal */}
            {w.showPreview && w.previewHtml && (
                <div style={{
                    position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.6)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
                }}>
                    <div style={{
                        width: '90vw', height: '90vh', background: 'var(--color-bg-surface)',
                        borderRadius: 'var(--radius-xl)', overflow: 'hidden', display: 'flex',
                        flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
                    }}>
                        <div style={{
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            padding: '12px 20px', borderBottom: '1px solid var(--color-border)',
                            background: 'var(--color-bg-base)',
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <Eye size={16} color="var(--color-primary)" />
                                <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>Preview do Documento</span>
                                <span style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)', padding: '2px 8px', background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-sm)' }}>
                                    {w.selectedExportMode.replace(/_/g, ' ')}
                                </span>
                            </div>
                            <div style={{ display: 'flex', gap: 8 }}>
                                <button onClick={() => { w.setShowPreview(false); w.handleExport(); }}
                                    style={{
                                        padding: '6px 16px', borderRadius: 'var(--radius-md)',
                                        background: 'linear-gradient(135deg, var(--color-primary), var(--color-ai))',
                                        color: 'white', border: 'none', fontWeight: 700, fontSize: '0.8rem',
                                        cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
                                    }}>
                                    <Printer size={14} /> Imprimir
                                </button>
                                <button onClick={() => w.setShowPreview(false)}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
                                    <X size={20} color="var(--color-text-tertiary)" />
                                </button>
                            </div>
                        </div>
                        <iframe
                            srcDoc={w.previewHtml}
                            style={{ flex: 1, border: 'none', width: '100%' }}
                            title="Preview da Carta Proposta"
                        />
                    </div>
                </div>
            )}
        </div>
    );
}
