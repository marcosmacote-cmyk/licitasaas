import { useState, useRef, useEffect } from 'react';
import { Plus, Check, FolderPlus, X } from 'lucide-react';

interface ListOption {
    id: string;
    name: string;
    count?: number;
}

interface ListPickerProps {
    open: boolean;
    onClose: () => void;
    title: string;
    lists: ListOption[];
    onSelect: (listId: string) => void;
    onCreateNew: (name: string) => string | Promise<string>; // Returns new list ID (sync or async)
    anchorRef?: React.RefObject<HTMLElement>;
}

export function ListPickerPopover({ open, onClose, title, lists, onSelect, onCreateNew }: ListPickerProps) {
    const [isCreating, setIsCreating] = useState(false);
    const [newName, setNewName] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (isCreating) inputRef.current?.focus();
    }, [isCreating]);

    useEffect(() => {
        if (!open) { setIsCreating(false); setNewName(''); }
    }, [open]);

    // Close on outside click
    useEffect(() => {
        if (!open) return;
        const handler = (e: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
                onClose();
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [open, onClose]);

    if (!open) return null;

    const handleCreate = async () => {
        const trimmed = newName.trim();
        if (!trimmed) return;
        const newId = await onCreateNew(trimmed);
        onSelect(newId);
        onClose();
    };

    return (
        <>
            {/* Backdrop */}
            <div style={{
                position: 'fixed', inset: 0, zIndex: 9998,
                background: 'rgba(0,0,0,0.25)', backdropFilter: 'blur(2px)',
            }} onClick={onClose} />

            {/* Popover */}
            <div
                ref={containerRef}
                style={{
                    position: 'fixed',
                    top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                    zIndex: 9999,
                    background: 'var(--color-bg-surface)',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-xl)',
                    boxShadow: 'var(--shadow-xl)',
                    minWidth: '340px',
                    maxWidth: '440px',
                    width: '90vw',
                    animation: 'slideDown 0.2s ease-out',
                    overflow: 'hidden',
                }}
            >
                {/* Header */}
                <div style={{
                    padding: 'var(--space-4) var(--space-5)',
                    borderBottom: '1px solid var(--color-border)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                }}>
                    <span style={{
                        fontWeight: 'var(--font-semibold)' as any,
                        fontSize: 'var(--text-base)',
                        color: 'var(--color-text-primary)',
                    }}>{title}</span>
                    <button
                        onClick={onClose}
                        style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            color: 'var(--color-text-tertiary)', padding: '4px',
                            borderRadius: 'var(--radius-md)',
                        }}
                    >
                        <X size={16} />
                    </button>
                </div>

                {/* List options */}
                <div style={{
                    maxHeight: '280px', overflowY: 'auto',
                    padding: 'var(--space-2) 0',
                }}>
                    {lists.map(list => (
                        <button
                            key={list.id}
                            onClick={() => { onSelect(list.id); onClose(); }}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                                width: '100%', padding: 'var(--space-3) var(--space-5)',
                                background: 'none', border: 'none', cursor: 'pointer',
                                fontSize: 'var(--text-md)', color: 'var(--color-text-primary)',
                                textAlign: 'left',
                                transition: 'var(--transition-fast)',
                            }}
                            onMouseEnter={(e: any) => e.currentTarget.style.background = 'var(--color-bg-base)'}
                            onMouseLeave={(e: any) => e.currentTarget.style.background = 'none'}
                        >
                            <Check size={14} style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
                            <span style={{ flex: 1 }}>{list.name}</span>
                            {list.count != null && (
                                <span style={{
                                    fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)',
                                    background: 'var(--color-bg-base)',
                                    padding: '1px 8px', borderRadius: 'var(--radius-lg)',
                                }}>{list.count}</span>
                            )}
                        </button>
                    ))}
                </div>

                {/* Create new */}
                <div style={{
                    borderTop: '1px solid var(--color-border)',
                    padding: 'var(--space-3) var(--space-5)',
                }}>
                    {!isCreating ? (
                        <button
                            onClick={() => setIsCreating(true)}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                                background: 'none', border: 'none', cursor: 'pointer',
                                color: 'var(--color-primary)', fontWeight: 'var(--font-semibold)' as any,
                                fontSize: 'var(--text-md)', padding: '4px 0',
                            }}
                        >
                            <FolderPlus size={15} />
                            Criar nova lista
                        </button>
                    ) : (
                        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                            <input
                                ref={inputRef}
                                type="text"
                                placeholder="Nome da nova lista..."
                                value={newName}
                                onChange={(e) => setNewName(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); if (e.key === 'Escape') setIsCreating(false); }}
                                style={{
                                    flex: 1,
                                    padding: 'var(--space-2) var(--space-3)',
                                    borderRadius: 'var(--radius-md)',
                                    border: '1px solid var(--color-primary)',
                                    background: 'var(--color-bg-base)',
                                    fontSize: 'var(--text-md)',
                                    outline: 'none',
                                    color: 'var(--color-text-primary)',
                                }}
                            />
                            <button
                                onClick={handleCreate}
                                disabled={!newName.trim()}
                                className="btn btn-primary"
                                style={{
                                    padding: 'var(--space-2) var(--space-3)',
                                    fontSize: 'var(--text-sm)', borderRadius: 'var(--radius-md)',
                                    gap: '4px',
                                }}
                            >
                                <Plus size={14} /> Criar
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </>
    );
}
