import { useDraggable } from '@dnd-kit/core';
import { Calendar, DollarSign, Brain, Building2, Trash2, MessageSquare, Bell, Radio } from 'lucide-react';
import { format } from 'date-fns';
import type { BiddingProcess, CompanyProfile, ObservationLog } from '../types';

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
    onDoubleClick?: () => void;
    onDelete?: (id: string) => void;
    onToggleMonitor?: (id: string) => void;
    cardFields?: CardFieldConfig[];
    compactMode?: boolean;
    highlightExpiring?: boolean;
}

export function KanbanItem({ item, isOverlay, hasAnalysis, companies, onViewAnalysis, onDoubleClick, onDelete, onToggleMonitor, cardFields, compactMode, highlightExpiring }: Props) {
    const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
        id: item.id,
        data: item,
    });

    // Helper: check if a field should be visible
    const isVisible = (key: string) => {
        if (!cardFields) return true; // Default: show everything if no config
        return cardFields.find(f => f.key === key)?.visible ?? true;
    };

    const portalLower = (item.portal || '').toLowerCase();
    let portalColor = 'badge-blue';
    if (portalLower.includes('pncp')) portalColor = 'badge-green';
    if (portalLower.includes('bll')) portalColor = 'badge-orange';

    const now = new Date();
    const sessionDate = new Date(item.sessionDate);
    const hoursToSession = (sessionDate.getTime() - now.getTime()) / (1000 * 60 * 60);

    let expiringStyle = {};
    if (highlightExpiring && hoursToSession > 0) {
        if (hoursToSession <= 24) {
            expiringStyle = { border: '2px solid var(--color-danger)', boxShadow: '0 0 8px rgba(239, 68, 68, 0.3)' };
        } else if (hoursToSession <= 48) {
            expiringStyle = { border: '2px solid var(--color-warning)', boxShadow: '0 0 8px rgba(245, 158, 11, 0.3)' };
        }
    }

    const style = {
        opacity: isDragging ? 0.5 : 1,
        cursor: isDragging ? 'grabbing' : 'grab',
        boxShadow: isOverlay ? 'var(--shadow-lg)' : undefined,
        zIndex: isOverlay ? 999 : undefined,
        padding: compactMode ? '10px' : undefined,
        gap: compactMode ? '8px' : undefined,
        ...expiringStyle,
    };

    const observations: ObservationLog[] = JSON.parse(item.observations || '[]');
    const hasReminder = !!item.reminderDate && item.reminderStatus === 'pending';

    return (
        <div
            ref={setNodeRef}
            {...attributes}
            {...listeners}
            className="kanban-card"
            style={style}
            onDoubleClick={onDoubleClick}
        >
            <div className="flex-between" style={{ alignItems: 'flex-start', marginBottom: '8px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0, flex: 1 }}>
                    {isVisible('portal') && (
                        <span className={`badge ${portalColor}`} title={item.portal} style={{ maxWidth: '100%' }}>{item.portal}</span>
                    )}
                    {isVisible('modality') && (
                        <span className="badge badge-blue" title={item.modality} style={{ maxWidth: '100%' }}>{item.modality}</span>
                    )}
                </div>
                <div className="flex-gap" style={{ flexShrink: 0, marginLeft: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {isVisible('reminder') && hasReminder && (
                        <div title="Lembrete Ativo">
                            <Bell size={14} color="var(--color-warning)" />
                        </div>
                    )}
                    {isVisible('observations') && observations.length > 0 && (
                        <div className="flex-gap" style={{ color: 'var(--color-text-tertiary)', fontSize: '0.75rem' }}>
                            <MessageSquare size={14} />
                            <span>{observations.length}</span>
                        </div>
                    )}
                    {(item.portal?.toLowerCase().includes('pncp') || item.link?.toLowerCase().includes('pncp.gov.br')) && (
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
                            title={item.isMonitored ? "Monitoramento Ativo (Radar)" : "Ativar Monitor de Chat (Radar)"}
                        >
                            <Radio size={14} className={item.isMonitored ? "pulse-animation" : ""} />
                        </button>
                    )}
                    {hasAnalysis && (
                        <button
                            className="icon-btn"
                            style={{ padding: '4px', cursor: 'pointer', color: '#8b5cf6', background: 'rgba(139, 92, 246, 0.1)' }}
                            onClick={(e) => { e.stopPropagation(); onViewAnalysis?.(); }}
                            title="Ver Relatório da IA"
                        >
                            <Brain size={14} />
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

            {isVisible('title') && (
                <div className="kanban-card-title" title={item.title} style={{ fontSize: compactMode ? '0.8125rem' : undefined, marginBottom: compactMode ? '4px' : undefined }}>
                    {item.title}
                </div>
            )}

            {isVisible('summary') && item.summary && (
                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', marginBottom: '8px', lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden', whiteSpace: 'pre-wrap' }}>
                    {item.summary}
                </div>
            )}

            {isVisible('company') && item.companyProfileId && companies && (
                <div className="flex-gap kanban-card-company" style={{ fontSize: '0.75rem', color: 'var(--color-primary)', marginBottom: '8px', fontWeight: 500 }}>
                    <Building2 size={12} />
                    <span className="kanban-card-company">
                        {companies.find(c => c.id === item.companyProfileId)?.razaoSocial || 'Empresa Desconhecida'}
                    </span>
                </div>
            )}

            {isVisible('risk') && item.risk && (
                <div style={{ marginBottom: '8px' }}>
                    <span className={`badge ${item.risk === 'Alto' || item.risk === 'Crítico' ? 'badge-red' : item.risk === 'Médio' ? 'badge-orange' : 'badge-green'}`} style={{ fontSize: '0.65rem' }}>
                        ⚠️ {item.risk}
                    </span>
                </div>
            )}

            <div className="flex-gap" style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', flexDirection: 'column', alignItems: 'flex-start' }}>
                {isVisible('value') && (
                    <div className="flex-gap">
                        <DollarSign size={14} />
                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.estimatedValue)}
                    </div>
                )}
                {isVisible('date') && (
                    <div className="flex-gap">
                        <Calendar size={14} />
                        Sessão: {format(new Date(item.sessionDate), 'dd/MM/yyyy HH:mm')}
                    </div>
                )}
            </div>
        </div>
    );
}
