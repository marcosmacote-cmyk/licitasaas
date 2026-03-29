import { useEffect } from 'react';
import { Plus, LayoutGrid, List, Cpu, Loader2, Bell, Search, Filter, X, CheckCircle2, CalendarDays, BellOff } from 'lucide-react';
import { KanbanBoard } from './KanbanBoard';
import { BiddingTable } from './BiddingTable';
import { ProcessFormModal } from './ProcessFormModal';
import { AiReportModal } from './AiReportModal';
import type { BiddingProcess, AiAnalysis, CompanyProfile } from '../types';
import { ConfirmDialog } from './ui';
import { BiddingSettingsPanel } from './bidding/BiddingSettingsPanel';
import { useBiddingPage, EMPTY_FILTERS } from './hooks/useBiddingPage';

interface Props {
    items: BiddingProcess[];
    setItems: React.Dispatch<React.SetStateAction<BiddingProcess[]>>;
    companies: CompanyProfile[];
    initialFilter?: { statuses?: string[]; highlight?: string } | null;
    onFilterConsumed?: () => void;
    onNavigateToModule?: (module: string, processId?: string) => void;
    autoOpenProcessId?: string | null;
    onAutoOpenConsumed?: () => void;
}

export function BiddingPage({ items, setItems, companies, initialFilter, onFilterConsumed, onNavigateToModule, autoOpenProcessId, onAutoOpenConsumed }: Props) {
    const b = useBiddingPage({ items, setItems, companies, initialFilter, onFilterConsumed });

    // Auto-open HUB when navigating from another module
    useEffect(() => {
        if (autoOpenProcessId && items.length > 0) {
            const process = items.find(p => p.id === autoOpenProcessId);
            if (process) {
                b.handleEdit(process);
            }
            onAutoOpenConsumed?.();
        }
    }, [autoOpenProcessId, items.length]);

    return (
        <div className="page-container">
            {/* Interactive Notification Modal */}
            {b.activeNotification && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: 'rgba(0, 0, 0, 0.6)', animation: 'fadeIn 0.3s ease-out'
                }}>
                    <div className="card" style={{
                        width: '100%', maxWidth: '460px', padding: 'var(--space-8)',
                        border: '2px solid var(--color-warning-border)',
                        animation: 'scaleUp 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
                    }}>
                        <div className="flex-col gap-4 mb-6" style={{ alignItems: 'center', textAlign: 'center' }}>
                            <div style={{ background: 'var(--color-warning-bg)', borderRadius: 'var(--radius-full)', padding: 'var(--space-4)', animation: 'pulseRing 2s infinite', border: '2px solid var(--color-warning)' }}>
                                <Bell size={36} color="var(--color-warning)" />
                            </div>
                            <div>
                                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-bold)', textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--color-urgency)', marginBottom: 'var(--space-2)' }}>
                                    Lembrete {b.activeNotification.item.reminderType === 'weekdays' ? 'Recorrente' : ''}
                                </div>
                                <div style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--font-bold)', color: 'var(--color-text-primary)', lineHeight: 1.3, marginBottom: 'var(--space-3)' }}>
                                    {b.activeNotification.item.title}
                                </div>
                                <span className="badge badge-warning" style={{ fontSize: 'var(--text-sm)', padding: 'var(--space-2) var(--space-4)' }}>
                                    {new Date(b.activeNotification.item.reminderDate!).toLocaleString('pt-BR')}
                                </span>
                                {b.activeNotification.item.reminderType === 'weekdays' && (() => {
                                    try {
                                        const days: number[] = JSON.parse(b.activeNotification.item.reminderDays || '[]');
                                        const labels = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
                                        return <div style={{ marginTop: 'var(--space-3)', color: 'var(--color-warning)', fontSize: 'var(--text-sm)', fontWeight: 'var(--font-semibold)' }}>
                                            Repete às: {days.map(d => labels[d]).join(', ')}
                                        </div>;
                                    } catch { return null; }
                                })()}
                            </div>
                        </div>
                        <div className="flex-col gap-3">
                            <button className="btn btn-primary" style={{ width: '100%', padding: 'var(--space-3)' }} onClick={() => b.handleReminderAction('ok')}>
                                <CheckCircle2 size={16} /> {b.activeNotification.item.reminderType === 'weekdays' ? 'Ciente (Agendar próximo)' : 'Estou Ciente'}
                            </button>
                            <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                                <button className="btn btn-outline" style={{ flex: 1, color: 'var(--color-warning)' }} onClick={() => b.handleReminderAction('tomorrow')}><CalendarDays size={14} /> Adiar Amanhã</button>
                                <button className="btn btn-outline" style={{ flex: 1, color: 'var(--color-danger)' }} onClick={() => b.handleReminderAction('dismiss')}><BellOff size={14} /> Desativar</button>
                            </div>
                        </div>
                    </div>
                    <style>{`
                        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
                        @keyframes scaleUp { from { transform: scale(0.9); opacity: 0; } to { transform: scale(1); opacity: 1; } }
                        @keyframes pulseRing { 0% { box-shadow: 0 0 0 0 var(--color-warning-bg); } 70% { box-shadow: 0 0 0 15px transparent; } 100% { box-shadow: 0 0 0 0 transparent; } }
                    `}</style>
                </div>
            )}

            {/* ═══ BREADCRUMB ═══ */}
            <div className="breadcrumb">
                <span>Licitações</span>
                <span className="breadcrumb-sep">›</span>
                <span className="breadcrumb-current">{b.viewMode === 'kanban' ? 'Pipeline Kanban' : 'Visão em Tabela'}</span>
            </div>

            {/* ═══ PAGE HEADER ═══ */}
            <div style={{ marginBottom: 'var(--space-5)' }}>
                <div className="page-header flex-between" style={{ marginBottom: 'var(--space-4)' }}>
                    <div>
                        <h1 className="page-title">Pipeline de Licitações</h1>
                        <p className="page-subtitle">
                            {items.length} processo{items.length !== 1 ? 's' : ''} no funil
                            {b.hasActiveFilters && <> · <strong style={{ color: 'var(--color-primary)' }}>{b.filteredItems.length}</strong> com filtros ativos</>}
                        </p>
                    </div>
                    <div className="flex-gap">
                        <input type="file" accept="application/pdf" ref={b.fileInputRef} style={{ display: 'none' }} onChange={b.handleFileUpload} multiple />
                        <button className="btn btn-ai" onClick={b.handleAIAssistClick} disabled={b.isParsingAI}>
                            {b.isParsingAI ? <Loader2 size={16} className="spinner" /> : <Cpu size={16} />}
                            {b.isParsingAI ? 'Analisando...' : 'IA: Extrair Edital'}
                        </button>
                        <button className="btn btn-primary" onClick={b.handleCreateNew}>
                            <Plus size={16} /> Nova Licitação
                        </button>
                    </div>
                </div>

                {/* ═══ PIPELINE STATUS COUNTERS ═══ */}
                <div style={{
                    display: 'flex', gap: 'var(--space-2)', padding: 'var(--space-2)',
                    background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-xl)',
                    border: 'none', boxShadow: 'var(--shadow-sm), 0 0 0 1px var(--color-border)',
                    overflowX: 'auto',
                    scrollbarWidth: 'none', // Firefox
                    msOverflowStyle: 'none' // IE and Edge
                }} className="hide-scrollbar">
                    {b.dynamicCounters.map(s => (
                        <div key={s.label} style={{ flex: '1 1 0', minWidth: '100px', maxWidth: '140px', textAlign: 'center', padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-lg)', transition: 'all 150ms' }}
                             onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-base)'}
                             onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                        >
                            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: s.count > 0 ? s.color : 'var(--color-text-tertiary)', lineHeight: 1.2 }}>{s.count}</div>
                            <div style={{ fontSize: '0.75rem', color: s.count > 0 ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', marginTop: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={s.label}>{s.label}</div>
                        </div>
                    ))}
                </div>
            </div>

            {/* ═══ TOOLBAR ═══ */}
            <div className="flex-center gap-3 mb-4" style={{ flexWrap: 'wrap' }}>
                {/* View Toggle */}
                <div className="flex-gap" style={{ background: 'var(--color-bg-surface)', padding: '3px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', gap: '2px' }}>
                    <button className={`icon-btn ${b.viewMode === 'kanban' ? 'active' : ''}`}
                        style={{ background: b.viewMode === 'kanban' ? 'var(--color-primary-light)' : 'transparent', color: b.viewMode === 'kanban' ? 'var(--color-primary)' : 'var(--color-text-tertiary)' }}
                        onClick={() => b.setViewMode('kanban')} title="Visão Kanban">
                        <LayoutGrid size={16} />
                    </button>
                    <button className={`icon-btn ${b.viewMode === 'table' ? 'active' : ''}`}
                        style={{ background: b.viewMode === 'table' ? 'var(--color-primary-light)' : 'transparent', color: b.viewMode === 'table' ? 'var(--color-primary)' : 'var(--color-text-tertiary)' }}
                        onClick={() => b.setViewMode('table')} title="Visão Tabela">
                        <List size={16} />
                    </button>
                </div>

                {/* Search */}
                <div style={{ position: 'relative', flex: '1', maxWidth: '360px' }}>
                    <Search size={14} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-tertiary)' }} />
                    <input type="text" value={b.filters.searchText} onChange={e => b.setFilters({ ...b.filters, searchText: e.target.value })}
                        placeholder="Buscar título, objeto, empresa..."
                        style={{ width: '100%', padding: '8px 32px 8px 34px', fontSize: 'var(--text-md)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg-surface)', color: 'var(--color-text-primary)', outline: 'none', transition: 'border-color 150ms' }} />
                    {b.filters.searchText && (
                        <button onClick={() => b.setFilters({ ...b.filters, searchText: '' })} style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-tertiary)', padding: '4px' }}>
                            <X size={14} />
                        </button>
                    )}
                </div>

                {/* Filters Button */}
                <div className="pos-relative">
                    <button className={`btn ${b.showFilterPanel || b.hasActiveFilters ? 'btn-primary' : 'btn-outline'}`} onClick={() => { b.setShowFilterPanel(!b.showFilterPanel); b.setShowCardConfig(false); }}>
                        <Filter size={14} /> Filtros
                        {b.activeFilterCount > 0 && (
                            <span style={{ background: 'rgba(255,255,255,0.3)', color: 'white', fontSize: 'var(--text-xs)', padding: '1px 6px', borderRadius: 'var(--radius-full)', fontWeight: 'var(--font-bold)', marginLeft: '4px' }}>{b.activeFilterCount}</span>
                        )}
                    </button>
                </div>

                <div style={{ flex: '1' }} />

                <BiddingSettingsPanel companies={companies} cardFields={b.cardFields} setCardFields={b.setCardFields}
                    showCardConfig={b.showCardConfig} setShowCardConfig={b.setShowCardConfig}
                    visibleColumns={b.visibleColumns} setVisibleColumns={b.setVisibleColumns}
                    sortBy={b.sortBy} setSortBy={b.setSortBy}
                    compactMode={b.compactMode} setCompactMode={b.setCompactMode}
                    highlightExpiring={b.highlightExpiring} setHighlightExpiring={b.setHighlightExpiring}
                    defaultCompanyId={b.defaultCompanyId} setDefaultCompanyId={b.setDefaultCompanyId}
                    aiLanguage={b.aiLanguage} setAiLanguage={b.setAiLanguage}
                    aiFocus={b.aiFocus} setAiFocus={b.setAiFocus}
                    aiAutoAnalyze={b.aiAutoAnalyze} setAiAutoAnalyze={b.setAiAutoAnalyze}
                    onExportCsv={b.exportToCsv} onExportExcel={b.exportToExcel} onExportPdf={b.exportToPdf}
                    onCloseOtherPanels={() => b.setShowFilterPanel(false)} />

                {b.hasActiveFilters && (
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>{b.filteredItems.length} de {items.length}</span>
                )}
            </div>

            {/* Filter Panel Dropdown */}
            {b.showFilterPanel && (
                <div style={{ position: 'relative', marginBottom: 'var(--space-3)', zIndex: 50 }}>
                    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
                        <div className="flex-between" style={{ padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--color-border)' }}>
                            <span style={{ fontWeight: 'var(--font-bold)', fontSize: 'var(--text-md)' }}>Filtros Inteligentes</span>
                            {b.hasActiveFilters && <button onClick={() => b.setFilters(EMPTY_FILTERS)} className="btn-link btn-link--danger">Limpar</button>}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 0 }}>
                            <FilterSection title="Empresa">
                                {b.filterOptions.companies.map(compId => {
                                    const comp = companies.find(c => c.id === compId);
                                    return (<FilterCheckbox key={compId} label={comp?.razaoSocial || 'Desconhecida'} checked={b.filters.companies.includes(compId)}
                                        onChange={() => b.setFilters({ ...b.filters, companies: b.filters.companies.includes(compId) ? b.filters.companies.filter(x => x !== compId) : [...b.filters.companies, compId] })} />);
                                })}
                            </FilterSection>
                            <FilterSection title="Modalidade">
                                {b.filterOptions.modalities.map(m => (<FilterCheckbox key={m} label={m} checked={b.filters.modalities.includes(m)}
                                    onChange={() => b.setFilters({ ...b.filters, modalities: b.filters.modalities.includes(m) ? b.filters.modalities.filter(x => x !== m) : [...b.filters.modalities, m] })} />))}
                            </FilterSection>
                            <FilterSection title="Portal">
                                {b.filterOptions.portals.map(p => (<FilterCheckbox key={p} label={p} checked={b.filters.portals.includes(p)}
                                    onChange={() => b.setFilters({ ...b.filters, portals: b.filters.portals.includes(p) ? b.filters.portals.filter(x => x !== p) : [...b.filters.portals, p] })} />))}
                            </FilterSection>
                            <FilterSection title="Fase / Status">
                                {b.filterOptions.statuses.map(s => (<FilterCheckbox key={s} label={s} checked={b.filters.statuses.includes(s)}
                                    onChange={() => b.setFilters({ ...b.filters, statuses: b.filters.statuses.includes(s) ? b.filters.statuses.filter(x => x !== s) : [...b.filters.statuses, s] })} />))}
                            </FilterSection>
                            <FilterSection title="Risco IA">
                                {b.filterOptions.risks.map(r => (<FilterCheckbox key={r} label={r} checked={b.filters.risks.includes(r)}
                                    onChange={() => b.setFilters({ ...b.filters, risks: b.filters.risks.includes(r) ? b.filters.risks.filter(x => x !== r) : [...b.filters.risks, r] })} />))}
                            </FilterSection>
                        </div>
                    </div>
                </div>
            )}

            {/* Card Config Dropdown */}
            {b.showCardConfig && (
                <div style={{ position: 'relative', marginBottom: 'var(--space-3)', zIndex: 50 }}>
                    <div className="card" style={{ padding: 0, overflow: 'hidden', maxWidth: '400px', marginLeft: 'auto' }}>
                        <div style={{ padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--color-border)' }}>
                            <div style={{ fontWeight: 'var(--font-bold)', fontSize: 'var(--text-md)' }}>Campos Visíveis</div>
                            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>Escolha o que aparece nos cards</div>
                        </div>
                        <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                            {b.cardFields.map(field => (
                                <label key={field.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', cursor: 'pointer', borderBottom: '1px solid var(--color-border)' }}
                                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-bg-surface-hover)')}
                                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                                    onClick={e => { e.preventDefault(); b.setCardFields(b.cardFields.map(f => f.key === field.key ? { ...f, visible: !f.visible } : f)); }}>
                                    <span style={{ fontSize: 'var(--text-md)', color: 'var(--color-text-primary)' }}>{field.label}</span>
                                    <div style={{ width: '32px', height: '18px', borderRadius: '999px', position: 'relative', cursor: 'pointer', transition: 'background 0.2s', background: field.visible ? 'var(--color-ai)' : 'var(--color-border)' }}>
                                        <div style={{ position: 'absolute', top: '2px', left: field.visible ? '16px' : '2px', width: '14px', height: '14px', borderRadius: '50%', background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.2)', transition: 'left 0.2s' }} />
                                    </div>
                                </label>
                            ))}
                        </div>
                        <div style={{ padding: '8px 16px', borderTop: '1px solid var(--color-border)', textAlign: 'center', fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)' }}>
                            {b.cardFields.filter(f => f.visible).length} de {b.cardFields.length} visíveis
                        </div>
                    </div>
                </div>
            )}

            {/* Active Filter Chips */}
            {b.hasActiveFilters && (
                <div className="flex-center flex-wrap gap-1 mb-3">
                    {b.filters.specialFilter === 'monitoring_error' && <FilterChip label="❌ Falha no Monitoramento" color="var(--color-danger)" onRemove={() => b.setFilters({ ...b.filters, specialFilter: undefined })} />}
                    {b.filters.specialFilter === 'stalled_processes' && <FilterChip label="⚠️ Processos Parados" color="var(--color-warning)" onRemove={() => b.setFilters({ ...b.filters, specialFilter: undefined })} />}
                    {b.filters.specialFilter === 'today_sessions' && <FilterChip label="⏰ Sessões de Hoje" color="var(--color-urgency)" onRemove={() => b.setFilters({ ...b.filters, specialFilter: undefined })} />}
                    {b.filters.specialFilter === 'needs_ai_analysis' && <FilterChip label="🤖 Análise de IA Pendente" color="var(--color-ai)" onRemove={() => b.setFilters({ ...b.filters, specialFilter: undefined })} />}
                    {b.filters.searchText && <FilterChip label={`"${b.filters.searchText}"`} onRemove={() => b.setFilters({ ...b.filters, searchText: '' })} />}
                    {b.filters.companies.map(compId => { const name = companies.find(c => c.id === compId)?.razaoSocial || compId; return <FilterChip key={compId} label={name} color="var(--color-primary)" onRemove={() => b.setFilters({ ...b.filters, companies: b.filters.companies.filter(x => x !== compId) })} />; })}
                    {b.filters.modalities.map(m => <FilterChip key={m} label={m} color="var(--color-ai)" onRemove={() => b.setFilters({ ...b.filters, modalities: b.filters.modalities.filter(x => x !== m) })} />)}
                    {b.filters.portals.map(p => <FilterChip key={p} label={p} color="var(--color-success)" onRemove={() => b.setFilters({ ...b.filters, portals: b.filters.portals.filter(x => x !== p) })} />)}
                    {b.filters.statuses.map(s => <FilterChip key={s} label={s} color="var(--color-warning)" onRemove={() => b.setFilters({ ...b.filters, statuses: b.filters.statuses.filter(x => x !== s) })} />)}
                    {b.filters.risks.map(r => <FilterChip key={r} label={r} color="var(--color-danger)" onRemove={() => b.setFilters({ ...b.filters, risks: b.filters.risks.filter(x => x !== r) })} />)}
                    <button onClick={() => b.setFilters(EMPTY_FILTERS)} className="btn-link btn-link--danger" style={{ fontSize: 'var(--text-xs)' }}>Limpar tudo</button>
                </div>
            )}

            {b.viewMode === 'kanban' ? (
                <KanbanBoard items={b.filteredItems} setItems={setItems} onEditProcess={b.handleEdit} onDeleteProcess={b.handleDeleteProcess}
                    analyses={b.analyses} companies={companies}
                    onViewAnalysis={(_analysis, process) => { if (process) b.setViewingProcessForAnalysis(process); }}
                    onStatusChange={b.handleStatusChange} onToggleMonitor={b.handleToggleMonitor}
                    cardFields={b.cardFields} visibleColumns={b.visibleColumns} sortBy={b.sortBy}
                    compactMode={b.compactMode} highlightExpiring={b.highlightExpiring} />
            ) : (
                <BiddingTable items={b.filteredItems} companies={companies} onEditProcess={b.handleEdit} analyses={b.analyses}
                    onViewAnalysis={(_analysis, process) => { if (process) b.setViewingProcessForAnalysis(process); }}
                    onToggleMonitor={b.handleToggleMonitor} />
            )}

            {b.isModalOpen && (
                <ProcessFormModal
                    initialData={b.editingProcess as BiddingProcess | null}
                    companies={companies}
                    onClose={() => { b.setIsModalOpen(false); b.setPendingAnalysis(null); }}
                    onSave={b.handleSaveProcess}
                    onRequestAiAnalysis={b.analyses.some((a: AiAnalysis) => a.biddingProcessId === b.editingProcess?.id) ? () => {
                        b.setIsModalOpen(false);
                        b.setViewingProcessForAnalysis(b.editingProcess as BiddingProcess);
                    } : undefined}
                    onNavigateToModule={onNavigateToModule}
                />
            )}

            {b.viewingProcessForAnalysis && (
                <AiReportModal
                    analysis={b.analyses.find((a: AiAnalysis) => a.biddingProcessId === b.viewingProcessForAnalysis!.id)!}
                    process={b.viewingProcessForAnalysis}
                    onClose={() => b.setViewingProcessForAnalysis(null)}
                    onUpdate={b.refreshData}
                />
            )}

            <ConfirmDialog open={!!b.confirmDeleteId} title="Excluir Licitação"
                message="Tem certeza que deseja excluir esta licitação? Esta ação não pode ser desfeita."
                confirmLabel="Excluir" variant="danger"
                onConfirm={b.confirmDelete} onCancel={() => b.setConfirmDeleteId(null)} />
        </div>
    );
}

// ===== FILTER HELPER COMPONENTS =====
function FilterSection({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-border)' }}>
            <h4 className="section-label" style={{ fontSize: '0.7rem' }}>{title}</h4>
            {children}
        </div>
    );
}

function FilterCheckbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
    return (
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 4px', cursor: 'pointer', borderRadius: '4px', fontSize: '0.8125rem', color: 'var(--color-text-primary)' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-bg-surface-hover)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}>
            <input type="checkbox" checked={checked} onChange={onChange} style={{ width: '14px', height: '14px', accentColor: 'var(--color-success)', cursor: 'pointer' }} />
            <span>{label}</span>
        </label>
    );
}

function FilterChip({ label, color = 'var(--color-text-tertiary)', onRemove }: { label: string; color?: string; onRemove: () => void }) {
    return (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '3px 10px', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 500, background: `${color}18`, color: color, border: `1px solid ${color}30` }}>
            {label}
            <button onClick={onRemove} style={{ background: 'none', border: 'none', cursor: 'pointer', color: color, padding: '1px', display: 'flex', alignItems: 'center' }}>
                <X size={12} />
            </button>
        </span>
    );
}
