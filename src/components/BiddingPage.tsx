import { useState, useRef, useMemo, useEffect } from 'react';
import { Settings, Plus, LayoutGrid, List, Bot, Loader2, Bell, Search, SlidersHorizontal, Filter, X, ChevronDown, Download } from 'lucide-react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { format } from 'date-fns';
import { KanbanBoard } from './KanbanBoard';
import { BiddingTable } from './BiddingTable';
import { ProcessFormModal } from './ProcessFormModal';
import { AiReportModal } from './AiReportModal';
import { aiService } from '../services/ai';
import { API_BASE_URL } from '../config';
import type { BiddingProcess, BiddingStatus, AiAnalysis, CompanyProfile } from '../types';
import { COLUMNS } from '../types';

// export const INITIAL_DATA: BiddingProcess[] = [ ... ] (Removed for brevity, now fetched from API)

interface Props {
    items: BiddingProcess[];
    setItems: React.Dispatch<React.SetStateAction<BiddingProcess[]>>;
    companies: CompanyProfile[];
}

// ===== SISTEMA DE FILTROS INTELIGENTES =====
interface SmartFilters {
    searchText: string;
    companies: string[]; // companyProfileId[]
    modalities: string[];
    portals: string[];
    statuses: string[];
    risks: string[];
}

const EMPTY_FILTERS: SmartFilters = {
    searchText: '',
    companies: [],
    modalities: [],
    portals: [],
    statuses: [],
    risks: [],
};

// ===== CAMPOS CONFIGURÁVEIS NOS CARDS =====
interface CardFieldConfig {
    key: string;
    label: string;
    visible: boolean;
}

const INITIAL_CARD_FIELDS: CardFieldConfig[] = [
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

export function BiddingPage({ items, setItems, companies }: Props) {
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

    // ===== NOVOS ESTADOS: Filtros + Config de Campos =====
    const [filters, setFilters] = useState<SmartFilters>(EMPTY_FILTERS);
    const [cardFields, setCardFields] = useState<CardFieldConfig[]>(() => {
        const saved = localStorage.getItem('biddingCardFields');
        return saved ? JSON.parse(saved) : INITIAL_CARD_FIELDS;
    });
    const [showFilterPanel, setShowFilterPanel] = useState(false);
    const [showCardConfig, setShowCardConfig] = useState(false);

    // ===== CONFIGURAÇÕES DO PAINEL =====
    const [showSettingsPanel, setShowSettingsPanel] = useState(false);
    const [showExportMenu, setShowExportMenu] = useState(false);

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

    // ===== CONFIGURAÇÕES IA & TIME (Premium) =====
    const [aiLanguage, setAiLanguage] = useState<'pt-br' | 'en' | 'es'>('pt-br');
    const [aiFocus, setAiFocus] = useState<'general' | 'it' | 'engineering' | 'services' | 'vehicles' | 'transportation' | 'lighting' | 'food' | 'events' | 'accounting' | 'clothing' | 'consulting'>('general');
    const [aiAutoAnalyze, setAiAutoAnalyze] = useState(false);

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
        const csvContent = [headers.join(','), ...rows.map(r => `"${r.join('","')}"`)].join('\n');
        downloadFile(csvContent, 'licitacoes.csv', 'text/csv;charset=utf-8;');
        setShowExportMenu(false);
    };

    const exportToExcel = () => {
        const { headers, rows } = getExportData();
        const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Licitações");
        XLSX.writeFile(wb, `relatorio_licitacoes_${format(new Date(), 'yyyyMMdd_HHmm')}.xlsx`);
        setShowExportMenu(false);
    };

    const exportToPdf = () => {
        const doc = new jsPDF('l', 'mm', 'a4');
        const { headers, rows } = getExportData();

        // Limita o tamanho do texto do "Objeto Resumido" para o PDF para não quebrar o layout
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
            head: [headers],
            body: pdfRows,
            startY: 45,
            theme: 'striped',
            headStyles: { fillColor: [37, 99, 235], textColor: 255 },
            styles: { fontSize: 8, cellPadding: 3 },
            columnStyles: {
                0: { cellWidth: 40 },
                1: { cellWidth: 65, halign: 'justify' as any },
                2: { cellWidth: 35 },
                3: { cellWidth: 20 },
                4: { cellWidth: 20 },
                5: { cellWidth: 25 },
                6: { cellWidth: 25 },
            }
        });

        doc.save(`relatorio_licitacoes_${format(new Date(), 'yyyyMMdd_HHmm')}.pdf`);
        setShowExportMenu(false);
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

    // Opções dinâmicas para filtros
    const filterOptions = useMemo(() => ({
        companies: Array.from(new Set(items.map(i => i.companyProfileId).filter(Boolean))) as string[],
        modalities: Array.from(new Set(items.map(i => i.modality).filter(Boolean))) as string[],
        portals: Array.from(new Set(items.map(i => i.portal).filter(Boolean))) as string[],
        statuses: COLUMNS as string[],
        risks: ['Baixo', 'Médio', 'Alto', 'Crítico'] as string[],
    }), [items]);

    // Filtragem inteligente
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

    // Modal State
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingProcess, setEditingProcess] = useState<Partial<BiddingProcess> | null>(null);
    const [pendingAnalysis, setPendingAnalysis] = useState<AiAnalysis | null>(null);
    const [isParsingAI, setIsParsingAI] = useState(false);
    const [viewingProcessForAnalysis, setViewingProcessForAnalysis] = useState<BiddingProcess | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Interactive Notification State
    const [activeNotification, setActiveNotification] = useState<{ item: BiddingProcess; audio: HTMLAudioElement } | null>(null);

    // Helper: find the next occurrence matching selected weekdays
    const getNextWeekdayOccurrence = (reminderDate: string, reminderDays: string): Date | null => {
        try {
            const days: number[] = JSON.parse(reminderDays || '[]');
            if (days.length === 0) return null;

            const baseTime = new Date(reminderDate);
            const hours = baseTime.getHours();
            const minutes = baseTime.getMinutes();

            const now = new Date();
            // Try next 7 days to find a matching day
            for (let offset = 1; offset <= 7; offset++) {
                const candidate = new Date(now);
                candidate.setDate(candidate.getDate() + offset);
                candidate.setHours(hours, minutes, 0, 0);
                if (days.includes(candidate.getDay())) {
                    return candidate;
                }
            }
            return null;
        } catch {
            return null;
        }
    };

    // Reminder action handlers
    const handleReminderAction = (action: 'ok' | 'tomorrow' | 'dismiss') => {
        if (!activeNotification) return;
        const { item, audio } = activeNotification;
        audio.pause();
        audio.currentTime = 0;

        const updateReminder = (data: Partial<BiddingProcess>) => {
            fetch(`${API_BASE_URL}/api/biddings/${item.id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify(data)
            }).then(() => {
                setItems(prev => prev.map(p => p.id === item.id ? { ...p, ...data } : p));
            }).catch(console.error);
        };

        if (action === 'dismiss') {
            // Turn off alarm completely
            updateReminder({ reminderStatus: 'triggered', reminderType: 'once', reminderDays: '[]' });
        } else if (action === 'tomorrow') {
            // Reschedule to tomorrow at the same time
            const baseTime = new Date(item.reminderDate!);
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            tomorrow.setHours(baseTime.getHours(), baseTime.getMinutes(), 0, 0);
            updateReminder({ reminderDate: tomorrow.toISOString(), reminderStatus: 'pending' });
        } else if (action === 'ok') {
            if (item.reminderType === 'weekdays' && item.reminderDays) {
                // Auto-schedule next matching weekday
                const nextDate = getNextWeekdayOccurrence(item.reminderDate!, item.reminderDays);
                if (nextDate) {
                    updateReminder({ reminderDate: nextDate.toISOString(), reminderStatus: 'pending' });
                } else {
                    updateReminder({ reminderStatus: 'triggered' });
                }
            } else {
                // One-time: just mark as triggered
                updateReminder({ reminderStatus: 'triggered' });
            }
        }

        setActiveNotification(null);
    };

    // Notification API Permission Request
    useEffect(() => {
        if ("Notification" in window && Notification.permission !== "granted" && Notification.permission !== "denied") {
            Notification.requestPermission();
        }
    }, []);

    // Reminder Check Logic
    useEffect(() => {
        const checkReminders = () => {
            if (activeNotification) return; // Don't stack notifications

            const now = new Date();
            for (const item of items) {
                if (item.reminderDate && item.reminderStatus === 'pending') {
                    const reminderTime = new Date(item.reminderDate);

                    // For weekday-based alarms, also check if today is a selected day
                    if (item.reminderType === 'weekdays' && item.reminderDays) {
                        try {
                            const days: number[] = JSON.parse(item.reminderDays);
                            if (!days.includes(now.getDay())) continue;
                        } catch { continue; }
                    }

                    if (now >= reminderTime) {
                        // Trigger background notification if permitted
                        if ("Notification" in window && Notification.permission === "granted") {
                            new Notification(`Lembrete: ${item.title}`, {
                                body: `Sua licitação está agendada para ${new Date(item.reminderDate!).toLocaleString('pt-BR')}`,
                                icon: 'https://cdn-icons-png.flaticon.com/512/3602/3602145.png'
                            });
                        }

                        // Trigger visual notification
                        const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
                        audio.loop = true;
                        audio.play().catch(e => console.error("Audio play failed:", e));
                        setActiveNotification({ item, audio });
                        break; // Only one at a time
                    }
                }
            }
        };

        const interval = setInterval(checkReminders, 15000);
        checkReminders(); // Check immediately
        return () => clearInterval(interval);
    }, [items, activeNotification]);


    const handleCreateNew = () => {
        setEditingProcess(null);
        setIsModalOpen(true);
    };

    const handleEdit = (process: BiddingProcess) => {
        setEditingProcess(process);
        setIsModalOpen(true);
    };

    const handleSaveProcess = (process: Partial<BiddingProcess>, aiData?: any) => {
        // If it possesses an ID, it is an update of an existing process.
        // Otherwise (like when pre-filled by AI), it's a new process creation.
        if (editingProcess && editingProcess.id) {
            // Update existing in backend
            fetch(`${API_BASE_URL}/api/biddings/${editingProcess.id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify(process)
            }).then(async (res) => {
                if (!res.ok) {
                    const errorObj = await res.json();
                    throw new Error(errorObj.error || 'Server error');
                }
                setItems(prev => prev.map(p => p.id === editingProcess.id ? { ...p, ...process } as BiddingProcess : p));

                const finalAnalysisPayload = aiData || pendingAnalysis;
                if (finalAnalysisPayload) {
                    const finalAnalysis = { ...finalAnalysisPayload, biddingProcessId: editingProcess.id };
                    fetch(`${API_BASE_URL}/api/analysis`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${localStorage.getItem('token')}`
                        },
                        body: JSON.stringify(finalAnalysis)
                    }).then((res) => {
                        if (res.ok) {
                            setItems(prev => prev.map(p => p.id === editingProcess.id ? { ...p, aiAnalysis: finalAnalysis } : p));
                        }
                    }).catch(console.error);
                    setPendingAnalysis(null);
                }

            }).catch(e => {
                console.error("Update error:", e);
                alert("Erro ao atualizar a licitação no servidor.");
            });

        } else {
            // Create new in backend
            fetch(`${API_BASE_URL}/api/biddings`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify(process)
            }).then(async (res) => {
                if (!res.ok) {
                    const errorObj = await res.json();
                    throw new Error(errorObj.error || 'Server error');
                }
                const newProcess = await res.json();
                setItems(prev => [newProcess, ...prev]);

                const finalAnalysisPayload = aiData || pendingAnalysis;
                // If we have a pending AI analysis for this new process, save it
                if (finalAnalysisPayload) {
                    const finalAnalysis = { ...finalAnalysisPayload, biddingProcessId: newProcess.id };

                    fetch(`${API_BASE_URL}/api/analysis`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${localStorage.getItem('token')}`
                        },
                        body: JSON.stringify(finalAnalysis)
                    }).then((res) => {
                        if (res.ok) {
                            // Update the newly created process in `items` so the analyses memo catches it
                            setItems(prev => prev.map(p => p.id === newProcess.id ? { ...p, aiAnalysis: finalAnalysis } : p));
                        }
                    }).catch(console.error);

                    setPendingAnalysis(null);
                }
            }).catch(e => {
                console.error("Creation error:", e);
                alert(`Erro ao salvar a nova licitação: ${e instanceof Error ? e.message : String(e)}`);
            });
        }
        setIsModalOpen(false);
    };

    const handleStatusChange = (id: string, status: BiddingStatus) => {
        fetch(`${API_BASE_URL}/api/biddings/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify({ status })
        }).then(async (res) => {
            if (!res.ok) {
                const errorObj = await res.json();
                throw new Error(errorObj.error || 'Server error');
            }
            // State is already updated by KanbanBoard locally, but we ensure consistency
            console.log('[BiddingPage] Before setItems (status change)');
            setItems(prev => prev.map(p => p.id === id ? { ...p, status } : p));
            console.log('[BiddingPage] After setItems (status change)');
        }).catch(e => {
            console.error("Status update error:", e);
            alert("Erro ao salvar a movimentação no servidor. Verifique sua conexão.");
            // Optional: Revert local state if needed
            refreshData();
        });
    };

    const handleToggleMonitor = (id: string) => {
        const item = items.find(p => p.id === id);
        if (!item) return;

        const newStatus = !item.isMonitored;
        
        // Update locally
        setItems(prev => prev.map(p => p.id === id ? { ...p, isMonitored: newStatus } : p));

        // Update in backend
        fetch(`${API_BASE_URL}/api/biddings/${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            },
            body: JSON.stringify({ isMonitored: newStatus })
        }).catch(err => {
            console.error("Failed to toggle monitor:", err);
            // Revert locally if failed
            setItems(prev => prev.map(p => p.id === id ? { ...p, isMonitored: !newStatus } : p));
        });
    };


    const handleDeleteProcess = async (id: string) => {
        if (window.confirm('Tem certeza que deseja excluir esta licitação?')) {
            try {
                const res = await fetch(`${API_BASE_URL}/api/biddings/${id}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
                });
                if (res.ok) {
                    setItems(prev => prev.filter(p => p.id !== id));
                } else {
                    const errPayload = await res.json().catch(() => ({}));
                    throw new Error(errPayload.error || 'Failed to delete');
                }
            } catch (err) {
                console.error(err);
                alert(`Erro ao excluir licitação: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
    };

    const handleAIAssistClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;

        try {
            setIsParsingAI(true);
            const { process: parsedData, analysis } = await aiService.parseEditalPDF(files);

            // Form is prefilled, keep the analysis pending until user actually saves the form
            setEditingProcess(parsedData);
            setPendingAnalysis(analysis);
            setIsModalOpen(true);
        } catch (error) {
            console.error('Failed to parse document with AI', error);
            const errorMessage = error instanceof Error ? error.message : 'Falha ao extrair dados do Edital. Tente novamente mais tarde.';
            alert(errorMessage);
        } finally {
            setIsParsingAI(false);
            // Reset input
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    return (
        <div className="page-container">
            {/* Interactive Notification Banner */}
            {activeNotification && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    zIndex: 9999,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'rgba(0, 0, 0, 0.6)',
                    backdropFilter: 'blur(8px)',
                    animation: 'fadeIn 0.3s ease-out'
                }}>
                    <div style={{
                        width: '100%',
                        maxWidth: '500px',
                        padding: '32px',
                        background: 'linear-gradient(145deg, rgba(30, 41, 59, 1), rgba(15, 23, 42, 1))',
                        borderRadius: '1.5rem',
                        boxShadow: '0 0 80px rgba(245, 158, 11, 0.3), inset 0 1px 0 rgba(255,255,255,0.1)',
                        color: 'white',
                        border: '2px solid rgba(245, 158, 11, 0.5)',
                        animation: 'scaleUp 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
                    }}>
                        {/* Header */}
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: '16px', marginBottom: '32px' }}>
                            <div style={{
                                background: 'linear-gradient(135deg, #f59e0b, #ef4444)',
                                borderRadius: '50%',
                                padding: '16px',
                                animation: 'pulseRing 2s infinite',
                                boxShadow: '0 0 30px rgba(245, 158, 11, 0.6)'
                            }}>
                                <Bell size={40} color="white" />
                            </div>
                            <div>
                                <div style={{ fontSize: '1.1rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '2px', color: '#f87171', marginBottom: '8px' }}>
                                    Lembrete {activeNotification.item.reminderType === 'weekdays' ? 'Recorrente' : ''}
                                </div>
                                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#fcd34d', lineHeight: 1.3, marginBottom: '12px' }}>
                                    {activeNotification.item.title}
                                </div>
                                <div style={{ fontSize: '1rem', color: '#cbd5e1', background: 'rgba(0,0,0,0.3)', padding: '8px 16px', borderRadius: '20px', display: 'inline-block' }}>
                                    ⏰ {new Date(activeNotification.item.reminderDate!).toLocaleString('pt-BR')}
                                </div>
                                {activeNotification.item.reminderType === 'weekdays' && (() => {
                                    try {
                                        const days: number[] = JSON.parse(activeNotification.item.reminderDays || '[]');
                                        const labels = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
                                        return <div style={{ marginTop: '12px', color: '#fbbf24', fontSize: '0.875rem', fontWeight: 600 }}>
                                            Repete às: {days.map(d => labels[d]).join(', ')}
                                        </div>;
                                    } catch { return null; }
                                })()}
                            </div>
                        </div>

                        {/* Action Buttons */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <button
                                onClick={() => handleReminderAction('ok')}
                                style={{
                                    width: '100%',
                                    padding: '14px',
                                    borderRadius: '12px',
                                    border: 'none',
                                    background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                                    color: 'white',
                                    fontWeight: 700,
                                    fontSize: '1rem',
                                    cursor: 'pointer',
                                    boxShadow: '0 4px 15px rgba(37, 99, 235, 0.4)',
                                    transition: 'all 0.2s',
                                }}
                                onMouseEnter={(e: any) => (e.currentTarget.style.transform = 'translateY(-2px)')}
                                onMouseLeave={(e: any) => (e.currentTarget.style.transform = 'translateY(0)')}
                            >
                                ✅ {activeNotification.item.reminderType === 'weekdays' ? 'Ciente (Agendar próximo)' : 'Estou Ciente'}
                            </button>
                            <div style={{ display: 'flex', gap: '12px' }}>
                                <button
                                    onClick={() => handleReminderAction('tomorrow')}
                                    style={{
                                        flex: 1,
                                        padding: '12px',
                                        borderRadius: '12px',
                                        border: '1px solid rgba(245, 158, 11, 0.4)',
                                        background: 'rgba(245, 158, 11, 0.1)',
                                        color: '#fcd34d',
                                        fontWeight: 600,
                                        fontSize: '0.9rem',
                                        cursor: 'pointer',
                                        transition: 'all 0.2s',
                                    }}
                                    onMouseEnter={(e: any) => (e.currentTarget.style.background = 'rgba(245, 158, 11, 0.2)')}
                                    onMouseLeave={(e: any) => (e.currentTarget.style.background = 'rgba(245, 158, 11, 0.1)')}
                                >
                                    📅 Adiar Amanhã
                                </button>
                                <button
                                    onClick={() => handleReminderAction('dismiss')}
                                    style={{
                                        flex: 1,
                                        padding: '12px',
                                        borderRadius: '12px',
                                        border: '1px solid rgba(239, 68, 68, 0.4)',
                                        background: 'rgba(239, 68, 68, 0.1)',
                                        color: '#fca5a5',
                                        fontWeight: 600,
                                        fontSize: '0.9rem',
                                        cursor: 'pointer',
                                        transition: 'all 0.2s',
                                    }}
                                    onMouseEnter={(e: any) => (e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)')}
                                    onMouseLeave={(e: any) => (e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)')}
                                >
                                    🔕 Desativar Alarme
                                </button>
                            </div>
                        </div>
                    </div>
                    <style>{`
                        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
                        @keyframes scaleUp { from { transform: scale(0.9); opacity: 0; } to { transform: scale(1); opacity: 1; } }
                        @keyframes pulseRing { 
                            0% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0.7); } 
                            70% { box-shadow: 0 0 0 20px rgba(245, 158, 11, 0); } 
                            100% { box-shadow: 0 0 0 0 rgba(245, 158, 11, 0); } 
                        }
                    `}</style>
                </div>
            )}
            <div className="page-header flex-between">
                <div>
                    <h1 className="page-title">Processos Licitatórios</h1>
                    <p className="page-subtitle">Acompanhe o funil de licitações da sua empresa.</p>
                </div>
                <div className="flex-gap">
                    {/* View Toggle */}
                    <div className="flex-gap" style={{ background: 'var(--color-bg-surface)', padding: '4px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                        <button
                            className={`icon-btn ${viewMode === 'kanban' ? 'active' : ''}`}
                            style={{ background: viewMode === 'kanban' ? 'var(--color-bg-surface-hover)' : 'transparent' }}
                            onClick={() => setViewMode('kanban')}
                            title="Visão Kanban"
                        >
                            <LayoutGrid size={16} />
                        </button>
                        <button
                            className={`icon-btn ${viewMode === 'table' ? 'active' : ''}`}
                            style={{ background: viewMode === 'table' ? 'var(--color-bg-surface-hover)' : 'transparent' }}
                            onClick={() => setViewMode('table')}
                            title="Visão Tabela"
                        >
                            <List size={16} />
                        </button>
                    </div>

                    <div style={{ position: 'relative' }}>
                        <button
                            className={`btn ${showExportMenu ? 'btn-primary' : 'btn-outline'}`}
                            onClick={() => setShowExportMenu(!showExportMenu)}
                        >
                            <Download size={16} />
                            Exportar
                            <ChevronDown size={14} style={{ marginLeft: 4, transform: showExportMenu ? 'rotate(180deg)' : 'none', transition: '0.2s' }} />
                        </button>
                        {showExportMenu && (
                            <div style={{
                                position: 'absolute', top: '44px', right: 0, width: '180px',
                                background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)',
                                borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-xl)', zIndex: 100,
                                overflow: 'hidden'
                            }}>
                                <div style={{ padding: '6px' }}>
                                    <button
                                        onClick={exportToCsv}
                                        style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', background: 'transparent', color: 'var(--color-text-primary)', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 500 }}
                                        onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'var(--color-bg-base)'}
                                        onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                                    >
                                        📥 Arquivo CSV
                                    </button>
                                    <button
                                        onClick={exportToExcel}
                                        style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', background: 'transparent', color: 'var(--color-text-primary)', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 500 }}
                                        onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'var(--color-bg-base)'}
                                        onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                                    >
                                        📊 Planilha Excel
                                    </button>
                                    <button
                                        onClick={exportToPdf}
                                        style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', background: 'transparent', color: 'var(--color-text-primary)', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.875rem', fontWeight: 500 }}
                                        onMouseEnter={(e: any) => e.currentTarget.style.backgroundColor = 'var(--color-bg-base)'}
                                        onMouseLeave={(e: any) => e.currentTarget.style.backgroundColor = 'transparent'}
                                    >
                                        📄 Documento PDF
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>

                    <div style={{ position: 'relative' }}>
                        <button
                            className={`btn ${showSettingsPanel ? 'btn-primary' : 'btn-outline'}`}
                            style={showSettingsPanel ? { backgroundColor: '#059669', borderColor: '#059669' } : {}}
                            onClick={() => setShowSettingsPanel(!showSettingsPanel)}
                        >
                            <Settings size={16} />
                            Configurar
                        </button>

                        {showSettingsPanel && (
                            <div style={{
                                position: 'absolute', top: '44px', right: 0, width: '340px',
                                background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)',
                                borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-xl)', zIndex: 100,
                                overflow: 'hidden'
                            }}>
                                <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--color-border)', background: 'linear-gradient(135deg, rgba(5, 150, 105, 0.08), rgba(16, 185, 129, 0.05))' }}>
                                    <div style={{ fontWeight: 700, fontSize: '0.9375rem' }}>⚙️ Configurações</div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', marginTop: '2px' }}>Personalize o painel de licitações</div>
                                </div>
                                <div style={{ maxHeight: '450px', overflowY: 'auto' }}>

                                    {/* === SEÇÃO 1: Colunas do Kanban === */}
                                    <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--color-border)' }}>
                                        <h4 style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>📋 Colunas do Kanban</h4>
                                        <div style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)', marginBottom: '8px' }}>Mostre/esconda fases do processo</div>
                                        {(COLUMNS as string[]).map(col => (
                                            <label key={col} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 4px', cursor: 'pointer', borderRadius: '4px', fontSize: '0.8125rem' }}
                                                onMouseEnter={(e: React.MouseEvent<HTMLLabelElement>) => (e.currentTarget.style.background = 'var(--color-bg-surface-hover)')}
                                                onMouseLeave={(e: React.MouseEvent<HTMLLabelElement>) => (e.currentTarget.style.background = 'transparent')}
                                            >
                                                <span style={{ color: 'var(--color-text-primary)' }}>{col}</span>
                                                <div
                                                    onClick={(e: React.MouseEvent) => {
                                                        e.preventDefault();
                                                        if (visibleColumns.includes(col)) {
                                                            if (visibleColumns.length > 1) setVisibleColumns(visibleColumns.filter(c => c !== col));
                                                        } else {
                                                            setVisibleColumns([...visibleColumns, col]);
                                                        }
                                                    }}
                                                    style={{
                                                        width: '32px', height: '18px', borderRadius: '999px', position: 'relative', cursor: 'pointer', transition: 'background 0.2s',
                                                        background: visibleColumns.includes(col) ? '#059669' : 'var(--color-border)',
                                                    }}
                                                >
                                                    <div style={{
                                                        position: 'absolute', top: '2px', left: visibleColumns.includes(col) ? '16px' : '2px',
                                                        width: '14px', height: '14px', borderRadius: '50%', background: 'white',
                                                        boxShadow: '0 1px 3px rgba(0,0,0,0.2)', transition: 'left 0.2s',
                                                    }} />
                                                </div>
                                            </label>
                                        ))}
                                        <div style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)', marginTop: '6px', textAlign: 'center' }}>
                                            {visibleColumns.length} de {COLUMNS.length} visíveis
                                        </div>
                                    </div>

                                    {/* === SEÇÃO 2: Ordenação Padrão === */}
                                    <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--color-border)' }}>
                                        <h4 style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>📊 Ordenação dos Cards</h4>
                                        <div style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)', marginBottom: '8px' }}>Como os cards são ordenados dentro de cada coluna</div>
                                        {[
                                            { value: 'default', label: '📌 Ordem manual (padrão)', icon: '' },
                                            { value: 'date-asc', label: '📅 Sessão mais próxima primeiro', icon: '' },
                                            { value: 'date-desc', label: '📅 Sessão mais distante primeiro', icon: '' },
                                            { value: 'value-desc', label: '💰 Maior valor primeiro', icon: '' },
                                            { value: 'value-asc', label: '💰 Menor valor primeiro', icon: '' },
                                            { value: 'risk', label: '⚠️ Maior risco primeiro', icon: '' },
                                        ].map(opt => (
                                            <label key={opt.value} style={{
                                                display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 4px', cursor: 'pointer',
                                                borderRadius: '4px', fontSize: '0.8125rem',
                                                background: sortBy === opt.value ? 'rgba(5, 150, 105, 0.08)' : 'transparent',
                                                color: sortBy === opt.value ? '#059669' : 'var(--color-text-primary)',
                                                fontWeight: sortBy === opt.value ? 600 : 400,
                                            }}
                                                onClick={() => setSortBy(opt.value as typeof sortBy)}
                                                onMouseEnter={(e: React.MouseEvent<HTMLLabelElement>) => { if (sortBy !== opt.value) e.currentTarget.style.background = 'var(--color-bg-surface-hover)'; }}
                                                onMouseLeave={(e: React.MouseEvent<HTMLLabelElement>) => { if (sortBy !== opt.value) e.currentTarget.style.background = 'transparent'; }}
                                            >
                                                <div style={{
                                                    width: '16px', height: '16px', borderRadius: '50%', border: `2px solid ${sortBy === opt.value ? '#059669' : 'var(--color-border)'}`,
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                                                }}>
                                                    {sortBy === opt.value && <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#059669' }} />}
                                                </div>
                                                {opt.label}
                                            </label>
                                        ))}
                                    </div>

                                    {/* === SEÇÃO 3: Aparência dos Cards === */}
                                    <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--color-border)' }}>
                                        <h4 style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>🎨 Aparência dos Cards</h4>
                                        <div style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)', marginBottom: '8px' }}>Personalize o visual no Kanban</div>

                                        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 4px', cursor: 'pointer', borderRadius: '4px', fontSize: '0.8125rem' }}
                                            onMouseEnter={(e: React.MouseEvent<HTMLLabelElement>) => (e.currentTarget.style.background = 'var(--color-bg-surface-hover)')}
                                            onMouseLeave={(e: React.MouseEvent<HTMLLabelElement>) => (e.currentTarget.style.background = 'transparent')}
                                        >
                                            <span style={{ color: 'var(--color-text-primary)' }}>Cards Compactos</span>
                                            <div
                                                onClick={(e: React.MouseEvent) => { e.preventDefault(); setCompactMode(!compactMode); }}
                                                style={{ width: '32px', height: '18px', borderRadius: '999px', position: 'relative', cursor: 'pointer', transition: 'background 0.2s', background: compactMode ? '#059669' : 'var(--color-border)' }}
                                            >
                                                <div style={{ position: 'absolute', top: '2px', left: compactMode ? '16px' : '2px', width: '14px', height: '14px', borderRadius: '50%', background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.2)', transition: 'left 0.2s' }} />
                                            </div>
                                        </label>

                                        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 4px', cursor: 'pointer', borderRadius: '4px', fontSize: '0.8125rem' }}
                                            onMouseEnter={(e: React.MouseEvent<HTMLLabelElement>) => (e.currentTarget.style.background = 'var(--color-bg-surface-hover)')}
                                            onMouseLeave={(e: React.MouseEvent<HTMLLabelElement>) => (e.currentTarget.style.background = 'transparent')}
                                        >
                                            <span style={{ color: 'var(--color-text-primary)' }}>Destaque em Vencimentos Próximos</span>
                                            <div
                                                onClick={(e: React.MouseEvent) => { e.preventDefault(); setHighlightExpiring(!highlightExpiring); }}
                                                style={{ width: '32px', height: '18px', borderRadius: '999px', position: 'relative', cursor: 'pointer', transition: 'background 0.2s', background: highlightExpiring ? '#059669' : 'var(--color-border)' }}
                                            >
                                                <div style={{ position: 'absolute', top: '2px', left: highlightExpiring ? '16px' : '2px', width: '14px', height: '14px', borderRadius: '50%', background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.2)', transition: 'left 0.2s' }} />
                                            </div>
                                        </label>
                                    </div>

                                    {/* === SEÇÃO 4: Empresa Padrão === */}
                                    <div style={{ padding: '14px 16px' }}>
                                        <h4 style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '10px' }}>🏢 Empresa Padrão</h4>
                                        <div style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)', marginBottom: '8px' }}>Pré-selecionada ao criar novo processo</div>
                                        <select
                                            value={defaultCompanyId}
                                            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setDefaultCompanyId(e.target.value)}
                                            style={{
                                                width: '100%', padding: '8px 12px', fontSize: '0.8125rem',
                                                border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
                                                background: 'var(--color-bg-surface)', color: 'var(--color-text-primary)',
                                                cursor: 'pointer', outline: 'none',
                                            }}
                                        >
                                            <option value="">Nenhuma (selecionar manualmente)</option>
                                            {companies.map(c => (
                                                <option key={c.id} value={c.id}>{c.razaoSocial}</option>
                                            ))}
                                        </select>
                                        {defaultCompanyId && (
                                            <div style={{ marginTop: '6px', fontSize: '0.75rem', color: '#059669', fontWeight: 500 }}>
                                                ✅ {companies.find(c => c.id === defaultCompanyId)?.razaoSocial} será pré-selecionada
                                            </div>
                                        )}
                                    </div>

                                    {/* === SEÇÃO 5: Preferências da IA === */}
                                    <div style={{ padding: '14px 16px', borderTop: '1px solid var(--color-border)' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                                            <h4 style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>🤖 Preferências da IA</h4>
                                            <span style={{ fontSize: '0.65rem', background: 'var(--color-bg-brand-hover)', color: 'var(--color-primary)', padding: '2px 6px', borderRadius: '4px', fontWeight: 600 }}>PREMIUM</span>
                                        </div>

                                        <div style={{ marginBottom: '12px' }}>
                                            <div style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)', marginBottom: '4px' }}>Idioma do Relatório</div>
                                            <select
                                                value={aiLanguage}
                                                onChange={(e: any) => setAiLanguage(e.target.value)}
                                                style={{ width: '100%', padding: '6px 8px', fontSize: '0.8125rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg-surface)' }}
                                            >
                                                <option value="pt-br">Português (BR)</option>
                                                <option value="en">Inglês</option>
                                                <option value="es">Espanhol</option>
                                            </select>
                                        </div>

                                        <div style={{ marginBottom: '12px' }}>
                                            <div style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)', marginBottom: '4px' }}>Foco de Análise</div>
                                            <select
                                                value={aiFocus}
                                                onChange={(e: any) => setAiFocus(e.target.value)}
                                                style={{ width: '100%', padding: '6px 8px', fontSize: '0.8125rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg-surface)' }}
                                            >
                                                <option value="general">Geral (Padrão)</option>
                                                <option value="it">T.I e Software</option>
                                                <option value="engineering">Engenharia e Obras</option>
                                                <option value="services">Serviços Terceirizados</option>
                                                <option value="vehicles">Locação de Veículos e Máquinas Pesadas</option>
                                                <option value="transportation">Transporte Escolar</option>
                                                <option value="lighting">Iluminação Pública</option>
                                                <option value="food">Gêneros Alimentícios</option>
                                                <option value="events">Eventos e Estruturas</option>
                                                <option value="accounting">Serviços Contábeis e Auditoria</option>
                                                <option value="clothing">Fardamento e Confecção</option>
                                                <option value="consulting">Assessoria e Consultoria</option>
                                            </select>
                                        </div>

                                        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 4px', cursor: 'pointer', borderRadius: '4px', fontSize: '0.8125rem' }}
                                            onMouseEnter={(e: any) => (e.currentTarget.style.background = 'var(--color-bg-surface-hover)')}
                                            onMouseLeave={(e: any) => (e.currentTarget.style.background = 'transparent')}
                                        >
                                            <div>
                                                <span style={{ color: 'var(--color-text-primary)', display: 'block' }}>Auto-Análise de PDF</span>
                                                <span style={{ fontSize: '0.65rem', color: 'var(--color-text-tertiary)' }}>Extrair dados ao fazer upload</span>
                                            </div>
                                            <div
                                                onClick={(e: any) => { e.preventDefault(); setAiAutoAnalyze(!aiAutoAnalyze); }}
                                                style={{ width: '32px', height: '18px', borderRadius: '999px', position: 'relative', cursor: 'pointer', transition: 'background 0.2s', background: aiAutoAnalyze ? '#059669' : 'var(--color-border)' }}
                                            >
                                                <div style={{ position: 'absolute', top: '2px', left: aiAutoAnalyze ? '16px' : '2px', width: '14px', height: '14px', borderRadius: '50%', background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.2)', transition: 'left 0.2s' }} />
                                            </div>
                                        </label>
                                    </div>

                                    {/* === SEÇÃO 6: Equipe e Permissões === */}
                                    <div style={{ padding: '14px 16px', borderTop: '1px solid var(--color-border)' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                                            <h4 style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>👥 Equipe e Permissões</h4>
                                            <span style={{ fontSize: '0.65rem', background: 'var(--color-bg-brand-hover)', color: 'var(--color-primary)', padding: '2px 6px', borderRadius: '4px', fontWeight: 600 }}>PREMIUM</span>
                                        </div>
                                        <div style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)', marginBottom: '12px' }}>
                                            Compartilhe o Kanban com seu time, defina permissões de leitura/edição e acompanhe a auditoria de acessos.
                                        </div>
                                        <button
                                            className="btn btn-outline"
                                            style={{ width: '100%', fontSize: '0.8125rem', padding: '6px' }}
                                            onClick={(e: any) => {
                                                e.stopPropagation();
                                                alert("O recurso de gestão de Equipe estará disponível em breve no plano Premium!");
                                            }}
                                        >
                                            + Convidar Membro
                                        </button>
                                    </div>

                                </div>
                            </div>
                        )}
                    </div>

                    <input
                        type="file"
                        accept="application/pdf"
                        ref={fileInputRef}
                        style={{ display: 'none' }}
                        onChange={handleFileUpload}
                        multiple
                    />

                    <button
                        className="btn btn-primary"
                        style={{ backgroundColor: '#8b5cf6', borderColor: '#8b5cf6' }}
                        onClick={handleAIAssistClick}
                        disabled={isParsingAI}
                    >
                        {isParsingAI ? <Loader2 size={16} className="spinner" /> : <Bot size={16} />}
                        {isParsingAI ? 'Analisando PDF...' : 'IA: Extrair Edital'}
                    </button>

                    <button className="btn btn-primary" onClick={handleCreateNew}>
                        <Plus size={16} />
                        Nova Licitação
                    </button>
                </div>
            </div>

            {/* ===== BARRA DE FILTROS INTELIGENTES + CONFIG DE CAMPOS ===== */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px', flexWrap: 'wrap' }}>
                {/* Botão Filtros */}
                <div style={{ position: 'relative' }}>
                    <button
                        className={`btn ${showFilterPanel || hasActiveFilters ? 'btn-primary' : 'btn-outline'}`}
                        style={showFilterPanel || hasActiveFilters ? { backgroundColor: 'var(--color-primary)', borderColor: 'var(--color-primary)' } : {}}
                        onClick={() => { setShowFilterPanel(!showFilterPanel); setShowCardConfig(false); }}
                    >
                        <Filter size={14} />
                        Filtros
                        {activeFilterCount > 0 && (
                            <span style={{
                                background: hasActiveFilters && !showFilterPanel ? 'rgba(255,255,255,0.3)' : 'var(--color-primary)',
                                color: 'white',
                                fontSize: '0.65rem',
                                padding: '1px 6px',
                                borderRadius: '999px',
                                fontWeight: 700,
                                marginLeft: '4px'
                            }}>{activeFilterCount}</span>
                        )}
                    </button>

                    {showFilterPanel && (
                        <div style={{
                            position: 'absolute', top: '44px', left: 0, width: '300px',
                            background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)',
                            borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-xl)', zIndex: 100,
                            overflow: 'hidden'
                        }}>
                            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontWeight: 700, fontSize: '0.875rem' }}>Filtros Inteligentes</span>
                                {hasActiveFilters && <button onClick={() => setFilters(EMPTY_FILTERS)} style={{ fontSize: '0.75rem', color: 'var(--color-danger)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Limpar</button>}
                            </div>
                            <div style={{ maxHeight: '360px', overflowY: 'auto' }}>
                                {/* Filtro Empresa */}
                                <FilterSection title="🏢 Empresa">
                                    {filterOptions.companies.map(compId => {
                                        const comp = companies.find(c => c.id === compId);
                                        return (
                                            <FilterCheckbox key={compId} label={comp?.razaoSocial || 'Desconhecida'}
                                                checked={filters.companies.includes(compId)}
                                                onChange={() => setFilters({ ...filters, companies: filters.companies.includes(compId) ? filters.companies.filter(x => x !== compId) : [...filters.companies, compId] })} />
                                        );
                                    })}
                                </FilterSection>
                                {/* Filtro Modalidade */}
                                <FilterSection title="📄 Modalidade">
                                    {filterOptions.modalities.map(m => (
                                        <FilterCheckbox key={m} label={m} checked={filters.modalities.includes(m)}
                                            onChange={() => setFilters({ ...filters, modalities: filters.modalities.includes(m) ? filters.modalities.filter(x => x !== m) : [...filters.modalities, m] })} />
                                    ))}
                                </FilterSection>
                                {/* Filtro Portal */}
                                <FilterSection title="🌐 Portal">
                                    {filterOptions.portals.map(p => (
                                        <FilterCheckbox key={p} label={p} checked={filters.portals.includes(p)}
                                            onChange={() => setFilters({ ...filters, portals: filters.portals.includes(p) ? filters.portals.filter(x => x !== p) : [...filters.portals, p] })} />
                                    ))}
                                </FilterSection>
                                {/* Filtro Fase */}
                                <FilterSection title="🔄 Fase / Status">
                                    {filterOptions.statuses.map(s => (
                                        <FilterCheckbox key={s} label={s} checked={filters.statuses.includes(s)}
                                            onChange={() => setFilters({ ...filters, statuses: filters.statuses.includes(s) ? filters.statuses.filter(x => x !== s) : [...filters.statuses, s] })} />
                                    ))}
                                </FilterSection>
                                {/* Filtro Risco */}
                                <FilterSection title="⚠️ Risco IA">
                                    {filterOptions.risks.map(r => (
                                        <FilterCheckbox key={r} label={r} checked={filters.risks.includes(r)}
                                            onChange={() => setFilters({ ...filters, risks: filters.risks.includes(r) ? filters.risks.filter(x => x !== r) : [...filters.risks, r] })} />
                                    ))}
                                </FilterSection>
                            </div>
                        </div>
                    )}
                </div>

                {/* Busca Textual */}
                <div style={{ position: 'relative', flex: '1', maxWidth: '340px' }}>
                    <Search size={14} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-tertiary)' }} />
                    <input
                        type="text"
                        value={filters.searchText}
                        onChange={e => setFilters({ ...filters, searchText: e.target.value })}
                        placeholder="Buscar por título, objeto, empresa..."
                        style={{
                            width: '100%', padding: '8px 32px 8px 34px', fontSize: '0.8125rem',
                            border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
                            background: 'var(--color-bg-surface)', color: 'var(--color-text-primary)',
                            outline: 'none'
                        }}
                    />
                    {filters.searchText && (
                        <button onClick={() => setFilters({ ...filters, searchText: '' })} style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-tertiary)', padding: '4px' }}>
                            <X size={14} />
                        </button>
                    )}
                </div>

                {/* Configuração de Campos */}
                <div style={{ position: 'relative', marginLeft: 'auto' }}>
                    <button
                        className={`btn ${showCardConfig ? 'btn-primary' : 'btn-outline'}`}
                        style={showCardConfig ? { backgroundColor: '#8b5cf6', borderColor: '#8b5cf6' } : {}}
                        onClick={() => { setShowCardConfig(!showCardConfig); setShowFilterPanel(false); }}
                    >
                        <SlidersHorizontal size={14} />
                        Campos
                    </button>

                    {showCardConfig && (
                        <div style={{
                            position: 'absolute', top: '44px', right: 0, width: '260px',
                            background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)',
                            borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-xl)', zIndex: 100,
                            overflow: 'hidden'
                        }}>
                            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-border)', background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.05), rgba(99, 102, 241, 0.05))' }}>
                                <div style={{ fontWeight: 700, fontSize: '0.875rem' }}>Campos Visíveis</div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>Escolha o que aparece nos cards</div>
                            </div>
                            <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                                {cardFields.map(field => (
                                    <label key={field.key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', cursor: 'pointer', borderBottom: '1px solid var(--color-border)' }}
                                        onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-bg-surface-hover)')}
                                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                                        onClick={e => { e.preventDefault(); setCardFields(cardFields.map(f => f.key === field.key ? { ...f, visible: !f.visible } : f)); }}
                                    >
                                        <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-primary)' }}>{field.label}</span>
                                        <div
                                            style={{
                                                width: '32px', height: '18px', borderRadius: '999px', position: 'relative', cursor: 'pointer', transition: 'background 0.2s',
                                                background: field.visible ? '#8b5cf6' : 'var(--color-border)',
                                            }}
                                        >
                                            <div style={{
                                                position: 'absolute', top: '2px', left: field.visible ? '16px' : '2px',
                                                width: '14px', height: '14px', borderRadius: '50%', background: 'white',
                                                boxShadow: '0 1px 3px rgba(0,0,0,0.2)', transition: 'left 0.2s',
                                            }} />
                                        </div>
                                    </label>
                                ))}
                            </div>
                            <div style={{ padding: '8px 16px', borderTop: '1px solid var(--color-border)', textAlign: 'center', fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
                                {cardFields.filter(f => f.visible).length} de {cardFields.length} visíveis
                            </div>
                        </div>
                    )}
                </div>

                {/* Contagem */}
                {hasActiveFilters && (
                    <span style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>{filteredItems.length} de {items.length}</span>
                )}
            </div>

            {/* Chips de Filtros Ativos */}
            {hasActiveFilters && (
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '12px', alignItems: 'center' }}>
                    {filters.searchText && <FilterChip label={`"${filters.searchText}"`} onRemove={() => setFilters({ ...filters, searchText: '' })} />}
                    {filters.companies.map(compId => { const name = companies.find(c => c.id === compId)?.razaoSocial || compId; return <FilterChip key={compId} label={`🏢 ${name}`} color="#3b82f6" onRemove={() => setFilters({ ...filters, companies: filters.companies.filter(x => x !== compId) })} />; })}
                    {filters.modalities.map(m => <FilterChip key={m} label={m} color="#8b5cf6" onRemove={() => setFilters({ ...filters, modalities: filters.modalities.filter(x => x !== m) })} />)}
                    {filters.portals.map(p => <FilterChip key={p} label={`🌐 ${p}`} color="#10b981" onRemove={() => setFilters({ ...filters, portals: filters.portals.filter(x => x !== p) })} />)}
                    {filters.statuses.map(s => <FilterChip key={s} label={s} color="#f59e0b" onRemove={() => setFilters({ ...filters, statuses: filters.statuses.filter(x => x !== s) })} />)}
                    {filters.risks.map(r => <FilterChip key={r} label={`⚠️ ${r}`} color="#ef4444" onRemove={() => setFilters({ ...filters, risks: filters.risks.filter(x => x !== r) })} />)}
                    <button onClick={() => setFilters(EMPTY_FILTERS)} style={{ fontSize: '0.75rem', color: 'var(--color-danger)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>Limpar tudo</button>
                </div>
            )}

            {viewMode === 'kanban' ? (
                <KanbanBoard
                    items={filteredItems}
                    setItems={setItems}
                    onEditProcess={handleEdit}
                    onDeleteProcess={handleDeleteProcess}
                    analyses={analyses}
                    companies={companies}
                    onViewAnalysis={(_analysis, process) => {
                        // Pass down the process so report has context
                        if (process) setViewingProcessForAnalysis(process);
                    }}
                    onStatusChange={handleStatusChange}
                    onToggleMonitor={handleToggleMonitor}
                    cardFields={cardFields}
                    visibleColumns={visibleColumns}
                    sortBy={sortBy}
                    compactMode={compactMode}
                    highlightExpiring={highlightExpiring}
                />
            ) : (
                <BiddingTable
                    items={filteredItems}
                    companies={companies}
                    onEditProcess={handleEdit}
                    analyses={analyses}
                    onViewAnalysis={(_analysis, process) => {
                        if (process) setViewingProcessForAnalysis(process);
                    }}
                    onToggleMonitor={handleToggleMonitor}
                />
            )}

            {isModalOpen && (
                <ProcessFormModal
                    initialData={editingProcess as BiddingProcess | null}
                    companies={companies}
                    onClose={() => {
                        setIsModalOpen(false);
                        setPendingAnalysis(null); // Clear pending analysis if user cancels creation
                    }}
                    onSave={handleSaveProcess}
                    onRequestAiAnalysis={analyses.some((a: AiAnalysis) => a.biddingProcessId === editingProcess?.id) ? () => {
                        setIsModalOpen(false);
                        setViewingProcessForAnalysis(editingProcess as BiddingProcess);
                    } : undefined}
                />
            )}

            {viewingProcessForAnalysis && (
                <AiReportModal
                    analysis={analyses.find((a: AiAnalysis) => a.biddingProcessId === viewingProcessForAnalysis.id)!}
                    process={viewingProcessForAnalysis}
                    onClose={() => setViewingProcessForAnalysis(null)}
                    onUpdate={refreshData}
                />
            )}
        </div>
    );
}

// ===== COMPONENTES AUXILIARES DE FILTRO =====
function FilterSection({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--color-border)' }}>
            <h4 style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>{title}</h4>
            {children}
        </div>
    );
}

function FilterCheckbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: () => void }) {
    return (
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 4px', cursor: 'pointer', borderRadius: '4px', fontSize: '0.8125rem', color: 'var(--color-text-primary)' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-bg-surface-hover)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
        >
            <input type="checkbox" checked={checked} onChange={onChange}
                style={{ width: '14px', height: '14px', accentColor: '#10b981', cursor: 'pointer' }} />
            <span>{label}</span>
        </label>
    );
}

function FilterChip({ label, color = '#64748b', onRemove }: { label: string; color?: string; onRemove: () => void }) {
    return (
        <span style={{
            display: 'inline-flex', alignItems: 'center', gap: '4px',
            padding: '3px 10px', borderRadius: '999px', fontSize: '0.75rem', fontWeight: 500,
            background: `${color}18`, color: color, border: `1px solid ${color}30`,
        }}>
            {label}
            <button onClick={onRemove} style={{ background: 'none', border: 'none', cursor: 'pointer', color: color, padding: '1px', display: 'flex', alignItems: 'center' }}>
                <X size={12} />
            </button>
        </span>
    );
}
