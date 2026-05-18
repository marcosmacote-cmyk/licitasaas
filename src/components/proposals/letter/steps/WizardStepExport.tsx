import { Printer, FileText, Table2, FileStack, ListOrdered, BarChart3, Layers, ChevronLeft, Eye, X, ShieldCheck, ShieldAlert, AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
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
                <div style={{ position: 'fixed', inset: 0, zIndex: 10000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
                    <div style={{ width: '90vw', height: '90vh', background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-xl)', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg-base)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <Eye size={16} color="var(--color-primary)" />
                                <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>Preview do Documento</span>
                                <span style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)', padding: '2px 8px', background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-sm)' }}>{w.selectedExportMode.replace(/_/g, ' ')}</span>
                            </div>
                            <div style={{ display: 'flex', gap: 8 }}>
                                <button onClick={() => { w.setShowPreview(false); w.handleExport(); }} style={{ padding: '6px 16px', borderRadius: 'var(--radius-md)', background: 'linear-gradient(135deg, var(--color-primary), var(--color-ai))', color: 'white', border: 'none', fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <Printer size={14} /> Imprimir
                                </button>
                                <button onClick={() => w.setShowPreview(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
                                    <X size={20} color="var(--color-text-tertiary)" />
                                </button>
                            </div>
                        </div>
                        <iframe srcDoc={w.previewHtml} style={{ flex: 1, border: 'none', width: '100%' }} title="Preview da Carta Proposta" />
                    </div>
                </div>
            )}

            {/* ═══ COMPLIANCE GUARD MODAL ═══ */}
            {w.showComplianceGuard && w.complianceResult && (() => {
                const c = w.complianceResult;
                const statusIcon = (s: string) => s === 'ok' ? <CheckCircle2 size={14} color="#22C55E" /> : s === 'fail' ? <XCircle size={14} color="#EF4444" /> : s === 'warning' ? <AlertTriangle size={14} color="#F59E0B" /> : <Info size={14} color="#6366F1" />;
                const gradeColor = c.grade === 'A' ? '#22C55E' : c.grade === 'B' ? '#3B82F6' : c.grade === 'C' ? '#F59E0B' : '#EF4444';
                const riskColor = c.riskLevel === 'baixo' ? '#22C55E' : c.riskLevel === 'medio' ? '#F59E0B' : c.riskLevel === 'alto' ? '#EF4444' : '#DC2626';
                const categories = [
                    { key: 'data', label: '📋 Dados Obrigatórios' },
                    { key: 'financial', label: '💰 Financeiro' },
                    { key: 'consistency', label: '🔗 Consistência' },
                    { key: 'declaration', label: '📜 Declarações' },
                    { key: 'document', label: '📄 Documentos/Blocos' },
                ];
                return (
                    <div style={{ position: 'fixed', inset: 0, zIndex: 10001, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
                        <div style={{ width: '600px', maxHeight: '85vh', background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-xl)', overflow: 'hidden', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.35)' }}>
                            {/* Header */}
                            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg-base)', display: 'flex', alignItems: 'center', gap: 10 }}>
                                {c.failCount === 0 ? <ShieldCheck size={22} color={gradeColor} /> : <ShieldAlert size={22} color={riskColor} />}
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>Compliance Guard — Pré-Exportação</div>
                                    <div style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)' }}>{c.summary}</div>
                                </div>
                                <button onClick={() => w.setShowComplianceGuard(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
                                    <X size={18} color="var(--color-text-tertiary)" />
                                </button>
                            </div>

                            {/* Score bar */}
                            <div style={{ padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 16, borderBottom: '1px solid var(--color-border)' }}>
                                <div style={{ width: 48, height: 48, borderRadius: '50%', background: `conic-gradient(${gradeColor} ${c.score * 3.6}deg, var(--color-border) 0deg)`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                    <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'var(--color-bg-surface)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.85rem', color: gradeColor }}>{c.grade}</div>
                                </div>
                                <div style={{ flex: 1 }}>
                                    <div style={{ display: 'flex', gap: 12, fontSize: '0.72rem' }}>
                                        <span style={{ color: '#22C55E' }}>✓ {c.okCount} OK</span>
                                        <span style={{ color: '#F59E0B' }}>⚠ {c.warnCount} Atenção</span>
                                        <span style={{ color: '#EF4444' }}>✕ {c.failCount} Falha{c.failCount !== 1 ? 's' : ''}</span>
                                    </div>
                                    <div style={{ marginTop: 4, height: 6, borderRadius: 3, background: 'var(--color-border)', overflow: 'hidden' }}>
                                        <div style={{ height: '100%', width: `${c.score}%`, borderRadius: 3, background: `linear-gradient(90deg, ${gradeColor}, ${gradeColor}88)`, transition: 'width 0.5s' }} />
                                    </div>
                                </div>
                                <div style={{ padding: '3px 10px', borderRadius: 'var(--radius-md)', background: `${riskColor}15`, color: riskColor, fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase' }}>
                                    Risco {c.riskLevel}
                                </div>
                            </div>

                            {/* Items grouped by category */}
                            <div style={{ flex: 1, overflow: 'auto', padding: '12px 20px' }}>
                                {categories.map(cat => {
                                    const catItems = c.items.filter(i => i.category === cat.key);
                                    if (catItems.length === 0) return null;
                                    return (
                                        <div key={cat.key} style={{ marginBottom: 12 }}>
                                            <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--color-text-tertiary)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{cat.label}</div>
                                            {catItems.map(item => (
                                                <div key={item.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '5px 0', borderBottom: '1px solid var(--color-border)', fontSize: '0.78rem' }}>
                                                    <div style={{ flexShrink: 0, marginTop: 1 }}>{statusIcon(item.status)}</div>
                                                    <div style={{ flex: 1, minWidth: 0 }}>
                                                        <div style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>{item.label}</div>
                                                        <div style={{ fontSize: '0.7rem', color: 'var(--color-text-secondary)' }}>{item.message}</div>
                                                        {item.suggestion && <div style={{ fontSize: '0.65rem', color: '#6366F1', marginTop: 1 }}>💡 {item.suggestion}</div>}
                                                        {item.editalClause && <div style={{ fontSize: '0.6rem', color: 'var(--color-text-tertiary)', marginTop: 1 }}>📌 {item.editalClause}</div>}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Footer actions */}
                            <div style={{ padding: '12px 20px', borderTop: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--color-bg-base)' }}>
                                <button onClick={() => { w.setShowComplianceGuard(false); w.setStep('config'); }} className="btn btn-outline" style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <ChevronLeft size={14} /> Corrigir
                                </button>
                                <button onClick={w.forceExport} style={{ padding: '8px 24px', borderRadius: 'var(--radius-lg)', background: c.failCount > 0 ? '#EF444420' : 'linear-gradient(135deg, var(--color-primary), var(--color-ai))', color: c.failCount > 0 ? '#EF4444' : 'white', border: c.failCount > 0 ? '1px solid #EF444440' : 'none', fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <Printer size={16} /> {c.failCount > 0 ? 'Exportar Mesmo Assim' : 'Exportar PDF'}
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
}
