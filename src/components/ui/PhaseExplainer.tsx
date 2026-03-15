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
                            background: #ffffff;
                            border: 1px solid #d1d5db;
                            border-radius: 14px;
                            box-shadow: 0 24px 64px rgba(0,0,0,0.35), 0 4px 16px rgba(0,0,0,0.15);
                            animation: peSlideIn 0.18s ease;
                            display: flex; flex-direction: column;
                            max-height: calc(100vh - 48px);
                        }
                        /* Dark mode override */
                        @media (prefers-color-scheme: dark) {
                            .pe-modal { background: #1e2130; border-color: #3b4059; }
                        }
                        .pe-header {
                            padding: 20px 22px 16px;
                            border-bottom: 2px solid #e5e7eb;
                            display: flex; align-items: center; justify-content: space-between;
                            flex-shrink: 0;
                            background: #f8f9fa;
                            border-radius: 14px 14px 0 0;
                        }
                        .pe-body {
                            padding: 20px 22px 22px;
                            overflow-y: auto;
                            display: flex; flex-direction: column; gap: 18px;
                            background: #ffffff;
                            border-radius: 0 0 14px 14px;
                        }
                        .pe-divider {
                            height: 1px; background: #e5e7eb;
                            margin: 0 -22px;
                        }
                        /* ── Section labels ── */
                        .pe-label {
                            font-size: 0.6rem; font-weight: 800;
                            color: #6b7280;
                            text-transform: uppercase; letter-spacing: 0.09em;
                            margin-bottom: 6px; display: block;
                        }
                        /* ── Body text ── */
                        .pe-text {
                            font-size: 0.82rem; color: #1f2937;
                            line-height: 1.65; margin: 0;
                            font-weight: 450;
                        }
                        /* ── Modules grid ── */
                        .pe-modules-grid {
                            display: grid; grid-template-columns: 1fr 1fr; gap: 14px;
                        }
                        .pe-module-block {
                            background: #f9fafb;
                            border: 1px solid #e5e7eb;
                            border-radius: 10px;
                            padding: 12px 12px 10px;
                        }
                        .pe-badge-list {
                            display: flex; flex-direction: column; gap: 5px;
                        }
                        .pe-badge {
                            display: inline-flex; align-items: center; gap: 5px;
                            padding: 4px 8px; border-radius: 999px;
                            font-size: 0.7rem; font-weight: 600;
                            background: #ffffff;
                        }
                        .pe-badge--allowed {
                            color: #16a34a;
                            border: 1px solid #bbf7d0;
                        }
                        .pe-badge--blocked {
                            color: #dc2626;
                            border: 1px solid #fecaca;
                        }
                        /* ── Action box ── */
                        .pe-action-box {
                            display: flex; align-items: center; gap: 12px;
                            padding: 12px 16px;
                            background: #eff6ff;
                            border: 1.5px solid #bfdbfe;
                            border-radius: 10px;
                        }
                        .pe-action-label {
                            font-size: 0.6rem; font-weight: 800;
                            color: #2563eb;
                            text-transform: uppercase; letter-spacing: 0.07em;
                            margin-bottom: 4px;
                        }
                        .pe-action-text {
                            font-size: 0.88rem; font-weight: 700;
                            color: #1e40af;
                        }
                        /* ── Warning box ── */
                        .pe-warning-box {
                            display: flex; align-items: flex-start; gap: 10px;
                            padding: 12px 16px;
                            background: #fffbeb;
                            border: 1.5px solid #fde68a;
                            border-radius: 10px;
                        }
                        .pe-warning-text {
                            font-size: 0.78rem; color: #92400e;
                            line-height: 1.6; font-weight: 500;
                        }
                        /* ── Close button ── */
                        .pe-close {
                            display: flex; align-items: center; justify-content: center;
                            width: 30px; height: 30px;
                            background: #ffffff; border: 1.5px solid #d1d5db;
                            border-radius: 8px; cursor: pointer;
                            color: #6b7280; flex-shrink: 0;
                            transition: all 0.12s ease;
                        }
                        .pe-close:hover {
                            background: #ef4444; border-color: #ef4444; color: #ffffff;
                        }
                        /* ── Phase icon bg ── */
                        .pe-icon-wrap {
                            width: 36px; height: 36px; border-radius: 10px;
                            background: #dbeafe;
                            display: flex; align-items: center; justify-content: center;
                            flex-shrink: 0;
                        }
                    `}</style>

                    <div className="pe-overlay" onClick={() => setIsOpen(false)}>
                        <div className="pe-modal" onClick={(e) => e.stopPropagation()}>

                            {/* ─── Header ─── */}
                            <div className="pe-header">
                                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                    <div className="pe-icon-wrap">
                                        <Info size={18} color="#2563eb" />
                                    </div>
                                    <div>
                                        <div style={{ fontSize: '1rem', fontWeight: 800, color: '#111827', lineHeight: 1.2 }}>
                                            {stage}
                                        </div>
                                        <div style={{ fontSize: '0.63rem', fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.07em', marginTop: 2 }}>
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
                                    <p className="pe-text" style={{ color: '#1f2937' }}>{content.meaning}</p>
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
                                    <div className="pe-module-block" style={{ borderColor: '#bbf7d0', background: '#f0fdf4' }}>
                                        <span className="pe-label" style={{ color: '#16a34a' }}>✓ Disponíveis</span>
                                        <div className="pe-badge-list">
                                            {content.availableModules.map(m => (
                                                <span key={m} className="pe-badge pe-badge--allowed">
                                                    <CheckCircle2 size={10} style={{ flexShrink: 0 }} />{m}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                    {/* Bloqueados */}
                                    <div className="pe-module-block" style={{ borderColor: '#fecaca', background: '#fff5f5' }}>
                                        <span className="pe-label" style={{ color: '#dc2626' }}>✕ Bloqueados</span>
                                        <div className="pe-badge-list">
                                            {content.blockedModules.map(m => (
                                                <span key={m} className="pe-badge pe-badge--blocked">
                                                    <XCircle size={10} style={{ flexShrink: 0 }} />{m}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                {/* Próxima ação */}
                                <div className="pe-action-box">
                                    <ArrowRight size={16} color="#2563eb" style={{ flexShrink: 0 }} />
                                    <div>
                                        <div className="pe-action-label">Próxima ação recomendada</div>
                                        <div className="pe-action-text">{content.recommendedAction}</div>
                                    </div>
                                </div>

                                {/* Observação crítica */}
                                <div className="pe-warning-box">
                                    <AlertTriangle size={15} color="#d97706" style={{ flexShrink: 0, marginTop: 1 }} />
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
