import { useState, useEffect } from 'react';
import { Search, Save, Loader2, Bookmark, ExternalLink, Plus, X, ChevronDown, ChevronUp, Filter, Building2 } from 'lucide-react';
import { API_BASE_URL } from '../config';
import type { CompanyProfile, PncpSavedSearch, PncpBiddingItem, BiddingProcess } from '../types';
import { ProcessFormModal } from './ProcessFormModal';

interface Props {
    companies: CompanyProfile[];
}

const UFS = [
    'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA',
    'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN',
    'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'
];

const MODALIDADES = [
    { value: 'todas', label: 'Todas as Modalidades' },
    { value: '1', label: 'Pregão Eletrônico' },
    { value: '2', label: 'Concorrência' },
    { value: '3', label: 'Concurso' },
    { value: '4', label: 'Leilão' },
    { value: '5', label: 'Diálogo Competitivo' },
    { value: '6', label: 'Dispensa de Licitação' },
    { value: '7', label: 'Inexigibilidade' },
    { value: '8', label: 'Tomada de Preços' },
    { value: '9', label: 'Convite' },
];

const STATUS_OPTIONS = [
    { value: 'recebendo_proposta', label: '🟢 Abertas (Recebendo Propostas)' },
    { value: 'encerrada', label: '🔴 Encerradas' },
    { value: 'suspensa', label: '🟡 Suspensas' },
    { value: 'anulada', label: '⚫ Anuladas' },
    { value: 'todas', label: '📋 Todas' },
];

export function PncpPage({ companies }: Props) {
    const [savedSearches, setSavedSearches] = useState<PncpSavedSearch[]>([]);
    const [results, setResults] = useState<PncpBiddingItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

    // Form state
    const [keywords, setKeywords] = useState('');
    const [status, setStatus] = useState('recebendo_proposta');
    const [selectedUf, setSelectedUf] = useState('CE');
    const [selectedSearchCompanyId, setSelectedSearchCompanyId] = useState('');
    const [modalidade, setModalidade] = useState('todas');
    const [dataInicio, setDataInicio] = useState('');
    const [dataFim, setDataFim] = useState('');
    const [page, setPage] = useState(1);
    const [totalResults, setTotalResults] = useState(0);

    // Modal state
    const [editingProcess, setEditingProcess] = useState<Partial<BiddingProcess> | null>(null);

    useEffect(() => {
        fetchSavedSearches();
    }, []);

    const fetchSavedSearches = async () => {
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`${API_BASE_URL}/api/pncp/searches`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setSavedSearches(data);
            }
        } catch (e) {
            console.error("Failed to fetch saved searches", e);
        }
    };

    const handleSearch = async (e?: React.FormEvent, overrides?: { keywords?: string; status?: string; uf?: string; modalidade?: string; dataInicio?: string; dataFim?: string }) => {
        if (e) {
            e.preventDefault();
            setPage(1);
        }
        setLoading(true);
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`${API_BASE_URL}/api/pncp/search`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    keywords: overrides?.keywords ?? keywords,
                    status: overrides?.status ?? status,
                    uf: overrides?.uf ?? selectedUf,
                    pagina: e ? 1 : page,
                    modalidade: overrides?.modalidade ?? modalidade,
                    dataInicio: (overrides?.dataInicio ?? dataInicio) || undefined,
                    dataFim: (overrides?.dataFim ?? dataFim) || undefined,
                })
            });
            if (res.ok) {
                const data = await res.json();
                setResults(data.items || data);
                setTotalResults(data.total || data.length);
            } else {
                throw new Error("Erro na busca");
            }
        } catch (e) {
            console.error(e);
            alert("Falha ao buscar editais. Tente novamente.");
        } finally {
            setLoading(false);
        }
    };

    const handleSaveSearch = async () => {
        const name = prompt("Defina um nome para esta pesquisa (ex: Equipamentos TI em SP):");
        if (!name) return;

        setSaving(true);
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`${API_BASE_URL}/api/pncp/searches`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    name,
                    keywords,
                    status,
                    companyProfileId: selectedSearchCompanyId,
                    states: JSON.stringify(selectedUf ? [selectedUf] : [])
                })
            });

            if (res.ok) {
                fetchSavedSearches();
            } else {
                throw new Error("Failed to save");
            }
        } catch (e) {
            console.error(e);
            alert("Erro ao salvar pesquisa.");
        } finally {
            setSaving(false);
        }
    };

    const loadSavedSearch = (search: PncpSavedSearch) => {
        const searchKeywords = search.keywords || '';
        const searchStatus = search.status || 'recebendo_proposta';
        let searchUf = '';
        try {
            const parsedStates = JSON.parse(search.states || '[]');
            searchUf = parsedStates[0] || '';
        } catch {
            searchUf = '';
        }

        // Update form state for display
        setKeywords(searchKeywords);
        setStatus(searchStatus);
        setSelectedSearchCompanyId(search.companyProfileId || '');
        setSelectedUf(searchUf);
        setPage(1);

        // Execute search immediately with the saved values (bypass stale state)
        handleSearch(undefined, {
            keywords: searchKeywords,
            status: searchStatus,
            uf: searchUf,
        });
    };

    useEffect(() => {
        if (!loading) {
            handleSearch();
        }
    }, [page]);

    const deleteSavedSearch = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!confirm("Excluir pesquisa salva?")) return;
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`${API_BASE_URL}/api/pncp/searches/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) fetchSavedSearches();
        } catch (e) {
            console.error(e);
        }
    };

    const clearSearch = () => {
        setKeywords('');
        setStatus('recebendo_proposta');
        setSelectedUf('CE');
        setSelectedSearchCompanyId('');
        setModalidade('todas');
        setDataInicio('');
        setDataFim('');
        setResults([]);
        setTotalResults(0);
        setPage(1);
    };

    const handleImportToFunnel = (item: PncpBiddingItem) => {
        setEditingProcess({
            title: item.titulo,
            summary: item.objeto,
            portal: "PNCP",
            modality: item.modalidade_nome || "Não Informado (PNCP)",
            status: "Captado",
            estimatedValue: item.valor_estimado || 0,
            sessionDate: item.data_abertura ? new Date(item.data_abertura).toISOString() : new Date().toISOString(),
            link: item.link_sistema,
            companyProfileId: selectedSearchCompanyId || (companies.length > 0 ? companies[0].id : ''),
            observations: JSON.stringify([{
                id: crypto.randomUUID?.() || Date.now().toString(),
                text: `Importado do PNCP | Órgão: ${item.orgao_nome} | ${item.municipio}-${item.uf}`,
                createdAt: new Date().toISOString(),
                author: 'Sistema'
            }])
        });
    };

    const handleSaveProcess = async (data: Partial<BiddingProcess>, aiData?: any) => {
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`${API_BASE_URL}/api/biddings`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data)
            });

            if (res.ok) {
                const savedProcess = await res.json();
                if (aiData) {
                    await fetch(`${API_BASE_URL}/api/analysis`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ ...aiData, biddingProcessId: savedProcess.id })
                    });
                }
                alert("Licitação importada com sucesso para o Funil!");
                setEditingProcess(null);
            } else {
                throw new Error("Erro ao importar.");
            }
        } catch (e) {
            console.error(e);
            alert("Erro ao importar licitação.");
        }
    };

    const activeFilterCount = [
        modalidade !== 'todas',
        dataInicio !== '',
        dataFim !== '',
        selectedSearchCompanyId !== ''
    ].filter(Boolean).length;

    const selectStyle: React.CSSProperties = {
        padding: '10px 14px',
        borderRadius: '10px',
        border: '1px solid var(--color-border)',
        fontSize: '0.875rem',
        background: 'var(--color-bg-surface)',
        color: 'var(--color-text-primary)',
        width: '100%',
        outline: 'none',
    };

    return (
        <div className="page-container" style={{ paddingBottom: '32px' }}>
            {/* Page Header */}
            <div className="page-header" style={{ marginBottom: '24px' }}>
                <div>
                    <h1 className="page-title">Busca PNCP</h1>
                    <p className="page-subtitle">Pesquise editais diretamente no Portal Nacional de Contratações Públicas.</p>
                </div>
            </div>

            {/* Saved Searches as Chips */}
            {savedSearches.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-tertiary)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                        <Bookmark size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                        Pesquisas Salvas:
                    </span>
                    {savedSearches.map(s => (
                        <div
                            key={s.id}
                            onClick={() => loadSavedSearch(s)}
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '6px',
                                padding: '6px 14px',
                                background: 'var(--color-bg-surface)',
                                border: '1px solid var(--color-border)',
                                borderRadius: '20px',
                                fontSize: '0.8125rem',
                                color: 'var(--color-text-primary)',
                                cursor: 'pointer',
                                transition: 'all 0.2s',
                                fontWeight: 500,
                            }}
                            onMouseEnter={(e: any) => { e.currentTarget.style.borderColor = 'var(--color-primary)'; e.currentTarget.style.background = 'rgba(37, 99, 235, 0.06)'; }}
                            onMouseLeave={(e: any) => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.background = 'var(--color-bg-surface)'; }}
                        >
                            {s.name}
                            {s.companyProfileId && <Building2 size={12} color="var(--color-primary)" />}
                            <button
                                onClick={(e) => deleteSavedSearch(s.id, e)}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-tertiary)', padding: 0, display: 'flex' }}
                            >
                                <X size={13} />
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {/* Search Card */}
            <div className="card" style={{ padding: '24px', marginBottom: '24px', background: 'var(--color-bg-surface)' }}>
                <form onSubmit={handleSearch}>
                    {/* Main Search Row */}
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'end', flexWrap: 'wrap' }}>
                        <div style={{ flex: 2, minWidth: '280px' }}>
                            <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, marginBottom: '6px', color: 'var(--color-text-secondary)' }}>Palavras-chave (Objeto)</label>
                            <div style={{ position: 'relative' }}>
                                <Search size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-tertiary)' }} />
                                <input
                                    type="text"
                                    placeholder="Ex: Serviços de TI, Equipamentos médicos..."
                                    value={keywords}
                                    onChange={(e) => setKeywords(e.target.value)}
                                    style={{
                                        ...selectStyle,
                                        paddingLeft: '42px',
                                        fontSize: '0.9375rem',
                                    }}
                                />
                            </div>
                        </div>

                        <div style={{ flex: 1, minWidth: '180px' }}>
                            <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, marginBottom: '6px', color: 'var(--color-text-secondary)' }}>Status</label>
                            <select value={status} onChange={(e) => setStatus(e.target.value)} style={selectStyle}>
                                {STATUS_OPTIONS.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
                            </select>
                        </div>

                        <div style={{ minWidth: '120px' }}>
                            <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, marginBottom: '6px', color: 'var(--color-text-secondary)' }}>Estado (UF)</label>
                            <select value={selectedUf} onChange={(e) => setSelectedUf(e.target.value)} style={selectStyle}>
                                <option value="">Brasil (Todas)</option>
                                {UFS.map(uf => <option key={uf} value={uf}>{uf}</option>)}
                            </select>
                        </div>

                        <div style={{ display: 'flex', gap: '8px', alignItems: 'end' }}>
                            <button type="submit" className="btn btn-primary" disabled={loading} style={{ padding: '10px 20px', borderRadius: '10px', gap: '8px', fontSize: '0.9375rem', fontWeight: 600, height: '44px' }}>
                                {loading ? <Loader2 size={18} className="spinner" /> : <Search size={18} />}
                                Buscar
                            </button>
                        </div>
                    </div>

                    {/* Action Buttons Row */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', flexWrap: 'wrap', gap: '10px' }}>
                        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                            <button
                                type="button"
                                onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: '6px',
                                    fontSize: '0.8125rem', fontWeight: 600,
                                    color: showAdvancedFilters ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                                    background: 'none', border: 'none', cursor: 'pointer', padding: '6px 0',
                                }}
                            >
                                <Filter size={15} />
                                Filtros Avançados
                                {activeFilterCount > 0 && (
                                    <span style={{
                                        background: 'var(--color-primary)', color: '#fff', borderRadius: '10px',
                                        padding: '1px 8px', fontSize: '0.7rem', fontWeight: 700,
                                    }}>{activeFilterCount}</span>
                                )}
                                {showAdvancedFilters ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                            </button>
                        </div>

                        <div style={{ display: 'flex', gap: '8px' }}>
                            <button type="button" className="btn btn-ghost" onClick={clearSearch} style={{ padding: '6px 12px', fontSize: '0.8125rem', gap: '4px' }}>
                                <X size={14} /> Limpar
                            </button>
                            <button type="button" className="btn btn-outline" onClick={handleSaveSearch} disabled={saving} style={{ padding: '6px 12px', fontSize: '0.8125rem', gap: '4px' }}>
                                {saving ? <Loader2 size={14} className="spinner" /> : <Save size={14} />} Salvar Pesquisa
                            </button>
                        </div>
                    </div>

                    {/* Advanced Filters (Collapsible) */}
                    {showAdvancedFilters && (
                        <div style={{
                            marginTop: '16px',
                            padding: '20px',
                            background: 'var(--color-bg-base)',
                            borderRadius: 'var(--radius-md)',
                            border: '1px solid var(--color-border)',
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                            gap: '16px',
                            animation: 'slideDown 0.2s ease-out',
                        }}>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, marginBottom: '6px', color: 'var(--color-text-secondary)' }}>Modalidade</label>
                                <select value={modalidade} onChange={(e) => setModalidade(e.target.value)} style={selectStyle}>
                                    {MODALIDADES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                                </select>
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, marginBottom: '6px', color: 'var(--color-text-secondary)' }}>Publicado a partir de</label>
                                <input type="date" value={dataInicio} onChange={(e) => setDataInicio(e.target.value)} style={selectStyle} />
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, marginBottom: '6px', color: 'var(--color-text-secondary)' }}>Publicado até</label>
                                <input type="date" value={dataFim} onChange={(e) => setDataFim(e.target.value)} style={selectStyle} />
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, marginBottom: '6px', color: 'var(--color-text-secondary)' }}>Vincular à Empresa</label>
                                <select value={selectedSearchCompanyId} onChange={(e) => setSelectedSearchCompanyId(e.target.value)} style={selectStyle}>
                                    <option value="">(Nenhuma empresa)</option>
                                    {companies.map(c => <option key={c.id} value={c.id}>{c.razaoSocial}</option>)}
                                </select>
                            </div>
                        </div>
                    )}
                </form>
            </div>

            {/* Results Summary */}
            {results.length > 0 && (
                <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    marginBottom: '12px', padding: '0 4px'
                }}>
                    <span style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)', fontWeight: 500 }}>
                        {totalResults > 0 ? `${totalResults} resultados encontrados` : `${results.length} resultados`}
                    </span>
                </div>
            )}

            {/* Results Table */}
            <div style={{ background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
                <table className="table" style={{ width: '100%' }}>
                    <thead>
                        <tr>
                            <th style={{ paddingLeft: '24px', width: '22%' }}>Órgão / Localidade</th>
                            <th style={{ width: '30%' }}>Objeto</th>
                            <th>Modalidade</th>
                            <th>Fim Propostas</th>
                            <th>Sessão</th>
                            <th>Valor Est.</th>
                            <th style={{ paddingRight: '24px' }}>Ações</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr>
                                <td colSpan={7} style={{ textAlign: 'center', padding: '60px' }}>
                                    <Loader2 size={32} className="spinner" style={{ margin: '0 auto', color: 'var(--color-primary)' }} />
                                    <div style={{ marginTop: '12px', color: 'var(--color-text-tertiary)', fontSize: '0.875rem' }}>Consultando PNCP...</div>
                                </td>
                            </tr>
                        ) : results.length === 0 ? (
                            <tr>
                                <td colSpan={7} style={{ textAlign: 'center', padding: '60px', color: 'var(--color-text-tertiary)' }}>
                                    <Search size={40} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
                                    <div style={{ fontSize: '1rem', fontWeight: 500 }}>Nenhum edital encontrado</div>
                                    <div style={{ fontSize: '0.8125rem', marginTop: '4px' }}>Tente ajustar as palavras-chave ou filtros.</div>
                                </td>
                            </tr>
                        ) : (
                            results.map((item) => (
                                <tr key={item.id} style={{ transition: 'background 0.15s' }}
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
                                        <div style={{ fontWeight: 600, fontSize: '0.8125rem', marginBottom: '4px', lineHeight: '1.3' }}>{item.titulo}</div>
                                        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', lineHeight: '1.4' }}>
                                            {item.objeto}
                                        </div>
                                    </td>
                                    <td style={{ verticalAlign: 'top', paddingTop: '16px', whiteSpace: 'nowrap' }}>
                                        {item.modalidade_nome ? (
                                            <span style={{
                                                display: 'inline-block',
                                                padding: '3px 10px',
                                                borderRadius: '6px',
                                                background: 'rgba(37, 99, 235, 0.1)',
                                                color: 'var(--color-primary)',
                                                fontSize: '0.75rem',
                                                fontWeight: 600,
                                            }}>{item.modalidade_nome}</span>
                                        ) : (
                                            <span style={{ color: 'var(--color-text-tertiary)', fontSize: '0.75rem' }}>—</span>
                                        )}
                                    </td>
                                    {/* Fim Propostas (deadline - most important) */}
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
                                    {/* Sessão Pública */}
                                    <td style={{ whiteSpace: 'nowrap', verticalAlign: 'top', paddingTop: '16px' }}>
                                        {item.data_abertura ? (
                                            <>
                                                <div style={{ fontWeight: 500, fontSize: '0.8125rem' }}>
                                                    {new Date(item.data_abertura).toLocaleDateString('pt-BR')}
                                                </div>
                                                <div style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)' }}>
                                                    {new Date(item.data_abertura).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
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
                                                className="btn btn-primary"
                                                style={{ padding: '7px 12px', fontSize: '0.75rem', borderRadius: '8px', gap: '4px', whiteSpace: 'nowrap' }}
                                                onClick={() => handleImportToFunnel(item)}
                                                title="Importar para o Funil de Licitações"
                                            >
                                                <Plus size={14} /> Importar
                                            </button>
                                            <a
                                                href={item.link_sistema}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="btn btn-ghost"
                                                style={{ padding: '7px', borderRadius: '8px' }}
                                                title="Abrir no PNCP"
                                            >
                                                <ExternalLink size={15} />
                                            </a>
                                        </div>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>

                {/* Pagination Controls */}
                {results.length > 0 && totalResults > 0 && (() => {
                    const totalPages = Math.ceil(totalResults / 10);
                    const renderPageNumbers = () => {
                        const pages = [];
                        let start = Math.max(1, page - 2);
                        let end = Math.min(totalPages, page + 2);

                        if (page <= 3 && totalPages >= 5) end = 5;
                        if (page >= totalPages - 2 && totalPages >= 5) start = totalPages - 4;

                        for (let i = start; i <= end; i++) {
                            pages.push(
                                <button
                                    key={i}
                                    onClick={() => setPage(i)}
                                    style={{
                                        padding: '6px 14px',
                                        borderRadius: '8px',
                                        border: i === page ? 'none' : '1px solid var(--color-border)',
                                        background: i === page ? 'var(--color-primary)' : 'transparent',
                                        color: i === page ? 'white' : 'var(--color-text)',
                                        fontSize: '0.875rem',
                                        fontWeight: i === page ? 600 : 400,
                                        cursor: 'pointer',
                                        transition: 'all 0.15s'
                                    }}
                                    disabled={loading}
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
                            padding: '16px 24px',
                            borderTop: '1px solid var(--color-border)',
                            background: 'var(--color-bg-surface)'
                        }}>
                            <span style={{ fontSize: '0.875rem', color: 'var(--color-text-tertiary)' }}>
                                Página {page} de {totalPages} ({totalResults} resultados)
                            </span>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                <button
                                    className="btn btn-outline"
                                    style={{ padding: '6px 14px', borderRadius: '8px', fontSize: '0.875rem' }}
                                    onClick={() => setPage(p => Math.max(1, p - 1))}
                                    disabled={page === 1 || loading}
                                >
                                    Anterior
                                </button>

                                <div style={{ display: 'flex', gap: '4px' }}>
                                    {renderPageNumbers()}
                                </div>

                                <button
                                    className="btn btn-outline"
                                    style={{ padding: '6px 14px', borderRadius: '8px', fontSize: '0.875rem' }}
                                    onClick={() => setPage(p => p + 1)}
                                    disabled={page >= totalPages || loading}
                                >
                                    Próxima
                                </button>
                            </div>
                        </div>
                    );
                })()}
            </div>

            {editingProcess && (
                <ProcessFormModal
                    initialData={editingProcess as BiddingProcess}
                    companies={companies}
                    onClose={() => setEditingProcess(null)}
                    onSave={handleSaveProcess}
                />
            )}
        </div>
    );
}
