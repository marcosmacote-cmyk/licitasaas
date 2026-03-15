import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { HelpCircle, X, CheckCircle2, XCircle, ArrowRight, AlertTriangle, Info } from 'lucide-react';
import { PHASE_EXPLAINER, type KanbanStage } from '../../governance';

interface PhaseExplainerProps {
    stage: KanbanStage;
    substage?: string | null;
    compact?: boolean;
}

export function PhaseExplainer({ stage, substage: _substage, compact = false }: PhaseExplainerProps) {
    const [isOpen, setIsOpen] = useState(false);

    const content = PHASE_EXPLAINER[stage];
    if (!content) return null;

    useEffect(() => {
        if (!isOpen) return;
        const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsOpen(false); };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [isOpen]);

    return (
        <>
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
                    opacity: 0.6, flexShrink: 0,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = 'var(--color-primary)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.6'; e.currentTarget.style.color = 'var(--color-text-tertiary)'; }}
            >
                <HelpCircle size={compact ? 13 : 12} />
                {!compact && <span>Entenda esta fase</span>}
            </button>

            {isOpen && createPortal(
                <>
                    <style>{`
                        @keyframes peIn {
                            from { opacity: 0; transform: scale(0.96) translateY(10px); }
                            to   { opacity: 1; transform: scale(1) translateY(0); }
                        }
                        .pe-overlay {
                            position: fixed; inset: 0; z-index: 999999;
                            display: flex; align-items: center; justify-content: center;
                            padding: 20px; box-sizing: border-box;
                            background: rgba(0,0,0,0.45);
                            backdrop-filter: blur(3px);
                        }
                        .pe-modal {
                            position: relative;
                            width: 100%; max-width: 480px;
                            background: var(--color-bg-primary);
                            border: 1px solid var(--color-border);
                            border-radius: 16px;
                            box-shadow: 0 32px 80px rgba(0,0,0,0.25);
                            animation: peIn 0.18s ease;
                            display: flex; flex-direction: column;
                            max-height: calc(100vh - 40px);
                        }
                        .pe-header {
                            padding: 18px 20px 14px;
                            border-bottom: 1px solid var(--color-border);
                            display: flex; align-items: center; justify-content: space-between;
                            flex-shrink: 0;
                        }
                        .pe-body {
                            padding: 18px 20px 20px;
                            overflow-y: auto;
                            display: flex; flex-direction: column; gap: 16px;
                        }
                        .pe-section-label {
                            font-size: 0.6rem; font-weight: 700;
                            color: var(--color-text-tertiary);
                            text-transform: uppercase; letter-spacing: 0.07em;
                            margin-bottom: 6px;
                        }
                        .pe-text {
                            font-size: 0.8rem;
                            color: var(--color-text-secondary);
                            line-height: 1.6; margin: 0;
                        }
                        .pe-modules-grid {
                            display: grid; grid-template-columns: 1fr 1fr; gap: 14px;
                        }
                        .pe-badge-list {
                            display: flex; flex-direction: column; gap: 5px;
                        }
                        .pe-badge {
                            display: inline-flex; align-items: center; gap: 5px;
                            padding: 4px 8px; border-radius: 999px;
                            font-size: 0.68rem; font-weight: 600;
                        }
                        .pe-badge--allowed {
                            background: rgba(34,197,94,0.07);
                            color: var(--color-success);
                            border: 1px solid rgba(34,197,94,0.18);
                        }
                        .pe-badge--blocked {
                            background: rgba(239,68,68,0.05);
                            color: rgba(239,68,68,0.7);
                            border: 1px solid rgba(239,68,68,0.14);
                        }
                        .pe-action-box {
                            display: flex; align-items: center; gap: 10px;
                            padding: 10px 14px; border-radius: 10px;
                            background: var(--color-primary-light);
                            border: 1px solid rgba(37,99,235,0.12);
                        }
                        .pe-warning-box {
                            display: flex; align-items: flex-start; gap: 10px;
                            padding: 10px 14px; border-radius: 10px;
                            background: rgba(245,158,11,0.05);
                            border: 1px solid rgba(245,158,11,0.14);
                        }
                        .pe-close-btn {
                            background: var(--color-bg-body);
                            border: 1px solid var(--color-border);
                            border-radius: 6px; cursor: pointer;
                            color: var(--color-text-secondary);
                            display: flex; padding: 5px;
                            flex-shrink: 0; transition: all 0.1s;
                        }
                        .pe-close-btn:hover { background: var(--color-danger); color: #fff; border-color: var(--color-danger); }
                    `}</style>

                    <div className="pe-overlay" onClick={() => setIsOpen(false)}>
                        <div className="pe-modal" onClick={(e) => e.stopPropagation()}>
                            {/* Header */}
                            <div className="pe-header">
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                    <div style={{
                                        width: 34, height: 34, borderRadius: 8,
                                        background: 'var(--color-primary-light)',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                                    }}>
                                        <Info size={17} color="var(--color-primary)" />
                                    </div>
                                    <div>
                                        <div style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--color-text-primary)', lineHeight: 1.2 }}>
                                            {stage}
                                        </div>
                                        <div style={{ fontSize: '0.62rem', fontWeight: 600, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 2 }}>
                                            Entenda esta fase
                                        </div>
                                    </div>
                                </div>
                                <button className="pe-close-btn" onClick={() => setIsOpen(false)}>
                                    <X size={14} />
                                </button>
                            </div>

                            {/* Body (scrollable) */}
                            <div className="pe-body">
                                {/* O que significa */}
                                <div>
                                    <div className="pe-section-label">O que significa</div>
                                    <p className="pe-text">{content.meaning}</p>
                                </div>

                                {/* Como interpretar */}
                                <div>
                                    <div className="pe-section-label">Como interpretar os cards</div>
                                    <p className="pe-text">{content.cardInterpretation}</p>
                                </div>

                                {/* Módulos grid */}
                                <div className="pe-modules-grid">
                                    <div>
                                        <div className="pe-section-label">✓ Módulos disponíveis</div>
                                        <div className="pe-badge-list">
                                            {content.availableModules.map(m => (
                                                <span key={m} className="pe-badge pe-badge--allowed">
                                                    <CheckCircle2 size={10} />{m}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                    <div>
                                        <div className="pe-section-label">✕ Módulos bloqueados</div>
                                        <div className="pe-badge-list">
                                            {content.blockedModules.map(m => (
                                                <span key={m} className="pe-badge pe-badge--blocked">
                                                    <XCircle size={10} />{m}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                {/* Próxima ação */}
                                <div className="pe-action-box">
                                    <ArrowRight size={15} color="var(--color-primary)" style={{ flexShrink: 0 }} />
                                    <div>
                                        <div style={{ fontSize: '0.6rem', fontWeight: 700, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>
                                            Próxima ação recomendada
                                        </div>
                                        <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                                            {content.recommendedAction}
                                        </div>
                                    </div>
                                </div>

                                {/* Observação crítica */}
                                <div className="pe-warning-box">
                                    <AlertTriangle size={14} color="var(--color-warning)" style={{ flexShrink: 0, marginTop: 1 }} />
                                    <div style={{ fontSize: '0.78rem', color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
                                        {content.criticalNote}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </>,
                document.body
            )}
        </>
    );
}
