/**
 * NotificationCenter — Real-time notification bell component.
 * 
 * Shows a bell icon with badge count for pending/completed AI operations.
 * Dropdown lists recent notifications with clickable links.
 * Receives events from SSE via useSSE hook.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { Bell, CheckCircle, AlertCircle, Loader2, Brain, FileText, Gavel, ScanSearch } from 'lucide-react';
import { useSSE, fetchJobList, type JobEvent } from './hooks/useSSE';
import { useToast } from './ui';

interface NotificationItem {
    id: string;
    jobId: string;
    type: string;
    status: 'queued' | 'processing' | 'completed' | 'failed';
    title: string;
    message: string;
    targetId?: string;
    progress?: number;
    timestamp: string;
    read: boolean;
}

interface NotificationCenterProps {
    onNavigateToProcess?: (processId: string, type: string, jobId: string) => void;
}

const JOB_TYPE_CONFIG: Record<string, { label: string; icon: any; color: string }> = {
    edital_analysis: { label: 'Análise de Edital', icon: ScanSearch, color: 'var(--color-ai)' },
    oracle: { label: 'Oráculo Técnico', icon: Brain, color: 'var(--color-primary)' },
    proposal_populate: { label: 'Proposta IA', icon: FileText, color: 'var(--color-success)' },
    petition: { label: 'Petição IA', icon: Gavel, color: 'var(--color-warning)' },
};

export default function NotificationCenter({ onNavigateToProcess }: NotificationCenterProps) {
    const toast = useToast();
    const [notifications, setNotifications] = useState<NotificationItem[]>([]);
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);


    const unreadCount = notifications.filter(n => !n.read && (n.status === 'completed' || n.status === 'failed')).length;

    // Handle SSE events
    const handleSSEEvent = useCallback((event: JobEvent) => {
        const config = JOB_TYPE_CONFIG[event.jobType] || JOB_TYPE_CONFIG.edital_analysis;
        const title = event.targetTitle || config.label;

        setNotifications(prev => {
            const existing = prev.findIndex(n => n.jobId === event.jobId);

            if (event.type === 'job_completed') {
                // Show toast notification
                toast.success(`${config.label} concluída: ${title}`);

                // Request browser notification permission
                if ('Notification' in window && Notification.permission === 'granted') {
                    new Notification(`${config.label} concluída`, {
                        body: title,
                        icon: '/favicon.ico',
                    });
                }

                if (existing >= 0) {
                    const updated = [...prev];
                    updated[existing] = {
                        ...updated[existing],
                        status: 'completed',
                        message: 'Concluído',
                        progress: 100,
                        read: false,
                    };
                    return updated;
                }

                return [{
                    id: `notif_${Date.now()}`,
                    jobId: event.jobId,
                    type: event.jobType,
                    status: 'completed' as const,
                    title,
                    message: 'Concluído',
                    targetId: event.targetId,
                    progress: 100,
                    timestamp: event.timestamp,
                    read: false,
                }, ...prev].slice(0, 50);
            }

            if (event.type === 'job_failed') {
                toast.error(`${config.label} falhou: ${event.error || 'Erro desconhecido'}`);

                if (existing >= 0) {
                    const updated = [...prev];
                    updated[existing] = {
                        ...updated[existing],
                        status: 'failed',
                        message: event.error || 'Erro',
                        read: false,
                    };
                    return updated;
                }

                return [{
                    id: `notif_${Date.now()}`,
                    jobId: event.jobId,
                    type: event.jobType,
                    status: 'failed' as const,
                    title,
                    message: event.error || 'Erro',
                    targetId: event.targetId,
                    timestamp: event.timestamp,
                    read: false,
                }, ...prev].slice(0, 50);
            }

            if (event.type === 'job_progress') {
                if (existing >= 0) {
                    const updated = [...prev];
                    updated[existing] = {
                        ...updated[existing],
                        status: 'processing',
                        message: event.progressMsg || 'Processando...',
                        progress: event.progress,
                    };
                    return updated;
                }

                return [{
                    id: `notif_${Date.now()}`,
                    jobId: event.jobId,
                    type: event.jobType,
                    status: 'processing' as const,
                    title,
                    message: event.progressMsg || 'Processando...',
                    targetId: event.targetId,
                    progress: event.progress,
                    timestamp: event.timestamp,
                    read: true,
                }, ...prev].slice(0, 50);
            }

            if (event.type === 'job_queued') {
                toast.info(`${config.label} iniciada: ${title}`);

                return [{
                    id: `notif_${Date.now()}`,
                    jobId: event.jobId,
                    type: event.jobType,
                    status: 'queued' as const,
                    title,
                    message: 'Na fila...',
                    targetId: event.targetId,
                    timestamp: event.timestamp,
                    read: true,
                }, ...prev].slice(0, 50);
            }

            return prev;
        });
    }, [toast]);

    useSSE(handleSSEEvent);

    // Request notification permission on mount
    useEffect(() => {
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }
    }, []);

    // Load existing jobs on mount
    useEffect(() => {
        fetchJobList().then(jobs => {
            const items: NotificationItem[] = jobs.map(j => ({
                id: `notif_${j.id}`,
                jobId: j.id,
                type: j.type,
                status: j.status.toLowerCase() as NotificationItem['status'],
                title: j.targetTitle || JOB_TYPE_CONFIG[j.type]?.label || j.type,
                message: j.error || j.progressMsg || j.status,
                targetId: j.targetId,
                progress: j.progress,
                timestamp: j.createdAt,
                read: j.status === 'COMPLETED' || j.status === 'FAILED',
            }));
            setNotifications(items);
        }).catch(() => {});
    }, []);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const markAllRead = () => {
        setNotifications(prev => prev.map(n => ({ ...n, read: true })));
    };

    const handleNotificationClick = async (notif: NotificationItem) => {
        // Mark as read
        setNotifications(prev =>
            prev.map(n => n.id === notif.id ? { ...n, read: true } : n)
        );

        if (notif.status === 'completed' && notif.targetId && onNavigateToProcess) {
            onNavigateToProcess(notif.targetId, notif.type, notif.jobId);
            setIsOpen(false);
        }
    };

    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'completed': return <CheckCircle size={14} style={{ color: 'var(--color-success)' }} />;
            case 'failed': return <AlertCircle size={14} style={{ color: 'var(--color-danger)' }} />;
            case 'processing': return <Loader2 size={14} className="spin" style={{ color: 'var(--color-ai)' }} />;
            default: return <Loader2 size={14} style={{ color: 'var(--color-muted)' }} />;
        }
    };

    const formatTime = (ts: string) => {
        const d = new Date(ts);
        const now = new Date();
        const diffMs = now.getTime() - d.getTime();
        const diffMin = Math.floor(diffMs / 60000);
        if (diffMin < 1) return 'agora';
        if (diffMin < 60) return `${diffMin}min`;
        if (diffMin < 1440) return `${Math.floor(diffMin / 60)}h`;
        return `${Math.floor(diffMin / 1440)}d`;
    };

    const activeJobs = notifications.filter(n => n.status === 'processing' || n.status === 'queued');

    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {activeJobs.length > 0 && (
                <button
                    onClick={() => setIsOpen(true)}
                    style={{
                        background: 'rgba(99,102,241,0.1)',
                        border: '1px solid rgba(99,102,241,0.2)',
                        padding: '6px 12px',
                        borderRadius: '20px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        color: 'var(--color-primary)',
                        fontSize: '13px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        transition: 'all 0.2s',
                        boxShadow: '0 0 10px rgba(99,102,241,0.15)'
                    }}
                    onMouseOver={e => (e.currentTarget.style.background = 'rgba(99,102,241,0.15)')}
                    onMouseOut={e => (e.currentTarget.style.background = 'rgba(99,102,241,0.1)')}
                    title="Ver processos em andamento"
                >
                    <Loader2 size={14} className="spin" />
                    <span>Processando ({activeJobs.length})</span>
                </button>
            )}

            <div ref={dropdownRef} style={{ position: 'relative' }}>
                {/* Bell Button */}
                <button
                onClick={() => { setIsOpen(!isOpen); if (!isOpen) markAllRead(); }}
                style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    position: 'relative',
                    padding: '8px',
                    borderRadius: '8px',
                    color: 'var(--color-text-secondary)',
                    transition: 'all 0.2s ease',
                }}
                onMouseOver={e => (e.currentTarget.style.background = 'var(--color-bg-hover)')}
                onMouseOut={e => (e.currentTarget.style.background = 'none')}
                title="Notificações"
            >
                <Bell size={20} />
                {unreadCount > 0 && (
                    <span style={{
                        position: 'absolute',
                        top: '4px',
                        right: '4px',
                        background: 'var(--color-danger)',
                        color: '#fff',
                        borderRadius: '50%',
                        width: '16px',
                        height: '16px',
                        fontSize: '10px',
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        animation: 'pulse 2s infinite',
                    }}>
                        {unreadCount}
                    </span>
                )}
            </button>

            {/* Dropdown */}
            {isOpen && (
                <div style={{
                    position: 'absolute',
                    top: '100%',
                    right: 0,
                    width: '360px',
                    maxHeight: '420px',
                    overflowY: 'auto',
                    background: 'var(--color-bg-card)',
                    border: '1px solid var(--color-border)',
                    borderRadius: '12px',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
                    zIndex: 9999,
                    marginTop: '4px',
                }}>
                    <div style={{
                        padding: '12px 16px',
                        borderBottom: '1px solid var(--color-border)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                    }}>
                        <span style={{ fontWeight: 600, fontSize: '14px' }}>Tarefas em Processamento</span>
                        {notifications.some(n => n.status === 'processing') && (
                            <Loader2 size={14} className="spin" style={{ color: 'var(--color-ai)' }} />
                        )}
                    </div>

                    {notifications.length === 0 ? (
                        <div style={{
                            padding: '32px 16px',
                            textAlign: 'center',
                            color: 'var(--color-text-muted)',
                            fontSize: '13px',
                        }}>
                            Nenhuma tarefa recente
                        </div>
                    ) : (
                        notifications.slice(0, 15).map(notif => {
                            const config = JOB_TYPE_CONFIG[notif.type] || JOB_TYPE_CONFIG.edital_analysis;
                            const Icon = config.icon;

                            return (
                                <div
                                    key={notif.id}
                                    onClick={() => handleNotificationClick(notif)}
                                    style={{
                                        padding: '10px 16px',
                                        borderBottom: '1px solid var(--color-border)',
                                        cursor: notif.status === 'completed' ? 'pointer' : 'default',
                                        background: !notif.read ? 'rgba(99, 102, 241, 0.05)' : 'transparent',
                                        transition: 'background 0.2s',
                                        display: 'flex',
                                        gap: '10px',
                                        alignItems: 'flex-start',
                                    }}
                                    onMouseOver={e => {
                                        if (notif.status === 'completed') (e.currentTarget.style.background = 'var(--color-bg-hover)');
                                    }}
                                    onMouseOut={e => {
                                        e.currentTarget.style.background = !notif.read ? 'rgba(99, 102, 241, 0.05)' : 'transparent';
                                    }}
                                >
                                    <div style={{ paddingTop: '2px' }}>
                                        <Icon size={16} style={{ color: config.color }} />
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center',
                                            gap: '8px',
                                        }}>
                                            <span style={{
                                                fontSize: '13px',
                                                fontWeight: !notif.read ? 600 : 400,
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                whiteSpace: 'nowrap',
                                            }}>
                                                {notif.title}
                                            </span>
                                            <span style={{ fontSize: '11px', color: 'var(--color-text-muted)', flexShrink: 0 }}>
                                                {formatTime(notif.timestamp)}
                                            </span>
                                        </div>
                                        <div style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: '6px',
                                            marginTop: '2px',
                                        }}>
                                            {getStatusIcon(notif.status)}
                                            <span style={{
                                                fontSize: '12px',
                                                color: 'var(--color-text-muted)',
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                whiteSpace: 'nowrap',
                                            }}>
                                                {notif.message}
                                            </span>
                                        </div>
                                        {notif.status === 'processing' && notif.progress !== undefined && (
                                            <div style={{
                                                marginTop: '6px',
                                                height: '3px',
                                                background: 'var(--color-bg-hover)',
                                                borderRadius: '2px',
                                                overflow: 'hidden',
                                            }}>
                                                <div style={{
                                                    height: '100%',
                                                    width: `${notif.progress}%`,
                                                    background: 'var(--color-ai)',
                                                    borderRadius: '2px',
                                                    transition: 'width 0.5s ease',
                                                }} />
                                            </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>
            )}
            </div>

            <style>{`
                @keyframes pulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.5; }
                }
                .spin {
                    animation: spin 1.5s linear infinite;
                }
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    );
}
