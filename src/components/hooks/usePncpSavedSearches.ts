/**
 * ═══════════════════════════════════════════════════════
 * usePncpSavedSearches — Pesquisas Salvas (Multi-Lista)
 * Extracted from usePncpPage.ts (Fase 1 Refatoração)
 * ═══════════════════════════════════════════════════════
 */
import { useState, useEffect, useMemo } from 'react';
import { API_BASE_URL } from '../../config';
import type { PncpSavedSearch } from '../../types';
import { useToast } from '../ui';

interface UsePncpSavedSearchesParams {
    /** Setter for confirmAction shared with other hooks */
    setConfirmAction: (action: { type: string; message?: string; onConfirm: () => void } | null) => void;
}

export function usePncpSavedSearches({ setConfirmAction }: UsePncpSavedSearchesParams) {
    const toast = useToast();
    const [savedSearches, setSavedSearches] = useState<PncpSavedSearch[]>([]);
    const [saving, setSaving] = useState(false);
    const [editingSearch, setEditingSearch] = useState<PncpSavedSearch | null>(null);
    const [searchListPickerOpen, setSearchListPickerOpen] = useState(false);
    const [activeSearchListName, setActiveSearchListName] = useState<string | null>(null);

    const fetchSavedSearches = async () => {
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`${API_BASE_URL}/api/pncp/searches`, { headers: { 'Authorization': `Bearer ${token}` } });
            if (res.ok) { const data = await res.json(); setSavedSearches(data); }
        } catch (e) { console.error("Failed to fetch saved searches", e); }
    };

    useEffect(() => { fetchSavedSearches(); }, []);

    // Multi-list names
    const searchListNames = useMemo(() => {
        const names = new Set(savedSearches.map(s => s.listName || 'Pesquisas Gerais'));
        names.add('Pesquisas Gerais');
        const rest = [...names].filter(n => n !== 'Pesquisas Gerais').sort();
        return ['Pesquisas Gerais', ...rest];
    }, [savedSearches]);

    // Filtered by active list: "Pesquisas Gerais" → show ALL
    const filteredSavedSearches = useMemo(() => {
        if (!activeSearchListName || activeSearchListName === 'Pesquisas Gerais') return savedSearches;
        return savedSearches.filter(s => (s.listName || 'Pesquisas Gerais') === activeSearchListName);
    }, [savedSearches, activeSearchListName]);

    const handleSaveSearch = async (
        listName: string | undefined,
        searchState: {
            keywords: string; status: string; selectedSearchCompanyId: string;
            selectedUf: string; modalidade: string; esfera: string;
            orgao: string; orgaosLista: string; excludeKeywords: string;
            dataInicio: string; dataFim: string;
        }
    ) => {
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
                    name, keywords: searchState.keywords, status: searchState.status,
                    companyProfileId: searchState.selectedSearchCompanyId || undefined,
                    listName: effectiveListName,
                    states: JSON.stringify({
                        uf: searchState.selectedUf, modalidade: searchState.modalidade,
                        esfera: searchState.esfera, orgao: searchState.orgao,
                        orgaosLista: searchState.orgaosLista, excludeKeywords: searchState.excludeKeywords,
                        dataInicio: searchState.dataInicio, dataFim: searchState.dataFim,
                    })
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

    const startSaveSearch = () => {
        setSearchListPickerOpen(true);
    };

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

    return {
        savedSearches, saving,
        searchListNames, filteredSavedSearches, activeSearchListName, setActiveSearchListName,
        searchListPickerOpen, setSearchListPickerOpen,
        renameSearchList, deleteSearchList,
        handleSaveSearch, startSaveSearch, deleteSavedSearch,
        editingSearch, setEditingSearch, updateSavedSearch,
        fetchSavedSearches,
    };
}
