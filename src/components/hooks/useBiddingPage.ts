import { useState, useRef, useMemo, useEffect } from 'react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { format } from 'date-fns';
import { aiService } from '../../services/ai';
import { API_BASE_URL } from '../../config';
import type { BiddingProcess, BiddingStatus, AiAnalysis, CompanyProfile } from '../../types';
import { COLUMNS } from '../../types';
import { resolveStage, getDefaultSubstage, type KanbanStage } from '../../governance';
import { useToast } from '../ui';

// ===== FILTER TYPES =====
export interface SmartFilters {
    searchText: string;
    companies: string[];
    modalities: string[];
    portals: string[];
    statuses: string[];
    risks: string[];
}

export const EMPTY_FILTERS: SmartFilters = {
    searchText: '',
    companies: [],
    modalities: [],
    portals: [],
    statuses: [],
    risks: [],
};

// ===== CARD FIELD CONFIG =====
export interface CardFieldConfig {
    key: string;
    label: string;
    visible: boolean;
}

export const INITIAL_CARD_FIELDS: CardFieldConfig[] = [
    { key: 'portal', label: 'Portal / Plataforma', visible: true },
    { key: 'modality', label: 'Modalidade', visible: true },
    { key: 'title', label: 'Título / Processo', visible: true },
    { key: 'company', label: 'Empresa', visible: true },
    { key: 'value', label: 'Valor Estimado', visible: true },
    { key: 'date', label: 'Data da Sessão', visible: true },
    { key: 'risk', label: 'Tag de Risco IA', visible: true },
    { key: 'summary', label: 'Objeto Resumido', visible: false },
    { key: 'observations', label: 'Observações', visible: true },
    { key: 'reminder', label: 'Lembrete', visible: true },
    { key: 'monitoring', label: 'Monitor de Chat (PNCP)', visible: true },
];

interface UseBiddingPageOptions {
    items: BiddingProcess[];
    setItems: React.Dispatch<React.SetStateAction<BiddingProcess[]>>;
    companies: CompanyProfile[];
    initialFilter?: { statuses?: string[]; highlight?: string } | null;
    onFilterConsumed?: () => void;
}

export function useBiddingPage({ items, setItems, companies, initialFilter, onFilterConsumed }: UseBiddingPageOptions) {
    const toast = useToast();
    const [viewMode, setViewMode] = useState<'kanban' | 'table'>(() => {
        return (localStorage.getItem('biddingViewMode') as 'kanban' | 'table') || 'kanban';
    });

    const refreshData = async () => {
        try {
            const res = await fetch(`${API_BASE_URL}/api/biddings`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
            });
            if (res.ok) {
                const data = await res.json();
                setItems(data);
            }
        } catch (err) {
            console.error("Failed to refresh data:", err);
        }
    };

    const analyses = useMemo(() => {
        return items.filter(i => i.aiAnalysis).map(i => i.aiAnalysis!);
    }, [items]);

    // ===== FILTERS + CARD CONFIG =====
    const [filters, setFilters] = useState<SmartFilters>(EMPTY_FILTERS);
    const [cardFields, setCardFields] = useState<CardFieldConfig[]>(() => {
        const saved = localStorage.getItem('biddingCardFields');
        return saved ? JSON.parse(saved) : INITIAL_CARD_FIELDS;
    });
    const [showFilterPanel, setShowFilterPanel] = useState(false);
    const [showCardConfig, setShowCardConfig] = useState(false);

    // Apply initial filter from dashboard deep links
    useEffect(() => {
        if (initialFilter?.statuses && initialFilter.statuses.length > 0) {
            setFilters(prev => ({ ...prev, statuses: initialFilter.statuses! }));
            setShowFilterPanel(true);
            onFilterConsumed?.();
        }
    }, [initialFilter]);

    // ===== SETTINGS =====
    const [visibleColumns, setVisibleColumns] = useState<string[]>(() => {
        const saved = localStorage.getItem('biddingVisibleColumns');
        return saved ? JSON.parse(saved) : [...COLUMNS];
    });
    const [sortBy, setSortBy] = useState<'default' | 'date-asc' | 'date-desc' | 'value-desc' | 'value-asc' | 'risk'>(() => {
        return (localStorage.getItem('biddingSortBy') as any) || 'default';
    });
    const [defaultCompanyId, setDefaultCompanyId] = useState<string>('');
    const [compactMode, setCompactMode] = useState<boolean>(() => {
        return localStorage.getItem('biddingCompactMode') === 'true';
    });

    useEffect(() => {
        localStorage.setItem('biddingViewMode', viewMode);
        localStorage.setItem('biddingVisibleColumns', JSON.stringify(visibleColumns));
        localStorage.setItem('biddingSortBy', sortBy);
        localStorage.setItem('biddingCompactMode', String(compactMode));
        localStorage.setItem('biddingCardFields', JSON.stringify(cardFields));
    }, [viewMode, visibleColumns, sortBy, compactMode, cardFields]);

    const [highlightExpiring, setHighlightExpiring] = useState(true);

    // ===== AI CONFIG =====
    const [aiLanguage, setAiLanguage] = useState<'pt-br' | 'en' | 'es'>('pt-br');
    const [aiFocus, setAiFocus] = useState<'general' | 'it' | 'engineering' | 'services' | 'vehicles' | 'transportation' | 'lighting' | 'food' | 'events' | 'accounting' | 'clothing' | 'consulting'>('general');
    const [aiAutoAnalyze, setAiAutoAnalyze] = useState(false);

    // ===== EXPORT =====
    const getExportData = () => {
        const headers = ['Título', 'Objeto Resumido', 'Empresa', 'Data Sessão', 'Valor Estimado', 'Modalidade', 'Portal', 'Risco', 'Status'];
        const rows = filteredItems.map(item => {
            const companyName = companies.find(c => c.id === item.companyProfileId)?.razaoSocial || '';
            return [
                (item.title || '').replace(/"/g, '""'),
                (item.summary || '').replace(/"/g, '""'),
                companyName.replace(/"/g, '""'),
                new Date(item.sessionDate).toLocaleDateString(),
                item.estimatedValue || '0',
                item.modality || '',
                item.portal || '',
                item.risk || '',
                item.status || ''
            ];
        });
        return { headers, rows };
    };

    const exportToCsv = () => {
        const { headers, rows } = getExportData();
        const csvContent = [headers.join(','), ...rows.map(r => `"${r.join('","')}"`)] .join('\n');
        downloadFile(csvContent, 'licitacoes.csv', 'text/csv;charset=utf-8;');
    };

    const exportToExcel = () => {
        const { headers, rows } = getExportData();
        const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Licitações");
        XLSX.writeFile(wb, `relatorio_licitacoes_${format(new Date(), 'yyyyMMdd_HHmm')}.xlsx`);
    };

    const exportToPdf = () => {
        const doc = new jsPDF('l', 'mm', 'a4');
        const { headers, rows } = getExportData();
        const pdfRows = rows.map(row => {
            const r = [...row];
            if (typeof r[1] === 'string' && r[1].length > 250) {
                r[1] = r[1].substring(0, 247) + '...';
            }
            return r;
        });
        doc.setFontSize(18);
        doc.text('Relatório de Processos Licitatórios', 14, 22);
        doc.setFontSize(11);
        doc.setTextColor(100);
        doc.text(`Gerado em: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, 14, 30);
        let filterText = 'Filtros Ativos: ' + (hasActiveFilters ? `${activeFilterCount} aplicados` : 'Nenhum');
        doc.text(filterText, 14, 35);
        autoTable(doc, {
            head: [headers], body: pdfRows, startY: 45, theme: 'striped',
            headStyles: { fillColor: [37, 99, 235], textColor: 255 },
            styles: { fontSize: 8, cellPadding: 3 },
            columnStyles: {
                0: { cellWidth: 40 }, 1: { cellWidth: 65, halign: 'justify' as any },
                2: { cellWidth: 35 }, 3: { cellWidth: 20 }, 4: { cellWidth: 20 },
                5: { cellWidth: 25 }, 6: { cellWidth: 25 },
            }
        });
        doc.save(`relatorio_licitacoes_${format(new Date(), 'yyyyMMdd_HHmm')}.pdf`);
    };

    const downloadFile = (content: string, fileName: string, type: string) => {
        const blob = new Blob([content], { type });
        const link = document.createElement('a');
        if (link.download !== undefined) {
            const url = URL.createObjectURL(blob);
            link.setAttribute('href', url);
            link.setAttribute('download', fileName);
            link.style.visibility = 'hidden';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        }
    };

    // ===== DYNAMIC FILTER OPTIONS =====
    const filterOptions = useMemo(() => ({
        companies: Array.from(new Set(items.map(i => i.companyProfileId).filter(Boolean))) as string[],
        modalities: Array.from(new Set(items.map(i => i.modality).filter(Boolean))) as string[],
        portals: Array.from(new Set(items.map(i => i.portal).filter(Boolean))) as string[],
        statuses: COLUMNS as string[],
        risks: ['Baixo', 'Médio', 'Alto', 'Crítico'] as string[],
    }), [items]);

    // ===== SMART FILTERING =====
    const filteredItems = useMemo(() => {
        return items.filter(item => {
            if (filters.searchText) {
                const text = filters.searchText.toLowerCase();
                const companyName = companies.find(c => c.id === item.companyProfileId)?.razaoSocial || '';
                const match = item.title?.toLowerCase().includes(text) ||
                    item.summary?.toLowerCase().includes(text) ||
                    item.portal?.toLowerCase().includes(text) ||
                    item.modality?.toLowerCase().includes(text) ||
                    companyName.toLowerCase().includes(text);
                if (!match) return false;
            }
            if (filters.companies.length > 0 && (!item.companyProfileId || !filters.companies.includes(item.companyProfileId))) return false;
            if (filters.modalities.length > 0 && !filters.modalities.includes(item.modality)) return false;
            if (filters.portals.length > 0 && !filters.portals.includes(item.portal)) return false;
            if (filters.statuses.length > 0 && !filters.statuses.includes(item.status)) return false;
            if (filters.risks.length > 0 && !filters.risks.includes(item.risk || '')) return false;
            return true;
        });
    }, [items, filters, companies]);

    const hasActiveFilters = filters.searchText !== '' || filters.companies.length > 0 || filters.modalities.length > 0 || filters.portals.length > 0 || filters.statuses.length > 0 || filters.risks.length > 0;
    const activeFilterCount = [filters.companies.length > 0, filters.modalities.length > 0, filters.portals.length > 0, filters.statuses.length > 0, filters.risks.length > 0].filter(Boolean).length;

    // ===== MODAL STATE =====
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingProcess, setEditingProcess] = useState<Partial<BiddingProcess> | null>(null);
    const [pendingAnalysis, setPendingAnalysis] = useState<AiAnalysis | null>(null);
    const [isParsingAI, setIsParsingAI] = useState(false);
    const [viewingProcessForAnalysis, setViewingProcessForAnalysis] = useState<BiddingProcess | null>(null);
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // ===== NOTIFICATION STATE =====
    const [activeNotification, setActiveNotification] = useState<{ item: BiddingProcess; audio: HTMLAudioElement } | null>(null);

    const getNextWeekdayOccurrence = (reminderDate: string, reminderDays: string): Date | null => {
        try {
            const days: number[] = JSON.parse(reminderDays || '[]');
            if (days.length === 0) return null;
            const baseTime = new Date(reminderDate);
            const hours = baseTime.getHours();
            const minutes = baseTime.getMinutes();
            const now = new Date();
            for (let offset = 1; offset <= 7; offset++) {
                const candidate = new Date(now);
                candidate.setDate(candidate.getDate() + offset);
                candidate.setHours(hours, minutes, 0, 0);
                if (days.includes(candidate.getDay())) return candidate;
            }
            return null;
        } catch { return null; }
    };

    const handleReminderAction = (action: 'ok' | 'tomorrow' | 'dismiss') => {
        if (!activeNotification) return;
        const { item, audio } = activeNotification;
        audio.pause();
        audio.currentTime = 0;

        const updateReminder = (data: Partial<BiddingProcess>) => {
            fetch(`${API_BASE_URL}/api/biddings/${item.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                body: JSON.stringify(data)
            }).then(() => {
                setItems(prev => prev.map(p => p.id === item.id ? { ...p, ...data } : p));
            }).catch(console.error);
        };

        if (action === 'dismiss') {
            updateReminder({ reminderStatus: 'triggered', reminderType: 'once', reminderDays: '[]' });
        } else if (action === 'tomorrow') {
            const baseTime = new Date(item.reminderDate!);
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            tomorrow.setHours(baseTime.getHours(), baseTime.getMinutes(), 0, 0);
            updateReminder({ reminderDate: tomorrow.toISOString(), reminderStatus: 'pending' });
        } else if (action === 'ok') {
            if (item.reminderType === 'weekdays' && item.reminderDays) {
                const nextDate = getNextWeekdayOccurrence(item.reminderDate!, item.reminderDays);
                if (nextDate) updateReminder({ reminderDate: nextDate.toISOString(), reminderStatus: 'pending' });
                else updateReminder({ reminderStatus: 'triggered' });
            } else {
                updateReminder({ reminderStatus: 'triggered' });
            }
        }
        setActiveNotification(null);
    };

    // Notification permission
    useEffect(() => {
        if ("Notification" in window && Notification.permission !== "granted" && Notification.permission !== "denied") {
            Notification.requestPermission();
        }
    }, []);

    // Reminder check interval
    useEffect(() => {
        const checkReminders = () => {
            if (activeNotification) return;
            const now = new Date();
            for (const item of items) {
                if (item.reminderDate && item.reminderStatus === 'pending') {
                    const reminderTime = new Date(item.reminderDate);
                    if (item.reminderType === 'weekdays' && item.reminderDays) {
                        try {
                            const days: number[] = JSON.parse(item.reminderDays);
                            if (!days.includes(now.getDay())) continue;
                        } catch { continue; }
                    }
                    if (now >= reminderTime) {
                        if ("Notification" in window && Notification.permission === "granted") {
                            new Notification(`Lembrete: ${item.title}`, {
                                body: `Sua licitação está agendada para ${new Date(item.reminderDate!).toLocaleString('pt-BR')}`,
                                icon: 'https://cdn-icons-png.flaticon.com/512/3602/3602145.png'
                            });
                        }
                        const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
                        audio.loop = true;
                        audio.play().catch(e => console.error("Audio play failed:", e));
                        setActiveNotification({ item, audio });
                        break;
                    }
                }
            }
        };
        const interval = setInterval(checkReminders, 15000);
        checkReminders();
        return () => clearInterval(interval);
    }, [items, activeNotification]);

    // ===== CRUD HANDLERS =====
    const handleCreateNew = () => { setEditingProcess(null); setIsModalOpen(true); };

    const handleEdit = (process: BiddingProcess) => { setEditingProcess(process); setIsModalOpen(true); };

    const handleSaveProcess = (process: Partial<BiddingProcess>, aiData?: any) => {
        if (editingProcess && editingProcess.id) {
            fetch(`${API_BASE_URL}/api/biddings/${editingProcess.id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                body: JSON.stringify(process)
            }).then(async (res) => {
                if (!res.ok) { const errorObj = await res.json(); throw new Error(errorObj.error || 'Server error'); }
                setItems(prev => prev.map(p => p.id === editingProcess.id ? { ...p, ...process } as BiddingProcess : p));
                const finalAnalysisPayload = aiData || pendingAnalysis;
                if (finalAnalysisPayload) {
                    const finalAnalysis = { ...finalAnalysisPayload, biddingProcessId: editingProcess.id };
                    fetch(`${API_BASE_URL}/api/analysis`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                        body: JSON.stringify(finalAnalysis)
                    }).then((res) => { if (res.ok) setItems(prev => prev.map(p => p.id === editingProcess.id ? { ...p, aiAnalysis: finalAnalysis } : p)); }).catch(console.error);
                    setPendingAnalysis(null);
                }
            }).catch(e => { console.error("Update error:", e); toast.error("Erro ao atualizar a licitação no servidor."); });
        } else {
            fetch(`${API_BASE_URL}/api/biddings`, {
                method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                body: JSON.stringify(process)
            }).then(async (res) => {
                if (!res.ok) { const errorObj = await res.json(); throw new Error(errorObj.error || 'Server error'); }
                const newProcess = await res.json();
                setItems(prev => [newProcess, ...prev]);
                const finalAnalysisPayload = aiData || pendingAnalysis;
                if (finalAnalysisPayload) {
                    const finalAnalysis = { ...finalAnalysisPayload, biddingProcessId: newProcess.id };
                    fetch(`${API_BASE_URL}/api/analysis`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                        body: JSON.stringify(finalAnalysis)
                    }).then((res) => { if (res.ok) setItems(prev => prev.map(p => p.id === newProcess.id ? { ...p, aiAnalysis: finalAnalysis } : p)); }).catch(console.error);
                    setPendingAnalysis(null);
                }
            }).catch(e => { console.error("Creation error:", e); toast.error(`Erro ao salvar a nova licitação: ${e instanceof Error ? e.message : String(e)}`); });
        }
        setIsModalOpen(false);
    };

    const handleStatusChange = (id: string, status: BiddingStatus) => {
        const substage = getDefaultSubstage(status as KanbanStage);
        fetch(`${API_BASE_URL}/api/biddings/${id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
            body: JSON.stringify({ status, substage })
        }).then(async (res) => {
            if (!res.ok) { const errorObj = await res.json(); throw new Error(errorObj.error || 'Server error'); }
            setItems(prev => prev.map(p => p.id === id ? { ...p, status, substage } : p));
        }).catch(e => { console.error("Status update error:", e); toast.error("Erro ao salvar a movimentação no servidor."); refreshData(); });
    };

    const handleToggleMonitor = (id: string) => {
        const item = items.find(p => p.id === id);
        if (!item) return;
        const newStatus = !item.isMonitored;
        setItems(prev => prev.map(p => p.id === id ? { ...p, isMonitored: newStatus } : p));
        fetch(`${API_BASE_URL}/api/biddings/${id}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
            body: JSON.stringify({ isMonitored: newStatus })
        }).catch(err => { console.error("Failed to toggle monitor:", err); setItems(prev => prev.map(p => p.id === id ? { ...p, isMonitored: !newStatus } : p)); });
    };

    const handleDeleteProcess = async (id: string) => { setConfirmDeleteId(id); };

    const confirmDelete = async () => {
        const id = confirmDeleteId;
        if (!id) return;
        setConfirmDeleteId(null);
        try {
            const res = await fetch(`${API_BASE_URL}/api/biddings/${id}`, {
                method: 'DELETE', headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
            });
            if (res.ok) { setItems(prev => prev.filter(p => p.id !== id)); toast.success('Licitação excluída com sucesso.'); }
            else { const errPayload = await res.json().catch(() => ({})); throw new Error(errPayload.error || 'Failed to delete'); }
        } catch (err) { console.error(err); toast.error(`Erro ao excluir licitação: ${err instanceof Error ? err.message : String(err)}`); }
    };

    const handleAIAssistClick = () => { fileInputRef.current?.click(); };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;
        try {
            setIsParsingAI(true);
            const { process: parsedData, analysis } = await aiService.parseEditalPDF(files);
            setEditingProcess(parsedData);
            setPendingAnalysis(analysis);
            setIsModalOpen(true);
        } catch (error) {
            console.error('Failed to parse document with AI', error);
            const errorMessage = error instanceof Error ? error.message : 'Falha ao extrair dados do Edital.';
            toast.error(errorMessage);
        } finally {
            setIsParsingAI(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    // ===== PIPELINE COUNTERS =====
    const statusCounters = useMemo(() => ({
        captado: items.filter(i => resolveStage(i.status) === 'Captado').length,
        analise: items.filter(i => resolveStage(i.status) === 'Em Análise').length,
        preparando: items.filter(i => ['Preparando Documentação', 'Preparando Proposta'].includes(resolveStage(i.status))).length,
        participando: items.filter(i => resolveStage(i.status) === 'Em Sessão').length,
        vencido: items.filter(i => resolveStage(i.status) === 'Ganho').length,
        perdido: items.filter(i => ['Perdido', 'Não Participar'].includes(resolveStage(i.status))).length,
    }), [items]);

    return {
        // View
        viewMode, setViewMode,
        // Filters
        filters, setFilters, filterOptions,
        filteredItems, hasActiveFilters, activeFilterCount,
        showFilterPanel, setShowFilterPanel,
        // Card config
        cardFields, setCardFields, showCardConfig, setShowCardConfig,
        // Settings
        visibleColumns, setVisibleColumns,
        sortBy, setSortBy,
        defaultCompanyId, setDefaultCompanyId,
        compactMode, setCompactMode,
        highlightExpiring, setHighlightExpiring,
        // AI config
        aiLanguage, setAiLanguage,
        aiFocus, setAiFocus,
        aiAutoAnalyze, setAiAutoAnalyze,
        // Analyses
        analyses,
        // Modal
        isModalOpen, setIsModalOpen,
        editingProcess, setEditingProcess,
        pendingAnalysis, setPendingAnalysis,
        viewingProcessForAnalysis, setViewingProcessForAnalysis,
        confirmDeleteId, setConfirmDeleteId,
        // Notification
        activeNotification, handleReminderAction,
        // Loading
        isParsingAI,
        // Refs
        fileInputRef,
        // Counters
        statusCounters,
        // Handlers
        refreshData, handleCreateNew, handleEdit, handleSaveProcess,
        handleStatusChange, handleToggleMonitor,
        handleDeleteProcess, confirmDelete,
        handleAIAssistClick, handleFileUpload,
        exportToCsv, exportToExcel, exportToPdf,
    };
}
