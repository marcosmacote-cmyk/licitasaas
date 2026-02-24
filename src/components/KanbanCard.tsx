import { useDraggable } from '@dnd-kit/core';
import { Calendar, DollarSign, Brain, Building2, Trash2, MessageSquare, Bell } from 'lucide-react';
import { format } from 'date-fns';
import type { BiddingProcess, CompanyProfile, ObservationLog } from '../types';

interface Props {
    item: BiddingProcess;
    isOverlay?: boolean;
    hasAnalysis?: boolean;
    companies?: CompanyProfile[];
    onViewAnalysis?: () => void;
    onDoubleClick?: () => void;
    onDelete?: (id: string) => void;
}

export function KanbanItem({ item, isOverlay, hasAnalysis, companies, onViewAnalysis, onDoubleClick, onDelete }: Props) {
    const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
        id: item.id,
        data: item,
    });

    let portalColor = 'badge-blue';
    if (item.portal === 'PNCP') portalColor = 'badge-green';
    if (item.portal === 'BLL') portalColor = 'badge-orange';

    const style = {
        opacity: isDragging ? 0.5 : 1,
        cursor: isDragging ? 'grabbing' : 'grab',
        boxShadow: isOverlay ? 'var(--shadow-lg)' : undefined,
        zIndex: isOverlay ? 999 : undefined,
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
                    <span className={`badge ${portalColor}`} title={item.portal} style={{ maxWidth: '100%' }}>{item.portal}</span>
                    <span className="badge badge-blue" title={item.modality} style={{ maxWidth: '100%' }}>{item.modality}</span>
                </div>
                <div className="flex-gap" style={{ flexShrink: 0, marginLeft: '8px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    {hasReminder && (
                        <div title="Lembrete Ativo">
                            <Bell size={14} color="var(--color-warning)" />
                        </div>
                    )}
                    {observations.length > 0 && (
                        <div className="flex-gap" style={{ color: 'var(--color-text-tertiary)', fontSize: '0.75rem' }}>
                            <MessageSquare size={14} />
                            <span>{observations.length}</span>
                        </div>
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

            <div className="kanban-card-title" title={item.title}>
                {item.title}
            </div>

            {item.companyProfileId && companies && (
                <div className="flex-gap kanban-card-company" style={{ fontSize: '0.75rem', color: 'var(--color-primary)', marginBottom: '8px', fontWeight: 500 }}>
                    <Building2 size={12} />
                    <span className="kanban-card-company">
                        {companies.find(c => c.id === item.companyProfileId)?.razaoSocial || 'Empresa Desconhecida'}
                    </span>
                </div>
            )}

            <div className="flex-gap" style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', flexDirection: 'column', alignItems: 'flex-start' }}>
                <div className="flex-gap">
                    <DollarSign size={14} />
                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.estimatedValue)}
                </div>
                <div className="flex-gap">
                    <Calendar size={14} />
                    Sessão: {format(new Date(item.sessionDate), 'dd/MM/yyyy HH:mm')}
                </div>
            </div>
        </div>
    );
}
