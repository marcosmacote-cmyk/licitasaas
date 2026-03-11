import { useState, useEffect } from 'react';
import { Search, Save, Loader2, Bookmark, ExternalLink, Plus, X, ChevronDown, ChevronUp, Filter, Building2, Brain, Star, Trash2, CheckCircle2, Download, BarChart2 } from 'lucide-react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { API_BASE_URL } from '../config';
import type { CompanyProfile, PncpSavedSearch, PncpBiddingItem, BiddingProcess, AiAnalysis } from '../types';
import { ProcessFormModal } from './ProcessFormModal';
import { AiReportModal } from './AiReportModal';
import { v4 as uuidv4 } from 'uuid';

interface Props {
    companies: CompanyProfile[];
    onRefresh?: () => Promise<void>;
    items?: BiddingProcess[];
}

const UFS = [
    'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA',
    'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN',
    'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'
];

const ESFERAS = [
    { value: 'todas', label: 'Todas as Esferas' },
    { value: 'F', label: 'Federal' },
    { value: 'E', label: 'Estadual' },
    { value: 'M', label: 'Municipal' },
    { value: 'D', label: 'Distrital' },
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

export function PncpPage({ companies, onRefresh, items = [] }: Props) {
    const [savedSearches, setSavedSearches] = useState<PncpSavedSearch[]>([]);
    const [results, setResults] = useState<PncpBiddingItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

    // Form state
    const [keywords, setKeywords] = useState('');
    const [status, setStatus] = useState('recebendo_proposta');
    const [selectedUf, setSelectedUf] = useState('');
    const [selectedSearchCompanyId, setSelectedSearchCompanyId] = useState('');
    const [modalidade, setModalidade] = useState('todas');
    const [esfera, setEsfera] = useState('todas');
    const [orgao, setOrgao] = useState('');
    const [orgaosLista, setOrgaosLista] = useState('');
    const [dataInicio, setDataInicio] = useState('');
    const [dataFim, setDataFim] = useState('');
    const [page, setPage] = useState(1);
    const [totalResults, setTotalResults] = useState(0);

    // Modal state
    const [editingProcess, setEditingProcess] = useState<Partial<BiddingProcess> | null>(null);

    // AI Analysis state
    const [analyzingItemId, setAnalyzingItemId] = useState<string | null>(null);
    const [pncpAnalysis, setPncpAnalysis] = useState<{ process: Partial<BiddingProcess>; analysis: AiAnalysis } | null>(null);
    const [viewingAnalysisProcess, setViewingAnalysisProcess] = useState<BiddingProcess | null>(null);
    const [analyzedPncpItem, setAnalyzedPncpItem] = useState<PncpBiddingItem | null>(null);
    const [pendingAiAnalysis, setPendingAiAnalysis] = useState<AiAnalysis | null>(null);

    // Favoritos State
    const [favoritos, setFavoritos] = useState<PncpBiddingItem[]>(() => {
        const saved = localStorage.getItem('pncp_favoritos');
        return saved ? JSON.parse(saved) : [];
    });
    const [showFavoritosTab, setShowFavoritosTab] = useState(false);

    useEffect(() => {
        localStorage.setItem('pncp_favoritos', JSON.stringify(favoritos));
    }, [favoritos]);

    const toggleFavorito = (item: PncpBiddingItem) => {
        setFavoritos(prev => {
            const isFav = prev.some(f => f.id === item.id);
            if (isFav) return prev.filter(f => f.id !== item.id);
            return [...prev, item];
        });
    };

    const displayItems = showFavoritosTab ? [...favoritos].sort((a, b) => {
        const dateA = new Date(a.data_encerramento_proposta || a.data_abertura || Date.now());
        const dateB = new Date(b.data_encerramento_proposta || b.data_abertura || Date.now());
        return dateA.getTime() - dateB.getTime();
    }) : results;

    useEffect(() => {
        const checkExpired = () => {
            const now = new Date();
            setFavoritos(prev => {
                const filtered = prev.filter(f => {
                    if (!f.data_encerramento_proposta && !f.data_abertura) return true;
                    // Se a data e hora do termino for menor que o momento atual, retira dos favoritos (pois já encerrou)
                    const sessao = new Date(f.data_encerramento_proposta || f.data_abertura || Date.now());
                    return sessao.getTime() >= now.getTime();
                });
                if (filtered.length !== prev.length) return filtered;
                return prev;
            });
        };

        checkExpired(); // primeira checagem assim que monta
        const interval = setInterval(checkExpired, 60000); // 1 minuto
        return () => clearInterval(interval);
    }, []);

    const exportFavoritesToPdf = () => {
        if (favoritos.length === 0) {
            alert("Não há licitações favoritadas.");
            return;
        }

        const doc = new jsPDF('l', 'mm', 'a4');
        doc.setFontSize(16);
        doc.text("Relatório de Licitações Favoritas (PNCP)", 14, 20);

        doc.setFontSize(10);
        doc.text(`Data da Exportação: ${new Date().toLocaleDateString('pt-BR')}`, 14, 28);

        const tableColumn = ["Órgão", "Mod. / N°", "Objeto", "Prazo Limite", "Val. Est. (R$)", "Município", "Link PNCP"];
        const tableRows: any[][] = [];

        const sortedFavoritos = [...favoritos].sort((a, b) => {
            const dateA = new Date(a.data_encerramento_proposta || a.data_abertura || Date.now());
            const dateB = new Date(b.data_encerramento_proposta || b.data_abertura || Date.now());
            return dateA.getTime() - dateB.getTime();
        });

        sortedFavoritos.forEach(item => {
            const rowData = [
                item.orgao_nome,
                `${item.modalidade_nome}\n${item.ano}/${item.numero_sequencial}`,
                item.objeto.length > 90 ? item.objeto.substring(0, 87) + '...' : item.objeto,
                item.data_encerramento_proposta
                    ? `${new Date(item.data_encerramento_proposta).toLocaleDateString('pt-BR')} às ${new Date(item.data_encerramento_proposta).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
                    : '-',
                item.valor_estimado ? item.valor_estimado.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '-',
                item.municipio ? `${item.municipio}-${item.uf}` : item.uf,
                ''
            ];
            tableRows.push(rowData);
        });

        autoTable(doc, {
            head: [tableColumn],
            body: tableRows,
            startY: 35,
            styles: { fontSize: 8 },
            headStyles: { fillColor: [37, 99, 235] },
            columnStyles: { 2: { cellWidth: 70 }, 6: { cellWidth: 35 } },
            didDrawCell: (data) => {
                if (data.section === 'body' && data.column.index === 6) {
                    const item = sortedFavoritos[data.row.index];
                    if (item && item.link_sistema) {
                        doc.setTextColor(37, 99, 235);
                        doc.textWithLink("Acessar no PNCP", data.cell.x + 2, data.cell.y + 5, { url: item.link_sistema });
                    }
                }
            }
        });

        doc.save(`licitacoes-favoritas-${new Date().toISOString().split('T')[0]}.pdf`);
    };

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

    const handleSearch = async (e?: React.FormEvent, overrides?: { keywords?: string; status?: string; uf?: string; modalidade?: string; dataInicio?: string; dataFim?: string; esfera?: string; orgao?: string; orgaosLista?: string }) => {
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
                    esfera: overrides?.esfera ?? esfera,
                    orgao: overrides?.orgao ?? orgao,
                    orgaosLista: overrides?.orgaosLista ?? orgaosLista,
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
                    companyProfileId: selectedSearchCompanyId || undefined,
                    states: JSON.stringify({
                        uf: selectedUf,
                        modalidade,
                        esfera,
                        orgao,
                        orgaosLista,
                        dataInicio,
                        dataFim
                    })
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

        let customState = {
            uf: '',
            modalidade: 'todas',
            esfera: 'todas',
            orgao: '',
            orgaosLista: '',
            dataInicio: '',
            dataFim: ''
        };

        try {
            const parsedStates = JSON.parse(search.states || '{}');
            if (Array.isArray(parsedStates)) {
                // Backward compatibility for old saved searches that just stored [uf]
                customState.uf = parsedStates[0] || '';
            } else if (typeof parsedStates === 'object' && parsedStates !== null) {
                customState = { ...customState, ...parsedStates };
            }
        } catch {
            // retain defaults
        }

        // Update form state for display
        setKeywords(searchKeywords);
        setStatus(searchStatus);
        setSelectedSearchCompanyId(search.companyProfileId || '');
        setSelectedUf(customState.uf);
        setModalidade(customState.modalidade);
        setEsfera(customState.esfera);
        setOrgao(customState.orgao);
        setOrgaosLista(customState.orgaosLista);
        setDataInicio(customState.dataInicio);
        setDataFim(customState.dataFim);
        setPage(1);

        // Execute search immediately with the saved values (bypass stale state)
        handleSearch(undefined, {
            keywords: searchKeywords,
            status: searchStatus,
            uf: customState.uf,
            modalidade: customState.modalidade,
            esfera: customState.esfera,
            orgao: customState.orgao,
            orgaosLista: customState.orgaosLista,
            dataInicio: customState.dataInicio,
            dataFim: customState.dataFim
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
        setSelectedUf('');
        setSelectedSearchCompanyId('');
        setModalidade('todas');
        setEsfera('todas');
        setOrgao('');
        setOrgaosLista('');
        setDataInicio('');
        setDataFim('');
        setResults([]);
        setTotalResults(0);
        setPage(1);
    };

    const handleImportToFunnel = (item: PncpBiddingItem, aiData?: { process: Partial<BiddingProcess>; analysis: AiAnalysis }) => {
        // Verifica se a licitação já existe no Kanban checando o link_sistema
        if (items) {
            const existingProcess = items.find(p => p.link && p.link === item.link_sistema);
            if (existingProcess) {
                const isCaptado = existingProcess.status === 'Captado';
                const locationStr = isCaptado ? 'na coluna "Captada"' : `na coluna "${existingProcess.status}"`;
                if (!window.confirm(`⚠️ AVISO DE DUPLICIDADE\n\nEsta licitação aparentemente já está no seu funil (${locationStr}).\n\nTem certeza que deseja importar novamente e criar uma duplicidade?`)) {
                    return;
                }
            }
        }

        let bestPortalName = "PNCP";
        if (companies.length > 0) {
            const allCreds = companies.flatMap(c => c.credentials || []);
            const link = (item.link_sistema || '').toLowerCase();
            const match = allCreds.find(c => {
                const cu = (c.url || '').toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
                return cu && link.includes(cu.split('/')[0]); // simple domain check
            });

            if (match) {
                bestPortalName = match.platform;
            } else if (link.includes('comprasnet') || link.includes('gov.br/compras')) {
                bestPortalName = "ComprasNet";
            } else if (link.includes('bll.org')) {
                bestPortalName = "BLL";
            } else if (link.includes('bnccompras') || link.includes('bnc.org.br')) {
                bestPortalName = "BNC";
            } else if (link.includes('licitacoes-e')) {
                bestPortalName = "Licitações-e (BB)";
            } else if (link.includes('portaldecompraspublicas')) {
                bestPortalName = "Portal de Compras Públicas";
            } else if (link.includes('bec.sp')) {
                bestPortalName = "BEC/SP";
            }
        }

        const processData: Partial<BiddingProcess> = {
            title: aiData?.process?.title || item.titulo,
            summary: aiData?.process?.summary || item.objeto,
            portal: aiData?.process?.portal || bestPortalName,
            modality: aiData?.process?.modality || item.modalidade_nome || "Não Informado (PNCP)",
            status: "Captado",
            estimatedValue: aiData?.process?.estimatedValue || item.valor_estimado || 0,
            sessionDate: item.data_encerramento_proposta
                ? new Date(item.data_encerramento_proposta).toISOString()
                : (item.data_abertura ? new Date(item.data_abertura).toISOString() : new Date().toISOString()),
            link: item.link_sistema,
            pncpLink: item.link_sistema,
            risk: aiData?.process?.risk || 'Médio',
            companyProfileId: selectedSearchCompanyId || (companies.length > 0 ? companies[0].id : ''),
            observations: JSON.stringify([{
                id: crypto.randomUUID?.() || Date.now().toString(),
                text: `Importado do PNCP | Órgão: ${item.orgao_nome} | ${item.municipio}-${item.uf}${item.data_encerramento_proposta ? ' | Prazo Limite: ' + new Date(item.data_encerramento_proposta).toLocaleString('pt-BR') : ''}`,
                createdAt: new Date().toISOString(),
                author: 'Sistema'
            }])
        };
        setEditingProcess(processData);
    };

    // AI Analysis for PNCP items (fetches PDFs directly from PNCP)
    const handlePncpAiAnalyze = async (item: PncpBiddingItem) => {
        if (analyzingItemId) return; // prevent double-click
        setAnalyzingItemId(item.id);
        setAnalyzedPncpItem(item);
        try {
            const token = localStorage.getItem('token');
            const response = await fetch(`${API_BASE_URL}/api/pncp/analyze`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    orgao_cnpj: item.orgao_cnpj,
                    ano: item.ano,
                    numero_sequencial: item.numero_sequencial,
                    link_sistema: item.link_sistema
                })
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error || 'Falha na análise IA');
            }

            const aiData = await response.json();
            const processObj = aiData.process || {};
            const analysisObj = aiData.analysis || {};

            const analysisData: AiAnalysis = {
                id: uuidv4(),
                biddingProcessId: '',
                requiredDocuments: JSON.stringify(analysisObj.requiredDocuments || []),
                pricingConsiderations: analysisObj.pricingConsiderations || '',
                irregularitiesFlags: JSON.stringify(analysisObj.irregularitiesFlags || []),
                fullSummary: analysisObj.fullSummary || '',
                deadlines: JSON.stringify(analysisObj.deadlines || []),
                penalties: analysisObj.penalties || '',
                qualificationRequirements: analysisObj.qualificationRequirements || '',
                biddingItems: analysisObj.biddingItems || '',
                sourceFileNames: JSON.stringify(aiData.pncpSource?.downloadedFiles || []),
                analyzedAt: new Date().toISOString()
            };

            const fakeProcess: BiddingProcess = {
                id: `pncp-${item.id}`,
                title: processObj.title || item.titulo,
                summary: processObj.summary || item.objeto,
                portal: 'PNCP',
                modality: processObj.modality || item.modalidade_nome || '',
                status: 'Captado',
                estimatedValue: processObj.estimatedValue || item.valor_estimado || 0,
                sessionDate: item.data_encerramento_proposta || item.data_abertura || new Date().toISOString(),
                link: item.link_sistema,
                pncpLink: item.link_sistema,
                risk: processObj.risk || 'Médio',
                companyProfileId: selectedSearchCompanyId || '',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                observations: '[]'
            } as BiddingProcess;

            setPncpAnalysis({ process: processObj, analysis: analysisData });
            setViewingAnalysisProcess(fakeProcess);

        } catch (error: any) {
            console.error('PNCP AI Analysis error:', error);
            alert(`Erro na análise IA: ${error.message}`);
        } finally {
            setAnalyzingItemId(null);
        }
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
                // Save AI analysis if provided (either from form or from PNCP analysis)
                const analysisToSave = aiData || pendingAiAnalysis;
                if (analysisToSave) {
                    await fetch(`${API_BASE_URL}/api/analysis`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ ...analysisToSave, biddingProcessId: savedProcess.id })
                    });
                }
                alert("Licitação importada com sucesso para o Funil!" + (analysisToSave ? " (com análise IA)" : ""));
                setEditingProcess(null);
                setPendingAiAnalysis(null);
                setPncpAnalysis(null);
                setAnalyzedPncpItem(null);
                // Refresh global data so Licitações tab shows the new card
                if (onRefresh) await onRefresh();
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
        esfera !== 'todas',
        orgao !== '',
        orgaosLista.trim() !== '',
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
            <div className="page-header" style={{ marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px' }}>
                <div>
                    <h1 className="page-title">Busca PNCP</h1>
                    <p className="page-subtitle">Pesquise editais diretamente no Portal Nacional de Contratações Públicas.</p>
                </div>
                {/* ── Dashboard Indicators ── */}
                <div style={{ display: 'flex', gap: '12px', overflowX: 'auto', paddingBottom: '4px' }}>
                    <div style={{ background: 'var(--color-bg-surface)', padding: '12px 16px', borderRadius: '12px', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)', minWidth: '120px' }}>
                        <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', marginBottom: '2px', display: 'flex', alignItems: 'center', gap: '4px' }}><BarChart2 size={12} /> Descobertos</div>
                        <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-text-primary)' }}>{totalResults.toLocaleString('pt-BR')}</div>
                    </div>
                    <div style={{ background: 'var(--color-bg-surface)', padding: '12px 16px', borderRadius: '12px', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)', minWidth: '120px' }}>
                        <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', marginBottom: '2px', display: 'flex', alignItems: 'center', gap: '4px' }}><Bookmark size={12} /> No Funil</div>
                        <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-primary)' }}>{items?.length || 0}</div>
                    </div>
                    <div style={{ background: 'var(--color-bg-surface)', padding: '12px 16px', borderRadius: '12px', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)', minWidth: '120px' }}>
                        <div style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', marginBottom: '2px', display: 'flex', alignItems: 'center', gap: '4px' }}><Star size={12} /> Favoritos</div>
                        <div style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-warning)' }}>{favoritos.length}</div>
                    </div>
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
                                    placeholder="Ex: Serviços de TI, Transporte Escolar (Use vírgulas para buscar vários ao mesmo tempo)"
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
                                <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, marginBottom: '6px', color: 'var(--color-text-secondary)' }}>Esfera de Governo</label>
                                <select value={esfera} onChange={(e) => setEsfera(e.target.value)} style={selectStyle}>
                                    {ESFERAS.map(e => <option key={e.value} value={e.value}>{e.label}</option>)}
                                </select>
                            </div>

                            <div>
                                <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, marginBottom: '6px', color: 'var(--color-text-secondary)' }}>Órgão (Nome ou CNPJ)</label>
                                <input type="text" placeholder="Ex: Comando da Marinha" value={orgao} onChange={(e) => setOrgao(e.target.value)} style={selectStyle} />
                            </div>

                            <div style={{ gridColumn: '1 / -1' }}>
                                <label style={{ display: 'block', fontSize: '0.8125rem', fontWeight: 600, marginBottom: '6px', color: 'var(--color-text-secondary)' }}>Lista de Nomes ou CNPJs de Órgãos (Busca Múltipla Rápida)</label>
                                <textarea
                                    placeholder="Cole aqui a lista de nomes de prefeituras/órgãos ou seus CNPJs que deseja buscar de uma vez, separados por vírgula ou quebra de linha... (Vai cruzar tudo numa lista só de uma vez!)"
                                    value={orgaosLista}
                                    onChange={(e) => setOrgaosLista(e.target.value)}
                                    style={{
                                        ...selectStyle,
                                        minHeight: '60px',
                                        resize: 'vertical',
                                        fontFamily: 'monospace',
                                        fontSize: '0.8125rem'
                                    }}
                                />
                                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)', marginTop: '4px' }}>
                                    Pode misturar exato (CNPJ com ou sem pontuação) ou nomes aproximados (ex: Prefeitura Municipal de Limoeiro do Norte).
                                </div>
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

            {/* Results Summary and Tabs */}
            <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                marginBottom: '16px', padding: '0 4px', borderBottom: '1px solid var(--color-border)', paddingBottom: '0'
            }}>
                <div style={{ display: 'flex', gap: '24px' }}>
                    <button
                        onClick={() => setShowFavoritosTab(false)}
                        style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            fontSize: '0.875rem', fontWeight: !showFavoritosTab ? 600 : 500,
                            color: !showFavoritosTab ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                            borderBottom: !showFavoritosTab ? '2px solid var(--color-primary)' : '2px solid transparent',
                            paddingBottom: '12px', transition: 'all 0.2s', margin: 0
                        }}
                    >
                        Resultados da Busca {results.length > 0 && `(${totalResults || results.length})`}
                    </button>
                    <button
                        onClick={() => setShowFavoritosTab(true)}
                        style={{
                            display: 'flex', alignItems: 'center', gap: '6px',
                            background: 'none', border: 'none', cursor: 'pointer',
                            fontSize: '0.875rem', fontWeight: showFavoritosTab ? 600 : 500,
                            color: showFavoritosTab ? 'var(--color-warning)' : 'var(--color-text-secondary)',
                            borderBottom: showFavoritosTab ? '2px solid var(--color-warning)' : '2px solid transparent',
                            paddingBottom: '12px', transition: 'all 0.2s', margin: 0
                        }}
                    >
                        <Star size={16} fill={showFavoritosTab ? "currentColor" : "none"} color={showFavoritosTab ? "currentColor" : "currentColor"} />
                        Favoritos {favoritos.length > 0 && `(${favoritos.length})`}
                    </button>
                </div>
            </div>

            {/* Results Table Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '16px', marginTop: '32px' }}>
                <h3 style={{ fontSize: '1.125rem', fontWeight: 600, color: 'var(--color-text-primary)', margin: 0 }}>
                    {showFavoritosTab ? 'Licitações Favoritadas' : 'Resultados da Pesquisa'}
                </h3>
                {showFavoritosTab && favoritos.length > 0 && (
                    <button className="btn btn-primary" onClick={exportFavoritesToPdf} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 16px' }}>
                        <Download size={16} /> Exportar Relatório PDF
                    </button>
                )}
            </div>

            {/* Results Table */}
            <div style={{ background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
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
                        {loading ? (
                            <tr>
                                <td colSpan={6} style={{ textAlign: 'center', padding: '60px' }}>
                                    <Loader2 size={32} className="spinner" style={{ margin: '0 auto', color: 'var(--color-primary)' }} />
                                    <div style={{ marginTop: '12px', color: 'var(--color-text-tertiary)', fontSize: '0.875rem' }}>Consultando PNCP...</div>
                                </td>
                            </tr>
                        ) : displayItems.length === 0 ? (
                            <tr>
                                <td colSpan={6} style={{ textAlign: 'center', padding: '60px', color: 'var(--color-text-tertiary)' }}>
                                    {showFavoritosTab ? <Star size={40} style={{ margin: '0 auto 12px', opacity: 0.3 }} /> : <Search size={40} style={{ margin: '0 auto 12px', opacity: 0.3 }} />}
                                    <div style={{ fontSize: '1rem', fontWeight: 500 }}>{showFavoritosTab ? 'Nenhum edital nos favoritos' : 'Nenhum edital encontrado'}</div>
                                    <div style={{ fontSize: '0.8125rem', marginTop: '4px' }}>{showFavoritosTab ? 'Clique na estrela para favoritar resultados.' : 'Tente ajustar as palavras-chave ou filtros.'}</div>
                                </td>
                            </tr>
                        ) : (
                            displayItems.map((item) => {
                                const isFavorito = favoritos.some(f => f.id === item.id);
                                const isOnKanban = items.some(p => p.link && p.link === item.link_sistema);

                                return (
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
                                            <div style={{ fontWeight: 600, fontSize: '0.8125rem', marginBottom: '4px', lineHeight: '1.3' }}>
                                                {item.titulo}
                                                {showFavoritosTab && isOnKanban && (
                                                    <span style={{
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        gap: '4px',
                                                        marginLeft: '8px',
                                                        padding: '3px 8px',
                                                        background: 'rgba(16, 185, 129, 0.1)',
                                                        color: 'var(--color-success)',
                                                        borderRadius: '12px',
                                                        fontSize: '0.7rem',
                                                        fontWeight: 700,
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
                                                    onClick={() => toggleFavorito(item)}
                                                    style={{ padding: '7px', borderRadius: '8px', color: isFavorito ? 'var(--color-warning)' : 'var(--color-text-tertiary)', background: isFavorito ? 'rgba(245, 158, 11, 0.1)' : 'transparent' }}
                                                    title={isFavorito ? "Remover dos Favoritos" : "Adicionar aos Favoritos"}
                                                >
                                                    <Star size={15} fill={isFavorito ? "currentColor" : "none"} />
                                                </button>
                                                {isFavorito && (
                                                    <button
                                                        className="btn btn-ghost"
                                                        onClick={() => toggleFavorito(item)}
                                                        style={{ padding: '7px', borderRadius: '8px', color: 'var(--color-danger)', background: 'rgba(239, 68, 68, 0.05)' }}
                                                        title="Excluir dos Favoritos"
                                                    >
                                                        <Trash2 size={15} />
                                                    </button>
                                                )}
                                                <button
                                                    className="btn btn-primary"
                                                    style={{ padding: '7px 12px', fontSize: '0.75rem', borderRadius: '8px', gap: '4px', whiteSpace: 'nowrap' }}
                                                    onClick={() => handleImportToFunnel(item)}
                                                    title="Importar para o Funil de Licitações"
                                                >
                                                    <Plus size={14} /> Importar
                                                </button>
                                                <button
                                                    className="btn"
                                                    style={{
                                                        padding: '7px 12px',
                                                        fontSize: '0.75rem',
                                                        borderRadius: '8px',
                                                        gap: '4px',
                                                        whiteSpace: 'nowrap',
                                                        background: analyzingItemId === item.id ? 'linear-gradient(135deg, #6366f1, #8b5cf6)' : 'linear-gradient(135deg, #3b82f6, #8b5cf6)',
                                                        color: 'white',
                                                        border: 'none',
                                                        cursor: analyzingItemId ? 'not-allowed' : 'pointer',
                                                        opacity: (analyzingItemId && analyzingItemId !== item.id) ? 0.5 : 1,
                                                        boxShadow: '0 2px 8px rgba(99, 102, 241, 0.3)',
                                                        transition: 'all 0.2s'
                                                    }}
                                                    onClick={() => handlePncpAiAnalyze(item)}
                                                    disabled={!!analyzingItemId}
                                                    title="Analisar edital com IA (busca PDFs do PNCP automaticamente)"
                                                >
                                                    {analyzingItemId === item.id ? (
                                                        <><Loader2 size={14} className="spinner" /> Analisando...</>
                                                    ) : (
                                                        <><Brain size={14} /> IA</>
                                                    )}
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
                                )
                            })
                        )}
                    </tbody>
                </table>

                {/* Pagination Controls */}
                {!showFavoritosTab && displayItems.length > 0 && totalResults > 0 && (() => {
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
                    onClose={() => {
                        setEditingProcess(null);
                        setPendingAiAnalysis(null);
                    }}
                    onSave={(data, aiData) => {
                        handleSaveProcess(data, aiData);
                    }}
                />
            )}

            {/* AI Report Modal for PNCP Analysis */}
            {viewingAnalysisProcess && pncpAnalysis && (
                <AiReportModal
                    analysis={pncpAnalysis.analysis}
                    process={viewingAnalysisProcess}
                    onClose={() => {
                        setViewingAnalysisProcess(null);
                        setPncpAnalysis(null);
                        setAnalyzedPncpItem(null);
                    }}
                    onUpdate={() => { }}
                    onImport={() => {
                        // Close report modal
                        setViewingAnalysisProcess(null);
                        // Store the AI analysis for saving with the process
                        setPendingAiAnalysis(pncpAnalysis.analysis);
                        // Open form pre-filled with AI + PNCP data
                        if (analyzedPncpItem) {
                            handleImportToFunnel(analyzedPncpItem, pncpAnalysis);
                        } else {
                            // Fallback: use AI process data directly  
                            setEditingProcess({
                                ...pncpAnalysis.process,
                                portal: 'PNCP',
                                status: 'Captado',
                                companyProfileId: selectedSearchCompanyId || (companies.length > 0 ? companies[0].id : ''),
                            });
                        }
                    }}
                />
            )}
        </div>
    );
}
