import React, { useState, useEffect } from 'react';
import { Search, Save, Loader2, Bookmark, ExternalLink, X, ChevronDown, ChevronUp, Filter, Building2, Brain, Star, Trash2, CheckCircle2, Download, BarChart2, FolderOpen, List, MoreVertical, Pencil, Clock, Bell, MapPin } from 'lucide-react';
import type { CompanyProfile, BiddingProcess } from '../types';
import { ProcessFormModal } from './ProcessFormModal';
import { AiReportModal } from './AiReportModal';
import { ConfirmDialog, ListPickerPopover, GuidedTour, type TourStep } from './ui';
import { usePncpPage, STATUS_OPTIONS, UFS, MODALIDADES, ESFERAS } from './hooks/usePncpPage';

import { PncpHeader } from './pncp/PncpHeader';
import { PncpSavedSearches } from './pncp/PncpSavedSearches';
import { PncpSearchFilters } from './pncp/PncpSearchFilters';
import { PncpTabsRow } from './pncp/PncpTabsRow';
import { PncpResultsTable } from './pncp/PncpResultsTable';

interface Props {
    companies: CompanyProfile[];
    onRefresh?: () => Promise<void>;
    items?: BiddingProcess[];
    initialContext?: any;
    onContextConsumed?: () => void;
}

export function PncpPage({ companies, onRefresh, items = [], initialContext, onContextConsumed }: Props) {
    const p = usePncpPage({ companies, onRefresh, items, initialContext, onContextConsumed });

    // Refresh data on mount to guarantee we have the latest items (e.g. after deletions in Kanban)
    useEffect(() => {
        if (onRefresh) {
            onRefresh();
        }
    }, [onRefresh]);

    const [tourOpen, setTourOpen] = useState(false);
    useEffect(() => {
        if (!localStorage.getItem('tour_pncp_completed')) {
            setTimeout(() => setTourOpen(true), 1200);
        }
    }, []);

    const pncpSteps: TourStep[] = [
        { target: '[data-tour="pncp-upload"]', title: 'Upload Manual de Editais', content: 'Você não precisa esperar o Scanner encontrar. Faça o upload manual do PDF do Edital aqui e a IA fará o resto.', placement: 'left' },
        { target: '[data-tour="pncp-search-panel"]', title: 'Pesquisas Salvas', content: 'Configure filtros como palavras-chave e Unidades Federativas. O sistema salvará isso e o Robô vigiará 24h por dia para você nessas condições.', placement: 'top' }
    ];

    return (
        <>
        <GuidedTour
            id="pncp"
            isOpen={tourOpen}
            onDismiss={() => { setTourOpen(false); localStorage.setItem('tour_pncp_completed', 'true'); }}
            onComplete={() => { setTourOpen(false); localStorage.setItem('tour_pncp_completed', 'true'); }}
            steps={pncpSteps}
        />
        <div className="page-container" style={{ paddingBottom: '32px' }}>
            <PncpHeader p={p} companies={companies} items={items} />
            <PncpSavedSearches p={p} companies={companies} items={items} />
            <PncpSearchFilters p={p} companies={companies} items={items} />
            <PncpTabsRow p={p} companies={companies} items={items} />
            <PncpResultsTable p={p} companies={companies} items={items} />


            {p.editingProcess && (
                <ProcessFormModal
                    initialData={p.editingProcess as BiddingProcess}
                    companies={companies}
                    onClose={() => {
                        p.setEditingProcess(null);
                        p.setPendingAiAnalysis(null);
                    }}
                    onSave={(data, aiData) => {
                        p.handleSaveProcess(data, aiData);
                    }}
                />
            )}

            {/* AI Report Modal for PNCP Analysis */}
            {p.viewingAnalysisProcess && p.pncpAnalysis && (
                <AiReportModal
                    analysis={p.pncpAnalysis.analysis}
                    process={p.viewingAnalysisProcess}
                    onClose={() => {
                        p.setViewingAnalysisProcess(null);
                        p.setPncpAnalysis(null);
                        p.setAnalyzedPncpItem(null);
                    }}
                    onUpdate={() => { }}
                    onImport={() => {
                        // Close report modal
                        p.setViewingAnalysisProcess(null);
                        // Store the AI analysis for p.saving with the process
                        p.setPendingAiAnalysis(p.pncpAnalysis!.analysis);
                        // Open form pre-filled with AI + PNCP data
                        if (p.analyzedPncpItem) {
                            p.handleImportToFunnel(p.analyzedPncpItem, p.pncpAnalysis!);
                        } else {
                            // Fallback: use AI process data directly  
                            p.setEditingProcess({
                                ...p.pncpAnalysis!.process,
                                portal: 'PNCP',
                                status: 'Captado',
                                companyProfileId: p.selectedSearchCompanyId || (companies.length > 0 ? companies[0].id : ''),
                            });
                        }
                    }}
                />
            )}
        </div>

            {/* ═══ List Picker Popovers ═══ */}
            <ListPickerPopover
                open={p.listPickerOpen}
                onClose={() => { p.setListPickerOpen(false); p.setListPickerItem(null); }}
                title="Adicionar aos Favoritos"
                lists={p.favLists.map(l => ({ id: l.id, name: l.name, count: p.favListItemCount(l.id) }))}
                onSelect={(listId) => {
                    if (p.listPickerItem) {
                        p.addToFavList(p.listPickerItem, listId);
                    }
                    p.setListPickerItem(null);
                }}
                onCreateNew={async (name) => {
                    const newList = await p.createFavList(name);
                    return newList.id;
                }}
            />

            <ListPickerPopover
                open={p.searchListPickerOpen}
                onClose={() => p.setSearchListPickerOpen(false)}
                title="Salvar Pesquisa em..."
                lists={p.searchListNames.map(name => ({ id: name, name, count: p.savedSearches.filter(s => (s.listName || 'Pesquisas Gerais') === name).length }))}
                onSelect={(listName) => {
                    p.handleSaveSearch(listName);
                }}
                onCreateNew={(name) => {
                    // Just return the name — onSelect will be called next with this name
                    return name;
                }}
            />

            <ConfirmDialog
                open={!!p.confirmAction}
                title={
                    p.confirmAction?.type === 'deleteSearch' ? 'Excluir Pesquisa'
                    : p.confirmAction?.type === 'deleteFavList' ? 'Excluir Lista de Favoritos'
                    : p.confirmAction?.type === 'deleteSearchList' ? 'Excluir Lista de Pesquisas'
                    : 'Aviso de Duplicidade'
                }
                message={p.confirmAction?.message || ''}
                variant={['deleteSearch', 'deleteFavList', 'deleteSearchList'].includes(p.confirmAction?.type || '') ? 'danger' : 'warning'}
                confirmLabel={
                    ['deleteFavList', 'deleteSearchList'].includes(p.confirmAction?.type || '')
                        ? 'Excluir e Migrar'
                        : p.confirmAction?.type === 'deleteSearch' ? 'Excluir'
                        : 'Importar Mesmo Assim'
                }
                onConfirm={() => p.confirmAction?.onConfirm()}
                onCancel={() => p.setConfirmAction(null)}
            />
            {/* ═══ Edit Saved Search Modal ═══ */}
            {p.editingSearch && (() => {
                const es = p.editingSearch;
                let parsedStates = { uf: '', modalidade: 'todas', esfera: 'todas', orgao: '', orgaosLista: '', excludeKeywords: '', dataInicio: '', dataFim: '' };
                try { parsedStates = { ...parsedStates, ...JSON.parse(es.states || '{}') }; } catch {}
                return (
                    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
                        onClick={() => p.setEditingSearch(null)}>
                        <div style={{ background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-xl)', padding: 'var(--space-6)', maxWidth: '600px', width: '90%', maxHeight: '85vh', overflow: 'auto', boxShadow: 'var(--shadow-xl)' }}
                            onClick={(e) => e.stopPropagation()}>
                            <h3 style={{ margin: '0 0 var(--space-4)', fontSize: 'var(--text-lg)', fontWeight: 600, color: 'var(--color-text-primary)' }}>Editar Pesquisa Salva</h3>
                            <form onSubmit={async (e) => {
                                e.preventDefault();
                                const fd = new FormData(e.currentTarget);
                                const states = JSON.stringify({
                                    uf: fd.get('uf') || '', modalidade: fd.get('modalidade') || 'todas',
                                    esfera: fd.get('esfera') || 'todas', orgao: fd.get('orgao') || '',
                                    orgaosLista: fd.get('orgaosLista') || '', excludeKeywords: fd.get('excludeKeywords') || '',
                                    dataInicio: fd.get('dataInicio') || '', dataFim: fd.get('dataFim') || '',
                                });
                                const ok = await p.updateSavedSearch(es.id, {
                                    name: fd.get('name') as string,
                                    keywords: fd.get('keywords') as string,
                                    status: fd.get('status') as string,
                                    states,
                                    companyProfileId: fd.get('companyProfileId') as string || '',
                                });
                                if (ok) p.setEditingSearch(null);
                            }} style={{ display: 'grid', gap: 'var(--space-4)' }}>
                                <div>
                                    <label className="form-label">Nome da pesquisa</label>
                                    <input name="name" defaultValue={es.name} className="form-select" required />
                                </div>
                                <div>
                                    <label className="form-label">Palavras-chave (Objeto)</label>
                                    <input name="keywords" defaultValue={es.keywords || ''} className="form-select" />
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
                                    <div>
                                        <label className="form-label">Status</label>
                                        <select name="status" defaultValue={es.status || 'recebendo_proposta'} className="form-select">
                                            {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="form-label">Estado (UF)</label>
                                        <select name="uf" defaultValue={parsedStates.uf} className="form-select">
                                            <option value="">Todos</option>
                                            {UFS.map(uf => <option key={uf} value={uf}>{uf}</option>)}
                                        </select>
                                    </div>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
                                    <div>
                                        <label className="form-label">Modalidade</label>
                                        <select name="modalidade" defaultValue={parsedStates.modalidade} className="form-select">
                                            {MODALIDADES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="form-label">Esfera de Governo</label>
                                        <select name="esfera" defaultValue={parsedStates.esfera} className="form-select">
                                            {ESFERAS.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
                                        </select>
                                    </div>
                                </div>
                                <div>
                                    <label className="form-label">Órgão específico</label>
                                    <input name="orgao" defaultValue={parsedStates.orgao} className="form-select" placeholder="Nome do órgão" />
                                </div>
                                <div>
                                    <label className="form-label">Lista de órgãos (separados por vírgula)</label>
                                    <input name="orgaosLista" defaultValue={parsedStates.orgaosLista} className="form-select" placeholder="Ex.: Prefeitura X, Secretaria Y" />
                                </div>
                                <div>
                                    <label className="form-label" style={{ color: 'var(--color-danger)' }}>🚫 Excluir palavras-chave do objeto</label>
                                    <input name="excludeKeywords" defaultValue={parsedStates.excludeKeywords} className="form-select" placeholder="Ex.: aquisição, materiais, fornecimento" style={{ borderColor: parsedStates.excludeKeywords ? 'var(--color-danger)' : undefined }} />
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
                                    <div>
                                        <label className="form-label">Publicado a partir de</label>
                                        <input type="date" name="dataInicio" defaultValue={parsedStates.dataInicio} className="form-select" />
                                    </div>
                                    <div>
                                        <label className="form-label">Publicado até</label>
                                        <input type="date" name="dataFim" defaultValue={parsedStates.dataFim} className="form-select" />
                                    </div>
                                </div>
                                <div>
                                    <label className="form-label">Empresa vinculada</label>
                                    <select name="companyProfileId" defaultValue={es.companyProfileId || ''} className="form-select">
                                        <option value="">Nenhuma</option>
                                        {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                    </select>
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)', paddingTop: 'var(--space-2)' }}>
                                    <button type="button" className="btn btn-secondary" onClick={() => p.setEditingSearch(null)}>Cancelar</button>
                                    <button type="submit" className="btn btn-primary"><Save size={14} /> Salvar Alterações</button>
                                </div>
                            </form>
                        </div>
                    </div>
                );
            })()}

        </>
    );
}
