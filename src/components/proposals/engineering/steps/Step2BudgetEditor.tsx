import { useState, useCallback, useEffect } from 'react';
import { EngineeringProposalEditor } from '../EngineeringProposalEditor';
import { AiDisclaimerBanner } from '../../../shared/AiDisclaimerBanner';
import { ReconciliationDrawer } from '../ReconciliationDrawer';
import { ShieldAlert, AlertTriangle } from 'lucide-react';
import type { EngineeringConfig, EngItem } from '../types';
import { isPropria } from '../types';
import type { BdiConfig } from '../bdiEngine';

interface Props {
    proposalId: string;
    biddingId: string;
    engineeringConfig?: EngineeringConfig;
    bdiConfig?: BdiConfig;
    /** FIX STEP2-01: Current items from wizard state — passed to editor for remount persistence */
    items?: EngItem[];
    onItemsChange?: (items: EngItem[]) => void;
    /** FIX SYNC-PRICE: Propagate unsaved state from Editor → Wizard for auto-save */
    onUnsavedChanges?: () => void;
    /** FIX F2.3: Estimated value from the bidding for comparison card */
    estimatedValue?: number;
    onPrev: () => void;
    onNext: () => void;
    onReloadProposal?: () => void;
}

export function Step2BudgetEditor({ proposalId, biddingId, engineeringConfig, bdiConfig, items, onItemsChange, onUnsavedChanges, estimatedValue, onPrev, onNext, onReloadProposal }: Props) {
    // Track whether items have been loaded (from AI extraction or saved data)
    const [hasLoadedItems, setHasLoadedItems] = useState(false);
    const [isReconcileOpen, setIsReconcileOpen] = useState(false);
    const [reconciliationCount, setReconciliationCount] = useState(0);

    const checkReconciliation = useCallback(async () => {
        try {
            const res = await fetch(`/api/engineering/proposals/${proposalId}/reconciliation-report`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token') || ''}` }
            });
            if (res.ok) {
                const report = await res.json();
                setReconciliationCount(report?.summary?.totalAlerts || 0);
            }
        } catch (e) {
            console.error('[Reconciliation Check] Error:', e);
        }
    }, [proposalId]);

    useEffect(() => {
        checkReconciliation();
    }, [items, checkReconciliation]);

    const handleItemsChange = useCallback((items: EngItem[]) => {
        if (items.length > 0) setHasLoadedItems(true);
        onItemsChange?.(items);
    }, [onItemsChange]);

    // FIX WARN-01: Detect lump-sum extraction (no real budget found in PNCP docs)
    const currentItems = items || [];
    const isLumpSum = currentItems.length > 0 &&
        currentItems.length <= 3 &&
        !currentItems.some(it => it.type === 'ETAPA') &&
        !currentItems.some(it => it.sourceName && !isPropria(it.sourceName) && it.code && it.code !== 'N/A');
    const showBanner = hasLoadedItems || (items && items.length > 0);
    const bannerVariant = isLumpSum ? 'extraction_limited' : 'extraction';

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {/* AI Disclaimer — only visible AFTER items are loaded */}
            {showBanner && <AiDisclaimerBanner variant={bannerVariant} />}

            {/* Reconciliation Banner */}
            {reconciliationCount > 0 && (
                <div style={{
                    background: 'linear-gradient(135deg, rgba(239,68,68,0.06), rgba(245,158,11,0.06))',
                    border: '1px solid rgba(245,158,11,0.25)',
                    padding: '12px 18px',
                    borderRadius: 'var(--radius-lg)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.03)',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <ShieldAlert size={16} color="#d97706" style={{ flexShrink: 0 }} />
                        <span style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                            PACS detectou {reconciliationCount} divergência{reconciliationCount > 1 ? 's' : ''} de valores e bases na proposta.
                        </span>
                    </div>
                    <button className="btn btn-outline btn-sm" onClick={() => setIsReconcileOpen(true)} 
                        style={{ display: 'flex', alignItems: 'center', gap: 6, borderColor: '#d97706', color: '#d97706', padding: '5px 12px', fontSize: '0.75rem', fontWeight: 700, background: '#fff', cursor: 'pointer' }}>
                        <AlertTriangle size={13} />
                        Reconciliar
                    </button>
                </div>
            )}

            {/* The legacy editor renders the full budget table with DnD, toolbar, sidebar, search modal, etc. */}
            <EngineeringProposalEditor
                proposalId={proposalId}
                biddingId={biddingId}
                wizardConfig={engineeringConfig}
                wizardBdiConfig={bdiConfig}
                onItemsChange={handleItemsChange}
                onUnsavedChanges={onUnsavedChanges}
                wizardItems={items}
                estimatedValue={estimatedValue}
                onReloadProposal={onReloadProposal}
                onOpenReconciliation={() => setIsReconcileOpen(true)}
                reconciliationCount={reconciliationCount}
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

            {/* Reconciliation Drawer */}
            <ReconciliationDrawer
                isOpen={isReconcileOpen}
                onClose={() => setIsReconcileOpen(false)}
                proposalId={proposalId}
                onReconciled={() => {
                    checkReconciliation();
                    onReloadProposal?.();
                }}
            />
        </div>
    );
}

