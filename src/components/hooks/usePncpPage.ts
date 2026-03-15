import { useState, useEffect, useMemo } from 'react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { API_BASE_URL } from '../../config';
import type { CompanyProfile, PncpSavedSearch, PncpBiddingItem, BiddingProcess, AiAnalysis } from '../../types';
import { useToast } from '../ui';
import { v4 as uuidv4 } from 'uuid';

export const UFS = [
    'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA',
    'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN',
    'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'
];

export const ESFERAS = [
    { value: 'todas', label: 'Todas as Esferas' },
    { value: 'F', label: 'Federal' },
    { value: 'E', label: 'Estadual' },
    { value: 'M', label: 'Municipal' },
    { value: 'D', label: 'Distrital' },
];

export const MODALIDADES = [
    { value: 'todas', label: 'Todas as Modalidades' },
    { value: '1', label: 'Pregão Eletrônico' },
    { value: '2', label: 'Concorrência' },
    { value: '3', label: 'Concurso' },
    { value: '4', label: 'Leilão' },
    { value: '5', label: 'Diálogo Competitivo' },
    { value: '6', label: 'Dispensa de Licitação' },
    { value: '7', label: 'Inexigibilidade' },
];

export const STATUS_OPTIONS = [
    { value: 'recebendo_proposta', label: 'Abertas (Recebendo Propostas)' },
    { value: 'encerrada', label: 'Encerradas' },
    { value: 'suspensa', label: 'Suspensas' },
    { value: 'anulada', label: 'Anuladas' },
    { value: 'todas', label: 'Todas' },
];

// ─── Multi-list Favorites Data ───
const DEFAULT_FAV_LIST = 'Favoritos Gerais';

interface FavList {
    id: string;
    name: string;
    createdAt: string;
}

interface FavItemWithList extends PncpBiddingItem {
    _listId: string; // Which list this item belongs to
}

interface FavStore {
    version: 2;
    lists: FavList[];
    items: FavItemWithList[];
}

function loadFavStore(): FavStore {
    // Try V2 first
    try {
        const raw = localStorage.getItem('pncp_favoritos_v2');
        if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed.version === 2) return parsed;
        }
    } catch { }

    // Migrate V1 (flat array) → V2
    const defaultList: FavList = { id: 'default', name: DEFAULT_FAV_LIST, createdAt: new Date().toISOString() };
    try {
        const oldRaw = localStorage.getItem('pncp_favoritos');
        if (oldRaw) {
            const oldItems: PncpBiddingItem[] = JSON.parse(oldRaw);
            if (Array.isArray(oldItems) && oldItems.length > 0) {
                const migratedItems = oldItems.map(item => ({ ...item, _listId: 'default' }));
                return { version: 2, lists: [defaultList], items: migratedItems };
            }
        }
    } catch { }

    return { version: 2, lists: [defaultList], items: [] };
}

function saveFavStore(store: FavStore) {
    localStorage.setItem('pncp_favoritos_v2', JSON.stringify(store));
    // Keep V1 in sync for backward compatibility
    localStorage.setItem('pncp_favoritos', JSON.stringify(store.items));
}

interface UsePncpPageParams {
    companies: CompanyProfile[];
    onRefresh?: () => Promise<void>;
    items?: BiddingProcess[];
}

export function usePncpPage({ companies, onRefresh, items = [] }: UsePncpPageParams) {
    const toast = useToast();
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
    const [excludeKeywords, setExcludeKeywords] = useState('');
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

    // ─── Multi-list Favorites State ───
    const [favStore, setFavStore] = useState<FavStore>(loadFavStore);
    const [activeFavListId, setActiveFavListId] = useState<string | null>(null); // null = show all
    const [showFavoritosTab, setShowFavoritosTab] = useState(false);
    const [confirmAction, setConfirmAction] = useState<{ type: string; message?: string; onConfirm: () => void } | null>(null);

    // List Picker state (shared between fav and search)
    const [listPickerOpen, setListPickerOpen] = useState(false);
    const [listPickerItem, setListPickerItem] = useState<PncpBiddingItem | null>(null);
    const [searchListPickerOpen, setSearchListPickerOpen] = useState(false);

    // Active search list filter
    const [activeSearchListName, setActiveSearchListName] = useState<string | null>(null);

    useEffect(() => { saveFavStore(favStore); }, [favStore]);

    // Computed: all favoritos (flat) for backward compat
    const favoritos = favStore.items as PncpBiddingItem[];

    // Computed: filtered favorites by active list
    const filteredFavoritos = useMemo(() => {
        const items = activeFavListId
            ? favStore.items.filter(f => f._listId === activeFavListId)
            : favStore.items;
        return [...items].sort((a, b) => {
            const dateA = new Date(a.data_encerramento_proposta || a.data_abertura || Date.now());
            const dateB = new Date(b.data_encerramento_proposta || b.data_abertura || Date.now());
            return dateA.getTime() - dateB.getTime();
        });
    }, [favStore, activeFavListId]);

    const displayItems = showFavoritosTab ? filteredFavoritos : results;

    // Expired cleanup
    useEffect(() => {
        const checkExpired = () => {
            const now = new Date();
            setFavStore(prev => {
                const filtered = prev.items.filter(f => {
                    if (!f.data_encerramento_proposta && !f.data_abertura) return true;
                    const sessao = new Date(f.data_encerramento_proposta || f.data_abertura || Date.now());
                    return sessao.getTime() >= now.getTime();
                });
                if (filtered.length !== prev.items.length) return { ...prev, items: filtered };
                return prev;
            });
        };
        checkExpired();
        const interval = setInterval(checkExpired, 60000);
        return () => clearInterval(interval);
    }, []);

    // ─── Multi-list Favorites API ───
    const favLists = useMemo(() => {
        const def = favStore.lists.filter(l => l.id === 'default');
        const rest = favStore.lists.filter(l => l.id !== 'default').sort((a, b) => a.name.localeCompare(b.name));
        return [...def, ...rest];
    }, [favStore.lists]);

    const createFavList = (name: string): FavList => {
        const newList: FavList = { id: uuidv4(), name: name.trim(), createdAt: new Date().toISOString() };
        setFavStore(prev => ({ ...prev, lists: [...prev.lists, newList] }));
        return newList;
    };

    const renameFavList = (listId: string, newName: string) => {
        const trimmed = newName.trim();
        if (!trimmed) return;
        setFavStore(prev => ({
            ...prev,
            lists: prev.lists.map(l => l.id === listId ? { ...l, name: trimmed } : l),
        }));
        toast.success(`Lista renomeada para "${trimmed}"`);
    };

    const deleteFavList = (listId: string) => {
        if (listId === 'default') { toast.warning('A lista padrão não pode ser excluída.'); return; }
        const listName = favLists.find(l => l.id === listId)?.name || 'lista';
        const itemCount = favStore.items.filter(i => i._listId === listId).length;
        setConfirmAction({
            type: 'deleteFavList',
            message: `Excluir a lista "${listName}"?${itemCount > 0 ? `\n\nOs ${itemCount} item(ns) serão movidos para "Favoritos Gerais".` : ''}`,
            onConfirm: () => {
                setFavStore(prev => ({
                    ...prev,
                    lists: prev.lists.filter(l => l.id !== listId),
                    items: prev.items.map(i => i._listId === listId ? { ...i, _listId: 'default' } : i),
                }));
                if (activeFavListId === listId) setActiveFavListId(null);
                setConfirmAction(null);
                toast.success(`Lista "${listName}" excluída. Itens movidos para "Favoritos Gerais".`);
            }
        });
    };

    const addToFavList = (item: PncpBiddingItem, listId: string) => {
        setFavStore(prev => {
            // Don't add if already in this list
            if (prev.items.some(f => f.id === item.id && f._listId === listId)) {
                return prev;
            }
            return { ...prev, items: [...prev.items, { ...item, _listId: listId }] };
        });
    };

    const removeFromFavList = (itemId: string, listId?: string) => {
        setFavStore(prev => ({
            ...prev,
            items: listId
                ? prev.items.filter(f => !(f.id === itemId && f._listId === listId))
                : prev.items.filter(f => f.id !== itemId),
        }));
    };

    // ALWAYS open list picker — user must choose which list to save to
    const startFavoritar = (item: PncpBiddingItem) => {
        setListPickerItem(item);
        setListPickerOpen(true);
    };

    // Toggle: if item exists in any list, remove from all; otherwise open picker
    const toggleFavorito = (item: PncpBiddingItem) => {
        const isInAnyList = favStore.items.some(f => f.id === item.id);
        if (isInAnyList) {
            removeFromFavList(item.id);
        } else {
            startFavoritar(item);
        }
    };

    const favListItemCount = (listId: string) => favStore.items.filter(f => f._listId === listId).length;

    const exportFavoritesToPdf = () => {
        const itemsToExport = filteredFavoritos;
        if (itemsToExport.length === 0) { toast.warning('Não há licitações favoritadas.'); return; }
        const listName = activeFavListId
            ? favLists.find(l => l.id === activeFavListId)?.name || 'Favoritos'
            : 'Favoritos (Todas as Listas)';
        const doc = new jsPDF('l', 'mm', 'a4');
        doc.setFontSize(16); doc.text(`Relatório: ${listName}`, 14, 20);
        doc.setFontSize(10); doc.text(`Data da Exportação: ${new Date().toLocaleDateString('pt-BR')}`, 14, 28);

        const tableColumn = ["Órgão", "Mod. / N°", "Objeto", "Prazo Limite", "Val. Est. (R$)", "Município", "Link PNCP"];
        const tableRows = itemsToExport.map(item => [
            item.orgao_nome,
            `${item.modalidade_nome}\n${item.ano}/${item.numero_sequencial}`,
            item.objeto.length > 90 ? item.objeto.substring(0, 87) + '...' : item.objeto,
            item.data_encerramento_proposta
                ? `${new Date(item.data_encerramento_proposta).toLocaleDateString('pt-BR')} às ${new Date(item.data_encerramento_proposta).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
                : '-',
            item.valor_estimado ? item.valor_estimado.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '-',
            item.municipio ? `${item.municipio}-${item.uf}` : item.uf,
            ''
        ]);

        autoTable(doc, {
            head: [tableColumn], body: tableRows, startY: 35,
            styles: { fontSize: 8 }, headStyles: { fillColor: [37, 99, 235] },
            columnStyles: { 2: { cellWidth: 70 }, 6: { cellWidth: 35 } },
            didDrawCell: (data) => {
                if (data.section === 'body' && data.column.index === 6) {
                    const item = itemsToExport[data.row.index];
                    if (item?.link_sistema) {
                        doc.setTextColor(37, 99, 235);
                        doc.textWithLink("Acessar no PNCP", data.cell.x + 2, data.cell.y + 5, { url: item.link_sistema });
                    }
                }
            }
        });
        doc.save(`licitacoes-${listName.toLowerCase().replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}.pdf`);
    };

    useEffect(() => { fetchSavedSearches(); }, []);

    const fetchSavedSearches = async () => {
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`${API_BASE_URL}/api/pncp/searches`, { headers: { 'Authorization': `Bearer ${token}` } });
            if (res.ok) { const data = await res.json(); setSavedSearches(data); }
        } catch (e) { console.error("Failed to fetch saved searches", e); }
    };

    const handleSearch = async (e?: React.FormEvent, overrides?: { keywords?: string; status?: string; uf?: string; modalidade?: string; dataInicio?: string; dataFim?: string; esfera?: string; orgao?: string; orgaosLista?: string; excludeKeywords?: string }) => {
        if (e) { e.preventDefault(); setPage(1); }
        setLoading(true);
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`${API_BASE_URL}/api/pncp/search`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    keywords: overrides?.keywords ?? keywords, status: overrides?.status ?? status,
                    uf: overrides?.uf ?? selectedUf, pagina: e ? 1 : page,
                    modalidade: overrides?.modalidade ?? modalidade,
                    dataInicio: (overrides?.dataInicio ?? dataInicio) || undefined,
                    dataFim: (overrides?.dataFim ?? dataFim) || undefined,
                    esfera: overrides?.esfera ?? esfera, orgao: overrides?.orgao ?? orgao,
                    orgaosLista: overrides?.orgaosLista ?? orgaosLista,
                    excludeKeywords: overrides?.excludeKeywords ?? excludeKeywords,
                })
            });
            if (res.ok) {
                const data = await res.json();
                const items = Array.isArray(data.items) ? data.items : (Array.isArray(data) ? data : []);
                setResults(items);
                setTotalResults(typeof data.total === 'number' ? data.total : items.length);
            } else { throw new Error("Erro na busca"); }
        } catch (e) { console.error(e); toast.error('Falha ao buscar editais. Tente novamente.'); }
        finally { setLoading(false); }
    };

    // ─── Multi-list Saved Searches ───
    const searchListNames = useMemo(() => {
        const names = new Set(savedSearches.map(s => s.listName || 'Pesquisas Gerais'));
        names.add('Pesquisas Gerais');
        const rest = [...names].filter(n => n !== 'Pesquisas Gerais').sort();
        return ['Pesquisas Gerais', ...rest];
    }, [savedSearches]);

    const filteredSavedSearches = useMemo(() => {
        if (!activeSearchListName) return savedSearches;
        return savedSearches.filter(s => (s.listName || 'Pesquisas Gerais') === activeSearchListName);
    }, [savedSearches, activeSearchListName]);

    const handleSaveSearch = async (listName?: string) => {
        // If no listName was provided (should not happen anymore), fallback
        const effectiveListName = listName || 'Pesquisas Gerais';

        const name = prompt("Defina um nome para esta pesquisa (ex: Equipamentos TI em SP):");
        if (!name) return;

        setSaving(true);
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`${API_BASE_URL}/api/pncp/searches`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name, keywords, status, companyProfileId: selectedSearchCompanyId || undefined,
                    listName: effectiveListName,
                    states: JSON.stringify({ uf: selectedUf, modalidade, esfera, orgao, orgaosLista, excludeKeywords, dataInicio, dataFim })
                })
            });
            if (res.ok) {
                fetchSavedSearches();
                toast.success(`Pesquisa salva em "${effectiveListName}"`);
            } else { throw new Error("Failed to save"); }
        } catch (e) { console.error(e); toast.error('Erro ao salvar pesquisa.'); }
        finally { setSaving(false); }
    };

    const renameSearchList = async (oldName: string, newName: string) => {
        const trimmed = newName.trim();
        if (!trimmed || trimmed === oldName) return;
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`${API_BASE_URL}/api/pncp/searches/list/rename`, {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ oldName, newName: trimmed })
            });
            if (res.ok) {
                fetchSavedSearches();
                if (activeSearchListName === oldName) setActiveSearchListName(trimmed);
                toast.success(`Lista renomeada para "${trimmed}"`);
            } else { throw new Error('Failed'); }
        } catch (e) { console.error(e); toast.error('Erro ao renomear lista.'); }
    };

    const deleteSearchList = (listName: string) => {
        if (listName === 'Pesquisas Gerais') { toast.warning('A lista padrão não pode ser excluída.'); return; }
        const count = savedSearches.filter(s => (s.listName || 'Pesquisas Gerais') === listName).length;
        setConfirmAction({
            type: 'deleteSearchList',
            message: `Excluir a lista "${listName}"?${count > 0 ? `\n\nAs ${count} pesquisa(s) serão movidas para "Pesquisas Gerais".` : ''}`,
            onConfirm: async () => {
                setConfirmAction(null);
                try {
                    const token = localStorage.getItem('token');
                    const res = await fetch(`${API_BASE_URL}/api/pncp/searches/list/${encodeURIComponent(listName)}`, {
                        method: 'DELETE',
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    if (res.ok) {
                        fetchSavedSearches();
                        if (activeSearchListName === listName) setActiveSearchListName(null);
                        toast.success(`Lista "${listName}" excluída. Pesquisas movidas para "Pesquisas Gerais".`);
                    } else { throw new Error('Failed'); }
                } catch (e) { console.error(e); toast.error('Erro ao excluir lista.'); }
            }
        });
    };

    // ALWAYS open list picker — user must choose which list to save to
    const startSaveSearch = () => {
        setSearchListPickerOpen(true);
    };

    const loadSavedSearch = (search: PncpSavedSearch) => {
        const searchKeywords = search.keywords || '';
        const searchStatus = search.status || 'recebendo_proposta';
        let customState = { uf: '', modalidade: 'todas', esfera: 'todas', orgao: '', orgaosLista: '', excludeKeywords: '', dataInicio: '', dataFim: '' };
        try {
            const parsedStates = JSON.parse(search.states || '{}');
            if (Array.isArray(parsedStates)) { customState.uf = parsedStates[0] || ''; }
            else if (typeof parsedStates === 'object' && parsedStates !== null) { customState = { ...customState, ...parsedStates }; }
        } catch { }

        setKeywords(searchKeywords); setStatus(searchStatus);
        setSelectedSearchCompanyId(search.companyProfileId || '');
        setSelectedUf(customState.uf); setModalidade(customState.modalidade);
        setEsfera(customState.esfera); setOrgao(customState.orgao);
        setOrgaosLista(customState.orgaosLista); setExcludeKeywords(customState.excludeKeywords);
        setDataInicio(customState.dataInicio); setDataFim(customState.dataFim);
        setPage(1);
        setShowFavoritosTab(false);

        handleSearch(undefined, {
            keywords: searchKeywords, status: searchStatus, uf: customState.uf,
            modalidade: customState.modalidade, esfera: customState.esfera,
            orgao: customState.orgao, orgaosLista: customState.orgaosLista,
            excludeKeywords: customState.excludeKeywords,
            dataInicio: customState.dataInicio, dataFim: customState.dataFim
        });
    };

    useEffect(() => { if (!loading) { handleSearch(); } }, [page]);

    const deleteSavedSearch = async (id: string, e?: React.MouseEvent) => {
        e?.stopPropagation();
        setConfirmAction({ type: 'deleteSearch', message: 'Excluir esta pesquisa salva?', onConfirm: async () => {
            setConfirmAction(null);
            try {
                const token = localStorage.getItem('token');
                const res = await fetch(`${API_BASE_URL}/api/pncp/searches/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
                if (res.ok) { fetchSavedSearches(); toast.success('Pesquisa excluída.'); }
            } catch (e) { console.error(e); }
        }});
    };

    const [editingSearch, setEditingSearch] = useState<PncpSavedSearch | null>(null);

    const updateSavedSearch = async (id: string, updates: Partial<{name: string; keywords: string; status: string; states: string; listName: string; companyProfileId: string}>) => {
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`${API_BASE_URL}/api/pncp/searches/${id}`, {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(updates)
            });
            if (res.ok) { fetchSavedSearches(); toast.success('Pesquisa atualizada.'); return true; }
            throw new Error('Failed');
        } catch (e) { console.error(e); toast.error('Erro ao atualizar pesquisa.'); return false; }
    };

    const clearSearch = () => {
        setKeywords(''); setStatus('recebendo_proposta'); setSelectedUf('');
        setSelectedSearchCompanyId(''); setModalidade('todas'); setEsfera('todas');
        setOrgao(''); setOrgaosLista(''); setExcludeKeywords(''); setDataInicio(''); setDataFim('');
        setResults([]); setTotalResults(0); setPage(1);
        setShowFavoritosTab(false);
    };

    const handleImportToFunnel = (item: PncpBiddingItem, aiData?: { process: Partial<BiddingProcess>; analysis: AiAnalysis }) => {
        if (items) {
            const existingProcess = items.find(p => p.link && p.link === item.link_sistema);
            if (existingProcess) {
                const isCaptado = existingProcess.status === 'Captado';
                const locationStr = isCaptado ? 'na coluna "Captada"' : `na coluna "${existingProcess.status}"`;
                setConfirmAction({
                    type: 'duplicate',
                    message: `Esta licitação aparentemente já está no seu funil (${locationStr}). Tem certeza que deseja importar novamente e criar uma duplicidade?`,
                    onConfirm: () => { setConfirmAction(null); doImport(item, aiData); }
                });
                return;
            }
        }
        doImport(item, aiData);
    };

    const doImport = (item: PncpBiddingItem, aiData?: { process: Partial<BiddingProcess>; analysis: AiAnalysis }) => {
        let bestPortalName = "PNCP";
        if (companies.length > 0) {
            const allCreds = companies.flatMap(c => c.credentials || []);
            const link = (item.link_sistema || '').toLowerCase();
            const match = allCreds.find(c => {
                const cu = (c.url || '').toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
                return cu && link.includes(cu.split('/')[0]);
            });
            if (match) { bestPortalName = match.platform; }
            else if (link.includes('comprasnet') || link.includes('gov.br/compras')) { bestPortalName = "ComprasNet"; }
            else if (link.includes('bll.org')) { bestPortalName = "BLL"; }
            else if (link.includes('bnccompras') || link.includes('bnc.org.br')) { bestPortalName = "BNC"; }
            else if (link.includes('licitacoes-e')) { bestPortalName = "Licitações-e (BB)"; }
            else if (link.includes('portaldecompraspublicas')) { bestPortalName = "Portal de Compras Públicas"; }
            else if (link.includes('bec.sp')) { bestPortalName = "BEC/SP"; }
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
            link: item.link_sistema, pncpLink: item.link_sistema,
            risk: aiData?.process?.risk || 'Médio',
            companyProfileId: selectedSearchCompanyId || (companies.length > 0 ? companies[0].id : ''),
            observations: JSON.stringify([{
                id: crypto.randomUUID?.() || Date.now().toString(),
                text: `Importado do PNCP | Órgão: ${item.orgao_nome} | ${item.municipio}-${item.uf}${item.data_encerramento_proposta ? ' | Prazo Limite: ' + new Date(item.data_encerramento_proposta).toLocaleString('pt-BR') : ''}`,
                createdAt: new Date().toISOString(), author: 'Sistema'
            }])
        };
        setEditingProcess(processData);
    };

    const handlePncpAiAnalyze = async (item: PncpBiddingItem) => {
        if (analyzingItemId) return;
        setAnalyzingItemId(item.id);
        setAnalyzedPncpItem(item);
        try {
            const token = localStorage.getItem('token');
            const response = await fetch(`${API_BASE_URL}/api/pncp/analyze`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ orgao_cnpj: item.orgao_cnpj, ano: item.ano, numero_sequencial: item.numero_sequencial, link_sistema: item.link_sistema })
            });
            if (!response.ok) { const errData = await response.json().catch(() => ({})); throw new Error(errData.error || 'Falha na análise IA'); }

            const aiData = await response.json();
            const processObj = aiData.process || {};
            const analysisObj = aiData.analysis || {};

            const analysisData: AiAnalysis = {
                id: uuidv4(), biddingProcessId: '',
                requiredDocuments: JSON.stringify(analysisObj.requiredDocuments || []),
                pricingConsiderations: analysisObj.pricingConsiderations || '',
                irregularitiesFlags: JSON.stringify(analysisObj.irregularitiesFlags || []),
                fullSummary: analysisObj.fullSummary || '',
                deadlines: JSON.stringify(analysisObj.deadlines || []),
                penalties: analysisObj.penalties || '',
                qualificationRequirements: analysisObj.qualificationRequirements || '',
                biddingItems: analysisObj.biddingItems || '',
                sourceFileNames: JSON.stringify(aiData.pncpSource?.downloadedFiles || []),
                schemaV2: aiData.schemaV2 || null,
                promptVersion: aiData._prompt_version || null,
                modelUsed: aiData._model_used || null,
                pipelineDurationS: aiData._pipeline_duration_s || null,
                overallConfidence: aiData._overall_confidence || null,
                analyzedAt: new Date().toISOString()
            };

            const fakeProcess: BiddingProcess = {
                id: `pncp-${item.id}`, title: processObj.title || item.titulo,
                summary: processObj.summary || item.objeto, portal: 'PNCP',
                modality: processObj.modality || item.modalidade_nome || '',
                status: 'Captado', estimatedValue: processObj.estimatedValue || item.valor_estimado || 0,
                sessionDate: item.data_encerramento_proposta || item.data_abertura || new Date().toISOString(),
                link: item.link_sistema, pncpLink: item.link_sistema, risk: processObj.risk || 'Médio',
                companyProfileId: selectedSearchCompanyId || '', createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(), observations: '[]'
            } as BiddingProcess;

            setPncpAnalysis({ process: processObj, analysis: analysisData });
            setViewingAnalysisProcess(fakeProcess);
        } catch (error: any) {
            console.error('PNCP AI Analysis error:', error);
            // Check for extraction insufficient error for a more helpful message
            if (error.message?.includes('insuficiente')) {
                toast.error(`Análise IA indisponível: A IA não conseguiu extrair dados suficientes dos documentos deste edital. Os PDFs podem estar escaneados, protegidos ou em formato não-textual.`);
            } else {
                toast.error(`Erro na análise IA: ${error.message}`);
            }
        } finally { setAnalyzingItemId(null); }
    };

    const handleSaveProcess = async (data: Partial<BiddingProcess>, aiData?: any) => {
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`${API_BASE_URL}/api/biddings`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            if (res.ok) {
                const savedProcess = await res.json();
                const analysisToSave = aiData || pendingAiAnalysis;
                if (analysisToSave) {
                    await fetch(`${API_BASE_URL}/api/analysis`, {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ...analysisToSave, biddingProcessId: savedProcess.id })
                    });
                }
                toast.success('Licitação importada com sucesso!' + (analysisToSave ? ' (com análise IA)' : ''));
                setEditingProcess(null); setPendingAiAnalysis(null);
                setPncpAnalysis(null); setAnalyzedPncpItem(null);
                if (onRefresh) await onRefresh();
            } else { throw new Error("Erro ao importar."); }
        } catch (e) { console.error(e); toast.error('Erro ao importar licitação.'); }
    };

    const activeFilterCount = [
        modalidade !== 'todas', esfera !== 'todas', orgao !== '',
        orgaosLista.trim() !== '', excludeKeywords.trim() !== '',
        dataInicio !== '', dataFim !== '', selectedSearchCompanyId !== ''
    ].filter(Boolean).length;

    return {
        // Search state
        savedSearches, results, loading, saving, showAdvancedFilters, setShowAdvancedFilters,
        keywords, setKeywords, status, setStatus, selectedUf, setSelectedUf,
        selectedSearchCompanyId, setSelectedSearchCompanyId,
        modalidade, setModalidade, esfera, setEsfera, orgao, setOrgao,
        orgaosLista, setOrgaosLista, excludeKeywords, setExcludeKeywords,
        dataInicio, setDataInicio, dataFim, setDataFim,
        page, setPage, totalResults,
        // Modal state
        editingProcess, setEditingProcess,
        // AI state
        analyzingItemId, pncpAnalysis, setPncpAnalysis,
        viewingAnalysisProcess, setViewingAnalysisProcess,
        analyzedPncpItem, setAnalyzedPncpItem,
        pendingAiAnalysis, setPendingAiAnalysis,
        // Multi-list Favoritos
        favoritos, favLists, favStore, activeFavListId, setActiveFavListId,
        showFavoritosTab, setShowFavoritosTab, confirmAction, setConfirmAction,
        listPickerOpen, setListPickerOpen, listPickerItem, setListPickerItem,
        createFavList, renameFavList, deleteFavList, addToFavList, removeFromFavList, favListItemCount,
        // Multi-list Saved Searches
        searchListNames, filteredSavedSearches, activeSearchListName, setActiveSearchListName,
        searchListPickerOpen, setSearchListPickerOpen,
        renameSearchList, deleteSearchList,
        // Computed
        displayItems, activeFilterCount,
        // Handlers
        toggleFavorito, exportFavoritesToPdf,
        handleSearch, handleSaveSearch, startSaveSearch, loadSavedSearch,
        deleteSavedSearch, clearSearch, editingSearch, setEditingSearch, updateSavedSearch,
        handleImportToFunnel, handlePncpAiAnalyze, handleSaveProcess,
    };
}
