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
import { ChevronLeft, ChevronRight, X, Layers, Package, HardHat, Wrench, ChevronDown, Loader2, AlertCircle, Pencil, Check, ArrowDownUp, Download, FileText, Save } from 'lucide-react';
import { exportCompositionExcel, exportCompositionPdf } from './exportEngine';
import { applyPrecision } from './precisionEngine';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtCoef = (v: number) => v.toFixed(4);
const token = () => localStorage.getItem('token') || '';
const hdrs = () => ({ 'Authorization': `Bearer ${token()}`, 'Content-Type': 'application/json' });

interface EngItem {
    id: string; itemNumber: string; code: string; sourceName: string;
    description: string; unit: string; quantity: number;
    unitCost: number; unitPrice: number; totalPrice: number;
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
    AUXILIAR: { label: 'Composições Auxiliares', icon: Layers, color: '#7c3aed' },
};

export function CompositionEditor({ items, initialIndex, onClose, onUpdateItem, engineeringConfig }: Props) {
    const [currentIndex, setCurrentIndex] = useState(initialIndex);
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['MATERIAL', 'MAO_DE_OBRA', 'EQUIPAMENTO', 'AUXILIAR']));
    const [editingField, setEditingField] = useState<{ id: string; field: 'coef' | 'price' } | null>(null);
    const [editValue, setEditValue] = useState('');
    const [hasChanges, setHasChanges] = useState(false);
    const [isSavingToBase, setIsSavingToBase] = useState(false);

    // Search inside editor
    const [showSearch, setShowSearch] = useState(false);
    const [searchType, setSearchType] = useState<'item' | 'composition'>('item');
    const [bases, setBases] = useState<any[]>([]);
    const [selectedBaseId, setSelectedBaseId] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<any[]>([]);
    const [isSearching, setIsSearching] = useState(false);

    // Load bases once when opening search
    useEffect(() => {
        if (showSearch && bases.length === 0) {
            fetch('/api/engineering/bases', { headers: hdrs() })
                .then(r => r.json()).then(data => {
                    if (Array.isArray(data)) { setBases(data); if (data.length > 0) setSelectedBaseId(data[0].id); }
                }).catch(console.error);
        }
    }, [showSearch, bases.length]);

    const handleSearch = async () => {
        if (!selectedBaseId || !searchQuery) return;
        setIsSearching(true);
        try {
            let url = '';
            if (searchType === 'item') {
                const params = new URLSearchParams({ q: searchQuery });
                if (engineeringConfig?.regimeOneracao) params.append('regime', engineeringConfig.regimeOneracao);
                if (engineeringConfig?.dataBase) params.append('dataBase', engineeringConfig.dataBase);
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

        let newTotal = 0;
        for (const groupKey of Object.keys(updated.groups)) {
            for (const ci of updated.groups[groupKey]) {
                newTotal += ci.price || 0;
            }
        }
        updated.totalPrice = applyPrecision(newTotal, { precision: engineeringConfig?.precision });
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
            const res = await fetch(`/api/engineering/compositions/${encodeURIComponent(code)}`, { headers: hdrs() });
            if (!res.ok) throw new Error('not_found');
            const d = await res.json();
            setData(d);
        } catch {
            setError('not_found');
        }
        setLoading(false);
    }, []);

    useEffect(() => {
        if (currentItem) loadComposition(currentItem.code);
    }, [currentIndex, currentItem, loadComposition]);

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
    const commitEdit = useCallback(() => {
        if (!editingField || !data) {
            setEditingField(null);
            return;
        }

        const newVal = parseFloat(editValue);
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
                const itemData = ci.item || ci.auxiliaryComposition;

                if (editingField.field === 'coef') {
                    const newCoef = newVal;
                    const unitPrice = itemData?.price || itemData?.totalPrice || 0;
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

        // Recalculate composition total
        let newTotal = 0;
        for (const groupKey of Object.keys(updated.groups)) {
            for (const ci of updated.groups[groupKey]) {
                newTotal += ci.price || 0;
            }
        }
        updated.totalPrice = applyPrecision(newTotal, { precision: engineeringConfig?.precision });
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
                const tokenStr = token();
                const payload = JSON.parse(atob(tokenStr.split('.')[1]));
                
                const resCreate = await fetch('/api/engineering/compositions', {
                    method: 'POST',
                    headers: hdrs(),
                    body: JSON.stringify({
                        code: data.code,
                        description: data.description,
                        unit: data.unit,
                        tenantId: payload.tenantId
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
            // Decodifica o payload do token para pegar o tenantId (simplificado, ou o backend pega pelo user)
            // Na verdade o backend pega pelo JWT. Mas enviamos via req.body (pode ser mock ou o backend pega).
            const tokenStr = token();
            const payload = JSON.parse(atob(tokenStr.split('.')[1]));
            
            const res = await fetch('/api/engineering/compositions', {
                method: 'POST',
                headers: hdrs(),
                body: JSON.stringify({
                    code: currentItem.code,
                    description: currentItem.description,
                    unit: currentItem.unit,
                    tenantId: payload.tenantId
                })
            });
            if (!res.ok) throw new Error('Erro ao criar composição');
            await loadComposition(currentItem.code); // Reloads the newly created empty composition
        } catch (e: any) {
            alert(e.message || 'Erro ao criar composição própria');
            setLoading(false);
        }
    };

    // Computed total from current data
    const compositionTotal = data ? (data.totalPrice || data.totalDirect || 0) : 0;

    if (!currentItem) return null;

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

                {items.map((item, idx) => (
                    <button key={item.id} onClick={() => setCurrentIndex(idx)}
                        style={{
                            display: 'block', width: '100%', padding: '10px 16px', border: 'none',
                            borderBottom: '1px solid var(--color-border)', cursor: 'pointer', textAlign: 'left',
                            background: idx === currentIndex ? 'var(--color-primary-light)' : 'transparent',
                            borderLeft: idx === currentIndex ? '3px solid var(--color-primary)' : '3px solid transparent',
                            transition: 'all 0.1s',
                        }}>
                        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: idx === currentIndex ? 'var(--color-primary)' : 'var(--color-text-tertiary)' }}>
                            {item.itemNumber} · {item.code || 'N/A'}
                        </div>
                        <div style={{
                            fontSize: '0.72rem', lineHeight: 1.3, marginTop: 2,
                            color: idx === currentIndex ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            fontWeight: idx === currentIndex ? 600 : 400,
                        }}>
                            {item.description}
                        </div>
                        <div style={{ fontSize: '0.65rem', color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                            {fmt(item.unitCost)} × {item.quantity} {item.unit}
                        </div>
                    </button>
                ))}
            </div>

            {/* Main Content */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

                {/* Top Bar */}
                <div style={{
                    padding: '12px 24px', borderBottom: '1px solid var(--color-border)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    background: 'linear-gradient(135deg, rgba(37,99,235,0.03), rgba(124,58,237,0.03))',
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
                        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                            CPU — Composição de Preços Unitários
                        </div>
                        <h3 style={{ margin: '4px 0 0', fontSize: '1rem', fontWeight: 700 }}>{currentItem.description}</h3>
                        <span style={{ fontSize: '0.78rem', color: 'var(--color-text-tertiary)' }}>
                            Código: <strong>{currentItem.code}</strong> · {currentItem.sourceName}
                            {hasChanges && <span style={{ marginLeft: 8, color: '#d97706', fontWeight: 700 }}>● Modificado</span>}
                        </span>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        {data && (
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
                        {data && hasChanges && (
                            <button onClick={saveToBase} disabled={isSavingToBase} title={data.database?.name === 'PROPRIA' ? "Atualizar a base de dados com as modificações desta composição" : "Salvar alterações como uma nova Composição Própria"}
                                style={{ padding: '6px 12px', borderRadius: 'var(--radius-sm)', border: 'none', background: 'var(--color-primary)', color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.72rem', fontWeight: 600 }}>
                                {isSavingToBase ? <Loader2 size={13} className="spin" /> : <Save size={13} />} 
                                {data.database?.name === 'PROPRIA' ? 'Salvar na Base' : 'Salvar como Própria'}
                            </button>
                        )}
                        {data && (
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

                {/* Cascade indicator */}
                {hasChanges && (
                    <div style={{
                        padding: '6px 24px', background: 'rgba(34,197,94,0.06)', borderBottom: '1px solid rgba(34,197,94,0.15)',
                        display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.72rem', color: '#16a34a',
                    }}>
                        <ArrowDownUp size={13} />
                        <strong>Cascade ativo</strong> — Alterações refletidas na Planilha e Hub de Insumos em tempo real.
                    </div>
                )}

                {/* Composition Detail */}
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
                                {/* <button className="btn btn-outline" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <Cpu size={15} color="var(--color-ai)" /> Tentar Extrair via IA
                                </button> */}
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

                    {data && !error && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                            {Object.entries(GROUP_META).map(([groupKey, meta]) => {
                                const groupItems = data.groups?.[groupKey] || [];
                                if (groupItems.length === 0) return null;
                                const Icon = meta.icon;
                                const groupTotal = groupItems.reduce((s: number, ci: any) => s + (ci.price || 0), 0);
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
                                                    const unitPrice = itemData?.price || itemData?.totalPrice || 0;
                                                    const isEditingCoef = editingField?.id === ci.id && editingField?.field === 'coef';
                                                    const isEditingPrice = editingField?.id === ci.id && editingField?.field === 'price';

                                                    return (
                                                        <div key={ci.id || idx} style={{
                                                            display: 'grid', gridTemplateColumns: '40px 2.5fr 60px 90px 100px 90px 30px',
                                                            gap: 8, padding: '8px 20px', alignItems: 'center',
                                                            borderBottom: '1px solid var(--color-border)',
                                                            background: idx % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.01)',
                                                        }}>
                                                            <span style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)', fontWeight: 600 }}>{idx + 1}</span>
                                                            <div>
                                                                <div style={{ fontSize: '0.8rem', fontWeight: 500 }}>{itemData?.description || '—'}</div>
                                                                {itemData?.code && (
                                                                    <span style={{ fontSize: '0.65rem', color: meta.color, fontWeight: 600 }}>{itemData.code}</span>
                                                                )}
                                                            </div>
                                                            <span style={{ fontSize: '0.78rem', color: 'var(--color-text-secondary)', textAlign: 'center' }}>
                                                                {itemData?.unit || '—'}
                                                            </span>

                                                            {/* Editable coefficient */}
                                                            <div style={{ textAlign: 'right', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                                                                {isEditingCoef ? (
                                                                    <>
                                                                        <input type="number" step="0.0001" autoFocus
                                                                            value={editValue}
                                                                            onChange={e => setEditValue(e.target.value)}
                                                                            onKeyDown={e => {
                                                                                if (e.key === 'Enter') commitEdit();
                                                                                if (e.key === 'Escape') setEditingField(null);
                                                                            }}
                                                                            onBlur={commitEdit}
                                                                            style={{ width: 65, padding: '2px 4px', border: '1px solid var(--color-primary)', borderRadius: 3, fontSize: '0.75rem', textAlign: 'right' }}
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

                                                            {/* Editable price */}
                                                            <div style={{ textAlign: 'right', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 4 }}>
                                                                {isEditingPrice ? (
                                                                    <>
                                                                        <input type="number" step="0.01" autoFocus
                                                                            value={editValue}
                                                                            onChange={e => setEditValue(e.target.value)}
                                                                            onKeyDown={e => {
                                                                                if (e.key === 'Enter') commitEdit();
                                                                                if (e.key === 'Escape') setEditingField(null);
                                                                            }}
                                                                            onBlur={commitEdit}
                                                                            style={{ width: 75, padding: '2px 4px', border: '1px solid var(--color-primary)', borderRadius: 3, fontSize: '0.75rem', textAlign: 'right' }}
                                                                        />
                                                                    </>
                                                                ) : (
                                                                    <>
                                                                        <span style={{ fontSize: '0.78rem' }}>{fmt(unitPrice)}</span>
                                                                        <button onClick={() => startEdit(ci.id, 'price', unitPrice)}
                                                                            style={{ padding: 2, border: 'none', background: 'none', cursor: 'pointer', opacity: 0.3 }}
                                                                            title="Editar preço">
                                                                            <Pencil size={10} />
                                                                        </button>
                                                                    </>
                                                                )}
                                                            </div>

                                                            <span style={{ fontSize: '0.78rem', textAlign: 'right', fontWeight: 700, color: meta.color }}>
                                                                {fmt(ci.price)}
                                                            </span>
                                                            
                                                            <div style={{ textAlign: 'center' }}>
                                                                <button onClick={() => {
                                                                    const updated = { ...data, groups: { ...data.groups } };
                                                                    updated.groups[groupKey] = updated.groups[groupKey].filter((i: any) => i.id !== ci.id);
                                                                    
                                                                    let newTotal = 0;
                                                                    for (const k of Object.keys(updated.groups)) {
                                                                        for (const item of updated.groups[k]) {
                                                                            newTotal += item.price || 0;
                                                                        }
                                                                    }
                                                                    updated.totalPrice = applyPrecision(newTotal, { precision: engineeringConfig?.precision });
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

                {/* Footer */}
                {data && !error && (
                    <div style={{
                        padding: '16px 24px', borderTop: '1px solid var(--color-border)',
                        background: hasChanges
                            ? 'linear-gradient(135deg, rgba(34,197,94,0.06), rgba(37,99,235,0.04))'
                            : 'linear-gradient(135deg, rgba(37,99,235,0.04), rgba(124,58,237,0.03))',
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    }}>
                        <div>
                            <div style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-tertiary)' }}>
                                Custo Unitário do Serviço (S/ BDI)
                            </div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                                {data.items?.length || 0} insumos · {currentItem.quantity} {currentItem.unit} no orçamento
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
                        <div style={{ display: 'flex', gap: 8 }}>
                            <select className="form-select" value={selectedBaseId} onChange={e => setSelectedBaseId(e.target.value)} style={{ width: 200 }}>
                                {(() => {
                                    const allowed = engineeringConfig?.basesConsideradas || [];
                                    const filtered = allowed.length > 0 
                                        ? bases.filter(b => allowed.some((ab: string) => b.name.toUpperCase().includes(ab.toUpperCase())))
                                        : bases;
                                    
                                    if (filtered.length === 0) return <option value="">Nenhuma base permitida</option>;
                                    return filtered.map(b => <option key={b.id} value={b.id}>{b.name} {b.uf || ''}</option>);
                                })()}
                            </select>
                            <input type="text" className="form-input" placeholder="Buscar por código ou descrição..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSearch()} style={{ flex: 1 }} />
                            <button className="btn btn-primary" onClick={handleSearch} disabled={isSearching}>{isSearching ? 'Buscando...' : 'Buscar'}</button>
                        </div>
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
        </div>
    );

    return createPortal(editor, document.body);
}
