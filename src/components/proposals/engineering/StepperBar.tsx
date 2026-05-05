/**
 * StepperBar.tsx — Barra de navegação visual do Wizard de Engenharia
 * Exibe os 5 passos com indicação de estado: completado, ativo, pendente.
 */
import type { LucideIcon } from 'lucide-react';
import { Check } from 'lucide-react';

export interface StepDef {
    label: string;
    icon: LucideIcon;
    completed: boolean;
}

interface Props {
    steps: StepDef[];
    currentStep: number;
    onStepClick: (step: number) => void;
}

export function StepperBar({ steps, currentStep, onStepClick }: Props) {
    return (
        <div style={{
            display: 'flex', alignItems: 'center', gap: 0,
            padding: '6px 8px',
            background: 'var(--color-bg-surface)',
            borderRadius: 'var(--radius-lg)',
            border: '1px solid var(--color-border)',
        }}>
            {steps.map((step, i) => {
                const stepNum = i + 1;
                const isActive = stepNum === currentStep;
                const isCompleted = step.completed;
                const isPast = stepNum < currentStep;
                const Icon = step.icon;

                return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
                        <button
                            onClick={() => onStepClick(stepNum)}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 8,
                                padding: '10px 16px',
                                borderRadius: 'var(--radius-md)',
                                border: 'none',
                                cursor: 'pointer',
                                flex: 1,
                                minWidth: 0,
                                transition: 'all 0.2s ease',
                                background: isActive
                                    ? 'linear-gradient(135deg, rgba(37,99,235,0.1), rgba(99,102,241,0.06))'
                                    : 'transparent',
                                boxShadow: isActive ? '0 1px 3px rgba(37,99,235,0.1)' : 'none',
                            }}
                        >
                            {/* Step circle */}
                            <div style={{
                                width: 28, height: 28, borderRadius: '50%',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                flexShrink: 0,
                                transition: 'all 0.2s ease',
                                background: isActive
                                    ? 'var(--color-primary)'
                                    : isCompleted
                                        ? 'rgba(16,185,129,0.12)'
                                        : 'var(--color-bg-base)',
                                border: `2px solid ${isActive
                                    ? 'var(--color-primary)'
                                    : isCompleted
                                        ? '#10b981'
                                        : 'var(--color-border)'}`,
                                color: isActive
                                    ? 'white'
                                    : isCompleted
                                        ? '#10b981'
                                        : 'var(--color-text-tertiary)',
                                fontSize: '0.7rem',
                                fontWeight: 800,
                            }}>
                                {isCompleted && !isActive ? <Check size={14} /> : <Icon size={14} />}
                            </div>

                            {/* Label */}
                            <div style={{ minWidth: 0 }}>
                                <div style={{
                                    fontSize: '0.6rem',
                                    fontWeight: 700,
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.06em',
                                    color: isActive
                                        ? 'var(--color-primary)'
                                        : isCompleted
                                            ? '#10b981'
                                            : 'var(--color-text-tertiary)',
                                    marginBottom: 1,
                                    whiteSpace: 'nowrap',
                                }}>
                                    Passo {stepNum}
                                </div>
                                <div style={{
                                    fontSize: '0.8rem',
                                    fontWeight: isActive ? 700 : 500,
                                    color: isActive
                                        ? 'var(--color-text-primary)'
                                        : isPast || isCompleted
                                            ? 'var(--color-text-secondary)'
                                            : 'var(--color-text-tertiary)',
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                }}>
                                    {step.label}
                                </div>
                            </div>
                        </button>

                        {/* Connector line */}
                        {i < steps.length - 1 && (
                            <div style={{
                                width: 24, height: 2, flexShrink: 0,
                                background: isPast || isCompleted
                                    ? 'rgba(16,185,129,0.3)'
                                    : 'var(--color-border)',
                                borderRadius: 1,
                                transition: 'background 0.3s ease',
                            }} />
                        )}
                    </div>
                );
            })}
        </div>
    );
}
