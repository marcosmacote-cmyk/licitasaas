/**
 * CompositionEditor — Editor full-page de composições com CASCADE COMPLETO.
 * 
 * Fluxo de cascade:
 *   Edita preço/coef do insumo → recalcula subtotais do grupo
 *   → recalcula total da composição → callback onUpdateItem(unitCost)
 *   → planilha recalcula BDI + total → Hub reflete novos preços
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, X, Layers, Package, HardHat, Wrench, ChevronDown, Loader2, AlertCircle, Pencil, Check, ArrowDownUp, Download, FileText, Save, PlusCircle, Percent, Calculator, Wand2, Divide, FolderOpen, Folder } from 'lucide-react';
import { exportCompositionExcel, exportCompositionPdf } from './exportEngine';
import { applyPrecision } from './precisionEngine';
import { SmartCpuDropzone } from './SmartCpuDropzone';

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

interface Props {
    items: EngItem[];
    initialIndex: number;
    onClose: () => void;
    onUpdateItem: (itemId: string, updates: Partial<EngItem>) => void;
    engineeringConfig?: any;
}

const GROUP_META: Record<string, { label: string; icon: any; color: string }> = {
    MATERIAL: { label: 'Materiais', icon: Package, color: '#2563eb' },
    MAO_DE_OBRA: { label: 'Mão de Obra', icon: HardHat, color: '#16a34a' },
    EQUIPAMENTO: { label: 'Equipamentos', icon: Wrench, color: '#d97706' },
    SERVICO: { label: 'Serviços', icon: Wrench, color: '#0ea5e9' },
    AUXILIAR: { label: 'Composições Auxiliares', icon: Layers, color: '#7c3aed' },
    OBSERVACAO: { label: 'Observações e Textos', icon: FileText, color: '#64748b' },
};

const asNumber = (value: any) => Number.isFinite(Number(value)) ? Number(value) : 0;

const isGrouperType = (type?: string) => type === 'ETAPA' || type === 'SUBETAPA';

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
    const globalDate: string = config?.dataBase || '';
    const perBaseDates: Record<string, string> = config?.dataBases || {};

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

        const targetDate = perBaseDates[baseName] || globalDate;
        let targetMonth = 0, targetYear = 0;
        if (targetDate) {
            const [y, m] = targetDate.split('-').map(Number);
            if (y && m) { targetYear = y; targetMonth = m; }
        }

        const candidates = allBases.filter((b: any) => {
            if (!b.name.toUpperCase().includes(upperName)) return false;
            if (uf && b.uf && b.uf.toUpperCase() !== uf) return false;
            if (targetYear && targetMonth) {
                if (b.referenceYear !== targetYear || b.referenceMonth !== targetMonth) return false;
            }
            return true;
        });

        if (candidates.length > 0) result.push(...candidates);
        else {
            const datePart = targetYear && targetMonth ? ` ${String(targetMonth).padStart(2, '0')}/${targetYear}` : '';
            const ufPart = uf ? ` ${uf}` : '';
            warnings.push(`Base "${baseName}${ufPart}${datePart}" não encontrada. Verifique se a base foi importada.`);
        }
    }

    result.sort((a: any, b: any) => {
        const aHasData = ((a.itemCount || 0) + (a.compositionCount || 0)) > 0 ? 1 : 0;
        const bHasData = ((b.itemCount || 0) + (b.compositionCount || 0)) > 0 ? 1 : 0;
        if (bHasData !== aHasData) return bHasData - aHasData;
        return (b.referenceYear || 0) - (a.referenceYear || 0) || (b.referenceMonth || 0) - (a.referenceMonth || 0);
    });

    return { filtered: result, warnings };
}

const getLineCoefficient = (ci: any) => asNumber(ci?.coefficient);

const getLineUnitPrice = (ci: any) => {
    const itemData = ci?.item || ci?.auxiliaryComposition;
    return asNumber(itemData?.price ?? itemData?.totalPrice);
};

const getLineSubtotal = (ci: any, precision?: any) => {
    const itemData = ci?.item || ci?.auxiliaryComposition;
    if (itemData?.isObservation) return 0;
    const computed = getLineCoefficient(ci) * getLineUnitPrice(ci);
    if (computed > 0 || getLineUnitPrice(ci) > 0) {
        return applyPrecision(computed, { precision });
    }
    return asNumber(ci?.price);
};

const normalizeCompositionMath = (raw: any, precision?: any) => {
    if (!raw) return raw;
    const groups = { ...(raw.groups || {}) };
    let total = 0;

    for (const groupKey of Object.keys(groups)) {
        groups[groupKey] = (groups[groupKey] || []).map((ci: any) => {
            const subtotal = getLineSubtotal(ci, precision);
            total += subtotal;
            return { ...ci, price: subtotal };
        });
    }

    return {
        ...raw,
        groups,
        items: Object.values(groups).flat(),
        totalDirect: applyPrecision(total, { precision }),
        totalPrice: applyPrecision(total, { precision }),
    };
};

const sumCompositionGroups = (groups: Record<string, any[]> | undefined, precision?: any) => {
    let total = 0;
    for (const groupItems of Object.values(groups || {})) {
        for (const ci of groupItems || []) total += getLineSubtotal(ci, precision);
    }
    return applyPrecision(total, { precision });
};

export function CompositionEditor({ items, initialIndex, onClose, onUpdateItem, engineeringConfig }: Props) {
    const [currentIndex, setCurrentIndex] = useState(initialIndex);
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['MATERIAL', 'MAO_DE_OBRA', 'EQUIPAMENTO', 'SERVICO', 'AUXILIAR']));
    const [editingField, setEditingField] = useState<{ id: string; field: 'coef' | 'price' } | null>(null);
    const [editValue, setEditValue] = useState('');
    const [hasChanges, setHasChanges] = useState(false);
    const [isSavingToBase, setIsSavingToBase] = useState(false);
    const [isExtractingAi, setIsExtractingAi] = useState(false);

    // Search inside editor
    const [showSearch, setShowSearch] = useState(false);
    const [searchType, setSearchType] = useState<'item' | 'composition'>('item');
    const [bases, setBases] = useState<any[]>([]);
    const [selectedBaseId, setSelectedBaseId] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<any[]>([]);

    // ── Phase 4: Free Mode States ──
    const [showFreeItemModal, setShowFreeItemModal] = useState(false);
    const [freeItemData, setFreeItemData] = useState({ description: '', unit: 'UN', coefficient: '1', price: '0', type: 'MATERIAL' });
    
    const [showFactorModal, setShowFactorModal] = useState(false);
    const [factorData, setFactorData] = useState({ value: '1.05', target: 'ALL' });
    
    const [showDiscountModal, setShowDiscountModal] = useState(false);
    const [discountData, setDiscountData] = useState({ value: '10', target: 'ALL' });

    const [showRateioModal, setShowRateioModal] = useState(false);
    const [rateioData, setRateioData] = useState({ prazo: '2', fracao: '100' });

    const [isSearching, setIsSearching] = useState(false);

    // Drill-down stack for auxiliary compositions
    const [drillStack, setDrillStack] = useState<{ code: string; description: string }[]>([]);
    // Grouper editing states
    const [grouperDesc, setGrouperDesc] = useState('');
    const [grouperFactor, setGrouperFactor] = useState('1');
    const [grouperFactorSaved, setGrouperFactorSaved] = useState(false);

    // Load bases once when opening search — filtered by Step 1 config
    useEffect(() => {
        if (showSearch && bases.length === 0) {
            fetch('/api/engineering/bases', { headers: hdrs() })
                .then(r => r.json()).then(data => {
                    if (Array.isArray(data)) {
                        setBases(data);
                        // Auto-select best matching base from config
                        const filtered = filterBases(data, engineeringConfig);
                        if (filtered.length > 0) setSelectedBaseId(filtered[0].id);
                        else if (data.length > 0) setSelectedBaseId(data[0].id);
                    }
                }).catch(console.error);
        }
    }, [showSearch, bases.length, engineeringConfig]);

    const handleSearch = async () => {
        if (!selectedBaseId || !searchQuery) return;
        setIsSearching(true);
        try {
            let url = '';
            if (searchType === 'item') {
                const params = new URLSearchParams({ q: searchQuery });
                if (engineeringConfig?.regimeOneracao) params.append('regime', engineeringConfig.regimeOneracao);
                const selectedBase = bases.find(b => b.id === selectedBaseId);
                const effectiveDate = (selectedBase && engineeringConfig?.dataBases?.[selectedBase.name]) || engineeringConfig?.dataBase;
                if (effectiveDate) params.append('dataBase', effectiveDate);
                url = `/api/engineering/bases/${selectedBaseId}/items?${params.toString()}`;
            } else {
                url = `/api/engineering/compositions?databaseId=${selectedBaseId}&q=${encodeURIComponent(searchQuery)}`;
            }
            const res = await fetch(url, { headers: hdrs() });
            const d = await res.json();
            setSearchResults(searchType === 'item' ? (d.items || []) : (Array.isArray(d) ? d : []));
        } catch { } finally { setIsSearching(false); }
    };

    const addFromSearch = (dbItem: any) => {
        if (!data) return;
        
        let typeKey = 'MATERIAL';
        let newItem: any = null;

        if (searchType === 'composition') {
            typeKey = 'AUXILIAR';
            newItem = {
                id: `temp-${Date.now()}`,
                coefficient: 1,
                price: Number(dbItem.totalPrice) || 0,
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
                id: `temp-${Date.now()}`,
                coefficient: 1,
                price: Number(dbItem.price) || 0,
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

        const updated = { ...data, groups: { ...data.groups } };
        if (!updated.groups[typeKey]) updated.groups[typeKey] = [];
        updated.groups[typeKey] = [...updated.groups[typeKey], newItem];

        updated.totalPrice = sumCompositionGroups(updated.groups, engineeringConfig?.precision);
        updated.totalDirect = updated.totalPrice;

        setData(updated);
        setHasChanges(true);

        if (onUpdateItem && currentItem) {
            onUpdateItem(currentItem.id, { unitCost: updated.totalPrice });
        }

        setShowSearch(false);
        setSearchQuery('');
        setSearchResults([]);
    };

    const currentItem = items[currentIndex];
    const hasPrev = currentIndex > 0;
    const hasNext = currentIndex < items.length - 1;

    const loadComposition = useCallback(async (code: string) => {
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
        try {
            const params = new URLSearchParams();
            const matchedDatabaseId = currentItem?.priceAudit?.matchedDatabaseId;
            if (matchedDatabaseId) params.set('databaseId', matchedDatabaseId);
            if (currentItem?.sourceName) params.set('sourceName', currentItem.sourceName);
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

            setData(normalizeCompositionMath(d, engineeringConfig?.precision));
        } catch {
            setError('not_found');
        }
        setLoading(false);
    }, [currentItem?.priceAudit?.matchedDatabaseId, currentItem?.sourceName, currentItem?.insumos, engineeringConfig?.precision]);

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
                setDrillStack([]);
                loadComposition(currentItem.code);
            }
        }
    }, [currentItem?.code, currentItem?.type, loadComposition]);

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
            if (e.key === 'Escape') onClose();
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
            formData.append('code', currentItem.code);
            formData.append('description', currentItem.description);
            formData.append('unit', currentItem.unit);

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
            
            setData(updated);
            setError('');
            setHasChanges(true);
            
            if (onUpdateItem && currentItem) {
                onUpdateItem(currentItem.id, { unitCost: updated.totalPrice });
            }

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
        if (!editingField || !data) {
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
                    const newCoef = newVal;
                    const unitPrice = getLineUnitPrice(ci);
                    return {
                        ...ci,
                        coefficient: newCoef,
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
        if (onUpdateItem && currentItem) {
            onUpdateItem(currentItem.id, { unitCost: updated.totalPrice });
        }

        setEditingField(null);
    }, [editingField, editValue, data, currentItem, onUpdateItem]);

    const startEdit = (id: string, field: 'coef' | 'price', currentValue: number) => {
        setEditingField({ id, field });
        setEditValue(String(currentValue));
    };

    const saveToBase = async () => {
        if (!data || !data.id) return;
        setIsSavingToBase(true);
        try {
            let targetId = data.id;
            
            // If it's an official composition, create a copy in PROPRIA first
            if (data.database?.name !== 'PROPRIA') {
                const resCreate = await fetch('/api/engineering/compositions', {
                    method: 'POST',
                    headers: hdrs(),
                    body: JSON.stringify({
                        code: data.code,
                        description: data.description,
                        unit: data.unit,
                    })
                });
                
                if (!resCreate.ok) {
                    const err = await resCreate.json();
                    if (!err.error?.includes('Já existe')) {
                        throw new Error('Erro ao criar cópia na base PRÓPRIA');
                    }
                    // Se já existe, vamos buscar a ID da que já existe
                    const resSearch = await fetch(`/api/engineering/compositions/${encodeURIComponent(data.code)}`, { headers: hdrs() });
                    const existingData = await resSearch.json();
                    targetId = existingData.id;
                } else {
                    const created = await resCreate.json();
                    targetId = created.composition.id;
                }
            }

            const res = await fetch(`/api/engineering/compositions/${targetId}`, {
                method: 'PUT',
                headers: hdrs(),
                body: JSON.stringify({ composition: data })
            });
            if (!res.ok) throw new Error('Erro ao salvar composição na base');
            await res.json();
            alert('Composição atualizada com sucesso na base PRÓPRIA!');
            setHasChanges(false);
            
            if (data.database?.name !== 'PROPRIA') {
                await loadComposition(data.code);
            }
        } catch (e: any) {
            alert(e.message || 'Erro de rede ao salvar');
        } finally {
            setIsSavingToBase(false);
        }
    };

    const handleCreateComposition = async () => {
        if (!currentItem) return;
        setLoading(true);
        setError('');
        try {
            // SEC-02 FIX: Backend extracts tenantId from req.user (auth middleware)
            const res = await fetch('/api/engineering/compositions', {
                method: 'POST',
                headers: hdrs(),
                body: JSON.stringify({
                    code: currentItem.code,
                    description: currentItem.description,
                    unit: currentItem.unit,
                })
            });
            if (!res.ok) throw new Error('Erro ao criar composição');
            await loadComposition(currentItem.code); // Reloads the newly created empty composition
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
        
        const newItem = {
            id: `temp-${Date.now()}`,
            coefficient: coefNum,
            price: isObs ? 0 : applyPrecision(coefNum * priceNum, { precision: engineeringConfig?.precision }),
            item: !isAux ? {
                id: `new-${Date.now()}`,
                code: isObs ? 'OBS' : 'LIVRE',
                description: freeItemData.description || 'Novo Insumo',
                unit: isObs ? '' : freeItemData.unit,
                type: typeKey,
                price: priceNum,
                isNew: true,
                isObservation: isObs
            } : undefined,
            auxiliaryComposition: isAux ? {
                id: `new-aux-${Date.now()}`,
                code: 'LIVRE',
                description: freeItemData.description || 'Nova Composição Auxiliar',
                unit: freeItemData.unit,
                totalPrice: priceNum,
                isNew: true
            } : undefined
        };

        const updated = { ...data, groups: { ...data.groups } };
        const targetGroup = isObs ? 'SERVICO' : typeKey; 
        if (!updated.groups[targetGroup]) updated.groups[targetGroup] = [];
        updated.groups[targetGroup] = [...updated.groups[targetGroup], newItem];

        updated.totalPrice = sumCompositionGroups(updated.groups, engineeringConfig?.precision);
        updated.totalDirect = updated.totalPrice;

        setData(updated);
        setHasChanges(true);
        if (onUpdateItem && currentItem) onUpdateItem(currentItem.id, { unitCost: updated.totalPrice });
        
        setShowFreeItemModal(false);
        setFreeItemData({ description: '', unit: 'UN', coefficient: '1', price: '0', type: 'MATERIAL' });
    };

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
        if (onUpdateItem && currentItem) onUpdateItem(currentItem.id, { unitCost: updated.totalPrice });
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
        if (onUpdateItem && currentItem) onUpdateItem(currentItem.id, { unitCost: updated.totalPrice });
        setShowDiscountModal(false);
    };

    const handleApplyRateio = () => {
        if (!data) return;
        const prazoNum = evaluateMath(rateioData.prazo);
        const fracaoNum = evaluateMath(rateioData.fracao);
        if (isNaN(prazoNum) || isNaN(fracaoNum) || fracaoNum === 0) return;
        
        const factor = prazoNum / fracaoNum;

        const updated = { ...data, groups: { ...data.groups } };
        
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
            id: `temp-${Date.now()}`,
            coefficient: 0,
            price: 0,
            item: {
                id: `new-${Date.now()}`,
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
        if (onUpdateItem && currentItem) onUpdateItem(currentItem.id, { unitCost: updated.totalPrice });
        setShowRateioModal(false);
    };

    // Computed total from analytical lines. The Hub composition is the source of truth;
    // edital extraction remains only as comparison/audit evidence.
    const compositionTotal = data ? sumCompositionGroups(data.groups, engineeringConfig?.precision) : 0;
    const compositionItemsCount = data ? Object.values(data.groups || {}).reduce((acc: number, group: any) => acc + (Array.isArray(group) ? group.length : 0), 0) : 0;

    if (!currentItem) return null;

    const editalUnitCost = asNumber(currentItem.officialUnitCost || currentItem.unitCost);
    const priceDelta = editalUnitCost - compositionTotal;
    const priceDeltaPct = compositionTotal > 0 ? (priceDelta / compositionTotal) * 100 : 0;
    const hasPriceDivergence = compositionTotal > 0 && Math.abs(priceDelta) > 0.01;
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
                            {isGrp ? <>{item.type === 'ETAPA' ? <FolderOpen size={12} style={{display:'inline',verticalAlign:-2,marginRight:3}} /> : <Folder size={12} style={{display:'inline',verticalAlign:-2,marginRight:3}} />}{item.itemNumber}</> : `${item.itemNumber} · ${item.code || 'N/A'}`}
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
                        <h3 style={{ margin: '4px 0 0', fontSize: '1rem', fontWeight: 700 }}>{currentItem.description}</h3>
                        {!isGrouperType(currentItem.type) && (
                            <span style={{ fontSize: '0.78rem', color: 'var(--color-text-tertiary)' }}>
                                Código: <strong>{currentItem.code}</strong> · {currentItem.sourceName}
                                {hasChanges && <span style={{ marginLeft: 8, color: '#d97706', fontWeight: 700 }}>● Modificado</span>}
                            </span>
                        )}
                        {/* Drill-down breadcrumb */}
                        {drillStack.length > 0 && (
                            <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center', fontSize: '0.72rem', color: 'var(--color-text-tertiary)' }}>
                                <button onClick={() => { setDrillStack([]); loadComposition(currentItem.code); }}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-primary)', fontWeight: 600, padding: 0 }}>
                                    {currentItem.code}
                                </button>
                                {drillStack.map((level, i) => (
                                    <span key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                        <ChevronRight size={12} />
                                        {i < drillStack.length - 1 ? (
                                            <button onClick={() => {
                                                const newStack = drillStack.slice(0, i + 1);
                                                setDrillStack(newStack);
                                                loadComposition(newStack[newStack.length - 1].code);
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
                            <button onClick={saveToBase} disabled={isSavingToBase} title={data.database?.name === 'PROPRIA' ? "Atualizar a base de dados com as modificações desta composição" : "Salvar alterações como uma nova Composição Própria"}
                                style={{ padding: '6px 12px', borderRadius: 'var(--radius-sm)', border: 'none', background: 'var(--color-primary)', color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.72rem', fontWeight: 600 }}>
                                {isSavingToBase ? <Loader2 size={13} className="spin" /> : <Save size={13} />} 
                                {data.database?.name === 'PROPRIA' ? 'Salvar na Base' : 'Salvar como Própria'}
                            </button>
                        )}
                        {data && !isGrouperType(currentItem.type) && (
                            <>
                                <button onClick={() => exportCompositionExcel(currentItem.code, currentItem.description, data, engineeringConfig)}
                                    title="Exportar Excel" style={{ padding: 6, borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', background: 'var(--color-bg-surface)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.72rem' }}>
                                    <Download size={13} /> Excel
                                </button>
                                <button onClick={() => exportCompositionPdf(currentItem.code, currentItem.description, data, engineeringConfig)}
                                    title="Exportar PDF" style={{ padding: 6, borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', background: 'var(--color-bg-surface)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.72rem' }}>
                                    <FileText size={13} /> PDF
                                </button>
                            </>
                        )}
                        <button onClick={onClose} title="Fechar (Esc)"
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
                        display: 'flex', gap: 12, alignItems: 'center'
                    }}>
                        <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--color-text-tertiary)', marginRight: 4 }}>MÓDULO LIVRE:</span>
                        
                        <button onClick={() => setShowFreeItemModal(true)} title="Adicionar um insumo ou serviço avulso sem buscar na base"
                            style={{ padding: '5px 10px', borderRadius: 4, border: '1px dashed var(--color-border)', background: 'var(--color-bg-base)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.72rem', fontWeight: 600 }}>
                            <PlusCircle size={13} color="var(--color-text-secondary)" /> Insumo Livre
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
                        <button onClick={() => { setFreeItemData(prev => ({ ...prev, description: 'Verba / Custo Indireto', unit: 'VB', type: 'SERVICO' })); setShowFreeItemModal(true); }} title="Adicionar linha de verba / custo indireto"
                            style={{ padding: '5px 10px', borderRadius: 4, border: '1px solid var(--color-primary)', background: 'transparent', color: 'var(--color-primary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.72rem', fontWeight: 600 }}>
                            <Wand2 size={13} /> Inserir Verba
                        </button>
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
                                O código <strong>{currentItem.code}</strong> não foi encontrado nas bases oficiais e nem no seu banco de dados próprio.
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

                    {data && !error && data.items?.length === 0 && (
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

                    {data && !error && data.items?.length > 0 && (
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
                                            onUpdateItem(currentItem.id, { unitCost: compositionTotal });
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
                            {Object.entries(GROUP_META).map(([groupKey, meta]) => {
                                const groupItems = data.groups?.[groupKey] || [];
                                if (groupItems.length === 0) return null;
                                const Icon = meta.icon;
                                const groupTotal = groupItems.reduce((s: number, ci: any) => s + getLineSubtotal(ci, engineeringConfig?.precision), 0);
                                const isExpanded = expandedGroups.has(groupKey);

                                return (
                                    <div key={groupKey} style={{ border: `1px solid ${meta.color}25`, borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
                                        {/* Group header */}
                                        <div onClick={() => toggleGroup(groupKey)}
                                            style={{
                                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                                padding: '12px 20px', background: `${meta.color}06`, cursor: 'pointer',
                                                borderBottom: isExpanded ? `1px solid ${meta.color}15` : 'none',
                                            }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                                {isExpanded ? <ChevronDown size={14} color={meta.color} /> : <ChevronRight size={14} color={meta.color} />}
                                                <Icon size={16} color={meta.color} />
                                                <span style={{ fontWeight: 700, fontSize: '0.88rem', color: meta.color }}>{meta.label}</span>
                                                <span style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)', fontWeight: 600 }}>({groupItems.length})</span>
                                            </div>
                                            <span style={{ fontWeight: 800, fontSize: '0.9rem', color: meta.color }}>{fmt(groupTotal)}</span>
                                        </div>

                                        {isExpanded && groupItems.length > 0 && (
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
                                                    const isEditingCoef = editingField?.id === ci.id && editingField?.field === 'coef';
                                                    const isEditingPrice = editingField?.id === ci.id && editingField?.field === 'price';

                                                    return (
                                                        <div key={ci.id || idx} style={{
                                                            display: 'grid', gridTemplateColumns: '40px 2.5fr 60px 90px 100px 90px 30px',
                                                            gap: 8, padding: '8px 20px', alignItems: 'center',
                                                            borderBottom: '1px solid var(--color-border)',
                                                            background: itemData?.isObservation ? 'rgba(0,0,0,0.03)' : (idx % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.01)'),
                                                        }}>
                                                            <span style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)', fontWeight: 600 }}>{idx + 1}</span>
                                                            <div style={itemData?.isObservation ? { gridColumn: '2 / 6', fontStyle: 'italic', color: 'var(--color-text-secondary)', fontSize: '0.75rem' } : {}}>
                                                                {!itemData?.isObservation ? (
                                                                    <>
                                                                        <div style={{ fontSize: '0.8rem', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                                                                            {itemData?.description || '—'}
                                                                            {/* Drill-down button for auxiliary compositions */}
                                                                            {ci.auxiliaryComposition && itemData?.code && !itemData?.isNew && (
                                                                                <button
                                                                                    onClick={(e) => {
                                                                                        e.stopPropagation();
                                                                                        setDrillStack(prev => [...prev, { code: itemData.code, description: itemData.description }]);
                                                                                        loadComposition(itemData.code);
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
                                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                                                                            {itemData?.code && (
                                                                                <span style={{ fontSize: '0.65rem', color: meta.color, fontWeight: 600 }}>{itemData.code}</span>
                                                                            )}
                                                                            {itemData?.isNew && (
                                                                                <span style={{ fontSize: '0.6rem', background: '#f9731615', color: '#ea580c', padding: '1px 4px', borderRadius: 4, fontWeight: 700 }}>Novo Insumo Próprio</span>
                                                                            )}
                                                                        </div>
                                                                    </>
                                                                ) : (
                                                                    <div>{itemData?.description}</div>
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
                                                                            <span style={{ fontSize: '0.78rem', fontFamily: 'monospace' }}>{fmtCoef(ci.coefficient)}</span>
                                                                            <button onClick={() => startEdit(ci.id, 'coef', ci.coefficient)}
                                                                                style={{ padding: 2, border: 'none', background: 'none', cursor: 'pointer', opacity: 0.3 }}
                                                                                title="Editar coeficiente">
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
                                                                {!itemData?.isObservation && fmt(lineSubtotal)}
                                                            </span>
                                                            
                                                            <div style={{ textAlign: 'center' }}>
                                                                <button onClick={() => {
                                                                    const updated = { ...data, groups: { ...data.groups } };
                                                                    updated.groups[groupKey] = updated.groups[groupKey].filter((i: any) => i.id !== ci.id);
                                                                    
                                                                    updated.totalPrice = sumCompositionGroups(updated.groups, engineeringConfig?.precision);
                                                                    updated.totalDirect = updated.totalPrice;
                                                                    
                                                                    setData(updated);
                                                                    setHasChanges(true);
                                                                    if (onUpdateItem && currentItem) onUpdateItem(currentItem.id, { unitCost: updated.totalPrice });
                                                                }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-danger)', opacity: 0.5 }}>
                                                                    <X size={14} />
                                                                </button>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </>
                                        )}
                                    </div>
                                );
                            })}
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
                        {/* Observação da composição (para relatórios) */}
                        <div style={{ marginTop: 10, borderTop: '1px solid var(--color-border)', paddingTop: 8 }}>
                            <label style={{ fontSize: '0.68rem', fontWeight: 600, color: 'var(--color-text-tertiary)', display: 'block', marginBottom: 3 }}>
                                Observação (aparece nos relatórios PDF/XLS)
                            </label>
                            <textarea
                                value={engineeringConfig?.reportConfig?.compositionNotes?.[currentItem.code] || ''}
                                onChange={e => {
                                    if (!onUpdateItem || !engineeringConfig) return;
                                    const notes = { ...(engineeringConfig.reportConfig?.compositionNotes || {}), [currentItem.code]: e.target.value };
                                    if (!e.target.value) delete notes[currentItem.code];
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
                    </div>
                )}
            </div>
            {/* Search Modal */}
            {showSearch && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 100000, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ background: 'var(--color-bg-surface)', padding: 24, borderRadius: 12, width: 800, maxWidth: '90vw', maxHeight: '80vh', display: 'flex', flexDirection: 'column', gap: 16, boxShadow: '0 10px 25px rgba(0,0,0,0.2)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h3 style={{ margin: 0 }}>{searchType === 'item' ? 'Buscar Insumo' : 'Buscar Composição Auxiliar'}</h3>
                            <button onClick={() => setShowSearch(false)} style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}><X size={20} /></button>
                        </div>
                        {(() => {
                            const { filtered, warnings } = filterBasesWithWarnings(bases, engineeringConfig);
                            return (
                                <>
                                    <div style={{ display: 'flex', gap: 8 }}>
                                        <select className="form-select" value={selectedBaseId} onChange={e => setSelectedBaseId(e.target.value)} style={{ width: 200 }}>
                                            {filtered.length === 0
                                                ? <option value="">Nenhuma base configurada</option>
                                                : filtered.map(b => {
                                                    const ref = b.referenceMonth && b.referenceYear ? `${String(b.referenceMonth).padStart(2, '0')}/${b.referenceYear}` : (b.version || 'N/I');
                                                    const totalRecords = (b.itemCount || 0) + (b.compositionCount || 0);
                                                    return <option key={b.id} value={b.id}>{b.name} {b.uf || ''} · {ref} · {totalRecords.toLocaleString('pt-BR')} registros</option>;
                                                })
                                            }
                                        </select>
                                        <input type="text" className="form-input" placeholder="Buscar por código ou descrição..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSearch()} style={{ flex: 1 }} />
                                        <button className="btn btn-primary" onClick={handleSearch} disabled={isSearching}>{isSearching ? 'Buscando...' : 'Buscar'}</button>
                                    </div>
                                    {warnings.length > 0 && (
                                        <div style={{ padding: '8px 12px', borderRadius: 8, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                                            <AlertCircle size={16} color="#d97706" style={{ flexShrink: 0, marginTop: 2 }} />
                                            <div style={{ fontSize: '0.78rem', color: '#92400e' }}>
                                                {warnings.map((w, i) => <div key={i}>{w}</div>)}
                                            </div>
                                        </div>
                                    )}
                                </>
                            );
                        })()}
                        <div style={{ flex: 1, overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: 8 }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                                <thead><tr style={{ background: 'var(--color-bg-base)' }}>
                                    {['Código','Descrição','Unid.','Preço',''].map((h,i) => <th key={i} style={{ padding: 8, textAlign: i >= 3 ? 'right' : 'left' }}>{h}</th>)}
                                </tr></thead>
                                <tbody>
                                    {searchResults.map(r => (
                                        <tr key={r.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                            <td style={{ padding: 8 }}><strong>{r.code}</strong></td>
                                            <td style={{ padding: 8 }}>{r.description}</td>
                                            <td style={{ padding: 8, textAlign: 'center' }}>{r.unit}</td>
                                            <td style={{ padding: 8, textAlign: 'right', fontWeight: 600 }}>{fmt(Number(searchType === 'composition' ? r.totalPrice : r.price) || 0)}</td>
                                            <td style={{ padding: 8, textAlign: 'center' }}>
                                                <button className="btn btn-primary" style={{ padding: '4px 8px', fontSize: '0.7rem' }} onClick={() => addFromSearch(r)}>Adicionar</button>
                                            </td>
                                        </tr>
                                    ))}
                                    {searchResults.length === 0 && <tr><td colSpan={5} style={{ padding: 16, textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                                        {searchQuery ? 'Nenhum resultado encontrado.' : 'Digite uma busca para começar.'}
                                    </td></tr>}
                                </tbody>
                            </table>
                        </div>
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
                                <label style={{ fontSize: '0.75rem', fontWeight: 600, display: 'block', marginBottom: 4 }}>Coeficiente</label>
                                <input type="text" className="form-input" value={freeItemData.coefficient} onChange={e => setFreeItemData({...freeItemData, coefficient: e.target.value})} placeholder="Ex: 1 * 32" style={{ width: '100%' }} />
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

        </div>
    );

    return createPortal(editor, document.body);
}
