/**
 * Step2BudgetEditor.tsx — Planilha Orçamentária (Step 2 do Wizard)
 * 
 * ESTRATÉGIA: Em vez de duplicar 800+ linhas da tabela DnD, este componente
 * renderiza o EngineeringProposalEditor legado em "modo embutido" (embedded mode).
 * O editor legado continua funcionando 100% — apenas o wrapper de navegação muda.
 * 
 * Recebe engineeringConfig e bdiConfig do Wizard para que o dashboard sidebar
 * reflita a configuração atual do Step 1 em tempo real.
 */
import { EngineeringProposalEditor } from '../EngineeringProposalEditor';
import type { EngineeringConfig } from '../types';
import type { BdiConfig } from '../bdiEngine';

interface Props {
    proposalId: string;
    biddingId: string;
    engineeringConfig?: EngineeringConfig;
    bdiConfig?: BdiConfig;
    onPrev: () => void;
    onNext: () => void;
}

export function Step2BudgetEditor({ proposalId, biddingId, engineeringConfig, bdiConfig, onPrev, onNext }: Props) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {/* The legacy editor renders the full budget table with DnD, toolbar, sidebar, search modal, etc. */}
            <EngineeringProposalEditor
                proposalId={proposalId}
                biddingId={biddingId}
                wizardConfig={engineeringConfig}
                wizardBdiConfig={bdiConfig}
            />

            {/* Step navigation footer */}
            <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '12px 0', borderTop: '1px solid var(--color-border)', marginTop: 8,
            }}>
                <button className="btn btn-outline" onClick={onPrev}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 20px' }}>
                    ← Voltar: Configuração
                </button>
                <button className="btn btn-primary" onClick={onNext}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 24px', fontSize: '0.9rem', fontWeight: 700 }}>
                    Próximo: Cronograma →
                </button>
            </div>
        </div>
    );
}
