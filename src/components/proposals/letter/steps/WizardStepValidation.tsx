import { CheckCircle2, XCircle, AlertTriangle, Sparkles, ChevronLeft, ChevronRight } from 'lucide-react';
import type { ProposalLetterWizardProps } from '../ProposalLetterWizard';
import type { useProposalWizard } from '../useProposalWizard';

export function WizardStepValidation({ p, w }: { p: ProposalLetterWizardProps, w: ReturnType<typeof useProposalWizard> }) {
    if (!w.validation) return null;

    return (
        <div>
            <h3 style={{ margin: '0 0 var(--space-4)', fontSize: 'var(--text-lg)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                {w.validation.isValid
                    ? <><CheckCircle2 size={18} color="var(--color-success)" /> Dados Validados</>
                    : <><XCircle size={18} color="var(--color-danger)" /> Validação com Erros</>
                }
            </h3>

            {/* Errors */}
            {w.validation.errors.length > 0 && (
                <div style={{
                    background: 'rgba(239,68,68,0.06)', border: 'none', boxShadow: '0 0 0 1px rgba(239,68,68,0.2)',
                    borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)', marginBottom: 'var(--space-4)',
                }}>
                    <div style={{ fontWeight: 700, color: 'var(--color-danger)', marginBottom: 'var(--space-2)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <XCircle size={15} /> {w.validation.errors.length} erro(s) impeditivo(s)
                    </div>
                    {w.validation.errors.map((e, i) => (
                        <div key={i} style={{ fontSize: 'var(--text-sm)', padding: 'var(--space-2) 0', borderTop: i > 0 ? '1px solid rgba(239,68,68,0.1)' : 'none' }}>
                            <span style={{ color: 'var(--color-danger)', fontWeight: 600 }}><XCircle size={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />{e.message}</span>
                            {e.suggestion && <div style={{ color: 'var(--color-text-tertiary)', fontSize: '0.75rem', marginTop: 2 }}><Sparkles size={10} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />{e.suggestion}</div>}
                        </div>
                    ))}
                </div>
            )}

            {/* Warnings */}
            {w.validation.warnings.length > 0 && (
                <div style={{
                    background: 'rgba(245,158,11,0.06)', border: 'none', boxShadow: '0 0 0 1px rgba(245,158,11,0.2)',
                    borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)', marginBottom: 'var(--space-4)',
                }}>
                    <div style={{ fontWeight: 700, color: 'var(--color-warning)', marginBottom: 'var(--space-2)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <AlertTriangle size={15} /> {w.validation.warnings.length} alerta(s)
                    </div>
                    {w.validation.warnings.map((warn, i) => (
                        <div key={i} style={{ fontSize: 'var(--text-sm)', padding: 'var(--space-2) 0', borderTop: i > 0 ? '1px solid rgba(245,158,11,0.1)' : 'none' }}>
                            <span style={{ color: 'var(--color-warning)' }}><AlertTriangle size={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />{warn.message}</span>
                            {warn.suggestion && <div style={{ color: 'var(--color-text-tertiary)', fontSize: '0.75rem', marginTop: 2 }}><Sparkles size={10} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />{warn.suggestion}</div>}
                        </div>
                    ))}
                </div>
            )}

            {/* Success */}
            {w.validation.isValid && w.validation.errors.length === 0 && (
                <div style={{
                    background: 'rgba(16,185,129,0.06)', border: 'none', boxShadow: '0 0 0 1px rgba(16,185,129,0.2)',
                    borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)', marginBottom: 'var(--space-4)',
                    color: 'var(--color-success)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8,
                }}>
                    <CheckCircle2 size={18} /> Todos os campos obrigatórios estão preenchidos. Pronto para gerar!
                </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--space-5)' }}>
                <button onClick={() => w.setStep('config')} className="btn btn-outline" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <ChevronLeft size={16} /> Voltar
                </button>
                <button onClick={w.handleGenerate} disabled={!w.validation.isValid || w.isGenerating} style={{
                    padding: 'var(--space-2) var(--space-6)', borderRadius: 'var(--radius-lg)',
                    background: w.validation.isValid ? 'linear-gradient(135deg, var(--color-ai), var(--color-primary))' : 'var(--color-bg-elevated)',
                    color: w.validation.isValid ? 'white' : 'var(--color-text-tertiary)',
                    border: 'none', fontWeight: 700, fontSize: 'var(--text-md)', cursor: w.validation.isValid ? 'pointer' : 'default',
                    display: 'flex', alignItems: 'center', gap: 8, opacity: w.validation.isValid ? 1 : 0.5,
                }}>
                    <Sparkles size={16} /> Gerar Carta <ChevronRight size={16} />
                </button>
            </div>
        </div>
    );
}
