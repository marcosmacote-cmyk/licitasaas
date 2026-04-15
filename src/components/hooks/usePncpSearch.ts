/**
 * ═══════════════════════════════════════════════════════
 * usePncpSearch — Busca PNCP (Local-First + Gov.br Fallback)
 * Extracted from usePncpPage.ts (Fase 1 Refatoração)
 * ═══════════════════════════════════════════════════════
 */
import { useState } from 'react';
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
        // Clear previous results visually so it doesn't look stuck when searching a new UF
        setAllResults([]);
        setResults([]);
        setTotalResults(0);

        if (searchControllerRef.current) {
            searchControllerRef.current.abort();
        }
        searchControllerRef.current = new AbortController();

        const timeoutId = setTimeout(() => searchControllerRef.current?.abort(), 30000);
        const slowTimer = setTimeout(() => setSearchSlow(true), 5000);

        const searchParams = {
            keywords: overrides?.keywords ?? keywords, status: overrides?.status ?? status,
            uf: overrides?.uf ?? selectedUf, pagina: 1,
            tamanhoPagina: 500, // Fetch all at once — pagination is client-side
            modalidade: overrides?.modalidade ?? modalidade,
            dataInicio: (overrides?.dataInicio ?? dataInicio) || undefined,
            dataFim: (overrides?.dataFim ?? dataFim) || undefined,
            esfera: overrides?.esfera ?? esfera, orgao: overrides?.orgao ?? orgao,
            orgaosLista: overrides?.orgaosLista ?? orgaosLista,
            excludeKeywords: overrides?.excludeKeywords ?? excludeKeywords,
        };

        try {
            const token = localStorage.getItem('token');
            let items: any[] = [];
            let total = 0;
            let source: 'local' | 'govbr' = 'local';

            // ══════════════════════════════════════════════════
            // STRATEGY: ALWAYS LOCAL-FIRST
            // 1. Try local DB (< 100ms) — works for keywords AND filters
            // 2. If local returns 0 → fallback to Gov.br (8-25s)
            // 3. If Gov.br also fails → user sees clear error
            // ══════════════════════════════════════════════════

            // Step 1: Try local database ALWAYS (even with keywords)
            try {
                const localRes = await fetch(`${API_BASE_URL}/api/pncp/search-local`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                    signal: searchControllerRef.current.signal,
                    body: JSON.stringify(searchParams),
                });
                if (localRes.ok) {
                    const localData = await localRes.json();
                    const localItems = Array.isArray(localData.items) ? localData.items : [];
                    if (localItems.length > 0) {
                        items = localItems;
                        total = localData.total || items.length;
                        source = 'local';
                        if (localData.elapsed) setSearchElapsed(localData.elapsed);
                    }
                }
            } catch { /* local failed, will fallback to Gov.br */ }

            // Step 2: ONLY if local returned 0 → try Gov.br (with 15s timeout)
            if (items.length === 0) {
                source = 'govbr';
                const govController = new AbortController();
                const govTimeout = setTimeout(() => govController.abort(), 15000); // 15s hard timeout
                try {
                    const govRes = await fetch(`${API_BASE_URL}/api/pncp/search`, {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                        signal: govController.signal,
                        body: JSON.stringify(searchParams),
                    });
                    if (govRes.ok) {
                        const govData = await govRes.json();
                        items = Array.isArray(govData.items) ? govData.items : [];
                        total = govData.total || items.length;
                    }
                    // Don't retry on 500 — it just hangs the UI
                } catch (govErr: any) {
                    if (govErr.name === 'AbortError') {
                        toast.warning('A API do Gov.br não respondeu em 15s. Mostrando apenas resultados da base local.');
                    }
                } finally {
                    clearTimeout(govTimeout);
                }
            }

            // Apply results
            setSearchSource(source);
            setAllResults(items);
            setTotalResults(total);
            setResults(items.slice(0, 10));

            // Prefetch items (only needed for Gov.br results, local already has items)
            if (source === 'govbr' && items.length > 0) {
                const prefetchCandidates = items.slice(0, 10)
                    .filter((it: any) => it.orgao_cnpj && it.ano && it.numero_sequencial)
                    .map((it: any) => ({ cnpj: it.orgao_cnpj, ano: it.ano, seq: it.numero_sequencial }));
                if (prefetchCandidates.length > 0) {
                    fetch(`${API_BASE_URL}/api/pncp/items/prefetch`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                        body: JSON.stringify({ processes: prefetchCandidates }),
                    }).catch(() => {});
                }
            }
        } catch (e: any) {
            if (e.name === 'AbortError') {
                toast.error('O portal PNCP (Gov.br) está demorando para responder. Tente novamente ou refine sua busca.');
            } else {
                console.error(e);
                toast.error(e?.message || 'Falha na conexão com o PNCP. Verifique sua internet e tente novamente.');
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
