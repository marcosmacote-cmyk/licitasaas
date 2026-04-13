import React, { useState } from 'react';
import { Bookmark, Building2, Clock, Filter, List, MoreVertical, Pencil, Trash2 } from 'lucide-react';
import type { PncpChildProps } from './types';

export function PncpSavedSearches({ p }: PncpChildProps) {
    const [searchListMenu, setSearchListMenu] = useState<string | null>(null);
    const [searchChipMenu, setSearchChipMenu] = useState<string | null>(null);

    if (p.savedSearches.length === 0) return null;

    return (
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }} data-tour="pncp-search-panel">
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', width: '100%', justifyContent: 'space-between', borderBottom: '1px solid var(--color-border)', paddingBottom: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                        <span style={{ fontSize: 'var(--text-md)', color: 'var(--color-text-tertiary)', fontWeight: 'var(--font-semibold)' as any, whiteSpace: 'nowrap' }}>
                            <Bookmark size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                            Pesquisas Salvas
                        </span>
                    </div>                            
                    {/* ── Last Scan Info ── */}
                    {p.lastScanAt && (
                        <div style={{ 
                            fontSize: '0.7rem', color: 'var(--color-text-tertiary)', 
                            display: 'flex', alignItems: 'center', gap: '4px',
                            paddingLeft: '4px',
                        }}>
                            <Clock size={10} />
                            Última: {new Date(p.lastScanAt).toLocaleDateString('pt-BR')} às {new Date(p.lastScanAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                            {p.lastScanTotalNew > 0 && (
                                <span style={{ color: 'var(--color-success)', fontWeight: 600 }}>
                                    — {p.lastScanTotalNew} novo(s)
                                </span>
                            )}
                            {p.nextScanAt && (
                                <span style={{ marginLeft: '4px' }}>
                                    | Próxima: ~{new Date(p.nextScanAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                </span>
                            )}
                        </div>
                    )}
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
                            {/* ── Badge do resultado da última varredura ── */}
                            {(() => {
                                const scanResult = p.getSearchScanResult(s.id);
                                if (!scanResult) return null;
                                if (scanResult.status === 'error') {
                                    return (
                                        <span title={`Erro: ${scanResult.errorMessage || 'falha na busca'}`} style={{
                                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                            minWidth: '18px', height: '18px', padding: '0 5px',
                                            borderRadius: '9px', fontSize: '0.625rem', fontWeight: 700,
                                            background: 'var(--color-danger-bg, rgba(239,68,68,0.1))', 
                                            color: 'var(--color-danger)',
                                        }}>!</span>
                                    );
                                }
                                if (scanResult.newCount > 0) {
                                    return (
                                        <span title={`${scanResult.newCount} novo(s) na última varredura (${scanResult.totalFound} total)`} style={{
                                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                            minWidth: '18px', height: '18px', padding: '0 5px',
                                            borderRadius: '9px', fontSize: '0.625rem', fontWeight: 700,
                                            background: 'var(--color-success-bg, rgba(16,185,129,0.1))', 
                                            color: 'var(--color-success)',
                                        }}>{scanResult.newCount}</span>
                                    );
                                }
                                return (
                                    <span title={`0 novos na última varredura (${scanResult.totalFound} total)`} style={{
                                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                        width: '6px', height: '6px',
                                        borderRadius: '50%',
                                        background: 'var(--color-text-tertiary)',
                                        opacity: 0.4,
                                    }} />);
                            })()}
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
    );
}
