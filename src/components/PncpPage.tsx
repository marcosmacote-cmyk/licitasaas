import React, { useState } from 'react';
import { Search, Save, Loader2, Bookmark, ExternalLink, Plus, X, ChevronDown, ChevronUp, Filter, Building2, Brain, Star, Trash2, CheckCircle2, Download, BarChart2, FolderOpen, List, MoreVertical, Pencil } from 'lucide-react';
import type { CompanyProfile, BiddingProcess } from '../types';
import { ProcessFormModal } from './ProcessFormModal';
import { AiReportModal } from './AiReportModal';
import { ConfirmDialog, ListPickerPopover } from './ui';
import { usePncpPage, UFS, ESFERAS, MODALIDADES, STATUS_OPTIONS } from './hooks/usePncpPage';
import { normalizeModality } from '../utils/normalizeModality';

interface Props {
    companies: CompanyProfile[];
    onRefresh?: () => Promise<void>;
    items?: BiddingProcess[];
}

export function PncpPage({ companies, onRefresh, items = [] }: Props) {
    const p = usePncpPage({ companies, onRefresh, items });
    const [favListMenu, setFavListMenu] = useState<string | null>(null);
    const [searchListMenu, setSearchListMenu] = useState<string | null>(null);
    const [searchChipMenu, setSearchChipMenu] = useState<string | null>(null);

    return (
        <>
        <div className="page-container" style={{ paddingBottom: '32px' }}>
            {/* Page Header */}
            <div className="page-header" style={{ marginBottom: 'var(--space-6)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 'var(--space-4)' }}>
                <div>
                    <h1 className="page-title">Busca PNCP</h1>
                    <p className="page-subtitle">Pesquise editais diretamente no Portal Nacional de Contratações Públicas.</p>
                </div>
                {/* ── Dashboard Indicators ── */}
                <div style={{ display: 'flex', gap: 'var(--space-3)', overflowX: 'auto', paddingBottom: '4px' }}>
                    <div className="indicator-card">
                        <div className="indicator-label"><BarChart2 size={12} /> Descobertos</div>
                        <div className="indicator-value">{(p.totalResults || 0).toLocaleString('pt-BR')}</div>
                    </div>
                    <div className="indicator-card">
                        <div className="indicator-label"><Bookmark size={12} /> No Funil</div>
                        <div className="indicator-value" style={{ color: 'var(--color-primary)' }}>{items?.length || 0}</div>
                    </div>
                    <div className="indicator-card">
                        <div className="indicator-label"><Star size={12} /> Favoritos</div>
                        <div className="indicator-value" style={{ color: 'var(--color-warning)' }}>{p.favoritos.length}</div>
                    </div>
                </div>
            </div>

            {/* ═══ Saved Searches — Multi-list ═══ */}
            {p.savedSearches.length > 0 && (
                <div style={{ marginBottom: 'var(--space-5)' }}>
                    {/* List filter tabs */}
                    {p.searchListNames.length > 1 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)', flexWrap: 'wrap' }}>
                            <List size={14} style={{ color: 'var(--color-text-tertiary)' }} />
                            {p.searchListNames.map(name => (
                                <div key={name} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                                    <button
                                        onClick={() => p.setActiveSearchListName(p.activeSearchListName === name ? null : name)}
                                        style={{
                                            padding: '3px 10px', borderRadius: 'var(--radius-lg)',
                                            border: p.activeSearchListName === name ? '1px solid var(--color-primary)' : '1px solid var(--color-border)',
                                            background: p.activeSearchListName === name ? 'rgba(37, 99, 235, 0.08)' : 'transparent',
                                            color: p.activeSearchListName === name ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                                            fontSize: 'var(--text-sm)', fontWeight: 500, cursor: 'pointer',
                                            transition: 'var(--transition-fast)',
                                            paddingRight: name !== 'Pesquisas Gerais' ? '24px' : '10px',
                                        }}
                                    >{name}</button>
                                    {name !== 'Pesquisas Gerais' && (
                                        <button
                                            onClick={(e) => { e.stopPropagation(); setSearchListMenu(searchListMenu === name ? null : name); }}
                                            style={{
                                                position: 'absolute', right: '2px', top: '50%', transform: 'translateY(-50%)',
                                                background: 'none', border: 'none', cursor: 'pointer',
                                                color: 'var(--color-text-tertiary)', padding: '2px',
                                                opacity: 0.5, transition: 'var(--transition-fast)',
                                            }}
                                            onMouseEnter={(e: any) => e.currentTarget.style.opacity = '1'}
                                            onMouseLeave={(e: any) => e.currentTarget.style.opacity = '0.5'}
                                        >
                                            <MoreVertical size={12} />
                                        </button>
                                    )}
                                    {searchListMenu === name && (
                                        <div
                                            style={{
                                                position: 'absolute', top: '100%', right: 0, zIndex: 100,
                                                background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)',
                                                borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)',
                                                minWidth: '150px', overflow: 'hidden', marginTop: '4px',
                                            }}
                                            onMouseLeave={() => setSearchListMenu(null)}
                                        >
                                            <button
                                                onClick={() => {
                                                    setSearchListMenu(null);
                                                    const newName = prompt(`Renomear lista "${name}":`, name);
                                                    if (newName) p.renameSearchList(name, newName);
                                                }}
                                                style={{
                                                    display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                                                    width: '100%', padding: '8px 12px', background: 'none', border: 'none',
                                                    cursor: 'pointer', fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)',
                                                    textAlign: 'left', transition: 'var(--transition-fast)',
                                                }}
                                                onMouseEnter={(e: any) => e.currentTarget.style.background = 'var(--color-bg-base)'}
                                                onMouseLeave={(e: any) => e.currentTarget.style.background = 'none'}
                                            >
                                                <Pencil size={13} /> Renomear
                                            </button>
                                            <button
                                                onClick={() => { setSearchListMenu(null); p.deleteSearchList(name); }}
                                                style={{
                                                    display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                                                    width: '100%', padding: '8px 12px', background: 'none', border: 'none',
                                                    cursor: 'pointer', fontSize: 'var(--text-sm)', color: 'var(--color-danger)',
                                                    textAlign: 'left', transition: 'var(--transition-fast)',
                                                }}
                                                onMouseEnter={(e: any) => e.currentTarget.style.background = 'var(--color-bg-base)'}
                                                onMouseLeave={(e: any) => e.currentTarget.style.background = 'none'}
                                            >
                                                <Trash2 size={13} /> Excluir
                                            </button>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Search chips */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', width: '100%', justifyContent: 'space-between', borderBottom: '1px solid var(--color-border)', paddingBottom: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                                <span style={{ fontSize: 'var(--text-md)', color: 'var(--color-text-tertiary)', fontWeight: 'var(--font-semibold)' as any, whiteSpace: 'nowrap' }}>
                                    <Bookmark size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                                    Pesquisas Salvas
                                </span>
                            </div>
                            
                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', background: 'var(--color-bg-surface)', padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }}>
                                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)', lineHeight: '1.4', maxWidth: '300px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                                        <div style={{ width: 8, height: 8, borderRadius: '50%', background: p.opportunityScannerEnabled ? '#10b981' : '#9ca3af', boxShadow: p.opportunityScannerEnabled ? '0 0 8px rgba(16, 185, 129, 0.4)' : 'none' }} />
                                        <strong style={{ color: 'var(--color-text-primary)' }}>
                                            {p.opportunityScannerEnabled ? 'Notificações Ativas' : 'Notificações Inativas'}
                                        </strong>
                                    </div>
                                    <div style={{ marginTop: '2px' }}>
                                        {p.opportunityScannerEnabled ? (
                                            <>Monitoramento a cada 4 horas com alertas via <strong>WhatsApp, Telegram e E-mail</strong> das pesquisas abaixo.</>
                                        ) : (
                                            <>Ative para receber alertas automáticos via WhatsApp, Telegram e E-mail.</>
                                        )}
                                    </div>
                                </div>

                                <div style={{ height: '32px', width: '1px', background: 'var(--color-border)', margin: '0 var(--space-1)' }} />

                                <button 
                                    onClick={() => p.toggleOpportunityScanner(!p.opportunityScannerEnabled)}
                                    className="btn btn-outline"
                                    style={{
                                        padding: '6px 14px', fontSize: '0.8125rem', gap: '6px',
                                        borderRadius: 'var(--radius-md)', 
                                        color: p.opportunityScannerEnabled ? 'var(--color-danger)' : 'var(--color-primary)', 
                                        borderColor: p.opportunityScannerEnabled ? 'var(--color-danger-border, var(--color-danger))' : 'var(--color-primary)'
                                    }}
                                >
                                    {p.opportunityScannerEnabled ? 'Desativar Alertas' : 'Habilitar Notificação'}
                                </button>
                                
                                <button 
                                    onClick={p.handleTriggerScan}
                                    className="btn btn-ghost"
                                    style={{
                                        padding: '6px', borderRadius: 'var(--radius-md)', color: 'var(--color-text-secondary)',
                                        cursor: p.loading ? 'wait' : 'pointer'
                                    }}
                                    title="Forçar busca manual agora"
                                    disabled={p.loading}
                                >
                                    {p.loading ? <Loader2 size={16} className="spinner" /> : <Search size={16} />} 
                                </button>
                            </div>
                        </div>
                        {p.filteredSavedSearches.length === 0 && (
                            <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-tertiary)', padding: 'var(--space-2) 0', fontStyle: 'italic' }}>
                                Nenhuma pesquisa salva nesta lista. Crie uma pesquisa abaixo e clique em "Salvar Pesquisa".
                            </div>
                        )}
                        {p.filteredSavedSearches.map(s => (
                            <div
                                key={s.id}
                                style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}
                            >
                                <div
                                    onClick={() => p.loadSavedSearch(s)}
                                    style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: 'var(--space-2)',
                                        padding: 'var(--space-2) var(--space-4)',
                                        paddingRight: '28px',
                                        background: 'var(--color-bg-surface)',
                                        border: '1px solid var(--color-border)',
                                        borderRadius: 'var(--radius-xl)',
                                        fontSize: 'var(--text-md)',
                                        color: 'var(--color-text-primary)',
                                        cursor: 'pointer',
                                        transition: 'var(--transition-fast)',
                                        fontWeight: 'var(--font-medium)' as any,
                                    }}
                                    onMouseEnter={(e: any) => { e.currentTarget.style.borderColor = 'var(--color-primary)'; e.currentTarget.style.background = 'rgba(37, 99, 235, 0.06)'; }}
                                    onMouseLeave={(e: any) => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.background = 'var(--color-bg-surface)'; }}
                                >
                                    {s.name}
                                    {s.listName && s.listName !== 'Pesquisas Gerais' && (
                                        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)', opacity: 0.7 }}>
                                            ({s.listName})
                                        </span>
                                    )}
                                    {s.companyProfileId && <Building2 size={12} color="var(--color-primary)" />}
                                </div>
                                <button
                                    onClick={(e) => { e.stopPropagation(); setSearchChipMenu(searchChipMenu === s.id ? null : s.id); }}
                                    style={{
                                        position: 'absolute', right: '6px', top: '50%', transform: 'translateY(-50%)',
                                        background: 'none', border: 'none', cursor: 'pointer',
                                        color: 'var(--color-text-tertiary)', padding: '2px',
                                        opacity: 0.5, transition: 'var(--transition-fast)',
                                    }}
                                    onMouseEnter={(e: any) => e.currentTarget.style.opacity = '1'}
                                    onMouseLeave={(e: any) => e.currentTarget.style.opacity = '0.5'}
                                >
                                    <MoreVertical size={13} />
                                </button>
                                {searchChipMenu === s.id && (
                                    <div
                                        style={{
                                            position: 'absolute', top: '100%', right: 0, zIndex: 100,
                                            background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)',
                                            borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)',
                                            minWidth: '170px', overflow: 'hidden', marginTop: '4px',
                                        }}
                                        onMouseLeave={() => setSearchChipMenu(null)}
                                    >
                                        <button
                                            onClick={() => {
                                                setSearchChipMenu(null);
                                                const newName = prompt(`Renomear pesquisa "${s.name}":`, s.name);
                                                if (newName && newName.trim()) p.updateSavedSearch(s.id, { name: newName.trim() });
                                            }}
                                            style={{
                                                display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                                                width: '100%', padding: '8px 12px', background: 'none', border: 'none',
                                                cursor: 'pointer', fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)',
                                                textAlign: 'left', transition: 'var(--transition-fast)',
                                            }}
                                            onMouseEnter={(e: any) => e.currentTarget.style.background = 'var(--color-bg-base)'}
                                            onMouseLeave={(e: any) => e.currentTarget.style.background = 'none'}
                                        >
                                            <Pencil size={13} /> Renomear
                                        </button>
                                        <button
                                            onClick={() => { setSearchChipMenu(null); p.setEditingSearch(s); }}
                                            style={{
                                                display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                                                width: '100%', padding: '8px 12px', background: 'none', border: 'none',
                                                cursor: 'pointer', fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)',
                                                textAlign: 'left', transition: 'var(--transition-fast)',
                                            }}
                                            onMouseEnter={(e: any) => e.currentTarget.style.background = 'var(--color-bg-base)'}
                                            onMouseLeave={(e: any) => e.currentTarget.style.background = 'none'}
                                        >
                                            <Filter size={13} /> Editar Filtros
                                        </button>
                                        <button
                                            onClick={() => { setSearchChipMenu(null); p.deleteSavedSearch(s.id); }}
                                            style={{
                                                display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                                                width: '100%', padding: '8px 12px', background: 'none', border: 'none',
                                                cursor: 'pointer', fontSize: 'var(--text-sm)', color: 'var(--color-danger)',
                                                textAlign: 'left', transition: 'var(--transition-fast)',
                                            }}
                                            onMouseEnter={(e: any) => e.currentTarget.style.background = 'var(--color-bg-base)'}
                                            onMouseLeave={(e: any) => e.currentTarget.style.background = 'none'}
                                        >
                                            <Trash2 size={13} /> Excluir
                                        </button>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Search Card */}
            <div className="card" style={{ padding: 'var(--space-6)', marginBottom: 'var(--space-6)', background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-xl)', border: 'none', boxShadow: 'var(--shadow-md), 0 0 0 1px var(--color-border)' }}>
                <form onSubmit={p.handleSearch}>
                    {/* Main Search Row */}
                    <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'end', flexWrap: 'wrap' }}>
                        <div style={{ flex: 2, minWidth: '280px' }}>
                            <label className="form-label">Palavras-chave (Objeto)</label>
                            <div className="pos-relative">
                                <Search size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-tertiary)' }} />
                                <input
                                    type="text"
                                    placeholder="Ex: Serviços de TI, Transporte Escolar (Use vírgulas para buscar vários ao mesmo tempo)"
                                    value={p.keywords}
                                    onChange={(e) => p.setKeywords(e.target.value)}
                                    style={{
                                        paddingLeft: '44px',
                                        paddingTop: '12px',
                                        paddingBottom: '12px',
                                        fontSize: '0.9375rem',
                                        height: '48px',
                                        borderRadius: 'var(--radius-lg)'
                                    }}
                                    className="form-select"
                                />
                            </div>
                        </div>

                        <div style={{ flex: 1, minWidth: '180px' }}>
                            <label className="form-label">Status</label>
                            <select value={p.status} onChange={(e) => p.setStatus(e.target.value)} className="form-select" style={{ height: '48px', borderRadius: 'var(--radius-lg)' }}>
                                {STATUS_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                            </select>
                        </div>

                        <div style={{ minWidth: '120px' }}>
                            <label className="form-label">Estado (UF)</label>
                            <select value={p.selectedUf} onChange={(e) => p.setSelectedUf(e.target.value)} className="form-select" style={{ height: '48px', borderRadius: 'var(--radius-lg)' }}>
                                <option value="">Brasil (Todas as UFs)</option>
                                <optgroup label="Agrupamento por Região">
                                    <option value="AC,AP,AM,PA,RO,RR,TO">Região Norte</option>
                                    <option value="AL,BA,CE,MA,PB,PE,PI,RN,SE">Região Nordeste</option>
                                    <option value="DF,GO,MT,MS">Região Centro-Oeste</option>
                                    <option value="ES,MG,RJ,SP">Região Sudeste</option>
                                    <option value="PR,RS,SC">Região Sul</option>
                                </optgroup>
                                <optgroup label="Estados Específicos">
                                    {UFS.map(uf => <option key={uf} value={uf}>{uf}</option>)}
                                </optgroup>
                            </select>
                        </div>

                        <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'end' }}>
                            <button type="submit" className="btn btn-primary" disabled={p.loading} style={{ padding: '0 var(--space-6)', borderRadius: 'var(--radius-lg)', gap: 'var(--space-2)', fontSize: '0.9375rem', fontWeight: 'var(--font-semibold)' as any, height: '48px' }}>
                                {p.loading ? <Loader2 size={18} className="spinner" /> : <Search size={18} />}
                                Buscar
                            </button>
                        </div>
                    </div>

                    {/* Action Buttons Row */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'var(--space-4)', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
                        <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
                            <button
                                type="button"
                                onClick={() => p.setShowAdvancedFilters(!p.showAdvancedFilters)}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                                    fontSize: 'var(--text-md)', fontWeight: 'var(--font-semibold)' as any,
                                    color: p.showAdvancedFilters ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                                    background: 'none', border: 'none', cursor: 'pointer', padding: '6px 0',
                                }}
                            >
                                <Filter size={15} />
                                Filtros Avançados
                                {p.activeFilterCount > 0 && (
                                    <span style={{
                                        background: 'var(--color-primary)', color: 'white', borderRadius: 'var(--radius-lg)',
                                        padding: '1px var(--space-2)', fontSize: 'var(--text-sm)', fontWeight: 'var(--font-bold)' as any,
                                    }}>{p.activeFilterCount}</span>
                                )}
                                {p.showAdvancedFilters ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            </button>
                        </div>

                        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                            <button type="button" className="btn btn-ghost" onClick={p.clearSearch} style={{ padding: '6px 12px', fontSize: '0.8125rem', gap: '4px' }}>
                                <X size={14} /> Limpar
                            </button>
                            <button type="button" className="btn btn-outline" onClick={p.startSaveSearch} disabled={p.saving} style={{ padding: '6px 12px', fontSize: '0.8125rem', gap: '4px' }}>
                                {p.saving ? <Loader2 size={14} className="spinner" /> : <Save size={14} />} Salvar Pesquisa
                            </button>
                        </div>
                    </div>

                    {/* Advanced Filters (Collapsible) */}
                    {p.showAdvancedFilters && (
                        <div style={{
                            marginTop: 'var(--space-4)',
                            padding: 'var(--space-5)',
                            background: 'var(--color-bg-base)',
                            borderRadius: 'var(--radius-md)',
                            border: '1px solid var(--color-border)',
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                            gap: 'var(--space-4)',
                            animation: 'slideDown 0.2s ease-out',
                        }}>
                            <div>
                                <label className="form-label">Modalidade</label>
                                <select value={p.modalidade} onChange={(e) => p.setModalidade(e.target.value)} className="form-select">
                                    {MODALIDADES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                                </select>
                            </div>

                            <div>
                                <label className="form-label">Esfera de Governo</label>
                                <select value={p.esfera} onChange={(e) => p.setEsfera(e.target.value)} className="form-select">
                                    {ESFERAS.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
                                </select>
                            </div>

                            <div>
                                <label className="form-label">Órgão (Nome ou CNPJ)</label>
                                <input type="text" placeholder="Ex: Comando da Marinha" value={p.orgao} onChange={(e) => p.setOrgao(e.target.value)} className="form-select" />
                            </div>

                            <div className="col-span-full">
                                <label className="form-label">Lista de Nomes ou CNPJs de Órgãos (Busca Múltipla Rápida)</label>
                                <textarea
                                    placeholder="Cole aqui a lista de nomes de prefeituras/órgãos ou seus CNPJs que deseja buscar de uma vez, separados por vírgula ou quebra de linha... (Vai cruzar tudo numa lista só de uma vez!)"
                                    value={p.orgaosLista}
                                    onChange={(e) => p.setOrgaosLista(e.target.value)}
                                    style={{
                                        minHeight: '60px',
                                        resize: 'vertical',
                                        fontFamily: 'monospace',
                                        fontSize: '0.8125rem'
                                    }}
                                    className="form-select"
                                />
                                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)', marginTop: '4px' }}>
                                    Pode misturar exato (CNPJ com ou sem pontuação) ou nomes aproximados (ex: Prefeitura Municipal de Limoeiro do Norte).
                                </div>
                            </div>

                            <div className="col-span-full">
                                <label className="form-label" style={{ color: 'var(--color-danger)' }}>🚫 Excluir palavras-chave do objeto</label>
                                <input
                                    type="text"
                                    placeholder="Ex.: aquisição, materiais, fornecimento, luminária (separe por vírgula)"
                                    value={p.excludeKeywords}
                                    onChange={(e) => p.setExcludeKeywords(e.target.value)}
                                    className="form-select"
                                    style={{
                                        borderColor: p.excludeKeywords.trim() ? 'var(--color-danger)' : undefined,
                                        fontSize: '0.8125rem',
                                    }}
                                />
                                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)', marginTop: '4px' }}>
                                    Resultados cujo objeto contenha qualquer destes termos serão removidos da listagem.
                                </div>
                            </div>

                            <div>
                                <label className="form-label">Publicado a partir de</label>
                                <input type="date" value={p.dataInicio} onChange={(e) => p.setDataInicio(e.target.value)} className="form-select" />
                            </div>

                            <div>
                                <label className="form-label">Publicado até</label>
                                <input type="date" value={p.dataFim} onChange={(e) => p.setDataFim(e.target.value)} className="form-select" />
                            </div>

                            <div>
                                <label className="form-label">Vincular à Empresa</label>
                                <select value={p.selectedSearchCompanyId} onChange={(e) => p.setSelectedSearchCompanyId(e.target.value)} className="form-select">
                                    <option value="">(Nenhuma empresa)</option>
                                    {companies.map(c => <option key={c.id} value={c.id}>{c.razaoSocial}</option>)}
                                </select>
                            </div>
                        </div>
                    )}
                </form>
            </div>

            {/* Results Summary and Tabs */}
            <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                marginBottom: 'var(--space-4)', padding: '0 4px', borderBottom: '1px solid var(--color-border)', paddingBottom: '0'
            }}>
                <div style={{ display: 'flex', gap: 'var(--space-6)' }}>
                    <button
                        onClick={() => p.setShowFavoritosTab(false)}
                        className={`tab-btn${!p.showFavoritosTab ? ' active' : ''}`}
                    >
                        Resultados da Busca {p.results.length > 0 && `(${p.totalResults || p.results.length})`}
                    </button>
                    <button
                        onClick={() => p.setShowFavoritosTab(true)}
                        className={`tab-btn${p.showFavoritosTab ? ' active-warning' : ''}`}
                        style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}
                    >
                        <Star size={16} fill={p.showFavoritosTab ? "currentColor" : "none"} color={p.showFavoritosTab ? "currentColor" : "currentColor"} />
                        Favoritos {p.favoritos.length > 0 && `(${p.favoritos.length})`}
                    </button>
                </div>
            </div>

            {/* ═══ Favorites List Filter (only when on Favoritos tab) ═══ */}
            {p.showFavoritosTab && p.favLists.length > 1 && (
                <div style={{
                    display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                    marginBottom: 'var(--space-4)', marginTop: 'var(--space-3)',
                    flexWrap: 'wrap',
                }}>
                    <FolderOpen size={14} style={{ color: 'var(--color-text-tertiary)' }} />
                    {p.favLists.map(list => (
                        <div key={list.id} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                            <button
                                onClick={() => p.setActiveFavListId(p.activeFavListId === list.id ? null : list.id)}
                                style={{
                                    padding: '4px 12px', borderRadius: 'var(--radius-lg)',
                                    border: p.activeFavListId === list.id ? '1px solid var(--color-warning)' : '1px solid var(--color-border)',
                                    background: p.activeFavListId === list.id ? 'rgba(245, 158, 11, 0.08)' : 'transparent',
                                    color: p.activeFavListId === list.id ? 'var(--color-warning)' : 'var(--color-text-secondary)',
                                    fontSize: 'var(--text-sm)', fontWeight: 500, cursor: 'pointer',
                                    transition: 'var(--transition-fast)',
                                    paddingRight: list.id !== 'default' ? '24px' : '12px',
                                }}
                            >{list.name} ({p.favListItemCount(list.id)})</button>
                            {list.id !== 'default' && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); setFavListMenu(favListMenu === list.id ? null : list.id); }}
                                    style={{
                                        position: 'absolute', right: '2px', top: '50%', transform: 'translateY(-50%)',
                                        background: 'none', border: 'none', cursor: 'pointer',
                                        color: 'var(--color-text-tertiary)', padding: '2px',
                                        opacity: 0.5, transition: 'var(--transition-fast)',
                                    }}
                                    onMouseEnter={(e: any) => e.currentTarget.style.opacity = '1'}
                                    onMouseLeave={(e: any) => e.currentTarget.style.opacity = '0.5'}
                                >
                                    <MoreVertical size={12} />
                                </button>
                            )}
                            {favListMenu === list.id && (
                                <div
                                    style={{
                                        position: 'absolute', top: '100%', right: 0, zIndex: 100,
                                        background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)',
                                        borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)',
                                        minWidth: '150px', overflow: 'hidden', marginTop: '4px',
                                    }}
                                    onMouseLeave={() => setFavListMenu(null)}
                                >
                                    <button
                                        onClick={() => {
                                            setFavListMenu(null);
                                            const newName = prompt(`Renomear lista "${list.name}":`, list.name);
                                            if (newName) p.renameFavList(list.id, newName);
                                        }}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                                            width: '100%', padding: '8px 12px', background: 'none', border: 'none',
                                            cursor: 'pointer', fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)',
                                            textAlign: 'left', transition: 'var(--transition-fast)',
                                        }}
                                        onMouseEnter={(e: any) => e.currentTarget.style.background = 'var(--color-bg-base)'}
                                        onMouseLeave={(e: any) => e.currentTarget.style.background = 'none'}
                                    >
                                        <Pencil size={13} /> Renomear
                                    </button>
                                    <button
                                        onClick={() => { setFavListMenu(null); p.deleteFavList(list.id); }}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                                            width: '100%', padding: '8px 12px', background: 'none', border: 'none',
                                            cursor: 'pointer', fontSize: 'var(--text-sm)', color: 'var(--color-danger)',
                                            textAlign: 'left', transition: 'var(--transition-fast)',
                                        }}
                                        onMouseEnter={(e: any) => e.currentTarget.style.background = 'var(--color-bg-base)'}
                                        onMouseLeave={(e: any) => e.currentTarget.style.background = 'none'}
                                    >
                                        <Trash2 size={13} /> Excluir
                                    </button>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* Results Table Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 'var(--space-4)', marginTop: 'var(--space-8)' }}>
                <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--font-semibold)' as any, color: 'var(--color-text-primary)', margin: 0 }}>
                    {p.showFavoritosTab
                        ? (p.activeFavListId
                            ? p.favLists.find(l => l.id === p.activeFavListId)?.name || 'Favoritos'
                            : 'Todas as Listas de Favoritos')
                        : 'Resultados da Pesquisa'}
                </h3>
                {p.showFavoritosTab && p.favoritos.length > 0 && (
                    <button className="btn btn-primary" onClick={p.exportFavoritesToPdf} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-2) var(--space-4)' }}>
                        <Download size={16} /> Exportar Relatório PDF
                    </button>
                )}
            </div>

            {/* Results Table */}
            <div style={{ background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-xl)', border: 'none', boxShadow: 'var(--shadow-sm), 0 0 0 1px var(--color-border)', overflow: 'hidden' }}>
                <table className="table" style={{ width: '100%' }}>
                    <thead>
                        <tr>
                            <th style={{ paddingLeft: '24px', width: '22%' }}>Órgão / Localidade</th>
                            <th style={{ width: '35%' }}>Objeto</th>
                            <th>Modalidade</th>
                            <th>Prazo Limite</th>
                            <th>Valor Est.</th>
                            <th style={{ paddingRight: '24px' }}>Ações</th>
                        </tr>
                    </thead>
                    <tbody>
                        {p.loading ? (
                            <tr>
                                <td colSpan={6} style={{ textAlign: 'center', padding: '60px' }}>
                                    <Loader2 size={32} className="spinner" style={{ margin: '0 auto', color: 'var(--color-primary)' }} />
                                    <div style={{ marginTop: '12px', color: 'var(--color-text-tertiary)', fontSize: '0.875rem' }}>Consultando PNCP...</div>
                                </td>
                            </tr>
                        ) : p.displayItems.length === 0 ? (
                            <tr>
                                <td colSpan={6} style={{ textAlign: 'center', padding: '60px', color: 'var(--color-text-tertiary)' }}>
                                    {p.showFavoritosTab ? <Star size={40} style={{ margin: '0 auto 12px', opacity: 0.3 }} /> : <Search size={40} style={{ margin: '0 auto 12px', opacity: 0.3 }} />}
                                    <div style={{ fontSize: '1rem', fontWeight: 500 }}>{p.showFavoritosTab ? 'Nenhum edital nos favoritos' : 'Nenhum edital encontrado'}</div>
                                    <div style={{ fontSize: '0.8125rem', marginTop: '4px' }}>{p.showFavoritosTab ? 'Clique na estrela para favoritar resultados.' : 'Tente ajustar as palavras-chave ou filtros.'}</div>
                                </td>
                            </tr>
                        ) : (
                            p.displayItems.map((item) => {
                                const isFavorito = p.favoritos.some(f => f.id === item.id);
                                const isOnKanban = items.some(p => p.link && p.link === item.link_sistema);

                                return (
                                    <React.Fragment key={item.id}>
                                    <tr style={{ transition: 'background 0.15s' }}
                                        onMouseEnter={(e: any) => e.currentTarget.style.background = 'var(--color-bg-base)'}
                                        onMouseLeave={(e: any) => e.currentTarget.style.background = 'transparent'}
                                    >
                                        <td style={{ paddingLeft: '24px', verticalAlign: 'top', paddingTop: '16px', paddingBottom: '16px' }}>
                                            <div style={{ fontWeight: 600, fontSize: '0.8125rem', lineHeight: '1.4' }}>{item.orgao_nome}</div>
                                            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)', marginTop: '4px' }}>
                                                📍 {item.municipio} - {item.uf}
                                            </div>
                                        </td>
                                        <td style={{ verticalAlign: 'top', paddingTop: '16px', paddingBottom: '16px' }}>
                                            <div style={{ fontWeight: 600, fontSize: '0.8125rem', marginBottom: '4px', lineHeight: '1.3' }}>
                                                {item.titulo}
                                                {p.showFavoritosTab && isOnKanban && (
                                                    <span style={{
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        gap: '4px',
                                                        marginLeft: 'var(--space-2)',
                                                        padding: '3px var(--space-2)',
                                                        background: 'var(--color-success-bg)',
                                                        color: 'var(--color-success)',
                                                        borderRadius: 'var(--radius-lg)',
                                                        fontSize: 'var(--text-sm)',
                                                        fontWeight: 'var(--font-bold)' as any,
                                                        verticalAlign: 'middle'
                                                    }} title="Esta licitação já foi captada para o Kanban.">
                                                        <CheckCircle2 size={12} />
                                                        Salvo no Kanban
                                                    </span>
                                                )}
                                            </div>
                                            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', lineHeight: '1.4' }}>
                                                {item.objeto}
                                            </div>
                                        </td>
                                        <td style={{ verticalAlign: 'top', paddingTop: '16px', whiteSpace: 'nowrap' }}>
                                            {item.modalidade_nome ? (
                                                <span style={{
                                                    display: 'inline-block',
                                                    padding: '3px var(--space-3)',
                                                    borderRadius: 'var(--radius-sm)',
                                                    background: 'var(--color-primary-light)',
                                                    color: 'var(--color-primary)',
                                                    fontSize: 'var(--text-sm)',
                                                    fontWeight: 'var(--font-semibold)' as any,
                                                }}>{ normalizeModality(item.modalidade_nome) }</span>
                                            ) : (
                                                <span style={{ color: 'var(--color-text-tertiary)', fontSize: '0.75rem' }}>—</span>
                                            )}
                                        </td>
                                        {/* Prazo Limite (data fim de recebimento de propostas) */}
                                        <td style={{ whiteSpace: 'nowrap', verticalAlign: 'top', paddingTop: '16px' }}>
                                            {item.data_encerramento_proposta ? (
                                                <>
                                                    <div style={{ fontWeight: 700, fontSize: '0.8125rem', color: new Date(item.data_encerramento_proposta) > new Date() ? 'var(--color-danger)' : 'var(--color-text-secondary)' }}>
                                                        {new Date(item.data_encerramento_proposta).toLocaleDateString('pt-BR')}
                                                    </div>
                                                    <div style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)' }}>
                                                        {new Date(item.data_encerramento_proposta).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                                    </div>
                                                </>
                                            ) : (
                                                <span style={{ color: 'var(--color-text-tertiary)', fontSize: '0.75rem' }}>—</span>
                                            )}
                                        </td>
                                        <td style={{ fontWeight: 700, verticalAlign: 'top', paddingTop: '16px', whiteSpace: 'nowrap' }}>
                                            {item.valor_estimado ? (
                                                <span style={{ color: 'var(--color-success)' }}>
                                                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.valor_estimado)}
                                                </span>
                                            ) : (
                                                <span style={{ color: 'var(--color-text-tertiary)', fontSize: '0.8125rem' }}>N/D</span>
                                            )}
                                        </td>
                                        <td style={{ paddingRight: '24px', verticalAlign: 'top', paddingTop: '14px' }}>
                                            <div style={{ display: 'flex', gap: '6px' }}>
                                                <button
                                                    className="btn btn-ghost"
                                                    onClick={() => p.toggleFavorito(item)}
                                                    style={{ padding: '7px', borderRadius: 'var(--radius-md)', color: isFavorito ? 'var(--color-warning)' : 'var(--color-text-tertiary)', background: isFavorito ? 'var(--color-warning-bg)' : 'transparent' }}
                                                    title={isFavorito ? "Remover dos Favoritos" : "Adicionar aos Favoritos"}
                                                >
                                                    <Star size={15} fill={isFavorito ? "currentColor" : "none"} />
                                                </button>
                                                {isFavorito && (
                                                    <button
                                                        className="btn btn-ghost"
                                                        onClick={() => p.toggleFavorito(item)}
                                                        style={{ padding: '7px', borderRadius: 'var(--radius-md)', color: 'var(--color-danger)', background: 'var(--color-danger-bg)' }}
                                                        title="Excluir dos Favoritos"
                                                    >
                                                        <Trash2 size={15} />
                                                    </button>
                                                )}
                                                <button
                                                    className="btn btn-primary"
                                                    style={{ padding: '7px var(--space-3)', fontSize: 'var(--text-sm)', borderRadius: 'var(--radius-md)', gap: '4px', whiteSpace: 'nowrap' }}
                                                    onClick={() => p.handleImportToFunnel(item)}
                                                    title="Importar para o Funil de Licitações"
                                                >
                                                    <Plus size={14} /> Importar
                                                </button>
                                                <button
                                                    className="btn"
                                                    style={{
                                                        padding: '7px var(--space-3)',
                                                        fontSize: 'var(--text-sm)',
                                                        borderRadius: 'var(--radius-md)',
                                                        gap: '4px',
                                                        whiteSpace: 'nowrap',
                                                        background: p.analyzingItemId === item.id ? 'linear-gradient(135deg, var(--color-ai), var(--color-primary))' : 'linear-gradient(135deg, var(--color-primary), var(--color-ai))',
                                                        color: 'white',
                                                        border: 'none',
                                                        cursor: p.analyzingItemId ? 'not-allowed' : 'pointer',
                                                        opacity: (p.analyzingItemId && p.analyzingItemId !== item.id) ? 0.5 : 1,
                                                        boxShadow: '0 2px 8px rgba(99, 102, 241, 0.3)',
                                                        transition: 'var(--transition-fast)'
                                                    }}
                                                    onClick={() => p.handlePncpAiAnalyze(item)}
                                                    disabled={!!p.analyzingItemId}
                                                    title="Analisar edital com IA (busca PDFs do PNCP automaticamente)"
                                                >
                                                    {p.analyzingItemId === item.id ? (
                                                        <><Loader2 size={14} className="spinner" /> {p.analysisProgress ? `${p.analysisProgress.percent}%` : 'Analisando...'}</>
                                                    ) : (
                                                        <><Brain size={14} /> IA</>
                                                    )}
                                                </button>
                                                <a
                                                    href={item.link_sistema}
                                                    target="_blank"
                                                    rel="noreferrer"
                                                    className="btn btn-ghost"
                                                    style={{ padding: '7px', borderRadius: 'var(--radius-md)' }}
                                                    title="Abrir no PNCP"
                                                >
                                                    <ExternalLink size={15} />
                                                </a>
                                            </div>
                                        </td>
                                    </tr>
                                    {/* ── AI Analysis Progress Bar (inline under analyzing row) ── */}
                                    {p.analyzingItemId === item.id && p.analysisProgress && (
                                        <tr>
                                            <td colSpan={6} style={{ padding: 0, border: 'none' }}>
                                                <div style={{
                                                    background: 'linear-gradient(135deg, rgba(99,102,241,0.08) 0%, rgba(139,92,246,0.08) 100%)',
                                                    borderBottom: '1px solid rgba(99,102,241,0.15)',
                                                    padding: '10px 16px',
                                                    display: 'flex', alignItems: 'center', gap: '12px',
                                                    animation: 'fadeIn 0.3s ease',
                                                }}>
                                                    <Loader2 size={16} className="spinner" style={{ color: 'var(--color-ai)', flexShrink: 0 }} />
                                                    <div style={{ flex: 1, minWidth: 0 }}>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
                                                            <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                                                                {p.analysisProgress!.message}
                                                            </span>
                                                            <span style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', fontWeight: 500 }}>
                                                                Etapa {p.analysisProgress!.step}/{p.analysisProgress!.total}
                                                            </span>
                                                        </div>
                                                        {/* Progress bar */}
                                                        <div style={{
                                                            width: '100%', height: '6px',
                                                            background: 'rgba(99,102,241,0.12)',
                                                            borderRadius: '3px', overflow: 'hidden',
                                                        }}>
                                                            <div style={{
                                                                width: `${p.analysisProgress!.percent}%`,
                                                                height: '100%',
                                                                background: 'linear-gradient(90deg, var(--color-primary), var(--color-ai))',
                                                                borderRadius: '3px',
                                                                transition: 'width 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
                                                            }} />
                                                        </div>
                                                        {p.analysisProgress!.detail && (
                                                            <span style={{ fontSize: '11px', color: 'var(--color-text-tertiary)', marginTop: '3px', display: 'block' }}>
                                                                {p.analysisProgress!.detail}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            </td>
                                        </tr>
                                    )}
                                </React.Fragment>)
                            })
                        )}
                    </tbody>
                </table>

                {/* Pagination Controls */}
                {!p.showFavoritosTab && p.displayItems.length > 0 && p.totalResults > 0 && (() => {
                    const totalPages = Math.ceil(p.totalResults / 10);
                    const renderPageNumbers = () => {
                        const pages = [];
                        let start = Math.max(1, p.page - 2);
                        let end = Math.min(totalPages, p.page + 2);

                        if (p.page <= 3 && totalPages >= 5) end = 5;
                        if (p.page >= totalPages - 2 && totalPages >= 5) start = totalPages - 4;

                        for (let i = start; i <= end; i++) {
                            pages.push(
                                <button
                                    key={i}
                                    onClick={() => p.setPage(i)}
                                    style={{
                                        padding: '6px 14px',
                                        borderRadius: 'var(--radius-md)',
                                        border: i === p.page ? 'none' : '1px solid var(--color-border)',
                                        background: i === p.page ? 'var(--color-primary)' : 'transparent',
                                        color: i === p.page ? 'white' : 'var(--color-text)',
                                        fontSize: 'var(--text-md)',
                                        fontWeight: i === p.page ? 'var(--font-semibold)' as any : 'var(--font-normal)' as any,
                                        cursor: 'pointer',
                                        transition: 'var(--transition-fast)'
                                    }}
                                    disabled={p.loading}
                                >
                                    {i}
                                </button>
                            );
                        }
                        return pages;
                    };

                    return (
                        <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            padding: 'var(--space-4) var(--space-6)',
                            borderTop: '1px solid var(--color-border)',
                            background: 'var(--color-bg-surface)'
                        }}>
                            <span style={{ fontSize: 'var(--text-md)', color: 'var(--color-text-tertiary)' }}>
                                Página {p.page} de {totalPages} ({p.totalResults} resultados)
                            </span>
                            <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                                <button
                                    className="btn btn-outline"
                                    style={{ padding: '6px 14px', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-md)' }}
                                    onClick={() => p.setPage(p => Math.max(1, p - 1))}
                                    disabled={p.page === 1 || p.loading}
                                >
                                    Anterior
                                </button>

                                <div style={{ display: 'flex', gap: '4px' }}>
                                    {renderPageNumbers()}
                                </div>

                                <button
                                    className="btn btn-outline"
                                    style={{ padding: '6px 14px', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-md)' }}
                                    onClick={() => p.setPage(p => p + 1)}
                                    disabled={p.page >= totalPages || p.loading}
                                >
                                    Próxima
                                </button>
                            </div>
                        </div>
                    );
                })()}
            </div>

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
                onCreateNew={(name) => {
                    const newList = p.createFavList(name);
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
