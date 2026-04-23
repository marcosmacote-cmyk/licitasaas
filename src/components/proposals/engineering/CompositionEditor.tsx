/**
 * CompositionEditor — Editor full-page de composições com navegação contínua.
 * 
 * Permite:
 * - Navegar entre composições com ◀ ▶ sem voltar à planilha
 * - Editar coeficientes inline
 * - Ver resumo de todas as composições na sidebar
 * - Drill-down em composições auxiliares
 */
import { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight, X, Layers, Package, HardHat, Wrench, ChevronDown, ChevronUp, Loader2, AlertCircle, Pencil, Check, RotateCcw } from 'lucide-react';

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
    onUpdateItem?: (itemId: string, updates: Partial<EngItem>) => void;
}

const GROUP_META: Record<string, { label: string; icon: any; color: string }> = {
    MATERIAL: { label: 'Materiais', icon: Package, color: '#2563eb' },
    MAO_DE_OBRA: { label: 'Mão de Obra', icon: HardHat, color: '#16a34a' },
    EQUIPAMENTO: { label: 'Equipamentos', icon: Wrench, color: '#d97706' },
    AUXILIAR: { label: 'Composições Auxiliares', icon: Layers, color: '#7c3aed' },
};

export function CompositionEditor({ items, initialIndex, onClose, onUpdateItem }: Props) {
    const [currentIndex, setCurrentIndex] = useState(initialIndex);
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['MATERIAL', 'MAO_DE_OBRA', 'EQUIPAMENTO', 'AUXILIAR']));
    const [editingCoef, setEditingCoef] = useState<string | null>(null);
    const [editValue, setEditValue] = useState('');

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
        try {
            const res = await fetch(`/api/engineering/compositions/${encodeURIComponent(code)}`, { headers: hdrs() });
            if (!res.ok) throw new Error('not_found');
            const d = await res.json();
            setData(d);
        } catch {
            setError('Composição não encontrada na base oficial.');
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

    // Keyboard navigation
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'ArrowLeft' && hasPrev) navigate(-1);
            if (e.key === 'ArrowRight' && hasNext) navigate(1);
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [currentIndex, hasPrev, hasNext]);

    const toggleGroup = (key: string) => {
        setExpandedGroups(prev => {
            const n = new Set(prev);
            n.has(key) ? n.delete(key) : n.add(key);
            return n;
        });
    };

    if (!currentItem) return null;

    return (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1000, display: 'flex', background: 'var(--color-bg-base)' }}>

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
                        </span>
                    </div>

                    <button onClick={onClose} title="Fechar (Esc)"
                        style={{ padding: 8, borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', background: 'var(--color-bg-surface)', cursor: 'pointer' }}>
                        <X size={18} />
                    </button>
                </div>

                {/* Composition Detail */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '20px 24px' }}>
                    {loading && (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 80, gap: 10, color: 'var(--color-text-tertiary)' }}>
                            <Loader2 size={20} className="spin" /> Carregando composição...
                        </div>
                    )}

                    {error && (
                        <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-tertiary)' }}>
                            <AlertCircle size={36} style={{ opacity: 0.3, margin: '0 auto 12px', display: 'block' }} />
                            <div style={{ fontWeight: 600, marginBottom: 4 }}>{error}</div>
                            <div style={{ fontSize: '0.8rem' }}>
                                Use ◀ ▶ ou clique na sidebar para navegar para outra composição.
                            </div>
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

                                        {isExpanded && (
                                            <>
                                                {/* Column headers */}
                                                <div style={{
                                                    display: 'grid', gridTemplateColumns: '40px 2.5fr 60px 80px 90px 90px',
                                                    gap: 8, padding: '8px 20px', background: 'var(--color-bg-base)',
                                                    borderBottom: '1px solid var(--color-border)',
                                                }}>
                                                    {['#', 'Insumo', 'Unid.', 'Coeficiente', 'Preço Unit.', 'Subtotal'].map((h, i) => (
                                                        <span key={i} style={{
                                                            fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase',
                                                            letterSpacing: '0.06em', color: 'var(--color-text-tertiary)',
                                                            textAlign: i >= 3 ? 'right' : 'left',
                                                        }}>{h}</span>
                                                    ))}
                                                </div>

                                                {/* Rows */}
                                                {groupItems.map((ci: any, idx: number) => {
                                                    const itemData = ci.item || ci.auxiliaryComposition;
                                                    const isEditing = editingCoef === ci.id;

                                                    return (
                                                        <div key={ci.id || idx} style={{
                                                            display: 'grid', gridTemplateColumns: '40px 2.5fr 60px 80px 90px 90px',
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
                                                                {isEditing ? (
                                                                    <>
                                                                        <input type="number" step="0.0001" autoFocus
                                                                            value={editValue}
                                                                            onChange={e => setEditValue(e.target.value)}
                                                                            onKeyDown={e => {
                                                                                if (e.key === 'Enter') { setEditingCoef(null); }
                                                                                if (e.key === 'Escape') { setEditingCoef(null); }
                                                                            }}
                                                                            style={{ width: 60, padding: '2px 4px', border: '1px solid var(--color-primary)', borderRadius: 3, fontSize: '0.75rem', textAlign: 'right' }}
                                                                        />
                                                                        <button onClick={() => setEditingCoef(null)} style={{ padding: 2, border: 'none', background: 'none', cursor: 'pointer' }}>
                                                                            <Check size={12} color="#16a34a" />
                                                                        </button>
                                                                    </>
                                                                ) : (
                                                                    <>
                                                                        <span style={{ fontSize: '0.78rem', fontFamily: 'monospace' }}>{fmtCoef(ci.coefficient)}</span>
                                                                        <button onClick={() => { setEditingCoef(ci.id); setEditValue(String(ci.coefficient)); }}
                                                                            style={{ padding: 2, border: 'none', background: 'none', cursor: 'pointer', opacity: 0.3 }}
                                                                            title="Editar coeficiente">
                                                                            <Pencil size={10} />
                                                                        </button>
                                                                    </>
                                                                )}
                                                            </div>

                                                            <span style={{ fontSize: '0.78rem', textAlign: 'right' }}>
                                                                {fmt(itemData?.price || itemData?.totalPrice || 0)}
                                                            </span>
                                                            <span style={{ fontSize: '0.78rem', textAlign: 'right', fontWeight: 700, color: meta.color }}>
                                                                {fmt(ci.price)}
                                                            </span>
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
                        background: 'linear-gradient(135deg, rgba(37,99,235,0.04), rgba(124,58,237,0.03))',
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    }}>
                        <div>
                            <div style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-tertiary)' }}>
                                Custo Unitário do Serviço (S/ BDI)
                            </div>
                            <div style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                                {data.items?.length || 0} insumos · {currentItem.quantity} {currentItem.unit} no orçamento
                            </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--color-primary)' }}>
                                {fmt(data.totalPrice || data.totalDirect || 0)}
                            </div>
                            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
                                Total: {fmt((data.totalPrice || data.totalDirect || 0) * currentItem.quantity)}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
