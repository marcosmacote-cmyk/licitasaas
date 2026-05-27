import { useState, useEffect, useCallback, useRef } from 'react';
import { Package, Users, Wrench, Search, Percent, RefreshCw, Filter, TrendingDown, BarChart3, Info, Download, FileText, Microscope, ClipboardList, Pencil, Check, X, ChevronDown } from 'lucide-react';
import type { InsumoConsolidado, InsumoCategoria, DescontoConfig } from './insumoEngine';
import { CATEGORIA_META, DEFAULT_DESCONTO_CONFIG, filterInsumos, applyDescontos, classifyABC, calculateHubStats, EXPANDED_TYPES_META, resolveMetaCategory } from './insumoEngine';
import { exportHubExcel, exportHubPdf } from './exportEngine';

interface ClientItem {
    id: string; itemNumber: string; code: string; sourceName: string;
    description: string; unit: string; quantity: number;
    unitCost: number; unitPrice: number; totalPrice: number;
}

interface Props {
    proposalId: string;
    clientItems?: ClientItem[];
    engineeringConfig?: any;
}

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const token = () => localStorage.getItem('token') || '';
const hdrs = () => ({ 'Authorization': `Bearer ${token()}`, 'Content-Type': 'application/json' });

const CAT_ICON: Record<string, any> = { MATERIAL: Package, MAO_DE_OBRA: Users, EQUIPAMENTO: Wrench, SERVICO: BarChart3 };
const ABC_COLORS: Record<string, { bg: string; color: string }> = {
    A: { bg: 'rgba(239,68,68,0.1)', color: '#dc2626' },
    B: { bg: 'rgba(245,158,11,0.1)', color: '#d97706' },
    C: { bg: 'rgba(34,197,94,0.1)', color: '#16a34a' },
};

// Macro categories for simplified dropdown
const MACRO_CATEGORIES: { value: string; label: string; color: string; icon: any }[] = [
    { value: 'Material', label: 'Material', color: '#2563eb', icon: Package },
    { value: 'Mão de Obra', label: 'Mão de Obra', color: '#7c3aed', icon: Users },
    { value: 'Equipamento', label: 'Equipamento', color: '#0891b2', icon: Wrench },
    { value: 'Serviços', label: 'Serviços', color: '#059669', icon: BarChart3 },
];

// Confidence dot colors
const CONFIDENCE_COLORS: Record<string, string> = {
    HIGH: '#22c55e',    // Green
    MEDIUM: '#f59e0b',  // Yellow
    LOW: '#9ca3af',     // Gray
};

/**
 * Clean display code: strip internal suffixes (-C1, -C2, -H-AJ, -M-EL, -INS-N)
 * and show only the meaningful part.
 */
function cleanDisplayCode(code: string): { display: string; full: string; isSuffixed: boolean } {
    const full = code;
    // Remove collision suffixes like -C1, -C2
    let display = code.replace(/-C\d+$/, '');
    // Remove suffixed variants like -H-AJ, -M-EL, -M-AJ
    display = display.replace(/-(H|M)-(AJ|EL)$/, '');
    // Remove INS- prefix patterns like INS-CPMH06-1
    if (display.match(/^INS-/i)) {
        // Show the description instead — will be handled by caller
        display = display.replace(/^INS-/, '').replace(/-\d+$/, '');
    }
    const isSuffixed = display !== full;
    return { display, full, isSuffixed };
}

// Toast notification component
function Toast({ message, type, onClose }: { message: string; type: 'success' | 'error'; onClose: () => void }) {
    useEffect(() => {
        const timer = setTimeout(onClose, 3000);
        return () => clearTimeout(timer);
    }, [onClose]);

    return (
        <div style={{
            position: 'fixed', bottom: 24, right: 24, zIndex: 10000,
            padding: '12px 20px', borderRadius: 'var(--radius-md)',
            background: type === 'success' ? '#059669' : '#dc2626',
            color: 'white', fontWeight: 600, fontSize: '0.82rem',
            boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
            display: 'flex', alignItems: 'center', gap: 8,
            animation: 'slideInRight 0.3s ease-out',
        }}>
            {type === 'success' ? <Check size={16} /> : <X size={16} />}
            {message}
        </div>
    );
}

export function InsumoHub({ proposalId, clientItems, engineeringConfig }: Props) {
    const [insumos, setInsumos] = useState<InsumoConsolidado[]>([]);
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState<any>(null);
    const [descontoConfig, setDescontoConfig] = useState<DescontoConfig>({ ...DEFAULT_DESCONTO_CONFIG });
    const [mode, setMode] = useState<'compositions' | 'proposal_items' | 'no_compositions'>('proposal_items');

    // Filters
    const [catFilter, setCatFilter] = useState<InsumoCategoria | 'TODOS'>('TODOS');
    const [searchQuery, setSearchQuery] = useState('');
    const [abcFilter, setAbcFilter] = useState<'A' | 'B' | 'C' | 'TODOS'>('TODOS');

    // Inline editing states
    const [editingInsumoId, setEditingInsumoId] = useState<string | null>(null);
    const [reclassifying, setReclassifying] = useState(false);
    const [editingPriceId, setEditingPriceId] = useState<string | null>(null);
    const [editingPriceValue, setEditingPriceValue] = useState('');
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

    const showToast = (message: string, type: 'success' | 'error') => setToast({ message, type });

    const handleReclassify = async (insumoCode: string, newType: string) => {
        setReclassifying(true);
        try {
            const res = await fetch(`/api/engineering/proposals/${proposalId}/reclassify-insumo`, {
                method: 'POST',
                headers: hdrs(),
                body: JSON.stringify({ insumoCode, newType }),
            });
            if (res.ok) {
                showToast(`Tipo alterado para "${newType}"`, 'success');
                await loadInsumos();
            } else {
                const data = await res.json().catch(() => ({}));
                showToast(data.error || 'Erro ao reclassificar insumo.', 'error');
            }
        } catch (e) {
            console.error('Reclassify error:', e);
            showToast('Erro de conexão ao reclassificar.', 'error');
        } finally {
            setReclassifying(false);
            setEditingInsumoId(null);
        }
    };

    const handleUpdatePrice = async (insumoCode: string, newPrice: number) => {
        try {
            const res = await fetch(`/api/engineering/proposals/${proposalId}/update-insumo`, {
                method: 'POST',
                headers: hdrs(),
                body: JSON.stringify({ insumoCode, updates: { price: newPrice } }),
            });
            if (res.ok) {
                showToast('Preço atualizado', 'success');
                await loadInsumos();
            } else {
                const data = await res.json().catch(() => ({}));
                showToast(data.error || 'Erro ao atualizar preço.', 'error');
            }
        } catch (e) {
            console.error('Update price error:', e);
            showToast('Erro de conexão ao atualizar preço.', 'error');
        } finally {
            setEditingPriceId(null);
        }
    };

    const loadInsumos = useCallback(async () => {
        if (!clientItems || clientItems.length === 0) {
            setLoading(false);
            return;
        }

        setLoading(true);
        try {
            const payload = clientItems.map(it => ({
                code: it.code,
                quantity: it.quantity,
                sourceName: it.sourceName,
            }));

            const res = await fetch('/api/engineering/insumos-hub-resolve', {
                method: 'POST',
                headers: hdrs(),
                body: JSON.stringify({ items: payload, proposalId }),
            });
            const data = await res.json();

            if (data.insumos && data.insumos.length > 0) {
                setInsumos(data.insumos);
                setStats(data.stats);
                setMode(data.stats?.mode || 'compositions');
            } else {
                setInsumos([]);
                setStats(data.stats || { totalInsumos: 0, totalCusto: 0, mode: 'no_compositions' });
                setMode('no_compositions');
            }
        } catch (e) {
            console.error('Hub resolve error:', e);
        }
        setLoading(false);
    }, [clientItems]);

    useEffect(() => { loadInsumos(); }, [loadInsumos]);

    // Apply discounts client-side
    const applyDiscounts = () => {
        const updated = [...insumos];
        applyDescontos(updated, descontoConfig);
        classifyABC(updated);
        updated.sort((a, b) => b.custoTotal - a.custoTotal);
        setInsumos(updated);
        setStats(calculateHubStats(updated));
    };

    const updateCatDesconto = (cat: InsumoCategoria, val: number) => {
        setDescontoConfig(prev => ({
            ...prev,
            descontoPorCategoria: { ...prev.descontoPorCategoria, [cat]: val },
        }));
    };

    const updateInsumoDesconto = (id: string, val: number) => {
        setDescontoConfig(prev => ({
            ...prev,
            descontosPorInsumo: { ...prev.descontosPorInsumo, [id]: val },
        }));
    };

    const filtered = filterInsumos(insumos, { categoria: catFilter, search: searchQuery, abcClass: abcFilter });

    if (loading) {
        return (
            <div style={{ padding: 60, textAlign: 'center', color: 'var(--color-text-tertiary)' }}>
                <RefreshCw size={24} className="spin" style={{ margin: '0 auto 12px' }} />
                <p>Consolidando insumos das composições...</p>
            </div>
        );
    }

    if (insumos.length === 0) {
        return (
            <div style={{ padding: 60, textAlign: 'center', background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }}>
                <Package size={40} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
                <h4 style={{ margin: '0 0 8px', color: 'var(--color-text-secondary)' }}>Nenhum insumo encontrado</h4>
                <p style={{ fontSize: '0.85rem', color: 'var(--color-text-tertiary)', maxWidth: 400, margin: '0 auto' }}>
                    Adicione itens na aba "Planilha Orçamentária" primeiro.
                </p>
            </div>
        );
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>

            {/* Toast notifications */}
            {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

            {/* Export bar + Refresh */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', alignItems: 'center' }}>
                <button className="btn btn-outline" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem' }}
                    onClick={() => { loadInsumos(); showToast('Insumos recarregados', 'success'); }}
                    title="Recarregar dados do Hub">
                    <RefreshCw size={13} /> Atualizar
                </button>
                <button className="btn btn-outline" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem' }}
                    onClick={() => exportHubExcel(insumos, stats, descontoConfig, engineeringConfig)}>
                    <Download size={13} /> Excel
                </button>
                <button className="btn btn-outline" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.78rem' }}
                    onClick={() => exportHubPdf(insumos, stats, engineeringConfig)}>
                    <FileText size={13} /> PDF
                </button>
            </div>

            {/* Info banner when no compositions exist */}
            {mode === 'no_compositions' && (
                <div style={{
                    padding: '12px 16px', borderRadius: 'var(--radius-md)',
                    background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)',
                    display: 'flex', alignItems: 'center', gap: 10, fontSize: '0.78rem',
                }}>
                    <Info size={16} color="#d97706" style={{ flexShrink: 0 }} />
                    <div>
                        <strong style={{ color: '#d97706' }}>Modo Simplificado</strong> — Exibindo itens da proposta como serviços.
                        Para detalhamento por insumo (materiais, mão de obra, equipamentos),
                        importe composições SINAPI/SEINFRA ou extraia do Projeto Básico.
                    </div>
                </div>
            )}

            {/* Stats Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--space-3)' }}>
                {([
                    { label: 'Material', value: stats?.custoMaterial || 0, cat: 'MATERIAL' as InsumoCategoria },
                    { label: 'Mão de Obra', value: stats?.custoMaoDeObra || 0, cat: 'MAO_DE_OBRA' as InsumoCategoria },
                    { label: 'Equipamento', value: stats?.custoEquipamento || 0, cat: 'EQUIPAMENTO' as InsumoCategoria },
                    { label: 'Total Insumos', value: stats?.totalCusto || 0, cat: null },
                ]).map((card, idx) => {
                    const meta = card.cat ? CATEGORIA_META[card.cat] : null;
                    const Icon = card.cat ? CAT_ICON[card.cat] : TrendingDown;
                    return (
                        <div key={idx} onClick={() => card.cat && setCatFilter(catFilter === card.cat ? 'TODOS' : card.cat)}
                            style={{
                                padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)',
                                background: card.cat ? (catFilter === card.cat ? meta!.bgLight : 'var(--color-bg-surface)') : 'linear-gradient(135deg, rgba(37,99,235,0.05), rgba(139,92,246,0.05))',
                                border: `1px solid ${card.cat && catFilter === card.cat ? meta!.color + '40' : 'var(--color-border)'}`,
                                cursor: card.cat ? 'pointer' : 'default',
                                transition: 'all 0.15s',
                            }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                <Icon size={16} color={meta?.color || 'var(--color-primary)'} />
                                <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-tertiary)', textTransform: 'uppercase' }}>{card.label}</span>
                            </div>
                            <span style={{ fontSize: idx === 3 ? '1.3rem' : '1.1rem', fontWeight: 800, color: meta?.color || 'var(--color-primary)' }}>{fmt(card.value)}</span>
                        </div>
                    );
                })}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 'var(--space-4)' }}>

                {/* Main Table */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>

                    {/* Filter Bar */}
                    <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', flexWrap: 'wrap' }}>
                        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
                            <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-tertiary)' }} />
                            <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
                                placeholder="Buscar por código ou descrição..."
                                style={{ width: '100%', padding: '8px 12px 8px 32px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', fontSize: '0.8rem', background: 'var(--color-bg-surface)' }} />
                        </div>
                        <div style={{ display: 'flex', gap: 4 }}>
                            {(['TODOS', 'A', 'B', 'C'] as const).map(cls => (
                                <button key={cls} onClick={() => setAbcFilter(cls)}
                                    style={{
                                        padding: '6px 12px', fontSize: '0.75rem', fontWeight: 700, borderRadius: 'var(--radius-sm)',
                                        border: '1px solid', cursor: 'pointer',
                                        borderColor: abcFilter === cls ? (cls === 'TODOS' ? 'var(--color-primary)' : ABC_COLORS[cls]?.color || 'var(--color-border)') : 'var(--color-border)',
                                        background: abcFilter === cls ? (cls === 'TODOS' ? 'var(--color-primary-light)' : ABC_COLORS[cls]?.bg || 'transparent') : 'transparent',
                                        color: abcFilter === cls ? (cls === 'TODOS' ? 'var(--color-primary)' : ABC_COLORS[cls]?.color || 'inherit') : 'var(--color-text-tertiary)',
                                    }}>
                                    {cls === 'TODOS' ? 'Todos' : `Classe ${cls}`}
                                </button>
                            ))}
                        </div>
                        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)', fontWeight: 600 }}>
                            <Filter size={12} style={{ verticalAlign: -2, marginRight: 4 }} />
                            {filtered.length} de {insumos.length}
                        </span>
                    </div>

                    {/* Table */}
                    <div style={{ background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                            <thead>
                                <tr style={{ background: 'var(--color-bg-base)', borderBottom: '1px solid var(--color-border)' }}>
                                    {['Tipo', 'Código', 'Descrição', 'Unid.', 'Preço Unit.', 'Desc%', 'Preço Final', 'Qtd', 'Custo Total', 'ABC'].map((h, i) => (
                                        <th key={i} style={{ padding: '10px 8px', textAlign: i >= 4 ? 'right' : (i === 3 ? 'center' : 'left'), fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '0.72rem', width: i === 0 ? 110 : undefined }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map(ins => {
                                    const meta = CATEGORIA_META[ins.categoria];
                                    const insAny = ins as any;
                                    const confidence = insAny.tipoConfianca || 'LOW';
                                    const rawType = insAny.tipoDetalhado || ins.categoria;
                                    const typeMeta = EXPANDED_TYPES_META[rawType] || meta || { label: rawType, color: '#6b7280', bgLight: 'rgba(107,114,128,0.08)' };
                                    const { display: displayCode, full: fullCode, isSuffixed } = cleanDisplayCode(ins.codigo);

                                    // Use description as primary identifier for INS- codes
                                    const isInternalCode = ins.codigo.startsWith('INS-') || ins.codigo.match(/-C\d+$/);
                                    const composicoesDetalhes = insAny.composicoesDetalhes || [];

                                    return (
                                        <tr key={ins.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                            {/* Type Badge with confidence dot */}
                                            <td style={{ padding: '6px 8px', width: 110 }}>
                                                <div style={{ position: 'relative', display: 'inline-flex' }}>
                                                    <span
                                                        onClick={(e) => { e.stopPropagation(); setEditingInsumoId(editingInsumoId === ins.id ? null : ins.id); }}
                                                        title={`Tipo: ${typeMeta.label} (confiança: ${confidence})\nClique para alterar`}
                                                        style={{
                                                            fontSize: '0.62rem', padding: '2px 6px', borderRadius: 4, fontWeight: 700,
                                                            cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 3,
                                                            background: typeMeta.bgLight, color: typeMeta.color,
                                                            border: `1px solid ${typeMeta.color}25`,
                                                            whiteSpace: 'nowrap',
                                                        }}
                                                    >
                                                        {/* Confidence dot */}
                                                        <span style={{
                                                            width: 5, height: 5, borderRadius: '50%',
                                                            background: CONFIDENCE_COLORS[confidence] || CONFIDENCE_COLORS.LOW,
                                                            display: 'inline-block', flexShrink: 0,
                                                        }} />
                                                        {meta?.label || typeMeta.label}
                                                        <ChevronDown size={8} style={{ opacity: 0.5 }} />
                                                    </span>

                                                    {/* Simplified Dropdown: 4 macro categories */}
                                                    {editingInsumoId === ins.id && (
                                                        <>
                                                        <div onClick={(e) => { e.stopPropagation(); setEditingInsumoId(null); }} style={{ position: 'fixed', inset: 0, zIndex: 999 }} />
                                                        <div style={{
                                                            position: 'absolute', left: 0, top: '100%', zIndex: 1000, marginTop: 2,
                                                            background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)',
                                                            borderRadius: 8, boxShadow: '0 4px 16px rgba(0,0,0,0.15)', padding: 6,
                                                            minWidth: 180, fontSize: '0.72rem',
                                                        }}>
                                                            <div style={{ padding: '3px 8px', fontWeight: 700, color: 'var(--color-text-tertiary)', fontSize: '0.6rem', textTransform: 'uppercase', marginBottom: 2 }}>
                                                                Alterar categoria:
                                                            </div>
                                                            {MACRO_CATEGORIES.map(cat => {
                                                                const CatIcon = cat.icon;
                                                                const isActive = ins.categoria === resolveMetaCategory(cat.value);
                                                                return (
                                                                    <button key={cat.value} disabled={reclassifying} onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        handleReclassify(ins.codigo, cat.value);
                                                                    }} style={{
                                                                        display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                                                                        padding: '6px 10px', border: 'none',
                                                                        background: isActive ? `${cat.color}10` : 'none',
                                                                        cursor: 'pointer', borderRadius: 6, textAlign: 'left',
                                                                        color: isActive ? cat.color : 'var(--color-text-secondary)',
                                                                        fontWeight: isActive ? 700 : 500, fontSize: '0.74rem',
                                                                        transition: 'all 0.1s',
                                                                    }}
                                                                    onMouseEnter={e => { if (!isActive) e.currentTarget.style.background = 'var(--color-bg-elevated)'; }}
                                                                    onMouseLeave={e => { if (!isActive) e.currentTarget.style.background = 'none'; }}
                                                                    >
                                                                        <CatIcon size={14} color={cat.color} />
                                                                        {cat.label}
                                                                        {isActive && <Check size={12} style={{ marginLeft: 'auto' }} />}
                                                                    </button>
                                                                );
                                                            })}
                                                        </div>
                                                        </>
                                                    )}
                                                </div>
                                            </td>

                                            {/* Code — clean display */}
                                            <td style={{ padding: '6px 8px' }}>
                                                <span
                                                    style={{ fontWeight: 700, color: meta?.color || '#6b7280', fontSize: '0.75rem' }}
                                                    title={isSuffixed || isInternalCode ? `Código completo: ${fullCode}` : undefined}
                                                >
                                                    {isInternalCode ? '—' : displayCode}
                                                </span>
                                                {isSuffixed && (
                                                    <span style={{ fontSize: '0.55rem', color: 'var(--color-text-tertiary)', marginLeft: 3, opacity: 0.6 }}>⊕</span>
                                                )}
                                            </td>

                                            {/* Description + linked compositions */}
                                            <td style={{ padding: '6px 8px', maxWidth: 280 }}>
                                                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.78rem' }} title={ins.descricao}>
                                                    {ins.descricao}
                                                </div>
                                                <div style={{ fontSize: '0.65rem', color: 'var(--color-text-tertiary)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
                                                    <span style={{ background: 'var(--color-bg-base)', padding: '0 4px', borderRadius: 3 }}>{ins.base}</span>
                                                    {mode === 'compositions' && ins.composicoesVinculadas.length > 0 && (
                                                        <span title={composicoesDetalhes.length > 0
                                                            ? composicoesDetalhes.map((c: any) => `${c.code} — ${(c.description || '').substring(0, 50)}`).join('\n')
                                                            : ins.composicoesVinculadas.join(', ')}
                                                            style={{ cursor: 'help' }}>
                                                            · {ins.composicoesVinculadas.length} comp.
                                                        </span>
                                                    )}
                                                </div>
                                            </td>

                                            {/* Unit */}
                                            <td style={{ padding: '6px 8px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>{ins.unidade}</td>

                                            {/* Price — inline editable */}
                                            <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                                                {editingPriceId === ins.id ? (
                                                    <input
                                                        type="number"
                                                        step="0.01"
                                                        autoFocus
                                                        value={editingPriceValue}
                                                        onChange={e => setEditingPriceValue(e.target.value)}
                                                        onKeyDown={e => {
                                                            if (e.key === 'Enter') {
                                                                const val = parseFloat(editingPriceValue);
                                                                if (!isNaN(val) && val >= 0) handleUpdatePrice(ins.codigo, val);
                                                                else setEditingPriceId(null);
                                                            }
                                                            if (e.key === 'Escape') setEditingPriceId(null);
                                                        }}
                                                        onBlur={() => {
                                                            const val = parseFloat(editingPriceValue);
                                                            if (!isNaN(val) && val >= 0 && val !== ins.precoOriginal) {
                                                                handleUpdatePrice(ins.codigo, val);
                                                            } else {
                                                                setEditingPriceId(null);
                                                            }
                                                        }}
                                                        style={{
                                                            width: 80, padding: '3px 6px', border: '2px solid var(--color-primary)',
                                                            borderRadius: 4, fontSize: '0.75rem', textAlign: 'right',
                                                            background: 'var(--color-bg-surface)', outline: 'none',
                                                        }}
                                                    />
                                                ) : (
                                                    <span
                                                        onDoubleClick={() => {
                                                            setEditingPriceId(ins.id);
                                                            setEditingPriceValue(ins.precoOriginal.toFixed(2));
                                                        }}
                                                        title="Duplo clique para editar"
                                                        style={{ cursor: 'text', display: 'inline-flex', alignItems: 'center', gap: 3 }}
                                                    >
                                                        {fmt(ins.precoOriginal)}
                                                        <Pencil size={9} style={{ opacity: 0.2 }} />
                                                    </span>
                                                )}
                                            </td>

                                            {/* Discount % */}
                                            <td style={{ padding: '6px 4px', textAlign: 'right', width: 65 }}>
                                                <input type="number" min={0} max={100} step={0.5}
                                                    value={descontoConfig.descontosPorInsumo[ins.id] ?? ins.desconto}
                                                    onChange={e => updateInsumoDesconto(ins.id, parseFloat(e.target.value) || 0)}
                                                    style={{ width: 55, padding: '3px 4px', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: '0.75rem', textAlign: 'right', background: 'var(--color-bg-base)' }} />
                                            </td>

                                            {/* Final Price */}
                                            <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, color: ins.desconto > 0 ? '#16a34a' : 'inherit' }}>
                                                {fmt(ins.precoFinal)}
                                            </td>

                                            {/* Quantity */}
                                            <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--color-text-secondary)' }}>
                                                {ins.coeficienteTotal % 1 === 0 ? ins.coeficienteTotal : ins.coeficienteTotal.toFixed(4)}
                                            </td>

                                            {/* Total Cost */}
                                            <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700 }}>
                                                {fmt(ins.custoTotal)}
                                            </td>

                                            {/* ABC */}
                                            <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                                                {ins.abcClass && (
                                                    <span style={{
                                                        padding: '2px 8px', borderRadius: 4, fontSize: '0.7rem', fontWeight: 800,
                                                        background: ABC_COLORS[ins.abcClass]?.bg, color: ABC_COLORS[ins.abcClass]?.color,
                                                    }}>{ins.abcClass}</span>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                                {filtered.length === 0 && (
                                    <tr><td colSpan={10} style={{ padding: 30, textAlign: 'center', color: 'var(--color-text-tertiary)' }}>
                                        Nenhum insumo corresponde aos filtros selecionados.
                                    </td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Discount Panel */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>

                    {/* Global Discount */}
                    <div style={{ background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', padding: 'var(--space-4)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 'var(--space-3)' }}>
                            <Percent size={16} color="var(--color-primary)" />
                            <h4 style={{ margin: 0, fontSize: 'var(--text-sm)', fontWeight: 700 }}>Descontos</h4>
                        </div>

                        <label style={{ display: 'block', fontSize: '0.7rem', fontWeight: 600, color: 'var(--color-text-tertiary)', marginBottom: 4 }}>Desconto Global (%)</label>
                        <input type="number" min={0} max={100} step={0.5}
                            value={descontoConfig.descontoGlobal}
                            onChange={e => setDescontoConfig(prev => ({ ...prev, descontoGlobal: parseFloat(e.target.value) || 0 }))}
                            style={{ width: '100%', padding: '8px 10px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', fontSize: '1rem', fontWeight: 700, color: 'var(--color-primary)', marginBottom: 'var(--space-3)', background: 'var(--color-bg-base)' }} />

                        <div style={{ borderTop: '1px dashed var(--color-border)', paddingTop: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
                            <span style={{ fontSize: '0.7rem', fontWeight: 600, color: 'var(--color-text-tertiary)', display: 'block', marginBottom: 8 }}>Por Categoria</span>
                            {(Object.entries(CATEGORIA_META) as [InsumoCategoria, typeof CATEGORIA_META[InsumoCategoria]][]).map(([key, catMeta]) => (
                                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                    <span style={{ fontSize: '0.85rem', width: 20, display: 'inline-flex', alignItems: 'center' }}>
                                        {(() => { const Ico = CAT_ICON[key]; return <Ico size={14} color={catMeta.color} />; })()}
                                    </span>
                                    <span style={{ flex: 1, fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-secondary)' }}>{catMeta.label}</span>
                                    <input type="number" min={0} max={100} step={0.5}
                                        value={descontoConfig.descontoPorCategoria[key]}
                                        onChange={e => updateCatDesconto(key, parseFloat(e.target.value) || 0)}
                                        style={{ width: 60, padding: '4px 6px', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: '0.75rem', textAlign: 'right', background: 'var(--color-bg-base)' }} />
                                    <span style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)', width: 12 }}>%</span>
                                </div>
                            ))}
                        </div>

                        <button onClick={applyDiscounts}
                            style={{
                                width: '100%', padding: '10px', borderRadius: 'var(--radius-md)', border: 'none',
                                background: 'var(--color-primary)', color: 'white', fontWeight: 700, fontSize: '0.8rem',
                                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                            }}>
                            <RefreshCw size={14} /> Recalcular Orçamento
                        </button>
                    </div>

                    {/* Economy Summary */}
                    {stats?.economiaTotalDesconto > 0 && (
                        <div style={{
                            background: 'rgba(34,197,94,0.06)', borderRadius: 'var(--radius-lg)',
                            border: '1px solid rgba(34,197,94,0.2)', padding: 'var(--space-4)', textAlign: 'center',
                        }}>
                            <TrendingDown size={20} color="#16a34a" style={{ margin: '0 auto 8px' }} />
                            <div style={{ fontSize: '0.7rem', color: '#16a34a', fontWeight: 600, textTransform: 'uppercase' }}>Economia com Descontos</div>
                            <div style={{ fontSize: '1.3rem', fontWeight: 800, color: '#16a34a' }}>{fmt(stats.economiaTotalDesconto)}</div>
                        </div>
                    )}

                    {/* Info Panel */}
                    <div style={{ background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', padding: 'var(--space-3)' }}>
                        <div style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                <span>Modo</span>
                                <strong style={{ color: mode === 'compositions' ? '#16a34a' : '#d97706' }}>
                                    {mode === 'compositions' ? <><Microscope size={12} style={{display:'inline',verticalAlign:-2,marginRight:3}} />Composições</> : <><ClipboardList size={12} style={{display:'inline',verticalAlign:-2,marginRight:3}} />Serviços</>}
                                </strong>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                <span>Itens no orçamento</span>
                                <strong>{stats?.totalInsumos || 0}</strong>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <span>Custo total</span>
                                <strong>{fmt(stats?.totalCusto || 0)}</strong>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
