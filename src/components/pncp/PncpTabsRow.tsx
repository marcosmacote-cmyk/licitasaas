import React, { useState } from 'react';
import { Bell, Star, FolderOpen, MoreVertical, Pencil, Trash2, CheckCircle2, Download } from 'lucide-react';
import type { PncpChildProps } from './types';

export function PncpTabsRow({ p }: PncpChildProps) {
    const [favListMenu, setFavListMenu] = useState<string | null>(null);

    return (
        <>
            {/* Results Summary and Tabs */}
            <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                marginBottom: 'var(--space-4)', padding: '0 4px', borderBottom: '1px solid var(--color-border)', paddingBottom: '0'
            }}>
                <div style={{ display: 'flex', gap: 'var(--space-6)' }}>
                    <button
                        onClick={() => p.setActiveTab('search')}
                        className={`tab-btn${p.activeTab === 'search' ? ' active' : ''}`}
                    >
                        Resultados da Busca {p.results.length > 0 && `(${p.totalResults || p.results.length})`}
                    </button>
                    <button
                        onClick={() => p.setActiveTab('found')}
                        className={`tab-btn${p.activeTab === 'found' ? ' active' : ''}`}
                        style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', position: 'relative' }}
                    >
                        <Bell size={16} /> Encontradas {p.scannerOpportunitiesTotal > 0 && `(${p.scannerOpportunitiesTotal})`}
                        {p.unreadOpportunityCount > 0 && (
                            <span style={{
                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                minWidth: '18px', height: '18px', padding: '0 5px',
                                borderRadius: '9px', fontSize: '0.625rem', fontWeight: 700,
                                background: 'var(--color-danger)', color: '#fff',
                                marginLeft: '2px',
                            }}>{p.unreadOpportunityCount}</span>
                        )}
                    </button>
                    <button
                        onClick={() => p.setActiveTab('favorites')}
                        className={`tab-btn${p.activeTab === 'favorites' ? ' active-warning' : ''}`}
                        style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}
                    >
                        <Star size={16} fill={p.activeTab === 'favorites' ? "currentColor" : "none"} color={p.activeTab === 'favorites' ? "currentColor" : "currentColor"} />
                        Favoritos {p.favoritos.length > 0 && `(${p.favoritos.length})`}
                    </button>
                </div>
            </div>

            {/* ═══ Favorites List Filter (only when on Favoritos tab) ═══ */}
            {p.activeTab === 'favorites' && p.favLists.length > 1 && (
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
                                    paddingRight: list.name !== 'Favoritos Gerais' ? '24px' : '12px',
                                }}
                            >{list.name} ({p.favListItemCount(list.id)})</button>
                            {list.name !== 'Favoritos Gerais' && (
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
                    {p.activeTab === 'favorites'
                        ? (p.activeFavListId
                            ? p.favLists.find(l => l.id === p.activeFavListId)?.name || 'Favoritos'
                            : 'Todas as Listas de Favoritos')
                        : p.activeTab === 'found'
                            ? 'Licitações Encontradas pelo Scanner'
                            : 'Resultados da Pesquisa'}
                </h3>
                <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
                    {p.activeTab === 'found' && (
                        <>
                            {/* Filter by saved search */}
                            <select
                                value={p.scannerFilterSearchId || ''}
                                onChange={(e) => p.setScannerFilterSearchId(e.target.value || null)}
                                style={{
                                    padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-md)',
                                    border: '1px solid var(--color-border)', background: 'var(--color-bg-surface)',
                                    color: 'var(--color-text-secondary)', fontSize: 'var(--text-sm)',
                                }}
                            >
                                <option value="">Todas as pesquisas</option>
                                {p.savedSearches.map(s => (
                                    <option key={s.id} value={s.id}>{s.name}</option>
                                ))}
                            </select>
                            {p.unreadOpportunityCount > 0 && (
                                <button
                                    className="btn btn-ghost"
                                    onClick={() => p.markOpportunitiesViewed('all')}
                                    style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-2) var(--space-4)', fontSize: 'var(--text-sm)' }}
                                >
                                    <CheckCircle2 size={14} /> Marcar tudo como lido
                                </button>
                            )}
                        </>
                    )}
                    {p.activeTab === 'favorites' && p.favoritos.length > 0 && (
                        <button className="btn btn-primary" onClick={p.exportFavoritesToPdf} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-2) var(--space-4)' }}>
                            <Download size={16} /> Exportar Relatório PDF
                        </button>
                    )}
                </div>
            </div>
        </>
    );
}
