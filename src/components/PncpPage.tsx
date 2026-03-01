import { useState, useEffect } from 'react';
import { Search, Save, Loader2, Bookmark, ExternalLink, Plus, Trash2, X } from 'lucide-react';
import { API_BASE_URL } from '../config';
import type { CompanyProfile, PncpSavedSearch, PncpBiddingItem, BiddingProcess } from '../types';
import { ProcessFormModal } from './ProcessFormModal';

interface Props {
    companies: CompanyProfile[];
}

export function PncpPage({ companies }: Props) {
    const [savedSearches, setSavedSearches] = useState<PncpSavedSearch[]>([]);
    const [results, setResults] = useState<PncpBiddingItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    // Form state
    const [keywords, setKeywords] = useState('');
    const [status, setStatus] = useState('recebendo_proposta');
    const [selectedUiState, setSelectedUiState] = useState('CE');
    const [selectedSearchCompanyId, setSelectedSearchCompanyId] = useState('');
    const [page, setPage] = useState(1);
    const [totalResults, setTotalResults] = useState(0);

    // Modal state
    const [editingProcess, setEditingProcess] = useState<Partial<BiddingProcess> | null>(null);

    const UFS = [
        'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA',
        'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN',
        'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'
    ];

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

    const handleSearch = async (e?: React.FormEvent) => {
        if (e) {
            e.preventDefault();
            setPage(1); // User clicked 'Buscar' manually, always restart from page 1
        }
        setLoading(true);
        // Do not empty results aggressively, to keep UI smooth, but show loading
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`${API_BASE_URL}/api/pncp/search`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    keywords,
                    status,
                    uf: selectedUiState,
                    pagina: e ? 1 : page // reset to 1 if new search, otherwise use current
                })
            });
            if (res.ok) {
                const data = await res.json();
                setResults(data.items || data); // fallback
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
                    states: JSON.stringify(selectedUiState ? [selectedUiState] : [])
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
        setKeywords(search.keywords || '');
        setStatus(search.status || 'recebendo_proposta');
        setSelectedSearchCompanyId(search.companyProfileId || '');
        try {
            const parsedStates = JSON.parse(search.states || '[]');
            setSelectedUiState(parsedStates[0] || '');
        } catch {
            setSelectedUiState('');
        }
        // Small timeout to allow state to update before searching
        setTimeout(() => handleSearch(), 100);
    };

    // Auto-fetch if page changes
    useEffect(() => {
        if (!loading) { // Wait for initial render
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
        setSelectedUiState('CE');
        setSelectedSearchCompanyId('');
        setResults([]);
        setTotalResults(0);
        setPage(1);
    };

    const handleImportToFunnel = (item: PncpBiddingItem) => {
        setEditingProcess({
            title: item.titulo,
            summary: item.objeto,
            portal: "PNCP",
            modality: "Não Informado (PNCP)",
            status: "Captado",
            estimatedValue: item.valor_estimado || 0,
            sessionDate: item.data_abertura ? new Date(item.data_abertura).toISOString() : new Date().toISOString(),
            link: item.link_sistema,
            companyProfileId: selectedSearchCompanyId || (companies.length > 0 ? companies[0].id : '')
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
                body: JSON.stringify(data) // this contains user selected company
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


    return (
        <div className="page-container" style={{ display: 'flex', gap: '24px', paddingBottom: '32px' }}>
            {/* Sidebar for Saved Searches */}
            <div style={{ width: '280px', flexShrink: 0 }}>
                <div style={{ background: 'var(--color-bg-surface)', padding: '20px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', height: '100%' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px', fontWeight: 600 }}>
                        <Bookmark size={20} color="var(--color-primary)" />
                        Pesquisas Salvas
                    </div>
                    {savedSearches.length === 0 ? (
                        <p style={{ fontSize: '0.875rem', color: 'var(--color-text-tertiary)' }}>Nenhuma pesquisa salva ainda.</p>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {savedSearches.map(s => (
                                <div
                                    key={s.id}
                                    style={{
                                        position: 'relative',
                                        textAlign: 'left',
                                        padding: '12px',
                                        background: 'var(--color-bg-surface-hover)',
                                        border: '1px solid var(--color-border)',
                                        borderRadius: 'var(--radius-md)',
                                        transition: 'all 0.2s',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '4px'
                                    }}
                                    onMouseOver={(e) => e.currentTarget.style.borderColor = 'var(--color-primary)'}
                                    onMouseOut={(e) => e.currentTarget.style.borderColor = 'var(--color-border)'}
                                >
                                    <div
                                        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', cursor: 'pointer' }}
                                        onClick={() => loadSavedSearch(s)}
                                    >
                                        <div style={{ fontWeight: 600, fontSize: '0.875rem', color: 'var(--color-text)', paddingRight: '20px' }}>{s.name}</div>
                                        <button
                                            type="button"
                                            onClick={(e) => deleteSavedSearch(s.id, e)}
                                            style={{ background: 'none', border: 'none', color: 'var(--color-text-tertiary)', cursor: 'pointer', padding: '4px' }}
                                            title="Excluir Pesquisa"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)', cursor: 'pointer' }} onClick={() => loadSavedSearch(s)}>
                                        {s.keywords ? `"${s.keywords}"` : 'Sem palavras-chave'} • {s.status === 'recebendo_proposta' ? 'Abertas' : 'Todas'}
                                    </div>
                                    {s.companyProfileId && (
                                        <div style={{ fontSize: '0.7rem', color: 'var(--color-primary)', display: 'flex', gap: '4px', alignItems: 'center' }}>
                                            <Bookmark size={10} /> {s.company?.razaoSocial || companies.find(c => c.id === s.companyProfileId)?.razaoSocial || 'Empresa Vinculada'}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            {/* Main Content */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '24px' }}>
                <div className="page-header">
                    <div>
                        <h1 className="page-title">Busca de Editais no PNCP</h1>
                        <p className="page-subtitle">Encontre oportunidades diretamente na base nacional.</p>
                    </div>
                </div>

                <div className="card" style={{ padding: '24px', background: 'var(--color-bg-base)' }}>
                    <form onSubmit={handleSearch} style={{ display: 'grid', gridTemplateColumns: 'minmax(250px, 1fr) 200px 150px auto', gap: '16px', alignItems: 'end' }}>
                        <div>
                            <label className="form-label" style={{ fontSize: '0.85rem' }}>Palavras-chave (Objeto)</label>
                            <div style={{ position: 'relative' }}>
                                <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-tertiary)' }} />
                                <input
                                    type="text"
                                    placeholder="Buscar por objeto..."
                                    value={keywords}
                                    onChange={(e) => setKeywords(e.target.value)}
                                    style={{
                                        padding: '10px 10px 10px 40px',
                                        borderRadius: '8px',
                                        border: '1px solid var(--color-border)',
                                        width: '100%',
                                        fontSize: '0.9rem',
                                        background: 'var(--color-bg-surface)'
                                    }}
                                />
                            </div>
                        </div>

                        <div>
                            <label className="form-label" style={{ fontSize: '0.85rem' }}>Status</label>
                            <select
                                value={status}
                                onChange={(e) => setStatus(e.target.value)}
                                style={{
                                    padding: '10px',
                                    borderRadius: '8px',
                                    border: '1px solid var(--color-border)',
                                    fontSize: '0.9rem',
                                    background: 'var(--color-bg-surface)',
                                    width: '100%'
                                }}
                            >
                                <option value="recebendo_proposta">Abertas (Propostas)</option>
                                <option value="todas">Todas</option>
                            </select>
                        </div>

                        <div>
                            <label className="form-label" style={{ fontSize: '0.85rem' }}>Estado (UF)</label>
                            <select
                                value={selectedUiState}
                                onChange={(e) => setSelectedUiState(e.target.value)}
                                style={{
                                    padding: '10px',
                                    borderRadius: '8px',
                                    border: '1px solid var(--color-border)',
                                    fontSize: '0.9rem',
                                    background: 'var(--color-bg-surface)',
                                    width: '100%'
                                }}
                            >
                                <option value="">Brasil (Todas)</option>
                                {UFS.map(uf => <option key={uf} value={uf}>{uf}</option>)}
                            </select>
                        </div>

                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                            <select
                                value={selectedSearchCompanyId}
                                onChange={(e) => setSelectedSearchCompanyId(e.target.value)}
                                style={{
                                    padding: '10px',
                                    borderRadius: '8px',
                                    border: '1px solid var(--color-border)',
                                    fontSize: '0.85rem',
                                    background: 'var(--color-bg-base)',
                                    maxWidth: '120px'
                                }}
                                title="Vincular à empresa"
                            >
                                <option value="">(Nenhuma Emp.)</option>
                                {companies.map(c => <option key={c.id} value={c.id}>{c.razaoSocial}</option>)}
                            </select>
                            <button type="button" className="btn btn-outline" onClick={clearSearch} title="Limpar Pesquisa" style={{ padding: '10px', borderRadius: '8px' }}>
                                <X size={18} />
                            </button>
                            <button type="button" className="btn btn-outline" onClick={handleSaveSearch} disabled={saving} title="Salvar Pesquisa" style={{ padding: '10px', borderRadius: '8px' }}>
                                {saving ? <Loader2 size={18} className="spinner" /> : <Save size={18} />}
                            </button>
                            <button type="submit" className="btn btn-primary" disabled={loading} style={{ padding: '10px 16px', borderRadius: '8px', gap: '8px' }}>
                                {loading ? <Loader2 size={18} className="spinner" /> : <Search size={18} />}
                                Buscar
                            </button>
                        </div>
                    </form>
                </div>

                <div style={{ background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', overflow: 'hidden', flex: 1 }}>
                    <table className="table">
                        <thead>
                            <tr>
                                <th style={{ paddingLeft: '24px' }}>Órgão / UF</th>
                                <th>Objeto</th>
                                <th>Data Abertura</th>
                                <th>Valor Est.</th>
                                <th style={{ paddingRight: '24px' }}>Ações</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr>
                                    <td colSpan={5} style={{ textAlign: 'center', padding: '40px' }}>
                                        <Loader2 size={32} className="spinner" style={{ margin: '0 auto', color: 'var(--color-primary)' }} />
                                    </td>
                                </tr>
                            ) : results.length === 0 ? (
                                <tr>
                                    <td colSpan={5} style={{ textAlign: 'center', padding: '40px', color: 'var(--color-text-tertiary)' }}>
                                        Nenhum edital encontrado.
                                    </td>
                                </tr>
                            ) : (
                                results.map((item) => (
                                    <tr key={item.id}>
                                        <td style={{ paddingLeft: '24px' }}>
                                            <div style={{ fontWeight: 500 }}>{item.orgao_nome}</div>
                                            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>{item.municipio} - {item.uf}</div>
                                        </td>
                                        <td style={{ maxWidth: '400px' }}>
                                            <div style={{ fontWeight: 500 }}>{item.titulo}</div>
                                            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                                                {item.objeto}
                                            </div>
                                        </td>
                                        <td style={{ whiteSpace: 'nowrap' }}>
                                            <div style={{ fontWeight: 500 }}>{new Date(item.data_abertura).toLocaleDateString()}</div>
                                            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>{new Date(item.data_abertura).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                                        </td>
                                        <td style={{ fontWeight: 600, color: 'var(--color-success)' }}>
                                            {item.valor_estimado ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.valor_estimado) : 'N/D'}
                                        </td>
                                        <td style={{ paddingRight: '24px' }}>
                                            <div style={{ display: 'flex', gap: '8px' }}>
                                                <button className="btn btn-outline" style={{ padding: '8px' }} onClick={() => handleImportToFunnel(item)} title="Importar para o Funil">
                                                    <Plus size={16} />
                                                </button>
                                                <a href={item.link_sistema} target="_blank" rel="noreferrer" className="btn btn-ghost" style={{ padding: '8px' }} title="Abrir no PNCP">
                                                    <ExternalLink size={16} />
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

                            // Adjust if at outer edges
                            if (page <= 3 && totalPages >= 5) end = 5;
                            if (page >= totalPages - 2 && totalPages >= 5) start = totalPages - 4;

                            for (let i = start; i <= end; i++) {
                                pages.push(
                                    <button
                                        key={i}
                                        onClick={() => setPage(i)}
                                        style={{
                                            padding: '6px 14px',
                                            borderRadius: '6px',
                                            border: i === page ? 'none' : '1px solid var(--color-border)',
                                            background: i === page ? 'var(--color-primary)' : 'transparent',
                                            color: i === page ? 'white' : 'var(--color-text)',
                                            fontSize: '0.875rem',
                                            fontWeight: i === page ? 600 : 400,
                                            cursor: 'pointer',
                                            transition: 'all 0.1s'
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
                                padding: '16px 20px',
                                borderTop: '1px solid var(--color-border)',
                                background: 'var(--color-bg-surface)'
                            }}>
                                <span style={{ fontSize: '0.875rem', color: 'var(--color-text-tertiary)' }}>
                                    Página {page} de {totalPages} ({totalResults} resultados)
                                </span>
                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                    <button
                                        className="btn btn-outline"
                                        style={{ padding: '6px 14px', borderRadius: '6px', fontSize: '0.875rem' }}
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
                                        style={{ padding: '6px 14px', borderRadius: '6px', fontSize: '0.875rem' }}
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
