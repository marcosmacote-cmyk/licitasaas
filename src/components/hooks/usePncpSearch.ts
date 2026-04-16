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
    // Request sequence counter — used to ignore stale responses
    const requestSeqRef = useRef(0);

    /**
     * Core fetch function — calls the unified /search endpoint
     * IMPORTANT: Does NOT abort previous requests to prevent orphan server connections
     * that exhaust the database connection pool. Instead uses requestSeq to ignore stale results.
     */
    const doSearchFetch = useCallback(async (params: any, seq: number): Promise<{ items: PncpBiddingItem[], total: number, source: string, elapsedMs: number } | null> => {
        console.log(`[SearchV3] doSearchFetch #${seq} called with params:`, JSON.stringify(params));

        const controller = new AbortController();
        searchControllerRef.current = controller;
        // 8s timeout (server has 3s statement_timeout + overhead)
        const timeout = setTimeout(() => {
            console.log(`[SearchV3] ⏰ #${seq} 8s timeout reached, aborting`);
            controller.abort();
        }, 8000);

        try {
            const token = localStorage.getItem('token');
            const url = `${API_BASE_URL}/api/pncp/search-hybrid`;
            console.log(`[SearchV3] #${seq} Fetching:`, url);

            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                signal: controller.signal,
                body: JSON.stringify(params),
            });
            clearTimeout(timeout);

            // If a newer request was fired while we waited, discard this result
            if (seq !== requestSeqRef.current) {
                console.log(`[SearchV3] #${seq} discarded (stale — current is #${requestSeqRef.current})`);
                return null;
            }

            console.log(`[SearchV3] #${seq} Response status:`, res.status);

            if (!res.ok) {
                throw new Error(`Erro ${res.status}: falha ao buscar editais`);
            }

            const data = await res.json();
            const items = Array.isArray(data.items) ? data.items : [];
            console.log(`[SearchV3] #${seq} ✅ Response:`, { total: data.total, itemsCount: items.length, source: data.source, elapsed: data.elapsed });

            return {
                items,
                total: data.total || items.length,
                source: data.meta?.source || data.source || 'local-fts',
                elapsedMs: data.meta?.elapsedMs || data.elapsed || 0,
            };
        } catch (err: any) {
            clearTimeout(timeout);
            console.error(`[SearchV3] #${seq} ❌ Fetch error:`, err?.name, err?.message);
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

        // Increment request sequence — previous in-flight requests will be ignored
        const seq = ++requestSeqRef.current;

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
            console.log(`[SearchV3] handleSearch #${seq} → calling doSearchFetch...`);
            const data = await doSearchFetch(searchParams, seq);

            // Null means this request was superseded by a newer one
            if (!data) {
                console.log(`[SearchV3] #${seq} result discarded (newer search active)`);
                return;
            }

            console.log(`[SearchV3] #${seq} → returned:`, { items: data.items.length, total: data.total });

            if (data.items.length === 0 && data.total === 0) {
                toast.info('Nenhum edital encontrado para esses filtros.');
            }

            setSearchSource(data.source as any);
            setSearchElapsed(data.elapsedMs);
            setResults(data.items);
            setAllResults(data.items);
            setTotalResults(data.total);
            console.log(`[SearchV3] #${seq} ✅ State updated: results=`, data.items.length);
        } catch (e: any) {
            if (e.name === 'AbortError') {
                console.warn(`[SearchV3] #${seq} ⚠️ Request timed out`);
            } else {
                console.error(`[SearchV3] #${seq} ❌ Error:`, e?.message);
                toast.error(e?.message || 'Falha na busca. Verifique sua conexão e tente novamente.');
            }
        } finally {
            // Only clear loading if this is still the active request
            if (seq === requestSeqRef.current) {
                clearTimeout(slowTimer);
                setLoading(false);
                setSearchSlow(false);
            }
        }
    };

    /**
     * Page change handler — fetches new page from server
     */
    const handlePageChange = async (newPage: number) => {
        if (!lastSearchParamsRef.current || loading) return;

        const seq = ++requestSeqRef.current;
        setPage(newPage);
        setLoading(true);
        window.scrollTo({ top: 0, behavior: 'smooth' });

        const params = { ...lastSearchParamsRef.current, pagina: newPage };

        try {
            const data = await doSearchFetch(params, seq);
            if (!data) return; // Stale
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
