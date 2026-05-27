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
import { useState, useCallback } from 'react';
import { EngineeringProposalEditor } from '../EngineeringProposalEditor';
import { AiDisclaimerBanner } from '../../../shared/AiDisclaimerBanner';
import type { EngineeringConfig, EngItem } from '../types';
import type { BdiConfig } from '../bdiEngine';

interface Props {
    proposalId: string;
    biddingId: string;
    engineeringConfig?: EngineeringConfig;
    bdiConfig?: BdiConfig;
    /** FIX STEP2-01: Current items from wizard state — passed to editor for remount persistence */
    items?: EngItem[];
    onItemsChange?: (items: EngItem[]) => void;
    /** FIX F2.3: Estimated value from the bidding for comparison card */
    estimatedValue?: number;
    onPrev: () => void;
    onNext: () => void;
    onReloadProposal?: () => void;
}

export function Step2BudgetEditor({ proposalId, biddingId, engineeringConfig, bdiConfig, items, onItemsChange, estimatedValue, onPrev, onNext, onReloadProposal }: Props) {
    // Track whether items have been loaded (from AI extraction or saved data)
    const [hasLoadedItems, setHasLoadedItems] = useState(false);

    const handleItemsChange = useCallback((items: EngItem[]) => {
        if (items.length > 0) setHasLoadedItems(true);
        onItemsChange?.(items);
    }, [onItemsChange]);

    // FIX WARN-01: Detect lump-sum extraction (no real budget found in PNCP docs)
    const currentItems = items || [];
    const isLumpSum = currentItems.length > 0 &&
        currentItems.length <= 3 &&
        !currentItems.some(it => it.type === 'ETAPA') &&
        !currentItems.some(it => it.sourceName && it.sourceName !== 'PROPRIA' && it.code && it.code !== 'N/A');
    const showBanner = hasLoadedItems || (items && items.length > 0);
    const bannerVariant = isLumpSum ? 'extraction_limited' : 'extraction';

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {/* AI Disclaimer — only visible AFTER items are loaded */}
            {showBanner && <AiDisclaimerBanner variant={bannerVariant} />}

            {/* The legacy editor renders the full budget table with DnD, toolbar, sidebar, search modal, etc. */}
            <EngineeringProposalEditor
                proposalId={proposalId}
                biddingId={biddingId}
                wizardConfig={engineeringConfig}
                wizardBdiConfig={bdiConfig}
                onItemsChange={handleItemsChange}
                wizardItems={items}
                estimatedValue={estimatedValue}
                onReloadProposal={onReloadProposal}
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
