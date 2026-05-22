import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Calculator, Plus, Save, Trash2, Cpu, TableProperties, Download, Upload, Search, X, Loader2, Layers, BarChart3, Calendar, Package, FolderOpen, GitBranch, Wrench, ChevronDown, ChevronRight, Database, CheckCircle2, XCircle, AlertTriangle, AlertCircle, Split, GripVertical, RefreshCw, Wand2, Undo2, Redo2, StickyNote, Settings, Image } from 'lucide-react';
import { useUndoRedo } from './useUndoRedo';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { calculateBdiTCU, applyBdi, DEFAULT_BDI_CONFIG, TCU_REFERENCE_RANGES, autoDistributeBdi, type BdiConfig, type BdiTcuParams } from './bdiEngine';
import { CompositionDrawer } from './CompositionDrawer';
import { CompositionEditor } from './CompositionEditor';
import { CurvaAbcPanel } from './CurvaAbcPanel';
import { CronogramaPanel } from './CronogramaPanel';
import { InsumoHub } from './InsumoHub';
import { BudgetDocsPanel } from './BudgetDocsPanel';
import { applyPrecision } from './precisionEngine';
import { calcularCronograma } from './cronogramaEngine';
import type { InsumoConsolidado } from './insumoEngine';
import type { EngItem, EngItemType, EngineeringConfig, BdiCategoria, PriceAudit } from './types';
import { isGrouper, getDepth, DEFAULT_ENGINEERING_CONFIG } from './types';
import * as XLSX from 'xlsx';
import { ImageBudgetImportModal } from './ImageBudgetImportModal';

// ── Renumeração hierárquica automática ──
function renumberItems(items: EngItem[]): EngItem[] {
    let etapaIdx = 0;
    let subetapaIdx = 0;
    let itemIdx = 0;
    let currentEtapa = 0;
    let currentSubetapa = 0;

    return items.map(it => {
        if (it.type === 'ETAPA') {
            etapaIdx++;
            subetapaIdx = 0;
            itemIdx = 0;
            currentEtapa = etapaIdx;
            currentSubetapa = 0;
            return { ...it, itemNumber: `${etapaIdx}.0` };
        }
        if (it.type === 'SUBETAPA') {
            subetapaIdx++;
            itemIdx = 0;
            currentSubetapa = subetapaIdx;
            return { ...it, itemNumber: `${currentEtapa || 1}.${subetapaIdx}` };
        }
        // COMPOSICAO / INSUMO
        itemIdx++;
        if (currentSubetapa > 0) {
            return { ...it, itemNumber: `${currentEtapa || 1}.${currentSubetapa}.${itemIdx}` };
        }
        if (currentEtapa > 0) {
            return { ...it, itemNumber: `${currentEtapa}.${itemIdx}` };
        }
        return { ...it, itemNumber: String(itemIdx) };
    });
}

const TYPE_META: Record<EngItemType, { label: string; color: string; bg: string; icon: typeof FolderOpen }> = {
    ETAPA:      { label: 'Etapa',       color: '#1e40af', bg: 'rgba(30,64,175,0.08)',  icon: FolderOpen },
    SUBETAPA:   { label: 'Subetapa',    color: '#6d28d9', bg: 'rgba(109,40,217,0.06)', icon: GitBranch },
    COMPOSICAO: { label: 'Composição',  color: '#0e7490', bg: 'rgba(14,116,144,0.06)', icon: Layers },
    INSUMO:     { label: 'Insumo',      color: '#b45309', bg: 'rgba(180,83,9,0.06)',   icon: Package },
};

const BRAZILIAN_UFS = [
    'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT',
    'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
];

/** Computes the subtotal for a grouper (ETAPA/SUBETAPA) by summing
 * totalPrice of all child items until the next grouper of same/higher depth. */
function computeGrouperSubtotal(items: EngItem[], grouperIndex: number): number {
    const grouper = items[grouperIndex];
    const grouperDepth = getDepth(grouper.itemNumber);
    let total = 0;
    for (let i = grouperIndex + 1; i < items.length; i++) {
        const it = items[i];
        if (isGrouper(it.type) && getDepth(it.itemNumber) <= grouperDepth) break; // Next grouper of same/higher level
        if (!isGrouper(it.type)) total += it.totalPrice || 0;
    }
    return total;
}

interface Props {
    proposalId: string;
    biddingId: string;
    /** Config from the Wizard (Step 1) — used for the dashboard sidebar */
    wizardConfig?: EngineeringConfig;
    /** BDI config from the Wizard (Step 1) */
    wizardBdiConfig?: BdiConfig;
    /** Callback: sync items back to the Wizard for other steps (Cronograma, etc.) */
    onItemsChange?: (items: EngItem[]) => void;
    /** FIX STEP2-01: Items from the Wizard state — used to restore items when Step 2 remounts */
    wizardItems?: EngItem[];
    /** FIX F2.3: Estimated value from the bidding for comparison */
    estimatedValue?: number;
}

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const token = () => localStorage.getItem('token') || '';
const hdrs = () => ({ 'Authorization': `Bearer ${token()}`, 'Content-Type': 'application/json' });
const hasPositiveNumber = (value: unknown) => Number.isFinite(Number(value)) && Number(value) > 0;

function parseLocaleNumber(value: unknown, fallback = 0): number {
    if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
    const raw = String(value ?? '').trim();
    if (!raw) return fallback;
    const normalized = raw.includes(',')
        ? raw.replace(/\./g, '').replace(',', '.')
        : raw;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function hasEditalPriceSnapshot(item: EngItem): boolean {
    return item.priceOrigin === 'EDITAL'
        && !isGrouper(item.type)
        && (hasPositiveNumber(item.officialUnitPrice) || hasPositiveNumber(item.officialTotalPrice));
}

/**
 * Bases that use version-based identification instead of monthly data-base cadence.
 * SEINFRA uses 028 (Onerada) / 028.1 (Desonerada) — no monthly reference.
 * This affects: dropdown labels, Step 1 date config, and base filtering.
 */
const VERSION_BASED_BASES = ['SEINFRA', 'SICRO', 'SBC'];

function isVersionBasedBase(name: string): boolean {
    return VERSION_BASED_BASES.some(vb => name.toUpperCase().includes(vb));
}

/**
 * STRICT base filter — enforces Step 1 config as absolute rule.
 * Bases are shown ONLY if they match ALL criteria:
 *   1. Name matches basesConsideradas (SINAPI, SEINFRA, ORSE, PROPRIA)
 *   2. UF matches ufReferencia (or base has no UF, like PROPRIA)
 *   3. Data-base (month/year) matches the configured date for that base
 *
 * Returns { filtered, warnings } where warnings lists configured bases
 * that were not found in the system.
 */
function filterConfigBases(allBases: any[], config: any): any[] {
    return filterConfigBasesWithWarnings(allBases, config).filtered;
}

interface BaseFilterResult {
    filtered: any[];
    warnings: string[];
}

function filterConfigBasesWithWarnings(allBases: any[], config: any): BaseFilterResult {
    if (!allBases || allBases.length === 0) return { filtered: [], warnings: ['Nenhuma base cadastrada no sistema.'] };

    const allowed: string[] = config?.basesConsideradas || [];
    const uf: string = (config?.ufReferencia || '').toUpperCase();
    const perBaseDates: Record<string, string> = config?.dataBases || {};

    // Regime de encargos: ONERADO → payrollExemption=false, DESONERADO → payrollExemption=true
    const regime: string = (config?.regimeOneracao || 'ONERADO').toUpperCase();
    const targetPayrollExemption = regime === 'DESONERADO';

    // If no bases configured, show nothing (strict mode)
    if (allowed.length === 0) {
        return { filtered: allBases, warnings: [] };
    }

    const result: any[] = [];
    const warnings: string[] = [];

    for (const baseName of allowed) {
        const upperName = baseName.toUpperCase();

        // PROPRIA is special — always include tenant's own base
        if (upperName === 'PROPRIA' || upperName === 'PRÓPRIA') {
            const propria = allBases.filter(b =>
                b.name.toUpperCase().includes('PROPRIA') || b.name.toUpperCase().includes('PRÓPRIA')
            );
            if (propria.length > 0) {
                result.push(...propria);
            } else {
                warnings.push(`Base "${baseName}" não encontrada no sistema.`);
            }
            continue;
        }

        // Version-based bases (SEINFRA, SICRO, SBC) use version identifiers, not monthly dates.
        // NEVER apply date filtering to these bases, even if dataBases has stale AI-extracted entries.
        const isVersionBased = VERSION_BASED_BASES.some(vb => upperName.includes(vb));
        const hasExplicitDate = !isVersionBased && !!perBaseDates[baseName];
        const targetDate = hasExplicitDate ? (perBaseDates[baseName] || '') : '';
        let targetMonth = 0;
        let targetYear = 0;
        if (targetDate) {
            const [y, m] = targetDate.split('-').map(Number);
            if (y && m) { targetYear = y; targetMonth = m; }
        }

        const hasSameNameWithMatchingUf = allBases.some(b =>
            b.name.toUpperCase().includes(upperName) && b.uf && b.uf.toUpperCase() === uf
        );

        // Step 1: Try strict match (name + UF + date + regime)
        let candidates = allBases.filter(b => {
            if (!b.name.toUpperCase().includes(upperName)) return false;
            if (hasSameNameWithMatchingUf && b.uf && b.uf.toUpperCase() !== uf) return false;
            if (hasExplicitDate && targetYear && targetMonth) {
                if (b.referenceYear !== targetYear || b.referenceMonth !== targetMonth) return false;
            }
            if (typeof b.payrollExemption === 'boolean') {
                if (b.payrollExemption !== targetPayrollExemption) return false;
            }
            return true;
        });

        // Step 2: If strict match found no results, relax regime filter.
        // Many regional bases (ORSE, CAERN, SBC) only have one import (onerado OR desonerado),
        // not both versions. Showing the available version is better than showing nothing.
        if (candidates.length === 0) {
            candidates = allBases.filter(b => {
                if (!b.name.toUpperCase().includes(upperName)) return false;
                if (hasSameNameWithMatchingUf && b.uf && b.uf.toUpperCase() !== uf) return false;
                if (hasExplicitDate && targetYear && targetMonth) {
                    if (b.referenceYear !== targetYear || b.referenceMonth !== targetMonth) return false;
                }
                // Skip regime filter in this relaxed pass
                return true;
            });
        }

        // Step 3: If still no results AND we were filtering by explicit date, try without date too.
        // This catches cases where the configured date hasn't been imported yet.
        if (candidates.length === 0 && hasExplicitDate) {
            candidates = allBases.filter(b => {
                if (!b.name.toUpperCase().includes(upperName)) return false;
                if (hasSameNameWithMatchingUf && b.uf && b.uf.toUpperCase() !== uf) return false;
                return true;
            });
            if (candidates.length > 0) {
                const datePart = targetYear && targetMonth ? ` ${String(targetMonth).padStart(2, '0')}/${targetYear}` : '';
                const ufPart = uf ? ` ${uf}` : '';
                warnings.push(`Base "${baseName}${ufPart}${datePart}" não encontrada. Exibindo versão mais recente disponível.`);
            }
        }

        if (candidates.length > 0) {
            candidates.sort((a: any, b: any) => {
                // Prefer matching regime
                const aRegime = typeof a.payrollExemption === 'boolean' && a.payrollExemption === targetPayrollExemption ? 1 : 0;
                const bRegime = typeof b.payrollExemption === 'boolean' && b.payrollExemption === targetPayrollExemption ? 1 : 0;
                if (bRegime !== aRegime) return bRegime - aRegime;
                // Then prefer bases with data
                const aHasData = ((a.itemCount || 0) + (a.compositionCount || 0)) > 0 ? 1 : 0;
                const bHasData = ((b.itemCount || 0) + (b.compositionCount || 0)) > 0 ? 1 : 0;
                if (bHasData !== aHasData) return bHasData - aHasData;
                return (b.referenceYear || 0) - (a.referenceYear || 0) || (b.referenceMonth || 0) - (a.referenceMonth || 0);
            });
            // If no explicit date, only include the most recent version to avoid duplicates
            if (!hasExplicitDate && candidates.length > 1) {
                result.push(candidates[0]);
            } else {
                result.push(...candidates);
            }
        } else {
            // Generate specific warning
            const datePart = hasExplicitDate && targetYear && targetMonth ? ` ${String(targetMonth).padStart(2, '0')}/${targetYear}` : '';
            const ufPart = uf ? ` ${uf}` : '';
            warnings.push(`Base "${baseName}${ufPart}${datePart}" não encontrada. Verifique se a base foi importada.`);
        }
    }

    return { filtered: result, warnings };
}


/**
 * Auto-select the best matching base from the filtered list.
 */
function autoSelectBestBase(allBases: any[], config: any, setSelectedBaseId: (id: string) => void) {
    const filtered = filterConfigBases(allBases, config);
    if (filtered.length > 0) {
        setSelectedBaseId(filtered[0].id);
    } else if (allBases.length > 0) {
        setSelectedBaseId(allBases[0].id);
    }

}

function preserveEditalPricing(item: EngItem, config: EngineeringConfig): EngItem {
    if (!hasEditalPriceSnapshot(item)) return item;

    const unitPrice = hasPositiveNumber(item.officialUnitPrice)
        ? Number(item.officialUnitPrice)
        : Number(item.unitPrice) || 0;
    const totalPrice = hasPositiveNumber(item.officialTotalPrice)
        ? Number(item.officialTotalPrice)
        : applyPrecision((Number(item.quantity) || 0) * unitPrice, config);

    return { ...item, unitPrice, totalPrice };
}

const AUDIT_META = {
    OK: { label: 'OK', color: 'var(--color-success)', bg: 'rgba(16,185,129,0.08)' },
    DIVERGENT: { label: 'Base difere', color: '#dc2626', bg: 'rgba(220,38,38,0.08)' },
    BASE_INCOMPATIVEL: { label: 'Base incompat.', color: '#d97706', bg: 'rgba(217,119,6,0.10)' },
    BASE_INDISPONIVEL: { label: 'Data base N/D', color: '#9333ea', bg: 'rgba(147,51,234,0.08)' },
    SEM_MATCH: { label: 'Sem match', color: '#64748b', bg: 'rgba(100,116,139,0.10)' },
} as const;

function refreshPriceAudit(item: EngItem): PriceAudit | undefined {
    const audit = item.priceAudit;
    if (!audit || typeof audit.matchedUnitCost !== 'number' || audit.matchedUnitCost <= 0) return audit;

    const extractedUnitCost = Number(item.unitCost) || 0;
    const matchedUnitCost = audit.matchedUnitCost;
    const warnings = audit.warnings || [];
    const hasRegimeMismatch = warnings.some(w => String(w).toLowerCase().includes('regime'));
    const hasDateMismatch = warnings.some(w => String(w).toLowerCase().includes('data-base'));
    const hasSimilarityMatch = warnings.some(w => String(w).toLowerCase().includes('similaridade'));
    const deltaValue = hasRegimeMismatch ? null : extractedUnitCost - matchedUnitCost;
    const deltaPercent = deltaValue !== null && matchedUnitCost > 0 ? (deltaValue / matchedUnitCost) * 100 : null;
    const hasRelevantDelta = !hasRegimeMismatch && deltaValue !== null && Math.abs(deltaValue) > 0.01;
    const isCodeExact = audit.matchMethod === 'code_exact';

    // Status logic:
    // 1. Regime mismatch → always BASE_INCOMPATIVEL (can't compare prices across regimes)
    // 2. Similarity match → always BASE_INCOMPATIVEL (needs manual review)
    // 3. Code exact + prices differ → DIVERGENT
    // 4. Code exact + prices match → OK (even with date/fonte warnings — prices confirmed)
    // 5. Code exact + date mismatch + no price comparison → BASE_INCOMPATIVEL
    let status: PriceAudit['status'];
    if (hasDateMismatch && isCodeExact) {
        // Code matched but from WRONG data-base → comparison is unreliable
        status = 'BASE_INDISPONIVEL';
    } else if (hasRegimeMismatch || hasSimilarityMatch) {
        status = 'BASE_INCOMPATIVEL';
    } else if (hasRelevantDelta) {
        status = 'DIVERGENT';
    } else if (isCodeExact && deltaPercent !== null && Math.abs(deltaPercent) < 5) {
        // Code matched exactly and prices are within 5% — this is a confirmed match
        status = 'OK';
    } else if (hasDateMismatch && !isCodeExact) {
        status = 'BASE_INDISPONIVEL';
    } else {
        status = 'OK';
    }

    return {
        ...audit,
        extractedUnitCost,
        deltaValue,
        deltaPercent,
        status,
    };
}

function renderPriceAudit(item: EngItem, onApplyBase?: () => void) {
    const audit = refreshPriceAudit(item);
    if (!audit) return <span style={{ color: 'var(--color-text-tertiary)', fontSize: '0.68rem' }}>-</span>;
    const meta = AUDIT_META[audit.status] || AUDIT_META.SEM_MATCH;
    const delta = typeof audit.deltaPercent === 'number' ? ` (${audit.deltaPercent > 0 ? '+' : ''}${audit.deltaPercent.toFixed(2)}%)` : '';
    const hasBasePrice = typeof audit.matchedUnitCost === 'number' && audit.matchedUnitCost > 0;
    const hasRegimeMismatch = (audit.warnings || []).some(w => String(w).toLowerCase().includes('regime'));
    const title = [
        'Auditoria: comparação do custo sem BDI contra base oficial.',
        audit.matchedSourceName ? `Base: ${audit.matchedSourceName} ${audit.matchedReference || ''}` : '',
        typeof audit.matchedUnitCost === 'number' ? `Preço base: ${fmt(audit.matchedUnitCost)}` : '',
        typeof audit.extractedUnitCost === 'number' ? `Custo extraído do edital: ${fmt(audit.extractedUnitCost)}` : '',
        ...(audit.warnings || []),
    ].filter(Boolean).join('\n');

    const isDataBaseUnavailable = audit.status === 'BASE_INDISPONIVEL';
    return (
        <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
            <span title={title} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 6px', borderRadius: 4, background: meta.bg, color: meta.color, fontSize: '0.64rem', fontWeight: 800, whiteSpace: 'nowrap' }}>
                {audit.status === 'OK' ? <CheckCircle2 size={11} /> : <AlertTriangle size={11} />}
                {meta.label}{isDataBaseUnavailable ? '' : delta}
            </span>
            {hasBasePrice && audit.status !== 'OK' && !hasRegimeMismatch && !isDataBaseUnavailable && (
                <button
                    type="button"
                    onClick={onApplyBase}
                    title={`Aplicar preço da base: ${fmt(audit.matchedUnitCost || 0)}`}
                    style={{ border: 'none', background: 'transparent', color: meta.color, cursor: 'pointer', fontSize: '0.6rem', fontWeight: 800, padding: 0, lineHeight: 1 }}
                >
                    usar base {fmt(audit.matchedUnitCost || 0)}
                </button>
            )}
            {isDataBaseUnavailable && (
                <span style={{ fontSize: '0.58rem', color: meta.color, fontWeight: 600, fontStyle: 'italic' }}>
                    {audit.matchedReference || 'outra data'}
                </span>
            )}
        </div>
    );
}

export function EngineeringProposalEditor({ proposalId, biddingId, wizardConfig, wizardBdiConfig, onItemsChange, wizardItems, estimatedValue }: Props) {
    // FIX F1.2: Undo/Redo integration — replaces plain useState<EngItem[]>
    // - setItems: tracked changes (user edits) → pushed to undo stack
    // - setItemsSilent: system changes (recalc, load, save) → no undo stack
    const {
        state: items,
        setState: setItems,
        setStateNoHistory: setItemsSilent,
        undo: undoItems,
        redo: redoItems,
        canUndo,
        canRedo,
        undoCount,
        redoCount,
    } = useUndoRedo<EngItem[]>(wizardItems || [], 50);
    const [bdiConfig, setBdiConfig] = useState<BdiConfig>({ ...DEFAULT_BDI_CONFIG });
    const [engineeringConfig, setEngineeringConfig] = useState<EngineeringConfig>({ ...DEFAULT_ENGINEERING_CONFIG });

    // Sync wizard config into internal state so all calculations use Step 1 values
    useEffect(() => {
        if (wizardBdiConfig) setBdiConfig(wizardBdiConfig);
    }, [wizardBdiConfig]);
    useEffect(() => {
        if (wizardConfig) setEngineeringConfig(wizardConfig);
    }, [wizardConfig]);

    // Dashboard sidebar: prefer wizard values (from Step 1) over internal state
    const dashConfig = wizardConfig || engineeringConfig;
    const dashBdi = wizardBdiConfig || bdiConfig;
    const [isSaving, setIsSaving] = useState(false);
    const [isExtracting, setIsExtracting] = useState(false);
    const [isAuditing, setIsAuditing] = useState(false);
    const [saveMsg, setSaveMsg] = useState<React.ReactNode | null>(null);
    const [extractionMeta, setExtractionMeta] = useState<any>(null);
    const [activeExtractionJobId, setActiveExtractionJobId] = useState<string | null>(null);
    const extractionPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Search modal
    const [showSearch, setShowSearch] = useState(false);
    const [bases, setBases] = useState<any[]>([]);
    const [selectedBaseId, setSelectedBaseId] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<any[]>([]);
    const [isSearching, setIsSearching] = useState(false);

    // Composition drawer
    const [compositionItem, setCompositionItem] = useState<EngItem | null>(null);
    const [compositionEditorIndex, setCompositionEditorIndex] = useState<number | null>(null);
    const [activeCalcItem, setActiveCalcItem] = useState<EngItem | null>(null);

    // Continuous AI Image Budget Import states
    const [showImageImportModal, setShowImageImportModal] = useState(false);
    const [globalDragOver, setGlobalDragOver] = useState(false);
    const [initialImportFile, setInitialImportFile] = useState<File | null>(null);

    // Global paste listener to auto-open Image extraction modal
    useEffect(() => {
        const handleGlobalPaste = (e: ClipboardEvent) => {
            const target = e.target as HTMLElement;
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
                return;
            }

            // Prevent intercepting when composition editor is open
            if (compositionEditorIndex !== null) {
                return;
            }

            const items = e.clipboardData?.items;
            if (!items) return;
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                if (item.type.indexOf('image') !== -1) {
                    const file = item.getAsFile();
                    if (file) {
                        e.preventDefault();
                        setInitialImportFile(file);
                        setShowImageImportModal(true);
                        break;
                    }
                }
            }
        };

        window.addEventListener('paste', handleGlobalPaste);
        return () => {
            window.removeEventListener('paste', handleGlobalPaste);
        };
    }, [compositionEditorIndex]);

    // Global drag-and-drop listener to auto-open Image extraction modal
    useEffect(() => {
        const handleDragOver = (e: DragEvent) => {
            e.preventDefault();
            if (compositionEditorIndex !== null) return;
            if (e.dataTransfer?.types.includes('Files')) {
                setGlobalDragOver(true);
            }
        };

        const handleDragLeave = (e: DragEvent) => {
            e.preventDefault();
            if (compositionEditorIndex !== null) return;
            if (e.clientX === 0 && e.clientY === 0) {
                setGlobalDragOver(false);
            }
        };

        const handleDrop = (e: DragEvent) => {
            e.preventDefault();
            if (compositionEditorIndex !== null) return;
            setGlobalDragOver(false);
            const files = e.dataTransfer?.files;
            if (files && files.length > 0) {
                const file = files[0];
                if (file.type.startsWith('image/')) {
                    setInitialImportFile(file);
                    setShowImageImportModal(true);
                }
            }
        };

        window.addEventListener('dragover', handleDragOver);
        window.addEventListener('dragleave', handleDragLeave);
        window.addEventListener('drop', handleDrop);

        return () => {
            window.removeEventListener('dragover', handleDragOver);
            window.removeEventListener('dragleave', handleDragLeave);
            window.removeEventListener('drop', handleDrop);
        };
    }, [compositionEditorIndex]);

    const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

    // FIX F2.1: Collapse/Expand state for ETAPA/SUBETAPA groupers
    const [collapsedGroupers, setCollapsedGroupers] = useState<Set<string>>(new Set());

    // FIX F2.2: Filter/Search state
    const [filterText, setFilterText] = useState('');
    const [filterType, setFilterType] = useState<string>('');

    const updateEngineeringConfig = (next: EngineeringConfig) => {
        setHasUnsavedChanges(true);
        setEngineeringConfig(next);
    };

    const toggleExpand = (id: string) => {
        setExpandedItems(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    // FIX F2.1: Toggle collapse for groupers
    const toggleCollapse = (id: string) => {
        setCollapsedGroupers(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };
    const collapseAll = () => {
        const ids = new Set(items.filter(it => isGrouper(it.type)).map(it => it.id));
        setCollapsedGroupers(ids);
    };
    const expandAll = () => setCollapsedGroupers(new Set());

    // FIX F2.1: Check if item is hidden because a parent grouper is collapsed
    const isItemHiddenByCollapse = useCallback((itemIndex: number): boolean => {
        for (let i = itemIndex - 1; i >= 0; i--) {
            const prev = items[i];
            if (isGrouper(prev.type)) {
                const prevDepth = getDepth(prev.itemNumber);
                const itemDepth = getDepth(items[itemIndex].itemNumber);
                if (prevDepth < itemDepth || (!isGrouper(items[itemIndex].type) && prevDepth <= itemDepth)) {
                    if (collapsedGroupers.has(prev.id)) return true;
                }
                if (prevDepth < getDepth(items[itemIndex].itemNumber)) break;
            }
        }
        return false;
    }, [items, collapsedGroupers]);

    // FIX F2.2: Filtered + visible items
    const visibleItems = useMemo(() => {
        const ft = filterText.toLowerCase().trim();
        return items.map((it, idx) => {
            // Collapse check
            if (!isGrouper(it.type) && isItemHiddenByCollapse(idx)) return { item: it, visible: false };
            // Also hide collapsed sub-groupers
            if (isGrouper(it.type) && idx > 0 && isItemHiddenByCollapse(idx)) return { item: it, visible: false };
            // Filter check
            if (ft && !it.description.toLowerCase().includes(ft) && !(it.code || '').toLowerCase().includes(ft) && !(it.itemNumber || '').includes(ft)) {
                // Keep groupers visible if they have visible children (unless filtering by type)
                if (!isGrouper(it.type)) return { item: it, visible: false };
            }
            if (filterType && it.type !== filterType && isGrouper(it.type) && filterType !== 'ETAPA' && filterType !== 'SUBETAPA') return { item: it, visible: true }; // Keep groupers
            if (filterType && it.type !== filterType && !isGrouper(it.type)) return { item: it, visible: false };
            return { item: it, visible: true };
        });
    }, [items, filterText, filterType, isItemHiddenByCollapse]);

    // Active tab
    const [activeTab, setActiveTab] = useState<'planilha' | 'hub_insumos' | 'curva_abc' | 'cronograma' | 'encargos_sociais' | 'caderno'>('planilha');
    const [showAIMenu, setShowAIMenu] = useState(false);
    const [showToolsMenu, setShowToolsMenu] = useState(false);
    const [showConfigPanel, setShowConfigPanel] = useState(false);

    // FIX ARQ-04: Cronograma data persisted in parent state to survive tab switches
    const [cronogramaData, setCronogramaData] = useState<{ meses: number; etapas: any[] } | null>(null);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

    // Consolidated insumos and cronograma results for BudgetDocsPanel
    const [consolidatedInsumos, setConsolidatedInsumos] = useState<InsumoConsolidado[]>([]);

    const cronogramaResult = useMemo(() => {
        if (!cronogramaData || !cronogramaData.etapas || cronogramaData.etapas.length === 0) return null;
        return calcularCronograma(cronogramaData.etapas, cronogramaData.meses);
    }, [cronogramaData]);

    const insumosLoadedRef = useRef(false);
    useEffect(() => {
        if (items.length === 0 || insumosLoadedRef.current) return;
        insumosLoadedRef.current = true;

        const loadInsumos = async () => {
            try {
                const payload = items
                    .filter(it => it.type !== 'ETAPA' && it.type !== 'SUBETAPA')
                    .map(it => ({ code: it.code, quantity: it.quantity, sourceName: it.sourceName }));
                if (payload.length === 0) return;

                const res = await fetch('/api/engineering/insumos-hub-resolve', {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ items: payload }),
                });
                const data = await res.json();
                if (data.insumos && data.insumos.length > 0) {
                    setConsolidatedInsumos(data.insumos);
                }
            } catch (e) {
                console.error('[Editor] Insumo consolidation failed:', e);
            }
        };
        loadInsumos();
    }, [items]);

    const effectiveBdi = bdiConfig.bdiGlobal;
    
    /** Resolve o BDI efetivo para um item (suporte a BDI diferenciado OBRA vs FORNECIMENTO) */
    const resolveItemBdi = useCallback((it: EngItem) => {
        if (!engineeringConfig.bdiDiferenciado) return effectiveBdi;
        if (it.bdiCategoria === 'FORNECIMENTO') return engineeringConfig.bdiFornecimento || 14.02;
        return effectiveBdi; // Default = OBRA
    }, [effectiveBdi, engineeringConfig.bdiDiferenciado, engineeringConfig.bdiFornecimento]);

    // FIX BUG-01: Filtra agrupadores (ETAPA/SUBETAPA) do cálculo de totais
    const billableItems = items.filter(it => !isGrouper(it.type));
    const subtotal = billableItems.reduce((s, it) => s + it.quantity * it.unitCost, 0);
    const total = billableItems.reduce((s, it) => s + it.totalPrice, 0);

    const recalcAll = useCallback((its: EngItem[], _bdi: number, config: EngineeringConfig) => {
        return its.map(it => {
            if (isGrouper(it.type)) return it;
            const audited = { ...it, priceAudit: refreshPriceAudit(it) };
            // FIX BDI-01: Sempre recalcula unitPrice = unitCost × (1+BDI/100).
            // O officialUnitPrice/officialTotalPrice são mantidos como campos de auditoria
            // para comparação, mas NUNCA congelam o preço do licitante.
            const itemBdi = config.bdiDiferenciado && audited.bdiCategoria === 'FORNECIMENTO'
                ? (config.bdiFornecimento || 14.02)
                : _bdi;
            let up = applyBdi(audited.unitCost, itemBdi, config.precision);
            // FIX F5.6: Apply per-item discount after BDI
            if (audited.discount && audited.discount > 0) {
                up = applyPrecision(up * (1 - audited.discount / 100), config);
            }
            return { ...audited, unitPrice: up, totalPrice: applyPrecision(audited.quantity * up, config) };
        });
    }, []);

    // System recalc on BDI/config change — silent (no undo tracking)
    useEffect(() => { setItemsSilent(recalcAll(items, effectiveBdi, engineeringConfig)); }, [effectiveBdi, engineeringConfig, recalcAll]); // eslint-disable-line react-hooks/exhaustive-deps

    // Sync items back to Wizard for Cronograma, Carta Proposta, etc.
    useEffect(() => {
        if (onItemsChange && items.length > 0) onItemsChange(items);
    }, [items, onItemsChange]);

    useEffect(() => {
        return () => {
            if (extractionPollRef.current) clearInterval(extractionPollRef.current);
        };
    }, []);

    // FIX F5.1: Global keyboard shortcuts
    const filterInputRef = useRef<HTMLInputElement>(null);
    const handleSaveRef = useRef<(() => void) | null>(null);
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            const isMeta = e.metaKey || e.ctrlKey;
            // Ctrl+S → Save
            if (isMeta && e.key === 's') {
                e.preventDefault();
                handleSaveRef.current?.();
            }
            // Ctrl+F → Focus filter bar
            if (isMeta && e.key === 'f') {
                e.preventDefault();
                filterInputRef.current?.focus();
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, []);

    // Ref para input de importação Excel oculto
    const fileInputRef = useRef<HTMLInputElement>(null);
    // Tracks whether the current proposal had items in the DB when loaded.
    // false = brand-new version → must force fresh extraction, not use cache from prior version.
    const hasPersistedItemsRef = useRef(false);

    // Load items on mount
    // PERF-01: When running inside the Wizard (wizardConfig provided), the Wizard
    // already fetches /proposals/:id/items and /bases. Skip the duplicate fetch
    // and only load extractionMeta lazily to avoid 2x redundant API calls.
    const isInsideWizard = !!wizardConfig;
    useEffect(() => {
        if (extractionPollRef.current) {
            clearInterval(extractionPollRef.current);
            extractionPollRef.current = null;
        }
        setExtractionMeta(null);
        setActiveExtractionJobId(null);
        setIsExtracting(false);
        setSaveMsg(null);
        setHasUnsavedChanges(false);

        if (isInsideWizard) {
            // FIX STEP2-01: Restore items from wizard state when remounting.
            // Without this, the editor starts empty after Step 2 → Step 1 → Step 2.
            if (wizardItems && wizardItems.length > 0) {
                setItemsSilent(wizardItems);
                hasPersistedItemsRef.current = true;
            } else {
                hasPersistedItemsRef.current = false;
            }
            fetch(`/api/engineering/proposals/${proposalId}/items?metaOnly=1`, { headers: hdrs() })
                .then(r => r.json()).then(data => {
                    if (data?.extractionMeta) setExtractionMeta(data.extractionMeta);
                    // Track persisted items flag from meta response
                    if (data?.itemCount > 0) hasPersistedItemsRef.current = true;
                }).catch(console.error);
        } else {
            // Standalone mode — full load
            setItemsSilent([]);
            setCronogramaData(null);
            hasPersistedItemsRef.current = false;
            fetch(`/api/engineering/proposals/${proposalId}/items`, { headers: hdrs() })
                .then(r => r.json()).then(data => {
                    if (Array.isArray(data)) {
                        setItemsSilent(data);
                        hasPersistedItemsRef.current = data.length > 0;
                    } else if (data && data.items) {
                        const loadedItems = Array.isArray(data.items) ? data.items : [];
                        setItemsSilent(loadedItems);
                        hasPersistedItemsRef.current = loadedItems.length > 0;
                        if (!wizardBdiConfig && data.bdiConfig) setBdiConfig(data.bdiConfig);
                        if (data.engineeringConfig) {
                            const { cronogramaData: savedCronograma, ...engConfig } = data.engineeringConfig;
                            setEngineeringConfig(engConfig);
                            if (savedCronograma) setCronogramaData(savedCronograma);
                        }
                        setExtractionMeta(data.extractionMeta || null);
                    }
                }).catch(console.error);
        }

        fetch('/api/engineering/bases', { headers: hdrs() })
            .then(r => r.json()).then(data => {
                if (Array.isArray(data)) {
                    setBases(data);
                    autoSelectBestBase(data, dashConfig, setSelectedBaseId);
                }
            }).catch(console.error);
    }, [proposalId]);

    // Save all items
    const handleSave = async () => {
        setIsSaving(true); setSaveMsg(null);
        try {
            const itemsToSave = recalcAll(items, effectiveBdi, engineeringConfig);
            setItemsSilent(itemsToSave);
            const res = await fetch(`/api/engineering/proposals/${proposalId}/items`, {
                method: 'POST', headers: hdrs(),
                body: JSON.stringify({ items: itemsToSave, bdiConfig, engineeringConfig, cronogramaData })
            });
            if (res.ok) {
                const d = await res.json();
                setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-success)' }}><CheckCircle2 size={14} /> {d.message}</span>);
                setHasUnsavedChanges(false);
            }
            else { setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-danger)' }}><XCircle size={14} /> Erro ao salvar</span>); }
        } catch { setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-danger)' }}><XCircle size={14} /> Erro de rede</span>); }
        finally { setIsSaving(false); setTimeout(() => setSaveMsg(null), 4000); }
    };
    // FIX F5.1: Keep ref in sync for Ctrl+S shortcut
    handleSaveRef.current = handleSave;

    // Warn on page leave with unsaved changes
    useEffect(() => {
        const handler = (e: BeforeUnloadEvent) => { if (hasUnsavedChanges) { e.preventDefault(); } };
        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, [hasUnsavedChanges]);

    // AI extraction
    const handleExtractAI = async (options: { isPolling?: boolean, forceRestart?: boolean } = {}) => {
        const { isPolling = false, forceRestart = false } = options;
        if (!isPolling && activeExtractionJobId && !forceRestart) {
            setSaveMsg(
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-primary)' }}>
                    <Loader2 size={14} className="spin" /> Extração em andamento. Aguarde a conclusão antes de iniciar outra.
                </span>
            );
            return;
        }
        if (!isPolling && (items.length > 0 || hasPersistedItemsRef.current)) {
            if (!window.confirm('Já existem itens na planilha. Deseja substituí-los completamente por uma nova extração da IA? (Isso iniciará uma nova extração do zero)')) {
                return;
            }
        }
        if (forceRestart && extractionPollRef.current) {
            clearInterval(extractionPollRef.current);
            extractionPollRef.current = null;
            setActiveExtractionJobId(null);
        }
        setIsExtracting(true);
        let keepExtracting = false;
        let shouldAutoClearMessage = true;
        try {
            const hasCachedFailure = extractionMeta?.status === 'empty_extraction' || extractionMeta?.status === 'quality_quarantine';
            // FIX VER-03: If this proposal never had items saved (brand-new version),
            // force a fresh extraction to avoid re-using cached items from a prior version.
            // CRITICAL: Exclude polling callbacks (!isPolling) to prevent infinite loop where
            // completed jobs keep clearing cache and spawning new jobs.
            const isNewEmptyProposal = !isPolling && !hasPersistedItemsRef.current && items.length === 0;
            // FIX CACHE-03: In wizard mode, items.length is always 0 (wizard doesn't pre-load items into editor).
            // But hasPersistedItemsRef.current is true when the proposal has saved items from a previous extraction.
            // We must include it in forceRefresh to avoid serving stale cached partial extractions.
            const forceRefresh = forceRestart || isNewEmptyProposal || (!isPolling && (items.length > 0 || hasPersistedItemsRef.current || hasCachedFailure));
            const res = await fetch('/api/engineering/ai-populate', {
                method: 'POST', headers: hdrs(), body: JSON.stringify({ proposalId, biddingId, engineeringConfig: dashConfig, forceRefresh })
            });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Erro');
            const data = await res.json();
            if (data.items?.length > 0) {
                setActiveExtractionJobId(null);
                const mapped = data.items.map((ai: any, i: number) => {
                    const aiType: EngItemType = (['ETAPA','SUBETAPA','COMPOSICAO','INSUMO'].includes(ai.type)) ? ai.type : 'COMPOSICAO';
                    const isGroup = isGrouper(aiType);
                    const cost = isGroup ? 0 : parseLocaleNumber(ai.unitCost);
                    const qty = isGroup ? 0 : parseLocaleNumber(ai.quantity, 1);
                    const extractedUnitPrice = parseLocaleNumber(ai.unitPrice || ai.officialUnitPrice);
                    const extractedTotalPrice = parseLocaleNumber(ai.totalPrice || ai.officialTotalPrice);
                    
                    // FIX #1: sourceName from backend enrichment (priceAudit) takes priority over PROPRIA default
                    const enrichedSource = ai.priceAudit?.matchedSourceName;
                    const extractedSource = /\/ORSE$/i.test(String(ai.code || '')) ? 'ORSE' : (enrichedSource || ai.sourceName || 'PROPRIA');
                    const finalSource = isGroup ? '' : extractedSource;
                    const normalizedCode = finalSource === 'ORSE' && ai.code
                        ? String(ai.code).toUpperCase().replace(/^0+(\d)/, '$1').replace(/\/?ORSE$/, '/ORSE')
                        : ai.code;

                    // FIX #3: Always compute unitPrice from BDI — never freeze edital prices
                    const computedUnitPrice = isGroup ? 0 : applyBdi(cost, effectiveBdi, dashConfig.precision);
                    const unitPrice = computedUnitPrice;
                    const totalPrice = isGroup ? 0 : applyPrecision(qty * unitPrice, { precision: dashConfig.precision });

                    return {
                        id: `ai-${Date.now()}-${i}`, itemNumber: ai.item || String(i + 1),
                        code: normalizedCode || (isGroup ? '' : 'N/A'), sourceName: finalSource,
                        description: ai.description || '', unit: isGroup ? '' : (ai.unit || 'UN'),
                        quantity: qty, unitCost: cost, type: aiType,
                        unitPrice,
                        totalPrice,
                        priceOrigin: isGroup ? undefined : 'EDITAL',
                        officialUnitCost: cost,
                        officialUnitPrice: extractedUnitPrice > 0 ? extractedUnitPrice : undefined,
                        officialTotalPrice: extractedTotalPrice > 0 ? extractedTotalPrice : undefined,
                        priceAudit: ai.priceAudit,
                        insumos: Array.isArray(ai.insumos) ? ai.insumos : undefined,
                    };
                });
                setItems(mapped); // REPLACE instead of append
                // AUTO-SAVE: Persist extracted items immediately so they survive version switches
                try {
                    const saveRes = await fetch(`/api/engineering/proposals/${proposalId}/items`, {
                        method: 'POST', headers: hdrs(),
                        body: JSON.stringify({ items: mapped, bdiConfig, engineeringConfig })
                    });
                    if (saveRes.ok) {
                        setHasUnsavedChanges(false);
                        hasPersistedItemsRef.current = true;
                    } else {
                        setHasUnsavedChanges(true);
                    }
                } catch {
                    setHasUnsavedChanges(true);
                }
                const etapas = mapped.filter((m: EngItem) => m.type === 'ETAPA').length;
                const subs = mapped.filter((m: EngItem) => m.type === 'SUBETAPA').length;
                const comps = mapped.filter((m: EngItem) => m.type === 'COMPOSICAO').length;
                const insumos = mapped.filter((m: EngItem) => m.type === 'INSUMO').length;
                const ownWithInsumos = mapped.filter((m: EngItem) => m.insumos && m.insumos.length > 0).length;
                if (data.source === 'quality_quarantine') {
                    setExtractionMeta({ status: 'quality_quarantine', validation: data.validation, possibleCauses: data.diagnostic });
                    shouldAutoClearMessage = false;
                    setSaveMsg(
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#d97706' }}>
                            <AlertTriangle size={14} /> Atenção: Extração concluída, mas com baixa qualidade. Revise os {mapped.length} itens com cuidado.
                        </span>
                    );
                } else {
                    setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-success)' }}><CheckCircle2 size={14} /> {mapped.length} itens extraídos e salvos: {etapas} etapas, {subs} subetapas, {comps} composições, {insumos} insumos{ownWithInsumos > 0 ? ` (${ownWithInsumos} com detalhamento)` : ''}</span>);
                }
            } else if (data.source === 'pending_background_job') {
                keepExtracting = true;
                shouldAutoClearMessage = false;
                setSaveMsg(
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-primary)' }}>
                        <Loader2 size={14} className="spin" /> {data.pendingJob?.progressMsg || data.message}
                    </span>
                );
                // Auto-poll: check job status every 5s and re-extract when done
                if (data.pendingJob?.jobId) {
                    const jobId = data.pendingJob.jobId;
                    setActiveExtractionJobId(jobId);
                    if (extractionPollRef.current) clearInterval(extractionPollRef.current);
                    let attempts = 0;
                    const maxAttempts = 360; // 30 minutes max: accommodates large engineering PDFs and queue wait.
                    let pollFailures = 0;
                    extractionPollRef.current = setInterval(async () => {
                        attempts++;
                        if (attempts > maxAttempts) {
                            if (extractionPollRef.current) clearInterval(extractionPollRef.current);
                            extractionPollRef.current = null;
                            setActiveExtractionJobId(null);
                            setIsExtracting(false);
                            setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-danger)' }}><XCircle size={14} /> Extração excedeu 30 minutos. Verifique a Central de Notificações ou reinicie a extração.</span>);
                            return;
                        }
                        try {
                            const jobRes = await fetch(`/api/analyze-edital/jobs/${jobId}`, { headers: hdrs() });
                            if (!jobRes.ok) {
                                pollFailures++;
                                // FIX POLL-01: After 3 consecutive 403/auth failures, bypass job polling
                                // and try fetching results directly from cache. The job may have completed
                                // but the user's session token expired during the 5-15 min extraction.
                                if (pollFailures >= 3) {
                                    if (extractionPollRef.current) clearInterval(extractionPollRef.current);
                                    extractionPollRef.current = null;
                                    setActiveExtractionJobId(null);
                                    setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-primary)' }}><Loader2 size={14} className="spin" /> Reconectando e buscando resultados...</span>);
                                    setTimeout(() => handleExtractAI({ isPolling: true }), 2000);
                                }
                                return;
                            }
                            pollFailures = 0; // Reset on success
                            const job = await jobRes.json();
                            setSaveMsg(
                                <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-primary)' }}>
                                    <Loader2 size={14} className="spin" /> {job.progressMsg || `Extraindo... ${job.progress || 0}%`}
                                </span>
                            );
                            if (job.status === 'COMPLETED' || job.status === 'FAILED') {
                                if (extractionPollRef.current) clearInterval(extractionPollRef.current);
                                extractionPollRef.current = null;
                                setActiveExtractionJobId(null);
                                if (job.status === 'COMPLETED') {
                                    setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-success)' }}><CheckCircle2 size={14} /> Extração concluída! Recarregando itens...</span>);
                                    setTimeout(() => handleExtractAI({ isPolling: true }), 1000);
                                } else {
                                    setIsExtracting(false);
                                    // FIX ARCH-02: Detect empty extraction from error msg and load diagnostics
                                    const isEmptyExtraction = /nenhum item|0 item|empty/i.test(job.error || '');
                                    if (isEmptyExtraction) {
                                        // Load the diagnostics from the server's cached result
                                        setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#d97706' }}><AlertTriangle size={14} /> {job.error}</span>);
                                        // Trigger a cache read to populate extractionMeta with diagnostic info
                                        setTimeout(() => handleExtractAI({ isPolling: true }), 1500);
                                    } else {
                                        setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-danger)' }}><XCircle size={14} /> Extração falhou: {job.error || 'Erro desconhecido'}</span>);
                                    }
                                }
                            }
                        } catch {}
                    }, 5000);
                }
            } else if (data.source === 'quality_quarantine') {
                setExtractionMeta({ status: 'quality_quarantine', validation: data.validation, possibleCauses: data.diagnostic });
                shouldAutoClearMessage = false;
                setSaveMsg(
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#d97706' }}>
                        <AlertTriangle size={14} /> Extração em quarentena: qualidade insuficiente para preencher a planilha automaticamente.
                    </span>
                );
            } else if (data.source === 'empty_extraction') {
                setExtractionMeta({ status: 'empty_extraction', possibleCauses: data.diagnostic });
                shouldAutoClearMessage = false;
                setSaveMsg(
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#d97706' }}>
                        <AlertTriangle size={14} /> IA não encontrou itens. {data.message}
                    </span>
                );
            } else { 
                setSaveMsg(
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#d97706' }}>
                        <AlertTriangle size={14} /> IA não encontrou itens orçamentários
                    </span>
                ); 
            }
        } catch (e: any) { 
            setSaveMsg(
                <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-danger)' }}>
                    <XCircle size={14} /> {e.message}
                </span>
            ); 
        }
        finally { 
            if (!keepExtracting) setIsExtracting(false); 
            if (shouldAutoClearMessage) setTimeout(() => setSaveMsg(null), 8000); 
        }
    };

    // AI composition extraction
    const [isExtractingComps, setIsExtractingComps] = useState(false);
    const handleExtractCompositions = async () => {
        // Identify COMPOSICAO items WITHOUT analytical drill-down (no insumos loaded)
        // NEVER include ETAPAs/SUBETAPAs — they are groupers, not compositions
        const candidates = items.filter(it =>
            (it.type === 'COMPOSICAO' || it.type === 'INSUMO') && (!it.insumos || it.insumos.length === 0)
        );
        if (candidates.length === 0) {
            setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#d97706' }}><AlertTriangle size={14} /> Todas as composições já possuem insumos detalhados</span>);
            setTimeout(() => setSaveMsg(null), 5000);
            return;
        }
        setIsExtractingComps(true);
        setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-primary)' }}><Loader2 size={14} className="spin" /> Extraindo composições ({candidates.length} itens sem insumos) via IA...</span>);
        try {
            // Send ONLY COMPOSICAO/INSUMO candidates — backend also re-validates
            const proposalItems = candidates.map(it => ({
                id: it.id, code: it.code, description: it.description, unit: it.unit,
                quantity: it.quantity, type: it.type, sourceName: it.sourceName || 'PROPRIA',
            }));
            const allContext = items.filter(it => it.type === 'COMPOSICAO' || it.type === 'INSUMO').map(it => ({
                code: it.code, description: it.description, unit: it.unit,
                type: it.type, sourceName: it.sourceName || '',
                hasComposition: !!(it.insumos && it.insumos.length > 0),
            }));
            const res = await fetch('/api/engineering/ai-extract-compositions', {
                method: 'POST', headers: hdrs(),
                body: JSON.stringify({ biddingId, engineeringConfig: dashConfig, proposalItems, allContext })
            });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Erro');
            const data = await res.json();
            const savedCount = data.saved || 0;
            if (savedCount === 0) {
                setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#d97706' }}><AlertTriangle size={14} /> {data.message || 'Nenhuma composição válida encontrada no documento'}</span>);
            } else {
                setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-success)' }}><CheckCircle2 size={14} /> {savedCount} composições extraídas e vinculadas aos itens do orçamento</span>);
            }

            // Reload bases list (PROPRIA may have been created)
            try {
                const basesRes = await fetch('/api/engineering/bases', { headers: hdrs() });
                if (basesRes.ok) {
                    const basesData = await basesRes.json();
                    if (Array.isArray(basesData)) setBases(basesData);
                }
            } catch { /* ignore */ }

            // Inject extracted compositions back into UI items
            if (savedCount > 0 && Array.isArray(data.compositions)) {
                // Build maps for matching: by code AND by description
                const compByCode = new Map<string, any[]>();
                const compByDesc = new Map<string, any[]>();
                for (const comp of data.compositions) {
                    if (comp.groups) {
                        const insumos: any[] = [];
                        for (const [groupKey, groupItems] of Object.entries(comp.groups || {})) {
                            if (!Array.isArray(groupItems)) continue;
                            for (const gi of groupItems) {
                                insumos.push({
                                    code: gi.code || '',
                                    description: gi.description || '',
                                    unit: gi.unit || 'UN',
                                    type: groupKey,
                                    coefficient: gi.coefficient || 0,
                                    unitPrice: gi.unitPrice || 0,
                                    totalPrice: (gi.coefficient || 0) * (gi.unitPrice || 0),
                                });
                            }
                        }
                        if (insumos.length > 0) {
                            const code = String(comp.code || '').trim().toUpperCase();
                            if (code && code !== 'N/A') compByCode.set(code, insumos);
                            const desc = String(comp.description || '').trim().toUpperCase().substring(0, 80);
                            if (desc) compByDesc.set(desc, insumos);
                        }
                    }
                }
                // Update items in state to include the extracted insumos
                setItems(prev => prev.map(it => {
                    if (it.type !== 'COMPOSICAO' || (it.insumos && it.insumos.length > 0)) return it;
                    // Try code match first
                    const code = String(it.code || '').trim().toUpperCase();
                    if (code && code !== 'N/A') {
                        const byCode = compByCode.get(code);
                        if (byCode) return { ...it, insumos: byCode };
                    }
                    // Fallback: match by description
                    const desc = String(it.description || '').trim().toUpperCase().substring(0, 80);
                    const byDesc = compByDesc.get(desc);
                    if (byDesc) return { ...it, insumos: byDesc };
                    return it;
                }));
                setHasUnsavedChanges(true);
            }
        } catch (e: any) { setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-danger)' }}><XCircle size={14} /> {e.message}</span>); }
        finally { setIsExtractingComps(false); setTimeout(() => setSaveMsg(null), 8000); }
    };

    // AI BDI extraction
    const [isExtractingBdi, setIsExtractingBdi] = useState(false);
    const [hoveredRowId, setHoveredRowId] = useState<string | null>(null);
    // FIX F5.5: Notes popover state
    const [editingNotesId, setEditingNotesId] = useState<string | null>(null);
    // FIX F5.4: Multi-selection state
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const toggleSelect = useCallback((id: string) => {
        setSelectedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
    }, []);
    const selectAll = useCallback(() => {
        const billable = items.filter(it => !isGrouper(it.type));
        setSelectedIds(new Set(billable.map(it => it.id)));
    }, [items]);
    const clearSelection = useCallback(() => setSelectedIds(new Set()), []);
    const deleteSelected = useCallback(() => {
        if (selectedIds.size === 0) return;
        if (!window.confirm(`Deseja remover ${selectedIds.size} itens selecionados?`)) return;
        setItems(prev => prev.filter(it => !selectedIds.has(it.id)));
        setSelectedIds(new Set());
    }, [selectedIds, setItems]);
    const changeTypeSelected = useCallback((newType: EngItemType) => {
        if (selectedIds.size === 0) return;
        setItems(prev => prev.map(it => selectedIds.has(it.id) ? { ...it, type: newType } : it));
        setSelectedIds(new Set());
    }, [selectedIds, setItems]);
    const handleExtractBdi = async () => {
        setIsExtractingBdi(true);
        setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-primary)' }}><Loader2 size={14} className="spin" /> Lendo edital com IA em busca do BDI...</span>);
        try {
            const res = await fetch('/api/engineering/ai-extract-bdi', {
                method: 'POST', headers: hdrs(), body: JSON.stringify({ biddingId })
            });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Erro na extração');
            const result = await res.json();
            
            if (!result.found || !result.data) {
                setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#d97706' }}><AlertTriangle size={14} /> {result.message || 'Tabela de BDI não encontrada'}</span>);
                return;
            }
            
            const bdiData = result.data;
            if (bdiData.tcu) {
                // If detailed TCU is found
                const tcu = bdiData.tcu;
                setBdiConfig(prev => ({
                    ...prev,
                    mode: 'TCU',
                    tcu: {
                        ...prev.tcu,
                        ...tcu
                    }
                }));
                setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-success)' }}><CheckCircle2 size={14} /> Composição TCU 2622 extraída com sucesso!</span>);
                setHasUnsavedChanges(true);
            } else if (bdiData.globalBdi) {
                // If only global is found
                setBdiConfig(prev => ({
                    ...prev,
                    mode: 'SIMPLIFICADO',
                    bdiGlobal: bdiData.globalBdi,
                    tcu: autoDistributeBdi(bdiData.globalBdi)
                }));
                setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-success)' }}><CheckCircle2 size={14} /> BDI Global extraído com sucesso!</span>);
                setHasUnsavedChanges(true);
            } else {
                setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#d97706' }}><AlertTriangle size={14} /> IA não conseguiu identificar os valores numéricos.</span>);
            }
        } catch (e: any) { setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-danger)' }}><XCircle size={14} /> {e.message}</span>); }
        finally { setIsExtractingBdi(false); setTimeout(() => setSaveMsg(null), 8000); }
    };

    // Inline edit
    const updateItem = (id: string, field: keyof EngItem, value: any) => {
        setHasUnsavedChanges(true);
        setItems(prev => {
            const mapped = prev.map(it => {
                if (it.id !== id) return it;
                const updated = { ...it, [field]: value };
                if (field === 'unitCost' || field === 'quantity' || field === 'bdiCategoria' || field === 'sourceName' || field === 'code') {
                    if (field === 'unitCost' || field === 'quantity' || field === 'bdiCategoria') updated.priceOrigin = 'MANUAL';
                    // FIX BDI-01: Sempre recalcula com BDI do usuário, sem congelar no preço do edital
                    const itemBdi = resolveItemBdi(updated);
                    updated.unitPrice = applyBdi(updated.unitCost, itemBdi, engineeringConfig.precision);
                    updated.totalPrice = applyPrecision(updated.quantity * updated.unitPrice, { precision: engineeringConfig?.precision });
                    updated.priceAudit = refreshPriceAudit(updated);
                }
                return updated;
            });
            return field === 'type' ? renumberItems(mapped) : mapped;
        });
    };

    const saveCalculationMemory = (itemId: string, calcMemoryJsonStr: string, calculatedQuantity: number) => {
        setHasUnsavedChanges(true);
        setItems(prev => prev.map(it => {
            if (it.id !== itemId) return it;
            const updated = { ...it, quantity: calculatedQuantity, calculationMemory: calcMemoryJsonStr };
            updated.priceOrigin = 'MANUAL';
            const itemBdi = resolveItemBdi(updated);
            updated.unitPrice = applyBdi(updated.unitCost, itemBdi, engineeringConfig.precision);
            updated.totalPrice = applyPrecision(updated.quantity * updated.unitPrice, { precision: engineeringConfig?.precision });
            updated.priceAudit = refreshPriceAudit(updated);
            return updated;
        }));
    };

    const removeItem = (id: string) => { setHasUnsavedChanges(true); setItems(prev => renumberItems(prev.filter(it => it.id !== id))); };

    const applyBasePriceToItem = (id: string) => {
        setHasUnsavedChanges(true);
        setItems(prev => prev.map(it => {
            if (it.id !== id) return it;
            const audit = refreshPriceAudit(it);
            const matchedUnitCost = Number(audit?.matchedUnitCost) || 0;
            if (matchedUnitCost <= 0) return it;
            const updated = { ...it, unitCost: matchedUnitCost, priceOrigin: 'BASE' as const };
            const itemBdi = resolveItemBdi(updated);
            updated.unitPrice = applyBdi(updated.unitCost, itemBdi, engineeringConfig.precision);
            updated.totalPrice = applyPrecision(updated.quantity * updated.unitPrice, { precision: engineeringConfig.precision });
            updated.priceAudit = refreshPriceAudit(updated);
            return updated;
        }));
    };

    // FIX #4: Use dashConfig (Step 1 priority) instead of potentially stale internal engineeringConfig
    const refreshAllAudits = async () => {
        if (items.length === 0) return;
        setIsAuditing(true);
        setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-primary)' }}><Loader2 size={14} className="spin" /> Reauditando bases oficiais ({dashConfig.basesConsideradas?.join(', ') || 'todas'})...</span>);
        try {
            const res = await fetch('/api/engineering/price-audit', {
                method: 'POST',
                headers: hdrs(),
                body: JSON.stringify({ items, engineeringConfig: dashConfig }),
            });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Erro ao reauditar');
            const data = await res.json();
            // FIX #1: Update sourceName from enrichment results
            const auditedItems = (Array.isArray(data.items) ? data.items : items).map((it: any) => {
                if (it.priceAudit?.matchedSourceName && it.priceAudit.matchMethod === 'code_exact' && (!it.sourceName || it.sourceName === 'PROPRIA')) {
                    return { ...it, sourceName: it.priceAudit.matchedSourceName };
                }
                return it;
            });
            setItems(recalcAll(auditedItems, effectiveBdi, dashConfig));
            setHasUnsavedChanges(true);
            // FIX AUDIT-01: Show detailed match counts instead of generic success
            const okCount = auditedItems.filter((it: any) => it.priceAudit?.status === 'OK').length;
            const divCount = auditedItems.filter((it: any) => it.priceAudit?.status === 'DIVERGENT').length;
            const noMatch = auditedItems.filter((it: any) => !it.priceAudit || it.priceAudit.status === 'SEM_MATCH').length;
            const nonGroupItems = auditedItems.filter((it: any) => it.type !== 'ETAPA' && it.type !== 'SUBETAPA').length;
            setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: okCount > 0 ? 'var(--color-success)' : '#d97706' }}><CheckCircle2 size={14} /> Auditoria: {okCount} OK, {divCount} divergentes, {noMatch} sem match (de {nonGroupItems} itens)</span>);
        } catch (e: any) {
            setItemsSilent(recalcAll(items, effectiveBdi, dashConfig));
            setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-danger)' }}><XCircle size={14} /> {e.message}</span>);
        } finally {
            setIsAuditing(false);
            setTimeout(() => setSaveMsg(null), 8000);
        }
    };

    // FIX #4: Use dashConfig (Step 1 priority) instead of potentially stale internal engineeringConfig
    // FIX DEDUP-01: Normalize description for accent-insensitive deduplication
    const normalizeDesc = (s: string) => (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[=\s]+/g, ' ').trim().toUpperCase();

    const syncBases = async () => {
        if (items.length === 0) return;
        setIsAuditing(true);
        const dbCount = Object.keys(dashConfig.dataBases || {}).length;
        setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-primary)' }}><Loader2 size={14} className="spin" /> Buscando preços atualizados ({dbCount} datas bases, UF: {dashConfig.ufReferencia || 'auto'}, Regime: {dashConfig.regimeOneracao})...</span>);
        try {
            const res = await fetch('/api/engineering/price-audit', {
                method: 'POST',
                headers: hdrs(),
                body: JSON.stringify({ items, engineeringConfig: dashConfig }),
            });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Erro ao sincronizar preços');
            const data = await res.json();
            
            // Auto-apply base prices AND fix sourceName from enrichment
            const syncedItems = (Array.isArray(data.items) ? data.items : items).map((it: any) => {
                const updated = { ...it };
                if (it.priceAudit?.matchedUnitCost && it.priceAudit.matchedUnitCost > 0) {
                    updated.unitCost = it.priceAudit.matchedUnitCost;
                    updated.priceOrigin = 'BASE' as const;
                }
                // FIX #1: Update sourceName from enrichment
                if (it.priceAudit?.matchedSourceName && it.priceAudit.matchMethod === 'code_exact' && (!it.sourceName || it.sourceName === 'PROPRIA')) {
                    updated.sourceName = it.priceAudit.matchedSourceName;
                }
                return updated;
            });

            // FIX DEDUP-01: Deduplicate items by itemNumber + normalized code.
            // Prevents accumulation of duplicates when user clicks "Puxar do HUB" multiple times,
            // or when the enricher returns items with slightly different descriptions (accents).
            const seen = new Map<string, number>();
            const dedupedItems = syncedItems.filter((it: any, idx: number) => {
                if (it.type === 'ETAPA' || it.type === 'SUBETAPA') return true; // Never dedup groupers
                const key = `${it.itemNumber}::${normalizeDesc(it.code || '')}`;
                if (seen.has(key)) {
                    // Keep the version with the higher unitCost (more complete data)
                    const prevIdx = seen.get(key)!;
                    const prevCost = Number(syncedItems[prevIdx]?.unitCost) || 0;
                    const thisCost = Number(it.unitCost) || 0;
                    if (thisCost > prevCost) {
                        // Replace previous with this one
                        syncedItems[prevIdx] = null as any;
                        seen.set(key, idx);
                        return true;
                    }
                    return false; // Discard this duplicate
                }
                seen.set(key, idx);
                return true;
            }).filter(Boolean);

            const removedCount = syncedItems.length - dedupedItems.length;
            setItems(recalcAll(dedupedItems, effectiveBdi, dashConfig));
            setHasUnsavedChanges(true);
            const matchCount = dedupedItems.filter((it: any) => it.priceAudit?.matchedUnitCost > 0).length;
            setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-success)' }}><CheckCircle2 size={14} /> Hub: {matchCount} preços atualizados{removedCount > 0 ? `, ${removedCount} duplicatas removidas` : ''} ({dashConfig.regimeOneracao})</span>);
        } catch (e: any) {
            setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-danger)' }}><XCircle size={14} /> {e.message}</span>);
        } finally {
            setIsAuditing(false);
            setTimeout(() => setSaveMsg(null), 8000);
        }
    };

    const addTypedItem = (type: EngItemType, insertAfterId?: string, description?: string): string => {
        const isGroup = isGrouper(type);
        const newId = `new-${Date.now()}`;
        setHasUnsavedChanges(true);
        setItems(prev => {
            const newItem = {
                id: newId, itemNumber: '', code: isGroup ? '' : '', sourceName: isGroup ? '' : 'PROPRIA',
                description: description || '', unit: isGroup ? '' : 'UN', quantity: isGroup ? 0 : 1,
                unitCost: 0, unitPrice: 0, totalPrice: 0, type, priceOrigin: isGroup ? undefined : ('MANUAL' as const),
            };
            let newList = [...prev];
            if (insertAfterId) {
                const idx = newList.findIndex(it => it.id === insertAfterId);
                if (idx >= 0) {
                    newList.splice(idx + 1, 0, newItem);
                    return renumberItems(newList);
                }
            }
            newList.push(newItem);
            return renumberItems(newList);
        });
        // Advance cursor so next insertion goes after this item
        setInsertTargetId(newId);
        scrollToItem(newId);
        return newId;
    };

    // Auto-scroll the main table to show a newly added item
    const scrollToItem = (itemId: string) => {
        // Wait for React to render the new row, then scroll into view
        requestAnimationFrame(() => {
            setTimeout(() => {
                const row = document.querySelector(`[data-item-id="${itemId}"]`) as HTMLElement;
                if (row) {
                    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    // Brief highlight flash
                    row.style.transition = 'background 0.3s';
                    row.style.background = 'rgba(16,185,129,0.15)';
                    setTimeout(() => { row.style.background = ''; }, 1200);
                }
            }, 80);
        });
    };

    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (over && active.id !== over.id) {
            setItems(prev => {
                const oldIndex = prev.findIndex(item => item.id === active.id);
                const newIndex = prev.findIndex(item => item.id === over.id);
                setHasUnsavedChanges(true);
                return renumberItems(arrayMove(prev, oldIndex, newIndex));
            });
        }
    };

    const [insertType, setInsertType] = useState<EngItemType>('COMPOSICAO');
    const [insertTargetId, setInsertTargetId] = useState<string | null>(null);

    // Search — core function (reusable by both auto-search and manual button)
    const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const handleSearch = useCallback(async (query?: string) => {
        const q = query ?? searchQuery;
        if (!selectedBaseId || !q || q.length < 2) {
            if (!q) setSearchResults([]);
            return;
        }
        setIsSearching(true);
        try {
            const params = new URLSearchParams({ q });
            if (engineeringConfig?.regimeOneracao) params.append('regime', engineeringConfig.regimeOneracao);
            const selectedBase = bases.find(b => b.id === selectedBaseId);
            const effectiveDate = (selectedBase && engineeringConfig?.dataBases?.[selectedBase.name]) || engineeringConfig?.dataBase;
            if (effectiveDate) params.append('dataBase', effectiveDate);
            // Filter by record kind for searchable types only
            if (insertType === 'COMPOSICAO' || insertType === 'INSUMO') {
                params.append('kind', insertType);
            }
            const url = `/api/engineering/bases/${selectedBaseId}/items?${params.toString()}`;
            const res = await fetch(url, { headers: hdrs() });
            const data = await res.json();
            setSearchResults(data.items || []);
        } catch (err) { console.error('[Search] Error:', err); } finally { setIsSearching(false); }
    }, [searchQuery, selectedBaseId, bases, engineeringConfig, insertType]);

    // Auto-search: fires when user types 2+ characters, with 350ms debounce
    useEffect(() => {
        if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
        if (!showSearch || !searchQuery || searchQuery.length < 2) {
            if (showSearch && !searchQuery) setSearchResults([]);
            return;
        }
        searchDebounceRef.current = setTimeout(() => {
            handleSearch(searchQuery);
        }, 350);
        return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current); };
    }, [searchQuery, selectedBaseId, insertType, showSearch]);

    // Track per-item quantity in search results & flash feedback for added items
    const [searchQuantities, setSearchQuantities] = useState<Record<string, number>>({});
    const [addedItemIds, setAddedItemIds] = useState<Set<string>>(new Set());
    const [addedCount, setAddedCount] = useState(0);
    const [structuralName, setStructuralName] = useState('');
    const [addedStructuralNames, setAddedStructuralNames] = useState<string[]>([]);
    // Propria creation form state
    const [showPropriaForm, setShowPropriaForm] = useState(false);
    const [propriaCode, setPropriaCode] = useState('');
    const [propriaDesc, setPropriaDesc] = useState('');
    const [propriaUnit, setPropriaUnit] = useState('UN');
    const [propriaPrice, setPropriaPrice] = useState('');
    const [propriaQty, setPropriaQty] = useState('1');
    const [propriaSaving, setPropiaSaving] = useState(false);

    const addFromSearch = (dbItem: any) => {
        const base = bases.find(b => b.id === selectedBaseId);
        const cost = parseLocaleNumber(dbItem.price);
        const unitPrice = applyBdi(cost, effectiveBdi, engineeringConfig.precision);
        const typeFromBase = dbItem.recordKind === 'COMPOSICAO' ? 'COMPOSICAO' : insertType;
        const qty = searchQuantities[dbItem.id] || 1;
        const newId = `db-${Date.now()}`;
        setHasUnsavedChanges(true);
        setItems(prev => {
            const newItem = {
                id: newId, itemNumber: '',
                code: dbItem.code, sourceName: base?.name || 'OFICIAL',
                description: dbItem.description, unit: dbItem.unit, quantity: qty,
                unitCost: cost, unitPrice,
                totalPrice: applyPrecision(qty * unitPrice, { precision: engineeringConfig.precision }), type: typeFromBase,
                priceOrigin: 'BASE' as const,
            };
            let newList = [...prev];
            if (insertTargetId) {
                const idx = newList.findIndex(it => it.id === insertTargetId);
                if (idx >= 0) {
                    newList.splice(idx + 1, 0, newItem);
                    return renumberItems(newList);
                }
            }
            newList.push(newItem);
            return renumberItems(newList);
        });
        setInsertTargetId(newId);
        scrollToItem(newId);
        // Flash feedback — keep modal open for adding more items
        setAddedItemIds(prev => new Set(prev).add(dbItem.id));
        setAddedCount(c => c + 1);
        setTimeout(() => setAddedItemIds(prev => { const next = new Set(prev); next.delete(dbItem.id); return next; }), 1500);
    };

    // Reset search session state when modal closes
    const closeSearchModal = () => {
        setShowSearch(false); setSearchQuery(''); setSearchResults([]);
        setInsertTargetId(null); setSearchQuantities({}); setAddedItemIds(new Set());
        setAddedCount(0); setStructuralName(''); setAddedStructuralNames([]);
        setShowPropriaForm(false); setPropriaCode(''); setPropriaDesc(''); setPropriaUnit('UN'); setPropriaPrice(''); setPropriaQty('1');
    };

    // Create proprietary item in PROPRIA database and add to budget
    const handleCreatePropria = async () => {
        if (!propriaCode.trim() || !propriaDesc.trim() || !propriaPrice.trim()) return;
        setPropiaSaving(true);
        try {
            const res = await fetch('/api/engineering/propria/create', {
                method: 'POST', headers: hdrs(),
                body: JSON.stringify({
                    code: propriaCode.trim(),
                    description: propriaDesc.trim(),
                    unit: propriaUnit.trim() || 'UN',
                    price: parseFloat(propriaPrice.replace(',', '.')) || 0,
                    recordKind: insertType === 'COMPOSICAO' ? 'COMPOSICAO' : 'INSUMO',
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Erro ao criar item');

            // Direct insert into budget (bypasses addFromSearch to avoid state race condition)
            const cost = Number(data.item.price) || 0;
            const unitPrice = applyBdi(cost, effectiveBdi, engineeringConfig.precision);
            const qty = parseFloat(propriaQty.replace(',', '.')) || 1;
            const typeFromKind = (data.item.recordKind === 'COMPOSICAO' ? 'COMPOSICAO' : 'INSUMO') as EngItemType;
            const newId = `propria-${Date.now()}`;
            setHasUnsavedChanges(true);
            setItems(prev => {
                const newItem = {
                    id: newId, itemNumber: '',
                    code: data.item.code, sourceName: 'PROPRIA',
                    description: data.item.description, unit: data.item.unit || 'UN', quantity: qty,
                    unitCost: cost, unitPrice,
                    totalPrice: applyPrecision(qty * unitPrice, { precision: engineeringConfig.precision }),
                    type: typeFromKind, priceOrigin: 'BASE' as const,
                };
                let newList = [...prev];
                if (insertTargetId) {
                    const idx = newList.findIndex(it => it.id === insertTargetId);
                    if (idx >= 0) {
                        newList.splice(idx + 1, 0, newItem);
                        return renumberItems(newList);
                    }
                }
                newList.push(newItem);
                return renumberItems(newList);
            });
            setInsertTargetId(newId);
            scrollToItem(newId);
            setAddedCount(c => c + 1);

            // Reset form (keep qty at 1)
            setPropriaCode(''); setPropriaDesc(''); setPropriaUnit('UN'); setPropriaPrice(''); setPropriaQty('1');
        } catch (err: any) {
            alert(err.message || 'Erro ao criar item próprio');
        } finally {
            setPropiaSaving(false);
        }
    };

    // BDI helpers
    const updateTcu = (field: keyof BdiTcuParams, val: number) => {
        setHasUnsavedChanges(true);
        setBdiConfig(prev => {
            const nextTcu = { ...prev.tcu, [field]: val };
            const calculatedBdi = calculateBdiTCU(nextTcu, engineeringConfig?.precision);
            return { ...prev, tcu: nextTcu, bdiGlobal: calculatedBdi };
        });
    };

    // ═══════════════════════════════════════════════════════
    // IMPORTAÇÃO EXCEL (.xlsx)
    // ═══════════════════════════════════════════════════════
    const handleImportExcel = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                const data = new Uint8Array(evt.target?.result as ArrayBuffer);
                const workbook = XLSX.read(data, { type: 'array' });
                const sheetName = workbook.SheetNames[0];
                const sheet = workbook.Sheets[sheetName];
                const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

                if (rows.length < 2) {
                    setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-danger)' }}><XCircle size={14} /> Planilha vazia ou sem dados</span>);
                    return;
                }

                // Auto-detectar colunas pelo header
                const header = rows[0].map((h: any) => String(h).toUpperCase().trim());
                const findCol = (...aliases: string[]) => header.findIndex(h => aliases.some(a => h.includes(a)));

                const colItem = findCol('ITEM', 'N°', 'NUM', 'NÚMERO');
                const colDesc = findCol('DESCRI', 'SERVIÇO', 'SERVICO', 'ESPECIFICA');
                const colUn = findCol('UNID', 'UN.');
                const colQtd = findCol('QUANT', 'QTD');
                const isWithBdiHeader = (h: string) => h.includes('COM BDI') || h.includes('C/BDI') || h.includes('C/ BDI');
                const colCusto = header.findIndex(h => !isWithBdiHeader(h) && ['CUSTO', 'PREÇO UNIT', 'PRECO UNIT', 'VL UNIT', 'P.U.', 'VALOR UNIT'].some(a => h.includes(a)));
                const colPrecoBdi = header.findIndex(h => isWithBdiHeader(h) && ['PREÇO', 'PRECO', 'VALOR', 'UNIT'].some(a => h.includes(a)));
                const colTotal = findCol('TOTAL', 'VALOR TOTAL', 'PREÇO TOTAL', 'PRECO TOTAL');
                const colCodigo = findCol('CÓDIGO', 'CODIGO', 'CÓD', 'REF');
                const colBase = findCol('BASE', 'FONTE', 'REFER');

                if (colDesc < 0) {
                    setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-danger)' }}><XCircle size={14} /> Coluna "Descrição" não encontrada no header</span>);
                    return;
                }

                const imported: EngItem[] = [];
                for (let r = 1; r < rows.length; r++) {
                    const row = rows[r];
                    if (!row || row.every((c: any) => !c && c !== 0)) continue; // skip empty rows

                    const desc = String(row[colDesc] ?? '').trim();
                    if (!desc) continue;

                    const itemNum = colItem >= 0 ? String(row[colItem] ?? '').trim() : String(imported.length + 1);
                    const unit = colUn >= 0 ? String(row[colUn] ?? '').trim() : '';
                    const qty = colQtd >= 0 ? parseLocaleNumber(row[colQtd]) : 0;
                    const cost = colCusto >= 0 ? parseLocaleNumber(row[colCusto]) : 0;
                    const unitPriceFromSheet = colPrecoBdi >= 0 ? parseLocaleNumber(row[colPrecoBdi]) : 0;
                    const totalFromSheet = colTotal >= 0 ? parseLocaleNumber(row[colTotal]) : 0;
                    const code = colCodigo >= 0 ? String(row[colCodigo] ?? '').trim() : '';
                    const base = colBase >= 0 ? String(row[colBase] ?? '').trim() : '';

                    // Detecção de tipo: item sem preço e sem unidade = agrupador
                    let type: EngItemType = 'COMPOSICAO';
                    const depth = (itemNum.match(/\./g) || []).length;
                    if (cost === 0 && qty === 0 && !unit) {
                        type = depth === 0 ? 'ETAPA' : 'SUBETAPA';
                    } else if (code && code.length < 6 && !base) {
                        type = 'INSUMO';
                    }

                    const isGroup = isGrouper(type);
                    const up = isGroup ? 0 : (unitPriceFromSheet > 0 ? unitPriceFromSheet : applyBdi(cost, effectiveBdi, engineeringConfig.precision));
                    const totalFromValues = applyPrecision(qty * up, engineeringConfig);

                    imported.push({
                        id: `xls-${Date.now()}-${r}`,
                        itemNumber: itemNum || String(imported.length + 1),
                        code: isGroup ? '' : (code || 'N/A'),
                        sourceName: isGroup ? '' : (base || 'PROPRIA'),
                        description: desc,
                        unit: isGroup ? '' : (unit || 'UN'),
                        quantity: isGroup ? 0 : qty,
                        unitCost: isGroup ? 0 : cost,
                        unitPrice: up,
                        totalPrice: isGroup ? 0 : (totalFromSheet > 0 ? totalFromSheet : totalFromValues),
                        priceOrigin: isGroup ? undefined : (unitPriceFromSheet > 0 || totalFromSheet > 0 ? 'EDITAL' : 'MANUAL'),
                        officialUnitCost: isGroup ? undefined : cost,
                        officialUnitPrice: unitPriceFromSheet > 0 ? unitPriceFromSheet : undefined,
                        officialTotalPrice: totalFromSheet > 0 ? totalFromSheet : undefined,
                        type,
                    });
                }

                if (imported.length === 0) {
                    setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#d97706' }}><AlertTriangle size={14} /> Nenhum item válido encontrado na planilha</span>);
                    return;
                }

                // FIX F1.4: If table already has items, ask user to REPLACE or APPEND
                const applyImport = (mode: 'replace' | 'append') => {
                    if (mode === 'replace') {
                        setItems(imported);
                    } else {
                        setItems(prev => [...prev, ...imported]);
                    }
                    setHasUnsavedChanges(true);
                    const etapas = imported.filter(i => i.type === 'ETAPA').length;
                    const comps = imported.filter(i => i.type === 'COMPOSICAO').length;
                    const modeLabel = mode === 'replace' ? 'substituídos' : 'adicionados';
                    setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-success)' }}><CheckCircle2 size={14} /> {imported.length} itens {modeLabel} ({etapas} etapas, {comps} composições)</span>);
                };

                if (items.length > 0) {
                    // Show inline confirmation in the save message area
                    setSaveMsg(
                        <span style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--color-text-primary)' }}>
                            <AlertTriangle size={14} color="#d97706" />
                            <span style={{ fontSize: '0.82rem' }}>Planilha já possui {items.length} itens. Importar {imported.length} novos como:</span>
                            <button onClick={() => applyImport('replace')} className="btn btn-outline"
                                style={{ padding: '3px 10px', fontSize: '0.75rem', fontWeight: 700, borderColor: 'var(--color-danger)', color: 'var(--color-danger)' }}>
                                Substituir tudo
                            </button>
                            <button onClick={() => applyImport('append')} className="btn btn-primary"
                                style={{ padding: '3px 10px', fontSize: '0.75rem', fontWeight: 700 }}>
                                Adicionar ao final
                            </button>
                        </span>
                    );
                    return; // Wait for user click
                }

                // If table is empty, import directly
                applyImport('replace');
            } catch (err: any) {
                console.error('Erro ao importar Excel:', err);
                setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-danger)' }}><XCircle size={14} /> Erro ao ler arquivo: {err.message}</span>);
            }
            // Reset input
            if (fileInputRef.current) fileInputRef.current.value = '';
        };
        reader.readAsArrayBuffer(file);
    };

    const handleImportFromImage = (extracted: any[]) => {
        const imported: EngItem[] = extracted.map((it, idx) => {
            const isGroup = isGrouper(it.type || it.t);
            const qty = Number(it.quantity || it.q) || 0;
            const uc = Number(it.unitCost || it.uc) || 0;
            const up = Number(it.unitPrice || it.up || it.unitCost || it.uc || 0);
            const tp = Number(it.totalPrice || it.tp || 0);

            return {
                id: `img-${Date.now()}-${idx}-${Math.random().toString(36).substr(2, 5)}`,
                itemNumber: it.itemNumber || it.i || '',
                code: isGroup ? '' : (it.code || it.c || 'N/A'),
                sourceName: isGroup ? '' : (it.sourceName || it.s || 'PROPRIA'),
                description: it.description || it.d || '',
                unit: isGroup ? '' : (it.unit || it.u || 'UN'),
                quantity: isGroup ? 0 : qty,
                unitCost: isGroup ? 0 : uc,
                unitPrice: isGroup ? 0 : (up > 0 ? up : applyBdi(uc, effectiveBdi, engineeringConfig.precision)),
                totalPrice: isGroup ? 0 : (tp > 0 ? tp : applyPrecision(qty * up, engineeringConfig)),
                priceOrigin: isGroup ? undefined : (it.priceAudit ? 'BASE' : 'MANUAL'),
                officialUnitCost: isGroup ? undefined : (it.officialUnitCost || it.priceAudit?.matchedUnitCost || uc || undefined),
                officialUnitPrice: isGroup ? undefined : (it.officialUnitPrice || up || undefined),
                officialTotalPrice: isGroup ? undefined : (it.officialTotalPrice || tp || undefined),
                priceAudit: it.priceAudit,
                type: it.type || it.t || 'COMPOSICAO'
            };
        });

        setItems(prev => renumberItems([...prev, ...imported]));
        setHasUnsavedChanges(true);

        const etapas = imported.filter(i => i.type === 'ETAPA').length;
        const comps = imported.filter(i => i.type === 'COMPOSICAO').length;
        setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-success)' }}><CheckCircle2 size={14} /> {imported.length} itens adicionados do Print ({etapas} etapas, {comps} composições)</span>);
    };

    // Excel Export — native .xlsx via SheetJS
    const handleExportExcel = () => {
        const wb = XLSX.utils.book_new();

        // 1. Cabeçalho com configurações mestre
        const configRows = [
            ['PLANILHA ORÇAMENTÁRIA DE OBRAS E SERVIÇOS DE ENGENHARIA'],
            [''],
            ['Obra/Objeto', engineeringConfig?.objeto || 'Não informado'],
            ['Bancos Considerados', (engineeringConfig?.basesConsideradas || []).join(', ') || 'Não informado'],
            ['Data Base', engineeringConfig?.dataBase || 'Não informado'],
            ['Regime', engineeringConfig?.regimeOneracao || 'DESONERADO'],
            ['BDI (' + bdiConfig.mode + ')', effectiveBdi.toFixed(2) + '%'],
            ['Encargos Sociais Horista', (engineeringConfig?.encargosSociais?.horista || 0) + '%'],
            ['Encargos Sociais Mensalista', (engineeringConfig?.encargosSociais?.mensalista || 0) + '%'],
            ...(engineeringConfig.bdiDiferenciado ? [['BDI Fornecimento', (engineeringConfig.bdiFornecimento || 14.02).toFixed(2) + '%']] : []),
            [''],
        ];

        // 2. Header da tabela
        const tableHeader = engineeringConfig.bdiDiferenciado
            ? ['Item', 'Tipo', 'BDI Cat.', 'Base', 'Código', 'Descrição', 'Unidade', 'Quantidade', 'Custo Unit. (S/ BDI)', 'Preço Unit. (C/ BDI)', 'Total (C/ BDI)']
            : ['Item', 'Tipo', 'Base', 'Código', 'Descrição', 'Unidade', 'Quantidade', 'Custo Unit. (S/ BDI)', 'Preço Unit. (C/ BDI)', 'Total (C/ BDI)'];

        // 3. Dados dos itens
        const dataRows = items.map(it => {
            const base = engineeringConfig.bdiDiferenciado
                ? [it.itemNumber, it.type, it.bdiCategoria || 'OBRA', it.sourceName, it.code, it.description, it.unit]
                : [it.itemNumber, it.type, it.sourceName, it.code, it.description, it.unit];
            return [...base, it.quantity, it.unitCost, it.unitPrice, it.totalPrice];
        });

        // 4. Totais
        const emptyCol = engineeringConfig.bdiDiferenciado ? 9 : 8;
        const footerRows = [
            [],
            [...Array(emptyCol - 1).fill(''), 'Subtotal (S/ BDI)', '', billableItems.reduce((s, i) => s + i.quantity * i.unitCost, 0)],
            [...Array(emptyCol - 1).fill(''), `BDI (${bdiConfig.mode})`, effectiveBdi.toFixed(2) + '%', ''],
            [...Array(emptyCol - 1).fill(''), 'TOTAL GLOBAL', '', billableItems.reduce((s, i) => s + i.totalPrice, 0)],
        ];

        const allRows = [...configRows, tableHeader, ...dataRows, ...footerRows];
        const ws = XLSX.utils.aoa_to_sheet(allRows);

        // Auto-width
        const colWidths = tableHeader.map((h, i) => {
            let max = String(h).length;
            for (const row of dataRows) {
                const v = String(row[i] ?? '');
                if (v.length > max) max = v.length;
            }
            return { wch: Math.min(max + 2, 60) };
        });
        ws['!cols'] = colWidths;

        XLSX.utils.book_append_sheet(wb, ws, 'Orçamento');
        XLSX.writeFile(wb, `planilha_orcamentaria_${new Date().toISOString().slice(0, 10)}.xlsx`);
    };

    const inputStyle = (w: string = '100%'): React.CSSProperties => ({
        width: w, minWidth: w !== '100%' ? w : 'auto', padding: '4px 8px', fontSize: '0.8rem', border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-sm)', background: 'var(--color-bg-base)', height: 30
    });

    // ── SortableRow extracted outside map() to prevent React remount on every re-render ──
    // useMemo ensures the component identity is stable across re-renders (setHoveredRowId is stable from useState)
    const SortableRow = useMemo(() => {
        const Row = ({ id, children }: { id: string; children: (listeners: any) => React.ReactNode }) => {
            const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
            const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1, background: isDragging ? 'rgba(0,0,0,0.05)' : undefined, position: 'relative' as const };
            return (
                <tr ref={setNodeRef} style={{ ...style, borderBottom: '1px solid var(--color-border)' }}
                    data-item-id={id}
                    onMouseEnter={() => setHoveredRowId(id)}
                    onMouseLeave={() => setHoveredRowId(null)}
                >
                    {children(listeners)}
                </tr>
            );
        };
        return Row;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', marginTop: 'var(--space-2)' }}>

            {/* Tab Bar — unified navigation */}
            <div style={{ display: 'flex', gap: 4, background: 'var(--color-bg-base)', padding: 4, borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                {[
                    { key: 'planilha' as const, label: 'Orçamento', icon: TableProperties },
                    { key: 'hub_insumos' as const, label: 'Hub de Insumos', icon: Package },
                    { key: 'curva_abc' as const, label: 'Curva ABC', icon: BarChart3 },
                ].map(tab => (
                    <button key={tab.key} onClick={() => { setActiveTab(tab.key); setShowAIMenu(false); setShowToolsMenu(false); }} style={{
                        flex: 1, padding: '8px 12px', borderRadius: 'var(--radius-sm)', border: 'none', cursor: 'pointer',
                        background: activeTab === tab.key ? 'var(--color-bg-surface)' : 'transparent',
                        boxShadow: activeTab === tab.key ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                        color: activeTab === tab.key ? 'var(--color-primary)' : 'var(--color-text-tertiary)',
                        fontWeight: activeTab === tab.key ? 700 : 500, fontSize: '0.82rem',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, transition: 'all 0.15s',
                    }}>
                        <tab.icon size={14} /> {tab.label}
                    </button>
                ))}
            </div>

            {/* Contextual Toolbar — sticky below tabs, always visible while scrolling */}
            {activeTab === 'planilha' && (<>
                <div style={{ position: 'sticky', top: 0, zIndex: 50, display: 'flex', gap: 8, alignItems: 'center', padding: '8px 14px', background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', flexWrap: 'wrap', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }}>
                    {/* ── AI Group (dropdown) ── */}
                    <div style={{ position: 'relative' }}>
                        <button className="btn btn-outline" onClick={() => { setShowAIMenu(!showAIMenu); setShowToolsMenu(false); }}
                            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', padding: '6px 12px', borderColor: showAIMenu ? 'var(--color-primary)' : undefined, color: showAIMenu ? 'var(--color-primary)' : undefined }}>
                            <Cpu size={14} /> IA <ChevronDown size={12} style={{ transform: showAIMenu ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                        </button>
                        {showAIMenu && (<>
                            <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={() => setShowAIMenu(false)} />
                            <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 100, minWidth: 240, overflow: 'hidden' }}>
                                <div style={{ padding: '6px 12px', fontSize: '0.68rem', fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.5px', background: 'var(--color-bg-base)' }}>Extração por IA</div>
                                <button onClick={() => { handleExtractAI(); setShowAIMenu(false); }} disabled={isExtracting}
                                    style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 14px', border: 'none', background: 'transparent', fontSize: '0.84rem', color: 'var(--color-text-primary)', cursor: isExtracting ? 'wait' : 'pointer', fontWeight: 500, textAlign: 'left' as const, opacity: isExtracting ? 0.6 : 1 }}
                                    onMouseEnter={e => { if (!isExtracting) (e.currentTarget as HTMLElement).style.background = 'var(--color-bg-base)'; }}
                                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
                                    {isExtracting ? <Loader2 size={14} className="spin" /> : <Cpu size={14} color="var(--color-ai)" />}
                                    <div><div>Extrair Itens do Edital</div><div style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)' }}>Popula a planilha com itens do edital</div></div>
                                </button>
                                <button onClick={() => { setShowImageImportModal(true); setShowAIMenu(false); }}
                                    style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 14px', border: 'none', background: 'transparent', fontSize: '0.84rem', color: 'var(--color-text-primary)', cursor: 'pointer', fontWeight: 500, textAlign: 'left' as const }}
                                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--color-bg-base)'; }}
                                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
                                    <Image size={14} color="var(--color-primary)" />
                                    <div><div>Importar de Print / Imagem</div><div style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)' }}>Extrai itens arrastando ou colando imagem (IA)</div></div>
                                </button>
                            </div>
                        </>)}
                    </div>

                    <div style={{ width: 1, height: 24, background: 'var(--color-border)' }} />

                    {/* ── FIX F1.2: Undo / Redo ── */}
                    <button
                        className="btn btn-outline"
                        onClick={() => { undoItems(); setHasUnsavedChanges(true); }}
                        disabled={!canUndo}
                        title={`Desfazer (${undoCount}) — Ctrl+Z`}
                        style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.78rem', padding: '5px 8px', opacity: canUndo ? 1 : 0.35, position: 'relative' }}
                    >
                        <Undo2 size={14} />
                        {canUndo && <span style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--color-primary)' }}>{undoCount}</span>}
                    </button>
                    <button
                        className="btn btn-outline"
                        onClick={() => { redoItems(); setHasUnsavedChanges(true); }}
                        disabled={!canRedo}
                        title={`Refazer (${redoCount}) — Ctrl+Shift+Z`}
                        style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.78rem', padding: '5px 8px', opacity: canRedo ? 1 : 0.35, position: 'relative' }}
                    >
                        <Redo2 size={14} />
                        {canRedo && <span style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--color-primary)' }}>{redoCount}</span>}
                    </button>

                    <div style={{ width: 1, height: 24, background: 'var(--color-border)' }} />

                    {/* ── Import / Export (side by side) ── */}
                    <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.ods,.csv" style={{ display: 'none' }} onChange={handleImportExcel} />
                    <button className="btn btn-outline" style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.82rem', padding: '6px 12px' }} onClick={() => fileInputRef.current?.click()}>
                        <Upload size={14} color="#059669" /> Importar
                    </button>
                    <button className="btn btn-outline" style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: '0.82rem', padding: '6px 12px' }} onClick={handleExportExcel}>
                        <Download size={14} /> Exportar
                    </button>

                    <div style={{ width: 1, height: 24, background: 'var(--color-border)' }} />

                    {/* ── Tools Group (dropdown) ── */}
                    <div style={{ position: 'relative' }}>
                        <button className="btn btn-outline" onClick={() => { setShowToolsMenu(!showToolsMenu); setShowAIMenu(false); }}
                            style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.82rem', padding: '6px 12px', borderColor: showToolsMenu ? 'var(--color-primary)' : undefined, color: showToolsMenu ? 'var(--color-primary)' : undefined }}>
                            <Wrench size={14} /> Ferramentas <ChevronDown size={12} style={{ transform: showToolsMenu ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                        </button>
                        {showToolsMenu && (<>
                            <div style={{ position: 'fixed', inset: 0, zIndex: 99 }} onClick={() => setShowToolsMenu(false)} />
                            <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 100, minWidth: 240, overflow: 'hidden' }}>
                                <button onClick={() => { const idx = items.findIndex(it => !isGrouper(it.type)); if (idx >= 0) setCompositionEditorIndex(idx); setShowToolsMenu(false); }}
                                    disabled={items.findIndex(it => !isGrouper(it.type)) < 0}
                                    style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 14px', border: 'none', background: 'transparent', fontSize: '0.84rem', color: 'var(--color-text-primary)', cursor: 'pointer', fontWeight: 500, textAlign: 'left' as const }}
                                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--color-bg-base)'; }}
                                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
                                    <Layers size={14} color="var(--color-primary)" />
                                    <div><div>Editar Composições</div><div style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)' }}>Abre o editor de detalhamento</div></div>
                                </button>
                                <button onClick={() => { refreshAllAudits(); setShowToolsMenu(false); }} disabled={items.length === 0 || isAuditing}
                                    style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 14px', border: 'none', background: 'transparent', fontSize: '0.84rem', color: 'var(--color-text-primary)', cursor: isAuditing ? 'wait' : 'pointer', fontWeight: 500, textAlign: 'left' as const, borderTop: '1px solid var(--color-border)', opacity: isAuditing ? 0.6 : 1 }}
                                    onMouseEnter={e => { if (!isAuditing) (e.currentTarget as HTMLElement).style.background = 'var(--color-bg-base)'; }}
                                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
                                    {isAuditing ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />}
                                    <div><div>Reauditar Preços</div><div style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)' }}>Confere preços contra bases oficiais</div></div>
                                </button>
                                <button onClick={() => { syncBases(); setShowToolsMenu(false); }} disabled={items.length === 0 || isAuditing}
                                    style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '10px 14px', border: 'none', background: 'transparent', fontSize: '0.84rem', color: 'var(--color-text-primary)', cursor: isAuditing ? 'wait' : 'pointer', fontWeight: 500, textAlign: 'left' as const, borderTop: '1px solid var(--color-border)', opacity: isAuditing ? 0.6 : 1 }}
                                    onMouseEnter={e => { if (!isAuditing) (e.currentTarget as HTMLElement).style.background = 'var(--color-bg-base)'; }}
                                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}>
                                    {isAuditing ? <Loader2 size={14} className="spin" /> : <Database size={14} color="var(--color-primary)" />}
                                    <div><div>Puxar Valores do Hub</div><div style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)' }}>Atualiza preços com a data base configurada</div></div>
                                </button>
                            </div>
                        </>)}
                    </div>

                    {/* ── Separator ── */}
                    <div style={{ width: 1, height: 28, background: 'var(--color-border)', margin: '0 4px', flexShrink: 0 }} />

                    {/* ── INSERTION TOOLBAR — all types open the Hub ── */}
                    <span style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)', fontWeight: 600, marginRight: 2, whiteSpace: 'nowrap' }}>Inserir:</span>
                    {([['ETAPA', FolderOpen], ['SUBETAPA', GitBranch], ['COMPOSICAO', Layers], ['INSUMO', Package]] as [EngItemType, typeof FolderOpen][]).map(([type, Icon]) => {
                        const m = TYPE_META[type];
                        const handleClick = (e: React.MouseEvent) => {
                            e.preventDefault();
                            e.stopPropagation();
                            // All types open the Hub de Inserção
                            setInsertType(type);
                            setInsertTargetId(null);
                            setSearchQuery('');
                            setSearchResults([]);
                            setSearchQuantities({});
                            setAddedItemIds(new Set());
                            setAddedCount(0);
                            setShowSearch(true);
                        };
                        return (
                            <button key={type} onClick={handleClick}
                                style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 'var(--radius-md)', border: `1px solid ${m.color}20`, background: m.bg, cursor: 'pointer', fontSize: '0.73rem', fontWeight: 600, color: m.color, transition: 'all 0.15s', whiteSpace: 'nowrap' }}
                                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = `${m.color}18`; }}
                                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = m.bg; }}
                            >
                                <Icon size={12} /> {m.label}
                            </button>
                        );
                    })}
                </div>

                {/* FIX F2.1 + F2.2: Filter Bar + Collapse Controls */}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 14px', background: 'var(--color-bg-base)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', flexWrap: 'wrap' }}>
                    <Search size={14} color="var(--color-text-tertiary)" />
                    <input
                        ref={filterInputRef}
                        type="text"
                        placeholder="Buscar por descrição, código... (Ctrl+F)"
                        value={filterText}
                        onChange={e => setFilterText(e.target.value)}
                        style={{ flex: 1, minWidth: 180, padding: '4px 8px', fontSize: '0.8rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg-surface)', color: 'var(--color-text-primary)' }}
                    />
                    <select
                        value={filterType}
                        onChange={e => setFilterType(e.target.value)}
                        style={{ padding: '4px 8px', fontSize: '0.76rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg-surface)', color: 'var(--color-text-primary)', cursor: 'pointer' }}
                    >
                        <option value="">Todos os tipos</option>
                        <option value="ETAPA">Etapas</option>
                        <option value="SUBETAPA">Subetapas</option>
                        <option value="COMPOSICAO">Composições</option>
                        <option value="INSUMO">Insumos</option>
                    </select>
                    {(filterText || filterType) && (
                        <button onClick={() => { setFilterText(''); setFilterType(''); }}
                            className="btn btn-outline" style={{ padding: '3px 8px', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: 4 }}>
                            <X size={12} /> Limpar
                        </button>
                    )}
                    <div style={{ width: 1, height: 20, background: 'var(--color-border)' }} />
                    <button onClick={collapseAll} className="btn btn-outline"
                        style={{ padding: '3px 8px', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: 4 }}
                        title="Colapsar todas as etapas">
                        <ChevronRight size={12} /> Colapsar
                    </button>
                    <button onClick={expandAll} className="btn btn-outline"
                        style={{ padding: '3px 8px', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: 4 }}
                        title="Expandir todas as etapas">
                        <ChevronDown size={12} /> Expandir
                    </button>
                    <span style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)', fontWeight: 600, marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                        {(() => {
                            const shellCount = items.filter(it => it.type === 'COMPOSICAO' && (!it.insumos || it.insumos.length === 0) && it.unitCost === 0).length;
                            return shellCount > 0 ? (
                                <span style={{
                                    display: 'inline-flex', alignItems: 'center', gap: 4,
                                    padding: '2px 8px', borderRadius: 12,
                                    background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)',
                                    color: '#d97706', fontSize: '0.68rem', fontWeight: 700,
                                    animation: 'shellPulse 2s ease-in-out infinite',
                                }} title={`${shellCount} composição(ões) precisam de detalhamento analítico (insumos, mão de obra, equipamentos)`}>
                                    <AlertTriangle size={11} />
                                    {shellCount} {shellCount === 1 ? 'casca pendente' : 'cascas pendentes'}
                                </span>
                            ) : null;
                        })()}
                        {visibleItems.filter(v => v.visible).length}/{items.length} itens
                    </span>
                </div>
            </>)}

            {/* Tab Content: Hub de Insumos */}
            {activeTab === 'hub_insumos' && (
                <InsumoHub proposalId={proposalId} clientItems={items} engineeringConfig={engineeringConfig} />
            )}

            {/* Tab Content: Curva ABC */}
            {activeTab === 'curva_abc' && (
                <CurvaAbcPanel items={items} />
            )}

            {/* Tab Content: Cronograma */}
            {activeTab === 'cronograma' && (
                <CronogramaPanel
                    items={items}
                    savedData={cronogramaData}
                    onDataChange={(data) => { setHasUnsavedChanges(true); setCronogramaData(data); }}
                />
            )}

            {/* Tab Content: Encargos Sociais */}
            {activeTab === 'encargos_sociais' && (
                <div style={{ padding: 24 }}>
                    <div style={{ background: 'var(--color-bg-surface)', padding: 24, borderRadius: 12, border: '1px solid var(--color-border)', maxWidth: 900 }}>
                        <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '1.2rem', marginBottom: 8, color: 'var(--color-primary)' }}>
                            <Calculator size={24} /> Composição de Encargos Sociais
                        </h2>
                        <p style={{ fontSize: '0.82rem', color: 'var(--color-text-tertiary)', marginBottom: 24 }}>
                            Defina as alíquotas que compõem os encargos sociais sobre a mão de obra (horista e mensalista). Estes valores são usados na composição analítica das CPUs.
                        </p>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 24 }}>
                            {/* Grupo A — Encargos Básicos */}
                            <div style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: 16 }}>
                                <h4 style={{ margin: '0 0 12px', fontSize: '0.85rem', color: '#1e40af', fontWeight: 700 }}>Grupo A — Encargos Básicos</h4>
                                {[
                                    { key: 'inss', label: 'INSS', default: 20.0 },
                                    { key: 'sesi_sesc', label: 'SESI / SESC', default: 1.5 },
                                    { key: 'senai_senac', label: 'SENAI / SENAC', default: 1.0 },
                                    { key: 'incra', label: 'INCRA', default: 0.2 },
                                    { key: 'sebrae', label: 'SEBRAE', default: 0.6 },
                                    { key: 'salario_educacao', label: 'Salário Educação', default: 2.5 },
                                    { key: 'seguro_acidente', label: 'Seguro Ac. Trabalho (RAT)', default: 3.0 },
                                    { key: 'fgts', label: 'FGTS', default: 8.0 },
                                ].map(item => (
                                    <div key={item.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--color-border)' }}>
                                        <span style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>{item.label}</span>
                                        <input type="number" step="0.01" className="form-input"
                                            value={(engineeringConfig.encargosSociais as any)?.[item.key] ?? item.default}
                                            onChange={e => updateEngineeringConfig({ ...engineeringConfig, encargosSociais: { ...engineeringConfig.encargosSociais, [item.key]: parseLocaleNumber(e.target.value) } })}
                                            style={{ width: 80, padding: '3px 6px', fontSize: '0.82rem', textAlign: 'right' }} />
                                    </div>
                                ))}
                            </div>

                            {/* Grupo B — Encargos Trabalhistas */}
                            <div style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: 16 }}>
                                <h4 style={{ margin: '0 0 12px', fontSize: '0.85rem', color: '#6d28d9', fontWeight: 700 }}>Grupo B — Encargos Trabalhistas</h4>
                                {[
                                    { key: 'ferias', label: '13º Salário', default: 8.33 },
                                    { key: 'ferias_abono', label: 'Férias + 1/3', default: 12.10 },
                                    { key: 'aviso_previo', label: 'Aviso Prévio Indenizado', default: 0.42 },
                                    { key: 'auxilio_doenca', label: 'Aux. Enfermidade', default: 0.79 },
                                    { key: 'faltas_justificadas', label: 'Faltas Justificadas', default: 0.73 },
                                    { key: 'acidente_trabalho', label: 'Acidente de Trabalho', default: 0.07 },
                                    { key: 'licenca_paternidade', label: 'Licença Paternidade', default: 0.02 },
                                    { key: 'multa_fgts', label: 'Multa Rescisória FGTS', default: 3.20 },
                                ].map(item => (
                                    <div key={item.key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--color-border)' }}>
                                        <span style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)' }}>{item.label}</span>
                                        <input type="number" step="0.01" className="form-input"
                                            value={(engineeringConfig.encargosSociais as any)?.[item.key] ?? item.default}
                                            onChange={e => updateEngineeringConfig({ ...engineeringConfig, encargosSociais: { ...engineeringConfig.encargosSociais, [item.key]: parseLocaleNumber(e.target.value) } })}
                                            style={{ width: 80, padding: '3px 6px', fontSize: '0.82rem', textAlign: 'right' }} />
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Totals */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
                            <div style={{ padding: 16, borderRadius: 8, background: 'rgba(30,64,175,0.04)', border: '1px solid rgba(30,64,175,0.15)', textAlign: 'center' }}>
                                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#1e40af', textTransform: 'uppercase', marginBottom: 4 }}>Total Horista</div>
                                <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#1e40af' }}>{(engineeringConfig.encargosSociais?.horista || 0).toFixed(2)}%</div>
                                <input type="number" step="0.01" className="form-input" value={engineeringConfig.encargosSociais?.horista || 0}
                                    onChange={e => updateEngineeringConfig({ ...engineeringConfig, encargosSociais: { ...engineeringConfig.encargosSociais, horista: parseLocaleNumber(e.target.value) } })}
                                    style={{ width: '100%', marginTop: 8, textAlign: 'center', fontSize: '0.85rem', fontWeight: 600 }} />
                            </div>
                            <div style={{ padding: 16, borderRadius: 8, background: 'rgba(109,40,217,0.04)', border: '1px solid rgba(109,40,217,0.15)', textAlign: 'center' }}>
                                <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#6d28d9', textTransform: 'uppercase', marginBottom: 4 }}>Total Mensalista</div>
                                <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#6d28d9' }}>{(engineeringConfig.encargosSociais?.mensalista || 0).toFixed(2)}%</div>
                                <input type="number" step="0.01" className="form-input" value={engineeringConfig.encargosSociais?.mensalista || 0}
                                    onChange={e => updateEngineeringConfig({ ...engineeringConfig, encargosSociais: { ...engineeringConfig.encargosSociais, mensalista: parseLocaleNumber(e.target.value) } })}
                                    style={{ width: '100%', marginTop: 8, textAlign: 'center', fontSize: '0.85rem', fontWeight: 600 }} />
                            </div>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 16, marginTop: 16, borderTop: '1px solid var(--color-border)' }}>
                            <button className="btn btn-primary" onClick={handleSave} disabled={isSaving}>
                                {isSaving ? <Loader2 size={16} className="spin" /> : <Save size={16} />}
                                Salvar Encargos
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'caderno' && (
                <BudgetDocsPanel items={items} bdiConfig={bdiConfig} effectiveBdi={effectiveBdi} insumos={consolidatedInsumos} cronogramaResult={cronogramaResult} proposalId={proposalId} engineeringConfig={engineeringConfig} />
            )}

            {/* Tab Content: Planilha */}
            {activeTab === 'planilha' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 'var(--space-4)' }}>

                {/* FIX F5.4: Batch Actions Bar */}
                {selectedIds.size > 0 && (
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', marginBottom: 6,
                        background: 'linear-gradient(135deg, rgba(37,99,235,0.06), rgba(139,92,246,0.04))',
                        borderRadius: 'var(--radius-md)', border: '1px solid rgba(37,99,235,0.15)',
                    }}>
                        <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--color-primary)' }}>
                            {selectedIds.size} selecionado(s)
                        </span>
                        <div style={{ width: 1, height: 18, background: 'var(--color-border)' }} />
                        <button onClick={deleteSelected} className="btn btn-outline"
                            style={{ padding: '3px 10px', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: 4, color: 'var(--color-danger)', borderColor: 'rgba(239,68,68,0.3)' }}>
                            <Trash2 size={12} /> Remover ({selectedIds.size})
                        </button>
                        <button onClick={() => changeTypeSelected('COMPOSICAO')} className="btn btn-outline"
                            style={{ padding: '3px 10px', fontSize: '0.72rem' }}>
                            → Composição
                        </button>
                        <button onClick={() => changeTypeSelected('INSUMO')} className="btn btn-outline"
                            style={{ padding: '3px 10px', fontSize: '0.72rem' }}>
                            → Insumo
                        </button>
                        <button onClick={clearSelection} className="btn btn-outline"
                            style={{ padding: '3px 10px', fontSize: '0.72rem', marginLeft: 'auto' }}>
                            <X size={12} /> Limpar seleção
                        </button>
                    </div>
                )}

                {/* Table */}
                <div style={{ background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', overflow: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', minWidth: 1400 }}>
                        <thead>
                            <tr style={{ background: 'var(--color-bg-base)', borderBottom: '1px solid var(--color-border)' }}>
                                {/* FIX F5.4: Select All checkbox */}
                                <th style={{ padding: '10px 4px', width: 28, textAlign: 'center' }}>
                                    <input type="checkbox"
                                        checked={selectedIds.size > 0 && selectedIds.size >= items.filter(it => !isGrouper(it.type)).length}
                                        onChange={e => e.target.checked ? selectAll() : clearSelection()}
                                        style={{ width: 14, height: 14, accentColor: 'var(--color-primary)', cursor: 'pointer' }}
                                    />
                                </th>
                                {['Item','Tipo','Base','Código','Descrição do Serviço','Unid.','Qtd.','Custo (S/ BDI)','Preço (C/ BDI)','Total','Auditoria',''].map((h,i) => (
                                    <th key={i} style={{ padding: '10px 8px', textAlign: i >= 6 ? 'right' : 'left', color: i === 8 || i === 9 ? 'var(--color-primary)' : 'var(--color-text-secondary)', fontWeight: i === 9 ? 800 : i === 8 ? 700 : 600, fontSize: '0.72rem', whiteSpace: 'nowrap', width: i === 4 ? 'auto' : i === 0 ? 150 : i === 1 ? 100 : i === 2 ? 65 : i === 3 ? 90 : i === 5 ? 50 : i === 6 ? 85 : i === 7 ? 110 : i === 8 ? 110 : i === 9 ? 110 : i === 10 ? 90 : 40 }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                            <SortableContext items={items.map(it => it.id)} strategy={verticalListSortingStrategy}>
                            <tbody>
                            {visibleItems.map(({ item: it, visible }, idx) => {
                                if (!visible) return null;
                                const meta = TYPE_META[it.type || 'COMPOSICAO'];
                                const isGroup = isGrouper(it.type);
                                const depth = getDepth(it.itemNumber);
                                const IconComp = meta.icon;
                                const isCollapsed = collapsedGroupers.has(it.id);

                                // ── ETAPA / SUBETAPA ROW (header style) ──

                                if (isGroup) {
                                    return (
                                        <SortableRow key={it.id} id={it.id}>
                                            {(listeners: any) => (
                                                <>
                                                    {/* F5.4: Empty checkbox for grouper */}
                                                    <td style={{ padding: '8px 4px', width: 28 }} />
                                                    <td style={{ padding: '8px 12px', fontWeight: 800, color: meta.color, fontSize: '0.85rem' }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, paddingLeft: Math.min(depth, 4) * 12 }}>
                                                            <button {...listeners} style={{ cursor: 'grab', background: 'none', border: 'none', padding: 0, color: meta.color, opacity: 0.5, display: 'flex' }}><GripVertical size={14} /></button>
                                                            <button onClick={() => toggleCollapse(it.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: meta.color, display: 'flex', transition: 'transform 0.15s' }}>
                                                                {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                                                            </button>
                                                            {it.itemNumber}
                                                        </div>
                                                    </td>
                                            <td style={{ padding: '6px 8px' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 8px', borderRadius: 4, background: meta.bg, color: meta.color, fontSize: '0.68rem', fontWeight: 700 }}>
                                                        <IconComp size={11} /> {meta.label}
                                                    </span>
                                                    <button title={`Configurações da ${it.type === 'ETAPA' ? 'Etapa' : 'Subetapa'}${it.multiplicationFactor && it.multiplicationFactor > 1 ? ` (Fator: ×${it.multiplicationFactor})` : ''}`}
                                                        onClick={() => setCompositionEditorIndex(items.indexOf(it))}
                                                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, opacity: it.multiplicationFactor && it.multiplicationFactor > 1 ? 1 : 0.5, flexShrink: 0, position: 'relative', display: 'flex', alignItems: 'center' }}
                                                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}
                                                        onMouseLeave={e => { if (!(it.multiplicationFactor && it.multiplicationFactor > 1)) (e.currentTarget as HTMLElement).style.opacity = '0.5'; }}
                                                    >
                                                        <Settings size={13} color={meta.color} />
                                                        {it.multiplicationFactor && it.multiplicationFactor > 1 && (
                                                            <span style={{ position: 'absolute', top: -5, right: -8, fontSize: '0.55rem', fontWeight: 800, color: '#fff', background: meta.color, borderRadius: '50%', width: 14, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>
                                                                ×{it.multiplicationFactor}
                                                            </span>
                                                        )}
                                                    </button>
                                                </div>
                                            </td>
                                                    <td colSpan={6} style={{ padding: '8px 12px' }}>
                                                        <input value={it.description} onChange={e => updateItem(it.id, 'description', e.target.value)} 
                                                            style={{ ...inputStyle(), fontWeight: 700, fontSize: '0.85rem', color: meta.color, background: 'transparent', border: '1px solid transparent', paddingLeft: depth > 0 ? 16 : 0 }}
                                                            onFocus={e => { e.currentTarget.style.border = `1px solid ${meta.color}30`; }}
                                                            onBlur={e => { e.currentTarget.style.border = '1px solid transparent'; }}
                                                        />
                                                    </td>
                                                    {(() => {
                                                        const grouperIdx = items.indexOf(it);
                                                        const grouperTotal = computeGrouperSubtotal(items, grouperIdx);
                                                        const pctPeso = total > 0 ? (grouperTotal / total * 100) : 0;
                                                        // F2.1: Count hidden children when collapsed
                                                        let childCount = 0;
                                                        if (isCollapsed) {
                                                            const gDepth = getDepth(it.itemNumber);
                                                            for (let ci = grouperIdx + 1; ci < items.length; ci++) {
                                                                const child = items[ci];
                                                                if (isGrouper(child.type) && getDepth(child.itemNumber) <= gDepth) break;
                                                                if (!isGrouper(child.type)) childCount++;
                                                            }
                                                        }
                                                        return (
                                                            <>
                                                                <td style={{ padding: '6px 8px', textAlign: 'right', fontSize: '0.68rem', color: 'var(--color-text-tertiary)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                                                                    {pctPeso > 0 ? `${pctPeso.toFixed(1)}%` : ''}
                                                                    {isCollapsed && childCount > 0 && (
                                                                        <span style={{ marginLeft: 4, padding: '1px 5px', borderRadius: 8, background: `${meta.color}12`, color: meta.color, fontSize: '0.62rem', fontWeight: 700 }}>{childCount} itens</span>
                                                                    )}
                                                                </td>
                                                                <td />
                                                                <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 800, fontSize: '0.82rem', color: meta.color, whiteSpace: 'nowrap' }}>
                                                                    {grouperTotal > 0 ? fmt(grouperTotal) : ''}
                                                                </td>
                                                            </>
                                                        );
                                                    })()}
                                                    <td style={{ padding: '6px 8px', textAlign: 'center', position: 'relative', width: 40 }}>
                                                        {hoveredRowId === it.id && (
                                                            <div style={{ position: 'absolute', right: 38, top: '50%', transform: 'translateY(-50%)', display: 'flex', gap: 4, alignItems: 'center', background: 'var(--color-bg-surface)', padding: '4px 8px', borderRadius: 'var(--radius-md)', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', border: '1px solid var(--color-border)', zIndex: 10 }}>
                                                                <span style={{ fontSize: '0.65rem', color: 'var(--color-text-tertiary)', fontWeight: 600, marginRight: 4, whiteSpace: 'nowrap' }}>Inserir:</span>
                                                                {([['ETAPA', FolderOpen], ['SUBETAPA', GitBranch], ['COMPOSICAO', Layers], ['INSUMO', Package]] as [EngItemType, typeof FolderOpen][]).map(([t, Icon]) => {
                                                                    const m = TYPE_META[t];
                                                                    const handleClick = (e: React.MouseEvent) => {
                                                                        e.preventDefault();
                                                                        e.stopPropagation();
                                                                        // All types open the Hub de Inserção
                                                                        setInsertType(t);
                                                                        setInsertTargetId(it.id);
                                                                        setSearchQuery('');
                                                                        setSearchResults([]);
                                                                        setSearchQuantities({});
                                                                        setAddedItemIds(new Set());
                                                                        setAddedCount(0);
                                                                        setShowSearch(true);
                                                                    };
                                                                    return (
                                                                        <button key={t} onClick={handleClick} onPointerDown={e => e.stopPropagation()} title={`Inserir ${m.label}`}
                                                                            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px 6px', borderRadius: 4, border: `1px solid ${m.color}30`, background: m.bg, cursor: 'pointer', color: m.color, transition: 'all 0.15s' }}
                                                                            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = `${m.color}20`; }}
                                                                            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = m.bg; }}>
                                                                            <Icon size={13} />
                                                                        </button>
                                                                    );
                                                                })}
                                                            </div>
                                                        )}
                                                        <button className="prop-icon-btn" onClick={() => removeItem(it.id)}><Trash2 size={14} color="var(--color-danger)" /></button>
                                                    </td>
                                                </>
                                            )}
                                        </SortableRow>
                                    );
                                }

                                // ── COMPOSICAO / INSUMO ROW (data row) ──
                                const hasInsumos = it.type === 'COMPOSICAO' && it.insumos && it.insumos.length > 0;
                                const isShell = it.type === 'COMPOSICAO' && (!it.insumos || it.insumos.length === 0) && it.unitCost === 0;
                                const isExpanded = expandedItems.has(it.id);
                                const rows = [];

                                rows.push(
                                    <SortableRow key={it.id} id={it.id}>
                                        {(listeners: any) => (
                                            <>
                                                {/* FIX F5.4: Row checkbox */}
                                                <td style={{ padding: '6px 4px', textAlign: 'center', width: 28 }}>
                                                    <input type="checkbox" checked={selectedIds.has(it.id)} onChange={() => toggleSelect(it.id)}
                                                        style={{ width: 13, height: 13, accentColor: 'var(--color-primary)', cursor: 'pointer' }}
                                                    />
                                                </td>
                                                <td style={{ padding: '6px 12px' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 2, paddingLeft: Math.min(depth, 4) * 12 }}>
                                                        <button {...listeners} style={{ cursor: 'grab', background: 'none', border: 'none', padding: 0, color: 'var(--color-text-tertiary)', display: 'flex', marginRight: 4 }}><GripVertical size={14} /></button>
                                                        {hasInsumos && (
                                                            <button onClick={() => toggleExpand(it.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: meta.color, display: 'flex' }}>
                                                                {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                                                            </button>
                                                        )}
                                                        <input value={it.itemNumber} onChange={e => updateItem(it.id, 'itemNumber', e.target.value)} style={{ ...inputStyle(hasInsumos ? '80px' : '100px'), fontWeight: 700 }} />
                                                    </div>
                                                </td>
                                        <td style={{ padding: '6px 8px' }}>
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 4px', borderRadius: 4, background: meta.bg, color: meta.color, fontSize: '0.62rem', fontWeight: 700, whiteSpace: 'nowrap' }} title={meta.label}>
                                                <IconComp size={10} style={{ flexShrink: 0 }} /> <span>{meta.label}</span>
                                            </span>
                                            {engineeringConfig.bdiDiferenciado && !isGrouper(it.type) && (
                                                <select
                                                    value={it.bdiCategoria || 'OBRA'}
                                                    onChange={e => updateItem(it.id, 'bdiCategoria', e.target.value as BdiCategoria)}
                                                    style={{
                                                        display: 'block', marginTop: 2, fontSize: '0.6rem', fontWeight: 700,
                                                        padding: '1px 4px', border: '1px solid transparent', borderRadius: 3,
                                                        background: (it.bdiCategoria || 'OBRA') === 'FORNECIMENTO' ? 'rgba(180,83,9,0.08)' : 'rgba(37,99,235,0.05)',
                                                        color: (it.bdiCategoria || 'OBRA') === 'FORNECIMENTO' ? '#b45309' : 'var(--color-primary)',
                                                        cursor: 'pointer', width: '100%',
                                                    }}
                                                >
                                                    <option value="OBRA">Obra</option>
                                                    <option value="FORNECIMENTO">Fornec.</option>
                                                </select>
                                            )}
                                        </td>
                                        <td style={{ padding: '6px 8px' }}>
                                            {it.sourceName && <span style={{ background: it.sourceName === 'PROPRIA' ? 'var(--color-success-light)' : 'rgba(37,99,235,0.08)', color: it.sourceName === 'PROPRIA' ? 'var(--color-success)' : 'var(--color-primary)', padding: '2px 6px', borderRadius: 4, fontSize: '0.68rem', fontWeight: 700, whiteSpace: 'nowrap' }}>{it.sourceName}</span>}
                                        </td>
                                        <td style={{ padding: '6px 8px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                                <input value={it.code} onChange={e => updateItem(it.id, 'code', e.target.value)} style={{ ...inputStyle('86px'), color: 'var(--color-text-secondary)', fontFamily: 'var(--font-mono)' }} />
                                                {it.type === 'COMPOSICAO' && it.code && it.code !== 'N/A' && (
                                                    <button title="Editar composição" onClick={() => setCompositionEditorIndex(items.indexOf(it))} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, opacity: 0.5, flexShrink: 0 }}
                                                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}
                                                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '0.5'; }}
                                                    >
                                                        <Layers size={13} color="var(--color-primary)" />
                                                    </button>
                                                )}
                                                {isGrouper(it.type) && (
                                                    <button title={`Configurações da ${it.type === 'ETAPA' ? 'Etapa' : 'Subetapa'}${it.multiplicationFactor && it.multiplicationFactor > 1 ? ` (Fator: ×${it.multiplicationFactor})` : ''}`}
                                                        onClick={() => setCompositionEditorIndex(items.indexOf(it))}
                                                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, opacity: it.multiplicationFactor && it.multiplicationFactor > 1 ? 1 : 0.5, flexShrink: 0, position: 'relative' }}
                                                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}
                                                        onMouseLeave={e => { if (!(it.multiplicationFactor && it.multiplicationFactor > 1)) (e.currentTarget as HTMLElement).style.opacity = '0.5'; }}
                                                    >
                                                        <Settings size={13} color="#d97706" />
                                                        {it.multiplicationFactor && it.multiplicationFactor > 1 && (
                                                            <span style={{ position: 'absolute', top: -4, right: -6, fontSize: '0.55rem', fontWeight: 800, color: '#fff', background: '#d97706', borderRadius: '50%', width: 14, height: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>
                                                                ×{it.multiplicationFactor}
                                                            </span>
                                                        )}
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                        <td style={{ padding: '6px 8px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                                <input value={it.description} title={it.description} onChange={e => updateItem(it.id, 'description', e.target.value)} style={{ ...inputStyle(), fontWeight: 500, flex: 1, ...(isShell ? { borderColor: 'rgba(245,158,11,0.4)', background: 'rgba(245,158,11,0.03)' } : {}) }} />
                                                {isShell && (
                                                    <button
                                                        title="Esta composição é apenas uma casca sem detalhamento analítico. Clique para abrir o editor e inserir insumos, mão de obra e equipamentos."
                                                        onClick={() => setCompositionEditorIndex(items.indexOf(it))}
                                                        style={{
                                                            display: 'inline-flex', alignItems: 'center', gap: 3,
                                                            padding: '2px 7px', borderRadius: 10,
                                                            background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)',
                                                            color: '#d97706', fontSize: '0.58rem', fontWeight: 800,
                                                            cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
                                                            transition: 'all 0.15s',
                                                            letterSpacing: '0.3px',
                                                        }}
                                                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(245,158,11,0.2)'; (e.currentTarget as HTMLElement).style.transform = 'scale(1.05)'; }}
                                                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(245,158,11,0.1)'; (e.currentTarget as HTMLElement).style.transform = 'scale(1)'; }}
                                                    >
                                                        <span style={{ width: 5, height: 5, borderRadius: '50%', background: '#f59e0b', animation: 'shellDot 1.5s ease-in-out infinite', flexShrink: 0 }} />
                                                        CASCA
                                                    </button>
                                                )}
                                                {/* FIX F5.5: Notes icon */}
                                                <button
                                                    title={it.notes ? `Nota: ${it.notes}` : 'Adicionar observação'}
                                                    onClick={() => setEditingNotesId(editingNotesId === it.id ? null : it.id)}
                                                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, opacity: it.notes ? 1 : 0.3, flexShrink: 0, display: 'flex', transition: 'opacity 0.15s' }}
                                                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}
                                                    onMouseLeave={e => { if (!it.notes) (e.currentTarget as HTMLElement).style.opacity = '0.3'; }}
                                                >
                                                    <StickyNote size={12} color={it.notes ? '#d97706' : 'var(--color-text-tertiary)'} />
                                                </button>
                                            </div>
                                            {/* FIX F5.5: Notes popover */}
                                            {editingNotesId === it.id && (
                                                <div style={{ marginTop: 4, padding: '6px 8px', background: 'rgba(245,158,11,0.05)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 'var(--radius-sm)' }}>
                                                    <textarea
                                                        value={it.notes || ''}
                                                        onChange={e => updateItem(it.id, 'notes', e.target.value)}
                                                        placeholder="Observação..."
                                                        rows={2}
                                                        style={{ width: '100%', fontSize: '0.7rem', border: 'none', background: 'transparent', resize: 'vertical', outline: 'none', color: 'var(--color-text-primary)', fontFamily: 'inherit' }}
                                                        autoFocus
                                                    />
                                                </div>
                                            )}
                                        </td>
                                        <td style={{ padding: '6px 8px' }}>
                                            <input value={it.unit} onChange={e => updateItem(it.id, 'unit', e.target.value)} style={{ ...inputStyle('48px'), textAlign: 'center', padding: '4px' }} />
                                        </td>
                                        <td style={{ padding: '6px 8px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
                                                <input type="number" value={it.quantity} onChange={e => updateItem(it.id, 'quantity', parseLocaleNumber(e.target.value))} style={{ ...inputStyle('72px'), textAlign: 'right' }} step="0.01" />
                                                {!isGrouper(it.type) && (
                                                    <button
                                                        onClick={() => setActiveCalcItem(it)}
                                                        title="Memória de Cálculo"
                                                        style={{
                                                            background: 'none',
                                                            border: 'none',
                                                            cursor: 'pointer',
                                                            padding: '2px 4px',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'center',
                                                            opacity: it.calculationMemory ? 1 : 0.4,
                                                            color: it.calculationMemory ? '#f59e0b' : 'var(--color-text-secondary)',
                                                            transition: 'opacity 0.2s, color 0.2s',
                                                        }}
                                                        onMouseEnter={e => { e.currentTarget.style.opacity = '1'; }}
                                                        onMouseLeave={e => { if (!it.calculationMemory) e.currentTarget.style.opacity = '0.4'; }}
                                                    >
                                                        <Calculator size={14} />
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                        <td style={{ padding: '6px 8px' }}>
                                            {it.unitCost === 0 ? (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end', color: isShell ? '#d97706' : 'var(--color-danger)' }}>
                                                    <span title={isShell ? "CASCA: Esta composição precisa de detalhamento analítico. Clique no ícone de composição (🔷) ao lado do código para abrir o editor e inserir insumos, mão de obra e equipamentos." : "Item sem preço unitário."} style={{ display: 'flex', cursor: isShell ? 'pointer' : 'default' }} onClick={isShell ? () => setCompositionEditorIndex(items.indexOf(it)) : undefined}>
                                                        {isShell ? <AlertTriangle size={14} /> : <AlertCircle size={14} />}
                                                    </span>
                                                    <input type="number" value={it.unitCost} onChange={e => updateItem(it.id, 'unitCost', parseLocaleNumber(e.target.value))} style={{ ...inputStyle('100px'), textAlign: 'right', color: isShell ? '#d97706' : 'var(--color-danger)', fontWeight: 700, border: `1px solid ${isShell ? 'rgba(245,158,11,0.4)' : 'var(--color-danger)'}` }} step="0.01" />
                                                </div>
                                            ) : (
                                                <input type="number" value={it.unitCost} onChange={e => updateItem(it.id, 'unitCost', parseLocaleNumber(e.target.value))} style={{ ...inputStyle('100px'), textAlign: 'right' }} step="0.01" />
                                            )}
                                            {/* FIX F5.6: Discount input */}
                                            {(it.discount && it.discount > 0) || hoveredRowId === it.id ? (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginTop: 2, justifyContent: 'flex-end' }}>
                                                    <span style={{ fontSize: '0.58rem', color: '#059669', fontWeight: 700 }}>Desc:</span>
                                                    <input
                                                        type="number" value={it.discount || 0} min={0} max={100} step={0.5}
                                                        onChange={e => updateItem(it.id, 'discount', parseLocaleNumber(e.target.value))}
                                                        style={{ width: 44, fontSize: '0.6rem', padding: '1px 3px', textAlign: 'right', border: '1px solid rgba(34,197,94,0.3)', borderRadius: 3, background: 'rgba(34,197,94,0.04)', color: '#059669', fontWeight: 700 }}
                                                    />
                                                    <span style={{ fontSize: '0.58rem', color: '#059669' }}>%</span>
                                                </div>
                                            ) : null}
                                        </td>
                                        <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, color: it.unitCost === 0 ? 'var(--color-danger)' : 'var(--color-primary)' }}>{fmt(it.unitPrice)}</td>
                                        <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 800, color: 'var(--color-primary)', fontSize: '0.82rem' }}>{fmt(it.totalPrice)}</td>
                                                <td style={{ padding: '6px 8px', textAlign: 'center' }}>{renderPriceAudit(it, () => applyBasePriceToItem(it.id))}</td>
                                                <td style={{ padding: '6px 8px', textAlign: 'center', position: 'relative', width: 40 }}>
                                                    {hoveredRowId === it.id && (
                                                        <div style={{ position: 'absolute', right: 38, top: '50%', transform: 'translateY(-50%)', display: 'flex', gap: 4, alignItems: 'center', background: 'var(--color-bg-surface)', padding: '4px 8px', borderRadius: 'var(--radius-md)', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', border: '1px solid var(--color-border)', zIndex: 10 }}>
                                                            <span style={{ fontSize: '0.65rem', color: 'var(--color-text-tertiary)', fontWeight: 600, marginRight: 4, whiteSpace: 'nowrap' }}>Inserir:</span>
                                                            {([['ETAPA', FolderOpen], ['SUBETAPA', GitBranch], ['COMPOSICAO', Layers], ['INSUMO', Package]] as [EngItemType, typeof FolderOpen][]).map(([t, Icon]) => {
                                                                const m = TYPE_META[t];
                                                                const handleClick = (e: React.MouseEvent) => {
                                                                    e.preventDefault();
                                                                    e.stopPropagation();
                                                                    // All types open the Hub de Inserção
                                                                    setInsertType(t);
                                                                    setInsertTargetId(it.id);
                                                                    setSearchQuery('');
                                                                    setSearchResults([]);
                                                                    setSearchQuantities({});
                                                                    setAddedItemIds(new Set());
                                                                    setAddedCount(0);
                                                                    setShowSearch(true);
                                                                };
                                                                return (
                                                                    <button key={t} onClick={handleClick} onPointerDown={e => e.stopPropagation()} title={`Inserir ${m.label}`}
                                                                        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4px 6px', borderRadius: 4, border: `1px solid ${m.color}30`, background: m.bg, cursor: 'pointer', color: m.color, transition: 'all 0.15s' }}
                                                                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = `${m.color}20`; }}
                                                                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = m.bg; }}>
                                                                        <Icon size={13} />
                                                                    </button>
                                                                );
                                                            })}
                                                        </div>
                                                    )}
                                                    <button className="prop-icon-btn" onClick={() => removeItem(it.id)}><Trash2 size={14} color="var(--color-danger)" /></button>
                                                </td>
                                            </>
                                        )}
                                    </SortableRow>
                                );

                                // ── EXPANDED INSUMO DETAIL ROWS ──
                                if (hasInsumos && isExpanded) {
                                    const TYPE_LABELS: Record<string, { label: string; color: string }> = {
                                        'MATERIAL': { label: 'Material', color: '#b45309' },
                                        'MAO_DE_OBRA': { label: 'Mão de Obra', color: '#0369a1' },
                                        'EQUIPAMENTO': { label: 'Equipamento', color: '#7c3aed' },
                                    };
                                    rows.push(
                                        <tr key={`${it.id}-insumos`} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                            <td colSpan={12} style={{ padding: 0 }}>
                                                <div style={{ margin: '0 16px 8px 40px', borderRadius: 'var(--radius-md)', border: '1px solid rgba(14,116,144,0.12)', overflow: 'hidden', background: 'rgba(14,116,144,0.02)' }}>
                                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem' }}>
                                                        <thead>
                                                            <tr style={{ background: 'rgba(14,116,144,0.06)' }}>
                                                                <th style={{ padding: '5px 10px', textAlign: 'left', color: '#0e7490', fontWeight: 700, fontSize: '0.65rem' }}>Tipo</th>
                                                                <th style={{ padding: '5px 10px', textAlign: 'left', color: '#0e7490', fontWeight: 700, fontSize: '0.65rem' }}>Descrição do Insumo</th>
                                                                <th style={{ padding: '5px 10px', textAlign: 'center', color: '#0e7490', fontWeight: 700, fontSize: '0.65rem' }}>Unid.</th>
                                                                <th style={{ padding: '5px 10px', textAlign: 'right', color: '#0e7490', fontWeight: 700, fontSize: '0.65rem' }}>Coef.</th>
                                                                <th style={{ padding: '5px 10px', textAlign: 'right', color: '#0e7490', fontWeight: 700, fontSize: '0.65rem' }}>Preço Unit.</th>
                                                                <th style={{ padding: '5px 10px', textAlign: 'right', color: '#0e7490', fontWeight: 700, fontSize: '0.65rem' }}>Subtotal</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {it.insumos!.map((ins, idx) => {
                                                                const tl = TYPE_LABELS[ins.type] || { label: ins.type, color: '#666' };
                                                                return (
                                                                    <tr key={idx} style={{ borderTop: '1px solid rgba(14,116,144,0.08)' }}>
                                                                        <td style={{ padding: '4px 10px' }}>
                                                                            <span style={{ fontSize: '0.62rem', padding: '1px 5px', borderRadius: 3, background: `${tl.color}10`, color: tl.color, fontWeight: 600 }}>{tl.label}</span>
                                                                        </td>
                                                                        <td style={{ padding: '4px 10px', color: 'var(--color-text-primary)', fontWeight: 500 }}>{ins.description}</td>
                                                                        <td style={{ padding: '4px 10px', textAlign: 'center', color: 'var(--color-text-tertiary)' }}>{ins.unit}</td>
                                                                        <td style={{ padding: '4px 10px', textAlign: 'right', fontWeight: 500 }}>{ins.coefficient.toFixed(4)}</td>
                                                                        <td style={{ padding: '4px 10px', textAlign: 'right', fontWeight: 500 }}>{fmt(ins.unitPrice)}</td>
                                                                        <td style={{ padding: '4px 10px', textAlign: 'right', fontWeight: 700, color: '#0e7490' }}>{fmt(ins.coefficient * ins.unitPrice)}</td>
                                                                    </tr>
                                                                );
                                                            })}
                                                            <tr style={{ borderTop: '1px solid rgba(14,116,144,0.15)', background: 'rgba(14,116,144,0.04)' }}>
                                                                <td colSpan={5} style={{ padding: '5px 10px', textAlign: 'right', fontWeight: 700, color: '#0e7490', fontSize: '0.7rem' }}>Total da Composição:</td>
                                                                <td style={{ padding: '5px 10px', textAlign: 'right', fontWeight: 800, color: '#0e7490', fontSize: '0.75rem' }}>
                                                                    {fmt(it.insumos!.reduce((s, ins) => s + ins.coefficient * ins.unitPrice, 0))}
                                                                </td>
                                                            </tr>
                                                        </tbody>
                                                    </table>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                }

                                return rows;
                            })}
                            {items.length === 0 && (
                                <tr><td colSpan={10} style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-tertiary)' }}>
                                    {extractionMeta?.status === 'empty_extraction' ? (
                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
                                            <div style={{ padding: '12px 16px', background: 'rgba(217,119,6,0.1)', borderRadius: 8, color: '#b45309', maxWidth: 600 }}>
                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontWeight: 700, marginBottom: 8 }}>
                                                    <AlertTriangle size={18} />
                                                    Nenhum item foi extraído
                                                </div>
                                                <ul style={{ textAlign: 'left', fontSize: '0.8rem', margin: 0, paddingLeft: 20 }}>
                                                    {(extractionMeta.possibleCauses || []).map((cause: string, i: number) => (
                                                        <li key={i}>{cause}</li>
                                                    ))}
                                                </ul>
                                            </div>
                                            <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                                                <button className="btn btn-outline" onClick={() => handleExtractAI({ forceRestart: true })} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                    <Wand2 size={14} /> Tentar novamente (Forçar)
                                                </button>
                                                <button className="btn btn-primary" onClick={() => fileInputRef.current?.click()} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                    <Upload size={14} /> Fazer upload manual
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        <span>Planilha vazia — Use "Extrair via IA" ou adicione itens manualmente</span>
                                    )}
                                </td></tr>
                            )}
                            </tbody>
                            </SortableContext>
                        </DndContext>
                    </table>

                    {/* Insertion toolbar moved to the sticky contextual toolbar above */}
                </div>

                {/* Sidebar: Config + BDI + Totals */}
                    {/* ═══ Dashboard Resumo da Configuração (Step 1) ═══ */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>

                        {/* Objeto */}
                        <div style={{ background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', padding: 'var(--space-3) var(--space-4)' }}>
                            <div style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Objeto da Obra</div>
                            <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--color-text-primary)', lineHeight: 1.4 }}>
                                {dashConfig?.objeto || <span style={{ color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>Não definido</span>}
                            </div>
                        </div>

                        {/* Config Cards Grid */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                            {/* UF */}
                            <div style={{ background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', padding: '10px 12px', textAlign: 'center' }}>
                                <div style={{ fontSize: '0.6rem', fontWeight: 800, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>UF</div>
                                <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--color-primary)' }}>{dashConfig?.ufReferencia || '—'}</div>
                            </div>
                            {/* Regime */}
                            <div style={{ background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', padding: '10px 12px', textAlign: 'center' }}>
                                <div style={{ fontSize: '0.6rem', fontWeight: 800, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>Desoneração</div>
                                <div style={{ fontSize: '0.85rem', fontWeight: 800, color: dashConfig?.regimeOneracao === 'ONERADO' ? '#b45309' : '#059669' }}>
                                    {dashConfig?.regimeOneracao || 'DESONERADO'}
                                </div>
                            </div>
                        </div>

                        {/* Bases de Referência */}
                        <div style={{ background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', padding: '10px 12px' }}>
                            <div style={{ fontSize: '0.6rem', fontWeight: 800, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Bases de Referência</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                {(dashConfig?.basesConsideradas || []).map((b: string) => (
                                    <span key={b} style={{ padding: '3px 10px', fontSize: '0.72rem', fontWeight: 700, borderRadius: 'var(--radius-sm)', background: 'rgba(37,99,235,0.08)', color: 'var(--color-primary)', border: '1px solid rgba(37,99,235,0.15)' }}>{b}</span>
                                ))}
                                {(!dashConfig?.basesConsideradas || dashConfig.basesConsideradas.length === 0) && (
                                    <span style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>Nenhuma base selecionada</span>
                                )}
                            </div>
                        </div>

                        {/* Data Base */}
                        <div style={{ background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', padding: '10px 12px' }}>
                            <div style={{ fontSize: '0.6rem', fontWeight: 800, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Data Base</div>
                            {dashConfig?.dataBases && Object.keys(dashConfig.dataBases).length > 0 ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                    {Object.entries(dashConfig.dataBases).map(([base, date]) => (
                                        <div key={base} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem' }}>
                                            <span style={{ fontWeight: 600, color: 'var(--color-text-secondary)' }}>{base}</span>
                                            <span style={{ fontWeight: 700, color: 'var(--color-text-primary)' }}>{date || '—'}</span>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--color-text-primary)' }}>
                                    {dashConfig?.dataBase || <span style={{ color: 'var(--color-text-tertiary)', fontStyle: 'italic', fontWeight: 500 }}>Não definida</span>}
                                </div>
                            )}
                        </div>

                        {/* BDI Cards */}
                        <div style={{ display: 'grid', gridTemplateColumns: dashConfig?.bdiDiferenciado ? '1fr 1fr' : '1fr', gap: 8 }}>
                            {/* BDI Serviços */}
                            <div style={{ background: 'linear-gradient(135deg, rgba(37,99,235,0.06), rgba(139,92,246,0.06))', borderRadius: 'var(--radius-md)', border: '1px solid rgba(37,99,235,0.12)', padding: '12px', textAlign: 'center' }}>
                                <div style={{ fontSize: '0.6rem', fontWeight: 800, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>BDI Serviços</div>
                                <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--color-primary)', lineHeight: 1 }}>{dashBdi.bdiGlobal.toFixed(2)}%</div>
                                <div style={{ fontSize: '0.6rem', color: 'var(--color-text-tertiary)', marginTop: 4 }}>TCU 2622</div>
                            </div>
                            {/* BDI Diferenciado */}
                            {dashConfig?.bdiDiferenciado && (
                                <div style={{ background: 'linear-gradient(135deg, rgba(180,83,9,0.06), rgba(217,119,6,0.06))', borderRadius: 'var(--radius-md)', border: '1px solid rgba(180,83,9,0.12)', padding: '12px', textAlign: 'center' }}>
                                    <div style={{ fontSize: '0.6rem', fontWeight: 800, color: '#92400e', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>BDI Fornec.</div>
                                    <div style={{ fontSize: '1.5rem', fontWeight: 800, color: '#b45309', lineHeight: 1 }}>
                                        {(dashConfig.bdiFornecimento || 14.02).toFixed(2)}%
                                    </div>
                                    <div style={{ fontSize: '0.6rem', color: '#92400e', marginTop: 4 }}>Material / Equip.</div>
                                </div>
                            )}
                        </div>

                        {/* Encargos Sociais */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                            <div style={{ background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', padding: '10px', textAlign: 'center' }}>
                                <div style={{ fontSize: '0.6rem', fontWeight: 800, color: '#1e40af', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Enc. Horista</div>
                                <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#1e40af' }}>
                                    {(dashConfig?.encargosSociais?.horista || 0).toFixed(2)}%
                                </div>
                            </div>
                            <div style={{ background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', padding: '10px', textAlign: 'center' }}>
                                <div style={{ fontSize: '0.6rem', fontWeight: 800, color: '#6d28d9', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Enc. Mensalista</div>
                                <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#6d28d9' }}>
                                    {(dashConfig?.encargosSociais?.mensalista || 0).toFixed(2)}%
                                </div>
                            </div>
                        </div>

                        {/* Totals */}
                        <div style={{ background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
                            <div style={{ padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                                <span style={{ color: 'var(--color-text-secondary)' }}>Subtotal (S/ BDI)</span>
                                <span style={{ fontWeight: 600 }}>{fmt(subtotal)}</span>
                            </div>
                            <div style={{ padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                                <span style={{ color: 'var(--color-text-secondary)' }}>BDI ({dashBdi.bdiGlobal.toFixed(2)}%)</span>
                                <span style={{ fontWeight: 600, color: 'var(--color-success)' }}>+ {fmt(total - subtotal)}</span>
                            </div>
                            <div style={{ padding: 'var(--space-4)', background: 'linear-gradient(135deg, rgba(37,99,235,0.05), rgba(139,92,246,0.05))', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>Total Global</span>
                                <span style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--color-primary)' }}>{fmt(total)}</span>
                            </div>
                        </div>

                        {estimatedValue && estimatedValue > 0 && total > 0 && (() => {
                            const diff = total - estimatedValue;
                            const pct = ((diff / estimatedValue) * 100);
                            const isAbove = diff > 0;
                            const barPct = Math.min((total / estimatedValue) * 100, 120);
                            return (
                                <div style={{ background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-lg)', border: `1px solid ${isAbove ? 'rgba(239,68,68,0.2)' : 'rgba(34,197,94,0.2)'}`, overflow: 'hidden' }}>
                                    <div style={{ padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span style={{ fontSize: '0.6rem', fontWeight: 800, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Valor Estimado</span>
                                        <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--color-text-primary)' }}>{fmt(estimatedValue)}</span>
                                    </div>
                                    <div style={{ padding: '0 14px 6px' }}>
                                        <div style={{ height: 6, borderRadius: 3, background: 'var(--color-bg-base)', overflow: 'hidden' }}>
                                            <div style={{ height: '100%', borderRadius: 3, width: `${Math.min(barPct, 100)}%`, background: isAbove ? 'linear-gradient(90deg, #f59e0b, #ef4444)' : 'linear-gradient(90deg, #10b981, #059669)', transition: 'width 0.3s' }} />
                                        </div>
                                    </div>
                                    <div style={{ padding: '6px 14px 10px', display: 'flex', justifyContent: 'center' }}>
                                        <span style={{
                                            padding: '3px 10px', borderRadius: 'var(--radius-sm)', fontSize: '0.72rem', fontWeight: 800,
                                            background: isAbove ? 'rgba(239,68,68,0.08)' : 'rgba(34,197,94,0.08)',
                                            color: isAbove ? '#dc2626' : '#059669',
                                        }}>
                                            {isAbove ? <><AlertTriangle size={12} style={{display:'inline',verticalAlign:'middle',marginRight:3}} /> Acima</> : <><CheckCircle2 size={12} style={{display:'inline',verticalAlign:'middle',marginRight:3}} /> Abaixo</>} do estimado ({pct > 0 ? '+' : ''}{pct.toFixed(1)}%)
                                        </span>
                                    </div>
                                </div>
                            );
                        })()}

                        {/* FIX F5.3: Audit Coverage Indicators */}
                        {billableItems.length > 0 && (() => {
                            const audited = billableItems.filter(it => it.priceAudit?.status);
                            const ok = audited.filter(it => it.priceAudit?.status === 'OK').length;
                            const div = audited.filter(it => it.priceAudit?.status === 'DIVERGENT').length;
                            const noMatch = audited.filter(it => it.priceAudit?.status === 'SEM_MATCH').length;
                            const totalBillable = billableItems.length;
                            const coverage = totalBillable > 0 ? Math.round((audited.length / totalBillable) * 100) : 0;
                            const okPct = audited.length > 0 ? (ok / audited.length) * 100 : 0;
                            const divPct = audited.length > 0 ? (div / audited.length) * 100 : 0;
                            return (
                                <div style={{ background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
                                    <div style={{ padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span style={{ fontSize: '0.6rem', fontWeight: 800, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Auditoria de Preços</span>
                                        <span style={{ fontSize: '0.78rem', fontWeight: 700, color: coverage === 100 ? '#059669' : '#d97706' }}>
                                            {audited.length}/{totalBillable} ({coverage}%)
                                        </span>
                                    </div>
                                    <div style={{ padding: '0 14px 8px' }}>
                                        <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', background: 'var(--color-bg-base)' }}>
                                            {okPct > 0 && <div style={{ width: `${okPct}%`, background: '#10b981', transition: 'width 0.3s' }} />}
                                            {divPct > 0 && <div style={{ width: `${divPct}%`, background: '#f59e0b', transition: 'width 0.3s' }} />}
                                        </div>
                                    </div>
                                    <div style={{ padding: '0 14px 10px', display: 'flex', gap: 8, justifyContent: 'center' }}>
                                        <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#059669', display: 'inline-flex', alignItems: 'center', gap: 3 }}><CheckCircle2 size={11} /> {ok} OK</span>
                                        <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#d97706', display: 'inline-flex', alignItems: 'center', gap: 3 }}><AlertTriangle size={11} /> {div} Div.</span>
                                        <span style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--color-text-tertiary)' }}>— {noMatch} N/D</span>
                                    </div>
                                </div>
                            );
                        })()}
                    </div>
            </div>
            )}

            {/* ═══ INSERTION HUB MODAL ═══ */}
            {showSearch && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ background: 'var(--color-bg-surface)', padding: 24, borderRadius: 12, width: 860, maxWidth: '92vw', maxHeight: '80vh', display: 'flex', flexDirection: 'column', gap: 12, boxShadow: '0 10px 25px rgba(0,0,0,0.2)' }}>
                        {/* ── Header ── */}
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <Database size={20} color="var(--color-primary)" />
                                <h3 style={{ margin: 0, fontSize: '1.05rem' }}>Hub de Inserção</h3>
                                {addedCount > 0 && (
                                    <span style={{ padding: '2px 10px', borderRadius: 'var(--radius-full)', background: 'rgba(16,185,129,0.12)', color: '#059669', fontWeight: 700, fontSize: '0.72rem' }}>
                                        {addedCount} {addedCount === 1 ? 'item adicionado' : 'itens adicionados'}
                                    </span>
                                )}
                            </div>
                            <button onClick={closeSearchModal} style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}><X size={20} /></button>
                        </div>

                        {/* ── Type Selector Tabs ── */}
                        <div style={{ display: 'flex', gap: 6, padding: '6px 0', borderBottom: '1px solid var(--color-border)' }}>
                            {(['ETAPA', 'SUBETAPA', 'COMPOSICAO', 'INSUMO'] as EngItemType[]).map(type => {
                                const m = TYPE_META[type];
                                const Icon = m.icon;
                                const isActive = insertType === type;
                                return (
                                    <button key={type}
                                        onClick={() => {
                                            setInsertType(type);
                                            setStructuralName('');
                                            setAddedStructuralNames([]);
                                        }}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px',
                                            borderRadius: 'var(--radius-md)',
                                            border: isActive ? `2px solid ${m.color}` : '1px solid var(--color-border)',
                                            background: isActive ? `${m.color}12` : 'var(--color-bg-base)',
                                            cursor: 'pointer', fontSize: '0.78rem', fontWeight: isActive ? 700 : 600,
                                            color: isActive ? m.color : 'var(--color-text-secondary)',
                                            transition: 'all 0.15s',
                                        }}
                                        title={`Inserir ${m.label}`}
                                    >
                                        <Icon size={14} />
                                        {m.label}
                                    </button>
                                );
                            })}
                        </div>

                        {/* ── Search Bar (only for COMPOSICAO / INSUMO) ── */}
                        {(insertType === 'COMPOSICAO' || insertType === 'INSUMO') && (() => {
                            const { filtered, warnings } = filterConfigBasesWithWarnings(bases, dashConfig);
                            const isCurrentBaseInFiltered = filtered.some((b: any) => b.id === selectedBaseId);
                            if (!isCurrentBaseInFiltered && filtered.length > 0) {
                                setTimeout(() => setSelectedBaseId(filtered[0].id), 0);
                            }
                            return (
                                <>
                                    <div style={{ display: 'flex', gap: 8 }}>
                                        <select className="form-select" value={isCurrentBaseInFiltered ? selectedBaseId : (filtered[0]?.id || '')} onChange={e => setSelectedBaseId(e.target.value)} style={{ width: 200 }}>
                                            {filtered.length === 0
                                                ? <option value="">Nenhuma base configurada</option>
                                                : filtered.map(b => {
                                                    const isVersionBased = isVersionBasedBase(b.name);
                                                    const ref = isVersionBased
                                                        ? (b.version || 'N/I')
                                                        : (b.referenceMonth && b.referenceYear ? `${String(b.referenceMonth).padStart(2, '0')}/${b.referenceYear}` : (b.version || 'N/I'));
                                                    const totalRecords = (b.itemCount || 0) + (b.compositionCount || 0);
                                                    return <option key={b.id} value={b.id}>{b.name} {b.uf || ''} {isVersionBased ? `v${ref}` : `· ${ref}`} · {totalRecords.toLocaleString('pt-BR')} registros</option>;
                                                })
                                            }
                                        </select>
                                        <div style={{ flex: 1, position: 'relative' }}>
                                            <input type="text" className="form-input"
                                                placeholder={`Buscar ${TYPE_META[insertType].label.toLowerCase()} por código ou descrição...`}
                                                value={searchQuery}
                                                onChange={e => setSearchQuery(e.target.value)}
                                                onKeyDown={e => e.key === 'Enter' && handleSearch()}
                                                autoFocus
                                                style={{ width: '100%', paddingRight: isSearching ? 36 : 12 }} />
                                            {isSearching && (
                                                <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', display: 'flex', alignItems: 'center' }}>
                                                    <Loader2 size={16} className="spin" color="var(--color-primary)" />
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                    {warnings.length > 0 && (
                                        <div style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                                            <AlertTriangle size={16} color="#d97706" style={{ flexShrink: 0, marginTop: 2 }} />
                                            <div style={{ fontSize: '0.78rem', color: '#92400e' }}>
                                                {warnings.map((w, i) => <div key={i}>{w}</div>)}
                                            </div>
                                        </div>
                                    )}
                                </>
                            );
                        })()}

                        {/* ── Criar Próprio (inline form) ── */}
                        {(insertType === 'COMPOSICAO' || insertType === 'INSUMO') && (
                            <div style={{ borderRadius: 8, border: `1px solid ${showPropriaForm ? TYPE_META[insertType].color + '40' : 'var(--color-border)'}`, overflow: 'hidden', transition: 'all 0.2s' }}>
                                <button onClick={() => setShowPropriaForm(p => !p)}
                                    style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px', border: 'none', background: showPropriaForm ? `${TYPE_META[insertType].color}08` : 'var(--color-bg-base)', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600, color: TYPE_META[insertType].color, textAlign: 'left' as const }}>
                                    <Plus size={14} />
                                    Criar {TYPE_META[insertType].label} Própria
                                    <span style={{ marginLeft: 'auto', fontSize: '0.68rem', color: 'var(--color-text-tertiary)', fontWeight: 400 }}>
                                        {showPropriaForm ? 'Recolher' : 'Salva no banco PROPRIA e adiciona ao orçamento'}
                                    </span>
                                </button>
                                {showPropriaForm && (
                                    <div style={{ padding: '10px 12px', display: 'flex', gap: 6, alignItems: 'flex-end', borderTop: '1px solid var(--color-border)', background: 'var(--color-bg-surface)' }}>
                                        <div style={{ flex: '0 0 100px' }}>
                                            <label style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--color-text-tertiary)', display: 'block', marginBottom: 2 }}>Código *</label>
                                            <input type="text" className="form-input" placeholder="CP-001" value={propriaCode} onChange={e => setPropriaCode(e.target.value)}
                                                style={{ width: '100%', fontSize: '0.78rem', padding: '5px 8px' }} />
                                        </div>
                                        <div style={{ flex: 1 }}>
                                            <label style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--color-text-tertiary)', display: 'block', marginBottom: 2 }}>Descrição *</label>
                                            <input type="text" className="form-input" placeholder="Descrição do item próprio..." value={propriaDesc} onChange={e => setPropriaDesc(e.target.value)}
                                                style={{ width: '100%', fontSize: '0.78rem', padding: '5px 8px' }} />
                                        </div>
                                        <div style={{ flex: '0 0 65px' }}>
                                            <label style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--color-text-tertiary)', display: 'block', marginBottom: 2 }}>Unid.</label>
                                            <input type="text" className="form-input" value={propriaUnit} onChange={e => setPropriaUnit(e.target.value)}
                                                style={{ width: '100%', fontSize: '0.78rem', padding: '5px 8px', textAlign: 'center' }} />
                                        </div>
                                        <div style={{ flex: '0 0 100px' }}>
                                            <label style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--color-text-tertiary)', display: 'block', marginBottom: 2 }}>Valor Unit. *</label>
                                            <input type="text" className="form-input" placeholder="0,00" value={propriaPrice} onChange={e => setPropriaPrice(e.target.value)}
                                                style={{ width: '100%', fontSize: '0.78rem', padding: '5px 8px', textAlign: 'right' }} />
                                        </div>
                                        <div style={{ flex: '0 0 65px' }}>
                                            <label style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--color-text-tertiary)', display: 'block', marginBottom: 2 }}>Qtd.</label>
                                            <input type="text" className="form-input" value={propriaQty} onChange={e => setPropriaQty(e.target.value)}
                                                style={{ width: '100%', fontSize: '0.78rem', padding: '5px 8px', textAlign: 'center', fontWeight: 600 }}
                                                onKeyDown={e => e.key === 'Enter' && handleCreatePropria()} />
                                        </div>
                                        <button className="btn btn-primary" disabled={!propriaCode.trim() || !propriaDesc.trim() || !propriaPrice.trim() || propriaSaving}
                                            onClick={handleCreatePropria}
                                            style={{ padding: '5px 12px', fontSize: '0.75rem', whiteSpace: 'nowrap', height: 30 }}>
                                            {propriaSaving ? <Loader2 size={14} className="spin" /> : <><CheckCircle2 size={13} style={{ marginRight: 3 }} /> Criar e Adicionar</>}
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* ── Search Results Table (only for COMPOSICAO / INSUMO) ── */}
                        {(insertType === 'COMPOSICAO' || insertType === 'INSUMO') ? (
                        <div style={{ flex: 1, overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: 8 }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                                <thead><tr style={{ background: 'var(--color-bg-base)' }}>
                                    {['Tipo','Código','Descrição','Unid.','Preço','Qtd.',''].map((h,i) => <th key={i} style={{ padding: 8, textAlign: i >= 4 ? 'right' : (i === 5 ? 'center' : 'left') }}>{h}</th>)}
                                </tr></thead>
                                <tbody>
                                    {searchResults.map(r => {
                                        const wasAdded = addedItemIds.has(r.id);
                                        return (
                                        <tr key={r.id} style={{ borderBottom: '1px solid var(--color-border)', background: wasAdded ? 'rgba(16,185,129,0.08)' : undefined, transition: 'background 0.3s' }}>
                                            <td style={{ padding: 8, color: 'var(--color-text-tertiary)', fontWeight: 700 }}>{r.recordKind === 'COMPOSICAO' ? 'Comp.' : 'Insumo'}</td>
                                            <td style={{ padding: 8 }}><strong>{r.code}</strong></td>
                                            <td style={{ padding: 8 }}>{r.description}</td>
                                            <td style={{ padding: 8, textAlign: 'center' }}>{r.unit}</td>
                                            <td style={{ padding: 8, textAlign: 'right', fontWeight: 600 }}>{fmt(Number(r.price) || 0)}</td>
                                            <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                                                <input type="number" min="0.01" step="0.01"
                                                    value={searchQuantities[r.id] ?? 1}
                                                    onChange={e => setSearchQuantities(prev => ({ ...prev, [r.id]: parseFloat(e.target.value) || 1 }))}
                                                    style={{ width: 60, textAlign: 'center', padding: '4px 4px', fontSize: '0.78rem', fontWeight: 600, borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', background: 'var(--color-bg-base)', outline: 'none' }} />
                                            </td>
                                            <td style={{ padding: 8, textAlign: 'center' }}>
                                                {wasAdded ? (
                                                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: '#059669', fontWeight: 700, fontSize: '0.72rem' }}>
                                                        <CheckCircle2 size={14} /> Adicionado
                                                    </span>
                                                ) : (
                                                    <button className="btn btn-primary" style={{ padding: '4px 8px', fontSize: '0.7rem' }} onClick={() => addFromSearch(r)}>Adicionar</button>
                                                )}
                                            </td>
                                        </tr>
                                        );
                                    })}
                                    {searchResults.length === 0 && <tr><td colSpan={7} style={{ padding: 16, textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                                        {searchQuery ? 'Nenhum resultado encontrado.' : `Busque ${TYPE_META[insertType].label.toLowerCase()} por código ou descrição acima.`}
                                    </td></tr>}
                                </tbody>
                            </table>
                        </div>
                        ) : (
                        /* ── Structural type form (ETAPA / SUBETAPA) ── */
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, padding: 20, border: '1px solid var(--color-border)', borderRadius: 8, background: 'var(--color-bg-base)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                {(() => { const m = TYPE_META[insertType]; const Icon = m.icon; return <Icon size={18} color={m.color} />; })()}
                                <span style={{ fontWeight: 700, fontSize: '0.88rem', color: TYPE_META[insertType].color }}>Nova {TYPE_META[insertType].label}</span>
                                <span style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)' }}>
                                    {insertTargetId ? '(será inserida após o item selecionado)' : '(será inserida ao final da planilha)'}
                                </span>
                            </div>
                            <div style={{ display: 'flex', gap: 8 }}>
                                <input
                                    type="text" className="form-input" autoFocus
                                    placeholder={insertType === 'ETAPA' ? 'Ex: FUNDAÇÃO, ESTRUTURA, ALVENARIA...' : 'Ex: Serviços Preliminares, Impermeabilização...'}
                                    value={structuralName}
                                    onChange={e => setStructuralName(e.target.value)}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter' && structuralName.trim()) {
                                            addTypedItem(insertType, insertTargetId || undefined, structuralName.trim());
                                            setAddedStructuralNames(prev => [...prev, structuralName.trim()]);
                                            setAddedCount(c => c + 1);
                                            setStructuralName('');
                                        }
                                    }}
                                    style={{ flex: 1 }}
                                />
                                <button className="btn btn-primary" style={{ padding: '6px 16px', fontSize: '0.8rem' }}
                                    disabled={!structuralName.trim()}
                                    onClick={() => {
                                        addTypedItem(insertType, insertTargetId || undefined, structuralName.trim());
                                        setAddedStructuralNames(prev => [...prev, structuralName.trim()]);
                                        setAddedCount(c => c + 1);
                                        setStructuralName('');
                                    }}
                                >
                                    <Plus size={14} style={{ marginRight: 4 }} /> Adicionar
                                </button>
                            </div>
                            {/* List of added structural items */}
                            {addedStructuralNames.length > 0 && (
                                <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 10 }}>
                                    <div style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-tertiary)', marginBottom: 6 }}>
                                        {TYPE_META[insertType].label}s adicionadas nesta sessão:
                                    </div>
                                    {addedStructuralNames.map((name, i) => (
                                        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', borderRadius: 'var(--radius-sm)', background: 'rgba(16,185,129,0.06)', marginBottom: 3, fontSize: '0.78rem' }}>
                                            <CheckCircle2 size={12} color="#059669" />
                                            <span style={{ fontWeight: 600, color: TYPE_META[insertType].color, minWidth: 30 }}>{i + 1}.</span>
                                            <span>{name}</span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                        )}

                        {/* Footer with close button */}
                        {addedCount > 0 && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--color-border)', paddingTop: 12 }}>
                                <span style={{ fontSize: '0.78rem', color: 'var(--color-text-secondary)' }}>
                                    <CheckCircle2 size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} color="#059669" />
                                    {addedCount} {addedCount === 1 ? 'item adicionado' : 'itens adicionados'} à planilha
                                </span>
                                <button className="btn btn-primary" onClick={closeSearchModal} style={{ padding: '6px 16px', fontSize: '0.8rem' }}>Concluir</button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Composition Drawer (single item) */}
            {compositionItem && compositionEditorIndex === null && (
                <CompositionDrawer
                    code={compositionItem.code}
                    description={compositionItem.description}
                    databaseId={compositionItem.priceAudit?.matchedDatabaseId || undefined}
                    sourceName={compositionItem.sourceName}
                    onClose={() => setCompositionItem(null)}
                />
            )}

            {/* Full-Page Composition Editor (with navigation) */}
            {compositionEditorIndex !== null && (
                <CompositionEditor
                    items={items}
                    initialIndex={compositionEditorIndex}
                    onClose={() => setCompositionEditorIndex(null)}
                    onUpdateItem={(itemId, updates) => {
                        // Handle compositionNotes from the CompositionEditor observation textarea
                        if (itemId === '__reportConfig__') {
                            setEngineeringConfig((prev: any) => ({ ...prev, reportConfig: updates }));
                            setHasUnsavedChanges(true);
                            return;
                        }
                        if (updates.type !== undefined) {
                            updateItem(itemId, 'type', updates.type);
                        }
                        if (updates.unitCost !== undefined) {
                            updateItem(itemId, 'unitCost', updates.unitCost);
                        }
                        if (updates.description !== undefined) {
                            updateItem(itemId, 'description', updates.description);
                        }
                        // FIX SYNC-05: Handle sourceName updates from CompositionEditor's saveToBase
                        // When an official composition is saved as PROPRIA, update the planilha badge
                        if ((updates as any).sourceName !== undefined) {
                            updateItem(itemId, 'sourceName', (updates as any).sourceName);
                        }
                        if (updates.multiplicationFactor !== undefined) {
                            const factor = Number(updates.multiplicationFactor) || 1;
                            // Unified: save factor on grouper + cascade to children in ONE setItems call
                            setItems(prev => {
                                const grouperIdx = prev.findIndex(it => it.id === itemId);
                                if (grouperIdx < 0) return prev;
                                const grouper = prev[grouperIdx];
                                const grouperDepth = getDepth(grouper.itemNumber);
                                const prevFactor = grouper.multiplicationFactor || 1;
                                const updated = [...prev];
                                // 1. Save factor on the grouper itself
                                updated[grouperIdx] = { ...grouper, multiplicationFactor: factor };
                                // 2. Cascade: multiply all child item quantities
                                for (let i = grouperIdx + 1; i < updated.length; i++) {
                                    const child = updated[i];
                                    if (isGrouper(child.type) && getDepth(child.itemNumber) <= grouperDepth) break;
                                    if (!isGrouper(child.type)) {
                                        const baseQty = prevFactor !== 0 ? child.quantity / prevFactor : child.quantity;
                                        const newQty = applyPrecision(baseQty * factor, { precision: engineeringConfig?.precision });
                                        const itemBdi = resolveItemBdi(child);
                                        const unitPrice = applyBdi(child.unitCost, itemBdi, engineeringConfig.precision);
                                        updated[i] = {
                                            ...child,
                                            quantity: newQty,
                                            unitPrice,
                                            totalPrice: applyPrecision(newQty * unitPrice, { precision: engineeringConfig?.precision }),
                                        };
                                    }
                                }
                                return updated;
                            });
                            setHasUnsavedChanges(true);
                        }
                    }}
                    engineeringConfig={dashConfig}
                />
            )}
            {activeCalcItem && (
                <CalculationMemoryModal
                    item={activeCalcItem}
                    onClose={() => setActiveCalcItem(null)}
                    onSave={(calcMemoryJsonStr, calculatedQuantity) => {
                        saveCalculationMemory(activeCalcItem.id, calcMemoryJsonStr, calculatedQuantity);
                        setActiveCalcItem(null);
                    }}
                />
            )}
            {showImageImportModal && (
                <ImageBudgetImportModal
                    onClose={() => {
                        setShowImageImportModal(false);
                        setInitialImportFile(null);
                    }}
                    onImport={handleImportFromImage}
                    engineeringConfig={dashConfig}
                    initialFile={initialImportFile}
                    onClearInitialFile={() => setInitialImportFile(null)}
                />
            )}
            {globalDragOver && (
                <div style={{
                    position: 'fixed', inset: 0, zIndex: 9999,
                    background: 'rgba(37,99,235,0.15)',
                    backdropFilter: 'blur(4px)',
                    border: '4px dashed var(--color-primary)',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    pointerEvents: 'none'
                }}>
                    <div style={{
                        background: 'var(--color-bg-surface)', padding: '24px 40px', borderRadius: 16,
                        boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12
                    }}>
                        <Upload size={48} color="var(--color-primary)" />
                        <h3 style={{ margin: 0, fontWeight: 700, color: 'var(--color-text-primary)' }}>Solte a imagem aqui</h3>
                        <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>A IA vai extrair todos os itens do print.</p>
                    </div>
                </div>
            )}
        </div>
    );
}

// ═══════════════════════════════════════════════════════════
// CALCULATION MEMORY MODAL & HELPERS
// ═══════════════════════════════════════════════════════════

const evaluateMathExpression = (expr: string): number => {
    const clean = expr.replace(/\s+/g, '');
    if (!clean) return 0;
    if (!/^[0-9+\-*/().]+$/.test(clean)) {
        throw new Error('Expressão inválida. Use apenas números e operadores (+, -, *, /).');
    }
    // eslint-disable-next-line no-new-func
    const result = new Function(`return (${clean})`)();
    if (typeof result !== 'number' || Number.isNaN(result) || !Number.isFinite(result)) {
        throw new Error('Expressão resultou em um valor inválido.');
    }
    return result;
};

interface CalculationMemoryModalProps {
    item: EngItem;
    onClose: () => void;
    onSave: (calcMemoryJsonStr: string, calculatedQuantity: number) => void;
}

function CalculationMemoryModal({ item, onClose, onSave }: CalculationMemoryModalProps) {
    const [mode, setMode] = useState<'SIMPLE' | 'STRUCTURED'>('SIMPLE');
    const [formula, setFormula] = useState('');
    const [simpleError, setSimpleError] = useState<string | null>(null);
    const [rows, setRows] = useState<Array<{
        id: string;
        description: string;
        multiplier: number;
        length: string;
        width: string;
        height: string;
        subtotal: number;
    }>>([
        { id: '1', description: '', multiplier: 1, length: '', width: '', height: '', subtotal: 1 }
    ]);

    // Load initial values from item.calculationMemory
    useEffect(() => {
        if (item.calculationMemory) {
            try {
                const parsed = JSON.parse(item.calculationMemory);
                if (parsed.mode) setMode(parsed.mode);
                if (parsed.formula) setFormula(parsed.formula);
                if (Array.isArray(parsed.rows)) {
                    setRows(parsed.rows);
                }
            } catch (e) {
                console.error("Failed to parse calculation memory:", e);
            }
        } else if (item.quantity > 0) {
            // Seed simple formula with current quantity
            setFormula(String(item.quantity));
        }
    }, [item]);

    // Simple mode real-time evaluation
    let simpleResult = 0;
    try {
        simpleResult = evaluateMathExpression(formula);
    } catch (err: any) {
        // Handled below safely
    }

    // Capture errors dynamically on change
    useEffect(() => {
        if (!formula.trim()) {
            setSimpleError(null);
            return;
        }
        try {
            evaluateMathExpression(formula);
            setSimpleError(null);
        } catch (err: any) {
            setSimpleError(err.message);
        }
    }, [formula]);

    const calculateRowSubtotal = (r: { multiplier: number; length: string; width: string; height: string }) => {
        const m = Number(r.multiplier) ?? 1;
        const l = r.length.trim() !== '' ? Number(r.length) : 1;
        const w = r.width.trim() !== '' ? Number(r.width) : 1;
        const h = r.height.trim() !== '' ? Number(r.height) : 1;
        return Number((m * l * w * h).toFixed(4));
    };

    const handleRowChange = (id: string, field: string, val: any) => {
        setRows(prev => prev.map(r => {
            if (r.id !== id) return r;
            const updated = { ...r, [field]: val };
            updated.subtotal = calculateRowSubtotal(updated);
            return updated;
        }));
    };

    const addRow = () => {
        setRows(prev => [
            ...prev,
            { id: String(Date.now() + Math.random()), description: '', multiplier: 1, length: '', width: '', height: '', subtotal: 1 }
        ]);
    };

    const removeRow = (id: string) => {
        if (rows.length === 1) {
            setRows([{ id: '1', description: '', multiplier: 1, length: '', width: '', height: '', subtotal: 1 }]);
            return;
        }
        setRows(prev => prev.filter(r => r.id !== id));
    };

    const totalStructured = Number(rows.reduce((sum, r) => sum + r.subtotal, 0).toFixed(4));

    const handleApply = () => {
        if (mode === 'SIMPLE') {
            try {
                const finalVal = evaluateMathExpression(formula);
                const json = JSON.stringify({ mode, formula });
                onSave(json, finalVal);
            } catch (err: any) {
                alert(`Erro na expressão: ${err.message}`);
            }
        } else {
            const finalVal = totalStructured;
            const json = JSON.stringify({ mode, rows });
            onSave(json, finalVal);
        }
    };

    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(15, 23, 42, 0.4)',
            backdropFilter: 'blur(8px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            animation: 'fadeIn 0.2s ease-out'
        }}>
            <style>{`
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                @keyframes scaleUp {
                    from { transform: scale(0.95); opacity: 0; }
                    to { transform: scale(1); opacity: 1; }
                }
            `}</style>
            <div style={{
                background: 'var(--color-bg-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 16,
                width: 720, maxWidth: '95vw',
                maxHeight: '90vh',
                display: 'flex', flexDirection: 'column',
                boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)',
                overflow: 'hidden',
                animation: 'scaleUp 0.2s cubic-bezier(0.16, 1, 0.3, 1)'
            }}>
                {/* Header */}
                <div style={{
                    padding: '20px 24px',
                    borderBottom: '1px solid var(--color-border)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    background: 'linear-gradient(135deg, rgba(37,99,235,0.05) 0%, rgba(37,99,235,0) 100%)'
                }}>
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Calculator size={18} color="var(--color-primary)" />
                            <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--color-text-primary)' }}>
                                Memória de Cálculo
                            </h3>
                        </div>
                        <span style={{ fontSize: '0.78rem', color: 'var(--color-text-tertiary)', marginTop: 4, display: 'block' }}>
                            {item.itemNumber} {item.code ? `[${item.code}]` : ''} — {item.description}
                        </span>
                    </div>
                    <button onClick={onClose} style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        padding: 6, borderRadius: '50%',
                        color: 'var(--color-text-tertiary)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transition: 'background 0.2s'
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-base)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Tabs */}
                <div style={{
                    display: 'flex', gap: 4, padding: '12px 24px 0',
                    borderBottom: '1px solid var(--color-border)',
                    background: 'var(--color-bg-surface)'
                }}>
                    <button
                        onClick={() => setMode('SIMPLE')}
                        style={{
                            padding: '10px 16px', border: 'none', background: 'none', cursor: 'pointer',
                            fontSize: '0.85rem', fontWeight: mode === 'SIMPLE' ? 700 : 500,
                            color: mode === 'SIMPLE' ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                            borderBottom: mode === 'SIMPLE' ? '3px solid var(--color-primary)' : '3px solid transparent',
                            transition: 'all 0.15s'
                        }}
                    >
                        Fórmula Simples
                    </button>
                    <button
                        onClick={() => setMode('STRUCTURED')}
                        style={{
                            padding: '10px 16px', border: 'none', background: 'none', cursor: 'pointer',
                            fontSize: '0.85rem', fontWeight: mode === 'STRUCTURED' ? 700 : 500,
                            color: mode === 'STRUCTURED' ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                            borderBottom: mode === 'STRUCTURED' ? '3px solid var(--color-primary)' : '3px solid transparent',
                            transition: 'all 0.15s'
                        }}
                    >
                        Memória Estruturada
                    </button>
                </div>

                {/* Body Content */}
                <div style={{ padding: 24, overflowY: 'auto', flex: 1, minHeight: 250 }}>
                    {mode === 'SIMPLE' ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                <label style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                                    Digite a expressão matemática:
                                </label>
                                <input
                                    type="text"
                                    value={formula}
                                    onChange={e => setFormula(e.target.value)}
                                    placeholder="Ex: (2 * 3.5) + (4 * 1.25)"
                                    style={{
                                        padding: '12px 14px', borderRadius: 8,
                                        border: '1px solid var(--color-border)',
                                        background: 'var(--color-bg-base)',
                                        color: 'var(--color-text-primary)',
                                        fontSize: '1rem', fontFamily: 'monospace',
                                        width: '100%', outline: 'none',
                                        boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.05)'
                                    }}
                                />
                                <span style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)' }}>
                                    Apenas números e operadores básicos são permitidos: +, -, *, /, ( e ).
                                </span>
                            </div>

                            {/* Result Display */}
                            <div style={{
                                padding: 16, borderRadius: 10,
                                background: formula.trim() && simpleError ? 'rgba(239,68,68,0.06)' : 'rgba(37,99,235,0.04)',
                                border: formula.trim() && simpleError ? '1px solid rgba(239,68,68,0.15)' : '1px solid rgba(37,99,235,0.15)',
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                            }}>
                                <div>
                                    <span style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', fontWeight: 500 }}>
                                        Resultado Calculado:
                                    </span>
                                    {formula.trim() && simpleError ? (
                                        <div style={{ fontSize: '0.78rem', color: 'var(--color-danger)', marginTop: 4, fontWeight: 500 }}>
                                            {simpleError}
                                        </div>
                                    ) : (
                                        <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--color-primary)', marginTop: 2 }}>
                                            {Number(simpleResult.toFixed(4))}
                                        </div>
                                    )}
                                </div>
                                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-secondary)', padding: '4px 10px', background: 'var(--color-bg-base)', border: '1px solid var(--color-border)', borderRadius: 6 }}>
                                    {item.unit || 'UN'}
                                </span>
                            </div>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                            <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                                    <thead>
                                        <tr style={{ borderBottom: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', textAlign: 'left' }}>
                                            <th style={{ padding: '6px 8px', fontWeight: 600 }}>Descrição</th>
                                            <th style={{ padding: '6px 8px', width: 80, fontWeight: 600, textAlign: 'right' }}>Quant. / Mult.</th>
                                            <th style={{ padding: '6px 8px', width: 90, fontWeight: 600, textAlign: 'right' }}>Comprim. (m)</th>
                                            <th style={{ padding: '6px 8px', width: 90, fontWeight: 600, textAlign: 'right' }}>Largura (m)</th>
                                            <th style={{ padding: '6px 8px', width: 90, fontWeight: 600, textAlign: 'right' }}>Altura (m)</th>
                                            <th style={{ padding: '6px 8px', width: 100, fontWeight: 600, textAlign: 'right' }}>Subtotal</th>
                                            <th style={{ padding: '6px 8px', width: 40 }}></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {rows.map((row) => (
                                            <tr key={row.id} style={{ borderBottom: '1px solid rgba(0,0,0,0.03)' }}>
                                                <td style={{ padding: '6px 4px' }}>
                                                    <input
                                                        type="text"
                                                        value={row.description}
                                                        onChange={e => handleRowChange(row.id, 'description', e.target.value)}
                                                        placeholder="Ex: Trecho A, Parede Leste"
                                                        style={{
                                                            width: '100%', padding: '6px 8px', border: '1px solid var(--color-border)',
                                                            borderRadius: 6, fontSize: '0.8rem', background: 'var(--color-bg-base)',
                                                            color: 'var(--color-text-primary)'
                                                        }}
                                                    />
                                                </td>
                                                <td style={{ padding: '6px 4px' }}>
                                                    <input
                                                        type="number"
                                                        value={row.multiplier}
                                                        onChange={e => handleRowChange(row.id, 'multiplier', parseLocaleNumber(e.target.value))}
                                                        style={{
                                                            width: '100%', padding: '6px 8px', border: '1px solid var(--color-border)',
                                                            borderRadius: 6, fontSize: '0.8rem', background: 'var(--color-bg-base)',
                                                            color: 'var(--color-text-primary)', textAlign: 'right'
                                                        }}
                                                    />
                                                </td>
                                                <td style={{ padding: '6px 4px' }}>
                                                    <input
                                                        type="number"
                                                        value={row.length}
                                                        onChange={e => handleRowChange(row.id, 'length', e.target.value)}
                                                        placeholder="1.00"
                                                        style={{
                                                            width: '100%', padding: '6px 8px', border: '1px solid var(--color-border)',
                                                            borderRadius: 6, fontSize: '0.8rem', background: 'var(--color-bg-base)',
                                                            color: 'var(--color-text-primary)', textAlign: 'right'
                                                        }}
                                                    />
                                                </td>
                                                <td style={{ padding: '6px 4px' }}>
                                                    <input
                                                        type="number"
                                                        value={row.width}
                                                        onChange={e => handleRowChange(row.id, 'width', e.target.value)}
                                                        placeholder="1.00"
                                                        style={{
                                                            width: '100%', padding: '6px 8px', border: '1px solid var(--color-border)',
                                                            borderRadius: 6, fontSize: '0.8rem', background: 'var(--color-bg-base)',
                                                            color: 'var(--color-text-primary)', textAlign: 'right'
                                                        }}
                                                    />
                                                </td>
                                                <td style={{ padding: '6px 4px' }}>
                                                    <input
                                                        type="number"
                                                        value={row.height}
                                                        onChange={e => handleRowChange(row.id, 'height', e.target.value)}
                                                        placeholder="1.00"
                                                        style={{
                                                            width: '100%', padding: '6px 8px', border: '1px solid var(--color-border)',
                                                            borderRadius: 6, fontSize: '0.8rem', background: 'var(--color-bg-base)',
                                                            color: 'var(--color-text-primary)', textAlign: 'right'
                                                        }}
                                                    />
                                                </td>
                                                <td style={{ padding: '6px 4px', textAlign: 'right', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                                                    {row.subtotal}
                                                </td>
                                                <td style={{ padding: '6px 4px', textAlign: 'center' }}>
                                                    <button
                                                        onClick={() => removeRow(row.id)}
                                                        title="Excluir Linha"
                                                        style={{
                                                            background: 'none', border: 'none', cursor: 'pointer',
                                                            color: 'var(--color-text-tertiary)',
                                                            display: 'inline-flex', padding: 4
                                                        }}
                                                        onMouseEnter={e => e.currentTarget.style.color = 'var(--color-danger)'}
                                                        onMouseLeave={e => e.currentTarget.style.color = 'var(--color-text-tertiary)'}
                                                    >
                                                        <Trash2 size={13} />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            <button onClick={addRow} className="btn btn-outline" style={{
                                alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 6,
                                padding: '6px 12px', fontSize: '0.78rem', borderStyle: 'dashed'
                            }}>
                                <Plus size={12} /> Adicionar Linha
                            </button>

                            {/* Total Display */}
                            <div style={{
                                marginTop: 12, padding: 16, borderRadius: 10,
                                background: 'rgba(37,99,235,0.04)', border: '1px solid rgba(37,99,235,0.15)',
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                            }}>
                                <div>
                                    <span style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', fontWeight: 500 }}>
                                        Soma dos Subtotais:
                                    </span>
                                    <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--color-primary)', marginTop: 2 }}>
                                        {totalStructured}
                                    </div>
                                </div>
                                <span style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-secondary)', padding: '4px 10px', background: 'var(--color-bg-base)', border: '1px solid var(--color-border)', borderRadius: 6 }}>
                                    {item.unit || 'UN'}
                                </span>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer Actions */}
                <div style={{
                    padding: '16px 24px',
                    borderTop: '1px solid var(--color-border)',
                    background: 'var(--color-bg-surface)',
                    display: 'flex', justifyContent: 'flex-end', gap: 12
                }}>
                    <button onClick={onClose} className="btn btn-outline" style={{ padding: '8px 16px' }}>
                        Cancelar
                    </button>
                    <button
                        onClick={handleApply}
                        disabled={mode === 'SIMPLE' && (!!simpleError || !formula.trim())}
                        className="btn btn-primary"
                        style={{ padding: '8px 20px', fontWeight: 600 }}
                    >
                        Aplicar Quantidade
                    </button>
                </div>
            </div>
        </div>
    );
}
