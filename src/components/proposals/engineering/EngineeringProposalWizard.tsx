/**
 * EngineeringProposalWizard.tsx — Orquestrador do Wizard de 5 passos
 * Substitui o EngineeringProposalEditor monolítico.
 * Mantém todo o estado centralizado e distribui via props para cada step.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { Settings, TableProperties, Calendar, FileText, Package as PackageIcon, Save, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { StepperBar } from './StepperBar';
import { Step1ConfigPanel } from './steps/Step1ConfigPanel';
import { Step2BudgetEditor } from './steps/Step2BudgetEditor';
import { Step4ProposalLetter } from './steps/Step4ProposalLetter';
import { calculateBdiTCU, applyBdi, DEFAULT_BDI_CONFIG, autoDistributeBdi, type BdiConfig, type BdiTcuParams } from './bdiEngine';
import { applyPrecision } from './precisionEngine';
import { CronogramaPanel } from './CronogramaPanel';
import { BudgetDocsPanel } from './BudgetDocsPanel';
import type { EngItem, EngItemType, EngineeringConfig } from './types';
import { isGrouper, DEFAULT_ENGINEERING_CONFIG } from './types';

interface Props { proposalId: string; biddingId: string; }

const token = () => localStorage.getItem('token') || '';
const hdrs = () => ({ 'Authorization': `Bearer ${token()}`, 'Content-Type': 'application/json' });
const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function parseLocaleNumber(value: unknown, fallback = 0): number {
    if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
    const raw = String(value ?? '').trim();
    if (!raw) return fallback;
    const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : fallback;
}

export function EngineeringProposalWizard({ proposalId, biddingId }: Props) {
    // ══════════════════════════════════════════
    // CORE STATE (same as legacy editor)
    // ══════════════════════════════════════════
    const [items, setItems] = useState<EngItem[]>([]);
    const [bdiConfig, setBdiConfig] = useState<BdiConfig>({ ...DEFAULT_BDI_CONFIG });
    const [engineeringConfig, setEngineeringConfig] = useState<EngineeringConfig>({ ...DEFAULT_ENGINEERING_CONFIG });
    const [cronogramaData, setCronogramaData] = useState<{ meses: number; etapas: any[] } | null>(null);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [saveMsg, setSaveMsg] = useState<React.ReactNode | null>(null);
    const [bases, setBases] = useState<any[]>([]);

    // UI state
    const [currentStep, setCurrentStep] = useState(1);
    const [isExtractingBdi, setIsExtractingBdi] = useState(false);
    const [isAuditing, setIsAuditing] = useState(false);

    const effectiveBdi = bdiConfig.bdiGlobal;
    const billableItems = items.filter(it => !isGrouper(it.type));
    const subtotal = billableItems.reduce((s, it) => s + it.quantity * it.unitCost, 0);
    const total = billableItems.reduce((s, it) => s + it.totalPrice, 0);

    // Step completion
    const stepCompletion = {
        config: !!(engineeringConfig.ufReferencia || engineeringConfig.basesConsideradas.length > 0),
        budget: items.length > 0,
        cronograma: !!cronogramaData,
        carta: false, // TODO: track letter generation
    };

    // ══════════════════════════════════════════
    // RECALC
    // ══════════════════════════════════════════
    const recalcAll = useCallback((its: EngItem[], _bdi: number, config: EngineeringConfig) => {
        return its.map(it => {
            if (isGrouper(it.type)) return it;
            const itemBdi = config.bdiDiferenciado && it.bdiCategoria === 'FORNECIMENTO'
                ? (config.bdiFornecimento || 14.02) : _bdi;
            const up = applyBdi(it.unitCost, itemBdi, config.precision);
            return { ...it, unitPrice: up, totalPrice: applyPrecision(it.quantity * up, config) };
        });
    }, []);

    useEffect(() => { setItems(prev => recalcAll(prev, effectiveBdi, engineeringConfig)); }, [effectiveBdi, engineeringConfig, recalcAll]);

    // ══════════════════════════════════════════
    // LOAD DATA
    // ══════════════════════════════════════════
    useEffect(() => {
        setItems([]); setHasUnsavedChanges(false); setCronogramaData(null);
        fetch(`/api/engineering/proposals/${proposalId}/items`, { headers: hdrs() })
            .then(r => r.json()).then(data => {
                if (Array.isArray(data)) { setItems(data); }
                else if (data?.items) {
                    setItems(Array.isArray(data.items) ? data.items : []);
                    if (data.bdiConfig) setBdiConfig(data.bdiConfig);
                    if (data.engineeringConfig) {
                        const { cronogramaData: saved, ...engConfig } = data.engineeringConfig;
                        setEngineeringConfig(engConfig);
                        if (saved) setCronogramaData(saved);
                    }
                }
            }).catch(console.error);

        fetch('/api/engineering/bases', { headers: hdrs() })
            .then(r => r.json()).then(data => {
                if (Array.isArray(data)) {
                    setBases(data);
                }
            }).catch(console.error);
    }, [proposalId]);

    // ══════════════════════════════════════════
    // SAVE
    // ══════════════════════════════════════════
    const handleSave = async () => {
        setIsSaving(true); setSaveMsg(null);
        try {
            const itemsToSave = recalcAll(items, effectiveBdi, engineeringConfig);
            setItems(itemsToSave);
            const res = await fetch(`/api/engineering/proposals/${proposalId}/items`, {
                method: 'POST', headers: hdrs(),
                body: JSON.stringify({ items: itemsToSave, bdiConfig, engineeringConfig, cronogramaData })
            });
            if (res.ok) {
                const d = await res.json();
                setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-success)' }}><CheckCircle2 size={14} /> {d.message}</span>);
                setHasUnsavedChanges(false);
            } else {
                setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-danger)' }}><XCircle size={14} /> Erro ao salvar</span>);
            }
        } catch {
            setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-danger)' }}><XCircle size={14} /> Erro de rede</span>);
        } finally { setIsSaving(false); setTimeout(() => setSaveMsg(null), 4000); }
    };

    // Warn on page leave
    useEffect(() => {
        const handler = (e: BeforeUnloadEvent) => { if (hasUnsavedChanges) e.preventDefault(); };
        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, [hasUnsavedChanges]);

    // ══════════════════════════════════════════
    // BDI EXTRACTION
    // ══════════════════════════════════════════
    const handleExtractBdi = async () => {
        setIsExtractingBdi(true);
        try {
            const res = await fetch('/api/engineering/ai-extract-bdi', {
                method: 'POST', headers: hdrs(), body: JSON.stringify({ biddingId })
            });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Erro');
            const result = await res.json();
            if (result.data?.tcu) {
                setBdiConfig(prev => ({ ...prev, mode: 'TCU', tcu: { ...prev.tcu, ...result.data.tcu } }));
                setHasUnsavedChanges(true);
            } else if (result.data?.globalBdi) {
                setBdiConfig(prev => ({ ...prev, mode: 'SIMPLIFICADO', bdiGlobal: result.data.globalBdi, tcu: autoDistributeBdi(result.data.globalBdi) }));
                setHasUnsavedChanges(true);
            }
        } catch (e) { console.error(e); }
        finally { setIsExtractingBdi(false); }
    };

    // Sync bases
    const syncBases = async () => {
        if (items.length === 0) return;
        setIsAuditing(true);
        try {
            const res = await fetch('/api/engineering/price-audit', {
                method: 'POST', headers: hdrs(),
                body: JSON.stringify({ items, engineeringConfig }),
            });
            if (!res.ok) throw new Error('Erro ao sincronizar');
            const data = await res.json();
            const syncedItems = (Array.isArray(data.items) ? data.items : items).map((it: any) => {
                if (it.priceAudit?.matchedUnitCost && it.priceAudit.matchedUnitCost > 0) {
                    return { ...it, unitCost: it.priceAudit.matchedUnitCost, priceOrigin: 'BASE' as const };
                }
                return it;
            });
            setItems(recalcAll(syncedItems, effectiveBdi, engineeringConfig));
            setHasUnsavedChanges(true);
        } catch (e) { console.error(e); }
        finally { setIsAuditing(false); }
    };

    // Config change handlers
    const handleConfigChange = (config: EngineeringConfig) => {
        setHasUnsavedChanges(true);
        setEngineeringConfig(config);
    };
    const handleBdiChange = (config: BdiConfig) => {
        setHasUnsavedChanges(true);
        setBdiConfig(config);
    };

    // ══════════════════════════════════════════
    // RENDER
    // ══════════════════════════════════════════
    const steps = [
        { label: 'Configuração', icon: Settings, completed: stepCompletion.config },
        { label: 'Planilha Orçamentária', icon: TableProperties, completed: stepCompletion.budget },
        { label: 'Cronograma', icon: Calendar, completed: stepCompletion.cronograma },
        { label: 'Carta Proposta', icon: FileText, completed: stepCompletion.carta },
        { label: 'Exportação', icon: PackageIcon, completed: false },
    ];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', marginTop: 'var(--space-2)' }}>

            {/* Top Bar: Title + Save */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-3) var(--space-4)', background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                    <div style={{ background: 'var(--color-primary-light)', padding: 8, borderRadius: 'var(--radius-md)' }}>
                        <TableProperties size={18} color="var(--color-primary)" />
                    </div>
                    <div>
                        <h3 style={{ margin: 0, fontSize: 'var(--text-md)', fontWeight: 700 }}>Proposta de Engenharia</h3>
                        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)' }}>
                            {items.length} itens · BDI {effectiveBdi.toFixed(2)}% · Total: {fmt(total)}
                        </span>
                    </div>
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                    {saveMsg && <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>{saveMsg}</span>}
                    <button className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 6, position: 'relative' }} onClick={handleSave} disabled={isSaving}>
                        {isSaving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
                        {isSaving ? 'Salvando...' : 'Salvar'}
                        {hasUnsavedChanges && !isSaving && (
                            <span style={{ position: 'absolute', top: -3, right: -3, width: 8, height: 8, borderRadius: '50%', background: '#f59e0b', border: '2px solid var(--color-bg-surface)', animation: 'pulse 2s infinite' }} title="Alterações não salvas" />
                        )}
                    </button>
                </div>
            </div>

            {/* Stepper */}
            <StepperBar steps={steps} currentStep={currentStep} onStepClick={setCurrentStep} />

            {/* Step Content */}
            {currentStep === 1 && (
                <Step1ConfigPanel
                    engineeringConfig={engineeringConfig}
                    bdiConfig={bdiConfig}
                    isExtractingBdi={isExtractingBdi}
                    isAuditing={isAuditing}
                    isSaving={isSaving}
                    onConfigChange={handleConfigChange}
                    onBdiChange={handleBdiChange}
                    onExtractBdi={handleExtractBdi}
                    onSyncBases={syncBases}
                    onSave={handleSave}
                    onNext={() => setCurrentStep(2)}
                />
            )}

            {/* Step 2: Budget Editor (delegates to legacy editor) */}
            {currentStep === 2 && (
                <Step2BudgetEditor
                    proposalId={proposalId}
                    biddingId={biddingId}
                    onPrev={() => setCurrentStep(1)}
                    onNext={() => setCurrentStep(3)}
                />
            )}

            {/* Step 3: Cronograma */}
            {currentStep === 3 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                    <CronogramaPanel
                        items={items}
                        savedData={cronogramaData}
                        onDataChange={(data) => { setHasUnsavedChanges(true); setCronogramaData(data); }}
                    />
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 0', borderTop: '1px solid var(--color-border)' }}>
                        <button className="btn btn-outline" onClick={() => setCurrentStep(2)}
                            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 20px' }}>
                            ← Voltar: Planilha
                        </button>
                        <button className="btn btn-primary" onClick={() => setCurrentStep(4)}
                            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 24px', fontSize: '0.9rem', fontWeight: 700 }}>
                            Próximo: Carta Proposta →
                        </button>
                    </div>
                </div>
            )}

            {/* Step 4: Carta Proposta */}
            {currentStep === 4 && (
                <Step4ProposalLetter
                    proposalId={proposalId}
                    biddingId={biddingId}
                    items={items}
                    bdiGlobal={effectiveBdi}
                    total={total}
                    engineeringConfig={engineeringConfig}
                    onPrev={() => setCurrentStep(3)}
                    onNext={() => setCurrentStep(5)}
                />
            )}

            {/* Step 5: Exportação */}
            {currentStep === 5 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                    <BudgetDocsPanel
                        items={items}
                        bdiConfig={bdiConfig}
                        effectiveBdi={effectiveBdi}
                        insumos={[]}
                        cronogramaResult={null}
                        proposalId={proposalId}
                        engineeringConfig={engineeringConfig}
                    />
                    <div style={{ display: 'flex', justifyContent: 'flex-start', padding: '12px 0', borderTop: '1px solid var(--color-border)' }}>
                        <button className="btn btn-outline" onClick={() => setCurrentStep(4)}
                            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 20px' }}>
                            ← Voltar: Carta Proposta
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
