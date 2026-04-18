import React from 'react';
import { Search, Save, Loader2, X, ChevronDown, ChevronUp, Filter, Ban, CircleDollarSign } from 'lucide-react';
import { TooltipHelp } from '../ui';
import { UFS, ESFERAS, MODALIDADES, STATUS_OPTIONS } from '../hooks/usePncpPage';
import type { PncpChildProps } from './types';

export function PncpSearchFilters({ p, companies }: PncpChildProps) {
    return (
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
                        padding: 'var(--space-6)',
                        background: 'linear-gradient(to bottom, rgba(255,255,255,0.03), rgba(255,255,255,0.01))',
                        backdropFilter: 'blur(8px)',
                        borderRadius: 'var(--radius-xl)',
                        border: '1px solid var(--color-border)',
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                        gap: 'var(--space-5)',
                        animation: 'slideDown 0.2s ease-out',
                        boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.02)'
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

                        <div style={{ gridColumn: '1 / -1' }}>
                            <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                                Lista de Nomes ou CNPJs de Órgãos (Busca Múltipla Rápida)
                                <TooltipHelp text="Essa ferramenta permite buscar em Lote. Cole dezenas de CNPJs ou nomes (ex: secretarias, prefeituras) e faremos o raio-x completo de todos de uma só vez!" />
                            </label>
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

                        <div style={{ gridColumn: '1 / -1' }}>
                            <label className="form-label" style={{ color: 'var(--color-danger)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <Ban size={15} /> Excluir palavras-chave do objeto
                            </label>
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
                            <label className="form-label">Prazo Limite Inicial</label>
                            <input type="date" value={p.dataInicio} onChange={(e) => p.setDataInicio(e.target.value)} className="form-select" />
                        </div>

                        <div>
                            <label className="form-label">Prazo Limite Final</label>
                            <input type="date" value={p.dataFim} onChange={(e) => p.setDataFim(e.target.value)} className="form-select" />
                        </div>

                        <div>
                            <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <CircleDollarSign size={15} style={{ color: 'var(--color-success)' }} /> Valor Mínimo (R$)
                            </label>
                            <input
                                type="number"
                                placeholder="Ex: 50000"
                                value={p.valorMin}
                                onChange={(e) => p.setValorMin(e.target.value)}
                                className="form-select"
                                min="0"
                                step="1000"
                                style={{ fontSize: '0.875rem' }}
                            />
                        </div>

                        <div>
                            <label className="form-label" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <CircleDollarSign size={15} style={{ color: 'var(--color-success)' }} /> Valor Máximo (R$)
                            </label>
                            <input
                                type="number"
                                placeholder="Ex: 5000000"
                                value={p.valorMax}
                                onChange={(e) => p.setValorMax(e.target.value)}
                                className="form-select"
                                min="0"
                                step="1000"
                                style={{ fontSize: '0.875rem' }}
                            />
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
    );
}
