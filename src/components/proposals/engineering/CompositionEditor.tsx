/**
 * CompositionEditor — Editor full-page de composições com CASCADE COMPLETO.
 * 
 * Fluxo de cascade:
 *   Edita preço/coef do insumo → recalcula subtotais do grupo
 *   → recalcula total da composição → callback onUpdateItem(unitCost)
 *   → planilha recalcula BDI + total → Hub reflete novos preços
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, X, Layers, Package, HardHat, Wrench, ChevronDown, ChevronUp, Loader2, AlertCircle, AlertTriangle, Pencil, Check, CheckCircle2, ArrowDownUp, Download, FileText, Save, PlusCircle, Plus, Percent, Calculator, Wand2, Divide, FolderOpen, Folder, RefreshCw, ArrowRightLeft, Database, Hash, MessageSquare, Trash2, Cpu, ListTree, GripVertical, Search } from 'lucide-react';
import { exportCompositionExcel, exportCompositionPdf } from './exportEngine';
import { applyPrecision } from './precisionEngine';
import { SmartCpuDropzone } from './SmartCpuDropzone';
import { asNumber, getLineCoefficient, getLineUnitPrice, getLineSubtotal, normalizeCompositionMath, sumCompositionGroups } from './compositionMath';
import { resolveMetaCategory, EXPANDED_TYPES_META } from './insumoEngine';
import { useDrillDown, type DrillCurrentState, type DrillLevelSnapshot } from './useDrillDown';
import { displaySourceName, isPropria, resolveDisplayBase } from './types';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtCoef = (v: number) => v.toFixed(4);
const token = () => localStorage.getItem('token') || '';
const hdrs = () => ({ 'Authorization': `Bearer ${token()}`, 'Content-Type': 'application/json' });

interface InsumoDetail {
    type: string;
    description: string;
    unit: string;
    coefficient: number;
    unitPrice: number;
}

interface EngItem {
    id: string; itemNumber: string; code: string; sourceName: string;
    description: string; unit: string; quantity: number;
    unitCost: number; unitPrice: number; totalPrice: number;
    type?: string; // ETAPA, SUBETAPA, COMPOSICAO, INSUMO
    multiplicationFactor?: number;
    officialUnitCost?: number;
    priceAudit?: {
        matchedDatabaseId?: string | null;
        matchedUnitCost?: number | null;
        matchedSourceName?: string | null;
        matchedReference?: string | null;
        matchedPayrollExemption?: boolean | null;
        warnings?: string[];
    };
    insumos?: InsumoDetail[];
}

interface CompositionSyncData {
    code: string;
    description?: string;
    unit?: string;
    unitCost: number;
    compositionTotalPrice: number;
    sourceName: string;
}

interface Props {
    items: EngItem[];
    initialIndex: number;
    onClose: () => void;
    onUpdateItem: (itemId: string, updates: Partial<EngItem>) => void;
    onCompositionSaved?: (data: CompositionSyncData) => void;
    engineeringConfig?: any;
    proposalId?: string;
    bdiConfig?: any;
}

const GROUP_META: Record<string, { label: string; icon: any; color: string }> = {
    MATERIAL: { label: 'Materiais', icon: Package, color: '#2563eb' },
    MAO_DE_OBRA: { label: 'Mão de Obra', icon: HardHat, color: '#16a34a' },
    EQUIPAMENTO: { label: 'Equipamentos', icon: Wrench, color: '#d97706' },
    SERVICO: { label: 'Serviços', icon: Wrench, color: '#0ea5e9' },
    AUXILIAR: { label: 'Composições Auxiliares', icon: Layers, color: '#7c3aed' },
    OBSERVACAO: { label: 'Observações e Textos', icon: FileText, color: '#64748b' },
};

const isGrouperType = (type?: string) => type === 'ETAPA' || type === 'SUBETAPA';

const VERSION_BASED_BASES = ['SEINFRA', 'SICRO', 'SBC'];

function isVersionBasedBase(name: string): boolean {
    return VERSION_BASED_BASES.some(vb => name.toUpperCase().includes(vb));
}

/**
 * STRICT base filter — enforces Step 1 config (name + UF + data-base).
 * Mirrors filterConfigBases from EngineeringProposalEditor.
 */
function filterBases(allBases: any[], config: any): any[] {
    return filterBasesWithWarnings(allBases, config).filtered;
}

interface BaseFilterResult { filtered: any[]; warnings: string[]; }

function filterBasesWithWarnings(allBases: any[], config: any): BaseFilterResult {
    if (!allBases || allBases.length === 0) return { filtered: [], warnings: ['Nenhuma base cadastrada no sistema.'] };

    const allowed: string[] = config?.basesConsideradas || [];
    const uf: string = (config?.ufReferencia || '').toUpperCase();
    const perBaseDates: Record<string, string> = config?.dataBases || {};

    const regime: string = (config?.regimeOneracao || 'ONERADO').toUpperCase();
    const targetPayrollExemption = regime === 'DESONERADO';

    if (allowed.length === 0) return { filtered: allBases, warnings: [] };

    const result: any[] = [];
    const warnings: string[] = [];

    for (const baseName of allowed) {
        const upperName = baseName.toUpperCase();

        if (upperName === 'PROPRIA' || upperName === 'PRÓPRIA') {
            const propria = allBases.filter((b: any) =>
                b.name.toUpperCase().includes('PROPRIA') || b.name.toUpperCase().includes('PRÓPRIA')
            );
            if (propria.length > 0) result.push(...propria);
            else warnings.push(`Base "${baseName}" não encontrada no sistema.`);
            continue;
        }

        // Version-based bases (SEINFRA, SICRO, SBC) use version identifiers, not monthly dates.
        // NEVER apply date filtering to these bases, even if dataBases has stale AI-extracted entries.
        const isVersionBased = VERSION_BASED_BASES.some(vb => upperName.includes(vb));
        const hasExplicitDate = !isVersionBased && !!perBaseDates[baseName];
        const targetDate = hasExplicitDate ? (perBaseDates[baseName] || '') : '';
        let targetMonth = 0, targetYear = 0;
        if (targetDate) {
            const [y, m] = targetDate.split('-').map(Number);
            if (y && m) { targetYear = y; targetMonth = m; }
        }

        const hasSameNameWithMatchingUf = allBases.some((b: any) =>
            b.name.toUpperCase().includes(upperName) && b.uf && b.uf.toUpperCase() === uf
        );

        // Step 1: Try strict match (name + UF + date + regime)
        let candidates = allBases.filter((b: any) => {
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
            candidates = allBases.filter((b: any) => {
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
            candidates = allBases.filter((b: any) => {
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
                // Then prefer bases with actual data
                const aHasData = ((a.itemCount || 0) + (a.compositionCount || 0)) > 0 ? 1 : 0;
                const bHasData = ((b.itemCount || 0) + (b.compositionCount || 0)) > 0 ? 1 : 0;
                if (bHasData !== aHasData) return bHasData - aHasData;
                return (b.referenceYear || 0) - (a.referenceYear || 0) || (b.referenceMonth || 0) - (a.referenceMonth || 0);
            });

            if (!hasExplicitDate && candidates.length > 1) {
                result.push(candidates[0]);
            } else {
                result.push(...candidates);
            }
        } else {
            const datePart = hasExplicitDate && targetYear && targetMonth ? ` ${String(targetMonth).padStart(2, '0')}/${targetYear}` : '';
            const ufPart = uf ? ` ${uf}` : '';
            warnings.push(`Base "${baseName}${ufPart}${datePart}" não encontrada. Verifique se a base foi importada.`);
        }
    }

    return { filtered: result, warnings };
}


// G5-PREP: Price helpers moved to compositionMath.ts

export function CompositionEditor({ items, initialIndex, onClose, onUpdateItem, onCompositionSaved, engineeringConfig, proposalId, bdiConfig }: Props) {
    // FIX STAB-05: Guard against losing unsaved composition changes
    const handleSafeClose = useCallback(() => {
        if (hasChangesRef.current) {
            const shouldClose = window.confirm(
                'Você tem alterações não salvas nesta composição.\n\nDeseja sair sem salvar?'
            );
            if (!shouldClose) return;
        }
        onClose();
    }, [onClose]);
    const hasChangesRef = useRef(false);
    const [currentIndex, setCurrentIndex] = useState(initialIndex);
    const currentItem = items[currentIndex];
    const hasPrev = currentIndex > 0;
    const hasNext = currentIndex < items.length - 1;
    const [data, setRawData] = useState<any>(null);
    const setData = useCallback((nextData: any) => {
        if (typeof nextData === 'function') {
            setRawData((prev: any) => {
                const res = nextData(prev);
                if (res && res.groups) {
                    return {
                        ...res,
                        items: Object.values(res.groups).flat().filter(Boolean)
                    };
                }
                return res;
            });
        } else {
            if (nextData && nextData.groups) {
                setRawData({
                    ...nextData,
                    items: Object.values(nextData.groups).flat().filter(Boolean)
                });
            } else {
                setRawData(nextData);
            }
        }
    }, []);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['MATERIAL', 'MAO_DE_OBRA', 'EQUIPAMENTO', 'SERVICO', 'AUXILIAR']));
    const [editingField, setEditingField] = useState<{ id: string; field: 'coef' | 'price' } | null>(null);
    const [editValue, setEditValue] = useState('');
    const [hasChanges, setHasChanges] = useState(false);
    // FIX STAB-05: Keep ref in sync for use in handleSafeClose
    useEffect(() => { hasChangesRef.current = hasChanges; }, [hasChanges]);
    const [isSavingToBase, setIsSavingToBase] = useState(false);
    const [isExtractingAi, setIsExtractingAi] = useState(false);

    // Search inside editor
    const [showSearch, setShowSearch] = useState(false);
    const [searchType, setSearchType] = useState<'item' | 'composition'>('item');
    const [bases, setBases] = useState<any[]>([]);
    const [selectedBaseId, setSelectedBaseId] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<any[]>([]);
    const [isSearching, setIsSearching] = useState(false);

    // Hub-style search enhancements
    const searchDebounceRef = useRef<any>(null);
    const hasAutoSelectedBaseRef = useRef(false);
    const [searchCoefficients, setSearchCoefficients] = useState<Record<string, number>>({});
    const [addedItemIds, setAddedItemIds] = useState<Set<string>>(new Set());
    const [addedCount, setAddedCount] = useState(0);
    const [showPropriaForm, setShowPropriaForm] = useState(false);
    const [propriaCode, setPropriaCode] = useState('');
    const [propriaDesc, setPropriaDesc] = useState('');
    const [propriaUnit, setPropriaUnit] = useState('UN');
    const [propriaPrice, setPropriaPrice] = useState('');
    const [propriaCoef, setPropriaCoef] = useState('1');
    const [propriaSaving, setPropiaSaving] = useState(false);

    // ── Phase 4: Free Mode States ──
    const [showFreeItemModal, setShowFreeItemModal] = useState(false);
    const [freeItemData, setFreeItemData] = useState({ description: '', unit: 'UN', coefficient: '1', price: '0', type: 'MATERIAL' });
    const [freeItemTargetGroup, setFreeItemTargetGroup] = useState<string | null>(null);
    
    const [showFactorModal, setShowFactorModal] = useState(false);
    const [factorData, setFactorData] = useState({ value: '1.05', target: 'ALL' });
    
    const [showDiscountModal, setShowDiscountModal] = useState(false);
    const [discountData, setDiscountData] = useState({ value: '10', target: 'ALL' });

    const [showRateioModal, setShowRateioModal] = useState(false);
    const [rateioData, setRateioData] = useState({ prazo: '2', fracao: '100' });

    // ── AI Extraction in toolbar (when composition already has items) ──
    const [showAiDropzone, setShowAiDropzone] = useState(false);
    const aiFileInputRef = useRef<HTMLInputElement>(null);

    // G7-FIX: Use dedicated drill-down hook instead of inline state
    const drill = useDrillDown(currentItem?.code, engineeringConfig?.precision);

    // Legacy alias — gradually migrating from drillStack to drill.*
    const drillStack = drill.stack;

    const [observation, setObservation] = useState('');
    // Grouper editing states
    const [grouperDesc, setGrouperDesc] = useState('');
    const [grouperFactor, setGrouperFactor] = useState('1');
    const [grouperFactorSaved, setGrouperFactorSaved] = useState(false);

    // ── GAP 2: Group notes ──
    const [groupNotes, setGroupNotes] = useState<Record<string, string>>({});
    const [editingGroupNote, setEditingGroupNote] = useState<string | null>(null);

    // ── Etapa/Observation inline editing ──
    const [editingEtapaId, setEditingEtapaId] = useState<string | null>(null);
    const [editingEtapaText, setEditingEtapaText] = useState('');

    // ── Proprietary items renaming states ──
    const [isEditingTitle, setIsEditingTitle] = useState(false);
    const [tempTitle, setTempTitle] = useState('');
    const [editingItemDescId, setEditingItemDescId] = useState<string | null>(null);
    const [editingItemDescText, setEditingItemDescText] = useState('');

    const isProprietaryItem = useCallback((itemData: any, ci: any) => {
        if (!itemData) return false;
        if (itemData.isNew) return true;
        const dbType = itemData.database?.type;
        const dbName = itemData.database?.name || ci?._matchedDatabase;
        if (dbType === 'PROPRIA') return true;
        if (isPropria(dbName)) return true;
        return false;
    }, []);

    // ── Group/Section (Etapa) management ──
    const [customGroupLabels, setCustomGroupLabels] = useState<Record<string, string>>({});
    const [editingGroupLabel, setEditingGroupLabel] = useState<string | null>(null);
    const [editingGroupLabelText, setEditingGroupLabelText] = useState('');
    const [showNewGroupModal, setShowNewGroupModal] = useState(false);
    const [newGroupName, setNewGroupName] = useState('');

    // ── Move item between groups ──
    const [movingItemId, setMovingItemId] = useState<string | null>(null);

    // ── Drag & Drop between groups ──
    const [dragItem, setDragItem] = useState<{ id: string; sourceGroup: string; sourceIndex: number } | null>(null);
    const [dragOverGroup, setDragOverGroup] = useState<string | null>(null);
    const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

    // ── Drag & Drop: Reorder entire groups (etapas) ──
    const [dragGroupKey, setDragGroupKey] = useState<string | null>(null);
    const [dragOverGroupIdx, setDragOverGroupIdx] = useState<number | null>(null);
    const [groupOrder, setGroupOrder] = useState<string[]>([]);

    // ── Change item base classification ──
    const [editingBaseItemId, setEditingBaseItemId] = useState<string | null>(null);
    const [editingTypeItemId, setEditingTypeItemId] = useState<string | null>(null);

    // ── GAP 3: Reference Divisor ──
    const [refDivisorLabel, setRefDivisorLabel] = useState('');
    const [refDivisorValue, setRefDivisorValue] = useState('');

    const [prevCurrentItemCode, setPrevCurrentItemCode] = useState<string | null>(null);
    const [prevCurrentItemId, setPrevCurrentItemId] = useState<string | null>(null);
    if (currentItem && (currentItem.code !== prevCurrentItemCode || currentItem.id !== prevCurrentItemId)) {
        setPrevCurrentItemCode(currentItem.code || null);
        setPrevCurrentItemId(currentItem.id || null);
        const isGrouper = isGrouperType(currentItem.type);
        setLoading(!isGrouper);
        setError('');
        setData(null);
        setHasChanges(false);
        setGroupNotes({});
        setCustomGroupLabels({});
        setGroupOrder([]);
        setRefDivisorLabel('');
        setRefDivisorValue('');
        drill.reset();
        if (isGrouper) {
            setGrouperDesc(currentItem.description || '');
            setGrouperFactor(String(currentItem.multiplicationFactor || 1));
            setGrouperFactorSaved(false);
        }
    }

    const activeCode = drill.activeCode;

    const triggerUpdateItem = useCallback((updates: Partial<EngItem>) => {
        if (onUpdateItem && currentItem) {
            const isRoot = !drill.isInDrill;
            const isGrouper = currentItem.type === 'ETAPA' || currentItem.type === 'SUBETAPA';
            
            const descToUse = updates.description !== undefined
                ? updates.description
                : (isRoot && !isGrouper && data?.description ? data.description : undefined);

            let costToUse = updates.unitCost;
            if (isRoot && !isGrouper && costToUse !== undefined) {
                const parsedDiv = refDivisorValue ? (parseFloat(refDivisorValue.replace(',', '.')) || 1) : 1;
                if (parsedDiv > 0) {
                    costToUse = applyPrecision(costToUse / parsedDiv, { precision: engineeringConfig?.precision });
                }
            }

            // CASCA-FIX: Automatically propagate compositionTotalPrice when unitCost is being updated
            // from the composition data. This ensures all cascade points (addFromSearch, inline edits,
            // delete, factor, etc.) inform the spreadsheet this is a formed price.
            const compositionTotalPrice = (updates as any).compositionTotalPrice !== undefined
                ? (updates as any).compositionTotalPrice
                : (isRoot && !isGrouper && costToUse !== undefined && data?.totalPrice !== undefined
                    ? data.totalPrice
                    : undefined);

            onUpdateItem(currentItem.id, {
                ...updates,
                ...(descToUse !== undefined ? { description: descToUse } : {}),
                ...(costToUse !== undefined ? { unitCost: costToUse } : {}),
                ...(compositionTotalPrice !== undefined ? { compositionTotalPrice } : {}),
            } as any);
        }
    }, [onUpdateItem, currentItem, drill.depth, data?.description, data?.totalPrice, refDivisorValue, engineeringConfig]);

    // Load bases once when opening search — filtered by Step 1 config
    useEffect(() => {
        if (showSearch && bases.length === 0) {
            fetch('/api/engineering/bases', { headers: hdrs() })
                .then(r => r.json()).then(data => {
                    if (Array.isArray(data)) {
                        setBases(data);
                    }
                }).catch(console.error);
        }
    }, [showSearch, bases.length]);

    // Reset auto-select control when search modal is closed
    useEffect(() => {
        if (!showSearch) {
            hasAutoSelectedBaseRef.current = false;
        }
    }, [showSearch]);

    // Auto-select selectedBaseId when search opens or currentItem/bases change
    useEffect(() => {
        if (showSearch && bases.length > 0 && !hasAutoSelectedBaseRef.current) {
            const { filtered } = filterBasesWithWarnings(bases, engineeringConfig);
            
            // 1. Try to match the current item's own database first
            const matchedDbId = currentItem?.priceAudit?.matchedDatabaseId;
            if (matchedDbId && filtered.some(b => b.id === matchedDbId)) {
                setSelectedBaseId(matchedDbId);
                hasAutoSelectedBaseRef.current = true;
                return;
            } 

            // 2. Try to match by current item's sourceName
            if (currentItem?.sourceName) {
                const sourceUpper = currentItem.sourceName.toUpperCase();
                const matchedBySource = filtered.find(b => b.name.toUpperCase().includes(sourceUpper));
                if (matchedBySource) {
                    setSelectedBaseId(matchedBySource.id);
                    hasAutoSelectedBaseRef.current = true;
                    return;
                }
            }

            // 3. Fallback: Check if the current selectedBaseId is in the filtered list
            const isCurrentBaseInFiltered = filtered.some(b => b.id === selectedBaseId);
            if (!isCurrentBaseInFiltered && filtered.length > 0) {
                setSelectedBaseId(filtered[0].id);
                hasAutoSelectedBaseRef.current = true;
            } else if (isCurrentBaseInFiltered) {
                hasAutoSelectedBaseRef.current = true;
            }
        }
    }, [showSearch, bases, currentItem, engineeringConfig]);

    const handleSearch = useCallback(async (query?: string) => {
        const q = query ?? searchQuery;
        if (!selectedBaseId || !q || q.length < 2) {
            if (!q) setSearchResults([]);
            return;
        }
        setIsSearching(true);
        try {
            let url = '';
            if (searchType === 'item') {
                const params = new URLSearchParams({ q });
                if (engineeringConfig?.regimeOneracao) params.append('regime', engineeringConfig.regimeOneracao);
                const selectedBase = bases.find(b => b.id === selectedBaseId);
                const effectiveDate = (selectedBase && engineeringConfig?.dataBases?.[selectedBase.name]) || engineeringConfig?.dataBase;
                if (effectiveDate) params.append('dataBase', effectiveDate);
                url = `/api/engineering/bases/${selectedBaseId}/items?${params.toString()}`;
            } else {
                const params = new URLSearchParams({ databaseId: selectedBaseId, q });
                if (proposalId) params.append('proposalId', proposalId);
                url = `/api/engineering/compositions?${params.toString()}`;
            }
            const res = await fetch(url, { headers: hdrs() });
            const d = await res.json();
            setSearchResults(searchType === 'item' ? (d.items || []) : (Array.isArray(d) ? d : []));
        } catch { } finally { setIsSearching(false); }
    }, [searchQuery, selectedBaseId, bases, engineeringConfig, searchType, proposalId]);

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
    }, [searchQuery, selectedBaseId, searchType, showSearch]);

    const addFromSearch = (dbItem: any) => {
        if (!data) return;
        
        if (searchType === 'composition') {
            if (drill.checkCircularDependency(dbItem.code)) {
                alert(`Erro: Dependência Circular Detectada! Não é possível adicionar a composição auxiliar "${dbItem.code}", pois ela já é uma composição ancestral na estrutura atual.`);
                return;
            }
        }
        
        const rawCoef = searchCoefficients[dbItem.id] || 1;
        const coef = hasRateio ? rawCoef * rateioFactor : rawCoef;
        let typeKey = 'MATERIAL';
        let newItem: any = null;

        // Resolve source database name for correct badge display
        const selectedBase = bases.find(b => b.id === selectedBaseId);
        const sourceDbName = selectedBase?.name || '';

        if (searchType === 'composition') {
            typeKey = 'AUXILIAR';
            newItem = {
                id: `temp-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
                coefficient: coef,
                price: Number(dbItem.totalPrice) || 0,
                _matchedDatabase: sourceDbName,
                auxiliaryComposition: {
                    id: dbItem.id,
                    code: dbItem.code,
                    description: dbItem.description,
                    unit: dbItem.unit,
                    totalPrice: Number(dbItem.totalPrice) || 0
                }
            };
        } else {
            const rawType = (dbItem.type || '').toUpperCase();
            if (rawType.includes('MAO') || rawType.includes('MÃO')) typeKey = 'MAO_DE_OBRA';
            else if (rawType.includes('EQUIP')) typeKey = 'EQUIPAMENTO';
            else if (rawType.includes('SERVICO')) typeKey = 'SERVICO';
            else typeKey = 'MATERIAL';

            newItem = {
                id: `temp-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
                coefficient: coef,
                price: Number(dbItem.price) || 0,
                _matchedDatabase: sourceDbName,
                item: {
                    id: dbItem.id,
                    code: dbItem.code,
                    description: dbItem.description,
                    unit: dbItem.unit,
                    type: typeKey,
                    price: Number(dbItem.price) || 0
                }
            };
        }

        const targetGroup = getLastTargetGroup() || typeKey;
        const updated = { ...data, groups: { ...data.groups } };
        if (!updated.groups[targetGroup]) updated.groups[targetGroup] = [];
        updated.groups[targetGroup] = [...updated.groups[targetGroup], newItem];

        updated.totalPrice = sumCompositionGroups(updated.groups, engineeringConfig?.precision);
        updated.totalDirect = updated.totalPrice;

        setData(updated);
        setHasChanges(true);

        triggerUpdateItem({ unitCost: updated.totalPrice });

        // Flash feedback — keep modal open for adding more items
        setAddedItemIds(prev => new Set(prev).add(dbItem.id));
        setAddedCount(c => c + 1);
        setTimeout(() => setAddedItemIds(prev => { const next = new Set(prev); next.delete(dbItem.id); return next; }), 1500);
    };

    // Reset search session state when modal closes
    const closeSearchModal = () => {
        setShowSearch(false); setSearchQuery(''); setSearchResults([]);
        setSearchCoefficients({}); setAddedItemIds(new Set()); setAddedCount(0);
        setShowPropriaForm(false); setPropriaCode(''); setPropriaDesc(''); setPropriaUnit('UN'); setPropriaPrice(''); setPropriaCoef('1');
    };

    // Create proprietary item in PROPRIA database and add to composition
    const handleCreatePropria = async () => {
        if (!propriaCode.trim() || !propriaDesc.trim() || !propriaPrice.trim() || !data) return;
        
        if (searchType === 'composition') {
            if (drill.checkCircularDependency(propriaCode)) {
                alert(`Erro: Dependência Circular Detectada! Não é possível criar e adicionar a composição auxiliar "${propriaCode}", pois ela já é uma composição ancestral na estrutura atual.`);
                return;
            }
        }
        
        setPropiaSaving(true);
        try {
            const qs = proposalId ? `?proposalId=${encodeURIComponent(proposalId)}` : '';
            const res = await fetch(`/api/engineering/propria/create${qs}`, {
                method: 'POST', headers: hdrs(),
                body: JSON.stringify({
                    code: propriaCode.trim(),
                    description: propriaDesc.trim(),
                    unit: propriaUnit.trim() || 'UN',
                    price: parseFloat(propriaPrice.replace(',', '.')) || 0,
                    recordKind: searchType === 'composition' ? 'COMPOSICAO' : 'INSUMO',
                }),
            });
            const result = await res.json();
            if (!res.ok) throw new Error(result.error || 'Erro ao criar item');

            const price = Number(result.item.price) || 0;
            const rawCoef = parseFloat(propriaCoef.replace(',', '.')) || 1;
            const coef = hasRateio ? rawCoef * rateioFactor : rawCoef;
            const typeKey = searchType === 'composition' ? 'AUXILIAR' : 'MATERIAL';
            const newItem = searchType === 'composition' ? {
                id: `temp-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`, coefficient: coef, price,
                auxiliaryComposition: { id: result.item.id, code: result.item.code, description: result.item.description, unit: result.item.unit, totalPrice: price }
            } : {
                id: `temp-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`, coefficient: coef, price,
                item: { id: result.item.id, code: result.item.code, description: result.item.description, unit: result.item.unit, type: 'MATERIAL', price }
            };

            const targetGroup = getLastTargetGroup() || typeKey;
            const updated = { ...data, groups: { ...data.groups } };
            if (!updated.groups[targetGroup]) updated.groups[targetGroup] = [];
            updated.groups[targetGroup] = [...updated.groups[targetGroup], newItem];
            updated.totalPrice = sumCompositionGroups(updated.groups, engineeringConfig?.precision);
            updated.totalDirect = updated.totalPrice;
            setData(updated);
            setHasChanges(true);
            triggerUpdateItem({ unitCost: updated.totalPrice });

            setAddedCount(c => c + 1);
            setPropriaCode(''); setPropriaDesc(''); setPropriaUnit('UN'); setPropriaPrice(''); setPropriaCoef('1');
        } catch (e: any) { alert(e.message || 'Erro ao criar item'); }
        finally { setPropiaSaving(false); }
    };

    // ── Restore composition from drillStack snapshot (avoids losing unsaved data) ──
    const restoreFromSnapshot = useCallback((
        snapshotOrData: any | DrillLevelSnapshot,
        snapshotGroupNotes?: Record<string, string>,
        snapshotCustomLabels?: Record<string, string>,
        snapshotGroupOrder?: string[],
        snapshotRefDivisorLabel?: string,
        snapshotRefDivisorValue?: string,
        snapshotHasChanges?: boolean,
        snapshotObservation?: string
    ) => {
        setLoading(false);
        setError('');
        // G7-FIX: Detect if called with DrillLevelSnapshot (has .data property + .groupNotes)
        if (snapshotOrData && typeof snapshotOrData === 'object' && 'data' in snapshotOrData && 'groupNotes' in snapshotOrData) {
            const s = snapshotOrData as DrillLevelSnapshot;
            setData(s.data);
            setGroupNotes(s.groupNotes || {});
            setCustomGroupLabels(s.customGroupLabels || {});
            setGroupOrder(s.groupOrder || []);
            setRefDivisorLabel(s.refDivisorLabel || '');
            setRefDivisorValue(s.refDivisorValue || '');
            setHasChanges(s.hasChanges ?? false);
            setObservation(s.observation || '');
        } else {
            // Legacy 8-parameter call
            setData(snapshotOrData);
            setGroupNotes(snapshotGroupNotes || {});
            setCustomGroupLabels(snapshotCustomLabels || {});
            setGroupOrder(snapshotGroupOrder || []);
            setRefDivisorLabel(snapshotRefDivisorLabel || '');
            setRefDivisorValue(snapshotRefDivisorValue || '');
            setHasChanges(snapshotHasChanges ?? false);
            setObservation(snapshotObservation || '');
        }
    }, []);

    const loadComposition = useCallback(async (code: string, overrideSourceName?: string, overrideDatabaseId?: string) => {
        if (!code || code === 'N/A') {
            setData(null);
            setError('Este item não possui código de composição vinculado.');
            setLoading(false);
            return;
        }
        setLoading(true);
        setError('');
        setData(null);
        setHasChanges(false);
        setGroupNotes({});
        setCustomGroupLabels({});
        setGroupOrder([]);
        setRefDivisorLabel('');
        setRefDivisorValue('');
        try {
            const params = new URLSearchParams();
            // FIX CASCADE-02: Use override params when navigating drill-down,
            // falling back to root budget item context
            const effectiveDatabaseId = overrideDatabaseId || currentItem?.priceAudit?.matchedDatabaseId;
            const effectiveSourceName = overrideSourceName || currentItem?.sourceName;
            if (effectiveDatabaseId) params.set('databaseId', effectiveDatabaseId);
            if (effectiveSourceName) params.set('sourceName', effectiveSourceName);
            if (proposalId) params.set('proposalId', proposalId);
            const qs = params.toString();
            const res = await fetch(`/api/engineering/compositions/${encodeURIComponent(code)}${qs ? `?${qs}` : ''}`, { headers: hdrs() });
            if (!res.ok) throw new Error('not_found');
            const d = await res.json();

            // ── FALLBACK: When database has no analytical items, use AI-extracted insumos ──
            if (d.hasAnalyticalItems === false && currentItem?.insumos && currentItem.insumos.length > 0) {
                const fallbackGroups: Record<string, any[]> = { MATERIAL: [], MAO_DE_OBRA: [], EQUIPAMENTO: [], SERVICO: [], AUXILIAR: [] };
                let fallbackTotal = 0;
                currentItem.insumos.forEach((ins, idx) => {
                    const groupKey = (['MATERIAL', 'MAO_DE_OBRA', 'EQUIPAMENTO', 'SERVICO', 'AUXILIAR'].includes(ins.type)) ? ins.type : 'MATERIAL';
                    const subtotal = ins.coefficient * ins.unitPrice;
                    fallbackTotal += subtotal;
                    if (!fallbackGroups[groupKey]) fallbackGroups[groupKey] = [];
                    fallbackGroups[groupKey].push({
                        id: `insumo-${idx}`,
                        coefficient: ins.coefficient,
                        price: subtotal,
                        item: {
                            id: `insumo-item-${idx}`,
                            code: '',
                            description: ins.description,
                            unit: ins.unit,
                            type: groupKey,
                            price: ins.unitPrice,
                        },
                    });
                });
                d.groups = fallbackGroups;
                d.items = Object.values(fallbackGroups).flat();
                d.totalPrice = fallbackTotal;
                d.totalDirect = fallbackTotal;
                d.hasAnalyticalItems = true;
                d.sourceIsEdital = true;
            }

            const normalized = normalizeCompositionMath(d, engineeringConfig?.precision);
            setData(normalized);
            // Expand all groups by default
            if (normalized.groups) {
                const groupKeys = Object.keys(normalized.groups);
                setExpandedGroups(prev => {
                    const newSet = new Set(prev);
                    groupKeys.forEach(k => newSet.add(k));
                    return newSet;
                });
            }
            // Restore GAP 2/3 data from composition
            if (normalized.groupNotes) setGroupNotes(normalized.groupNotes);
            if (normalized.customGroupLabels) setCustomGroupLabels(normalized.customGroupLabels);
            if (normalized.groupOrder && Array.isArray(normalized.groupOrder)) setGroupOrder(normalized.groupOrder);
            if (normalized.referenceDivisor) {
                setRefDivisorLabel(normalized.referenceDivisor.label || '');
                setRefDivisorValue(String(normalized.referenceDivisor.value || ''));
            } else {
                setRefDivisorLabel('');
                setRefDivisorValue('');
            }
            const cachedNote = engineeringConfig?.reportConfig?.compositionNotes?.[code];
            setObservation(cachedNote !== undefined ? cachedNote : (normalized.observation || ''));
        } catch {
            setError('not_found');
        }
        setLoading(false);
    }, [currentItem?.priceAudit?.matchedDatabaseId, currentItem?.sourceName, currentItem?.insumos, engineeringConfig, proposalId]);

    useEffect(() => {
        if (currentItem) {
            if (isGrouperType(currentItem.type)) {
                // For groupers, don't load composition — show editor
                setData(null);
                setLoading(false);
                setError('');
                setGrouperDesc(currentItem.description || '');
                setGrouperFactor(String(currentItem.multiplicationFactor || 1));
                setGrouperFactorSaved(false);
            } else if (currentItem.code) {
                drill.reset();
                loadComposition(currentItem.code);
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentItem?.code, currentItem?.type]);

    // G7-FIX: Cascade is now handled by useDrillDown hook
    useEffect(() => {
        if (drill.isInDrill && data && data.totalPrice !== undefined) {
            const didUpdate = drill.updateParentSnapshots(data);
            if (didUpdate) {
                setHasChanges(true);
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data, drill.depth, engineeringConfig?.precision]);

    const navigate = (dir: -1 | 1) => {
        const next = currentIndex + dir;
        if (next >= 0 && next < items.length) setCurrentIndex(next);
    };

    // Keyboard navigation (disabled while editing)
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (editingField) return;
            if (e.key === 'ArrowLeft' && hasPrev) navigate(-1);
            if (e.key === 'ArrowRight' && hasNext) navigate(1);
            if (e.key === 'Escape') handleSafeClose();
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [currentIndex, hasPrev, hasNext, editingField]);

    const handleExtractAi = async (file: File) => {
        if (!currentItem) return;
        setIsExtractingAi(true);
        try {
            const formData = new FormData();
            formData.append('file', file);
            // FIX CASCADE-01: In drill-down, use the current drillStack level's code/description
            // This ensures AI extracts the correct composition, not the parent budget item
            const drillLevel = drill.currentLevel;
            formData.append('code', drillLevel?.code || currentItem.code);
            formData.append('description', drillLevel?.description || currentItem.description);
            formData.append('unit', currentItem.unit);
            if (engineeringConfig) {
                formData.append('engineeringConfig', JSON.stringify(engineeringConfig));
            }
            if (proposalId) {
                formData.append('proposalId', proposalId);
            }

            const res = await fetch('/api/engineering/ai/extract-composition', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token()}` }, // No Content-Type so browser sets boundary
                body: formData
            });

            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error + (err.details ? `: ${err.details}` : ''));
            }

            const extracted = await res.json();
            
            const updated = normalizeCompositionMath(extracted, engineeringConfig?.precision);
            
            // BUG-FIX: Preserve the original composition description and code from the budget item.
            // The AI extraction returns a generic description (e.g. "Composição Extraída via IA") 
            // which should NOT overwrite the real item name (e.g. "ADMINISTRAÇÃO DA OBRA").
            // Only groups, items, totalPrice, database, and _ai_stats should come from the extraction.
            // (drillLevel already declared above at L1000)
            const preservedDescription = data?.description || drillLevel?.description || currentItem.description;
            const preservedCode = data?.code || drillLevel?.code || currentItem.code;
            const preservedUnit = data?.unit || currentItem.unit;
            
            setData({
                ...updated,
                description: preservedDescription,
                code: preservedCode,
                unit: updated.unit || preservedUnit,
            });
            setError('');
            setHasChanges(true);
            
            triggerUpdateItem({ unitCost: updated.totalPrice });

        } catch (e: any) {
            alert(e.message || 'Erro de rede na extração AI');
        } finally {
            setIsExtractingAi(false);
        }
    };

    const toggleGroup = (key: string) => {
        setExpandedGroups(prev => {
            const n = new Set(prev);
            n.has(key) ? n.delete(key) : n.add(key);
            return n;
        });
    };

    // ── Drag & Drop: Move item between groups OR reorder within same group ──
    const handleDrop = (targetGroup: string, insertAtIndex?: number) => {
        if (!dragItem || !data) {
            setDragItem(null);
            setDragOverGroup(null);
            setDragOverIndex(null);
            return;
        }
        const updated = { ...data, groups: { ...data.groups } };
        const isSameGroup = dragItem.sourceGroup === targetGroup;

        if (isSameGroup) {
            // Reorder within the same group
            const items = [...(updated.groups[targetGroup] || [])];
            const fromIdx = items.findIndex((i: any) => i.id === dragItem.id);
            if (fromIdx === -1 || insertAtIndex === undefined || insertAtIndex === null) {
                setDragItem(null); setDragOverGroup(null); setDragOverIndex(null);
                return;
            }
            const [movedItem] = items.splice(fromIdx, 1);
            // Adjust target index after removal
            const adjustedIdx = insertAtIndex > fromIdx ? insertAtIndex - 1 : insertAtIndex;
            items.splice(adjustedIdx, 0, movedItem);
            updated.groups[targetGroup] = items;
        } else {
            // Move between groups
            const sourceItems = [...(updated.groups[dragItem.sourceGroup] || [])];
            const itemIndex = sourceItems.findIndex((i: any) => i.id === dragItem.id);
            if (itemIndex === -1) { setDragItem(null); setDragOverGroup(null); setDragOverIndex(null); return; }
            const [movedItem] = sourceItems.splice(itemIndex, 1);
            updated.groups[dragItem.sourceGroup] = sourceItems;
            // Add to target group at specific position or end
            if (!updated.groups[targetGroup]) updated.groups[targetGroup] = [];
            const targetItems = [...updated.groups[targetGroup]];
            if (insertAtIndex !== undefined && insertAtIndex !== null) {
                targetItems.splice(insertAtIndex, 0, movedItem);
            } else {
                targetItems.push(movedItem);
            }
            updated.groups[targetGroup] = targetItems;
        }
        // Recalculate totals
        updated.totalPrice = sumCompositionGroups(updated.groups, engineeringConfig?.precision);
        updated.totalDirect = updated.totalPrice;
        setData(updated);
        setHasChanges(true);
        triggerUpdateItem({ unitCost: updated.totalPrice });
        // Expand target group so user sees the moved item
        setExpandedGroups(prev => new Set([...prev, targetGroup]));
        setDragItem(null);
        setDragOverGroup(null);
        setDragOverIndex(null);
    };

    // ── Drag & Drop: Reorder entire groups (etapas) ──
    const getEffectiveGroupKeys = useCallback(() => {
        const allKeys = new Set([
            ...Object.keys(GROUP_META),
            ...(data?.groups ? Object.keys(data.groups) : []),
            ...Object.keys(customGroupLabels),
        ]);
        // If we have a saved groupOrder, use it as the base ordering
        if (groupOrder.length > 0) {
            const ordered: string[] = [];
            for (const key of groupOrder) {
                if (allKeys.has(key)) {
                    ordered.push(key);
                    allKeys.delete(key);
                }
            }
            // Append any new keys not in the saved order
            for (const key of allKeys) ordered.push(key);
            return ordered;
        }
        return Array.from(allKeys);
    }, [data, customGroupLabels, groupOrder]);

    const getLastTargetGroup = useCallback(() => {
        const keys = getEffectiveGroupKeys();
        for (let i = keys.length - 1; i >= 0; i--) {
            const key = keys[i];
            if (key === 'OBSERVACAO') continue;
            const groupItems = data?.groups?.[key] || [];
            const isCustomGroup = !GROUP_META[key] || key.startsWith('CUSTOM_') || !!customGroupLabels[key];
            if (groupItems.length > 0 || isCustomGroup) {
                return key;
            }
        }
        return null;
    }, [data, customGroupLabels, getEffectiveGroupKeys]);

    const handleGroupDrop = (targetIdx: number, isDirectDrop: boolean = false) => {
        if (dragGroupKey === null) return;
        const keys = getEffectiveGroupKeys();
        const fromIdx = keys.indexOf(dragGroupKey);
        if (fromIdx === -1 || fromIdx === targetIdx) {
            setDragGroupKey(null);
            setDragOverGroupIdx(null);
            return;
        }
        const newOrder = [...keys];
        const [moved] = newOrder.splice(fromIdx, 1);
        const adjustedIdx = isDirectDrop
            ? targetIdx
            : (targetIdx > fromIdx ? targetIdx - 1 : targetIdx);
        newOrder.splice(adjustedIdx, 0, moved);
        setGroupOrder(newOrder);
        setHasChanges(true);
        setDragGroupKey(null);
        setDragOverGroupIdx(null);
    };

    // ── Helper: Open free item modal targeting a specific group ──
    const openAddFreeItemToGroup = (groupKey: string) => {
        setFreeItemTargetGroup(groupKey);
        let typeVal = 'MATERIAL';
        if (GROUP_META[groupKey]) {
            typeVal = groupKey;
        }
        setFreeItemData({ description: '', unit: 'UN', coefficient: '1', price: '0', type: typeVal });
        setShowFreeItemModal(true);
    };

    // ── Group Actions: Delete Group ──
    const handleDeleteGroup = (groupKey: string) => {
        if (!data) return;
        const groupItems = data.groups?.[groupKey] || [];
        const displayLabel = customGroupLabels[groupKey] || GROUP_META[groupKey]?.label || groupKey;

        if (groupItems.length > 0) {
            const confirmed = window.confirm(
                `O grupo "${displayLabel}" contém ${groupItems.length} item(ns).\n\n` +
                `Tem certeza que deseja excluir este grupo e TODOS os seus insumos?\n` +
                `Esta ação não pode ser desfeita.`
            );
            if (!confirmed) return;
        } else {
            const confirmed = window.confirm(`Deseja excluir o grupo "${displayLabel}"?`);
            if (!confirmed) return;
        }

        const updated = { ...data, groups: { ...data.groups } };
        delete updated.groups[groupKey];

        const updatedLabels = { ...customGroupLabels };
        delete updatedLabels[groupKey];
        setCustomGroupLabels(updatedLabels);

        const updatedOrder = groupOrder.filter(k => k !== groupKey);
        setGroupOrder(updatedOrder);

        updated.totalPrice = sumCompositionGroups(updated.groups, engineeringConfig?.precision);
        updated.totalDirect = updated.totalPrice;

        setData(updated);
        setHasChanges(true);
        triggerUpdateItem({ unitCost: updated.totalPrice });
    };

    // ── Group Actions: Move Group Up/Down ──
    const moveGroupOrder = (groupKey: string, direction: -1 | 1) => {
        const keys = getEffectiveGroupKeys();
        const fromIdx = keys.indexOf(groupKey);
        if (fromIdx === -1) return;
        const toIdx = fromIdx + direction;
        if (toIdx < 0 || toIdx >= keys.length) return;

        const newOrder = [...keys];
        const temp = newOrder[fromIdx];
        newOrder[fromIdx] = newOrder[toIdx];
        newOrder[toIdx] = temp;

        setGroupOrder(newOrder);
        setHasChanges(true);
    };

    // ═══════════════════════════════════════════════════════
    // CASCADE ENGINE — Recalculates everything when a value changes
    // ═══════════════════════════════════════════════════════
    /**
     * Safe math expression evaluator — recursive descent parser.
     * Supports: +, -, *, /, parentheses, decimal numbers.
     * FIX SEC-01: Replaces new Function() (eval equivalent) to prevent code injection.
     */
    const evaluateMath = (expr: string): number => {
        try {
            const s = expr.replace(/,/g, '.').replace(/\s/g, '');
            if (!s) return NaN;
            let pos = 0;
            const peek = () => s[pos] || '';
            const consume = (ch?: string) => { if (ch && s[pos] !== ch) throw new Error('x'); pos++; };
            const parseNum = (): number => {
                const st = pos;
                if (peek() === '-') pos++;
                while (/[0-9.]/.test(peek())) pos++;
                const n = parseFloat(s.slice(st, pos));
                if (isNaN(n)) throw new Error('NaN');
                return n;
            };
            const parseFactor = (): number => {
                if (peek() === '(') { consume('('); const v = parseE(); consume(')'); return v; }
                return parseNum();
            };
            const parseT = (): number => {
                let l = parseFactor();
                while (peek() === '*' || peek() === '/') { const op = peek(); pos++; const r = parseFactor(); l = op === '*' ? l * r : l / r; }
                return l;
            };
            const parseE = (): number => {
                let l = parseT();
                while (peek() === '+' || peek() === '-') { const op = peek(); pos++; const r = parseT(); l = op === '+' ? l + r : l - r; }
                return l;
            };
            const result = parseE();
            if (pos !== s.length) throw new Error('trailing');
            return result;
        } catch {
            return NaN;
        }
    };

    const commitEdit = useCallback(() => {
        if (!editingField || !data || !editValue) {
            setEditingField(null);
            return;
        }

        const newVal = evaluateMath(editValue);
        if (isNaN(newVal) || newVal < 0) {
            setEditingField(null);
            return;
        }

        const updated = { ...data, groups: { ...data.groups } };
        let found = false;

        // Find and update the item across all groups
        for (const groupKey of Object.keys(updated.groups)) {
            updated.groups[groupKey] = updated.groups[groupKey].map((ci: any) => {
                if (ci.id !== editingField.id) return ci;
                found = true;
                if (editingField.field === 'coef') {
                    const originalCoef = newVal;
                    const newCoef = hasRateio ? (originalCoef * rateioFactor) : originalCoef;
                    const unitPrice = getLineUnitPrice(ci);
                    // GAP 1: preserve expression when it contains operators
                    const rawExpr = editValue.trim();
                    const hasExpression = /[*\/+\-]/.test(rawExpr) && rawExpr !== String(originalCoef);
                    return {
                        ...ci,
                        coefficient: newCoef,
                        coefficientExpression: hasExpression ? rawExpr : undefined,
                        price: applyPrecision(newCoef * unitPrice, { precision: engineeringConfig?.precision }),
                    };
                } else {
                    // price edit
                    const newPrice = newVal;
                    const newItem = { ...(ci.item || ci.auxiliaryComposition), price: newPrice };
                    return {
                        ...ci,
                        item: ci.item ? newItem : ci.item,
                        auxiliaryComposition: ci.auxiliaryComposition ? newItem : ci.auxiliaryComposition,
                        price: applyPrecision(ci.coefficient * newPrice, { precision: engineeringConfig?.precision }),
                    };
                }
            });
        }

        if (!found) {
            setEditingField(null);
            return;
        }

        updated.totalPrice = sumCompositionGroups(updated.groups, engineeringConfig?.precision);
        updated.totalDirect = updated.totalPrice;

        setData(updated);
        setHasChanges(true);

        // CASCADE → Update the parent planilha item with new unitCost
        triggerUpdateItem({ unitCost: updated.totalPrice });

        setEditingField(null);
    }, [editingField, editValue, data, currentItem, onUpdateItem]);

    const startEdit = (id: string, field: 'coef' | 'price', currentValue: number, expression?: string) => {
        setEditingField({ id, field });
        // GAP 1: If there's a stored expression, show it instead of the computed value
        setEditValue(expression || String(currentValue));
    };

    const handleSaveTitle = () => {
        const trimmed = tempTitle.trim();
        const currentCompDesc = drill.isInDrill ? drill.currentLevel!.description : (data?.description || currentItem.description);
        if (trimmed && trimmed !== currentCompDesc) {
            // Update local data description
            setData((prev: any) => prev ? { ...prev, description: trimmed } : prev);
            
            // If in drillstack, update the drillstack entry description
            if (drill.isInDrill) {
                drill.updateCurrentDescription(trimmed);
            } else {
                // Also notify parent item about the updated description
                triggerUpdateItem({ description: trimmed });
            }

            // Also notify parent spreadsheet about this composition's name change!
            if (onUpdateItem && activeCode) {
                (onUpdateItem as any)('__syncComposition__', { code: activeCode, description: trimmed });
            }

            setHasChanges(true);
        }
        setIsEditingTitle(false);
    };

    const handleSaveItemDesc = (ciId: string) => {
        const trimmed = editingItemDescText.trim();
        if (trimmed) {
            setData((prev: any) => {
                if (!prev || !prev.groups) return prev;
                const updatedGroups = { ...prev.groups };
                for (const groupKey of Object.keys(updatedGroups)) {
                    updatedGroups[groupKey] = updatedGroups[groupKey].map((ci: any) => {
                        if (ci.id === ciId) {
                            const itemField = ci.item ? 'item' : 'auxiliaryComposition';
                            return {
                                ...ci,
                                [itemField]: {
                                    ...ci[itemField],
                                    description: trimmed
                                }
                            };
                        }
                        return ci;
                    });
                }
                return { ...prev, groups: updatedGroups };
            });
            setHasChanges(true);
        }
        setEditingItemDescId(null);
    };

    const saveToBase = async () => {
        if (!data || !data.id || !currentItem) return;
        setIsSavingToBase(true);
        try {
            // Use the budget item's code as canonical — UNLESS in drill-down, where we use the drillStack code
            const drillLevel = drill.currentLevel;
            const canonicalCode = drillLevel?.code || currentItem.code;
            let targetId: string | null = null;

            // FIX SYNC-01: Detect if this composition comes from an official database
            const isOfficialOrigin = data.database?.type === 'OFICIAL' || 
                (data.database?.name && data.database.name !== 'PROPRIA');
            
            // Build _officialRef to preserve traceability when saving official → PROPRIA
            const officialRef = isOfficialOrigin ? {
                databaseId: data.databaseId || data.database?.id,
                databaseName: data.database?.name,
                databaseUf: data.database?.uf,
                originalCode: data.code,
            } : (data._officialRef || undefined);
            
            // 1. Try to find existing PROPRIA composition — check both canonical code and data.code
            // (they can differ: budget has "COMP. 1103.1", AI extracts "1103.1")
            const codesToTry = [canonicalCode, data.code].filter(Boolean);
            const uniqueCodes = [...new Set(codesToTry)];
            
            for (const tryCode of uniqueCodes) {
                if (targetId) break;
                try {
                    const searchParams = new URLSearchParams({ sourceName: 'PROPRIA' });
                    if (proposalId) searchParams.append('proposalId', proposalId);
                    const resSearch = await fetch(`/api/engineering/compositions/${encodeURIComponent(tryCode)}?${searchParams.toString()}`, { headers: hdrs() });
                    if (resSearch.ok) {
                        const found = await resSearch.json();
                        if (found?.id && !found.id.startsWith('synthetic-')) {
                            targetId = found.id;
                        }
                    }
                } catch { /* skip */ }
            }
            
            // 2. If no existing PROPRIA found, create one with the canonical budget code
            if (!targetId) {
                const postParams = new URLSearchParams();
                if (proposalId) postParams.append('proposalId', proposalId);
                const resCreate = await fetch(`/api/engineering/compositions?${postParams.toString()}`, {
                    method: 'POST',
                    headers: hdrs(),
                    body: JSON.stringify({
                        code: canonicalCode,
                        description: data.description || currentItem.description,
                        unit: data.unit || currentItem.unit,
                    })
                });
                if (!resCreate.ok) {
                    const err = await resCreate.json();
                    if (!err.error?.includes('Já existe')) {
                        throw new Error('Erro ao criar composição na base PRÓPRIA');
                    }
                    // Already exists — fetch it
                    const retryParams = new URLSearchParams({ sourceName: 'PROPRIA' });
                    if (proposalId) retryParams.append('proposalId', proposalId);
                    const resRetry = await fetch(`/api/engineering/compositions/${encodeURIComponent(canonicalCode)}?${retryParams.toString()}`, { headers: hdrs() });
                    if (resRetry.ok) {
                        const retryData = await resRetry.json();
                        targetId = retryData.id;
                    }
                } else {
                    const created = await resCreate.json();
                    targetId = created.composition.id;
                }
            }

            if (!targetId) {
                throw new Error('Não foi possível localizar ou criar a composição na base PRÓPRIA');
            }

            // 3. PUT to update the PROPRIA composition with the extracted items
            // FIX SYNC-01: Include _officialRef so we preserve traceability to the official base
            const effectiveDatabaseId = currentItem?.priceAudit?.matchedDatabaseId || data.databaseId || data.database?.id || data._officialRef?.databaseId;
            const params = new URLSearchParams();
            if (effectiveDatabaseId) params.set('databaseId', effectiveDatabaseId);
            if (proposalId) params.set('proposalId', proposalId);
            const qs = params.toString();
            
            const res = await fetch(`/api/engineering/compositions/${targetId}${qs ? `?${qs}` : ''}`, {
                method: 'PUT',
                headers: hdrs(),
                body: JSON.stringify({
                    composition: {
                        ...data,
                        code: canonicalCode,
                        _officialRef: officialRef,
                        groupNotes,
                        customGroupLabels,
                        groupOrder,
                        observation,
                        referenceDivisor: refDivisorValue ? { label: refDivisorLabel || '', value: parseFloat(refDivisorValue.replace(',', '.')) || 0 } : undefined
                    }
                })
            });
            if (!res.ok) {
                const errBody = await res.json().catch(() => ({}));
                throw new Error(errBody.error || 'Erro ao salvar composição na base');
            }
            const putRes = await res.json();
            const savedId = putRes.id || targetId;
            
            // FIX SYNC-01: After saving, update local state to reflect the new PROPRIA status
            // WITHOUT reloading (avoids the vicious cycle: PROPRIA→load→PROPRIA overrides official)
            setData((prev: any) => prev ? {
                ...prev,
                id: savedId,
                database: { ...prev.database, name: proposalId ? `PROPRIA_${proposalId}` : 'PROPRIA', type: 'PROPRIA' },
                _officialRef: officialRef,
            } : prev);
            setHasChanges(false);

            const divisor = refDivisorValue ? (parseFloat(refDivisorValue.replace(',', '.')) || 1) : 1;
            const finalCost = divisor > 0 
                ? applyPrecision(data.totalPrice / divisor, { precision: engineeringConfig?.precision }) 
                : data.totalPrice;

            // G11-FIX: Use typed callback instead of magic string __syncComposition__
            if (onCompositionSaved && canonicalCode) {
                onCompositionSaved({
                    code: canonicalCode,
                    description: data.description || currentItem.description,
                    unit: data.unit || currentItem.unit,
                    unitCost: finalCost,
                    compositionTotalPrice: data.totalPrice,
                    sourceName: 'PROPRIA'
                });
                // FIX SYNC-PRICE: Skip triggerUpdateItem when onCompositionSaved already handled propagation.
                // Both paths update the same parent item — calling both causes race conditions.
            } else if (onUpdateItem && canonicalCode) {
                // Fallback for backward compatibility
                (onUpdateItem as any)('__syncComposition__', {
                    code: canonicalCode,
                    description: data.description || currentItem.description,
                    unit: data.unit || currentItem.unit,
                    unitCost: finalCost,
                    compositionTotalPrice: data.totalPrice,
                    sourceName: 'PROPRIA'
                });

                // Only use triggerUpdateItem as fallback when onCompositionSaved is not available
                if (!drill.isInDrill) {
                    triggerUpdateItem({
                        code: canonicalCode,
                        unitCost: data.totalPrice,
                        compositionTotalPrice: data.totalPrice,
                        sourceName: `PROPRIA`,
                        priceAudit: {
                            ...currentItem.priceAudit,
                            matchedSourceName: `PROPRIA`
                        }
                    } as any);
                } else {
                    const rootSnapshot = drillStack[0]?.snapshot?.data;
                    if (rootSnapshot && rootSnapshot.totalPrice !== undefined && onUpdateItem) {
                        const rootDivValue = drillStack[0]?.snapshot?.refDivisorValue;
                        const rootDiv = rootDivValue ? (parseFloat(rootDivValue.replace(',', '.')) || 1) : 1;
                        const rootCost = rootDiv > 0 
                            ? applyPrecision(rootSnapshot.totalPrice / rootDiv, { precision: engineeringConfig?.precision }) 
                            : rootSnapshot.totalPrice;
                        onUpdateItem(currentItem.id, { unitCost: rootCost, compositionTotalPrice: rootSnapshot.totalPrice } as any);
                    }
                }
            }
            // G14: Show warnings to user if items were skipped during save
            const warningText = putRes.warnings?.length 
                ? `\n\n⚠️ ${putRes.warnings.length} item(ns) não puderam ser salvos:\n${putRes.warnings.map((w: string) => `• ${w}`).join('\n')}`
                : '';
            alert(`Composição salva com sucesso na base PRÓPRIA!${officialRef ? ` (referência: ${officialRef.databaseName})` : ''}${warningText}`);
            if (putRes.warnings?.length) {
                console.warn('[CompositionEditor] Save warnings:', putRes.warnings);
            }
        } catch (e: any) {
            alert(e.message || 'Erro de rede ao salvar');
        } finally {
            setIsSavingToBase(false);
        }
    };

    // ── Clear Composition (reset to empty for re-extraction) ──
    const handleClearComposition = async () => {
        if (!data || !data.id || !currentItem) return;
        // Only allow clearing PROPRIA compositions
        if (data.database?.name !== 'PROPRIA' && data.database?.type !== 'PROPRIA') {
            alert('Apenas composições PRÓPRIAS podem ser limpas. Composições oficiais são somente leitura.');
            return;
        }
        
        const itemCount = data.items?.length || 0;
        const hasMetadata = Object.keys(groupNotes || {}).length > 0 ||
                            Object.keys(customGroupLabels || {}).length > 0 ||
                            (groupOrder || []).length > 0 ||
                            refDivisorLabel !== '' ||
                            refDivisorValue !== '';

        if (itemCount === 0 && !hasMetadata) {
            // Force reset of local states even if empty
            setGroupNotes({});
            setCustomGroupLabels({});
            setGroupOrder([]);
            setRefDivisorLabel('');
            setRefDivisorValue('');
            return;
        }

        const confirmMessage = itemCount > 0
            ? `Tem certeza que deseja limpar todos os ${itemCount} itens e configurações personalizadas desta composição?\n\nA composição ficará vazia.\n\nEsta ação não pode ser desfeita.`
            : `Tem certeza que deseja limpar as configurações e grupos personalizados desta composição vazia?\n\nEsta ação não pode ser desfeita.`;

        if (!confirm(confirmMessage)) return;

        try {
            // Only call backend if the composition has a real DB id (not synthetic)
            if (!data.id.startsWith('synthetic-')) {
                const deleteParams = new URLSearchParams();
                if (proposalId) deleteParams.append('proposalId', proposalId);
                const res = await fetch(`/api/engineering/compositions/${data.id}/items?${deleteParams.toString()}`, {
                    method: 'DELETE',
                    headers: hdrs(),
                });
                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    throw new Error(err.error || 'Erro ao limpar composição');
                }
                const clearRes = await res.json();
                if (clearRes.id) {
                    setData((prev: any) => prev ? { ...prev, id: clearRes.id } : prev);
                }
            }

            // Reset local state to empty composition
            setData((prev: any) => prev ? {
                ...prev,
                items: [],
                groups: { MATERIAL: [], MAO_DE_OBRA: [], EQUIPAMENTO: [], SERVICO: [], AUXILIAR: [] },
                totalPrice: 0,
                totalDirect: 0,
                hasAnalyticalItems: true, // Keep as analytical so the empty state shows
            } : prev);
            setHasChanges(false);
            setGroupNotes({});
            setCustomGroupLabels({});
            setGroupOrder([]);
            setRefDivisorLabel('');
            setRefDivisorValue('');

            // CASCADE: update planilha item unitCost to 0
            triggerUpdateItem({ unitCost: 0 });
        } catch (e: any) {
            alert(e.message || 'Erro ao limpar composição');
        }
    };

    const handleCreateComposition = async () => {
        if (!currentItem) return;
        setLoading(true);
        setError('');
        try {
            // When in drill-down, use the drillStack's code/description (casca), not currentItem (parent)
            const drillLevel = drill.currentLevel;
            const compCode = drillLevel?.code || currentItem.code;
            const compDesc = drillLevel?.description || currentItem.description;
            
            // SEC-02 FIX: Backend extracts tenantId from req.user (auth middleware)
            const postParams = new URLSearchParams();
            if (proposalId) postParams.append('proposalId', proposalId);
            const res = await fetch(`/api/engineering/compositions?${postParams.toString()}`, {
                method: 'POST',
                headers: hdrs(),
                body: JSON.stringify({
                    code: compCode,
                    description: compDesc,
                    unit: currentItem.unit,
                })
            });
            if (!res.ok) throw new Error('Erro ao criar composição');
            await loadComposition(compCode); // Reloads the newly created empty composition
        } catch (e: any) {
            alert(e.message || 'Erro ao criar composição própria');
            setLoading(false);
        }
    };

    // ── Phase 4: Free Mode Handlers ──
    const handleAddFreeItem = () => {
        if (!data) return;
        
        const typeKey = freeItemData.type as 'MATERIAL'|'MAO_DE_OBRA'|'EQUIPAMENTO'|'SERVICO'|'AUXILIAR'|'OBSERVACAO';
        const isAux = typeKey === 'AUXILIAR';
        const isObs = typeKey === 'OBSERVACAO';
        
        const priceNum = isObs ? 0 : (evaluateMath(freeItemData.price) || 0);
        const coefNum = isObs ? 0 : (evaluateMath(freeItemData.coefficient) || 1);
        // GAP 1: Detect expression in coefficient field
        const rawCoefExpr = freeItemData.coefficient.trim();
        const hasExpr = !isObs && /[*\/+\-]/.test(rawCoefExpr) && rawCoefExpr !== String(coefNum);
        
        const finalCoef = isObs ? 0 : (hasRateio ? coefNum * rateioFactor : coefNum);
        const newItem = {
            id: `temp-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
            coefficient: finalCoef,
            coefficientExpression: hasExpr ? rawCoefExpr : undefined,
            price: isObs ? 0 : applyPrecision(finalCoef * priceNum, { precision: engineeringConfig?.precision }),
            item: !isAux ? {
                id: `new-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
                code: isObs ? 'OBS' : 'LIVRE',
                description: freeItemData.description || 'Novo Insumo',
                unit: isObs ? '' : freeItemData.unit,
                type: typeKey,
                price: priceNum,
                isNew: true,
                isObservation: isObs
            } : undefined,
            auxiliaryComposition: isAux ? {
                id: `new-aux-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
                code: 'LIVRE',
                description: freeItemData.description || 'Nova Composição Auxiliar',
                unit: freeItemData.unit,
                totalPrice: priceNum,
                isNew: true
            } : undefined
        };

        const targetGroup = freeItemTargetGroup || getLastTargetGroup() || typeKey;
        const updated = { ...data, groups: { ...data.groups } };
        if (!updated.groups[targetGroup]) updated.groups[targetGroup] = [];
        updated.groups[targetGroup] = [...updated.groups[targetGroup], newItem];

        updated.totalPrice = sumCompositionGroups(updated.groups, engineeringConfig?.precision);
        updated.totalDirect = updated.totalPrice;

        setData(updated);
        setHasChanges(true);
        triggerUpdateItem({ unitCost: updated.totalPrice });
        
        setShowFreeItemModal(false);
        setFreeItemTargetGroup(null);
        setFreeItemData({ description: '', unit: 'UN', coefficient: '1', price: '0', type: 'MATERIAL' });
    };

    // ── Etapa/Observation inline edit commit ──
    const commitEtapaEdit = useCallback(() => {
        if (!editingEtapaId || !data) { setEditingEtapaId(null); return; }
        const newText = editingEtapaText.trim();
        if (!newText) { setEditingEtapaId(null); return; }

        const updated = { ...data, groups: { ...data.groups } };
        for (const groupKey of Object.keys(updated.groups)) {
            updated.groups[groupKey] = updated.groups[groupKey].map((ci: any) => {
                if (ci.id !== editingEtapaId) return ci;
                const newItem = { ...(ci.item || {}), description: newText };
                return { ...ci, item: newItem };
            });
        }
        setData(updated);
        setHasChanges(true);
        setEditingEtapaId(null);
    }, [editingEtapaId, editingEtapaText, data]);

    const handleApplyFactor = () => {
        if (!data) return;
        const factor = evaluateMath(factorData.value);
        if (isNaN(factor) || factor < 0) return;

        const updated = { ...data, groups: { ...data.groups } };
        for (const k of Object.keys(updated.groups)) {
            if (factorData.target !== 'ALL' && k !== factorData.target) continue;
            
            updated.groups[k] = updated.groups[k].map((ci: any) => {
                if (ci.item?.isObservation) return ci; // skip observations
                const newCoef = (ci.coefficient || 1) * factor;
                const unitPrice = getLineUnitPrice(ci);
                return {
                    ...ci,
                    coefficient: newCoef,
                    price: applyPrecision(newCoef * unitPrice, { precision: engineeringConfig?.precision })
                };
            });
        }

        updated.totalPrice = sumCompositionGroups(updated.groups, engineeringConfig?.precision);
        updated.totalDirect = updated.totalPrice;

        setData(updated);
        setHasChanges(true);
        triggerUpdateItem({ unitCost: updated.totalPrice });
        setShowFactorModal(false);
    };

    const handleApplyDiscount = () => {
        if (!data) return;
        const discountPercent = parseFloat(discountData.value);
        if (isNaN(discountPercent) || discountPercent < 0 || discountPercent > 100) return;
        
        const multiplier = 1 - (discountPercent / 100);

        const updated = { ...data, groups: { ...data.groups } };
        for (const k of Object.keys(updated.groups)) {
            if (discountData.target !== 'ALL' && k !== discountData.target) continue;
            
            updated.groups[k] = updated.groups[k].map((ci: any) => {
                const oldUnitPrice = getLineUnitPrice(ci);
                const newUnitPrice = oldUnitPrice * multiplier;
                
                const newItemObj = ci.item ? { ...ci.item, price: newUnitPrice } : undefined;
                const newAuxObj = ci.auxiliaryComposition ? { ...ci.auxiliaryComposition, totalPrice: newUnitPrice } : undefined;
                
                return {
                    ...ci,
                    item: newItemObj,
                    auxiliaryComposition: newAuxObj,
                    price: applyPrecision((ci.coefficient || 1) * newUnitPrice, { precision: engineeringConfig?.precision })
                };
            });
        }

        updated.totalPrice = sumCompositionGroups(updated.groups, engineeringConfig?.precision);
        updated.totalDirect = updated.totalPrice;

        setData(updated);
        setHasChanges(true);
        triggerUpdateItem({ unitCost: updated.totalPrice });
        setShowDiscountModal(false);
    };

    const handleApplyRateio = () => {
        if (!data) return;
        const prazoNum = evaluateMath(rateioData.prazo);
        const fracaoNum = evaluateMath(rateioData.fracao);
        if (isNaN(prazoNum) || isNaN(fracaoNum) || fracaoNum === 0) return;
        
        const factor = prazoNum / fracaoNum;

        const updated = { ...data, groups: { ...data.groups }, rateio: { prazo: prazoNum, fracao: fracaoNum } };
        
        // Ensure OBSERVACAO group exists
        if (!updated.groups['OBSERVACAO']) updated.groups['OBSERVACAO'] = [];

        // Apply factor to all non-observation items
        for (const k of Object.keys(updated.groups)) {
            if (k === 'OBSERVACAO') continue;
            
            updated.groups[k] = updated.groups[k].map((ci: any) => {
                if (ci.item?.isObservation) return ci;
                const newCoef = (ci.coefficient || 1) * factor;
                const unitPrice = getLineUnitPrice(ci);
                return {
                    ...ci,
                    coefficient: newCoef,
                    price: applyPrecision(newCoef * unitPrice, { precision: engineeringConfig?.precision })
                };
            });
        }

        // Inject Observation explaining the conversion
        updated.groups['OBSERVACAO'].push({
            id: `temp-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
            coefficient: 0,
            price: 0,
            item: {
                id: `new-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
                code: 'OBS',
                description: `Rateio aplicado: Prazo = ${prazoNum} / Fração = ${fracaoNum}. Todos os coeficientes originais foram multiplicados por ${factor.toFixed(5)} para refletir o custo unitário da Fração.`,
                unit: '',
                type: 'OBSERVACAO',
                price: 0,
                isNew: true,
                isObservation: true
            }
        });

        updated.totalPrice = sumCompositionGroups(updated.groups, engineeringConfig?.precision);
        updated.totalDirect = updated.totalPrice;

        setData(updated);
        setHasChanges(true);
        triggerUpdateItem({ unitCost: updated.totalPrice });
        setShowRateioModal(false);
    };

    // Computed total from analytical lines. The Hub composition is the source of truth;
    // edital extraction remains only as comparison/audit evidence.
    const compositionTotal = data ? sumCompositionGroups(data.groups, engineeringConfig?.precision) : 0;
    const compositionItemsCount = data ? Object.values(data.groups || {}).reduce((acc: number, group: any) => acc + (Array.isArray(group) ? group.length : 0), 0) : 0;

    const rateio = data?.rateio;
    const hasRateio = rateio && typeof rateio === 'object' && Number(rateio.prazo) > 0 && Number(rateio.fracao) > 0;
    const rateioFactor = hasRateio ? (Number(rateio.prazo) / Number(rateio.fracao)) : 1;

    // FIX PRICE-SYNC-02: Auto-sincroniza unitCost do orçamento com compositionTotal quando
    // a diferença é causada apenas por arredondamento (< 0.05%).
    // Isso evita que o alerta vermelho fique permanentemente visível para centavos.
    useEffect(() => {
        if (!data || !currentItem || drill.isInDrill) return;
        const ct = sumCompositionGroups(data.groups, engineeringConfig?.precision);
        if (ct <= 0) return;
        const budgetCost = asNumber(currentItem.unitCost);
        if (budgetCost <= 0) return;
        const delta = Math.abs(budgetCost - ct);
        const deltaPct = (delta / ct) * 100;
        // Só auto-sincroniza se a diferença for de arredondamento (< 0.05%)
        if (delta > 0.005 && deltaPct < 0.05) {
            triggerUpdateItem({ unitCost: ct });
        }
    }, [data?.totalPrice]); // eslint-disable-line react-hooks/exhaustive-deps

    if (!currentItem) return null;

    const editalUnitCost = asNumber(currentItem.officialUnitCost || currentItem.unitCost);
    const priceDelta = editalUnitCost - compositionTotal;
    const priceDeltaPct = compositionTotal > 0 ? (priceDelta / compositionTotal) * 100 : 0;
    // FIX PRICE-SYNC-01: Tolerância percentual para evitar falsos positivos de arredondamento.
    // Diferenças < 0.05% são inerentes a arredondamento intermediário e não constituem divergência real.
    const hasPriceDivergence = compositionTotal > 0 && Math.abs(priceDeltaPct) > 0.05;
    const databaseReference = data?.database
        ? [
            data.database.name,
            data.database.uf,
            data.database.referenceMonth && data.database.referenceYear
                ? `${String(data.database.referenceMonth).padStart(2, '0')}/${data.database.referenceYear}`
                : data.database.version,
            typeof data.database.payrollExemption === 'boolean'
                ? (data.database.payrollExemption ? 'Desonerado' : 'Onerado')
                : '',
        ].filter(Boolean).join(' · ')
        : '';

    const editor = (
        <div style={{ position: 'fixed', inset: 0, zIndex: 99999, display: 'flex', background: 'var(--color-bg-base)' }}>

            {/* Sidebar — Item Navigator */}
            <div style={{
                width: 260, borderRight: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column',
                background: 'var(--color-bg-surface)', overflowY: 'auto',
            }}>
                <div style={{
                    padding: '16px', borderBottom: '1px solid var(--color-border)',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Layers size={16} color="var(--color-primary)" />
                        <span style={{ fontSize: '0.8rem', fontWeight: 700 }}>Composições</span>
                    </div>
                    <span style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)' }}>{items.length} itens</span>
                </div>

                {items.map((item, idx) => {
                    const isGrp = isGrouperType(item.type);
                    return (
                    <button key={item.id} onClick={() => setCurrentIndex(idx)}
                        style={{
                            display: 'block', width: '100%', padding: isGrp ? '8px 16px' : '10px 16px', border: 'none',
                            borderBottom: '1px solid var(--color-border)', cursor: 'pointer', textAlign: 'left',
                            background: idx === currentIndex
                                ? (isGrp ? 'rgba(217,119,6,0.08)' : 'var(--color-primary-light)')
                                : (isGrp ? 'rgba(217,119,6,0.03)' : 'transparent'),
                            borderLeft: idx === currentIndex
                                ? `3px solid ${isGrp ? '#d97706' : 'var(--color-primary)'}`
                                : '3px solid transparent',
                            transition: 'all 0.1s',
                        }}>
                        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: isGrp ? '#d97706' : (idx === currentIndex ? 'var(--color-primary)' : 'var(--color-text-tertiary)') }}>
                            {isGrp ? <>{item.type === 'ETAPA' ? <FolderOpen size={12} style={{display:'inline',verticalAlign:-2,marginRight:3}} /> : <Folder size={12} style={{display:'inline',verticalAlign:-2,marginRight:3}} />}{item.itemNumber}</> : `${item.itemNumber} · ${item.code || 'N/A'} · ${item.sourceName || ''}`}
                        </div>
                        <div style={{
                            fontSize: '0.72rem', lineHeight: 1.3, marginTop: 2,
                            color: idx === currentIndex ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            fontWeight: isGrp ? 700 : (idx === currentIndex ? 600 : 400),
                        }}>
                            {item.description}
                        </div>
                        {!isGrp && (
                        <div style={{ fontSize: '0.65rem', color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                            {fmt(item.unitCost)} × {item.quantity} {item.unit}
                        </div>
                        )}
                    </button>
                    );
                })}
            </div>

            {/* Main Content */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

                {/* Top Bar */}
                <div style={{
                    padding: '12px 24px', borderBottom: '1px solid var(--color-border)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    background: isGrouperType(currentItem.type)
                        ? 'linear-gradient(135deg, rgba(217,119,6,0.06), rgba(234,88,12,0.04))'
                        : 'linear-gradient(135deg, rgba(37,99,235,0.03), rgba(124,58,237,0.03))',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <button onClick={() => navigate(-1)} disabled={!hasPrev}
                            style={{
                                padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)',
                                cursor: hasPrev ? 'pointer' : 'not-allowed', background: 'var(--color-bg-surface)',
                                opacity: hasPrev ? 1 : 0.4, display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem',
                            }}>
                            <ChevronLeft size={14} /> Anterior
                        </button>
                        <span style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                            {currentIndex + 1} de {items.length}
                        </span>
                        <button onClick={() => navigate(1)} disabled={!hasNext}
                            style={{
                                padding: '6px 10px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)',
                                cursor: hasNext ? 'pointer' : 'not-allowed', background: 'var(--color-bg-surface)',
                                opacity: hasNext ? 1 : 0.4, display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem',
                            }}>
                            Próximo <ChevronRight size={14} />
                        </button>
                    </div>

                    <div style={{ textAlign: 'center', flex: 1 }}>
                        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: isGrouperType(currentItem.type) ? '#d97706' : 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                            {isGrouperType(currentItem.type)
                                ? <>{currentItem.type === 'ETAPA' ? <FolderOpen size={13} style={{display:'inline',verticalAlign:-2,marginRight:3}} /> : <Folder size={13} style={{display:'inline',verticalAlign:-2,marginRight:3}} />}{currentItem.type === 'ETAPA' ? 'ETAPA' : 'SUBETAPA'} — Agrupador</>
                                : 'CPU — Composição de Preços Unitários'}
                        </div>
                        {(() => {
                            const isRoot = !drill.isInDrill;
                            const currentCompDesc = drill.isInDrill ? drill.currentLevel!.description : (data?.description || currentItem.description);
                            const isPropriaPred = isPropria(data?.database?.name) || data?.database?.type === 'PROPRIA';
                            const canRenameHeader = isRoot || isPropriaPred;
                            
                            return isEditingTitle ? (
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 4 }}>
                                    <input 
                                        value={tempTitle} 
                                        onChange={e => setTempTitle(e.target.value)} 
                                        onKeyDown={e => {
                                            if (e.key === 'Enter') handleSaveTitle();
                                            if (e.key === 'Escape') setIsEditingTitle(false);
                                        }}
                                        onBlur={handleSaveTitle}
                                        autoFocus
                                        style={{ 
                                            fontSize: '0.95rem', fontWeight: 700, padding: '4px 8px', 
                                            border: '1px solid var(--color-primary)', borderRadius: 4, 
                                            width: '60%', textAlign: 'center', background: 'var(--color-bg-base)',
                                            color: 'var(--color-text-primary)'
                                        }} 
                                    />
                                </div>
                            ) : (
                                <h3 
                                    onClick={() => {
                                        if (canRenameHeader) {
                                            setIsEditingTitle(true);
                                            setTempTitle(currentCompDesc);
                                        }
                                    }}
                                    style={{ 
                                        margin: '4px 0 0', fontSize: '1rem', fontWeight: 700,
                                        cursor: canRenameHeader ? 'pointer' : 'default',
                                        display: 'inline-flex', alignItems: 'center', gap: 6,
                                        justifyContent: 'center'
                                    }}
                                    title={canRenameHeader ? "Clique para renomear esta composição" : undefined}
                                >
                                    {currentCompDesc}
                                    {canRenameHeader && <Pencil size={11} style={{ opacity: 0.5 }} />}
                                </h3>
                            );
                        })()}
                        {!isGrouperType(currentItem.type) && (
                            <span style={{ fontSize: '0.78rem', color: 'var(--color-text-tertiary)' }}>
                                Código: <strong>{drill.isInDrill ? drill.currentLevel!.code : currentItem.code}</strong> · {drill.isInDrill ? displaySourceName(data?.database?.name || '') : displaySourceName(currentItem.sourceName)}
                                {/* FIX SYNC-04: Show real composition origin when loaded */}
                                {data?.database?.name && data.database.name !== currentItem.sourceName && (
                                    <span style={{
                                        marginLeft: 6, padding: '1px 6px', borderRadius: 4, fontSize: '0.65rem', fontWeight: 700,
                                        background: isPropria(data.database.name) 
                                            ? (data._officialRef ? 'rgba(124,58,237,0.08)' : 'rgba(16,185,129,0.08)')
                                            : 'rgba(37,99,235,0.08)',
                                        color: isPropria(data.database.name)
                                            ? (data._officialRef ? '#7c3aed' : '#059669')
                                            : '#2563eb',
                                    }}>
                                        {isPropria(data.database.name) && data._officialRef
                                            ? `editada de ${data._officialRef.databaseName}`
                                            : `via ${displaySourceName(data.database.name)}`}
                                    </span>
                                )}
                                {hasChanges && <span style={{ marginLeft: 8, color: '#d97706', fontWeight: 700 }}>● Modificado</span>}
                            </span>
                        )}
                        {/* Drill-down breadcrumb */}
                        {drill.isInDrill && (
                            <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center', fontSize: '0.72rem', color: 'var(--color-text-tertiary)' }}>
                                <button onClick={() => {
                                    // G7-FIX: Use hook API for popToRoot
                                    const rootSnapshot = drill.popToRoot();
                                    if (rootSnapshot) {
                                        restoreFromSnapshot(rootSnapshot);
                                    } else {
                                        loadComposition(currentItem.code);
                                    }
                                }}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-primary)', fontWeight: 600, padding: 0 }}>
                                    {currentItem.code}
                                </button>
                                {drillStack.map((level, i) => (
                                    <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                        <ChevronRight size={12} />
                                        {i < drillStack.length - 1 ? (
                                            <button onClick={() => {
                                                // G7-FIX: Use hook API for navigateTo
                                                const snapshot = drill.navigateTo(i);
                                                if (snapshot) {
                                                    restoreFromSnapshot(snapshot);
                                                } else {
                                                    loadComposition(drillStack[i].code);
                                                }
                                            }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-primary)', fontWeight: 600, padding: 0 }}>
                                                {level.code}
                                            </button>
                                        ) : (
                                            <strong style={{ color: 'var(--color-text-primary)' }}>{level.code}</strong>
                                        )}
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {data && !isGrouperType(currentItem.type) && (
                            <>
                                <button onClick={() => { setSearchType('composition'); setShowSearch(true); }} title="Adicionar Composição Auxiliar"
                                    style={{ padding: '6px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-primary)', background: 'var(--color-primary-light)', color: 'var(--color-primary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.72rem', fontWeight: 600 }}>
                                    <Layers size={13} /> Adicionar Comp. Auxiliar
                                </button>
                                <button onClick={() => { setSearchType('item'); setShowSearch(true); }} title="Adicionar Insumo ou Serviço a esta composição"
                                    style={{ padding: '6px 12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-primary)', background: 'var(--color-primary-light)', color: 'var(--color-primary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.72rem', fontWeight: 600 }}>
                                    <Package size={13} /> Adicionar Insumo
                                </button>
                            </>
                        )}
                        {data && !isGrouperType(currentItem.type) && hasChanges && (
                            <button onClick={saveToBase} disabled={isSavingToBase} title={isPropria(data.database?.name) ? "Atualizar a base de dados com as modificações desta composição" : "Salvar alterações como uma nova Composição Própria"}
                                style={{ padding: '6px 12px', borderRadius: 'var(--radius-sm)', border: 'none', background: 'var(--color-primary)', color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.72rem', fontWeight: 600 }}>
                                {isSavingToBase ? <Loader2 size={13} className="spin" /> : <Save size={13} />} 
                                {isPropria(data.database?.name) ? 'Salvar na Base' : 'Salvar como Própria'}
                            </button>
                        )}
                        {data && !isGrouperType(currentItem.type) && (
                            <>
                                <button onClick={() => exportCompositionExcel(currentItem.code, currentItem.description, { ...data, customGroupLabels, groupOrder, groupNotes }, engineeringConfig)}
                                    title="Exportar Excel" style={{ padding: 6, borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', background: 'var(--color-bg-surface)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.72rem' }}>
                                    <Download size={13} /> Excel
                                </button>
                                <button onClick={() => exportCompositionPdf(currentItem.code, currentItem.description, { ...data, customGroupLabels, groupOrder, groupNotes }, engineeringConfig)}
                                    title="Exportar PDF" style={{ padding: 6, borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', background: 'var(--color-bg-surface)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.72rem' }}>
                                    <FileText size={13} /> PDF
                                </button>
                            </>
                        )}
                        <button onClick={handleSafeClose} title="Fechar (Esc)"
                            style={{ padding: 8, borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', background: 'var(--color-bg-surface)', cursor: 'pointer' }}>
                            <X size={18} />
                        </button>
                    </div>
                </div>
                {/* Cascade indicator — only for non-groupers */}
                {!isGrouperType(currentItem.type) && hasChanges && (
                    <div style={{
                        padding: '6px 24px', background: 'rgba(34,197,94,0.06)', borderBottom: '1px solid rgba(34,197,94,0.15)',
                        display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.72rem', color: '#16a34a',
                    }}>
                        <ArrowDownUp size={13} />
                        <strong>Cascade ativo</strong> — Alterações refletidas na Planilha e Hub de Insumos em tempo real.
                    </div>
                )}

                {/* Toolbar Módulo Livre — only for non-groupers */}
                {!isGrouperType(currentItem.type) && data && !error && (
                    <div style={{
                        padding: '8px 24px', borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg-surface)',
                        display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap'
                    }}>
                        <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--color-text-tertiary)', marginRight: 4 }}>MÓDULO LIVRE:</span>
                        
                        {/* AI Extraction button — available even when composition already has items */}
                        <button onClick={() => setShowAiDropzone(prev => !prev)} title="Extrair insumos via IA: Cole um print (Ctrl+V) ou arraste uma imagem"
                            style={{ padding: '5px 10px', borderRadius: 4, border: showAiDropzone ? '1px solid var(--color-ai, #8b5cf6)' : '1px solid var(--color-ai, #8b5cf6)', background: showAiDropzone ? 'rgba(139,92,246,0.1)' : 'transparent', color: 'var(--color-ai, #8b5cf6)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.72rem', fontWeight: 700 }}>
                            {isExtractingAi ? <Loader2 size={13} className="spin" /> : <Cpu size={13} />} {isExtractingAi ? 'Extraindo...' : 'Extração IA'}
                        </button>

                        <button onClick={() => setShowFreeItemModal(true)} title="Adicionar um insumo ou serviço avulso sem buscar na base"
                            style={{ padding: '5px 10px', borderRadius: 4, border: '1px dashed var(--color-border)', background: 'var(--color-bg-base)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.72rem', fontWeight: 600 }}>
                            <PlusCircle size={13} color="var(--color-text-secondary)" /> Insumo Livre
                        </button>

                        {/* Insert Group — creates a new custom group/section */}
                        <button onClick={() => { setNewGroupName(''); setShowNewGroupModal(true); }} title="Inserir um novo grupo/seção na composição (ex: Transporte, Encargos, etc.)"
                            style={{ padding: '5px 10px', borderRadius: 4, border: '1px solid var(--color-text-tertiary)', background: 'var(--color-bg-base)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.72rem', fontWeight: 600 }}>
                            <ListTree size={13} color="var(--color-text-secondary)" /> Inserir Grupo
                        </button>

                        <button onClick={() => setShowFactorModal(true)} title="Aplicar fator em lote (ex: perda material)"
                            style={{ padding: '5px 10px', borderRadius: 4, border: '1px solid var(--color-border)', background: 'var(--color-bg-base)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.72rem', fontWeight: 600 }}>
                            <Calculator size={13} color="var(--color-text-secondary)" /> Fator / Perda
                        </button>

                        <button onClick={() => setShowDiscountModal(true)} title="Aplicar desconto percentual em lote"
                            style={{ padding: '5px 10px', borderRadius: 4, border: '1px solid var(--color-border)', background: 'var(--color-bg-base)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.72rem', fontWeight: 600 }}>
                            <Percent size={13} color="var(--color-text-secondary)" /> Desconto
                        </button>
                        
                        <button onClick={() => setShowRateioModal(true)} title="Converter custo para fração % (Ex: Administração Local)"
                            style={{ padding: '5px 10px', borderRadius: 4, border: '1px solid var(--color-border)', background: 'var(--color-bg-base)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.72rem', fontWeight: 600 }}>
                            <Divide size={13} color="var(--color-text-secondary)" /> Rateio / Fração %
                        </button>
                        
                        <div style={{ flex: 1 }}></div>

                        {/* Clear composition — available for all PROPRIA compositions */}
                        {(isPropria(data?.database?.name) || data?.database?.type === 'PROPRIA') && (
                            <button onClick={handleClearComposition}
                                title="Limpar todos os itens e grupos customizados desta composição"
                                style={{ padding: '5px 10px', borderRadius: 4, border: '1px solid var(--color-danger)', background: 'transparent', color: 'var(--color-danger)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.72rem', fontWeight: 600, opacity: 0.7 }}>
                                <Trash2 size={13} /> Limpar Composição
                            </button>
                        )}

                        <button onClick={() => { setFreeItemData(prev => ({ ...prev, description: 'Verba / Custo Indireto', unit: 'VB', type: 'SERVICO' })); setShowFreeItemModal(true); }} title="Adicionar linha de verba / custo indireto"
                            style={{ padding: '5px 10px', borderRadius: 4, border: '1px solid var(--color-primary)', background: 'transparent', color: 'var(--color-primary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.72rem', fontWeight: 600 }}>
                            <Wand2 size={13} /> Inserir Verba
                        </button>
                    </div>
                )}

                {/* AI Dropzone — collapsible, shown when user clicks "Extração IA" in toolbar */}
                {!isGrouperType(currentItem.type) && data && !error && (data.items?.length > 0 || Object.keys(customGroupLabels).length > 0) && showAiDropzone && (
                    <div style={{ padding: '12px 24px', borderBottom: '1px solid var(--color-border)', background: 'rgba(139,92,246,0.03)' }}>
                        <SmartCpuDropzone onExtract={handleExtractAi} isExtracting={isExtractingAi} />
                        <div style={{ textAlign: 'center', marginTop: 8, fontSize: '0.7rem', color: 'var(--color-text-tertiary)' }}>
                            ⚠️ A extração IA substituirá o conteúdo atual desta composição.
                        </div>
                    </div>
                )}

                {/* ── ETAPA/SUBETAPA special view ── */}
                {isGrouperType(currentItem.type) && (
                    <div style={{ flex: 1, overflowY: 'auto', padding: '40px 24px', maxWidth: 600, margin: '0 auto' }}>
                        <div style={{ textAlign: 'center', marginBottom: 32 }}>
                            <div style={{ width: 56, height: 56, borderRadius: 'var(--radius-lg)', background: 'rgba(217,119,6,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 12px' }}>
                                <Layers size={28} color="#d97706" />
                            </div>
                            <div style={{ fontSize: '0.82rem', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                                {currentItem.type === 'ETAPA' ? 'Etapas' : 'Subetapas'} são agrupadores hierárquicos.
                                <br />Não possuem composição de preços — apenas organizam itens no orçamento.
                            </div>
                        </div>

                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                            {/* Description editor */}
                            <div style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: 16 }}>
                                <label style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>
                                    <Pencil size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} /> Descrição da {currentItem.type === 'ETAPA' ? 'Etapa' : 'Subetapa'}
                                </label>
                                <input type="text" className="form-input" value={grouperDesc}
                                    onChange={e => setGrouperDesc(e.target.value)}
                                    onBlur={() => {
                                        if (grouperDesc.trim() && grouperDesc !== currentItem.description) {
                                            onUpdateItem(currentItem.id, { description: grouperDesc.trim() } as any);
                                        }
                                    }}
                                    onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                                    style={{ width: '100%', fontSize: '0.9rem', padding: '10px 14px', fontWeight: 600 }} />
                            </div>

                            {/* Multiplication factor */}
                            <div style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: 16 }}>
                                <label style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>
                                    <Calculator size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} /> Fator de Multiplicação
                                </label>
                                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', marginBottom: 8, lineHeight: 1.4 }}>
                                    Se definido como &gt; 1, todas as quantidades dos itens filhos (composições e insumos) desta {currentItem.type === 'ETAPA' ? 'etapa' : 'subetapa'} serão multiplicadas por este fator.
                                </div>
                                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                    <input type="text" className="form-input" value={grouperFactor}
                                        onChange={e => setGrouperFactor(e.target.value)}
                                        style={{ width: 100, fontSize: '0.9rem', padding: '8px 14px', textAlign: 'center', fontWeight: 700 }} />
                                    <button className="btn btn-primary"
                                        disabled={grouperFactorSaved}
                                        onClick={() => {
                                            const factor = parseFloat(grouperFactor.replace(',', '.')) || 1;
                                            if (factor <= 0) return;
                                            onUpdateItem(currentItem.id, { multiplicationFactor: factor } as any);
                                            setGrouperFactorSaved(true);
                                            setTimeout(() => setGrouperFactorSaved(false), 2000);
                                        }}
                                        style={{ padding: '8px 16px', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                                        {grouperFactorSaved
                                            ? <><Check size={14} /> Aplicado!</>
                                            : <><Calculator size={14} /> Aplicar Fator</>}
                                    </button>
                                </div>
                            </div>

                            {/* Conversion */}
                            <div style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', padding: 16 }}>
                                <label style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: 6 }}>
                                    <ArrowRightLeft size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} /> Converter Tipo de Agrupador
                                </label>
                                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', marginBottom: 12, lineHeight: 1.4 }}>
                                    {currentItem.type === 'ETAPA' 
                                        ? 'Esta é uma Etapa principal. Ao converter para Subetapa, ela será aninhada sob a Etapa anterior na hierarquia.'
                                        : 'Esta é uma Subetapa. Ao converter para Etapa, ela se tornará uma divisão principal de primeiro nível.'}
                                </div>
                                <button className="btn btn-outline"
                                    onClick={() => {
                                        const newType = currentItem.type === 'ETAPA' ? 'SUBETAPA' : 'ETAPA';
                                        onUpdateItem(currentItem.id, { type: newType } as any);
                                    }}
                                    style={{ padding: '8px 16px', fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: 6, width: '100%', justifyContent: 'center' }}>
                                    <RefreshCw size={14} />
                                    {currentItem.type === 'ETAPA' ? 'Converter em Subetapa' : 'Converter em Etapa'}
                                </button>
                            </div>
                        </div>

                        <div style={{ marginTop: 24, textAlign: 'center', fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>
                            Use ◀ ▶ ou a sidebar para navegar até composições e insumos.
                        </div>
                    </div>
                )}

                {/* Composition Detail — only for non-groupers */}
                {!isGrouperType(currentItem.type) && (
                <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
                    {loading && (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 80, gap: 10, color: 'var(--color-text-tertiary)' }}>
                            <Loader2 size={20} className="spin" /> Carregando composição...
                        </div>
                    )}

                    {error === 'not_found' && (
                        <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-tertiary)' }}>
                            <AlertCircle size={36} style={{ opacity: 0.3, margin: '0 auto 12px', display: 'block' }} />
                            <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--color-text-primary)' }}>Composição não encontrada nas bases de dados</div>
                            <div style={{ fontSize: '0.85rem', marginBottom: 24, maxWidth: 400, margin: '0 auto 24px' }}>
                                O código <strong>{drill.isInDrill ? drill.currentLevel!.code : currentItem.code}</strong> não foi encontrado nas bases oficiais e nem no seu banco de dados próprio.
                                {drill.isInDrill && <><br/><span style={{ color: '#7c3aed', fontWeight: 600 }}>Crie abaixo para montar esta composição auxiliar como PRÓPRIA.</span></>}
                            </div>
                            
                            <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                                <button className="btn btn-primary" onClick={handleCreateComposition} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <Layers size={15} /> Criar Composição Manualmente
                                </button>
                            </div>
                            
                            <div style={{ marginTop: 32, marginBottom: 16 }}>
                                <SmartCpuDropzone onExtract={handleExtractAi} isExtracting={isExtractingAi} />
                            </div>
                            
                            <div style={{ marginTop: 24, fontSize: '0.8rem', opacity: 0.7 }}>
                                Ou use ◀ ▶ para navegar para outra composição.
                            </div>
                        </div>
                    )}

                    {error && error !== 'not_found' && (
                        <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-tertiary)' }}>
                            <AlertCircle size={36} style={{ opacity: 0.3, margin: '0 auto 12px', display: 'block' }} />
                            <div style={{ fontWeight: 600, marginBottom: 4 }}>{error}</div>
                        </div>
                    )}

                    {data && !error && data.items?.length === 0 && Object.keys(customGroupLabels).length === 0 && (
                        <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-tertiary)' }}>
                            <AlertCircle size={36} style={{ opacity: 0.3, margin: '0 auto 12px', display: 'block' }} />
                            <div style={{ fontWeight: 600, marginBottom: 8, color: 'var(--color-text-primary)' }}>Composição Vazia</div>
                            <div style={{ fontSize: '0.9rem', marginBottom: 24, maxWidth: 450, margin: '0 auto 24px', lineHeight: 1.5 }}>
                                Esta composição ainda não possui insumos ou custos detalhados.<br/><br/>
                                <strong style={{color:'var(--color-primary)'}}>Dica Mágica:</strong> Você pode tirar um print da tabela no PDF e dar <strong>Ctrl+V</strong> em qualquer lugar desta tela. A IA extrairá tudo automaticamente!
                            </div>
                            <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                                <button className="btn btn-primary" onClick={() => { setSearchType('item'); setShowSearch(true); }} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <Layers size={15} /> Inserir Manualmente
                                </button>
                            </div>
                            
                            <div style={{ marginTop: 32, marginBottom: 16 }}>
                                <SmartCpuDropzone onExtract={handleExtractAi} isExtracting={isExtractingAi} />
                            </div>
                        </div>
                    )}

                    {data && !error && (data.items?.length > 0 || Object.keys(customGroupLabels).length > 0) && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                            {data.hasAnalyticalItems === false && (
                                <div style={{
                                    display: 'flex', alignItems: 'flex-start', gap: 10,
                                    padding: '12px 14px', borderRadius: 6,
                                    border: '1px solid rgba(217,119,6,0.25)',
                                    background: 'rgba(217,119,6,0.08)',
                                    color: '#92400e', fontSize: '0.82rem', lineHeight: 1.45,
                                }}>
                                    <AlertCircle size={18} style={{ flexShrink: 0, marginTop: 1 }} />
                                    <div>
                                        <strong>Preço sintético encontrado, mas a CPU analítica não está importada.</strong>
                                        <div style={{ marginTop: 3 }}>
                                            A linha abaixo representa o serviço/preço cadastrado na base. Importe a planilha analítica para ver os insumos detalhados.
                                        </div>
                                    </div>
                                </div>
                            )}
                            {data.sourceIsEdital && (
                                <div style={{
                                    display: 'flex', alignItems: 'flex-start', gap: 10,
                                    padding: '12px 14px', borderRadius: 6,
                                    border: '1px solid rgba(37,99,235,0.25)',
                                    background: 'rgba(37,99,235,0.06)',
                                    color: '#1e40af', fontSize: '0.82rem', lineHeight: 1.45,
                                }}>
                                    <Wand2 size={18} style={{ flexShrink: 0, marginTop: 1 }} />
                                    <div>
                                        <strong>Composição extraída do Edital pela IA.</strong>
                                        <div style={{ marginTop: 3 }}>
                                            Os insumos abaixo foram extraídos automaticamente do projeto básico/orçamento do edital. 
                                            Para usar a composição da base oficial, importe a planilha analítica SINAPI/SEINFRA.
                                        </div>
                                    </div>
                                </div>
                            )}
                            {hasPriceDivergence && !data.sourceIsEdital && data.hasAnalyticalItems !== false && (
                                <div style={{
                                    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 14,
                                    padding: '12px 14px', borderRadius: 6,
                                    border: '1px solid rgba(220,38,38,0.22)',
                                    background: 'rgba(220,38,38,0.06)',
                                    color: '#991b1b', fontSize: '0.82rem', lineHeight: 1.45,
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                                        <AlertCircle size={18} style={{ flexShrink: 0, marginTop: 1 }} />
                                        <div>
                                            <strong>Preço do orçamento diverge da composição oficial do Hub.</strong>
                                            <div style={{ marginTop: 3 }}>
                                                Orçamento base: <strong>{fmt(editalUnitCost)}</strong> · CPU Hub: <strong>{fmt(compositionTotal)}</strong>
                                                {' '}· Diferença: <strong>{fmt(priceDelta)} ({priceDeltaPct.toFixed(2)}%)</strong>.
                                            </div>
                                            <div style={{ marginTop: 3, color: '#7f1d1d' }}>
                                                Verifique data-base, UF, regime de encargos sociais e se o edital usou composição/adaptação própria.
                                                {databaseReference ? ` Base consultada: ${databaseReference}.` : ''}
                                            </div>
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            if (!currentItem) return;
                                            triggerUpdateItem({ unitCost: compositionTotal });
                                            setHasChanges(true);
                                        }}
                                        style={{
                                            flexShrink: 0, padding: '6px 10px', borderRadius: 4,
                                            border: '1px solid rgba(153,27,27,0.25)',
                                            background: 'white', color: '#991b1b',
                                            cursor: 'pointer', fontSize: '0.72rem', fontWeight: 800,
                                        }}
                                        title="Atualizar o custo sem BDI deste item na planilha usando a CPU oficial"
                                    >
                                        Aplicar CPU
                                    </button>
                                </div>
                            )}
                            {/* Render all groups: known GROUP_META + custom groups */}
                            {(() => {
                                const orderedKeys = getEffectiveGroupKeys();
                                return orderedKeys.map((groupKey, groupIdx) => {
                                const meta = GROUP_META[groupKey] || { label: groupKey, icon: Folder, color: '#6b7280' };
                                const displayLabel = customGroupLabels[groupKey] || meta.label;
                                const groupItems = data.groups?.[groupKey] || [];
                                // Show custom groups (or labeled ones) always, even if empty. Standard groups only show if they have items or during drag.
                                const isCustomGroup = !GROUP_META[groupKey] || groupKey.startsWith('CUSTOM_') || !!customGroupLabels[groupKey];
                                if (groupItems.length === 0 && !isCustomGroup) return null;
                                const Icon = meta.icon;
                                const groupTotal = groupItems.reduce((s: number, ci: any) => s + getLineSubtotal(ci, engineeringConfig?.precision), 0);
                                 const displayGroupTotal = hasRateio ? (groupTotal / rateioFactor) : groupTotal;
                                const isExpanded = expandedGroups.has(groupKey);

                                return (
                                    <React.Fragment key={groupKey}>
                                    {/* Group-level drop zone BEFORE this group */}
                                    {dragGroupKey && dragGroupKey !== groupKey && (
                                        <div
                                            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverGroupIdx(groupIdx); }}
                                            onDragLeave={() => { if (dragOverGroupIdx === groupIdx) setDragOverGroupIdx(null); }}
                                            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); handleGroupDrop(groupIdx); }}
                                            style={{
                                                height: dragOverGroupIdx === groupIdx ? 8 : 12,
                                                background: dragOverGroupIdx === groupIdx ? 'var(--color-primary)' : 'transparent',
                                                transition: 'all 0.15s',
                                                borderRadius: 4,
                                                marginBlock: 2,
                                            }}
                                        />
                                    )}
                                    <div
                                        onDragOver={(e) => {
                                            e.preventDefault();
                                            e.dataTransfer.dropEffect = 'move';
                                            if (dragGroupKey) {
                                                // Group drag: set this group as target
                                                if (dragGroupKey !== groupKey) setDragOverGroupIdx(groupIdx);
                                            } else {
                                                // Item drag
                                                setDragOverGroup(groupKey);
                                            }
                                        }}
                                        onDragEnter={(e) => { e.preventDefault(); if (!dragGroupKey) setDragOverGroup(groupKey); }}
                                        onDragLeave={(e) => {
                                            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                                                setDragOverGroup(null);
                                                setDragOverIndex(null);
                                                if (dragGroupKey && dragOverGroupIdx === groupIdx) setDragOverGroupIdx(null);
                                            }
                                        }}
                                        onDrop={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            if (dragGroupKey) {
                                                handleGroupDrop(groupIdx, true);
                                            } else {
                                                handleDrop(groupKey);
                                            }
                                        }}
                                        style={{
                                            border: `1px solid ${
                                                dragGroupKey && dragGroupKey !== groupKey && dragOverGroupIdx === groupIdx
                                                    ? 'var(--color-primary)'
                                                    : dragOverGroup === groupKey && dragItem
                                                        ? meta.color
                                                        : (dragGroupKey === groupKey ? 'var(--color-primary)' : meta.color + '25')
                                            }`,
                                            borderRadius: 'var(--radius-lg)', overflow: 'hidden',
                                            transition: 'border-color 0.15s, box-shadow 0.15s, opacity 0.2s',
                                            boxShadow:
                                                dragGroupKey && dragGroupKey !== groupKey && dragOverGroupIdx === groupIdx
                                                    ? '0 0 0 3px rgba(37,99,235,0.25)'
                                                    : dragOverGroup === groupKey && dragItem && dragItem.sourceGroup !== groupKey
                                                        ? `0 0 0 2px ${meta.color}30`
                                                        : 'none',
                                            opacity: dragGroupKey === groupKey ? 0.4 : 1,
                                        }}>
                                        {/* Group header */}
                                        <div onClick={() => toggleGroup(groupKey)}
                                            style={{
                                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                                padding: '12px 20px', background: `${meta.color}06`, cursor: 'pointer',
                                                borderBottom: isExpanded ? `1px solid ${meta.color}15` : 'none',
                                            }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                                {/* Grip handle to drag the entire group */}
                                                <div
                                                    draggable
                                                    onDragStart={(e) => {
                                                        const targetGroupKey = groupKey;
                                                        e.stopPropagation();
                                                        e.dataTransfer.effectAllowed = 'move';
                                                        e.dataTransfer.setData('text/plain', `group:${targetGroupKey}`);
                                                        setTimeout(() => {
                                                            setDragItem(null); // Ensure item drag doesn't interfere
                                                            setDragGroupKey(targetGroupKey);
                                                        }, 0);
                                                    }}
                                                    onDragEnd={() => { setDragGroupKey(null); setDragOverGroupIdx(null); setDragItem(null); setDragOverGroup(null); setDragOverIndex(null); }}
                                                    onClick={(e) => e.stopPropagation()}
                                                    title="Arrastar para reordenar esta etapa"
                                                    style={{ cursor: 'grab', padding: '2px 0', display: 'flex', alignItems: 'center' }}
                                                >
                                                    <GripVertical size={14} style={{ color: meta.color, opacity: 0.4 }} />
                                                </div>
                                                {isExpanded ? <ChevronDown size={14} color={meta.color} /> : <ChevronRight size={14} color={meta.color} />}
                                                <Icon size={16} color={meta.color} />
                                                {/* Editable group label */}
                                                {editingGroupLabel === groupKey ? (
                                                    <input
                                                        autoFocus
                                                        type="text"
                                                        value={editingGroupLabelText}
                                                        onChange={e => setEditingGroupLabelText(e.target.value)}
                                                        onBlur={() => {
                                                            if (editingGroupLabelText.trim()) {
                                                                setCustomGroupLabels(prev => ({ ...prev, [groupKey]: editingGroupLabelText.trim() }));
                                                                setHasChanges(true);
                                                            }
                                                            setEditingGroupLabel(null);
                                                        }}
                                                        onKeyDown={e => {
                                                            if (e.key === 'Enter') {
                                                                if (editingGroupLabelText.trim()) {
                                                                    setCustomGroupLabels(prev => ({ ...prev, [groupKey]: editingGroupLabelText.trim() }));
                                                                    setHasChanges(true);
                                                                }
                                                                setEditingGroupLabel(null);
                                                            }
                                                            if (e.key === 'Escape') setEditingGroupLabel(null);
                                                        }}
                                                        onClick={e => e.stopPropagation()}
                                                        style={{
                                                            fontWeight: 700, fontSize: '0.88rem', color: meta.color,
                                                            border: `1px solid ${meta.color}`, borderRadius: 4,
                                                            padding: '2px 8px', background: 'white', outline: 'none', width: 220,
                                                        }}
                                                    />
                                                ) : (
                                                    <span style={{ fontWeight: 700, fontSize: '0.88rem', color: meta.color }}>
                                                        {displayLabel}
                                                    </span>
                                                )}
                                                {/* Edit button for group label */}
                                                {editingGroupLabel !== groupKey && (
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); setEditingGroupLabel(groupKey); setEditingGroupLabelText(displayLabel); }}
                                                        title="Renomear este grupo"
                                                        style={{
                                                            background: 'none', border: 'none', cursor: 'pointer',
                                                            padding: '2px', display: 'inline-flex', alignItems: 'center',
                                                            color: meta.color, opacity: 0.35,
                                                        }}
                                                    >
                                                        <Pencil size={11} />
                                                    </button>
                                                )}
                                                <span style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)', fontWeight: 600 }}>({groupItems.length})</span>
                                                {groupNotes[groupKey] && (
                                                    <span title={groupNotes[groupKey]} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: '0.6rem', padding: '1px 5px', borderRadius: 4, background: `${meta.color}10`, color: meta.color, fontWeight: 600 }}>
                                                        <MessageSquare size={9} /> Nota
                                                    </span>
                                                )}
                                                {customGroupLabels[groupKey] && (
                                                    <span style={{ fontSize: '0.55rem', padding: '1px 4px', borderRadius: 3, background: `${meta.color}10`, color: meta.color, fontWeight: 600 }}>
                                                        editado
                                                    </span>
                                                )}
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={e => e.stopPropagation()}>
                                                {(
                                                    <>
                                                        {/* Plus button to add free item to this group */}
                                                        <button
                                                            onClick={() => openAddFreeItemToGroup(groupKey)}
                                                            title="Adicionar insumo livre a este grupo"
                                                            style={{
                                                                background: 'none', border: 'none', cursor: 'pointer',
                                                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                                                color: meta.color, opacity: 0.6, width: 24, height: 24, borderRadius: 4
                                                            }}
                                                            onMouseEnter={e => e.currentTarget.style.background = `${meta.color}15`}
                                                            onMouseLeave={e => e.currentTarget.style.background = 'none'}
                                                        >
                                                            <Plus size={14} />
                                                        </button>

                                                        {/* Move Up button */}
                                                        <button
                                                            onClick={() => moveGroupOrder(groupKey, -1)}
                                                            disabled={groupIdx === 0}
                                                            title="Mover grupo para cima"
                                                            style={{
                                                                background: 'none', border: 'none', cursor: groupIdx === 0 ? 'not-allowed' : 'pointer',
                                                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                                                color: meta.color, opacity: groupIdx === 0 ? 0.15 : 0.6, width: 24, height: 24, borderRadius: 4
                                                            }}
                                                            onMouseEnter={e => { if (groupIdx > 0) e.currentTarget.style.background = `${meta.color}15`; }}
                                                            onMouseLeave={e => e.currentTarget.style.background = 'none'}
                                                        >
                                                            <ChevronUp size={14} />
                                                        </button>

                                                        {/* Move Down button */}
                                                        <button
                                                            onClick={() => moveGroupOrder(groupKey, 1)}
                                                            disabled={groupIdx === orderedKeys.length - 1}
                                                            title="Mover grupo para baixo"
                                                            style={{
                                                                background: 'none', border: 'none', cursor: groupIdx === orderedKeys.length - 1 ? 'not-allowed' : 'pointer',
                                                                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                                                color: meta.color, opacity: groupIdx === orderedKeys.length - 1 ? 0.15 : 0.6, width: 24, height: 24, borderRadius: 4
                                                            }}
                                                            onMouseEnter={e => { if (groupIdx < orderedKeys.length - 1) e.currentTarget.style.background = `${meta.color}15`; }}
                                                            onMouseLeave={e => e.currentTarget.style.background = 'none'}
                                                        >
                                                            <ChevronDown size={14} />
                                                        </button>

                                                        {/* Delete button (only for custom groups) */}
                                                        {!GROUP_META[groupKey] && (
                                                            <button
                                                                onClick={() => handleDeleteGroup(groupKey)}
                                                                title="Excluir este grupo"
                                                                style={{
                                                                    background: 'none', border: 'none', cursor: 'pointer',
                                                                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                                                    color: 'var(--color-danger, #ef4444)', opacity: 0.6, width: 24, height: 24, borderRadius: 4
                                                                }}
                                                                onMouseEnter={e => e.currentTarget.style.background = 'rgba(239,68,68,0.1)'}
                                                                onMouseLeave={e => e.currentTarget.style.background = 'none'}
                                                            >
                                                                <Trash2 size={13} />
                                                            </button>
                                                        )}
                                                    </>
                                                )}

                                                <span style={{ fontWeight: 800, fontSize: '0.9rem', color: meta.color, marginLeft: 8 }}>{fmt(displayGroupTotal)}</span>
                                            </div>
                                        </div>

                                        {/* Drop indicator when dragging over this group */}
                                        {dragItem && dragOverGroup === groupKey && dragItem.sourceGroup !== groupKey && (
                                            <div style={{
                                                padding: '6px 20px', background: `${meta.color}12`,
                                                borderBottom: `2px dashed ${meta.color}`,
                                                display: 'flex', alignItems: 'center', gap: 8,
                                                fontSize: '0.72rem', color: meta.color, fontWeight: 600,
                                            }}>
                                                <ArrowDownUp size={13} /> Soltar aqui para mover para {displayLabel}
                                            </div>
                                        )}

                                        {isExpanded && (groupItems.length > 0 || (!dragItem && !dragGroupKey)) && (
                                            <>
                                                {groupItems.length > 0 ? (
                                                    <>
                                                        {/* Column headers */}
                                                <div style={{
                                                    display: 'grid', gridTemplateColumns: '40px 2.5fr 60px 90px 100px 90px 30px',
                                                    gap: 8, padding: '8px 20px', background: 'var(--color-bg-base)',
                                                    borderBottom: '1px solid var(--color-border)',
                                                }}>
                                                    {['#', 'Insumo', 'Unid.', 'Coeficiente', 'Preço Unit.', 'Subtotal', ''].map((h, i) => (
                                                        <span key={i} style={{
                                                            fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase',
                                                            letterSpacing: '0.06em', color: 'var(--color-text-tertiary)',
                                                            textAlign: (i >= 3 && i < 6) ? 'right' : (i === 6 ? 'center' : 'left'),
                                                        }}>{h}</span>
                                                    ))}
                                                </div>

                                                {/* Rows */}
                                                {groupItems.map((ci: any, idx: number) => {
                                                    const itemData = ci.item || ci.auxiliaryComposition;
                                                    const unitPrice = getLineUnitPrice(ci);
                                                    const lineSubtotal = getLineSubtotal(ci, engineeringConfig?.precision);
                                                    const displayCoef = hasRateio ? (ci.coefficient / rateioFactor) : ci.coefficient;
                                                    const displaySubtotal = hasRateio ? (displayCoef * unitPrice) : lineSubtotal;
                                                    const isEditingCoef = editingField?.id === ci.id && editingField?.field === 'coef';
                                                    const isEditingPrice = editingField?.id === ci.id && editingField?.field === 'price';

                                                    return (
                                                        <React.Fragment key={ci.id || idx}>
                                                        {/* Drop zone BEFORE this row */}
                                                        {dragItem && dragItem.id !== ci.id && (
                                                            <div
                                                                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverGroup(groupKey); setDragOverIndex(idx); }}
                                                                onDragLeave={() => { if (dragOverIndex === idx && dragOverGroup === groupKey) setDragOverIndex(null); }}
                                                                onDrop={(e) => { e.preventDefault(); e.stopPropagation(); handleDrop(groupKey, idx); }}
                                                                style={{
                                                                    height: dragOverGroup === groupKey && dragOverIndex === idx ? 4 : 2,
                                                                    background: dragOverGroup === groupKey && dragOverIndex === idx ? meta.color : 'transparent',
                                                                    transition: 'all 0.15s',
                                                                    borderRadius: 2,
                                                                    marginInline: 20,
                                                                }}
                                                            />
                                                        )}
                                                        <div
                                                            draggable={!isEditingCoef && !isEditingPrice}
                                                            onDragStart={(e) => {
                                                                const targetId = ci.id;
                                                                const targetGroup = groupKey;
                                                                const targetIdx = idx;
                                                                e.stopPropagation();
                                                                e.dataTransfer.effectAllowed = 'move';
                                                                e.dataTransfer.setData('text/plain', targetId);
                                                                if (e.currentTarget) {
                                                                    e.currentTarget.style.opacity = '0.4';
                                                                }
                                                                setTimeout(() => {
                                                                    setDragGroupKey(null);
                                                                    setDragItem({ id: targetId, sourceGroup: targetGroup, sourceIndex: targetIdx });
                                                                }, 0);
                                                            }}
                                                            onDragEnd={(e) => {
                                                                if (e.currentTarget) e.currentTarget.style.opacity = '1';
                                                                setDragItem(null);
                                                                setDragOverGroup(null);
                                                                setDragOverIndex(null);
                                                                setDragGroupKey(null);
                                                                setDragOverGroupIdx(null);
                                                            }}
                                                            onDragOver={(e) => {
                                                                e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverGroup(groupKey);
                                                            }}
                                                            onDrop={(e) => {
                                                                e.preventDefault(); e.stopPropagation(); handleDrop(groupKey, idx);
                                                            }}
                                                            style={{
                                                                display: 'grid', gridTemplateColumns: '40px 2.5fr 60px 90px 100px 90px 30px',
                                                                gap: 8, padding: '8px 20px', alignItems: 'center',
                                                                borderBottom: '1px solid var(--color-border)',
                                                                background: itemData?.isObservation ? 'rgba(0,0,0,0.03)' : (idx % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.01)'),
                                                                cursor: (isEditingCoef || isEditingPrice) ? 'text' : 'grab',
                                                            }}>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                                                <GripVertical size={10} style={{ color: 'var(--color-text-tertiary)', opacity: 0.35, flexShrink: 0 }} />
                                                                <span style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)', fontWeight: 600 }}>{idx + 1}</span>
                                                            </div>
                                                            <div style={itemData?.isObservation ? { gridColumn: '2 / 6', fontStyle: 'italic', color: 'var(--color-text-secondary)', fontSize: '0.75rem' } : {}}>
                                                                {!itemData?.isObservation ? (
                                                                    <>
                                                                        <div style={{ fontSize: '0.8rem', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                                                                            {editingItemDescId === ci.id ? (
                                                                                <input 
                                                                                    value={editingItemDescText} 
                                                                                    onChange={e => setEditingItemDescText(e.target.value)} 
                                                                                    onKeyDown={e => {
                                                                                        if (e.key === 'Enter') handleSaveItemDesc(ci.id);
                                                                                        if (e.key === 'Escape') setEditingItemDescId(null);
                                                                                    }}
                                                                                    onBlur={() => handleSaveItemDesc(ci.id)}
                                                                                    autoFocus
                                                                                    onClick={e => e.stopPropagation()}
                                                                                    style={{ 
                                                                                        width: '260px', maxWidth: '100%', padding: '2px 6px', fontSize: '0.78rem',
                                                                                        border: '1px solid var(--color-primary)', borderRadius: 4, 
                                                                                        background: 'var(--color-bg-base)', color: 'var(--color-text-primary)'
                                                                                    }} 
                                                                                />
                                                                            ) : (
                                                                                <span 
                                                                                    onClick={(e) => {
                                                                                        if (isProprietaryItem(itemData, ci)) {
                                                                                            e.stopPropagation();
                                                                                            setEditingItemDescId(ci.id);
                                                                                            setEditingItemDescText(itemData?.description || '');
                                                                                        }
                                                                                    }}
                                                                                    style={{ 
                                                                                        cursor: isProprietaryItem(itemData, ci) ? 'pointer' : 'default', 
                                                                                        display: 'inline-flex', alignItems: 'center', gap: 4 
                                                                                    }}
                                                                                    title={isProprietaryItem(itemData, ci) ? "Clique para renomear este insumo/composição" : undefined}
                                                                                >
                                                                                    {itemData?.description || '—'}
                                                                                    {isProprietaryItem(itemData, ci) && (
                                                                                        <Pencil size={10} color="var(--color-text-tertiary)" style={{ opacity: 0.4, flexShrink: 0 }} />
                                                                                    )}
                                                                                </span>
                                                                            )}
                                                                            {/* Drill-down button for auxiliary compositions */}
                                                                            {ci.auxiliaryComposition && itemData?.code && (!itemData?.isNew || itemData?._isCasca) && (
                                                                                <button
                                                                                    onClick={(e) => {
                                                                                        e.stopPropagation();
                                                                                        if (drill.checkCircularDependency(itemData.code)) {
                                                                                            alert(`Erro: Dependência Circular Detectada! Não é possível abrir a composição auxiliar "${itemData.code}", pois ela já é uma composição ancestral na estrutura atual.`);
                                                                                            return;
                                                                                        }
                                                                                        // G7-FIX: Use hook API for drill push
                                                                                        drill.push(itemData.code, itemData.description, {
                                                                                            data,
                                                                                            groupNotes,
                                                                                            customGroupLabels,
                                                                                            groupOrder,
                                                                                            refDivisorLabel,
                                                                                            refDivisorValue,
                                                                                            hasChanges,
                                                                                            observation,
                                                                                        });
                                                                                        // FIX CASCADE-02: Pass current composition's database context for correct lookup
                                                                                        loadComposition(itemData.code, data?.database?.name, data?.databaseId);
                                                                                    }}
                                                                                    title={`Abrir composição ${itemData.code}`}
                                                                                    style={{
                                                                                        background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.2)',
                                                                                        cursor: 'pointer', padding: '1px 6px', borderRadius: 4,
                                                                                        color: '#7c3aed', fontSize: '0.62rem', fontWeight: 700, flexShrink: 0,
                                                                                        display: 'inline-flex', alignItems: 'center', gap: 3,
                                                                                    }}>
                                                                                    <Layers size={10} /> Abrir ▸
                                                                                </button>
                                                                            )}
                                                                        </div>
                                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2, flexWrap: 'wrap' }}>
                                                                            {itemData?.code && (
                                                                                <span style={{ fontSize: '0.65rem', color: meta.color, fontWeight: 600 }}>{itemData.code}</span>
                                                                            )}
                                                                            {/* ── Interactive Category/Type Badge with reclassification dropdown ── */}
                                                                            {(!ci.auxiliaryComposition && itemData?.type) && (() => {
                                                                                const rawType = itemData.type;
                                                                                const typeMeta = EXPANDED_TYPES_META[rawType] || { label: rawType, color: '#6b7280', bgLight: 'rgba(107,114,128,0.08)' };
                                                                                const badgeStyle: React.CSSProperties = {
                                                                                    fontSize: '0.6rem', padding: '1px 5px', borderRadius: 4, fontWeight: 700,
                                                                                    cursor: 'pointer', position: 'relative' as const,
                                                                                    display: 'inline-flex', alignItems: 'center', gap: 3,
                                                                                    background: typeMeta.bgLight, color: typeMeta.color,
                                                                                    border: `1px solid ${typeMeta.color}25`,
                                                                                };

                                                                                return (
                                                                                    <div style={{ position: 'relative', display: 'inline-flex' }}>
                                                                                        <span
                                                                                            onClick={(e) => { e.stopPropagation(); setEditingTypeItemId(editingTypeItemId === ci.id ? null : ci.id); }}
                                                                                            title="Alterar tipo/categoria do insumo"
                                                                                            style={badgeStyle}
                                                                                        >
                                                                                            {typeMeta.label}
                                                                                            <span style={{ fontSize: '0.5rem', opacity: 0.5 }}>▾</span>
                                                                                        </span>
                                                                                        {editingTypeItemId === ci.id && (
                                                                                            <>
                                                                                            <div onClick={(e) => { e.stopPropagation(); setEditingTypeItemId(null); }} style={{ position: 'fixed', inset: 0, zIndex: 999 }} />
                                                                                            <div style={{
                                                                                                position: 'absolute', left: 0, top: '100%', zIndex: 1000, marginTop: 2,
                                                                                                background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)',
                                                                                                borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.15)', padding: 4,
                                                                                                minWidth: 180, fontSize: '0.7rem', maxHeight: 200, overflowY: 'auto'
                                                                                            }}>
                                                                                                <div style={{ padding: '3px 8px', fontWeight: 700, color: 'var(--color-text-tertiary)', fontSize: '0.6rem', textTransform: 'uppercase' }}>
                                                                                                    Reclassificar tipo:
                                                                                                </div>
                                                                                                {['Material', 'Mão de Obra', 'Equipamento', 'Equipamento para Aquisição Permanente', 'Serviços', 'Taxas', 'Administração', 'Aluguel', 'Verba', 'Consultoria', 'Transporte', 'Encargos Complementares', 'Franquia', 'Outros'].map(typeName => {
                                                                                                    const isActive = rawType === typeName;
                                                                                                    return (
                                                                                                        <button key={typeName} onClick={(e) => {
                                                                                                            e.stopPropagation();
                                                                                                            const updated = { ...data, groups: { ...data.groups } };
                                                                                                            const newMeta = resolveMetaCategory(typeName);
                                                                                                            
                                                                                                            let targetItem: any = null;
                                                                                                            for (const gk of Object.keys(updated.groups)) {
                                                                                                                const idx = updated.groups[gk].findIndex((item: any) => item.id === ci.id);
                                                                                                                if (idx !== -1) {
                                                                                                                    targetItem = { ...updated.groups[gk][idx] };
                                                                                                                    updated.groups[gk].splice(idx, 1);
                                                                                                                    break;
                                                                                                                }
                                                                                                            }
                                                                                                            
                                                                                                            if (targetItem) {
                                                                                                                targetItem.groupKey = newMeta;
                                                                                                                if (targetItem.item) {
                                                                                                                    targetItem.item = { ...targetItem.item, type: typeName };
                                                                                                                }
                                                                                                                if (!updated.groups[newMeta]) {
                                                                                                                    updated.groups[newMeta] = [];
                                                                                                                }
                                                                                                                updated.groups[newMeta].push(targetItem);
                                                                                                            }
                                                                                                            
                                                                                                            updated.totalPrice = sumCompositionGroups(updated.groups, engineeringConfig?.precision);
                                                                                                            updated.totalDirect = updated.totalPrice;
                                                                                                            
                                                                                                            setData(updated);
                                                                                                            setHasChanges(true);
                                                                                                            triggerUpdateItem({ unitCost: updated.totalPrice });
                                                                                                            setEditingTypeItemId(null);
                                                                                                        }} style={{
                                                                                                            display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                                                                                                            padding: '4px 8px', border: 'none',
                                                                                                            background: isActive ? 'var(--color-primary-bg)' : 'none',
                                                                                                            cursor: 'pointer', borderRadius: 4, textAlign: 'left',
                                                                                                            color: isActive ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                                                                                                            fontWeight: isActive ? 700 : 500, fontSize: '0.68rem',
                                                                                                        }}
                                                                                                        onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--color-bg-elevated)'; }}
                                                                                                        onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'none'; }}
                                                                                                        >
                                                                                                            {isActive && <span>✓</span>} {typeName}
                                                                                                        </button>
                                                                                                    );
                                                                                                })}
                                                                                            </div>
                                                                                            </>
                                                                                        )}
                                                                                    </div>
                                                                                );
                                                                            })()}
                                                                            {/* ── Interactive Base Badge with change dropdown ── */}
                                                                            {(() => {
                                                                                const rawDbName = ci._matchedDatabase || ci.item?.database?.name || ci.auxiliaryComposition?.database?.name || data?.database?.name || currentItem?.sourceName || '';
                                                                                const itemCode = ci.item?.code || ci.auxiliaryComposition?.code || '';
                                                                                // FIX BUG-2: Resolve real base from code pattern when stored in PROPRIA
                                                                                const rawBase = resolveDisplayBase(rawDbName, itemCode);
                                                                                const displayBase = rawBase; // Already resolved by resolveDisplayBase
                                                                                const isUnmatched = ci._noBaseMatch;
                                                                                const isProprio = isPropria(rawBase);
                                                                                const isConfirmedMatch = !isUnmatched && !isProprio;
                                                                                // Visual styling: confirmed = solid, unmatched/próprio = dashed
                                                                                const badgeStyle: React.CSSProperties = {
                                                                                    fontSize: '0.6rem', padding: '1px 5px', borderRadius: 4, fontWeight: 700,
                                                                                    cursor: 'pointer', position: 'relative' as const,
                                                                                    display: 'inline-flex', alignItems: 'center', gap: 3,
                                                                                    ...(isConfirmedMatch ? {
                                                                                        background: `${meta.color}10`, color: meta.color,
                                                                                        border: `1px solid ${meta.color}25`,
                                                                                    } : isProprio ? {
                                                                                        background: '#f9731615', color: '#ea580c',
                                                                                        border: '1px dashed #ea580c40',
                                                                                    } : {
                                                                                        background: '#f59e0b15', color: '#d97706',
                                                                                        border: '1px dashed #d9770640',
                                                                                    }),
                                                                                };
                                                                                const tooltip = isUnmatched
                                                                                    ? `Não encontrado em bases oficiais${ci._aiExtractedSource ? ` (IA leu: ${ci._aiExtractedSource})` : ''}. Clique para alterar.`
                                                                                    : isConfirmedMatch
                                                                                        ? `Encontrado na base ${displayBase}. Clique para alterar classificação.`
                                                                                        : 'Insumo próprio. Clique para alterar classificação.';

                                                                                if (!displayBase) return null;
                                                                                return (
                                                                                    <div style={{ position: 'relative', display: 'inline-flex' }}>
                                                                                        <span
                                                                                            onClick={(e) => { e.stopPropagation(); setEditingBaseItemId(editingBaseItemId === ci.id ? null : ci.id); }}
                                                                                            title={tooltip}
                                                                                            style={badgeStyle}
                                                                                        >
                                                                                            {displayBase}
                                                                                            <span style={{ fontSize: '0.5rem', opacity: 0.5 }}>▾</span>
                                                                                        </span>
                                                                                        {editingBaseItemId === ci.id && (
                                                                                            <>
                                                                                            <div onClick={(e) => { e.stopPropagation(); setEditingBaseItemId(null); }} style={{ position: 'fixed', inset: 0, zIndex: 999 }} />
                                                                                            <div style={{
                                                                                                position: 'absolute', left: 0, top: '100%', zIndex: 1000, marginTop: 2,
                                                                                                background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)',
                                                                                                borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.15)', padding: 4,
                                                                                                minWidth: 160, fontSize: '0.7rem',
                                                                                            }}>
                                                                                                <div style={{ padding: '3px 8px', fontWeight: 700, color: 'var(--color-text-tertiary)', fontSize: '0.6rem', textTransform: 'uppercase' }}>
                                                                                                    Classificar como:
                                                                                                </div>
                                                                                                {['PRÓPRIO', 'SINAPI', 'SEINFRA', 'ORSE', 'SICRO', 'CAERN', 'SBC', 'SICOR'].map(baseName => {
                                                                                                    const isActive = displayBase === baseName;
                                                                                                    return (
                                                                                                        <button key={baseName} onClick={(e) => {
                                                                                                            e.stopPropagation();
                                                                                                            // Update _matchedDatabase in state
                                                                                                            const updated = { ...data, groups: { ...data.groups } };
                                                                                                            for (const gk of Object.keys(updated.groups)) {
                                                                                                                updated.groups[gk] = updated.groups[gk].map((item: any) => {
                                                                                                                    if (item.id !== ci.id) return item;
                                                                                                                    return {
                                                                                                                        ...item,
                                                                                                                        _matchedDatabase: baseName === 'PRÓPRIO' ? 'PRÓPRIO' : baseName,
                                                                                                                        _noBaseMatch: baseName === 'PRÓPRIO',
                                                                                                                        _baseManuallySet: true,
                                                                                                                    };
                                                                                                                });
                                                                                                            }
                                                                                                            setData(updated);
                                                                                                            setHasChanges(true);
                                                                                                            setEditingBaseItemId(null);
                                                                                                        }} style={{
                                                                                                            display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                                                                                                            padding: '4px 8px', border: 'none',
                                                                                                            background: isActive ? 'var(--color-primary-bg)' : 'none',
                                                                                                            cursor: 'pointer', borderRadius: 4, textAlign: 'left',
                                                                                                            color: isActive ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                                                                                                            fontWeight: isActive ? 700 : 500, fontSize: '0.68rem',
                                                                                                        }}
                                                                                                        onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--color-bg-elevated)'; }}
                                                                                                        onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'none'; }}
                                                                                                        >
                                                                                                            {isActive && <span>✓</span>} {baseName}
                                                                                                        </button>
                                                                                                    );
                                                                                                })}
                                                                                            </div>
                                                                                            </>
                                                                                        )}
                                                                                    </div>
                                                                                );
                                                                            })()}
                                                                            {/* Warning badge for unmatched items */}
                                                                            {ci._noBaseMatch && !ci._baseManuallySet && (
                                                                                <span
                                                                                    title={`Item não encontrado em bases oficiais${ci._aiExtractedSource ? `. IA leu fonte: ${ci._aiExtractedSource}` : ''}`}
                                                                                    style={{ fontSize: '0.6rem', background: '#f59e0b12', color: '#d97706', padding: '1px 5px', borderRadius: 4, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 2, cursor: 'help' }}
                                                                                >
                                                                                    ⚠ Próprio{ci._aiExtractedSource ? ` (IA: ${ci._aiExtractedSource})` : ''}
                                                                                </span>
                                                                            )}
                                                                            {itemData?._isCasca && (
                                                                                <span style={{ fontSize: '0.6rem', background: '#7c3aed15', color: '#7c3aed', padding: '1px 5px', borderRadius: 4, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                                                                                    <Layers size={8} /> CASCA — Clique Abrir ▸
                                                                                </span>
                                                                            )}
                                                                            {ci._matchDivergence && (
                                                                                <span
                                                                                    title={ci._matchDivergence.message}
                                                                                    style={{ fontSize: '0.58rem', background: '#f59e0b18', color: '#b45309', padding: '2px 6px', borderRadius: 4, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 3, cursor: 'help', border: '1px solid #f59e0b30', maxWidth: 320, lineHeight: 1.3 }}
                                                                                >
                                                                                    ⚠ Diverge do edital: {ci._matchDivergence.originalSource && ci._matchDivergence.matchedSource !== ci._matchDivergence.originalSource ? `${ci._matchDivergence.originalSource} → ${ci._matchDivergence.matchedSource}` : ''}{ci._matchDivergence.originalCode && ci._matchDivergence.matchedCode !== ci._matchDivergence.originalCode ? ` cód. ${ci._matchDivergence.originalCode} → ${ci._matchDivergence.matchedCode}` : ''}
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                    </>
                                                                ) : (
                                                                    /* Editable etapa/observation */
                                                                    editingEtapaId === ci.id ? (
                                                                        <input
                                                                            autoFocus
                                                                            type="text"
                                                                            value={editingEtapaText}
                                                                            onChange={e => setEditingEtapaText(e.target.value)}
                                                                            onBlur={commitEtapaEdit}
                                                                            onKeyDown={e => { if (e.key === 'Enter') commitEtapaEdit(); if (e.key === 'Escape') setEditingEtapaId(null); }}
                                                                            style={{
                                                                                width: '100%', padding: '4px 8px', fontSize: '0.75rem',
                                                                                border: '1px solid var(--color-primary)', borderRadius: 4,
                                                                                fontStyle: 'italic', outline: 'none', background: 'white',
                                                                            }}
                                                                        />
                                                                    ) : (
                                                                        <div
                                                                            onClick={() => { setEditingEtapaId(ci.id); setEditingEtapaText(itemData?.description || ''); }}
                                                                            style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}
                                                                            title="Clique para editar esta etapa/observação"
                                                                        >
                                                                            {itemData?.description}
                                                                            <Pencil size={10} color="var(--color-text-tertiary)" style={{ opacity: 0.4, flexShrink: 0 }} />
                                                                        </div>
                                                                    )
                                                                )}
                                                            </div>
                                                            
                                                            {!itemData?.isObservation && (
                                                                <span style={{ fontSize: '0.78rem', color: 'var(--color-text-secondary)', textAlign: 'center' }}>
                                                                    {itemData?.unit || '—'}
                                                                </span>
                                                            )}

                                                            {/* Editable coefficient */}
                                                            {!itemData?.isObservation && (
                                                                <div style={{ textAlign: 'right', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                                                                    {isEditingCoef ? (
                                                                        <>
                                                                            <input type="text" autoFocus
                                                                                value={editValue}
                                                                                onChange={e => setEditValue(e.target.value)}
                                                                                onKeyDown={e => {
                                                                                    if (e.key === 'Enter') commitEdit();
                                                                                    if (e.key === 'Escape') setEditingField(null);
                                                                                }}
                                                                                onBlur={commitEdit}
                                                                                placeholder="Ex: 1 * 32"
                                                                                style={{ width: 85, padding: '2px 4px', border: '1px solid var(--color-primary)', borderRadius: 3, fontSize: '0.75rem', textAlign: 'right' }}
                                                                            />
                                                                        </>
                                                                    ) : (
                                                                        <>
                                                                            <span
                                                                                style={{ fontSize: '0.78rem', fontFamily: 'monospace', cursor: ci.coefficientExpression ? 'help' : 'default' }}
                                                                                title={ci.coefficientExpression ? `${ci.coefficientExpression.replace(/\*/g, '×')} = ${fmtCoef(displayCoef)}` : undefined}
                                                                            >
                                                                                {ci.coefficientExpression
                                                                                    ? <><span style={{ color: 'var(--color-text-tertiary)', fontSize: '0.68rem' }}>{ci.coefficientExpression.replace(/\*/g, '×')} = </span>{fmtCoef(displayCoef)}</>
                                                                                    : fmtCoef(displayCoef)
                                                                                }
                                                                            </span>
                                                                            <button onClick={() => startEdit(ci.id, 'coef', displayCoef, ci.coefficientExpression)}
                                                                                style={{ padding: 2, border: 'none', background: 'none', cursor: 'pointer', opacity: 0.3 }}
                                                                                title="Editar coeficiente (aceita expressões: 1*220, 2*3.5)">
                                                                                <Pencil size={10} />
                                                                            </button>
                                                                        </>
                                                                    )}
                                                                </div>
                                                            )}

                                                            {/* Editable price */}
                                                            {!itemData?.isObservation && (
                                                                <div style={{ textAlign: 'right', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                                                                    {isEditingPrice ? (
                                                                        <>
                                                                            <input type="text" autoFocus
                                                                                value={editValue}
                                                                                onChange={e => setEditValue(e.target.value)}
                                                                                onKeyDown={e => {
                                                                                    if (e.key === 'Enter') commitEdit();
                                                                                    if (e.key === 'Escape') setEditingField(null);
                                                                                }}
                                                                                onBlur={commitEdit}
                                                                                placeholder="Ex: 114.40"
                                                                                style={{ width: 85, padding: '2px 4px', border: '1px solid var(--color-primary)', borderRadius: 3, fontSize: '0.75rem', textAlign: 'right' }}
                                                                            />
                                                                        </>
                                                                    ) : (
                                                                        <>
                                                                            <span style={{ fontSize: '0.78rem', fontWeight: 600 }}>{fmt(unitPrice)}</span>
                                                                            <button onClick={() => startEdit(ci.id, 'price', unitPrice)}
                                                                                style={{ padding: 2, border: 'none', background: 'none', cursor: 'pointer', opacity: 0.3 }}
                                                                                title="Editar preço unitário">
                                                                                <Pencil size={10} />
                                                                            </button>
                                                                        </>
                                                                    )}
                                                                </div>
                                                            )}

                                                            <span style={{ fontSize: '0.78rem', textAlign: 'right', fontWeight: 700, color: itemData?.isObservation ? 'transparent' : meta.color }}>
                                                                {!itemData?.isObservation && fmt(displaySubtotal)}
                                                            </span>
                                                            
                                                            <div style={{ textAlign: 'center', display: 'flex', alignItems: 'center', gap: 2, justifyContent: 'center' }}>
                                                                    <>
                                                                        {/* Convert Insumo → Composição (only for unmatched items or items in base PRÓPRIA) */}
                                                                        {ci.item && !itemData?.isObservation && (ci._noBaseMatch || isPropria(data?.database?.name)) && (
                                                                            <button
                                                                                onClick={() => {
                                                                                    if (!data) return;
                                                                                    // Convert insumo to casca (shell composition)
                                                                                    const itemInfo = ci.item;
                                                                                    const compCode = itemInfo.code || `CP-${Date.now().toString(36).toUpperCase()}`;
                                                                                    
                                                                                    // Remove from current group
                                                                                    const updated = { ...data, groups: { ...data.groups } };
                                                                                    updated.groups[groupKey] = updated.groups[groupKey].filter((i: any) => i.id !== ci.id);
                                                                                    
                                                                                    // Create as auxiliary composition (casca)
                                                                                    const newAuxItem = {
                                                                                        ...ci,
                                                                                        item: undefined,
                                                                                        auxiliaryComposition: {
                                                                                            id: `new-casca-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
                                                                                            code: compCode,
                                                                                            description: itemInfo.description,
                                                                                            unit: itemInfo.unit || 'UN',
                                                                                            totalPrice: itemInfo.price || 0,
                                                                                            // FIX SYNC-02: Only mark as truly "new" for PROPRIA items
                                                                                            // Official items are copies, not new creations
                                                                                            isNew: isPropria(data?.database?.name) || !data?.database?.name,
                                                                                            _isCasca: true,
                                                                                            // FIX SYNC-02: Preserve original database reference for traceability
                                                                                            _officialSourceRef: data?.database?.name && !isPropria(data.database.name) ? {
                                                                                                databaseId: data.databaseId || data.database?.id,
                                                                                                databaseName: data.database.name,
                                                                                                originalItemCode: itemInfo.code,
                                                                                            } : undefined,
                                                                                        },
                                                                                    };
                                                                                    
                                                                                    // Add to AUXILIAR group
                                                                                    if (!updated.groups.AUXILIAR) updated.groups.AUXILIAR = [];
                                                                                    updated.groups.AUXILIAR.push(newAuxItem);
                                                                                    
                                                                                    // Recalculate totals
                                                                                    updated.totalPrice = sumCompositionGroups(updated.groups, engineeringConfig?.precision);
                                                                                    updated.totalDirect = updated.totalPrice;
                                                                                    
                                                                                    setData(updated);
                                                                                    setHasChanges(true);
                                                                                    triggerUpdateItem({ unitCost: updated.totalPrice });
                                                                                }}
                                                                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#7c3aed', opacity: 0.4, padding: 2 }}
                                                                                title="Converter em Composição Auxiliar (Casca) — permite abrir e inserir sub-insumos"
                                                                            >
                                                                                <Layers size={12} />
                                                                            </button>
                                                                        )}
                                                                        {/* Move item to another group */}
                                                                        <div style={{ position: 'relative' }}>
                                                                            <button onClick={(e) => { e.stopPropagation(); setMovingItemId(movingItemId === ci.id ? null : ci.id); }}
                                                                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-tertiary)', opacity: movingItemId === ci.id ? 1 : 0.4, padding: 2 }}
                                                                                title="Mover para outro group">
                                                                                <ArrowRightLeft size={11} />
                                                                            </button>
                                                                            {movingItemId === ci.id && (
                                                                                <>
                                                                                {/* Backdrop to dismiss dropdown */}
                                                                                <div onClick={(e) => { e.stopPropagation(); setMovingItemId(null); }} style={{ position: 'fixed', inset: 0, zIndex: 999 }} />
                                                                                <div style={{
                                                                                    position: 'absolute', right: 0, top: '100%', zIndex: 1000,
                                                                                    background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)',
                                                                                    borderRadius: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.15)', padding: 4,
                                                                                    minWidth: 180, fontSize: '0.72rem',
                                                                                }}>
                                                                                    <div style={{ padding: '4px 8px', fontWeight: 700, color: 'var(--color-text-tertiary)', fontSize: '0.65rem', textTransform: 'uppercase' }}>
                                                                                        Mover para:
                                                                                    </div>
                                                                                    {(() => {
                                                                                        const allKeys = new Set([...Object.keys(GROUP_META), ...(data.groups ? Object.keys(data.groups) : []), ...Object.keys(customGroupLabels)]);
                                                                                        return Array.from(allKeys)
                                                                                            .filter(k => k !== groupKey)
                                                                                            .map(targetKey => {
                                                                                                const targetMeta = GROUP_META[targetKey] || { label: targetKey, color: '#6b7280' };
                                                                                                const targetLabel = customGroupLabels[targetKey] || targetMeta.label;
                                                                                                return (
                                                                                                    <button key={targetKey} onClick={(e) => {
                                                                                                        e.stopPropagation();
                                                                                                        const updated = { ...data, groups: { ...data.groups } };
                                                                                                        // Remove from current group
                                                                                                        updated.groups[groupKey] = updated.groups[groupKey].filter((i: any) => i.id !== ci.id);
                                                                                                        // Add to target group
                                                                                                        if (!updated.groups[targetKey]) updated.groups[targetKey] = [];
                                                                                                        updated.groups[targetKey].push(ci);
                                                                                                        // Recalculate totals
                                                                                                        updated.totalPrice = sumCompositionGroups(updated.groups, engineeringConfig?.precision);
                                                                                                        updated.totalDirect = updated.totalPrice;
                                                                                                        setData(updated);
                                                                                                        setHasChanges(true);
                                                                                                        setMovingItemId(null);
                                                                                                        triggerUpdateItem({ unitCost: updated.totalPrice });
                                                                                                    }} style={{
                                                                                                        display: 'flex', alignItems: 'center', gap: 6, width: '100%',
                                                                                                        padding: '5px 8px', border: 'none', background: 'none',
                                                                                                        cursor: 'pointer', borderRadius: 4, textAlign: 'left',
                                                                                                        color: targetMeta.color, fontWeight: 600,
                                                                                                    }}
                                                                                                    onMouseEnter={e => (e.currentTarget.style.background = `${targetMeta.color}10`)}
                                                                                                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                                                                                                    >
                                                                                                        <ArrowRightLeft size={10} /> {targetLabel}
                                                                                                    </button>
                                                                                                );
                                                                                            });
                                                                                    })()}
                                                                                </div>
                                                                                </>
                                                                            )}
                                                                        </div>
                                                                        <button onClick={() => {
                                                                            const updated = { ...data, groups: { ...data.groups } };
                                                                            updated.groups[groupKey] = updated.groups[groupKey].filter((i: any) => i.id !== ci.id);
                                                                            
                                                                            updated.totalPrice = sumCompositionGroups(updated.groups, engineeringConfig?.precision);
                                                                            updated.totalDirect = updated.totalPrice;
                                                                            
                                                                            setData(updated);
                                                                            setHasChanges(true);
                                                                            triggerUpdateItem({ unitCost: updated.totalPrice });
                                                                        }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-danger)', opacity: 0.5 }}>
                                                                            <X size={14} />
                                                                        </button>
                                                                    </>
                                                            </div>
                                                        </div>
                                                        {/* Drop zone AFTER last row */}
                                                        {dragItem && dragItem.id !== ci.id && idx === groupItems.length - 1 && (
                                                            <div
                                                                onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverGroup(groupKey); setDragOverIndex(idx + 1); }}
                                                                onDragLeave={() => { if (dragOverIndex === idx + 1 && dragOverGroup === groupKey) setDragOverIndex(null); }}
                                                                onDrop={(e) => { e.preventDefault(); e.stopPropagation(); handleDrop(groupKey, idx + 1); }}
                                                                style={{
                                                                    height: dragOverGroup === groupKey && dragOverIndex === idx + 1 ? 4 : 2,
                                                                    background: dragOverGroup === groupKey && dragOverIndex === idx + 1 ? meta.color : 'transparent',
                                                                    transition: 'all 0.15s',
                                                                    borderRadius: 2,
                                                                    marginInline: 20,
                                                                }}
                                                            />
                                                        )}
                                                        </React.Fragment>
                                                    );
                                                })}
                                                    </>
                                                ) : (
                                                    <div style={{
                                                        padding: '24px 20px',
                                                        textAlign: 'center',
                                                        borderBottom: '1px solid var(--color-border)',
                                                        background: 'var(--color-bg-base)',
                                                    }}>
                                                        <div style={{ color: 'var(--color-text-tertiary)', fontSize: '0.75rem', fontStyle: 'italic' }}>
                                                            Nenhum insumo neste grupo. Arraste itens para cá ou utilize os botões da barra de ferramentas.
                                                        </div>
                                                    </div>
                                                )}

                                                {/* GAP 2: Group Note — inline editor below rows */}
                                                {isExpanded && (
                                                    <div style={{ padding: '8px 20px', background: `${meta.color}04`, borderTop: `1px dashed ${meta.color}15` }}>
                                                        {editingGroupNote === groupKey ? (
                                                            <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                                                                <textarea
                                                                    autoFocus
                                                                    value={groupNotes[groupKey] || ''}
                                                                    onChange={e => setGroupNotes(prev => ({ ...prev, [groupKey]: e.target.value }))}
                                                                    onBlur={() => { setEditingGroupNote(null); setHasChanges(true); }}
                                                                    onKeyDown={e => { if (e.key === 'Escape') setEditingGroupNote(null); }}
                                                                    placeholder="Ex: Disponibilidade básica de turno mensal com 44 horas semanais..."
                                                                    style={{
                                                                        flex: 1, padding: '6px 10px', borderRadius: 'var(--radius-md)',
                                                                        border: `1px solid ${meta.color}40`, fontSize: '0.75rem',
                                                                        background: 'white', color: 'var(--color-text-primary)',
                                                                        resize: 'vertical', minHeight: 48, fontFamily: 'inherit',
                                                                        outline: 'none',
                                                                    }}
                                                                />
                                                            </div>
                                                        ) : (
                                                            <button
                                                                onClick={() => setEditingGroupNote(groupKey)}
                                                                style={{
                                                                    display: 'flex', alignItems: 'center', gap: 4,
                                                                    background: 'none', border: 'none', cursor: 'pointer',
                                                                    fontSize: '0.7rem', color: groupNotes[groupKey] ? meta.color : 'var(--color-text-tertiary)',
                                                                    fontStyle: groupNotes[groupKey] ? 'normal' : 'italic',
                                                                    padding: '2px 0', width: '100%', textAlign: 'left',
                                                                }}
                                                            >
                                                                <MessageSquare size={11} />
                                                                {groupNotes[groupKey] || 'Adicionar observação ao grupo...'}
                                                            </button>
                                                        )}
                                                    </div>
                                                )}
                                            </>
                                        )}
                                    </div>
                                    {/* Group-level drop zone AFTER last group */}
                                    {dragGroupKey && dragGroupKey !== groupKey && groupIdx === orderedKeys.length - 1 && (
                                        <div
                                            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverGroupIdx(groupIdx + 1); }}
                                            onDragLeave={() => { if (dragOverGroupIdx === groupIdx + 1) setDragOverGroupIdx(null); }}
                                            onDrop={(e) => { e.preventDefault(); e.stopPropagation(); handleGroupDrop(groupIdx + 1); }}
                                            style={{
                                                height: dragOverGroupIdx === groupIdx + 1 ? 8 : 12,
                                                background: dragOverGroupIdx === groupIdx + 1 ? 'var(--color-primary)' : 'transparent',
                                                transition: 'all 0.15s',
                                                borderRadius: 4,
                                                marginBlock: 2,
                                            }}
                                        />
                                    )}
                                    </React.Fragment>
                                );
                            });
                            })()}
                        </div>
                    )}
                </div>
                )}

                {/* Footer */}
                {data && !error && (
                    <div style={{
                        padding: '16px 24px', borderTop: '1px solid var(--color-border)',
                        background: hasChanges
                            ? 'linear-gradient(135deg, rgba(34,197,94,0.06), rgba(37,99,235,0.04))'
                            : 'linear-gradient(135deg, rgba(37,99,235,0.04), rgba(124,58,237,0.03))',
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                                <div style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-tertiary)' }}>
                                    Custo Unitário do Serviço (S/ BDI)
                                </div>
                                <div style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                                    {compositionItemsCount} insumos · {currentItem.quantity} {currentItem.unit} no orçamento
                                    {hasChanges && <span style={{ color: '#16a34a', fontWeight: 700, marginLeft: 8 }}>✓ Cascade ativo</span>}
                                </div>
                            </div>
                            <div style={{ textAlign: 'right' }}>
                                <div style={{ fontSize: '1.5rem', fontWeight: 800, color: hasChanges ? '#16a34a' : 'var(--color-primary)' }}>
                                    {fmt(compositionTotal)}
                                </div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
                                    Total: {fmt(compositionTotal * currentItem.quantity)}
                                </div>
                            </div>
                        </div>
                        {/* Rateio Breakdown Panel */}
                        {hasRateio && (
                            <div style={{
                                marginTop: 12, marginBottom: 12, padding: 12, borderRadius: 'var(--radius-md)',
                                background: 'var(--color-bg-base)', border: '1px dashed var(--color-border)',
                                fontSize: '0.8rem', display: 'flex', flexDirection: 'column', gap: 6
                            }}>
                                <div style={{ fontWeight: 700, color: 'var(--color-text-primary)', borderBottom: '1px solid var(--color-border)', paddingBottom: 4, marginBottom: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                        <Divide size={13} /> Memória de Cálculo (Rateio/Fração)
                                    </span>
                                    <button
                                        onClick={() => {
                                            const updated = { ...data, groups: { ...data.groups } };
                                            for (const k of Object.keys(updated.groups)) {
                                                if (k === 'OBSERVACAO') continue;
                                                updated.groups[k] = updated.groups[k].map((ci: any) => {
                                                    if (ci.item?.isObservation) return ci;
                                                    const origCoef = ci.coefficient / rateioFactor;
                                                    const unitPrice = getLineUnitPrice(ci);
                                                    return {
                                                        ...ci,
                                                        coefficient: origCoef,
                                                        price: applyPrecision(origCoef * unitPrice, { precision: engineeringConfig?.precision })
                                                    };
                                                });
                                            }
                                            if (updated.groups['OBSERVACAO']) {
                                                updated.groups['OBSERVACAO'] = updated.groups['OBSERVACAO'].filter((ci: any) => {
                                                    return !ci.item?.description?.includes('Rateio aplicado');
                                                });
                                            }
                                            updated.rateio = null;
                                            updated.totalPrice = sumCompositionGroups(updated.groups, engineeringConfig?.precision);
                                            updated.totalDirect = updated.totalPrice;
                                            setData(updated);
                                            setHasChanges(true);
                                            triggerUpdateItem({ unitCost: updated.totalPrice });
                                        }}
                                        style={{ fontSize: '0.7rem', color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}
                                    >
                                        Remover Rateio
                                    </button>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8 }}>
                                    <span style={{ color: 'var(--color-text-secondary)' }}>TOTAL SIMPLES:</span>
                                    <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{fmt(compositionTotal / rateioFactor)}</span>
                                    
                                    <span style={{ color: 'var(--color-text-secondary)' }}>TOTAL P/ {rateio.prazo} MESES:</span>
                                    <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{fmt((compositionTotal / rateioFactor) * Number(rateio.prazo))}</span>
                                    
                                    <span style={{ color: 'var(--color-text-secondary)' }}>FRAÇÃO DE {rateio.fracao}% (Sem BDI):</span>
                                    <span style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--color-primary)' }}>{fmt(compositionTotal)}</span>
                                    
                                    {(() => {
                                        const bdiPct = bdiConfig?.bdiGlobal !== undefined ? Number(bdiConfig.bdiGlobal) : 25;
                                        return (
                                            <>
                                                <span style={{ color: 'var(--color-text-secondary)' }}>BDI ({bdiPct.toFixed(2)}%):</span>
                                                <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{fmt(compositionTotal * (bdiPct / 100))}</span>
                                                
                                                <span style={{ color: 'var(--color-text-secondary)', fontWeight: 700 }}>TOTAL GERAL (Com BDI):</span>
                                                <span style={{ fontFamily: 'monospace', fontWeight: 800, color: '#16a34a' }}>{fmt(compositionTotal * (1 + bdiPct / 100))}</span>
                                            </>
                                        );
                                    })()}
                                </div>
                            </div>
                        )}
                        {/* Observação da composição (para relatórios) */}
                        <div style={{ marginTop: 10, borderTop: '1px solid var(--color-border)', paddingTop: 8 }}>
                            <label style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--color-text-tertiary)', display: 'block', marginBottom: 3 }}>
                                Observação (aparece nos relatórios PDF/XLS)
                            </label>
                            <textarea
                                value={observation}
                                onChange={e => {
                                    const newVal = e.target.value;
                                    setObservation(newVal);
                                    setHasChanges(true);
                                    if (!activeCode || !onUpdateItem || !engineeringConfig) return;
                                    const notes = { ...(engineeringConfig.reportConfig?.compositionNotes || {}), [activeCode]: newVal };
                                    if (!newVal) delete notes[activeCode];
                                    const rc = { ...(engineeringConfig.reportConfig || {}), compositionNotes: notes };
                                    // Propagate via onUpdateItem — trick: use a special key to signal config change
                                    (onUpdateItem as any)('__reportConfig__', rc);
                                }}
                                placeholder="Ex: Valores ajustados conforme cotação de mercado local..."
                                style={{
                                    width: '100%', padding: '6px 10px', borderRadius: 'var(--radius-md)',
                                    border: '1px solid var(--color-border)', fontSize: '0.78rem',
                                    background: 'var(--color-bg-base)', color: 'var(--color-text-primary)',
                                    resize: 'vertical', minHeight: 36, fontFamily: 'inherit',
                                    outline: 'none',
                                }}
                                onFocus={e => { e.currentTarget.style.borderColor = 'var(--color-primary)'; }}
                                onBlur={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; }}
                            />
                        </div>

                        {/* GAP 3: Reference Divisor — derived metric (e.g. Price per Light Point) */}
                        <div style={{ marginTop: 8, borderTop: '1px solid var(--color-border)', paddingTop: 8 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                                <Hash size={12} color="var(--color-text-tertiary)" />
                                <label style={{ fontSize: '0.68rem', fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                    Divisor de Referência
                                </label>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px 1fr', gap: 8, alignItems: 'center' }}>
                                <input
                                    type="text"
                                    className="form-input"
                                    placeholder="Ex: Unidades, Área (m²), Extensão (m)"
                                    value={refDivisorLabel}
                                    onChange={e => { setRefDivisorLabel(e.target.value); setHasChanges(true); }}
                                    style={{ fontSize: '0.75rem', padding: '5px 8px' }}
                                />
                                <input
                                    type="text"
                                    className="form-input"
                                    placeholder="Qtd"
                                    value={refDivisorValue}
                                    onChange={e => { setRefDivisorValue(e.target.value); setHasChanges(true); }}
                                    style={{ fontSize: '0.75rem', padding: '5px 8px', textAlign: 'center', fontWeight: 700 }}
                                />
                                {refDivisorValue && parseFloat(refDivisorValue.replace(',', '.')) > 0 && (
                                    <div style={{ padding: '4px 10px', borderRadius: 'var(--radius-md)', background: 'linear-gradient(135deg, rgba(37,99,235,0.06), rgba(124,58,237,0.06))', border: '1px solid rgba(37,99,235,0.12)', textAlign: 'center' }}>
                                        <div style={{ fontSize: '0.58rem', fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase' }}>
                                            Custo/{(refDivisorLabel || 'Ref.').substring(0, 20)}
                                        </div>
                                        <div style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--color-primary)' }}>
                                            {fmt(compositionTotal / (parseFloat(refDivisorValue.replace(',', '.')) || 1))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
            {/* ═══ HUB DE INSERÇÃO MODAL (padronizado com Planilha Orçamentária) ═══ */}
            {showSearch && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 100000, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
                            {([{ type: 'composition' as const, label: 'Composições', icon: Layers, color: '#7c3aed' }, { type: 'item' as const, label: 'Insumos', icon: Package, color: '#0ea5e9' }]).map(tab => {
                                const isActive = searchType === tab.type;
                                const Icon = tab.icon;
                                return (
                                    <button key={tab.type}
                                        onClick={() => { setSearchType(tab.type); setSearchResults([]); setSearchQuery(''); }}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px',
                                            borderRadius: 'var(--radius-md)',
                                            border: isActive ? `2px solid ${tab.color}` : '1px solid var(--color-border)',
                                            background: isActive ? `${tab.color}12` : 'var(--color-bg-base)',
                                            cursor: 'pointer', fontSize: '0.78rem', fontWeight: isActive ? 700 : 600,
                                            color: isActive ? tab.color : 'var(--color-text-secondary)',
                                            transition: 'all 0.15s',
                                        }}
                                    >
                                        <Icon size={14} />
                                        {tab.label}
                                    </button>
                                );
                            })}
                        </div>

                        {/* ── Search Bar ── */}
                        {(() => {
                            const { filtered, warnings } = filterBasesWithWarnings(bases, engineeringConfig);
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
                                                    const vb = isVersionBasedBase(b.name);
                                                    const ref = vb
                                                        ? (b.version || 'N/I')
                                                        : (b.referenceMonth && b.referenceYear ? `${String(b.referenceMonth).padStart(2, '0')}/${b.referenceYear}` : (b.version || 'N/I'));
                                                    const totalRecords = (b.itemCount || 0) + (b.compositionCount || 0);
                                                    return <option key={b.id} value={b.id}>{b.name} {b.uf || ''} {vb ? `v${ref}` : `· ${ref}`} · {totalRecords.toLocaleString('pt-BR')} registros</option>;
                                                })
                                            }
                                        </select>
                                        <div style={{ flex: 1, position: 'relative' }}>
                                            <input type="text" className="form-input"
                                                placeholder={`Buscar ${searchType === 'composition' ? 'composição' : 'insumo'} por código ou descrição...`}
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
                        <div style={{ borderRadius: 8, border: `1px solid ${showPropriaForm ? (searchType === 'composition' ? '#7c3aed40' : '#0ea5e940') : 'var(--color-border)'}`, overflow: 'hidden', transition: 'all 0.2s' }}>
                            <button onClick={() => setShowPropriaForm(p => !p)}
                                style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '8px 12px', border: 'none', background: showPropriaForm ? (searchType === 'composition' ? '#7c3aed08' : '#0ea5e908') : 'var(--color-bg-base)', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600, color: searchType === 'composition' ? '#7c3aed' : '#0ea5e9', textAlign: 'left' as const }}>
                                <Plus size={14} />
                                Criar {searchType === 'composition' ? 'Composição' : 'Insumo'} Própri{searchType === 'composition' ? 'a' : 'o'}
                                <span style={{ marginLeft: 'auto', fontSize: '0.68rem', color: 'var(--color-text-tertiary)', fontWeight: 400 }}>
                                    {showPropriaForm ? 'Recolher' : 'Salva no banco PROPRIA e adiciona à composição'}
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
                                        <label style={{ fontSize: '0.65rem', fontWeight: 600, color: 'var(--color-text-tertiary)', display: 'block', marginBottom: 2 }}>Coef.</label>
                                        <input type="text" className="form-input" value={propriaCoef} onChange={e => setPropriaCoef(e.target.value)}
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

                        {/* ── Search Results Table ── */}
                        <div style={{ flex: 1, overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: 8 }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                                <thead><tr style={{ background: 'var(--color-bg-base)' }}>
                                    {['Tipo','Código','Descrição','Unid.','Preço','Coef.',''].map((h,i) => <th key={i} style={{ padding: 8, textAlign: i >= 4 ? 'right' : (i === 5 ? 'center' : 'left') }}>{h}</th>)}
                                </tr></thead>
                                <tbody>
                                    {searchResults.map(r => {
                                        const wasAdded = addedItemIds.has(r.id);
                                        const isComp = searchType === 'composition';
                                        return (
                                        <tr key={r.id} style={{ borderBottom: '1px solid var(--color-border)', background: wasAdded ? 'rgba(16,185,129,0.08)' : undefined, transition: 'background 0.3s' }}>
                                            <td style={{ padding: 8, color: 'var(--color-text-tertiary)', fontWeight: 700 }}>{isComp ? 'Comp.' : 'Insumo'}</td>
                                            <td style={{ padding: 8 }}><strong>{r.code}</strong></td>
                                            <td style={{ padding: 8 }}>{r.description}</td>
                                            <td style={{ padding: 8, textAlign: 'center' }}>{r.unit}</td>
                                            <td style={{ padding: 8, textAlign: 'right', fontWeight: 600 }}>{fmt(Number(isComp ? r.totalPrice : r.price) || 0)}</td>
                                            <td style={{ padding: '4px 8px', textAlign: 'center' }}>
                                                <input type="number" min="0.0001" step="0.01"
                                                    value={searchCoefficients[r.id] ?? 1}
                                                    onChange={e => setSearchCoefficients(prev => ({ ...prev, [r.id]: parseFloat(e.target.value) || 1 }))}
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
                                        {searchQuery ? 'Nenhum resultado encontrado.' : `Busque ${searchType === 'composition' ? 'composição' : 'insumo'} por código ou descrição acima.`}
                                    </td></tr>}
                                </tbody>
                            </table>
                        </div>

                        {/* ── Footer with close button ── */}
                        {addedCount > 0 && (
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--color-border)', paddingTop: 12 }}>
                                <span style={{ fontSize: '0.78rem', color: 'var(--color-text-secondary)' }}>
                                    <CheckCircle2 size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} color="#059669" />
                                    {addedCount} {addedCount === 1 ? 'item adicionado' : 'itens adicionados'} à composição
                                </span>
                                <button className="btn btn-primary" onClick={closeSearchModal} style={{ padding: '6px 16px', fontSize: '0.8rem' }}>Concluir</button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Modals Módulo Livre */}
            {showFreeItemModal && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 100000, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ background: 'var(--color-bg-surface)', padding: 24, borderRadius: 12, width: 400, display: 'flex', flexDirection: 'column', gap: 16 }}>
                        <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}><PlusCircle size={18} /> Novo Insumo Livre</h3>
                        
                        <div>
                            <label style={{ fontSize: '0.75rem', fontWeight: 600, display: 'block', marginBottom: 4 }}>Descrição / Serviço</label>
                            <input autoFocus type="text" className="form-input" value={freeItemData.description} onChange={e => setFreeItemData({...freeItemData, description: e.target.value})} style={{ width: '100%' }} />
                        </div>
                        
                        <div style={{ display: 'flex', gap: 12 }}>
                            <div style={{ flex: 1 }}>
                                <label style={{ fontSize: '0.75rem', fontWeight: 600, display: 'block', marginBottom: 4 }}>Tipo</label>
                                <select className="form-select" value={freeItemData.type} onChange={e => setFreeItemData({...freeItemData, type: e.target.value})} style={{ width: '100%' }}>
                                    <option value="MATERIAL">Material</option>
                                    <option value="MAO_DE_OBRA">Mão de Obra</option>
                                    <option value="EQUIPAMENTO">Equipamento</option>
                                    <option value="SERVICO">Serviço Terceirizado</option>
                                    <option value="AUXILIAR">Comp. Auxiliar</option>
                                    <option value="OBSERVACAO">Observação / Texto</option>
                                </select>
                            </div>
                            <div style={{ width: 80 }}>
                                <label style={{ fontSize: '0.75rem', fontWeight: 600, display: 'block', marginBottom: 4 }}>Unidade</label>
                                <input type="text" className="form-input" value={freeItemData.unit} onChange={e => setFreeItemData({...freeItemData, unit: e.target.value})} style={{ width: '100%', textTransform: 'uppercase' }} />
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: 12 }}>
                            <div style={{ flex: 1 }}>
                                <label style={{ fontSize: '0.75rem', fontWeight: 600, display: 'block', marginBottom: 4 }}>Coeficiente <span style={{ fontWeight: 400, color: 'var(--color-text-tertiary)', fontSize: '0.68rem' }}>(aceita expressões: 1*220)</span></label>
                                <input type="text" className="form-input" value={freeItemData.coefficient} onChange={e => setFreeItemData({...freeItemData, coefficient: e.target.value})} placeholder="Ex: 1*220" style={{ width: '100%' }} />
                            </div>
                            <div style={{ flex: 1 }}>
                                <label style={{ fontSize: '0.75rem', fontWeight: 600, display: 'block', marginBottom: 4 }}>Preço Unitário</label>
                                <input type="text" className="form-input" value={freeItemData.price} onChange={e => setFreeItemData({...freeItemData, price: e.target.value})} placeholder="Ex: 114.40" style={{ width: '100%' }} />
                            </div>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                            <button className="btn" onClick={() => setShowFreeItemModal(false)}>Cancelar</button>
                            <button className="btn btn-primary" onClick={handleAddFreeItem} disabled={!freeItemData.description}>Inserir Insumo</button>
                        </div>
                    </div>
                </div>
            )}

            {showFactorModal && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 100000, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ background: 'var(--color-bg-surface)', padding: 24, borderRadius: 12, width: 350, display: 'flex', flexDirection: 'column', gap: 16 }}>
                        <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}><Calculator size={18} /> Aplicar Fator</h3>
                        
                        <div>
                            <label style={{ fontSize: '0.75rem', fontWeight: 600, display: 'block', marginBottom: 4 }}>Alvo da Multiplicação</label>
                            <select className="form-select" value={factorData.target} onChange={e => setFactorData({...factorData, target: e.target.value})} style={{ width: '100%' }}>
                                <option value="ALL">Todos os Insumos</option>
                                <option value="MATERIAL">Apenas Materiais (Ex: Perda)</option>
                                <option value="MAO_DE_OBRA">Apenas Mão de Obra</option>
                                <option value="EQUIPAMENTO">Apenas Equipamentos</option>
                            </select>
                        </div>

                        <div>
                            <label style={{ fontSize: '0.75rem', fontWeight: 600, display: 'block', marginBottom: 4 }}>Fator de Multiplicação dos Coeficientes</label>
                            <input autoFocus type="text" className="form-input" value={factorData.value} onChange={e => setFactorData({...factorData, value: e.target.value})} placeholder="Ex: 6 / 300" style={{ width: '100%' }} />
                            <div style={{ fontSize: '0.65rem', color: 'var(--color-text-secondary)', marginTop: 4 }}>Ex: 1.05 = Adicionar 5% de perda | Ex: 6 / 300 = Diluição</div>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                            <button className="btn" onClick={() => setShowFactorModal(false)}>Cancelar</button>
                            <button className="btn btn-primary" onClick={handleApplyFactor}>Aplicar Fator</button>
                        </div>
                    </div>
                </div>
            )}

            {showDiscountModal && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 100000, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ background: 'var(--color-bg-surface)', padding: 24, borderRadius: 12, width: 350, display: 'flex', flexDirection: 'column', gap: 16 }}>
                        <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}><Percent size={18} /> Aplicar Desconto</h3>
                        
                        <div>
                            <label style={{ fontSize: '0.75rem', fontWeight: 600, display: 'block', marginBottom: 4 }}>Alvo do Desconto</label>
                            <select className="form-select" value={discountData.target} onChange={e => setDiscountData({...discountData, target: e.target.value})} style={{ width: '100%' }}>
                                <option value="ALL">Todos os Insumos</option>
                                <option value="MATERIAL">Apenas Materiais</option>
                                <option value="MAO_DE_OBRA">Apenas Mão de Obra</option>
                                <option value="EQUIPAMENTO">Apenas Equipamentos</option>
                            </select>
                        </div>

                        <div>
                            <label style={{ fontSize: '0.75rem', fontWeight: 600, display: 'block', marginBottom: 4 }}>Porcentagem de Desconto (%)</label>
                            <input autoFocus type="number" step="1" className="form-input" value={discountData.value} onChange={e => setDiscountData({...discountData, value: e.target.value})} style={{ width: '100%' }} />
                            <div style={{ fontSize: '0.65rem', color: 'var(--color-text-secondary)', marginTop: 4 }}>Este valor reduzirá o preço unitário do insumo. Ex: 10 = -10%.</div>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                            <button className="btn" onClick={() => setShowDiscountModal(false)}>Cancelar</button>
                            <button className="btn btn-primary" onClick={handleApplyDiscount}>Aplicar Desconto</button>
                        </div>
                    </div>
                </div>
            )}

            {showRateioModal && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 100000, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ background: 'var(--color-bg-surface)', padding: 24, borderRadius: 12, width: 350, display: 'flex', flexDirection: 'column', gap: 16 }}>
                        <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}><Divide size={18} /> Rateio para Fração (%)</h3>
                        
                        <div style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', lineHeight: 1.4 }}>
                            Use para diluir o valor da composição de acordo com um prazo e representá-la como porcentagem (ex: Administração Local % do orçamento total).
                        </div>

                        <div>
                            <label style={{ fontSize: '0.75rem', fontWeight: 600, display: 'block', marginBottom: 4 }}>Prazo em Meses (Multiplicador)</label>
                            <input autoFocus type="text" className="form-input" value={rateioData.prazo} onChange={e => setRateioData({...rateioData, prazo: e.target.value})} style={{ width: '100%' }} />
                        </div>

                        <div>
                            <label style={{ fontSize: '0.75rem', fontWeight: 600, display: 'block', marginBottom: 4 }}>Divisor da Fração (ex: 100 para %)</label>
                            <input type="text" className="form-input" value={rateioData.fracao} onChange={e => setRateioData({...rateioData, fracao: e.target.value})} style={{ width: '100%' }} />
                            <div style={{ fontSize: '0.65rem', color: 'var(--color-text-secondary)', marginTop: 4 }}>Os coeficientes de todos os insumos serão multiplicados por: (Prazo / Divisor).</div>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                            <button className="btn" onClick={() => setShowRateioModal(false)}>Cancelar</button>
                            <button className="btn btn-primary" onClick={handleApplyRateio}>Aplicar Rateio</button>
                        </div>
                    </div>
                </div>
            )}
            {showNewGroupModal && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 100000, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ background: 'var(--color-bg-surface)', padding: 24, borderRadius: 12, width: 380, display: 'flex', flexDirection: 'column', gap: 16 }}>
                        <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}><ListTree size={18} /> Novo Grupo de Insumos</h3>
                        
                        <div style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', lineHeight: 1.4 }}>
                            Crie um novo grupo/seção para organizar insumos na composição. Ex: "Transportes", "Encargos Complementares", etc.
                        </div>
 
                        <div>
                            <label style={{ fontSize: '0.75rem', fontWeight: 600, display: 'block', marginBottom: 4 }}>Nome do Grupo</label>
                            <input autoFocus type="text" className="form-input" value={newGroupName} onChange={e => setNewGroupName(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter' && newGroupName.trim()) {
                                    const groupKey = `CUSTOM_${newGroupName.trim().toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '')}`;
                                    if (!data) return;
                                    const updated = { ...data, groups: { ...data.groups } };
                                    if (!updated.groups[groupKey]) updated.groups[groupKey] = [];
                                    setCustomGroupLabels(prev => ({ ...prev, [groupKey]: newGroupName.trim() }));
                                    setExpandedGroups(prev => new Set([...prev, groupKey]));
                                    setData(updated);
                                    setHasChanges(true);
                                    setShowNewGroupModal(false);
                                }}}
                                placeholder="Ex: Transportes" style={{ width: '100%' }} />
                        </div>
 
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                            <button className="btn" onClick={() => setShowNewGroupModal(false)}>Cancelar</button>
                            <button className="btn btn-primary" disabled={!newGroupName.trim()} onClick={() => {
                                const groupKey = `CUSTOM_${newGroupName.trim().toUpperCase().replace(/\s+/g, '_').replace(/[^A-Z0-9_]/g, '')}`;
                                if (!data) return;
                                const updated = { ...data, groups: { ...data.groups } };
                                if (!updated.groups[groupKey]) updated.groups[groupKey] = [];
                                setCustomGroupLabels(prev => ({ ...prev, [groupKey]: newGroupName.trim() }));
                                setExpandedGroups(prev => new Set([...prev, groupKey]));
                                setData(updated);
                                setHasChanges(true);
                                setShowNewGroupModal(false);
                            }}>Criar Grupo</button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );

    return createPortal(editor, document.body);
}
