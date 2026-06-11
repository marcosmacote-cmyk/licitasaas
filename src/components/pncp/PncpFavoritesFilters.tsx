import React from 'react';
import { Search, X, ChevronDown, ChevronUp, Filter, CircleDollarSign, Calendar, Settings } from 'lucide-react';
import type { PncpChildProps } from './types';

export function PncpFavoritesFilters({ p }: PncpChildProps) {
    const totalFavs = p.favoritos.length;
    const filteredFavs = p.displayItems.length;

    // Helper to check if any filters are active
    const isFiltered = p.favSearch || 
                       p.favDateFilter !== 'all' || 
                       p.favModality !== 'todas' || 
                       p.favUf || 
                       p.favValMin || 
                       p.favValMax || 
                       p.favSortBy !== 'date_asc' ||
                       p.favValidity !== 'all';

    return (
        <div className="card" style={{ 
            padding: 'var(--space-6)', 
            marginBottom: 'var(--space-6)', 
            background: 'var(--color-bg-surface)', 
            borderRadius: 'var(--radius-xl)', 
            border: 'none', 
            boxShadow: 'var(--shadow-md), 0 0 0 1px var(--color-border)' 
        }}>
            <div>
                {/* Main Filter Row */}
                <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'end', flexWrap: 'wrap' }}>
                    <div style={{ flex: 2, minWidth: '280px' }}>
                        <label className="form-label">Buscar nos Favoritos</label>
                        <div className="pos-relative">
                            <Search size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-tertiary)' }} />
                            <input
                                type="text"
                                placeholder="Buscar por órgão, objeto, modalidade ou município..."
                                value={p.favSearch}
                                onChange={(e) => p.setFavSearch(e.target.value)}
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
                        <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <Calendar size={14} style={{ color: 'var(--color-primary)' }} /> Programação (Prazo Limite)
                        </label>
                        <select 
                            value={p.favDateFilter} 
                            onChange={(e: any) => p.setFavDateFilter(e.target.value)} 
                            className="form-select" 
                            style={{ height: '48px', borderRadius: 'var(--radius-lg)' }}
                        >
                            <option value="all">Qualquer data</option>
                            <option value="today">Hoje</option>
                            <option value="tomorrow">Amanhã</option>
                            <option value="this_week">Esta Semana (Seg-Dom)</option>
                            <option value="next_week">Próxima Semana</option>
                            <option value="this_month">Este Mês</option>
                            <option value="custom">Período Personalizado...</option>
                        </select>
                    </div>

                    <div style={{ minWidth: '160px' }}>
                        <label className="form-label">Status do Prazo</label>
                        <select 
                            value={p.favValidity} 
                            onChange={(e: any) => p.setFavValidity(e.target.value)} 
                            className="form-select" 
                            style={{ height: '48px', borderRadius: 'var(--radius-lg)' }}
                        >
                            <option value="all">Válidos e Vencidos</option>
                            <option value="valid">Apenas Válidas (Futuras)</option>
                            <option value="expired">Apenas Vencidas (Passadas)</option>
                        </select>
                    </div>

                    <div style={{ minWidth: '120px' }}>
                        <label className="form-label">Estado (UF)</label>
                        <select 
                            value={p.favUf} 
                            onChange={(e) => p.setFavUf(e.target.value)} 
                            className="form-select" 
                            style={{ height: '48px', borderRadius: 'var(--radius-lg)' }}
                        >
                            <option value="">Todos ({p.availableUfs.length})</option>
                            {p.availableUfs.map(uf => (
                                <option key={uf} value={uf}>{uf}</option>
                            ))}
                        </select>
                    </div>

                    <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'end' }}>
                        <button 
                            type="button" 
                            onClick={() => p.setShowFavFilters(!p.showFavFilters)}
                            className="btn btn-outline" 
                            style={{ 
                                display: 'flex',
                                alignItems: 'center',
                                gap: 'var(--space-2)',
                                height: '48px',
                                padding: '0 var(--space-4)',
                                borderRadius: 'var(--radius-lg)',
                                border: p.showFavFilters ? '1px solid var(--color-primary)' : undefined,
                                color: p.showFavFilters ? 'var(--color-primary)' : undefined,
                                background: p.showFavFilters ? 'rgba(37, 99, 235, 0.05)' : undefined
                            }}
                        >
                            <Filter size={16} />
                            Filtros e Relatório
                            {p.showFavFilters ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                    </div>
                </div>

                {/* Conditional Custom Date Inputs */}
                {p.favDateFilter === 'custom' && (
                    <div style={{
                        display: 'flex',
                        gap: 'var(--space-4)',
                        marginTop: 'var(--space-4)',
                        padding: 'var(--space-4)',
                        background: 'var(--color-bg-base)',
                        borderRadius: 'var(--radius-lg)',
                        border: '1px solid var(--color-border)',
                        animation: 'slideDown 0.15s ease-out',
                    }}>
                        <div style={{ flex: 1 }}>
                            <label className="form-label" style={{ fontSize: '0.8125rem' }}>De (Prazo Limite Inicial)</label>
                            <input 
                                type="date" 
                                value={p.favDateStart} 
                                onChange={(e) => p.setFavDateStart(e.target.value)} 
                                className="form-select" 
                            />
                        </div>
                        <div style={{ flex: 1 }}>
                            <label className="form-label" style={{ fontSize: '0.8125rem' }}>Até (Prazo Limite Final)</label>
                            <input 
                                type="date" 
                                value={p.favDateEnd} 
                                onChange={(e) => p.setFavDateEnd(e.target.value)} 
                                className="form-select" 
                            />
                        </div>
                    </div>
                )}

                {/* Advanced Panel (Collapsible) */}
                {p.showFavFilters && (
                    <div style={{
                        marginTop: 'var(--space-4)',
                        padding: 'var(--space-6)',
                        background: 'linear-gradient(to bottom, rgba(255,255,255,0.02), rgba(255,255,255,0.005))',
                        backdropFilter: 'blur(8px)',
                        borderRadius: 'var(--radius-xl)',
                        border: '1px solid var(--color-border)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 'var(--space-5)',
                        animation: 'slideDown 0.2s ease-out',
                        boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.02)'
                    }}>
                        {/* Filters Row */}
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                            gap: 'var(--space-4)'
                        }}>
                            <div>
                                <label className="form-label">Modalidade</label>
                                <select 
                                    value={p.favModality} 
                                    onChange={(e) => p.setFavModality(e.target.value)} 
                                    className="form-select"
                                >
                                    <option value="todas">Todas ({p.availableModalities.length})</option>
                                    {p.availableModalities.map(mod => (
                                        <option key={mod} value={mod}>{mod}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="form-label">Ordenar Por</label>
                                <select 
                                    value={p.favSortBy} 
                                    onChange={(e: any) => p.setFavSortBy(e.target.value)} 
                                    className="form-select"
                                >
                                    <option value="date_asc">Prazo Limite (Mais próximo)</option>
                                    <option value="date_desc">Prazo Limite (Mais distante)</option>
                                    <option value="val_desc">Valor Estimado (Decrescente)</option>
                                    <option value="val_asc">Valor Estimado (Crescente)</option>
                                    <option value="orgao_asc">Órgão (A-Z)</option>
                                </select>
                            </div>

                            <div>
                                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <CircleDollarSign size={14} style={{ color: 'var(--color-success)' }} /> Valor Mínimo (R$)
                                </label>
                                <input
                                    type="number"
                                    placeholder="Ex: 10000"
                                    value={p.favValMin}
                                    onChange={(e) => p.setFavValMin(e.target.value)}
                                    className="form-select"
                                    min="0"
                                    step="1000"
                                />
                            </div>

                            <div>
                                <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <CircleDollarSign size={14} style={{ color: 'var(--color-success)' }} /> Valor Máximo (R$)
                                </label>
                                <input
                                    type="number"
                                    placeholder="Ex: 500000"
                                    value={p.favValMax}
                                    onChange={(e) => p.setFavValMax(e.target.value)}
                                    className="form-select"
                                    min="0"
                                    step="1000"
                                />
                            </div>
                        </div>

                        {/* PDF Customization Row */}
                        <div style={{
                            borderTop: '1px solid var(--color-border)',
                            paddingTop: 'var(--space-4)'
                        }}>
                            <label className="form-label" style={{ 
                                display: 'flex', 
                                alignItems: 'center', 
                                gap: '6px', 
                                marginBottom: 'var(--space-3)',
                                fontSize: '0.875rem',
                                color: 'var(--color-text-primary)'
                            }}>
                                <Settings size={14} style={{ color: 'var(--color-primary)' }} />
                                Configuração do Relatório PDF (Colunas a Incluir)
                            </label>
                            
                            <div style={{ 
                                display: 'flex', 
                                flexWrap: 'wrap', 
                                gap: 'var(--space-3)' 
                            }}>
                                {Object.keys(p.pdfColumns).map(colKey => {
                                    const colNames: Record<string, string> = {
                                        orgao: 'Órgão',
                                        modalidade: 'Modalidade / Nº',
                                        objeto: 'Objeto',
                                        prazo: 'Prazo Limite',
                                        valor: 'Valor Est.',
                                        localidade: 'Município',
                                        link: 'Link PNCP'
                                    };
                                    const isChecked = p.pdfColumns[colKey as keyof typeof p.pdfColumns];
                                    return (
                                        <label 
                                            key={colKey} 
                                            style={{
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                gap: 'var(--space-2)',
                                                padding: '6px 12px',
                                                borderRadius: 'var(--radius-md)',
                                                border: '1px solid var(--color-border)',
                                                background: isChecked ? 'rgba(37, 99, 235, 0.05)' : 'transparent',
                                                borderColor: isChecked ? 'var(--color-primary)' : 'var(--color-border)',
                                                color: isChecked ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                                                cursor: 'pointer',
                                                fontSize: 'var(--text-sm)',
                                                fontWeight: 500,
                                                userSelect: 'none',
                                                transition: 'var(--transition-fast)'
                                            }}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={isChecked}
                                                onChange={() => {
                                                    p.setPdfColumns(prev => ({
                                                        ...prev,
                                                        [colKey]: !isChecked
                                                    }));
                                                }}
                                                style={{ cursor: 'pointer' }}
                                            />
                                            {colNames[colKey]}
                                        </label>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Summary & Reset Row */}
                        <div style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            borderTop: '1px solid var(--color-border)',
                            paddingTop: 'var(--space-4)',
                            flexWrap: 'wrap',
                            gap: 'var(--space-3)'
                        }}>
                            <div style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>
                                Mostrando <strong>{filteredFavs}</strong> de <strong>{totalFavs}</strong> licitações nos favoritos.
                            </div>

                            {isFiltered && (
                                <button 
                                    type="button" 
                                    className="btn btn-ghost" 
                                    onClick={p.clearFavFilters}
                                    style={{ fontSize: '0.8125rem', padding: '6px 12px', gap: '4px' }}
                                >
                                    <X size={14} /> Limpar Filtros
                                </button>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
