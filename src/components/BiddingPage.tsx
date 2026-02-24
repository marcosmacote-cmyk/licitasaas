import { useState, useRef, useMemo, useEffect } from 'react';
import { Settings, Plus, LayoutGrid, List, Bot, Loader2, Bell } from 'lucide-react';
import { KanbanBoard } from './KanbanBoard';
import { BiddingTable } from './BiddingTable';
import { ProcessFormModal } from './ProcessFormModal';
import { AiReportModal } from './AiReportModal';
import { aiService } from '../services/ai';
import { API_BASE_URL } from '../config';
import type { BiddingProcess, BiddingStatus, AiAnalysis, CompanyProfile } from '../types';

// export const INITIAL_DATA: BiddingProcess[] = [ ... ] (Removed for brevity, now fetched from API)

interface Props {
    items: BiddingProcess[];
    setItems: React.Dispatch<React.SetStateAction<BiddingProcess[]>>;
    companies: CompanyProfile[];
}

export function BiddingPage({ items, setItems, companies }: Props) {
    const [viewMode, setViewMode] = useState<'kanban' | 'table'>('kanban');

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
                        // Trigger notification
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

    const handleSaveProcess = (process: Partial<BiddingProcess>) => {
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

                // If we have a pending AI analysis for this new process, save it
                if (pendingAnalysis) {
                    const finalAnalysis = { ...pendingAnalysis, biddingProcessId: newProcess.id };

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
                    zIndex: 9999,
                    padding: '0 20px',
                    animation: 'slideDown 0.4s ease-out'
                }}>
                    <div style={{
                        maxWidth: '720px',
                        margin: '16px auto',
                        padding: '20px 24px',
                        background: 'linear-gradient(135deg, rgba(15, 23, 42, 0.95), rgba(30, 41, 59, 0.95))',
                        backdropFilter: 'blur(20px)',
                        borderRadius: '1rem',
                        boxShadow: '0 20px 60px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.1)',
                        color: 'white',
                        border: '1px solid rgba(245, 158, 11, 0.3)'
                    }}>
                        {/* Header */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '14px' }}>
                            <div style={{
                                background: 'linear-gradient(135deg, #f59e0b, #ef4444)',
                                borderRadius: '12px',
                                padding: '10px',
                                animation: 'pulse 1s infinite',
                                boxShadow: '0 0 20px rgba(245, 158, 11, 0.4)'
                            }}>
                                <Bell size={22} color="white" />
                            </div>
                            <div style={{ flex: 1 }}>
                                <div style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '2px' }}>
                                    🔔 LEMBRETE {activeNotification.item.reminderType === 'weekdays' ? 'RECORRENTE' : ''}
                                </div>
                                <div style={{ fontSize: '0.9375rem', fontWeight: 500, color: '#fbbf24', lineHeight: 1.4 }}>
                                    {activeNotification.item.title}
                                </div>
                            </div>
                            <div style={{ textAlign: 'right', fontSize: '0.8125rem', color: '#94a3b8' }}>
                                <div>{new Date(activeNotification.item.reminderDate!).toLocaleString('pt-BR')}</div>
                                {activeNotification.item.reminderType === 'weekdays' && (() => {
                                    try {
                                        const days: number[] = JSON.parse(activeNotification.item.reminderDays || '[]');
                                        const labels = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
                                        return <div style={{ marginTop: '2px', color: '#f59e0b', fontSize: '0.75rem' }}>
                                            {days.map(d => labels[d]).join(', ')}
                                        </div>;
                                    } catch { return null; }
                                })()}
                            </div>
                        </div>

                        {/* Action Buttons */}
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <button
                                onClick={() => handleReminderAction('ok')}
                                style={{
                                    flex: 1,
                                    padding: '10px 0',
                                    borderRadius: '10px',
                                    border: 'none',
                                    background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                                    color: 'white',
                                    fontWeight: 700,
                                    fontSize: '0.8125rem',
                                    cursor: 'pointer',
                                    boxShadow: '0 4px 12px rgba(37, 99, 235, 0.3)',
                                    transition: 'transform 0.1s',
                                }}
                                onMouseDown={(e) => (e.currentTarget.style.transform = 'scale(0.97)')}
                                onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
                            >
                                ✅ {activeNotification.item.reminderType === 'weekdays' ? 'OK (agenda próximo dia)' : 'OK'}
                            </button>
                            <button
                                onClick={() => handleReminderAction('tomorrow')}
                                style={{
                                    flex: 1,
                                    padding: '10px 0',
                                    borderRadius: '10px',
                                    border: 'none',
                                    background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                                    color: 'white',
                                    fontWeight: 700,
                                    fontSize: '0.8125rem',
                                    cursor: 'pointer',
                                    boxShadow: '0 4px 12px rgba(245, 158, 11, 0.3)',
                                    transition: 'transform 0.1s',
                                }}
                                onMouseDown={(e) => (e.currentTarget.style.transform = 'scale(0.97)')}
                                onMouseUp={(e) => (e.currentTarget.style.transform = 'scale(1)')}
                            >
                                📅 Repetir Amanhã
                            </button>
                            <button
                                onClick={() => handleReminderAction('dismiss')}
                                style={{
                                    flex: 'none',
                                    padding: '10px 20px',
                                    borderRadius: '10px',
                                    border: '1px solid rgba(239, 68, 68, 0.3)',
                                    background: 'rgba(239, 68, 68, 0.15)',
                                    color: '#fca5a5',
                                    fontWeight: 600,
                                    fontSize: '0.8125rem',
                                    cursor: 'pointer',
                                    transition: 'all 0.15s',
                                }}
                            >
                                🔕 Desativar
                            </button>
                        </div>
                    </div>
                    <style>{`
                        @keyframes slideDown { from { transform: translateY(-100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
                        @keyframes pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.1); } }
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

                    <button className="btn btn-outline">
                        <Settings size={16} />
                        Configurar
                    </button>

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

            {viewMode === 'kanban' ? (
                <KanbanBoard
                    items={items}
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
                />
            ) : (
                <BiddingTable
                    items={items}
                    companies={companies}
                    onEditProcess={handleEdit}
                    analyses={analyses}
                    onViewAnalysis={(_analysis, process) => {
                        if (process) setViewingProcessForAnalysis(process);
                    }}
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
