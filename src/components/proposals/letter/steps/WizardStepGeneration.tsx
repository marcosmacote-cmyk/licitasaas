import { Cpu, Loader2, ChevronRight } from 'lucide-react';
import type { ProposalLetterWizardProps } from '../ProposalLetterWizard';
import type { useProposalWizard } from '../useProposalWizard';

export function WizardStepGeneration({ p, w }: { p: ProposalLetterWizardProps, w: ReturnType<typeof useProposalWizard> }) {
    return (
        <div>
            <h3 style={{ margin: '0 0 var(--space-4)', fontSize: 'var(--text-lg)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Cpu size={18} color="var(--color-primary)" /> Geração da Carta
                {w.isGenerating && <Loader2 size={16} className="spin" style={{ color: 'var(--color-primary)' }} />}
            </h3>

            <div style={{
                background: 'var(--color-bg-elevated)', borderRadius: 'var(--radius-lg)',
                border: 'none', boxShadow: '0 0 0 1px var(--color-border)', padding: 'var(--space-4)',
            }}>
                {w.generationProgress.map((msg, i) => (
                    <div key={i} style={{
                        padding: 'var(--space-2) 0', fontSize: 'var(--text-sm)',
                        borderTop: i > 0 ? '1px solid var(--color-border)' : 'none',
                        color: msg.startsWith('[x]') ? 'var(--color-danger)'
                            : msg.startsWith('[!]') ? 'var(--color-warning)'
                            : msg.startsWith('[OK]') ? 'var(--color-success)'
                            : 'var(--color-text-secondary)',
                        fontWeight: i === w.generationProgress.length - 1 ? 600 : 400,
                        animation: i === w.generationProgress.length - 1 ? 'fadeIn 0.3s ease-in' : 'none',
                    }}>
                        {msg}
                    </div>
                ))}
            </div>

            {!w.isGenerating && w.letterResult && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-4)' }}>
                    <button onClick={() => w.setStep('review')} style={{
                        padding: 'var(--space-2) var(--space-6)', borderRadius: 'var(--radius-lg)',
                        background: 'var(--color-primary)', color: 'white', border: 'none',
                        fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                    }}>
                        Revisar Carta <ChevronRight size={16} />
                    </button>
                </div>
            )}
        </div>
    );
}
