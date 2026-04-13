import { useState, useEffect, useMemo, useRef } from 'react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { API_BASE_URL } from '../../config';
import type { CompanyProfile, PncpSavedSearch, PncpBiddingItem, BiddingProcess, AiAnalysis } from '../../types';
import { useToast } from '../ui';
import { v4 as uuidv4 } from 'uuid';
import { aiService } from '../../services/ai';

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

// ─── Multi-list Favorites Data (DB-backed) ───
const DEFAULT_FAV_LIST = 'Favoritos Gerais';

interface FavList {
    id: string;
    name: string;
    createdAt: string;
}

interface FavItemWithList extends PncpBiddingItem {
    _listId: string; // Which list this item belongs to
    _dbItemId?: string; // DB record id for deletion
}

interface FavStore {
    version: 2;
    lists: FavList[];
    items: FavItemWithList[];
}

interface UsePncpPageParams {
    companies: CompanyProfile[];
    onRefresh?: () => Promise<void>;
    items?: BiddingProcess[];
    initialContext?: any;
    onContextConsumed?: () => void;
}

export function usePncpPage({ companies, onRefresh, items = [], initialContext, onContextConsumed }: UsePncpPageParams) {
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
    const [hasSearched, setHasSearched] = useState(false); // prevent auto-search on mount

    // Modal state
    const [editingProcess, setEditingProcess] = useState<Partial<BiddingProcess> | null>(null);

    // AI Analysis state
    const [analyzingItemId, setAnalyzingItemId] = useState<string | null>(null);
    const [pncpAnalysis, setPncpAnalysis] = useState<{ process: Partial<BiddingProcess>; analysis: AiAnalysis } | null>(null);
    const [viewingAnalysisProcess, setViewingAnalysisProcess] = useState<BiddingProcess | null>(null);
    const [analyzedPncpItem, setAnalyzedPncpItem] = useState<PncpBiddingItem | null>(null);
    const [pendingAiAnalysis, setPendingAiAnalysis] = useState<AiAnalysis | null>(null);
    const [isParsingAI, setIsParsingAI] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // ─── Multi-list Favorites State (DB-backed) ───
    const [favStore, setFavStore] = useState<FavStore>({ version: 2, lists: [], items: [] });
    const [activeFavListId, setActiveFavListId] = useState<string | null>(null); // null = show all
    const [activeTab, setActiveTab] = useState<'search' | 'found' | 'favorites'>('search');
    const [confirmAction, setConfirmAction] = useState<{ type: string; message?: string; onConfirm: () => void } | null>(null);

    // Fetch favorites from DB
    const fetchFavorites = async () => {
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`${API_BASE_URL}/api/pncp/favorites`, { headers: { 'Authorization': `Bearer ${token}` } });
            if (res.ok) {
                const data = await res.json();
                const dbLists: FavList[] = (data.lists || []).map((l: any) => ({ id: l.id, name: l.name, createdAt: l.createdAt }));
                const dbItems: FavItemWithList[] = [];
                for (const list of (data.lists || [])) {
                    for (const item of (list.items || [])) {
                        const itemData = item.data || {};
                        dbItems.push({ ...itemData, id: item.pncpId, _listId: list.id, _dbItemId: item.id });
                    }
                }
                setFavStore({ version: 2, lists: dbLists, items: dbItems });
            }
        } catch (e) { console.error("Failed to fetch favorites", e); }
    };

    // Migrate localStorage to DB (one-time)
    const migrateLocalStorageFavorites = async () => {
        const raw = localStorage.getItem('pncp_favoritos_v2');
        const oldRaw = localStorage.getItem('pncp_favoritos');
        if (!raw && !oldRaw) return; // Nothing to migrate

        let localStore: FavStore | null = null;
        try {
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed.version === 2) localStore = parsed;
            }
            if (!localStore && oldRaw) {
                const oldItems: PncpBiddingItem[] = JSON.parse(oldRaw);
                if (Array.isArray(oldItems) && oldItems.length > 0) {
                    localStore = {
                        version: 2,
                        lists: [{ id: 'default', name: DEFAULT_FAV_LIST, createdAt: new Date().toISOString() }],
                        items: oldItems.map(item => ({ ...item, _listId: 'default' }))
                    };
                }
            }
        } catch { }

        if (!localStore || localStore.items.length === 0) {
            // Clean up empty localStorage
            localStorage.removeItem('pncp_favoritos_v2');
            localStorage.removeItem('pncp_favoritos');
            return;
        }

        // Build import payload
        const lists = localStore.lists.map(l => ({ name: l.name }));
        const listIdToName = new Map(localStore.lists.map(l => [l.id, l.name]));
        const items = localStore.items.map(item => {
            const { _listId, ...rest } = item;
            return {
                listName: listIdToName.get(_listId) || DEFAULT_FAV_LIST,
                pncpId: item.id,
                data: rest,
            };
        });

        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`${API_BASE_URL}/api/pncp/favorites/import`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ lists, items })
            });
            if (res.ok) {
                const result = await res.json();
                console.log(`[Favoritos] Migração: ${result.imported} itens importados para o banco.`);
                // Clean up localStorage after successful migration
                localStorage.removeItem('pncp_favoritos_v2');
                localStorage.removeItem('pncp_favoritos');
                // Refresh from DB
                await fetchFavorites();
            }
        } catch (e) { console.error("Failed to migrate favorites to DB", e); }
    };

    // ─── Scanner Opportunities State ("Encontradas" tab) ───
    const [scannerOpportunities, setScannerOpportunities] = useState<any[]>([]);
    const [scannerOpportunitiesTotal, setScannerOpportunitiesTotal] = useState(0);
    const [scannerOpportunitiesPage, setScannerOpportunitiesPage] = useState(1);
    const [scannerOpportunitiesLoading, setScannerOpportunitiesLoading] = useState(false);
    const [scannerFilterSearchId, setScannerFilterSearchId] = useState<string | null>(null);
    const [unreadOpportunityCount, setUnreadOpportunityCount] = useState(0);

    // List Picker state (shared between fav and search)
    const [listPickerOpen, setListPickerOpen] = useState(false);
    const [listPickerItem, setListPickerItem] = useState<PncpBiddingItem | null>(null);
    const [searchListPickerOpen, setSearchListPickerOpen] = useState(false);

    // Active search list filter
    const [activeSearchListName, setActiveSearchListName] = useState<string | null>(null);

    useEffect(() => {
        fetchFavorites().then(() => migrateLocalStorageFavorites());
    }, []);

    // Computed: all favoritos (flat) for backward compat
    const favoritos = favStore.items as PncpBiddingItem[];

    // Computed: filtered favorites by active list
    // null (Favoritos Gerais / default) → show ALL from ALL lists
    const filteredFavoritos = useMemo(() => {
        const defaultListId = favStore.lists.find(l => l.name === DEFAULT_FAV_LIST)?.id;
        const items = (!activeFavListId || activeFavListId === defaultListId)
            ? favStore.items
            : favStore.items.filter(f => f._listId === activeFavListId);
        return [...items].sort((a, b) => {
            const dateA = new Date(a.data_encerramento_proposta || a.data_abertura || Date.now());
            const dateB = new Date(b.data_encerramento_proposta || b.data_abertura || Date.now());
            return dateA.getTime() - dateB.getTime();
        });
    }, [favStore, activeFavListId]);

    const displayItems = activeTab === 'favorites' ? filteredFavoritos 
        : activeTab === 'found' ? scannerOpportunities.map((opp: any) => ({
            id: opp.pncpId || opp.id,
            titulo: opp.titulo || 'Sem título',
            objeto: opp.objeto || '',
            orgao_nome: opp.orgaoNome || '',
            uf: opp.uf || '--',
            municipio: opp.municipio || '--',
            valor_estimado: opp.valorEstimado || 0,
            data_encerramento_proposta: opp.dataEncerramentoProposta || '',
            modalidade_nome: opp.modalidadeNome || '',
            link_sistema: opp.linkSistema || '',
            _scannerLogId: opp.id,
            _isViewed: opp.isViewed,
            _searchName: opp.searchName,
            _foundAt: opp.createdAt,
        } as PncpBiddingItem & { _scannerLogId: string; _isViewed: boolean; _searchName: string; _foundAt: string }))
        : results;

    // ─── Multi-list Favorites API (DB-backed) ───
    const favLists = useMemo(() => {
        const defList = favStore.lists.find(l => l.name === DEFAULT_FAV_LIST);
        const rest = favStore.lists.filter(l => l.name !== DEFAULT_FAV_LIST).sort((a, b) => a.name.localeCompare(b.name));
        return defList ? [defList, ...rest] : rest;
    }, [favStore.lists]);

    const defaultListId = useMemo(() => favStore.lists.find(l => l.name === DEFAULT_FAV_LIST)?.id || null, [favStore.lists]);

    const createFavList = async (name: string): Promise<FavList> => {
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`${API_BASE_URL}/api/pncp/favorites/lists`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: name.trim() })
            });
            if (res.ok) {
                const newList = await res.json();
                await fetchFavorites();
                return { id: newList.id, name: newList.name, createdAt: newList.createdAt };
            }
        } catch (e) { console.error(e); }
        // Fallback: return temp list
        const temp: FavList = { id: uuidv4(), name: name.trim(), createdAt: new Date().toISOString() };
        return temp;
    };

    const renameFavList = async (listId: string, newName: string) => {
        const trimmed = newName.trim();
        if (!trimmed) return;
        try {
            const token = localStorage.getItem('token');
            await fetch(`${API_BASE_URL}/api/pncp/favorites/lists/${listId}`, {
                method: 'PUT',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: trimmed })
            });
            await fetchFavorites();
            toast.success(`Lista renomeada para "${trimmed}"`);
        } catch (e) { console.error(e); toast.error('Erro ao renomear lista.'); }
    };

    const deleteFavList = (listId: string) => {
        if (listId === defaultListId) { toast.warning('A lista padrão não pode ser excluída.'); return; }
        const listName = favLists.find(l => l.id === listId)?.name || 'lista';
        const itemCount = favStore.items.filter(i => i._listId === listId).length;
        setConfirmAction({
            type: 'deleteFavList',
            message: `Excluir a lista "${listName}"?${itemCount > 0 ? `\n\nOs ${itemCount} item(ns) serão movidos para "Favoritos Gerais".` : ''}`,
            onConfirm: async () => {
                setConfirmAction(null);
                try {
                    const token = localStorage.getItem('token');
                    await fetch(`${API_BASE_URL}/api/pncp/favorites/lists/${listId}`, {
                        method: 'DELETE',
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    if (activeFavListId === listId) setActiveFavListId(null);
                    await fetchFavorites();
                    toast.success(`Lista "${listName}" excluída. Itens movidos para "Favoritos Gerais".`);
                } catch (e) { console.error(e); toast.error('Erro ao excluir lista.'); }
            }
        });
    };

    const addToFavList = async (item: PncpBiddingItem, listId: string) => {
        // Don't add if already in this list
        if (favStore.items.some(f => f.id === item.id && f._listId === listId)) return;
        try {
            const token = localStorage.getItem('token');
            const { _listId, _dbItemId, ...itemData } = item as FavItemWithList;
            await fetch(`${API_BASE_URL}/api/pncp/favorites/items`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ listId, pncpId: item.id, data: itemData })
            });
            await fetchFavorites();
        } catch (e) { console.error(e); toast.error('Erro ao adicionar favorito.'); }
    };

    const removeFromFavList = async (itemId: string, listId?: string) => {
        try {
            const token = localStorage.getItem('token');
            if (listId) {
                // Find the specific DB item
                const dbItem = favStore.items.find(f => f.id === itemId && f._listId === listId);
                if (dbItem?._dbItemId) {
                    await fetch(`${API_BASE_URL}/api/pncp/favorites/items/${dbItem._dbItemId}`, {
                        method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` }
                    });
                }
            } else {
                // Remove from all lists
                await fetch(`${API_BASE_URL}/api/pncp/favorites/items/by-pncp/${encodeURIComponent(itemId)}`, {
                    method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` }
                });
            }
            await fetchFavorites();
        } catch (e) { console.error(e); toast.error('Erro ao remover favorito.'); }
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

    // Count items for fav list — default list shows ALL
    const favListItemCount = (listId: string) => 
        listId === defaultListId ? favStore.items.length : favStore.items.filter(f => f._listId === listId).length;

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

    const [opportunityScannerEnabled, setOpportunityScannerEnabled] = useState(true);
    const [lastScanAt, setLastScanAt] = useState<string | null>(null);
    const [lastScanTotalNew, setLastScanTotalNew] = useState(0);
    const [lastScanResults, setLastScanResults] = useState<{ searchId: string; searchName: string; companyName: string; totalFound: number; newCount: number; status: string; errorMessage?: string }[]>([]);
    const [nextScanAt, setNextScanAt] = useState<string | null>(null);

    useEffect(() => { 
        fetchSavedSearches(); 
        fetchScannerStatus();
        fetchUnreadCount();
    }, []);

    useEffect(() => {
        if (activeTab === 'found') {
            fetchScannerOpportunities();
        }
    }, [activeTab, scannerOpportunitiesPage, scannerFilterSearchId]);

    const fetchUnreadCount = async () => {
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`${API_BASE_URL}/api/pncp/scanner/opportunities/unread-count`, { headers: { 'Authorization': `Bearer ${token}` } });
            if (res.ok) { const data = await res.json(); setUnreadOpportunityCount(data.count || 0); }
        } catch (e) { console.error("Failed to fetch unread count", e); }
    };

    const fetchScannerOpportunities = async () => {
        setScannerOpportunitiesLoading(true);
        try {
            const token = localStorage.getItem('token');
            let url = `${API_BASE_URL}/api/pncp/scanner/opportunities?page=${scannerOpportunitiesPage}`;
            if (scannerFilterSearchId) url += `&searchId=${scannerFilterSearchId}`;
            const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
            if (res.ok) {
                const data = await res.json();
                setScannerOpportunities(prev => scannerOpportunitiesPage === 1 ? data.items || [] : [...prev, ...(data.items || [])]);
                setScannerOpportunitiesTotal(data.total || 0);
            }
        } catch (e) { console.error("Failed to fetch scanner opportunities", e); }
        finally { setScannerOpportunitiesLoading(false); }
    };

    const markOpportunitiesViewed = async (ids: string[] | 'all') => {
        try {
            const token = localStorage.getItem('token');
            await fetch(`${API_BASE_URL}/api/pncp/scanner/opportunities/mark-viewed`, {
                method: 'PATCH',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids })
            });
            fetchScannerOpportunities();
            fetchUnreadCount();
        } catch (e) { console.error(e); }
    };

    const fetchScannerStatus = async () => {
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`${API_BASE_URL}/api/pncp/scanner/status`, { headers: { 'Authorization': `Bearer ${token}` } });
            if (res.ok) {
                const data = await res.json();
                setOpportunityScannerEnabled(data.enabled !== false);
                setLastScanAt(data.lastScanAt || null);
                setLastScanTotalNew(data.lastScanTotalNew || 0);
                setLastScanResults(data.lastScanResults || []);
                setNextScanAt(data.nextScanAt || null);
            }
        } catch (e) { console.error("Failed to fetch scanner status", e); }
    };

    const toggleOpportunityScanner = async (enabled: boolean) => {
        setOpportunityScannerEnabled(enabled); // optimistic update
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`${API_BASE_URL}/api/pncp/scanner/toggle`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled })
            });
            if (res.ok) {
                toast.success(enabled ? 'Notificações automáticas ativadas!' : 'Notificações automáticas desativadas.');
            } else {
                toast.error('Erro ao salvar configuração.');
                setOpportunityScannerEnabled(!enabled); // revert
            }
        } catch (e) {
            console.error(e);
            toast.error('Falha de conexão ao salvar configuração.');
            setOpportunityScannerEnabled(!enabled); // revert
        }
    };

    const fetchSavedSearches = async () => {
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`${API_BASE_URL}/api/pncp/searches`, { headers: { 'Authorization': `Bearer ${token}` } });
            if (res.ok) { const data = await res.json(); setSavedSearches(data); }
        } catch (e) { console.error("Failed to fetch saved searches", e); }
    };

    const handleSearch = async (e?: React.FormEvent, overrides?: { keywords?: string; status?: string; uf?: string; modalidade?: string; dataInicio?: string; dataFim?: string; esfera?: string; orgao?: string; orgaosLista?: string; excludeKeywords?: string; resetPage?: boolean }) => {
        if (e) { e.preventDefault(); setPage(1); }
        setHasSearched(true);
        setLoading(true);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 45000); // 45s timeout (Gov.br can be slow)
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`${API_BASE_URL}/api/pncp/search`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                signal: controller.signal,
                body: JSON.stringify({
                    keywords: overrides?.keywords ?? keywords, status: overrides?.status ?? status,
                    uf: overrides?.uf ?? selectedUf, pagina: e || overrides?.resetPage ? 1 : page,
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
                const isNewSearch = e || overrides?.resetPage || page === 1;
                setResults(prev => isNewSearch ? items : [...prev, ...items]);
                setTotalResults(typeof data.total === 'number' ? data.total : items.length);
            } else { throw new Error("Erro na busca"); }
        } catch (e: any) {
            if (e.name === 'AbortError') {
                toast.error('O portal PNCP (Gov.br) está demorando para responder. Tente novamente ou refine sua busca com filtros mais específicos.', { duration: 6000 });
            } else {
                console.error(e);
                toast.error('Falha na conexão com o PNCP. Verifique sua internet e tente novamente.');
            }
        }
        finally { clearTimeout(timeoutId); setLoading(false); }
    };

    // ─── Multi-list Saved Searches ───
    const searchListNames = useMemo(() => {
        const names = new Set(savedSearches.map(s => s.listName || 'Pesquisas Gerais'));
        names.add('Pesquisas Gerais');
        const rest = [...names].filter(n => n !== 'Pesquisas Gerais').sort();
        return ['Pesquisas Gerais', ...rest];
    }, [savedSearches]);

    // "Pesquisas Gerais" → show ALL from ALL lists
    const filteredSavedSearches = useMemo(() => {
        if (!activeSearchListName || activeSearchListName === 'Pesquisas Gerais') return savedSearches;
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
        setActiveTab('search');

        handleSearch(undefined, {
            keywords: searchKeywords, status: searchStatus, uf: customState.uf,
            modalidade: customState.modalidade, esfera: customState.esfera,
            orgao: customState.orgao, orgaosLista: customState.orgaosLista,
            excludeKeywords: customState.excludeKeywords,
            dataInicio: customState.dataInicio, dataFim: customState.dataFim,
            resetPage: true
        });
    };

    // Only fetch more results when page increments (scroll) — NOT on mount
    useEffect(() => { if (hasSearched && !loading && page > 1) { handleSearch(); } }, [page]);

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
        setActiveTab('search');
    };

    const handleImportToFunnel = (item: PncpBiddingItem, aiData?: { process: Partial<BiddingProcess>; analysis: AiAnalysis }) => {
        if (items) {
            const existingProcess = items.find(p => p.link && item.link_sistema && p.link.includes(item.link_sistema));
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
        // ═══════════════════════════════════════════════════════════
        // 1. SMART PORTAL DETECTION — resolve o portal real de operação
        // ═══════════════════════════════════════════════════════════
        let bestPortalName = "PNCP";
        // V4.6.1: Check AI-enriched link first (e.g. BLL functional URL from Auto-Enrich),
        // then fall back to item.link_sistema (PNCP link)
        const aiEnrichedLink = ((aiData?.process as any)?.link_sistema || '').toLowerCase();
        const allLinksForDetection = [aiEnrichedLink, (item.link_sistema || '').toLowerCase()].filter(Boolean).join(' ');

        // Check registered credentials first
        if (companies.length > 0) {
            const allCreds = companies.flatMap(c => c.credentials || []);
            const match = allCreds.find(c => {
                const cu = (c.url || '').toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
                return cu && allLinksForDetection.includes(cu.split('/')[0]);
            });
            if (match) bestPortalName = match.platform;
        }

        // Fallback: infer from link patterns (more comprehensive)
        if (bestPortalName === 'PNCP') {
            if (allLinksForDetection.includes('comprasnet') || allLinksForDetection.includes('cnetmobile') || allLinksForDetection.includes('gov.br/compras')) bestPortalName = "ComprasNet";
            else if (allLinksForDetection.includes('bllcompras') || allLinksForDetection.includes('bll.org')) bestPortalName = "BLL";
            else if (allLinksForDetection.includes('bnccompras') || allLinksForDetection.includes('bnc.org.br')) bestPortalName = "BNC";
            else if (allLinksForDetection.includes('licitacoes-e')) bestPortalName = "Licitações-e (BB)";
            else if (allLinksForDetection.includes('portaldecompraspublicas')) bestPortalName = "Portal de Compras Públicas";
            else if (allLinksForDetection.includes('bec.sp')) bestPortalName = "BEC/SP";
            else if (allLinksForDetection.includes('m2atecnologia') || allLinksForDetection.includes('m2a.')) bestPortalName = "M2A Tecnologia";
            else if (allLinksForDetection.includes('bbmnet')) bestPortalName = "BBMNet";
            else if (allLinksForDetection.includes('licitamaisbrasil')) bestPortalName = "Licita Mais Brasil";
            else if (allLinksForDetection.includes('compras.gov.br') || allLinksForDetection.includes('pncp.gov.br')) bestPortalName = "Compras.gov.br";

            // State-level override: Ceará (CE) State agencies use ComprasNet for disputes (except Dispensa)
            if (bestPortalName === 'PNCP' || bestPortalName === 'Compras.gov.br') { // Keep Compras.gov.br mapping or PNCP default
                const isCE = (item.uf?.toUpperCase() === 'CE');
                const isStateLevel = (item.esfera_id === 'E');
                const isDispensa = /dispensa|cota[çc][ãa]o/i.test(item.modalidade_nome || '');
                if (isCE && isStateLevel && !isDispensa) {
                    bestPortalName = "Compras.gov.br";
                }
            }
        }

        // ═══════════════════════════════════════════════════════════
        // 2. AI-INFORMED RISK TAG — calcula risco baseado na análise IA
        // ═══════════════════════════════════════════════════════════
        let riskTag: string = aiData?.process?.risk || 'Médio';
        if (aiData?.analysis?.schemaV2) {
            const v2 = aiData.analysis.schemaV2 as any;
            const flags = v2?.risks_and_flags || [];
            if (Array.isArray(flags) && flags.length > 0) {
                const hasCritica = flags.some((f: any) => f.severity === 'critica');
                const hasAlta = flags.some((f: any) => f.severity === 'alta');
                const hasMedia = flags.some((f: any) => f.severity === 'media');
                if (hasCritica) riskTag = 'Crítico';
                else if (hasAlta) riskTag = 'Alto';
                else if (hasMedia && flags.length >= 3) riskTag = 'Alto';
                else if (hasMedia) riskTag = 'Médio';
                else riskTag = 'Baixo';
            }
        } else if (aiData?.analysis?.irregularitiesFlags) {
            try {
                const flags = typeof aiData.analysis.irregularitiesFlags === 'string'
                    ? JSON.parse(aiData.analysis.irregularitiesFlags)
                    : aiData.analysis.irregularitiesFlags;
                if (Array.isArray(flags) && flags.length >= 3) riskTag = 'Alto';
                else if (Array.isArray(flags) && flags.length > 0) riskTag = 'Médio';
            } catch { /* keep default */ }
        }

        // ═══════════════════════════════════════════════════════════
        // 3. SMART TITLE — constrói título enriquecido
        // ═══════════════════════════════════════════════════════════
        let title = aiData?.process?.title || item.titulo;
        // Normalize for comparison: lowercase, remove accents, remove common prefixes
        const normalizeForCompare = (s: string) => s.toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/prefeitura municipal d[eo] /gi, '')
            .replace(/municipio d[eo] /gi, '')
            .replace(/secretaria d[eo] /gi, '')
            .replace(/\s+/g, ' ').trim();
        // Se o título não inclui referência ao órgão e é curto, enriqueça
        const titleNorm = normalizeForCompare(title || '');
        const orgNorm = normalizeForCompare(item.orgao_nome || '');
        const alreadyHasOrg = titleNorm.includes(orgNorm.slice(0, 10)) || orgNorm.includes(titleNorm.slice(-15));
        if (title && !alreadyHasOrg && !title.includes('Município') && title.length < 80) {
            const orgParts = item.orgao_nome.split(' ');
            const orgShort = orgParts.length > 4 ? orgParts.slice(0, 4).join(' ') : item.orgao_nome;
            title = `${title} - ${orgShort}`;
        }

        // ═══════════════════════════════════════════════════════════
        // 4. LINK COMPOSITION — combina todos os links relevantes
        // ═══════════════════════════════════════════════════════════
        const links: string[] = [];
        // AI-inferred link (e.g. cnetmobile via UASG) — highest priority
        const aiLinkSistema = (aiData?.process as any)?.link_sistema as string | undefined;
        if (aiLinkSistema && !links.includes(aiLinkSistema)) links.push(aiLinkSistema);
        if (aiData?.process?.link && !links.includes(aiData.process.link)) links.push(aiData.process.link);
        if (item.link_sistema && !links.includes(item.link_sistema)) links.push(item.link_sistema);
        if (item.link_comprasnet && !links.includes(item.link_comprasnet)) links.push(item.link_comprasnet);

        // ═══════════════════════════════════════════════════════════
        // 5. SESSION DATE — prioriza data extraída pela IA (da análise do edital)
        // ═══════════════════════════════════════════════════════════
        // PNCP API fields:
        //   data_abertura = dataAberturaProposta = início do RECEBIMENTO de propostas (ex: 23/03)
        //   data_encerramento_proposta = prazo final para enviar propostas (ex: 09/04 17:00)
        // Nenhum dos dois é a sessão pública. A sessão real vem da IA (timeline.data_sessao).
        let sessionDateISO: string;
        if (aiData?.process?.sessionDate && aiData.process.sessionDate.length > 5) {
            // AI extracted the actual session date from the edital text
            const parsed = new Date(aiData.process.sessionDate);
            sessionDateISO = isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
        } else if (item.data_encerramento_proposta) {
            // Closest proxy: proposal deadline is usually 1 day before session
            sessionDateISO = new Date(item.data_encerramento_proposta).toISOString();
        } else if (item.data_abertura) {
            sessionDateISO = new Date(item.data_abertura).toISOString();
        } else {
            sessionDateISO = new Date().toISOString();
        }

        // ═══════════════════════════════════════════════════════════
        // 6. SMART REMINDER — auto-configura lembrete 2 dias antes da sessão
        // ═══════════════════════════════════════════════════════════
        let reminderDate: string | undefined;
        let reminderStatus: 'pending' | undefined;
        let reminderType: 'once' | undefined;
        const sessionMs = new Date(sessionDateISO).getTime();
        const now = Date.now();
        const twoDaysBefore = sessionMs - (2 * 24 * 60 * 60 * 1000);
        if (twoDaysBefore > now) {
            // Set reminder at 08:00 two days before the session
            const reminderDt = new Date(twoDaysBefore);
            reminderDt.setHours(8, 0, 0, 0);
            reminderDate = reminderDt.toISOString();
            reminderStatus = 'pending';
            reminderType = 'once';
        }

        // ═══════════════════════════════════════════════════════════
        // 7. RICH OBSERVATION — nota de importação com dados completos
        // ═══════════════════════════════════════════════════════════
        const obsParts = [`Importado do PNCP`];
        if (item.orgao_nome) obsParts.push(`Órgão: ${item.orgao_nome.toUpperCase()}`);
        if (item.municipio && item.uf) obsParts.push(`${item.municipio}-${item.uf}`);
        if (item.data_encerramento_proposta) {
            obsParts.push(`Prazo Limite: ${new Date(item.data_encerramento_proposta).toLocaleString('pt-BR')}`);
        }
        const observationText = obsParts.join(' | ');

        // ═══════════════════════════════════════════════════════════
        // 8. SUMMARY — prefere AI summary que já vem sanitizado do backend
        // ═══════════════════════════════════════════════════════════
        let summary = aiData?.process?.summary || item.objeto;

        // ═══════════════════════════════════════════════════════════
        // 9. MODALITY — normaliza para o padrão do dropdown
        // ═══════════════════════════════════════════════════════════
        let modality = aiData?.process?.modality || item.modalidade_nome || "Não Informado (PNCP)";
        // Normalize common PNCP modality strings to clean labels
        const modalMap: Record<string, string> = {
            'pregão - eletrônico': 'Pregão Eletrônico',
            'pregão eletrônico': 'Pregão Eletrônico',
            'concorrência - eletrônica': 'Concorrência',
            'concorrência eletrônica': 'Concorrência',
            'concorrência': 'Concorrência',
            'dispensa': 'Dispensa',
            'dispensa de licitação': 'Dispensa',
            'inexigibilidade': 'Inexigibilidade',
            'diálogo competitivo': 'Diálogo Competitivo',
            'leilão - eletrônico': 'Leilão',
        };
        const normalizedMod = modalMap[modality.toLowerCase().trim()];
        if (normalizedMod) modality = normalizedMod;

        // ═══════════════════════════════════════════════════════════
        // BUILD & SET PROCESS
        // ═══════════════════════════════════════════════════════════
        // Smart portal resolution: bestPortalName from links is specific → wins over generic AI portal
        const genericPortals = ['compras.gov.br', 'pncp', 'não informado', ''];
        const aiPortal = aiData?.process?.portal || '';
        const resolvedPortal = (bestPortalName && !genericPortals.includes(bestPortalName.toLowerCase()))
            ? bestPortalName  // Link-based detection is specific (e.g. Licita Mais Brasil) → use it
            : (aiPortal || bestPortalName);  // AI portal or fallback

        const processData: Partial<BiddingProcess> = {
            title,
            summary,
            portal: resolvedPortal,
            modality,
            status: "Captado",
            estimatedValue: aiData?.process?.estimatedValue || item.valor_estimado || 0,
            sessionDate: sessionDateISO,
            link: links.join(', '),
            pncpLink: item.link_sistema,
            risk: riskTag as any,
            companyProfileId: selectedSearchCompanyId || (companies.length > 0 ? companies[0].id : ''),
            ...(reminderDate ? { reminderDate, reminderStatus, reminderType } : {}),
            observations: JSON.stringify([{
                id: crypto.randomUUID?.() || Date.now().toString(),
                text: observationText,
                timestamp: new Date().toISOString(), author: 'Sistema'
            }])
        };
        setEditingProcess(processData);
    };

    const handlePncpAiAnalyze = async (item: PncpBiddingItem) => {
        if (analyzingItemId) return;
        setAnalyzingItemId(item.id);
        setAnalyzedPncpItem(item);
        
        try {
            const { submitBackgroundJob } = await import('./useSSE');
            await submitBackgroundJob({
                type: 'pncp_analysis',
                input: {
                    orgao_cnpj: item.orgao_cnpj, ano: item.ano,
                    numero_sequencial: item.numero_sequencial, link_sistema: item.link_sistema,
                    _itemData: item // Saved to reconstruct the process later
                },
                targetId: `pncp_${item.id}`,
                targetTitle: `Análise PNCP: ${item.orgao_nome || item.numero_sequencial}`
            });
            toast.success('Análise enviada para processamento! Você será notificado quando concluir.');
        } catch (e: any) {
            toast.error(`Erro ao enviar análise IA: ${e.message}`);
        } finally {
            setAnalyzingItemId(null);
        }
    };

    const handleLoadPncpJobResult = async (jobId: string) => {
        try {
            const token = localStorage.getItem('token');
            const jobRes = await fetch(`${API_BASE_URL}/api/jobs/${jobId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!jobRes.ok) throw new Error('Falha ao carregar tarefa');
            const jobData = await jobRes.json();
            
            const resRes = await fetch(`${API_BASE_URL}/api/jobs/${jobId}/result`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!resRes.ok) throw new Error('Falha ao buscar resultado');
            const { result: aiData } = await resRes.json();
            
            const item = jobData.input?._itemData || {};
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

            const toISOSafe = (d: string): string => {
                if (!d) return new Date().toISOString();
                const parsed = new Date(d);
                if (!isNaN(parsed.getTime())) return parsed.toISOString();
                const m = d.match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(?:às\s+)?(\d{2}):(\d{2}))?/);
                if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4] || '00'}:${m[5] || '00'}:00-03:00`).toISOString();
                return new Date().toISOString();
            };

            const fakeProcess: BiddingProcess = {
                id: jobData.targetId || `pncp-${item.id}`, 
                title: processObj.title || item.titulo || 'Licitação Analisada',
                summary: processObj.summary || item.objeto || '', 
                portal: 'PNCP',
                modality: processObj.modality || item.modalidade_nome || '',
                status: 'Captado', estimatedValue: processObj.estimatedValue || item.valor_estimado || 0,
                sessionDate: toISOSafe(processObj.sessionDate || item.data_encerramento_proposta || item.data_abertura || ''),
                link: [processObj.link_sistema, item.link_sistema, item.link_comprasnet].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(', '),
                pncpLink: item.link_sistema || '', risk: processObj.risk || 'Médio',
                companyProfileId: selectedSearchCompanyId || '', createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(), observations: '[]'
            } as BiddingProcess;

            setAnalyzedPncpItem(item);
            setPncpAnalysis({ process: processObj, analysis: analysisData });
            setViewingAnalysisProcess(fakeProcess);
        } catch (error: any) {
             toast.error(`Erro ao carregar análise: ${error.message}`);
        }
    };

    useEffect(() => {
        if (initialContext?.action === 'open_pncp_job' && initialContext.jobId) {
            handleLoadPncpJobResult(initialContext.jobId);
            if (onContextConsumed) onContextConsumed();
        }
    }, [initialContext]);

    const handleAIAssistClick = () => { fileInputRef.current?.click(); };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;
        try {
            setIsParsingAI(true);
            const { process: parsedData, analysis } = await aiService.parseEditalPDF(files);
            
            // Helper to build dates consistently 
            const toISOSafe = (d: string): string => {
                if (!d) return new Date().toISOString();
                const parsed = new Date(d);
                if (!isNaN(parsed.getTime())) return parsed.toISOString();
                const m = d.match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(?:às\s+)?(\d{2}):(\d{2}))?/);
                if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4] || '00'}:${m[5] || '00'}:00-03:00`).toISOString();
                return new Date().toISOString();
            };

            const fakeItem: any = {
                id: `manual-upload-${Date.now()}`,
                titulo: parsedData.title || 'Licitação Captada (Processo Manual)',
                objeto: parsedData.summary || '',
                orgao_nome: '',
                municipio: '',
                uf: '',
                modalidade_nome: parsedData.modality || '',
                valor_estimado: parsedData.estimatedValue || 0,
                data_abertura: toISOSafe(parsedData.sessionDate || ''),
                data_encerramento_proposta: toISOSafe(parsedData.sessionDate || ''),
                link_sistema: parsedData.link || '',
            };

            const fakeProcess: BiddingProcess = {
                id: fakeItem.id,
                title: parsedData.title || fakeItem.titulo,
                summary: parsedData.summary || fakeItem.objeto,
                portal: parsedData.portal || 'Não Informado',
                modality: parsedData.modality || 'Não Informado',
                status: 'Captado',
                estimatedValue: parsedData.estimatedValue || 0,
                sessionDate: toISOSafe(parsedData.sessionDate || ''),
                link: parsedData.link || '',
                pncpLink: '',
                risk: parsedData.risk || 'Médio',
                companyProfileId: selectedSearchCompanyId || '',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                observations: '[]'
            } as BiddingProcess;

            setAnalyzedPncpItem(fakeItem);
            setPncpAnalysis({ process: parsedData, analysis });
            setViewingAnalysisProcess(fakeProcess);
        } catch (error) {
            console.error('Failed to parse document with AI', error);
            const errorMessage = error instanceof Error ? error.message : 'Falha ao extrair dados do Edital.';
            toast.error(errorMessage);
        } finally {
            setIsParsingAI(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleSaveProcess = async (data: Partial<BiddingProcess>, aiData?: any) => {
        try {
            const token = localStorage.getItem('token');
            console.log('[PNCP Save] Sending payload:', Object.keys(data));
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
            } else {
                const errBody = await res.json().catch(() => ({ error: 'Erro desconhecido' }));
                console.error('[PNCP Save] Server error:', errBody);
                throw new Error(errBody.details || errBody.error || `HTTP ${res.status}`);
            }
        } catch (e: any) { console.error(e); toast.error(`Erro ao importar licitação: ${e.message}`); }
    };

    const activeFilterCount = [
        modalidade !== 'todas', esfera !== 'todas', orgao !== '',
        orgaosLista.trim() !== '', excludeKeywords.trim() !== '',
        dataInicio !== '', dataFim !== '', selectedSearchCompanyId !== ''
    ].filter(Boolean).length;

    const handleTriggerScan = async () => {
        setLoading(true);
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`${API_BASE_URL}/api/pncp/scan-opportunities`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                toast.success(data.message || 'Varredura de oportunidades iniciada');
                // Atualizar status após 30s (tempo suficiente para scan completar)
                setTimeout(fetchScannerStatus, 30000);
            } else { throw new Error("Erro na varredura"); }
        } catch (e: any) {
            console.error(e);
            toast.error('Falha ao iniciar varredura de oportunidades.');
        } finally {
            setLoading(false);
        }
    };

    // Helper: buscar resultado da última varredura para uma pesquisa específica
    const getSearchScanResult = (searchId: string) => {
        return lastScanResults.find(r => r.searchId === searchId) || null;
    };

    return {
        // Search state
        savedSearches, results, loading, saving, showAdvancedFilters, setShowAdvancedFilters,
        keywords, setKeywords, status, setStatus, selectedUf, setSelectedUf,
        selectedSearchCompanyId, setSelectedSearchCompanyId,
        modalidade, setModalidade, esfera, setEsfera, orgao, setOrgao,
        orgaosLista, setOrgaosLista, excludeKeywords, setExcludeKeywords,
        dataInicio, setDataInicio, dataFim, setDataFim,
        page, setPage, totalResults, hasSearched,
        // Modal state
        editingProcess, setEditingProcess, fileInputRef, handleAIAssistClick, handleFileUpload, isParsingAI,
        // AI state
        analyzingItemId, pncpAnalysis, setPncpAnalysis,
        viewingAnalysisProcess, setViewingAnalysisProcess,
        analyzedPncpItem, setAnalyzedPncpItem,
        pendingAiAnalysis, setPendingAiAnalysis,
        // Multi-list Favoritos
        favoritos, favLists, favStore, activeFavListId, setActiveFavListId,
        activeTab, setActiveTab, confirmAction, setConfirmAction,
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
        handleImportToFunnel, handlePncpAiAnalyze, handleSaveProcess, handleTriggerScan,
        // Global scanner
        opportunityScannerEnabled, toggleOpportunityScanner,
        // Last scan info
        lastScanAt, lastScanTotalNew, lastScanResults, nextScanAt, getSearchScanResult,
        // Scanner Opportunities ("Encontradas" tab)
        scannerOpportunities, scannerOpportunitiesTotal, scannerOpportunitiesPage, setScannerOpportunitiesPage,
        scannerOpportunitiesLoading, scannerFilterSearchId, setScannerFilterSearchId,
        unreadOpportunityCount, markOpportunitiesViewed, fetchScannerOpportunities
    };
}
