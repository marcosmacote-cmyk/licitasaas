/**
 * UnsavedChangesModal.tsx — Prompt de confirmação estilo Google Docs.
 *
 * Exibido quando o usuário tenta navegar entre Steps com alterações não salvas.
 * 3 ações: Salvar e Continuar / Descartar / Cancelar.
 */
import React from 'react';
import { AlertTriangle, Save, Trash2, X } from 'lucide-react';

interface Props {
    onSaveAndContinue: () => void;
    onDiscard: () => void;
    onCancel: () => void;
    isSaving?: boolean;
    targetStepLabel?: string;
}

export function UnsavedChangesModal({ onSaveAndContinue, onDiscard, onCancel, isSaving, targetStepLabel }: Props) {
    return (
        <div
            style={{
                position: 'fixed', inset: 0,
                background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(4px)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                zIndex: 1200, padding: 16,
            }}
            onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
        >
            <div style={{
                background: 'var(--color-bg-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 16,
                width: 460, maxWidth: '95vw',
                boxShadow: '0 20px 25px -5px rgba(0,0,0,0.15)',
                animation: 'scaleUp 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                overflow: 'hidden',
            }}>
                {/* Header */}
                <div style={{
                    padding: '20px 24px 16px',
                    display: 'flex', alignItems: 'flex-start', gap: 14,
                }}>
                    <div style={{
                        background: 'rgba(245,158,11,0.1)',
                        borderRadius: 10, padding: 10,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0,
                    }}>
                        <AlertTriangle size={20} color="#d97706" />
                    </div>
                    <div>
                        <h3 style={{ margin: '0 0 6px', fontSize: '1rem', fontWeight: 700 }}>
                            Alterações não salvas
                        </h3>
                        <p style={{
                            margin: 0, fontSize: '0.82rem', color: 'var(--color-text-secondary)',
                            lineHeight: 1.5,
                        }}>
                            Você tem alterações que ainda não foram salvas.
                            {targetStepLabel && (
                                <> Deseja salvar antes de ir para <strong>{targetStepLabel}</strong>?</>
                            )}
                            {!targetStepLabel && ' Deseja salvar antes de sair?'}
                        </p>
                    </div>
                </div>

                {/* Actions */}
                <div style={{
                    padding: '12px 24px 20px',
                    display: 'flex', gap: 10, justifyContent: 'flex-end',
                }}>
                    <button
                        onClick={onCancel}
                        className="btn btn-outline"
                        style={{
                            padding: '8px 16px', fontSize: '0.82rem',
                            display: 'flex', alignItems: 'center', gap: 6,
                        }}
                        disabled={isSaving}
                    >
                        <X size={14} /> Cancelar
                    </button>
                    <button
                        onClick={onDiscard}
                        style={{
                            padding: '8px 16px', fontSize: '0.82rem',
                            display: 'flex', alignItems: 'center', gap: 6,
                            background: 'rgba(239,68,68,0.06)',
                            border: '1px solid rgba(239,68,68,0.2)',
                            borderRadius: 'var(--radius-md)',
                            color: '#dc2626', fontWeight: 600, cursor: 'pointer',
                            transition: 'all 0.15s',
                        }}
                        onMouseEnter={e => {
                            e.currentTarget.style.background = 'rgba(239,68,68,0.12)';
                        }}
                        onMouseLeave={e => {
                            e.currentTarget.style.background = 'rgba(239,68,68,0.06)';
                        }}
                        disabled={isSaving}
                    >
                        <Trash2 size={14} /> Descartar
                    </button>
                    <button
                        onClick={onSaveAndContinue}
                        className="btn btn-primary"
                        style={{
                            padding: '8px 20px', fontSize: '0.82rem', fontWeight: 600,
                            display: 'flex', alignItems: 'center', gap: 6,
                        }}
                        disabled={isSaving}
                    >
                        <Save size={14} />
                        {isSaving ? 'Salvando...' : 'Salvar e Continuar'}
                    </button>
                </div>
            </div>
        </div>
    );
}
