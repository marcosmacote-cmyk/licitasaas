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
            {/* ── Trigger ── */}
            <button
                onClick={(e) => { e.stopPropagation(); e.preventDefault(); setIsOpen(true); }}
                title="Entenda esta fase"
                style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    background: 'none', border: 'none', cursor: 'pointer',
                    fontSize: '0.65rem', fontWeight: 600,
                    color: 'var(--color-text-tertiary)',
                    padding: compact ? '2px' : '2px 6px',
                    borderRadius: 4,
                    opacity: 0.65, flexShrink: 0,
                    transition: 'opacity 0.15s, color 0.15s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.opacity = '1'; e.currentTarget.style.color = 'var(--color-primary)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.opacity = '0.65'; e.currentTarget.style.color = 'var(--color-text-tertiary)'; }}
            >
                <HelpCircle size={compact ? 13 : 12} />
                {!compact && <span>Entenda esta fase</span>}
            </button>

            {/* ── Modal Portal ── */}
            {isOpen && createPortal(
                <>
                    <style>{`
                        @keyframes peSlideIn {
                            from { opacity: 0; transform: translateY(12px) scale(0.97); }
                            to   { opacity: 1; transform: translateY(0) scale(1); }
                        }
                        .pe-overlay {
                            position: fixed; inset: 0; z-index: 999999;
                            display: flex; align-items: center; justify-content: center;
                            padding: 24px; box-sizing: border-box;
                            background: rgba(0, 0, 0, 0.65);
                        }
                        .pe-modal {
                            position: relative;
                            width: 100%; max-width: 500px;
                            background: var(--color-bg-surface);
                            border: 1px solid var(--color-border);
                            border-radius: 14px;
                            box-shadow: 0 24px 64px rgba(0,0,0,0.35), 0 4px 16px rgba(0,0,0,0.15);
                            animation: peSlideIn 0.18s ease;
                            display: flex; flex-direction: column;
                            max-height: calc(100vh - 48px);
                        }
                        .pe-header {
                            padding: 15px 18px 13px;
                            border-bottom: 2px solid var(--color-border);
                            display: flex; align-items: center; justify-content: space-between;
                            flex-shrink: 0;
                            background: var(--color-bg-base);
                            border-radius: 14px 14px 0 0;
                        }
                        .pe-body {
                            padding: 16px 18px 18px;
                            overflow-y: auto;
                            display: flex; flex-direction: column; gap: 13px;
                            background: var(--color-bg-surface);
                            border-radius: 0 0 14px 14px;
                        }
                        .pe-divider {
                            height: 1px; background: var(--color-border-subtle);
                            margin: 0 -18px;
                        }
                        /* ── Section labels ── */
                        .pe-label {
                            font-size: 0.58rem; font-weight: 700;
                            color: var(--color-text-tertiary);
                            text-transform: uppercase; letter-spacing: 0.08em;
                            margin-bottom: 4px; display: block;
                        }
                        /* ── Body text ── */
                        .pe-text {
                            font-size: 0.79rem; color: var(--color-text-secondary);
                            line-height: 1.55; margin: 0;
                            font-weight: 400;
                        }
                        /* ── Modules grid ── */
                        .pe-modules-grid {
                            display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
                        }
                        .pe-module-block {
                            background: var(--color-bg-base);
                            border: 1px solid var(--color-border);
                            border-radius: 8px;
                            padding: 9px 10px 8px;
                        }
                        .pe-badge-list {
                            display: flex; flex-direction: column; gap: 4px;
                        }
                        .pe-badge {
                            display: inline-flex; align-items: center; gap: 4px;
                            padding: 3px 7px; border-radius: 6px;
                            font-size: 0.68rem; font-weight: 500;
                            background: var(--color-bg-surface);
                        }
                        .pe-badge--allowed {
                            color: var(--color-success);
                            border: 1px solid var(--color-success-border);
                        }
                        .pe-badge--blocked {
                            color: var(--color-danger);
                            border: 1px solid var(--color-danger-border);
                        }
                        /* ── Action box ── */
                        .pe-action-box {
                            display: flex; align-items: center; gap: 10px;
                            padding: 9px 13px;
                            background: var(--color-primary-light);
                            border: 1px solid var(--color-primary-border);
                            border-radius: 8px;
                        }
                        .pe-action-label {
                            font-size: 0.57rem; font-weight: 700;
                            color: var(--color-primary);
                            text-transform: uppercase; letter-spacing: 0.07em;
                            margin-bottom: 3px;
                        }
                        .pe-action-text {
                            font-size: 0.83rem; font-weight: 700;
                            color: var(--color-primary-deep, var(--color-primary));
                        }
                        /* ── Warning box ── */
                        .pe-warning-box {
                            display: flex; align-items: flex-start; gap: 9px;
                            padding: 9px 13px;
                            background: var(--color-warning-bg);
                            border: 1px solid var(--color-warning-border);
                            border-radius: 8px;
                        }
                        .pe-warning-text {
                            font-size: 0.75rem; color: var(--color-warning-hover);
                            line-height: 1.55; font-weight: 400;
                        }
                        /* ── Close button ── */
                        .pe-close {
                            display: flex; align-items: center; justify-content: center;
                            width: 26px; height: 26px;
                            background: var(--color-bg-secondary); border: 1px solid var(--color-border);
                            border-radius: 6px; cursor: pointer;
                            color: var(--color-text-tertiary); flex-shrink: 0;
                            transition: all 0.12s ease;
                        }
                        .pe-close:hover {
                            background: var(--color-danger-bg); border-color: var(--color-danger-border); color: var(--color-danger);
                        }
                        /* ── Phase icon bg ── */
                        .pe-icon-wrap {
                            width: 30px; height: 30px; border-radius: 8px;
                            background: var(--color-primary-light);
                            display: flex; align-items: center; justify-content: center;
                            flex-shrink: 0;
                        }
                    `}</style>

                    <div className="pe-overlay" onClick={() => setIsOpen(false)}>
                        <div className="pe-modal" onClick={(e) => e.stopPropagation()}>

                            {/* ─── Header ─── */}
                            <div className="pe-header">
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                    <div className="pe-icon-wrap">
                                        <Info size={15} color="var(--color-primary)" />
                                    </div>
                                    <div>
                                        <div style={{ fontSize: '0.92rem', fontWeight: 800, color: 'var(--color-text-primary)', lineHeight: 1.15 }}>
                                            {stage}
                                        </div>
                                        <div style={{ fontSize: '0.6rem', fontWeight: 600, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 1 }}>
                                            Entenda esta fase
                                        </div>
                                    </div>
                                </div>
                                <button className="pe-close" onClick={() => setIsOpen(false)}>
                                    <X size={14} />
                                </button>
                            </div>

                            {/* ─── Body ─── */}
                            <div className="pe-body">

                                {/* O que significa */}
                                <div>
                                    <span className="pe-label">O que significa</span>
                                    <p className="pe-text" style={{ color: 'var(--color-text-secondary)' }}>{content.meaning}</p>
                                </div>

                                <div className="pe-divider" />

                                {/* Como interpretar */}
                                <div>
                                    <span className="pe-label">Como interpretar os cards</span>
                                    <p className="pe-text">{content.cardInterpretation}</p>
                                </div>

                                <div className="pe-divider" />

                                {/* Módulos */}
                                <div className="pe-modules-grid">
                                    {/* Disponíveis */}
                                    <div className="pe-module-block" style={{ borderColor: 'var(--color-success-border)', background: 'var(--color-success-bg)' }}>
                                        <span className="pe-label" style={{ color: 'var(--color-success)' }}>Disponíveis</span>
                                        <div className="pe-badge-list">
                                            {content.availableModules.map(m => (
                                                <span key={m} className="pe-badge pe-badge--allowed">
                                                    <CheckCircle2 size={9} style={{ flexShrink: 0 }} />{m}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                    {/* Bloqueados */}
                                    <div className="pe-module-block" style={{ borderColor: 'var(--color-danger-border)', background: 'var(--color-danger-bg)' }}>
                                        <span className="pe-label" style={{ color: 'var(--color-danger)' }}>Bloqueados</span>
                                        <div className="pe-badge-list">
                                            {content.blockedModules.map(m => (
                                                <span key={m} className="pe-badge pe-badge--blocked">
                                                    <XCircle size={9} style={{ flexShrink: 0 }} />{m}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                {/* Próxima ação */}
                                <div className="pe-action-box">
                                    <ArrowRight size={16} color="var(--color-primary)" style={{ flexShrink: 0 }} />
                                    <div>
                                        <div className="pe-action-label">Próxima ação recomendada</div>
                                        <div className="pe-action-text">{content.recommendedAction}</div>
                                    </div>
                                </div>

                                {/* Observação crítica */}
                                <div className="pe-warning-box">
                                    <AlertTriangle size={15} color="var(--color-warning)" style={{ flexShrink: 0, marginTop: 1 }} />
                                    <div className="pe-warning-text">{content.criticalNote}</div>
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
