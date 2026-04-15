/**
 * ═══════════════════════════════════════════════════════
 * usePncpFavorites — Favoritos Multi-lista (DB-backed)
 * Extracted from usePncpPage.ts (Fase 1 Refatoração)
 * ═══════════════════════════════════════════════════════
 */
import { useState, useEffect, useMemo } from 'react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { API_BASE_URL } from '../../config';
import type { PncpBiddingItem } from '../../types';
import { useToast } from '../ui';
import { v4 as uuidv4 } from 'uuid';

const DEFAULT_FAV_LIST = 'Favoritos Gerais';

interface FavList {
    id: string;
    name: string;
    createdAt: string;
}

interface FavItemWithList extends PncpBiddingItem {
    _listId: string;
    _dbItemId?: string;
}

interface FavStore {
    version: 2;
    lists: FavList[];
    items: FavItemWithList[];
}

export function usePncpFavorites() {
    const toast = useToast();
    const [favStore, setFavStore] = useState<FavStore>({ version: 2, lists: [], items: [] });
    const [activeFavListId, setActiveFavListId] = useState<string | null>(null);
    const [confirmAction, setConfirmAction] = useState<{ type: string; message?: string; onConfirm: () => void } | null>(null);
    const [listPickerOpen, setListPickerOpen] = useState(false);
    const [listPickerItem, setListPickerItem] = useState<PncpBiddingItem | null>(null);

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
        if (!raw && !oldRaw) return;

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
            localStorage.removeItem('pncp_favoritos_v2');
            localStorage.removeItem('pncp_favoritos');
            return;
        }

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
                localStorage.removeItem('pncp_favoritos_v2');
                localStorage.removeItem('pncp_favoritos');
                await fetchFavorites();
            }
        } catch (e) { console.error("Failed to migrate favorites to DB", e); }
    };

    useEffect(() => {
        fetchFavorites().then(() => migrateLocalStorageFavorites());
    }, []);

    // Computed
    const favoritos = favStore.items as PncpBiddingItem[];

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
                const dbItem = favStore.items.find(f => f.id === itemId && f._listId === listId);
                if (dbItem?._dbItemId) {
                    await fetch(`${API_BASE_URL}/api/pncp/favorites/items/${dbItem._dbItemId}`, {
                        method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` }
                    });
                }
            } else {
                await fetch(`${API_BASE_URL}/api/pncp/favorites/items/by-pncp/${encodeURIComponent(itemId)}`, {
                    method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` }
                });
            }
            await fetchFavorites();
        } catch (e) { console.error(e); toast.error('Erro ao remover favorito.'); }
    };

    const toggleFavorito = (item: PncpBiddingItem) => {
        const isInAnyList = favStore.items.some(f => f.id === item.id);
        if (isInAnyList) {
            removeFromFavList(item.id);
        } else {
            setListPickerItem(item);
            setListPickerOpen(true);
        }
    };

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

    return {
        favoritos, favLists, favStore, activeFavListId, setActiveFavListId,
        confirmAction, setConfirmAction,
        listPickerOpen, setListPickerOpen, listPickerItem, setListPickerItem,
        createFavList, renameFavList, deleteFavList, addToFavList, removeFromFavList, favListItemCount,
        toggleFavorito, exportFavoritesToPdf, filteredFavoritos,
    };
}
