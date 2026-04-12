import { useRef, useState, useEffect } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { Calendar, DollarSign, ScanSearch, Building2, Trash2, MessageSquare, Bell, SignalHigh } from 'lucide-react';
import { format } from 'date-fns';
import type { BiddingProcess, CompanyProfile, ObservationLog } from '../types';
import { RiskIndicator } from './ui';
import { normalizeModality, normalizeTitle } from '../utils/normalizeModality';
import { Skeleton } from './ui/Skeleton';

interface CardFieldConfig {
    key: string;
    label: string;
    visible: boolean;
}

interface Props {
    item: BiddingProcess;
    isOverlay?: boolean;
    hasAnalysis?: boolean;
    companies?: CompanyProfile[];
    onViewAnalysis?: () => void;
    onClick?: () => void;
    onDoubleClick?: () => void;
    onDelete?: (id: string) => void;
    onToggleMonitor?: (id: string) => void;

    cardFields?: CardFieldConfig[];
    compactMode?: boolean;
    highlightExpiring?: boolean;
}

export function KanbanItem({ item, isOverlay, hasAnalysis, companies, onViewAnalysis, onClick, onDoubleClick, onDelete, onToggleMonitor, cardFields, compactMode, highlightExpiring }: Props) {
    const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
        id: item.id,
        data: item,
    });

    // Single-click → Hub, distinguishing from double-click and drag
    const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const handleClick = (e: React.MouseEvent) => {
        if (isDragging) return;
        if ((e.target as HTMLElement).closest('button')) return;
        if (clickTimer.current) {
            clearTimeout(clickTimer.current);
            clickTimer.current = null;
            return;
        }
        clickTimer.current = setTimeout(() => {
            clickTimer.current = null;
            onClick?.();
        }, 220);
    };

    const isVisibleCheck = (key: string) => {
        if (!cardFields) return true;
        return cardFields.find(f => f.key === key)?.visible ?? true;
    };

    const [isRendered, setIsRendered] = useState(false);
    const cardElRef = useRef<HTMLDivElement | null>(null);
    const [cardHeight, setCardHeight] = useState<number>(compactMode ? 90 : 150);

    // RAM Optimization: IntersectionObserver to unmount heavy card content when offscreen
    useEffect(() => {
        // If overlay or dragging, always render fully
        if (isOverlay || isDragging) {
            setIsRendered(true);
            return;
        }

        const observer = new IntersectionObserver((entries) => {
            if (entries[0].isIntersecting) {
                setIsRendered(true);
            } else {
                setIsRendered(false);
                // Save height before unmounting so scroll doesn't jump
                if (cardElRef.current) {
                    setCardHeight(cardElRef.current.offsetHeight);
                }
            }
        }, { rootMargin: '400px' }); // Render cards 1-2 viewport heights away to be safe

        if (cardElRef.current) observer.observe(cardElRef.current);
        return () => observer.disconnect();
    }, [isOverlay, isDragging]);

    const portalLower = (item.portal || '').toLowerCase();
    let portalColor = 'badge-blue';
    if (portalLower.includes('pncp')) portalColor = 'badge-green';
    if (portalLower.includes('compras') || portalLower.includes('cnet')) portalColor = 'badge-teal';
    if (portalLower.includes('bll')) portalColor = 'badge-orange';

    const now = new Date();
    const sessionDate = new Date(item.sessionDate);
    const hoursToSession = (sessionDate.getTime() - now.getTime()) / (1000 * 60 * 60);

    let expiringStyle = {};
    if (highlightExpiring && hoursToSession > 0) {
        if (hoursToSession <= 24) {
            expiringStyle = { boxShadow: '0 0 0 2px var(--color-danger), 0 4px 12px rgba(239, 68, 68, 0.2)' };
        } else if (hoursToSession <= 48) {
            expiringStyle = { boxShadow: '0 0 0 2px var(--color-warning), 0 4px 12px rgba(245, 158, 11, 0.2)' };
        }
    }

    const style = {
        opacity: isDragging ? 0.5 : 1,
        cursor: isDragging ? 'grabbing' : 'pointer',
        boxShadow: isOverlay ? 'var(--shadow-lg)' : undefined,
        zIndex: isOverlay ? 999 : undefined,
        padding: compactMode ? '10px' : undefined,
        gap: compactMode ? '8px' : undefined,
        minHeight: !isRendered ? `${cardHeight}px` : undefined, // Keep spacer size when virtualized
        ...expiringStyle,
    };

    const observations: ObservationLog[] = JSON.parse(item.observations || '[]');
    const hasReminder = !!item.reminderDate && item.reminderStatus === 'pending';

    return (
        <div
            ref={(node) => {
                setNodeRef(node);
                cardElRef.current = node;
            }}
            {...attributes}
            {...listeners}
            className="kanban-card"
            style={style}
            onClick={handleClick}
            onDoubleClick={onDoubleClick}
        >
            {/* RAM VIRTUALIZATION: If not rendered, return lightweight skeleton inside the container */}
            {!isRendered ? (
                <div style={{ padding: '8px', opacity: 0.5 }}>
                    <Skeleton className="mb-2" width="40%" height="20px" borderRadius="10px" />
                    <Skeleton className="mb-3" width="90%" height="14px" />
                    <Skeleton className="mb-1" width="100%" height="10px" />
                    <Skeleton width="60%" height="10px" />
                </div>
            ) : (
                <>
                    <div className="flex-between" style={{ alignItems: 'flex-start', marginBottom: '8px' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0, flex: 1 }}>
                            {isVisibleCheck('portal') && (
                                <span className={`badge ${portalColor}`} title={item.portal} style={{ maxWidth: '100%' }}>{item.portal}</span>
                            )}
                            {isVisibleCheck('modality') && (
                                <span className="badge badge-blue" title={item.modality} style={{ maxWidth: '100%' }}>{normalizeModality(item.modality)}</span>
                            )}
                        </div>
                        <div className="flex-gap" style={{ flexShrink: 0, marginLeft: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                            {isVisibleCheck('reminder') && hasReminder && (
                                <div title="Lembrete Ativo">
                                    <Bell size={14} color="var(--color-warning)" />
                                </div>
                            )}
                            {isVisibleCheck('observations') && observations.length > 0 && (
                                <div className="flex-gap" style={{ color: 'var(--color-text-tertiary)', fontSize: '0.75rem' }}>
                                    <MessageSquare size={14} />
                                    <span>{observations.length}</span>
                                </div>
                            )}
                            {(() => {
                                const p = (item.portal || '').toLowerCase();
                                const l = (item.link || '').toLowerCase();
                                const isMonitorable = p.includes('pncp') || l.includes('pncp.gov.br')
                                    || l.includes('cnetmobile') || l.includes('comprasnet') || p.includes('compras') || p.includes('cnet')
                                    || l.includes('bbmnet') || p.includes('bbmnet')
                                    || l.includes('bllcompras') || l.includes('bll.org') || p.includes('bll')
                                    || l.includes('bnccompras') || p.includes('bnc')
                                    || l.includes('m2atecnologia') || p.includes('m2a');
                                if (!isMonitorable) return null;
                                const platformName = l.includes('m2atecnologia') || p.includes('m2a') ? 'M2A'
                                    : l.includes('bbmnet') || p.includes('bbmnet') ? 'BBMNET'
                                    : l.includes('bllcompras') || p.includes('bll') ? 'BLL'
                                    : l.includes('bnccompras') || p.includes('bnc') ? 'BNC'
                                    : p.includes('pncp') || l.includes('pncp') ? 'PNCP'
                                    : 'ComprasNet';
                                return (
                                    <button
                                        className="icon-btn"
                                        style={{ 
                                            padding: '4px', 
                                            cursor: 'pointer', 
                                            color: item.isMonitored ? 'var(--color-primary)' : 'var(--color-text-tertiary)', 
                                            background: item.isMonitored ? 'rgba(37, 99, 235, 0.1)' : 'transparent',
                                            borderRadius: '50%'
                                        }}
                                        onClick={(e) => { e.stopPropagation(); onToggleMonitor?.(item.id); }}
                                        title={item.isMonitored ? `Monitoramento Ativo (${platformName})` : `Ativar Monitor de Chat (${platformName})`}
                                    >
                                        <SignalHigh size={14} className={item.isMonitored ? "pulse-animation" : ""} />
                                    </button>
                                );
                            })()}
                            {hasAnalysis && (
                                <button
                                    className="icon-btn"
                                    style={{ padding: '4px', cursor: 'pointer', color: 'var(--color-ai)', background: 'var(--color-ai-bg)' }}
                                    onClick={(e) => { e.stopPropagation(); onViewAnalysis?.(); }}
                                    title="Ver Relatório da IA"
                                >
                                    <ScanSearch size={14} />
                                </button>
                            )}
                            {onDelete && (
                                <button
                                    className="icon-btn"
                                    style={{ padding: '4px', cursor: 'pointer', color: 'var(--color-danger)', background: 'rgba(239, 68, 68, 0.1)' }}
                                    onClick={(e) => { e.stopPropagation(); onDelete(item.id); }}
                                    title="Excluir Licitação"
                                >
                                    <Trash2 size={14} />
                                </button>
                            )}
                        </div>
                    </div>

                    {isVisibleCheck('title') && (
                        <div className="kanban-card-title" title={item.title} style={{ fontSize: compactMode ? '0.8125rem' : undefined, marginBottom: compactMode ? '4px' : undefined }}>
                            {normalizeTitle(item.title)}
                        </div>
                    )}

                    {isVisibleCheck('summary') && item.summary && (
                        <div className="kanban-card-summary">
                            {item.summary}
                        </div>
                    )}

                    {isVisibleCheck('company') && item.companyProfileId && companies && (
                        <div className="kanban-card-company">
                            <Building2 size={12} />
                            <span>
                                {companies.find(c => c.id === item.companyProfileId)?.razaoSocial || 'Empresa Desconhecida'}
                            </span>
                        </div>
                    )}

                    {isVisibleCheck('risk') && item.risk && (
                        <div style={{ marginBottom: '8px' }}>
                            <RiskIndicator risk={item.risk} compact />
                        </div>
                    )}

                    <div className="kanban-card-meta">
                        {isVisibleCheck('value') && (
                            <div className="flex-gap">
                                <DollarSign size={14} />
                                {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.estimatedValue)}
                            </div>
                        )}
                        {isVisibleCheck('date') && (
                            <div className="flex-gap">
                                <Calendar size={14} />
                                Sessão: {format(new Date(item.sessionDate), 'dd/MM/yyyy HH:mm')}
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
