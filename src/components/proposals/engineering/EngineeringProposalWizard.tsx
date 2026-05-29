/**
 * EngineeringProposalWizard.tsx — Orquestrador do Wizard de 5 passos
 * Substitui o EngineeringProposalEditor monolítico.
 * Mantém todo o estado centralizado e distribui via props para cada step.
 *
 * FIX F1.1: Auto-save debounced a cada 30s quando hasUnsavedChanges
 * FIX F1.3: BudgetDocsPanel agora recebe cronogramaResult e insumos reais
 * FIX STAB: Auto-save granular (15s), saveValidator, UnsavedChangesModal, cronogramaSync unificado
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Settings, TableProperties, Calendar, FileText, Package as PackageIcon, Save, Loader2, CheckCircle2, XCircle, Clock, AlertTriangle } from 'lucide-react';
import { StepperBar } from './StepperBar';
import { Step1ConfigPanel } from './steps/Step1ConfigPanel';
import { Step2BudgetEditor } from './steps/Step2BudgetEditor';
import { Step4ProposalLetter } from './steps/Step4ProposalLetter';
import { calculateBdiTCU, DEFAULT_BDI_CONFIG, autoDistributeBdi, resolveEffectiveBdi, type BdiConfig, type BdiTcuParams } from './bdiEngine';
import { recalcAllItems, ensureClientIds, buildInsumosItemsHash } from './calculationEngine';
import { applyPrecision } from './precisionEngine';
import { CronogramaPanel } from './CronogramaPanel';
import { BudgetDocsPanel } from './BudgetDocsPanel';
import { calcularCronograma, type CronogramaResult } from './cronogramaEngine';
import { syncCronogramaFromItems } from './cronogramaSync';
import { useAutoSave } from './useAutoSave';
import { validateSavePayload } from './saveValidator';
import { UnsavedChangesModal } from './UnsavedChangesModal';
import type { InsumoConsolidado } from './insumoEngine';
import type { EngItem, EngineeringConfig } from './types';
import { isGrouper, DEFAULT_ENGINEERING_CONFIG } from './types';
import type { BiddingProcess, CompanyProfile, PriceProposal } from '../../../types';

interface Props { 
    proposalId: string; 
    biddingId: string; 
    estimatedValue?: number;
    proposal?: PriceProposal;
    company?: CompanyProfile;
    bidding?: BiddingProcess;
}

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

export function EngineeringProposalWizard({ proposalId, biddingId, estimatedValue, proposal, company, bidding }: Props) {
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

    // FIX STAB: Unsaved changes modal for step navigation
    const [pendingStep, setPendingStep] = useState<number | null>(null);

    // FIX F1.3: Insumos consolidados para BudgetDocsPanel
    const [consolidatedInsumos, setConsolidatedInsumos] = useState<InsumoConsolidado[]>([]);

    // FIX STEP4-CHECK: Track whether the letter has been generated/saved
    const [isLetterSaved, setIsLetterSaved] = useState(false);

    // UI state
    const [currentStep, setCurrentStep] = useState(1);
    const [isExtractingBdi, setIsExtractingBdi] = useState(false);
    const [isExtractingConfig, setIsExtractingConfig] = useState(false);
    const [isExtractingEncargos, setIsExtractingEncargos] = useState(false);
    const [isAuditing, setIsAuditing] = useState(false);

    const effectiveBdi = resolveEffectiveBdi(bdiConfig, engineeringConfig.precision);
    const billableItems = items.filter(it => !isGrouper(it.type));
    const subtotal = billableItems.reduce((s, it) => s + it.quantity * it.unitCost, 0);
    const total = billableItems.reduce((s, it) => s + it.totalPrice, 0);

    // Step completion
    const stepCompletion = {
        config: !!(engineeringConfig.ufReferencia || engineeringConfig.basesConsideradas.length > 0),
        budget: items.length > 0,
        cronograma: !!cronogramaData,
        carta: isLetterSaved,
    };

    // ══════════════════════════════════════════
    // RECALC
    // ══════════════════════════════════════════
    // FIX F1: Delegado ao calculationEngine centralizado.
    // Agora inclui desconto individual (antes ignorado pelo Wizard).
    const recalcAll = useCallback((its: EngItem[], _bdi: number, config: EngineeringConfig) => {
        return recalcAllItems(its, _bdi, config);
    }, []);

    useEffect(() => { setItems(prev => recalcAll(prev, effectiveBdi, engineeringConfig)); }, [effectiveBdi, engineeringConfig, recalcAll]);

    // ══════════════════════════════════════════
    // LOAD DATA
    // ══════════════════════════════════════════
    useEffect(() => {
        // FULL RESET: When proposalId changes (new version or version switch),
        // reset ALL wizard state to defaults before loading saved data from DB.
        setItems([]);
        setHasUnsavedChanges(false);
        setCronogramaData(null);
        setBdiConfig({ ...DEFAULT_BDI_CONFIG });
        setEngineeringConfig({ ...DEFAULT_ENGINEERING_CONFIG });
        setCurrentStep(1);
        setSaveMsg(null);
        // FIX STEP4-CHECK: Initialize letter state from the proposal prop
        setIsLetterSaved(!!(proposal?.letterContent));

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

    const reloadProposalData = useCallback(async () => {
        try {
            const res = await fetch(`/api/engineering/proposals/${proposalId}/items`, { headers: hdrs() });
            const data = await res.json();
            if (Array.isArray(data)) {
                setItems(data);
            } else if (data && data.items) {
                setItems(Array.isArray(data.items) ? data.items : []);
                if (data.bdiConfig) setBdiConfig(data.bdiConfig);
                if (data.engineeringConfig) {
                    const { cronogramaData: saved, ...engConfig } = data.engineeringConfig;
                    setEngineeringConfig(engConfig);
                    if (saved) setCronogramaData(saved);
                }
            }
        } catch (e) {
            console.error('[Wizard] Error reloading proposal data:', e);
        }
    }, [proposalId]);

    // ══════════════════════════════════════════
    // SAVE
    // ══════════════════════════════════════════
    // FIX STAB: Track previous item count for save validation
    const prevItemCountRef = useRef(0);
    useEffect(() => { if (items.length > 0) prevItemCountRef.current = items.length; }, [items.length]);

    const handleSave = async (updatedConfig?: EngineeringConfig) => {
        setIsSaving(true); setSaveMsg(null);
        try {
            const activeConfig = updatedConfig || engineeringConfig;

            // FIX STAB: Validate payload before saving
            const validation = validateSavePayload(items, prevItemCountRef.current, activeConfig, bdiConfig);
            if (!validation.valid) {
                console.warn('[Save] Blocked:', validation.errors);
                setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-danger)' }}><XCircle size={14} /> {validation.errors[0]}</span>);
                return;
            }
            if (validation.warnings.length > 0) {
                console.warn('[Save] Warnings:', validation.warnings);
            }

            const bdiConfigToSave = { ...bdiConfig, bdiGlobal: effectiveBdi };
            const itemsToSave = ensureClientIds(recalcAll(validation.sanitized, effectiveBdi, activeConfig));
            setItems(itemsToSave);
            const res = await fetch(`/api/engineering/proposals/${proposalId}/items`, {
                method: 'POST', headers: hdrs(),
                body: JSON.stringify({ items: itemsToSave, bdiConfig: bdiConfigToSave, engineeringConfig: activeConfig, cronogramaData })
            });
            if (res.ok) {
                const d = await res.json();
                if (d.items && Array.isArray(d.items)) {
                    setItems(d.items);
                }
                setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-success)' }}><CheckCircle2 size={14} /> {d.message}</span>);
                setHasUnsavedChanges(false);
                prevItemCountRef.current = (d.items || itemsToSave).length;
            } else {
                setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-danger)' }}><XCircle size={14} /> Erro ao salvar</span>);
            }
        } catch {
            setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-danger)' }}><XCircle size={14} /> Erro de rede</span>);
        } finally { setIsSaving(false); setTimeout(() => setSaveMsg(null), 4000); }
    };

    // ══════════════════════════════════════════
    // FIX STAB: AUTO-SAVE via dedicated hook (15s debounce, with validation)
    // ══════════════════════════════════════════
    const isAnyAIRunning = isExtractingBdi || isExtractingConfig || isExtractingEncargos || isAuditing;

    const getAutoSavePayload = useCallback(() => ({
        items, bdiConfig, effectiveBdi, engineeringConfig, cronogramaData,
    }), [items, bdiConfig, effectiveBdi, engineeringConfig, cronogramaData]);

    const { isAutoSaving, lastSavedAt } = useAutoSave({
        proposalId,
        debounceMs: 15000,
        isBlocked: isAnyAIRunning || isSaving,
        hasUnsavedChanges,
        getPayload: getAutoSavePayload,
        recalcAll,
        ensureClientIds,
        onSaveSuccess: () => setHasUnsavedChanges(false),
    });

    // FIX STAB/SYNC-01: Reactive sync between items and cronogramaData
    // Uses unified cronogramaSync instead of inline duplicated logic
    useEffect(() => {
        if (items.length === 0) return;

        setCronogramaData(prev => {
            if (!prev) return prev;
            const { etapas: updated, changed } = syncCronogramaFromItems(items, prev.etapas || []);
            if (changed) {
                setTimeout(() => setHasUnsavedChanges(true), 0);
                return { meses: prev.meses, etapas: updated };
            }
            return prev;
        });
    }, [items]);

    // Warn on page leave
    useEffect(() => {
        const handler = (e: BeforeUnloadEvent) => { if (hasUnsavedChanges) e.preventDefault(); };
        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, [hasUnsavedChanges]);

    // ══════════════════════════════════════════
    // FIX F1.3: Cronograma Result for BudgetDocsPanel
    // ══════════════════════════════════════════
    const cronogramaResult: CronogramaResult | null = useMemo(() => {
        if (!cronogramaData || !cronogramaData.etapas || cronogramaData.etapas.length === 0) return null;
        return calcularCronograma(cronogramaData.etapas, cronogramaData.meses);
    }, [cronogramaData]);

    // FIX F1.3: Fetch insumos consolidados when items change (for BudgetDocsPanel)
    // FIX F4: Invalidar insumos quando itens relevantes mudam (hash-based)
    const insumosHashRef = useRef<string>('');
    const insumosDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
        if (items.length === 0) return;

        const itemsHash = buildInsumosItemsHash(items);
        if (itemsHash === insumosHashRef.current) return;
        insumosHashRef.current = itemsHash;

        // Debounce: evita re-fetch em edições rápidas
        if (insumosDebounceRef.current) clearTimeout(insumosDebounceRef.current);
        insumosDebounceRef.current = setTimeout(async () => {
            try {
                const billable = items.filter(it => it.type !== 'ETAPA' && it.type !== 'SUBETAPA');
                const payload = billable.map(it => ({ code: it.code, quantity: it.quantity, sourceName: it.sourceName }));
                if (payload.length === 0) return;

                const res = await fetch('/api/engineering/insumos-hub-resolve', {
                    method: 'POST', headers: hdrs(),
                    body: JSON.stringify({ items: payload, proposalId }),
                });
                const data = await res.json();
                if (data.insumos && data.insumos.length > 0) {
                    setConsolidatedInsumos(data.insumos);
                }
            } catch (e) {
                console.error('[Wizard] Insumo consolidation for BudgetDocsPanel failed:', e);
            }
        }, 3000); // 3s debounce — insumos são para relatório, não precisam ser real-time

        return () => { if (insumosDebounceRef.current) clearTimeout(insumosDebounceRef.current); };
    }, [items]);

    // ══════════════════════════════════════════
    // BDI EXTRACTION
    // ══════════════════════════════════════════
    const handleExtractBdi = async () => {
        setIsExtractingBdi(true);
        try {
            const res = await fetch('/api/engineering/ai-extract-bdi', {
                method: 'POST', headers: hdrs(), body: JSON.stringify({ biddingId, target: 'SERVICOS' })
            });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Erro');
            const result = await res.json();
            if (result.data?.tcu) {
                const rawTcu = result.data.tcu;
                // Handle legacy 'tributos' field → split into pis/cofins/iss
                if (rawTcu.tributos != null && rawTcu.pis == null) {
                    const total = rawTcu.tributos;
                    rawTcu.pis = 0.65;
                    rawTcu.cofins = 3.00;
                    rawTcu.iss = Math.max(0, total - 0.65 - 3.00);
                    delete rawTcu.tributos;
                }
                const tcu = { ...bdiConfig.tcu, ...rawTcu };
                setBdiConfig(prev => ({ ...prev, mode: 'TCU', tcu, bdiGlobal: calculateBdiTCU(tcu, engineeringConfig.precision) }));
                // Store AI-extracted reference for Match badges
                setEngineeringConfig(prev => ({ ...prev, _aiExtractedBdi: { ...rawTcu, globalBdi: result.data.globalBdi || calculateBdiTCU(tcu, engineeringConfig.precision) } }));
                setHasUnsavedChanges(true);
            } else if (result.data?.globalBdi) {
                setBdiConfig(prev => ({ ...prev, mode: 'SIMPLIFICADO', bdiGlobal: result.data.globalBdi, tcu: autoDistributeBdi(result.data.globalBdi) }));
                // Store only globalBdi reference (no composition detail)
                setEngineeringConfig(prev => ({ ...prev, _aiExtractedBdi: { globalBdi: result.data.globalBdi } }));
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
                body: JSON.stringify({ items, engineeringConfig, proposalId }),
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

    // Extract Config via IA
    const handleExtractConfig = async () => {
        setIsExtractingConfig(true);
        try {
            const res = await fetch('/api/engineering/ai-extract-config', {
                method: 'POST', headers: hdrs(), body: JSON.stringify({ biddingId })
            });
            if (!res.ok) { alert('Erro ao extrair configurações: ' + (await res.json().catch(() => ({}))).error); return; }
            const result = await res.json();
            if (result.found) {
                const d = result.data || result;
                const updates: Partial<EngineeringConfig> = {};
                if (d.objeto) updates.objeto = d.objeto;
                if (d.uf) updates.ufReferencia = d.uf;
                if (Array.isArray(d.bases) && d.bases.length > 0) updates.basesConsideradas = d.bases;
                if (d.dataBase) updates.dataBase = d.dataBase;
                // Map per-source data bases
                if (d.dataBasesPorFonte && typeof d.dataBasesPorFonte === 'object') {
                    updates.dataBases = d.dataBasesPorFonte;
                    // Use first available as global fallback
                    if (!d.dataBase) {
                        const firstDate = Object.values(d.dataBasesPorFonte)[0];
                        if (firstDate) updates.dataBase = firstDate as string;
                    }
                }
                if (d.regime === 'ONERADO' || d.regime === 'DESONERADO') updates.regimeOneracao = d.regime;
                // P1: Store AI-extracted snapshot for consistency badges
                (updates as any)._aiExtractedRef = {
                    objeto: d.objeto || undefined,
                    ufReferencia: d.uf || undefined,
                    regimeOneracao: d.regime || undefined,
                    dataBase: d.dataBase || undefined,
                    dataBases: d.dataBasesPorFonte || undefined,
                    basesConsideradas: Array.isArray(d.bases) ? d.bases : undefined,
                };
                setEngineeringConfig(prev => ({ ...prev, ...updates }));
                setHasUnsavedChanges(true);
                setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-success)' }}><CheckCircle2 size={14} /> Configurações extraídas com sucesso</span>);
                setTimeout(() => setSaveMsg(null), 4000);
            } else {
                alert(result.message || 'Configurações não encontradas no edital.');
            }
        } catch (e: any) { alert('Erro: ' + e.message); console.error(e); }
        finally { setIsExtractingConfig(false); }
    };

    // Extract Encargos Sociais via IA
    const handleExtractEncargos = async () => {
        setIsExtractingEncargos(true);
        try {
            const res = await fetch('/api/engineering/ai-extract-encargos', {
                method: 'POST', headers: hdrs(), body: JSON.stringify({ biddingId })
            });
            if (!res.ok) { 
                const errJson = await res.json().catch(() => ({}));
                alert('Erro ao extrair encargos: ' + errJson.error + (errJson.details ? ' - ' + errJson.details : '')); 
                return; 
            }
            const result = await res.json();
            if (result.found) {
                const d = result.data || result;
                // P2: Apply user's precision config to all individual values.
                // Raw AI values are preserved in _aiExtractedEncargos for faithful badge comparison.
                const pr = (v: number) => applyPrecision(v, { precision: engineeringConfig.precision });
                const rawEncargos: any = {
                    horista: d.totalHorista || 0,
                    mensalista: d.totalMensalista || 0,
                    basePrincipal: d.basePrincipal || null,
                    grupoA_horista: d.grupoA_horista || 0, grupoA_mensalista: d.grupoA_mensalista || 0,
                    grupoB_horista: d.grupoB_horista || 0, grupoB_mensalista: d.grupoB_mensalista || 0,
                    grupoC_horista: d.grupoC_horista || 0, grupoC_mensalista: d.grupoC_mensalista || 0,
                    grupoD_horista: d.grupoD_horista || 0, grupoD_mensalista: d.grupoD_mensalista || 0,
                    a1_h: d.a1_h || 0, a1_m: d.a1_m || 0, a2_h: d.a2_h || 0, a2_m: d.a2_m || 0,
                    a3_h: d.a3_h || 0, a3_m: d.a3_m || 0, a4_h: d.a4_h || 0, a4_m: d.a4_m || 0,
                    a5_h: d.a5_h || 0, a5_m: d.a5_m || 0, a6_h: d.a6_h || 0, a6_m: d.a6_m || 0,
                    a7_h: d.a7_h || 0, a7_m: d.a7_m || 0, a8_h: d.a8_h || 0, a8_m: d.a8_m || 0,
                    a9_h: d.a9_h || 0, a9_m: d.a9_m || 0,
                    b1_h: d.b1_h || 0, b1_m: d.b1_m || 0, b2_h: d.b2_h || 0, b2_m: d.b2_m || 0,
                    b3_h: d.b3_h || 0, b3_m: d.b3_m || 0, b4_h: d.b4_h || 0, b4_m: d.b4_m || 0,
                    b5_h: d.b5_h || 0, b5_m: d.b5_m || 0, b6_h: d.b6_h || 0, b6_m: d.b6_m || 0,
                    b7_h: d.b7_h || 0, b7_m: d.b7_m || 0, b8_h: d.b8_h || 0, b8_m: d.b8_m || 0,
                    b9_h: d.b9_h || 0, b9_m: d.b9_m || 0, b10_h: d.b10_h || 0, b10_m: d.b10_m || 0,
                    c1_h: d.c1_h || 0, c1_m: d.c1_m || 0, c2_h: d.c2_h || 0, c2_m: d.c2_m || 0,
                    c3_h: d.c3_h || 0, c3_m: d.c3_m || 0, c4_h: d.c4_h || 0, c4_m: d.c4_m || 0,
                    c5_h: d.c5_h || 0, c5_m: d.c5_m || 0,
                    d1_h: d.d1_h || 0, d1_m: d.d1_m || 0, d2_h: d.d2_h || 0, d2_m: d.d2_m || 0,
                };
                // Working copy: apply precision to all numeric fields
                const encargosUpdate: any = {
                    ...engineeringConfig.encargosSociais,
                    basePrincipal: rawEncargos.basePrincipal,
                };
                for (const [k, v] of Object.entries(rawEncargos)) {
                    if (typeof v === 'number') encargosUpdate[k] = pr(v);
                    else encargosUpdate[k] = v;
                }
                // Use AI totals if they differ from sum (AI may have its own rounding)
                encargosUpdate.horista = pr(d.totalHorista || encargosUpdate.horista || engineeringConfig.encargosSociais.horista);
                encargosUpdate.mensalista = pr(d.totalMensalista || encargosUpdate.mensalista || engineeringConfig.encargosSociais.mensalista);
                // P4: Auto-populate additional encargos tables if backend detected multiple
                let rawAdicionais: any[] = [];
                if (result.additional && Array.isArray(result.additional) && result.additional.length > 0) {
                    const adicionalSheets = result.additional.map((extra: any) => {
                        const sheet: any = { label: extra.basePrincipal || 'Base Adicional', horista: pr(extra.totalHorista || 0), mensalista: pr(extra.totalMensalista || 0) };
                        const rawSheet: any = { ...extra, horista: extra.totalHorista || 0, mensalista: extra.totalMensalista || 0 }; // raw for badge comparison — alias totalHorista→horista
                        // Copy all 52 individual fields with precision
                        for (const [k, v] of Object.entries(extra)) {
                            if (typeof v === 'number' && k !== 'totalHorista' && k !== 'totalMensalista') sheet[k] = pr(v as number);
                            else if (typeof v === 'string') sheet[k] = v;
                        }
                        rawAdicionais.push(rawSheet);
                        return sheet;
                    });
                    encargosUpdate.encargosAdicionais = [...(engineeringConfig.encargosSociais?.encargosAdicionais || []), ...adicionalSheets];
                }
                // _aiExtractedEncargos: raw values (no precision) for faithful badge comparison
                setEngineeringConfig(prev => ({ 
                    ...prev, 
                    encargosSociais: encargosUpdate, 
                    _aiExtractedEncargos: { ...rawEncargos },
                    _aiExtractedEncargosAdicionais: rawAdicionais.length > 0 ? rawAdicionais : (prev as any)._aiExtractedEncargosAdicionais || [],
                }));
                setHasUnsavedChanges(true);
                const extraCount = result.additional?.length || 0;
                const extraMsg = extraCount > 0 ? ` + ${extraCount} planilha(s) adicional(is)` : '';
                setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-success)' }}><CheckCircle2 size={14} /> Encargos extraídos com sucesso ({d.basePrincipal || 'geral'}){extraMsg}</span>);
                setTimeout(() => setSaveMsg(null), 4000);
            } else {
                alert(result.message || 'Encargos sociais não encontrados no edital.');
            }
        } catch (e: any) { alert('Erro: ' + e.message); console.error(e); }
        finally { setIsExtractingEncargos(false); }
    };

    // Extract BDI Diferenciado (Fornecimento) via IA — reuses BDI endpoint
    const handleExtractBdiFornecimento = async () => {
        setIsExtractingBdi(true);
        try {
            const res = await fetch('/api/engineering/ai-extract-bdi', {
                method: 'POST', headers: hdrs(), body: JSON.stringify({ biddingId, target: 'FORNECIMENTO' })
            });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Erro');
            const result = await res.json();
            if (result.data?.tcuFornecimento) {
                const rawTcu = result.data.tcuFornecimento;
                if (rawTcu.tributos != null && rawTcu.pis == null) {
                    const total = rawTcu.tributos;
                    rawTcu.pis = 0.65;
                    rawTcu.cofins = 3.00;
                    rawTcu.iss = Math.max(0, total - 0.65 - 3.00);
                    delete rawTcu.tributos;
                }
                handleBdiChange({ ...bdiConfig, tcuFornecimento: rawTcu });
                const calcBdi = calculateBdiTCU(rawTcu, engineeringConfig.precision);
                handleConfigChange({ ...engineeringConfig, bdiFornecimento: calcBdi, bdiDiferenciado: true });
            } else if (result.data?.globalBdiFornecimento) {
                handleConfigChange({ ...engineeringConfig, bdiFornecimento: result.data.globalBdiFornecimento, bdiDiferenciado: true });
            } else if (result.data?.globalBdi) {
                handleConfigChange({ ...engineeringConfig, bdiFornecimento: result.data.globalBdi, bdiDiferenciado: true });
            }
        } catch (e) { console.error(e); }
        finally { setIsExtractingBdi(false); }
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
                    {/* FIX STAB: Auto-save indicator */}
                    {isAutoSaving && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', color: 'var(--color-text-tertiary)', fontWeight: 500 }}>
                            <Loader2 size={12} className="spin" /> Salvando...
                        </span>
                    )}
                    {!isAutoSaving && lastSavedAt && !saveMsg && (
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.72rem', color: 'var(--color-text-tertiary)', fontWeight: 500, opacity: 0.7 }}>
                            <Clock size={11} /> Salvo às {lastSavedAt}
                        </span>
                    )}
                    {saveMsg && <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>{saveMsg}</span>}
                    <button className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 6, position: 'relative' }} onClick={() => handleSave()} disabled={isSaving}>
                        {isSaving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
                        {isSaving ? 'Salvando...' : 'Salvar'}
                        {hasUnsavedChanges && !isSaving && (
                            <span style={{ position: 'absolute', top: -3, right: -3, width: 8, height: 8, borderRadius: '50%', background: '#f59e0b', border: '2px solid var(--color-bg-surface)', animation: 'pulse 2s infinite' }} title="Alterações não salvas" />
                        )}
                    </button>
                </div>
            </div>

            {/* Stepper — FIX STAB: Intercept step change for unsaved changes prompt */}
            <StepperBar steps={steps} currentStep={currentStep} onStepClick={(step) => {
                if (hasUnsavedChanges && step !== currentStep) {
                    setPendingStep(step);
                } else {
                    setCurrentStep(step);
                }
            }} />

            {/* FIX STAB: Unsaved Changes Modal */}
            {pendingStep !== null && (
                <UnsavedChangesModal
                    targetStepLabel={steps[pendingStep - 1]?.label}
                    isSaving={isSaving}
                    onSaveAndContinue={async () => {
                        await handleSave();
                        setCurrentStep(pendingStep);
                        setPendingStep(null);
                    }}
                    onDiscard={() => {
                        setHasUnsavedChanges(false);
                        setCurrentStep(pendingStep);
                        setPendingStep(null);
                    }}
                    onCancel={() => setPendingStep(null)}
                />
            )}

            {/* Step Content */}
            {currentStep === 1 && (
                <Step1ConfigPanel
                    engineeringConfig={engineeringConfig}
                    bdiConfig={bdiConfig}
                    isExtractingBdi={isExtractingBdi}
                    isExtractingConfig={isExtractingConfig}
                    isExtractingEncargos={isExtractingEncargos}
                    isAuditing={isAuditing}
                    isSaving={isSaving}
                    onConfigChange={handleConfigChange}
                    onBdiChange={handleBdiChange}
                    onExtractBdi={handleExtractBdi}
                    onExtractBdiFornecimento={handleExtractBdiFornecimento}
                    onExtractConfig={handleExtractConfig}
                    onExtractEncargos={handleExtractEncargos}
                    onSyncBases={syncBases}
                    onSave={handleSave}
                    onNext={() => setCurrentStep(2)}
                    setHasUnsavedChanges={setHasUnsavedChanges}
                    saveMsg={saveMsg}
                    setSaveMsg={setSaveMsg}
                />
            )}

            {/* Step 2: Budget Editor — LAZY MOUNTED to avoid heavy initialization on Step 1.
                PERF-02: Previously always-mounted (display:none/block), which forced the 2020-line
                EngineeringProposalEditor + DnD + XLSX to initialize immediately. Now only mounts
                when user navigates to Step 2, saving ~200ms of initial render time. */}
            {currentStep === 2 && (
                <Step2BudgetEditor
                    proposalId={proposalId}
                    biddingId={biddingId}
                    engineeringConfig={engineeringConfig}
                    bdiConfig={bdiConfig}
                    items={items}
                    onItemsChange={setItems}
                    onUnsavedChanges={() => setHasUnsavedChanges(true)}
                    estimatedValue={estimatedValue}
                    onPrev={() => setCurrentStep(1)}
                    onNext={() => setCurrentStep(3)}
                    onReloadProposal={reloadProposalData}
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
                    onSaveProposal={handleSave}
                    onLetterSaved={() => setIsLetterSaved(true)}
                />
            )}

            {/* Step 5: Exportação — FIX F1.3: agora com insumos reais e cronograma */}
            {currentStep === 5 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>

                    {/* FIX F5.2: Validation Checklist */}
                    {(() => {
                        const billable = items.filter(it => !isGrouper(it.type));
                        const checks = [
                            { label: 'Itens na planilha', ok: billable.length > 0, blocker: billable.length === 0, detail: billable.length > 0 ? `${billable.length} itens` : 'Nenhum item' },
                            { label: 'BDI configurado', ok: effectiveBdi > 0, blocker: false, detail: effectiveBdi > 0 ? `${effectiveBdi.toFixed(2)}%` : '0%' },
                            { label: 'Preços unitários', ok: billable.every(it => it.unitCost > 0), blocker: false, detail: (() => { const z = billable.filter(it => it.unitCost <= 0).length; return z > 0 ? `${z} sem preço` : 'Todos preenchidos'; })() },
                            { label: 'Encargos Sociais', ok: (engineeringConfig.encargosSociais?.horista || 0) > 0, blocker: false, detail: (engineeringConfig.encargosSociais?.horista || 0) > 0 ? `H: ${engineeringConfig.encargosSociais?.horista?.toFixed(1)}% / M: ${engineeringConfig.encargosSociais?.mensalista?.toFixed(1)}%` : 'Não configurado' },
                            { label: 'Carta Proposta', ok: isLetterSaved, blocker: false, detail: isLetterSaved ? 'Salva' : 'Não gerada' },
                            { label: 'Cronograma', ok: !!(cronogramaData && cronogramaData.etapas.some((e: any) => e.percentuais.some((p: number) => p > 0))), blocker: false, detail: cronogramaData?.etapas?.some((e: any) => e.percentuais.some((p: number) => p > 0)) ? `${cronogramaData.meses} meses` : 'Vazio' },
                        ];
                        const hasBlocker = checks.some(c => c.blocker);
                        return (
                            <div style={{ background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', padding: '14px 18px' }}>
                                <div style={{ fontSize: '0.72rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-tertiary)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                                    {hasBlocker ? <XCircle size={13} /> : <CheckCircle2 size={13} />} Checklist Pré-Exportação
                                </div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                    {checks.map(c => (
                                        <div key={c.label} style={{
                                            display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
                                            borderRadius: 'var(--radius-md)', fontSize: '0.76rem', fontWeight: 600,
                                            background: c.blocker ? 'rgba(239,68,68,0.08)' : c.ok ? 'rgba(34,197,94,0.06)' : 'rgba(245,158,11,0.08)',
                                            color: c.blocker ? '#dc2626' : c.ok ? '#059669' : '#d97706',
                                            border: `1px solid ${c.blocker ? 'rgba(239,68,68,0.2)' : c.ok ? 'rgba(34,197,94,0.15)' : 'rgba(245,158,11,0.2)'}`,
                                        }}>
                                            <span>{c.blocker ? <XCircle size={12} /> : c.ok ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}</span>
                                            <span>{c.label}</span>
                                            <span style={{ fontSize: '0.65rem', opacity: 0.7 }}>({c.detail})</span>
                                        </div>
                                    ))}
                                </div>
                                {hasBlocker && (
                                    <div style={{ marginTop: 8, fontSize: '0.75rem', color: '#dc2626', fontWeight: 600 }}>
                                        <AlertTriangle size={13} style={{display:'inline',verticalAlign:-2,marginRight:4}} /> Corrija os erros críticos antes de exportar.
                                    </div>
                                )}
                            </div>
                        );
                    })()}

                    <BudgetDocsPanel
                        items={items}
                        bdiConfig={bdiConfig}
                        effectiveBdi={effectiveBdi}
                        insumos={consolidatedInsumos}
                        cronogramaResult={cronogramaResult}
                        proposalId={proposalId}
                        engineeringConfig={engineeringConfig}
                        proposal={proposal}
                        company={company}
                        bidding={bidding}
                        onConfigChange={(newConfig) => { setEngineeringConfig(newConfig); setHasUnsavedChanges(true); }}
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
