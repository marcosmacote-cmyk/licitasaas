import { useState, useRef, useEffect } from 'react';
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

/**
 * "Entenda esta fase" — Modal contextual centralizado via portal.
 * Abre como um dialog leve com backdrop escurecido.
 */
export function PhaseExplainer({ stage, substage: _substage, compact = false }: PhaseExplainerProps) {
    const [isOpen, setIsOpen] = useState(false);
    const modalRef = useRef<HTMLDivElement>(null);

    const content = PHASE_EXPLAINER[stage];
    if (!content) return null;

    // Close on Escape
    useEffect(() => {
        if (!isOpen) return;
        const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsOpen(false); };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [isOpen]);

    // Block body scroll when open
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
            return () => { document.body.style.overflow = ''; };
        }
    }, [isOpen]);

    return (
        <>
            {/* ── Trigger Button ── */}
            <button
                onClick={(e) => { e.stopPropagation(); e.preventDefault(); setIsOpen(true); }}
                title="Entenda esta fase"
                style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: '0.65rem', fontWeight: 600,
                    color: 'var(--color-text-tertiary)',
                    padding: compact ? '2px' : '2px 6px',
                    borderRadius: 'var(--radius-sm)',
                    transition: 'all 0.15s ease',
                    opacity: 0.6,
                    flexShrink: 0,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = 'var(--color-primary)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.6'; e.currentTarget.style.color = 'var(--color-text-tertiary)'; }}
            >
                <HelpCircle size={compact ? 13 : 12} />
                {!compact && <span>Entenda esta fase</span>}
            </button>

            {/* ── Modal via Portal ── */}
            {isOpen && createPortal(
                <div
                    style={{
                        position: 'fixed', inset: 0, zIndex: 999999,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        padding: 24,
                    }}
                    onClick={() => setIsOpen(false)}
                >
                    {/* Backdrop */}
                    <div style={{
                        position: 'absolute', inset: 0,
                        background: 'rgba(0,0,0,0.35)',
                        backdropFilter: 'blur(2px)',
                    }} />

                    {/* Modal Card */}
                    <div
                        ref={modalRef}
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            position: 'relative',
                            width: '100%',
                            maxWidth: 420,
                            maxHeight: 'calc(100vh - 48px)',
                            overflowY: 'auto',
                            background: 'var(--color-bg-primary)',
                            border: '1px solid var(--color-border)',
                            borderRadius: 'var(--radius-xl)',
                            boxShadow: '0 24px 80px rgba(0,0,0,0.2), 0 8px 24px rgba(0,0,0,0.1)',
                            animation: 'phaseExplainerIn 0.2s ease',
                        }}
                    >
                        {/* Header */}
                        <div style={{
                            padding: '18px 20px 14px',
                            borderBottom: '1px solid var(--color-border)',
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            position: 'sticky', top: 0,
                            background: 'var(--color-bg-primary)',
                            borderRadius: 'var(--radius-xl) var(--radius-xl) 0 0',
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <div style={{
                                    width: 32, height: 32, borderRadius: 'var(--radius-md)',
                                    background: 'var(--color-primary-light)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    flexShrink: 0,
                                }}>
                                    <Info size={16} color="var(--color-primary)" />
                                </div>
                                <div>
                                    <div style={{ fontSize: '0.92rem', fontWeight: 700, color: 'var(--color-text-primary)', lineHeight: 1.2 }}>
                                        {stage}
                                    </div>
                                    <div style={{ fontSize: '0.62rem', fontWeight: 600, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 1 }}>
                                        Entenda esta fase
                                    </div>
                                </div>
                            </div>
                            <button
                                onClick={() => setIsOpen(false)}
                                style={{
                                    background: 'var(--color-bg-body)', border: '1px solid var(--color-border)',
                                    cursor: 'pointer', color: 'var(--color-text-secondary)',
                                    padding: 5, borderRadius: 'var(--radius-sm)',
                                    display: 'flex', flexShrink: 0,
                                    transition: 'all 0.1s ease',
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-danger)'; e.currentTarget.style.color = '#fff'; e.currentTarget.style.borderColor = 'var(--color-danger)'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--color-bg-body)'; e.currentTarget.style.color = 'var(--color-text-secondary)'; e.currentTarget.style.borderColor = 'var(--color-border)'; }}
                            >
                                <X size={14} />
                            </button>
                        </div>

                        {/* Content */}
                        <div style={{ padding: '16px 20px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                            {/* O que significa */}
                            <Section title="O que significa">
                                <p style={pStyle}>{content.meaning}</p>
                            </Section>

                            {/* Como interpretar */}
                            <Section title="Como interpretar os cards">
                                <p style={pStyle}>{content.cardInterpretation}</p>
                            </Section>

                            {/* Módulos — 2 colunas lado a lado */}
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                                <Section title="Módulos disponíveis">
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                        {content.availableModules.map(m => (
                                            <ModuleBadge key={m} label={m} type="allowed" />
                                        ))}
                                    </div>
                                </Section>
                                <Section title="Módulos bloqueados">
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                        {content.blockedModules.map(m => (
                                            <ModuleBadge key={m} label={m} type="blocked" />
                                        ))}
                                    </div>
                                </Section>
                            </div>

                            {/* Próxima ação */}
                            <div style={{
                                display: 'flex', alignItems: 'center', gap: 10,
                                padding: '10px 12px', borderRadius: 'var(--radius-md)',
                                background: 'var(--color-primary-light)',
                                border: '1px solid rgba(37, 99, 235, 0.12)',
                            }}>
                                <ArrowRight size={15} color="var(--color-primary)" style={{ flexShrink: 0 }} />
                                <div>
                                    <div style={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>
                                        Próxima ação recomendada
                                    </div>
                                    <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                                        {content.recommendedAction}
                                    </div>
                                </div>
                            </div>

                            {/* Observação crítica */}
                            <div style={{
                                display: 'flex', alignItems: 'flex-start', gap: 10,
                                padding: '10px 12px', borderRadius: 'var(--radius-md)',
                                background: 'rgba(245, 158, 11, 0.05)',
                                border: '1px solid rgba(245, 158, 11, 0.12)',
                            }}>
                                <AlertTriangle size={14} color="var(--color-warning)" style={{ flexShrink: 0, marginTop: 1 }} />
                                <div style={{ fontSize: '0.76rem', color: 'var(--color-text-secondary)', lineHeight: 1.55 }}>
                                    {content.criticalNote}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* Inline animation keyframes */}
            {isOpen && createPortal(
                <style>{`
                    @keyframes phaseExplainerIn {
                        from { opacity: 0; transform: scale(0.95) translateY(8px); }
                        to   { opacity: 1; transform: scale(1) translateY(0); }
                    }
                `}</style>,
                document.head
            )}
        </>
    );
}

// ── Sub-components ──

const pStyle: React.CSSProperties = {
    fontSize: '0.78rem',
    color: 'var(--color-text-secondary)',
    lineHeight: 1.6,
    margin: 0,
};

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div>
            <div style={{
                fontSize: '0.6rem', fontWeight: 700, color: 'var(--color-text-tertiary)',
                textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5,
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
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '3px 8px', borderRadius: 'var(--radius-full)',
            fontSize: '0.66rem', fontWeight: 600,
            background: isAllowed ? 'rgba(34, 197, 94, 0.06)' : 'rgba(239, 68, 68, 0.04)',
            color: isAllowed ? 'var(--color-success)' : 'rgba(239, 68, 68, 0.65)',
            border: `1px solid ${isAllowed ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.12)'}`,
        }}>
            {isAllowed
                ? <CheckCircle2 size={10} />
                : <XCircle size={10} />
            }
            {label}
        </span>
    );
}
