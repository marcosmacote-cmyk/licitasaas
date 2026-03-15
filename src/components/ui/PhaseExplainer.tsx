import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { HelpCircle, X, CheckCircle2, XCircle, ArrowRight, AlertTriangle, Info } from 'lucide-react';
import { PHASE_EXPLAINER, type KanbanStage } from '../../governance';

interface PhaseExplainerProps {
    /** Fase macro a exibir */
    stage: KanbanStage;
    /** Subfase operacional (para nota complementar) */
    substage?: string | null;
    /** Compact mode: apenas ícone sem label */
    compact?: boolean;
}

const POPOVER_WIDTH = 340;
const POPOVER_GAP = 10;

/**
 * "Entenda esta fase" — Popover contextual via portal.
 * Renderiza fora do DOM da coluna Kanban para evitar overflow/overlap.
 */
export function PhaseExplainer({ stage, substage: _substage, compact = false }: PhaseExplainerProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
    const triggerRef = useRef<HTMLButtonElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);

    const content = PHASE_EXPLAINER[stage];
    if (!content) return null;

    // Calculate fixed position based on trigger button
    const updatePosition = useCallback(() => {
        if (!triggerRef.current) return;
        const rect = triggerRef.current.getBoundingClientRect();
        const viewportW = window.innerWidth;
        const viewportH = window.innerHeight;

        // Try to open to the right of the trigger
        let left = rect.right + POPOVER_GAP;
        let top = rect.top;

        // If overflows right, try left side
        if (left + POPOVER_WIDTH > viewportW - 16) {
            left = rect.left - POPOVER_WIDTH - POPOVER_GAP;
        }
        // If still overflows (very small screen), center
        if (left < 16) {
            left = Math.max(16, (viewportW - POPOVER_WIDTH) / 2);
        }
        // Vertical: don't overflow bottom
        if (top + 400 > viewportH) {
            top = Math.max(16, viewportH - 420);
        }

        setCoords({ top, left });
    }, []);

    // Open handler
    const handleToggle = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        if (!isOpen) {
            updatePosition();
        }
        setIsOpen(prev => !prev);
    }, [isOpen, updatePosition]);

    // Close on click outside
    useEffect(() => {
        if (!isOpen) return;
        const handler = (e: MouseEvent) => {
            if (popoverRef.current && !popoverRef.current.contains(e.target as Node) &&
                triggerRef.current && !triggerRef.current.contains(e.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [isOpen]);

    // Close on Escape
    useEffect(() => {
        if (!isOpen) return;
        const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsOpen(false); };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [isOpen]);

    // Reposition on scroll/resize
    useEffect(() => {
        if (!isOpen) return;
        const handler = () => updatePosition();
        window.addEventListener('scroll', handler, true);
        window.addEventListener('resize', handler);
        return () => {
            window.removeEventListener('scroll', handler, true);
            window.removeEventListener('resize', handler);
        };
    }, [isOpen, updatePosition]);

    return (
        <>
            {/* ── Trigger ── */}
            <button
                ref={triggerRef}
                onClick={handleToggle}
                title="Entenda esta fase"
                style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: '0.65rem', fontWeight: 600,
                    color: isOpen ? 'var(--color-primary)' : 'var(--color-text-tertiary)',
                    padding: compact ? '2px' : '2px 6px',
                    borderRadius: 'var(--radius-sm)',
                    transition: 'all 0.15s ease',
                    opacity: isOpen ? 1 : 0.7,
                    flexShrink: 0,
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.opacity = '1'; (e.currentTarget as HTMLElement).style.color = 'var(--color-primary)'; }}
                onMouseLeave={(e) => { if (!isOpen) { (e.currentTarget as HTMLElement).style.opacity = '0.7'; (e.currentTarget as HTMLElement).style.color = 'var(--color-text-tertiary)'; } }}
            >
                <HelpCircle size={compact ? 13 : 12} />
                {!compact && <span>Entenda esta fase</span>}
            </button>

            {/* ── Popover via Portal (renderiza fora da coluna) ── */}
            {isOpen && createPortal(
                <div
                    ref={popoverRef}
                    onClick={(e) => e.stopPropagation()}
                    style={{
                        position: 'fixed',
                        top: coords.top,
                        left: coords.left,
                        width: POPOVER_WIDTH,
                        maxHeight: 'min(480px, calc(100vh - 40px))',
                        overflowY: 'auto',
                        background: 'var(--color-bg-primary)',
                        border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-xl)',
                        boxShadow: '0 20px 60px rgba(0,0,0,0.15), 0 8px 20px rgba(0,0,0,0.08)',
                        zIndex: 99999,
                        padding: 0,
                        animation: 'fadeIn 0.15s ease',
                    }}
                >
                    {/* Header */}
                    <div style={{
                        padding: '14px 16px 10px',
                        borderBottom: '1px solid var(--color-border)',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        position: 'sticky', top: 0,
                        background: 'var(--color-bg-primary)',
                        borderRadius: 'var(--radius-xl) var(--radius-xl) 0 0',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{
                                width: 26, height: 26, borderRadius: 'var(--radius-md)',
                                background: 'var(--color-primary-light)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                flexShrink: 0,
                            }}>
                                <Info size={14} color="var(--color-primary)" />
                            </div>
                            <div>
                                <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--color-text-primary)', lineHeight: 1.2 }}>
                                    {stage}
                                </div>
                                <div style={{ fontSize: '0.58rem', fontWeight: 600, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    Entenda esta fase
                                </div>
                            </div>
                        </div>
                        <button
                            onClick={() => setIsOpen(false)}
                            style={{
                                background: 'var(--color-bg-body)', border: '1px solid var(--color-border)',
                                cursor: 'pointer', color: 'var(--color-text-tertiary)',
                                padding: 4, borderRadius: 'var(--radius-sm)',
                                display: 'flex', flexShrink: 0,
                            }}
                        >
                            <X size={14} />
                        </button>
                    </div>

                    {/* Content */}
                    <div style={{ padding: '12px 16px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {/* O que significa */}
                        <Section title="O que significa">
                            <p style={pStyle}>{content.meaning}</p>
                        </Section>

                        {/* Como interpretar */}
                        <Section title="Como interpretar os cards">
                            <p style={pStyle}>{content.cardInterpretation}</p>
                        </Section>

                        {/* Módulos disponíveis */}
                        <Section title="Módulos disponíveis">
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                {content.availableModules.map(m => (
                                    <ModuleBadge key={m} label={m} type="allowed" />
                                ))}
                            </div>
                        </Section>

                        {/* Módulos bloqueados */}
                        <Section title="Módulos bloqueados">
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                {content.blockedModules.map(m => (
                                    <ModuleBadge key={m} label={m} type="blocked" />
                                ))}
                            </div>
                        </Section>

                        {/* Próxima ação */}
                        <div style={{
                            display: 'flex', alignItems: 'center', gap: 8,
                            padding: '8px 10px', borderRadius: 'var(--radius-md)',
                            background: 'var(--color-primary-light)',
                            border: '1px solid rgba(37, 99, 235, 0.1)',
                        }}>
                            <ArrowRight size={13} color="var(--color-primary)" style={{ flexShrink: 0 }} />
                            <div>
                                <div style={{ fontSize: '0.58rem', fontWeight: 700, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 1 }}>
                                    Próxima ação recomendada
                                </div>
                                <div style={{ fontSize: '0.74rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                                    {content.recommendedAction}
                                </div>
                            </div>
                        </div>

                        {/* Observação crítica */}
                        <div style={{
                            display: 'flex', alignItems: 'flex-start', gap: 8,
                            padding: '8px 10px', borderRadius: 'var(--radius-md)',
                            background: 'rgba(245, 158, 11, 0.04)',
                            border: '1px solid rgba(245, 158, 11, 0.1)',
                        }}>
                            <AlertTriangle size={12} color="var(--color-warning)" style={{ flexShrink: 0, marginTop: 1 }} />
                            <div style={{ fontSize: '0.7rem', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                                {content.criticalNote}
                            </div>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </>
    );
}

// ── Sub-components ──

const pStyle: React.CSSProperties = {
    fontSize: '0.72rem',
    color: 'var(--color-text-secondary)',
    lineHeight: 1.55,
    margin: 0,
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div>
            <div style={{
                fontSize: '0.58rem', fontWeight: 700, color: 'var(--color-text-tertiary)',
                textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3,
            }}>
                {title}
            </div>
            {children}
        </div>
    );
}

function ModuleBadge({ label, type }: { label: string; type: 'allowed' | 'blocked' }) {
    const isAllowed = type === 'allowed';
    return (
        <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 3,
            padding: '2px 7px', borderRadius: 'var(--radius-full)',
            fontSize: '0.62rem', fontWeight: 600,
            background: isAllowed ? 'rgba(34, 197, 94, 0.06)' : 'rgba(239, 68, 68, 0.04)',
            color: isAllowed ? 'var(--color-success)' : 'rgba(239, 68, 68, 0.65)',
            border: `1px solid ${isAllowed ? 'rgba(34, 197, 94, 0.12)' : 'rgba(239, 68, 68, 0.1)'}`,
        }}>
            {isAllowed
                ? <CheckCircle2 size={9} />
                : <XCircle size={9} />
            }
            {label}
        </span>
    );
}
