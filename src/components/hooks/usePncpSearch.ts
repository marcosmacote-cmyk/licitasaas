/**
 * ═══════════════════════════════════════════════════════
 * usePncpSearch — Busca PNCP (Local-First + Gov.br Fallback)
 * Extracted from usePncpPage.ts (Fase 1 Refatoração)
 * ═══════════════════════════════════════════════════════
 */
import { useState, useRef } from 'react';
import { API_BASE_URL } from '../../config';
import type { PncpBiddingItem } from '../../types';
import { useToast } from '../ui';

interface SearchOverrides {
    keywords?: string;
    status?: string;
    uf?: string;
    modalidade?: string;
    dataInicio?: string;
    dataFim?: string;
    esfera?: string;
    orgao?: string;
    orgaosLista?: string;
    excludeKeywords?: string;
    resetPage?: boolean;
}

export function usePncpSearch() {
    const toast = useToast();

    // Results state
    const [allResults, setAllResults] = useState<PncpBiddingItem[]>([]);
    const [results, setResults] = useState<PncpBiddingItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [searchSlow, setSearchSlow] = useState(false);
    const [searchSource, setSearchSource] = useState<'local' | 'govbr' | ''>('');
    const [searchElapsed, setSearchElapsed] = useState(0);

    const searchControllerRef = useRef<AbortController | null>(null);

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
    const [hasSearched, setHasSearched] = useState(false);
    const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

    const handleSearch = async (e?: React.FormEvent, overrides?: SearchOverrides) => {
        if (e) { e.preventDefault(); setPage(1); }
        setHasSearched(true);
        setLoading(true);
        setSearchSlow(false);
        setSearchSource('');
        setSearchElapsed(0);
        setAllResults([]);
        setResults([]);
        setTotalResults(0);

        if (searchControllerRef.current) {
            searchControllerRef.current.abort();
        }
        searchControllerRef.current = new AbortController();

        // 10s é mais que suficiente para uma query local (normalmente <1s)
        const timeoutId = setTimeout(() => searchControllerRef.current?.abort(), 10000);
        const slowTimer = setTimeout(() => setSearchSlow(true), 3000);

        const searchParams = {
            keywords: overrides?.keywords ?? keywords, status: overrides?.status ?? status,
            uf: overrides?.uf ?? selectedUf, pagina: 1,
            tamanhoPagina: 500, // Base local: pega todos de uma vez
            modalidade: overrides?.modalidade ?? modalidade,
            dataInicio: (overrides?.dataInicio ?? dataInicio) || undefined,
            dataFim: (overrides?.dataFim ?? dataFim) || undefined,
            esfera: overrides?.esfera ?? esfera, orgao: overrides?.orgao ?? orgao,
            orgaosLista: overrides?.orgaosLista ?? orgaosLista,
            excludeKeywords: overrides?.excludeKeywords ?? excludeKeywords,
        };

        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`${API_BASE_URL}/api/pncp/search-hybrid`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                signal: searchControllerRef.current.signal,
                body: JSON.stringify(searchParams),
            });
            
            if (res.ok) {
                const data = await res.json();
                const items = Array.isArray(data.items) ? data.items : [];
                
                if (items.length === 0 && data.meta?.errors?.length > 0) {
                    toast.error(`Nenhum edital encontrado para esses filtros. A base está sendo atualizada automaticamente.`);
                }

                setSearchSource(data.meta?.source || 'local');
                if (data.meta?.elapsedMs) setSearchElapsed(data.meta.elapsedMs);
                setAllResults(items);
                setTotalResults(items.length); // total real = itens retornados (não count do DB)
                setResults(items.slice(0, 10));
            } else {
                throw new Error(`Erro ${res.status}: falha ao buscar editais`);
            }
        } catch (e: any) {
            if (e.name === 'AbortError') {
                toast.error('A busca demorou mais que o esperado. Tente novamente.');
            } else {
                console.error(e);
                toast.error(e?.message || 'Falha na busca. Verifique sua conexão e tente novamente.');
            }
        }
        finally { clearTimeout(timeoutId); clearTimeout(slowTimer); setLoading(false); setSearchSlow(false); }
    };

    const clearSearch = () => {
        if (searchControllerRef.current) {
            searchControllerRef.current.abort();
            searchControllerRef.current = null;
        }
        setKeywords(''); setStatus('recebendo_proposta'); setSelectedUf('');
        setSelectedSearchCompanyId(''); setModalidade('todas'); setEsfera('todas');
        setOrgao(''); setOrgaosLista(''); setExcludeKeywords(''); setDataInicio(''); setDataFim('');
        setAllResults([]); setResults([]); setTotalResults(0); setPage(1);
        setLoading(false);
        setSearchSlow(false);
    };

    const activeFilterCount = [
        modalidade !== 'todas', esfera !== 'todas', orgao !== '',
        orgaosLista.trim() !== '', excludeKeywords.trim() !== '',
        dataInicio !== '', dataFim !== '', selectedSearchCompanyId !== ''
    ].filter(Boolean).length;

    return {
        // Results
        allResults, results, setResults, loading, searchSlow, searchSource, searchElapsed,
        // Form
        keywords, setKeywords, status, setStatus, selectedUf, setSelectedUf,
        selectedSearchCompanyId, setSelectedSearchCompanyId,
        modalidade, setModalidade, esfera, setEsfera, orgao, setOrgao,
        orgaosLista, setOrgaosLista, excludeKeywords, setExcludeKeywords,
        dataInicio, setDataInicio, dataFim, setDataFim,
        page, setPage, totalResults, hasSearched,
        showAdvancedFilters, setShowAdvancedFilters,
        activeFilterCount,
        // Actions
        handleSearch, clearSearch,
    };
}
