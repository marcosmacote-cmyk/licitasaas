import { useDroppable } from '@dnd-kit/core';
import { KanbanItem } from './KanbanCard';
import type { BiddingProcess, AiAnalysis, CompanyProfile } from '../types';

interface Props {
    title: string;
    items: BiddingProcess[];
    companies: CompanyProfile[];
    onEditProcess: (process: BiddingProcess) => void;
    onDeleteProcess: (id: string) => void;
    analyses: AiAnalysis[];
    onViewAnalysis: (analysis: AiAnalysis, process: BiddingProcess) => void;
}

export function KanbanColumn({ title, items, companies, onEditProcess, onDeleteProcess, analyses, onViewAnalysis }: Props) {
    const { isOver, setNodeRef } = useDroppable({
        id: title, // title acts as ID
    });

    return (
        <div
            className="kanban-column"
            ref={setNodeRef}
            style={{
                borderColor: isOver ? 'var(--color-primary)' : 'var(--color-border)'
            }}
        >
            <div className="kanban-column-header">
                <span>{title}</span>
                <span className="column-badge">{items.length}</span>
            </div>
            <div className="kanban-column-content">
                {items.map(item => {
                    const analysis = analyses.find(a => a.biddingProcessId === item.id);
                    return (
                        <KanbanItem
                            key={item.id}
                            item={item}
                            companies={companies}
                            onDoubleClick={() => onEditProcess(item)}
                            hasAnalysis={!!analysis}
                            onViewAnalysis={analysis ? () => onViewAnalysis(analysis, item) : undefined}
                            onDelete={() => onDeleteProcess(item.id)}
                        />
                    );
                })}
            </div>
        </div>
    );
}
