/**
 * ═══════════════════════════════════════════════════════
 * usePncpScanner — Scanner de Oportunidades Automático
 * 
 * V2: Arquitetura de "summary + lazy-load por data"
 * - Carrega sumário de TODAS as datas de uma vez (~1KB)
 * - Itens são carregados sob demanda ao expandir cada card
 * - Remove paginação global (era "Página X de Y")
 * ═══════════════════════════════════════════════════════
 */
import { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL } from '../../config';
import { useToast } from '../ui';

interface ScanResult {
    searchId: string;
    searchName: string;
    companyName: string;
    totalFound: number;
    newCount: number;
    status: string;
    errorMessage?: string;
}

export interface DateGroupSummary {
    date: string;      // YYYY-MM-DD
    count: number;      // total items
    unread: number;     // unread items
}

export function usePncpScanner() {
    const toast = useToast();

    // Scanner state
    const [opportunityScannerEnabled, setOpportunityScannerEnabled] = useState(true);
    const [lastScanAt, setLastScanAt] = useState<string | null>(null);
    const [lastScanTotalNew, setLastScanTotalNew] = useState(0);
    const [lastScanResults, setLastScanResults] = useState<ScanResult[]>([]);
    const [nextScanAt, setNextScanAt] = useState<string | null>(null);

    // ═══ Summary: all date groups (lightweight) ═══
    const [dateSummary, setDateSummary] = useState<DateGroupSummary[]>([]);
    const [scannerOpportunitiesTotal, setScannerOpportunitiesTotal] = useState(0);
    const [unreadOpportunityCount, setUnreadOpportunityCount] = useState(0);
    const [summaryLoading, setSummaryLoading] = useState(false);

    // ═══ Per-date items (lazy-loaded on expand) ═══
    const [dateItems, setDateItems] = useState<Record<string, any[]>>({});
    const [dateItemsLoading, setDateItemsLoading] = useState<Record<string, boolean>>({});

    // Filter
    const [scannerFilterSearchId, setScannerFilterSearchId] = useState<string | null>(null);

    const [loading, setLoading] = useState(false);

    // ── Backward compat aliases (kept to avoid breaking return contract) ──
    const scannerOpportunitiesLoading = summaryLoading;

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

    /**
     * Fetch the lightweight summary of all dates + counts.
     * This replaces the old paginated opportunities fetch.
     */
    const fetchScannerSummary = useCallback(async () => {
        setSummaryLoading(true);
        try {
            const token = localStorage.getItem('token');
            let url = `${API_BASE_URL}/api/pncp/scanner/opportunities/summary`;
            if (scannerFilterSearchId) url += `?searchId=${scannerFilterSearchId}`;
            const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
            if (res.ok) {
                const data = await res.json();
                setDateSummary(data.groups || []);
                setScannerOpportunitiesTotal(data.total || 0);
                setUnreadOpportunityCount(data.totalUnread || 0);
            }
        } catch (e) { console.error("Failed to fetch scanner summary", e); }
        finally { setSummaryLoading(false); }
    }, [scannerFilterSearchId]);

    /**
     * Fetch items for a specific date. Called when user expands a date card.
     * Uses the existing /scanner/opportunities endpoint with date filter.
     * Loads 50 items per call (matching the existing pageSize).
     */
    const fetchDateItems = useCallback(async (date: string, append = false) => {
        setDateItemsLoading(prev => ({ ...prev, [date]: true }));
        try {
            const token = localStorage.getItem('token');
            const currentItems = append ? (dateItems[date] || []) : [];
            const page = append ? Math.floor(currentItems.length / 50) + 1 : 1;
            
            let url = `${API_BASE_URL}/api/pncp/scanner/opportunities?date=${date}&page=${page}`;
            if (scannerFilterSearchId) url += `&searchId=${scannerFilterSearchId}`;
            
            const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
            if (res.ok) {
                const data = await res.json();
                const newItems = data.items || [];
                setDateItems(prev => ({
                    ...prev,
                    [date]: append ? [...currentItems, ...newItems] : newItems,
                }));
            }
        } catch (e) { console.error(`Failed to fetch items for date ${date}`, e); }
        finally { setDateItemsLoading(prev => ({ ...prev, [date]: false })); }
    }, [scannerFilterSearchId, dateItems]);

    const markOpportunitiesViewed = async (ids: string[] | 'all') => {
        try {
            const token = localStorage.getItem('token');
            await fetch(`${API_BASE_URL}/api/pncp/scanner/opportunities/mark-viewed`, {
                method: 'PATCH',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids })
            });
            // Refresh summary + any loaded date items
            fetchScannerSummary();
            // Reload expanded dates
            for (const date of Object.keys(dateItems)) {
                fetchDateItems(date);
            }
        } catch (e) { console.error(e); }
    };

    const toggleOpportunityScanner = async (enabled: boolean) => {
        setOpportunityScannerEnabled(enabled);
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
                setOpportunityScannerEnabled(!enabled);
            }
        } catch (e) {
            console.error(e);
            toast.error('Falha de conexão ao salvar configuração.');
            setOpportunityScannerEnabled(!enabled);
        }
    };

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
                setTimeout(fetchScannerStatus, 30000);
            } else { throw new Error("Erro na varredura"); }
        } catch (e: any) {
            console.error(e);
            toast.error('Falha ao iniciar varredura de oportunidades.');
        } finally {
            setLoading(false);
        }
    };

    const getSearchScanResult = (searchId: string) => {
        return lastScanResults.find(r => r.searchId === searchId) || null;
    };

    // Reset dateItems when filter changes
    useEffect(() => {
        setDateItems({});
    }, [scannerFilterSearchId]);

    useEffect(() => {
        fetchScannerStatus();
    }, []);

    return {
        // Global scanner
        opportunityScannerEnabled, toggleOpportunityScanner,
        // Last scan info
        lastScanAt, lastScanTotalNew, lastScanResults, nextScanAt, getSearchScanResult,
        // Summary (replaces paginated opportunities)
        dateSummary, fetchScannerSummary,
        scannerOpportunitiesTotal,
        scannerOpportunitiesLoading: summaryLoading,
        // Per-date items (lazy-loaded)
        dateItems, dateItemsLoading, fetchDateItems,
        // Filter
        scannerFilterSearchId, setScannerFilterSearchId,
        // Unread
        unreadOpportunityCount, markOpportunitiesViewed,
        // Trigger
        handleTriggerScan, loading,
    };
}
