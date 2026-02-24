import { useState } from 'react';
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    DragOverlay,
} from '@dnd-kit/core';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import {
    arrayMove,
    sortableKeyboardCoordinates
} from '@dnd-kit/sortable';
import React from 'react';

import { KanbanColumn } from './KanbanColumn';
import { KanbanItem } from './KanbanCard';
import type { BiddingProcess, BiddingStatus, AiAnalysis, CompanyProfile } from '../types';
import { COLUMNS } from '../types';

interface Props {
    items: BiddingProcess[];
    setItems: React.Dispatch<React.SetStateAction<BiddingProcess[]>>;
    onEditProcess: (process: BiddingProcess) => void;
    analyses: AiAnalysis[];
    companies: CompanyProfile[];
    onViewAnalysis: (analysis: AiAnalysis, process: BiddingProcess) => void;
    onDeleteProcess: (id: string) => void;
    onStatusChange: (id: string, newStatus: BiddingStatus) => void;
}

export function KanbanBoard({ items, setItems, onEditProcess, onDeleteProcess, analyses, companies, onViewAnalysis, onStatusChange }: Props) {
    const [activeItem, setActiveItem] = useState<BiddingProcess | null>(null);

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    const handleDragStart = (event: DragStartEvent) => {
        const { active } = event;
        setActiveItem(items.find(item => item.id === active.id) || null);
    };

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        setActiveItem(null);

        if (!over) return;

        const activeId = active.id;
        const overId = over.id;

        if (activeId === overId) return;

        const isActiveColumn = COLUMNS.includes(activeId as BiddingStatus);
        const isOverColumn = COLUMNS.includes(overId as BiddingStatus);

        // Dropping a card onto another column directly
        if (!isActiveColumn && isOverColumn) {
            setItems((prev) => {
                return prev.map(item => {
                    if (item.id === activeId) {
                        return { ...item, status: overId as BiddingStatus };
                    }
                    return item;
                });
            });
            onStatusChange(activeId as string, overId as BiddingStatus);
            return;
        }

        // Dropping a card onto another card
        if (!isActiveColumn && !isOverColumn) {
            setItems((prev) => {
                const activeIndex = prev.findIndex(t => t.id === activeId);
                const overIndex = prev.findIndex(t => t.id === overId);

                const newItems = [...prev];
                if (newItems[activeIndex].status !== newItems[overIndex].status) {
                    const newStatus = newItems[overIndex].status;
                    newItems[activeIndex].status = newStatus;
                    onStatusChange(activeId as string, newStatus);
                }

                return arrayMove(newItems, activeIndex, overIndex);
            });
        }
    };

    return (
        <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
        >
            <div className="kanban-board">
                {COLUMNS.map((col) => (
                    <KanbanColumn
                        key={col}
                        title={col}
                        items={items.filter(item => item.status === col)}
                        onEditProcess={onEditProcess}
                        onDeleteProcess={onDeleteProcess}
                        analyses={analyses}
                        companies={companies}
                        onViewAnalysis={onViewAnalysis}
                    />
                ))}

                <DragOverlay>
                    {activeItem ? <KanbanItem item={activeItem} isOverlay hasAnalysis={analyses.some(a => a.biddingProcessId === activeItem.id)} companies={companies} onDelete={onDeleteProcess} /> : null}
                </DragOverlay>
            </div>
        </DndContext>
    );
}
