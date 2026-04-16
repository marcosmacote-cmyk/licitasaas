/**
 * ═══════════════════════════════════════════════════════
 * usePncpSearch v3 — Server-Side Pagination + FTS
 * 
 * KEY CHANGES from v2:
 * - tamanhoPagina: 50 (was 500) — server returns 1 page at a time
 * - Pagination is server-side: each page change triggers a new fetch
 * - Timeout reduced to 15s (FTS responds in <50ms)
 * - AbortController correctly cancels previous request
 * - No more allResults[] with 500 items in RAM
 * ═══════════════════════════════════════════════════════
 */
import { useState, useRef, useCallback } from 'react';
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

const PAGE_SIZE = 50;

export function usePncpSearch() {
    const toast = useToast();

    // Results state
    const [allResults, setAllResults] = useState<PncpBiddingItem[]>([]);
    const [results, setResults] = useState<PncpBiddingItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [searchSlow, setSearchSlow] = useState(false);
    const [searchSource, setSearchSource] = useState<'local' | 'govbr' | 'local-fts' | ''>('');
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

    // Store last search params for pagination re-fetches
    const lastSearchParamsRef = useRef<any>(null);

    /**
     * Core fetch function — calls the unified /search endpoint
     */
    const doSearchFetch = useCallback(async (params: any): Promise<{ items: PncpBiddingItem[], total: number, source: string, elapsedMs: number }> => {
        console.log('[SearchV3] doSearchFetch called with params:', JSON.stringify(params));

        // Cancel any in-flight request
        if (searchControllerRef.current) {
            console.log('[SearchV3] Aborting previous request');
            searchControllerRef.current.abort();
        }

        const controller = new AbortController();
        searchControllerRef.current = controller;
        const timeout = setTimeout(() => {
            console.log('[SearchV3] ⏰ 15s timeout reached, aborting');
            controller.abort();
        }, 15000);

        try {
            const token = localStorage.getItem('token');
            const url = `${API_BASE_URL}/api/pncp/search-hybrid`;
            console.log('[SearchV3] Fetching:', url, '| token:', token ? token.substring(0, 20) + '...' : 'NULL');

            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                signal: controller.signal,
                body: JSON.stringify(params),
            });
            clearTimeout(timeout);

            console.log('[SearchV3] Response status:', res.status, res.statusText);

            if (!res.ok) {
                const errorText = await res.text();
                console.error('[SearchV3] ❌ HTTP Error:', res.status, errorText);
                throw new Error(`Erro ${res.status}: falha ao buscar editais`);
            }

            const data = await res.json();
            const items = Array.isArray(data.items) ? data.items : [];
            console.log('[SearchV3] ✅ Response:', { total: data.total, itemsCount: items.length, source: data.source, elapsed: data.elapsed });

            return {
                items,
                total: data.total || items.length,
                source: data.meta?.source || data.source || 'local-fts',
                elapsedMs: data.meta?.elapsedMs || data.elapsed || 0,
            };
        } catch (err: any) {
            clearTimeout(timeout);
            console.error('[SearchV3] ❌ Fetch error:', err?.name, err?.message);
            throw err;
        }
    }, []);

    /**
     * Main search handler — triggered by form submit or saved search load
     */
    const handleSearch = async (e?: React.FormEvent, overrides?: SearchOverrides) => {
        if (e) e.preventDefault();

        const targetPage = (overrides?.resetPage || e) ? 1 : page;
        if (overrides?.resetPage || e) setPage(1);

        setHasSearched(true);
        setLoading(true);
        setSearchSlow(false);
        setSearchSource('');
        setSearchElapsed(0);
        setResults([]);
        setAllResults([]);
        setTotalResults(0);

        const searchParams = {
            keywords: overrides?.keywords ?? keywords,
            status: overrides?.status ?? status,
            uf: overrides?.uf ?? selectedUf,
            pagina: targetPage,
            tamanhoPagina: PAGE_SIZE,
            modalidade: overrides?.modalidade ?? modalidade,
            dataInicio: (overrides?.dataInicio ?? dataInicio) || undefined,
            dataFim: (overrides?.dataFim ?? dataFim) || undefined,
            esfera: overrides?.esfera ?? esfera,
            orgao: overrides?.orgao ?? orgao,
            orgaosLista: overrides?.orgaosLista ?? orgaosLista,
            excludeKeywords: overrides?.excludeKeywords ?? excludeKeywords,
        };

        // Store for pagination re-use
        lastSearchParamsRef.current = searchParams;

        const slowTimer = setTimeout(() => setSearchSlow(true), 5000);

        try {
            console.log('[SearchV3] handleSearch → calling doSearchFetch...');
            const data = await doSearchFetch(searchParams);

            console.log('[SearchV3] handleSearch → doSearchFetch returned:', { items: data.items.length, total: data.total, source: data.source, elapsedMs: data.elapsedMs });

            if (data.items.length === 0 && data.total === 0) {
                toast.info('Nenhum edital encontrado para esses filtros.');
            }

            setSearchSource(data.source as any);
            setSearchElapsed(data.elapsedMs);
            setResults(data.items);
            setAllResults(data.items);
            setTotalResults(data.total);
            console.log('[SearchV3] ✅ State updated: results=', data.items.length, 'totalResults=', data.total);
        } catch (e: any) {
            if (e.name === 'AbortError') {
                console.warn('[SearchV3] ⚠️ Request was ABORTED (user changed search or timeout)');
            } else {
                console.error('[SearchV3] ❌ handleSearch error:', e?.name, e?.message, e);
                toast.error(e?.message || 'Falha na busca. Verifique sua conexão e tente novamente.');
            }
        } finally {
            clearTimeout(slowTimer);
            setLoading(false);
            setSearchSlow(false);
        }
    };

    /**
     * Page change handler — fetches new page from server
     */
    const handlePageChange = async (newPage: number) => {
        if (!lastSearchParamsRef.current || loading) return;

        setPage(newPage);
        setLoading(true);
        window.scrollTo({ top: 0, behavior: 'smooth' });

        const params = { ...lastSearchParamsRef.current, pagina: newPage };

        try {
            const data = await doSearchFetch(params);
            setResults(data.items);
            setAllResults(data.items);
            setTotalResults(data.total);
            setSearchElapsed(data.elapsedMs);
        } catch (e: any) {
            if (e.name !== 'AbortError') {
                toast.error('Erro ao carregar página. Tente novamente.');
            }
        } finally {
            setLoading(false);
        }
    };

    const clearSearch = () => {
        if (searchControllerRef.current) {
            searchControllerRef.current.abort();
            searchControllerRef.current = null;
        }
        lastSearchParamsRef.current = null;
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
        handleSearch, handlePageChange, clearSearch,
    };
}
