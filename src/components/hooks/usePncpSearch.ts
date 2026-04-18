/**
 * ═══════════════════════════════════════════════════════════
 * usePncpSearch v4 — Bulletproof Search Hook
 * 
 * DESIGN PRINCIPLES:
 * 1. ONE request at a time — mutex guarantees serialization
 * 2. AbortController cancels previous BROWSER-SIDE only
 * 3. No concurrent HTTP connections to search endpoint
 * 4. Simple, predictable state management
 * ═══════════════════════════════════════════════════════════
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
    valorMin?: string;
    valorMax?: string;
    resetPage?: boolean;
}

const PAGE_SIZE = 10;
const API_PAGE_SIZE = 100;

export function usePncpSearch() {
    const toast = useToast();

    // Results state
    const [allResults, setAllResults] = useState<PncpBiddingItem[]>([]);
    const [results, setResults] = useState<PncpBiddingItem[]>([]);
    const [loading, setLoading] = useState(false);
    const [searchSlow, setSearchSlow] = useState(false);
    const [searchSource, setSearchSource] = useState<'local' | 'govbr' | 'local-fts' | ''>('');
    const [searchElapsed, setSearchElapsed] = useState(0);

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
    const [valorMin, setValorMin] = useState('');
    const [valorMax, setValorMax] = useState('');
    const [page, setPage] = useState(1);
    const [totalResults, setTotalResults] = useState(0);
    const [hasSearched, setHasSearched] = useState(false);
    const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

    // Last search params for pagination
    const lastSearchParamsRef = useRef<any>(null);
    const apiPageRef = useRef<number>(1);
    // AbortController for the current in-flight request
    const controllerRef = useRef<AbortController | null>(null);
    // Mutex: true when a request is in-flight (prevents concurrent requests)
    const busyRef = useRef(false);
    // Sequence counter — only the LATEST search controls loading state
    const requestSeqRef = useRef(0);

    /**
     * Core fetch — ultra-simple, one request at a time.
     * If a previous request is in-flight, it is ABORTED first.
     */
    const fetchSearch = useCallback(async (params: any): Promise<{ items: PncpBiddingItem[], total: number, source: string, elapsedMs: number }> => {
        // Cancel any previous in-flight request
        if (controllerRef.current) {
            controllerRef.current.abort();
            controllerRef.current = null;
        }

        // Wait for any previous request to finish aborting (micro-tick)
        if (busyRef.current) {
            await new Promise(r => setTimeout(r, 50));
        }

        busyRef.current = true;
        const controller = new AbortController();
        controllerRef.current = controller;

        try {
            const token = localStorage.getItem('token');
            console.log(`[Search] → POST /api/pncp/search-hybrid`, { uf: params.uf, status: params.status, page: params.pagina });

            const res = await fetch(`${API_BASE_URL}/api/pncp/search-hybrid`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                signal: controller.signal,
                body: JSON.stringify(params),
            });

            if (!res.ok) {
                throw new Error(`Erro ${res.status}`);
            }

            const data = await res.json();
            const items = Array.isArray(data.items) ? data.items : [];
            console.log(`[Search] ✅ ${items.length} items, total=${data.total}, ${data.elapsed}ms`);

            return {
                items,
                total: data.total || items.length,
                source: data.meta?.source || data.source || 'local-fts',
                elapsedMs: data.meta?.elapsedMs || data.elapsed || 0,
            };
        } finally {
            busyRef.current = false;
            controllerRef.current = null;
        }
    }, []);

    /**
     * Main search handler — triggered by form submit or saved search load
     */
    const handleSearch = async (e?: React.FormEvent, overrides?: SearchOverrides) => {
        if (e) e.preventDefault();

        const targetPage = (overrides?.resetPage || e) ? 1 : page;
        if (overrides?.resetPage || e) setPage(1);

        // Sequence guard: only the latest search can control loading/results
        const seq = ++requestSeqRef.current;

        setHasSearched(true);
        setLoading(true);
        setSearchSlow(false);
        setSearchSource('');
        setSearchElapsed(0);
        
        if (targetPage === 1) {
            apiPageRef.current = 1;
        }

        const searchParams = {
            keywords: overrides?.keywords ?? keywords,
            status: overrides?.status ?? status,
            uf: overrides?.uf ?? selectedUf,
            pagina: 1,
            tamanhoPagina: API_PAGE_SIZE,
            modalidade: overrides?.modalidade ?? modalidade,
            dataInicio: (overrides?.dataInicio ?? dataInicio) || undefined,
            dataFim: (overrides?.dataFim ?? dataFim) || undefined,
            esfera: overrides?.esfera ?? esfera,
            orgao: overrides?.orgao ?? orgao,
            orgaosLista: overrides?.orgaosLista ?? orgaosLista,
            excludeKeywords: overrides?.excludeKeywords ?? excludeKeywords,
            valorMin: (overrides?.valorMin ?? valorMin) ? Number(overrides?.valorMin ?? valorMin) : undefined,
            valorMax: (overrides?.valorMax ?? valorMax) ? Number(overrides?.valorMax ?? valorMax) : undefined,
        };

        lastSearchParamsRef.current = searchParams;

        const slowTimer = setTimeout(() => setSearchSlow(true), 5000);

        try {
            const data = await fetchSearch(searchParams);

            // Only apply results if this is still the latest search
            if (seq !== requestSeqRef.current) {
                console.log(`[Search] #${seq} result discarded (superseded by #${requestSeqRef.current})`);
                return;
            }

            if (data.items.length === 0 && data.total === 0) {
                toast.info('Nenhum edital encontrado para esses filtros.');
            }

            setSearchSource(data.source as any);
            setSearchElapsed(data.elapsedMs);
            
            // Sort by deadline
            const sorted = data.items.sort((a: any, b: any) => {
                const dateA = a.data_encerramento_proposta || a.data_abertura || '9999-12-31';
                const dateB = b.data_encerramento_proposta || b.data_abertura || '9999-12-31';
                const tA = new Date(dateA).getTime();
                const tB = new Date(dateB).getTime();
                const st = searchParams.status || '';
                if (st === 'recebendo_proposta' || !st || st === '') return tA - tB;
                return tB - tA;
            });

            setAllResults(sorted);
            setTotalResults(data.total);
            setResults(sorted.slice(0, PAGE_SIZE));
        } catch (e: any) {
            if (e.name === 'AbortError') {
                // Silently ignore — a newer search superseded this one
                console.log(`[Search] #${seq} aborted (newer search active)`);
                return;
            }
            console.error(`[Search] #${seq} ❌`, e?.message);
            if (seq === requestSeqRef.current) {
                toast.error(e?.message || 'Falha na busca. Tente novamente.');
                setResults([]);
                setAllResults([]);
                setTotalResults(0);
            }
        } finally {
            clearTimeout(slowTimer);
            // CRITICAL: Only the LATEST search can clear loading
            // Without this guard, an aborted search's finally block
            // would clear loading for the active search.
            if (seq === requestSeqRef.current) {
                setLoading(false);
                setSearchSlow(false);
            }
        }
    };

    const handlePageChange = async (newPage: number) => {
        if (!lastSearchParamsRef.current || loading) return;

        setPage(newPage);
        window.scrollTo({ top: 0, behavior: 'smooth' });

        const requiredTotalItems = newPage * PAGE_SIZE;
        const currentCachedItems = allResults.length;

        // Do we have enough items in cache? Or have we reached the end?
        if (requiredTotalItems <= currentCachedItems || currentCachedItems >= totalResults) {
            // Yes! Just slice the cache instantly.
            const start = (newPage - 1) * PAGE_SIZE;
            setResults(allResults.slice(start, start + PAGE_SIZE));
            return;
        }

        // We need to fetch the next API chunk
        setLoading(true);
        apiPageRef.current += 1;
        const apiPageToFetch = apiPageRef.current;
        const params = { ...lastSearchParamsRef.current, pagina: apiPageToFetch, tamanhoPagina: API_PAGE_SIZE };

        try {
            const data = await fetchSearch(params);
            
            // Merge with existing cache
            const accumulated = [...allResults, ...data.items];
            
            // Re-sort the entire cache so the absolute closest ones from both chunks appear first
            accumulated.sort((a: any, b: any) => {
                const dateA = a.data_encerramento_proposta || a.data_abertura || '9999-12-31';
                const dateB = b.data_encerramento_proposta || b.data_abertura || '9999-12-31';
                const tA = new Date(dateA).getTime();
                const tB = new Date(dateB).getTime();
                const st = params.status || '';
                if (st === 'recebendo_proposta' || !st || st === '') return tA - tB;
                return tB - tA;
            });

            setAllResults(accumulated);
            setTotalResults(data.total); // Update total just in case
            
            const start = (newPage - 1) * PAGE_SIZE;
            setResults(accumulated.slice(start, start + PAGE_SIZE));
        } catch (e: any) {
            if (e.name !== 'AbortError') {
                toast.error('Erro ao carregar página. Tente novamente.');
            }
        } finally {
            setLoading(false);
        }
    };

    const clearSearch = () => {
        if (controllerRef.current) {
            controllerRef.current.abort();
            controllerRef.current = null;
        }
        busyRef.current = false;
        lastSearchParamsRef.current = null;
        setKeywords(''); setStatus('recebendo_proposta'); setSelectedUf('');
        setSelectedSearchCompanyId(''); setModalidade('todas'); setEsfera('todas');
        setOrgao(''); setOrgaosLista(''); setExcludeKeywords(''); setDataInicio(''); setDataFim('');
        setValorMin(''); setValorMax('');
        setAllResults([]); setResults([]); setTotalResults(0); setPage(1);
        setLoading(false);
        setSearchSlow(false);
    };

    const activeFilterCount = [
        modalidade !== 'todas', esfera !== 'todas', orgao !== '',
        orgaosLista.trim() !== '', excludeKeywords.trim() !== '',
        dataInicio !== '', dataFim !== '', selectedSearchCompanyId !== '',
        valorMin !== '', valorMax !== ''
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
        valorMin, setValorMin, valorMax, setValorMax,
        page, setPage, totalResults, hasSearched,
        showAdvancedFilters, setShowAdvancedFilters,
        activeFilterCount,
        // Actions
        handleSearch, handlePageChange, clearSearch,
    };
}
