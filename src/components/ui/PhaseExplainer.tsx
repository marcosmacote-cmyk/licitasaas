import { useState, useRef, useEffect } from 'react';
import { HelpCircle, X, CheckCircle2, XCircle, ArrowRight, AlertTriangle, Info } from 'lucide-react';
import { PHASE_EXPLAINER, type KanbanStage } from '../../governance';

interface PhaseExplainerProps {
    /** Fase macro a exibir */
    stage: KanbanStage;
    /** Subfase operacional (para nota complementar) */
    substage?: string | null;
    /** Posição preferida do popover */
    position?: 'bottom' | 'right';
    /** Compact mode: apenas ícone sem label */
    compact?: boolean;
}

/**
 * "Entenda esta fase" — Popover contextual que explica a lógica
 * operacional de cada fase do Kanban.
 */
export function PhaseExplainer({ stage, substage: _substage, position = 'bottom', compact = false }: PhaseExplainerProps) {
    const [isOpen, setIsOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);

    const content = PHASE_EXPLAINER[stage];
    if (!content) return null;

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

    return (
        <div style={{ position: 'relative', display: 'inline-flex' }}>
            {/* ── Trigger ── */}
            <button
                ref={triggerRef}
                onClick={(e) => { e.stopPropagation(); setIsOpen(!isOpen); }}
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
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.opacity = '1'; (e.currentTarget as HTMLElement).style.color = 'var(--color-primary)'; }}
                onMouseLeave={(e) => { if (!isOpen) { (e.currentTarget as HTMLElement).style.opacity = '0.7'; (e.currentTarget as HTMLElement).style.color = 'var(--color-text-tertiary)'; } }}
            >
                <HelpCircle size={compact ? 13 : 12} />
                {!compact && <span>Entenda esta fase</span>}
            </button>

            {/* ── Popover ── */}
            {isOpen && (
                <div
                    ref={popoverRef}
                    onClick={(e) => e.stopPropagation()}
                    style={{
                        position: 'absolute',
                        ...(position === 'right'
                            ? { left: '100%', top: 0, marginLeft: 8 }
                            : { left: '50%', top: '100%', transform: 'translateX(-50%)', marginTop: 8 }),
                        width: 340,
                        maxHeight: 480,
                        overflowY: 'auto',
                        background: 'var(--color-bg-primary)',
                        border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-xl)',
                        boxShadow: '0 12px 40px rgba(0,0,0,0.12), 0 4px 12px rgba(0,0,0,0.06)',
                        zIndex: 9999,
                        padding: 0,
                    }}
                >
                    {/* Header */}
                    <div style={{
                        padding: '16px 18px 12px',
                        borderBottom: '1px solid var(--color-border)',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{
                                width: 28, height: 28, borderRadius: 'var(--radius-md)',
                                background: 'var(--color-primary-light)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                                <Info size={15} color="var(--color-primary)" />
                            </div>
                            <div>
                                <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--color-text-primary)', lineHeight: 1.2 }}>
                                    {stage}
                                </div>
                                <div style={{ fontSize: '0.62rem', fontWeight: 600, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    Entenda esta fase
                                </div>
                            </div>
                        </div>
                        <button
                            onClick={() => setIsOpen(false)}
                            style={{
                                background: 'none', border: 'none', cursor: 'pointer',
                                color: 'var(--color-text-tertiary)', padding: 4, borderRadius: 'var(--radius-sm)',
                                display: 'flex',
                            }}
                        >
                            <X size={16} />
                        </button>
                    </div>

                    {/* Content */}
                    <div style={{ padding: '14px 18px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
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
                            <ArrowRight size={14} color="var(--color-primary)" style={{ flexShrink: 0 }} />
                            <div>
                                <div style={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 1 }}>
                                    Próxima ação recomendada
                                </div>
                                <div style={{ fontSize: '0.77rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>
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
                            <AlertTriangle size={13} color="var(--color-warning)" style={{ flexShrink: 0, marginTop: 1 }} />
                            <div style={{ fontSize: '0.72rem', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                                {content.criticalNote}
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// ── Sub-components ──

const pStyle: React.CSSProperties = {
    fontSize: '0.74rem',
    color: 'var(--color-text-secondary)',
    lineHeight: 1.55,
    margin: 0,
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div>
            <div style={{
                fontSize: '0.6rem', fontWeight: 700, color: 'var(--color-text-tertiary)',
                textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4,
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
            fontSize: '0.64rem', fontWeight: 600,
            background: isAllowed ? 'rgba(34, 197, 94, 0.06)' : 'rgba(239, 68, 68, 0.04)',
            color: isAllowed ? 'var(--color-success)' : 'rgba(239, 68, 68, 0.65)',
            border: `1px solid ${isAllowed ? 'rgba(34, 197, 94, 0.12)' : 'rgba(239, 68, 68, 0.1)'}`,
        }}>
            {isAllowed
                ? <CheckCircle2 size={10} />
                : <XCircle size={10} />
            }
            {label}
        </span>
    );
}
