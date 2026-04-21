/**
 * ═══════════════════════════════════════════════════════
 * usePncpScanner — Scanner de Oportunidades Automático
 * Extracted from usePncpPage.ts (Fase 1 Refatoração)
 * ═══════════════════════════════════════════════════════
 */
import { useState, useEffect } from 'react';
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

export function usePncpScanner() {
    const toast = useToast();

    // Scanner state
    const [opportunityScannerEnabled, setOpportunityScannerEnabled] = useState(true);
    const [lastScanAt, setLastScanAt] = useState<string | null>(null);
    const [lastScanTotalNew, setLastScanTotalNew] = useState(0);
    const [lastScanResults, setLastScanResults] = useState<ScanResult[]>([]);
    const [nextScanAt, setNextScanAt] = useState<string | null>(null);

    // Scanner Opportunities ("Encontradas" tab)
    const [scannerOpportunities, setScannerOpportunities] = useState<any[]>([]);
    const [scannerOpportunitiesTotal, setScannerOpportunitiesTotal] = useState(0);
    const [scannerOpportunitiesPage, setScannerOpportunitiesPage] = useState(1);
    const [scannerOpportunitiesLoading, setScannerOpportunitiesLoading] = useState(false);
    const [scannerFilterSearchId, setScannerFilterSearchId] = useState<string | null>(null);
    const [scannerFilterDate, setScannerFilterDate] = useState<string | null>(null);
    const [unreadOpportunityCount, setUnreadOpportunityCount] = useState(0);
    const [loading, setLoading] = useState(false);

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
            if (scannerFilterDate) url += `&date=${scannerFilterDate}`;
            const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
            if (res.ok) {
                const data = await res.json();
                setScannerOpportunities(data.items || []);
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

    useEffect(() => {
        fetchScannerStatus();
        fetchUnreadCount();
    }, []);

    return {
        // Global scanner
        opportunityScannerEnabled, toggleOpportunityScanner,
        // Last scan info
        lastScanAt, lastScanTotalNew, lastScanResults, nextScanAt, getSearchScanResult,
        // Scanner Opportunities ("Encontradas" tab)
        scannerOpportunities, scannerOpportunitiesTotal, scannerOpportunitiesPage, setScannerOpportunitiesPage,
        scannerOpportunitiesLoading, scannerFilterSearchId, setScannerFilterSearchId,
        scannerFilterDate, setScannerFilterDate,
        unreadOpportunityCount, markOpportunitiesViewed, fetchScannerOpportunities,
        handleTriggerScan, loading: loading,
    };
}
