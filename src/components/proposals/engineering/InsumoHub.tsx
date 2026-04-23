import { useState, useEffect, useCallback } from 'react';
import { Package, Users, Wrench, Search, Percent, RefreshCw, Filter, TrendingDown, BarChart3, Info } from 'lucide-react';
import type { InsumoConsolidado, InsumoCategoria, DescontoConfig } from './insumoEngine';
import { CATEGORIA_META, DEFAULT_DESCONTO_CONFIG, filterInsumos, applyDescontos, classifyABC, calculateHubStats } from './insumoEngine';

interface ClientItem {
    id: string; itemNumber: string; code: string; sourceName: string;
    description: string; unit: string; quantity: number;
    unitCost: number; unitPrice: number; totalPrice: number;
}

interface Props {
    proposalId: string;
    clientItems?: ClientItem[];
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

function inferCategory(desc: string, unit: string): InsumoCategoria {
    const d = (desc || '').toUpperCase();
    const u = (unit || '').toUpperCase();
    if (['H', 'HORA', 'MES', 'DIA'].includes(u) && (d.includes('PEDREIRO') || d.includes('SERVENTE') || d.includes('MESTRE') || d.includes('ELETRICISTA') || d.includes('PINTOR'))) return 'MAO_DE_OBRA';
    if (d.includes('BETONEIRA') || d.includes('CAMINHAO') || d.includes('RETROESCAVADEIRA') || d.includes('COMPACTADOR') || d.includes('VIBRADOR')) return 'EQUIPAMENTO';
    if (d.includes('CIMENTO') || d.includes('AREIA') || d.includes('BRITA') || d.includes('TIJOLO') || d.includes('BLOCO') || d.includes('TINTA') || d.includes('TUBO') || d.includes('FIO ') || d.includes('ACO ') || d.includes('PREGO')) return 'MATERIAL';
    return 'SERVICO';
}

export function InsumoHub({ proposalId, clientItems }: Props) {
    const [insumos, setInsumos] = useState<InsumoConsolidado[]>([]);
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState<any>(null);
    const [descontoConfig, setDescontoConfig] = useState<DescontoConfig>({ ...DEFAULT_DESCONTO_CONFIG });
    const [mode, setMode] = useState<'compositions' | 'proposal_items'>('proposal_items');

    // Filters
    const [catFilter, setCatFilter] = useState<InsumoCategoria | 'TODOS'>('TODOS');
    const [searchQuery, setSearchQuery] = useState('');
    const [abcFilter, setAbcFilter] = useState<'A' | 'B' | 'C' | 'TODOS'>('TODOS');

    const loadInsumos = useCallback(async () => {
        if (!clientItems || clientItems.length === 0) {
            setLoading(false);
            return;
        }

        setLoading(true);
        try {
            // Send item codes to server — it will resolve compositions
            // and return individual INSUMOS (materials, labor, equipment)
            const payload = clientItems.map(it => ({
                code: it.code,
                quantity: it.quantity,
                sourceName: it.sourceName,
            }));

            const res = await fetch('/api/engineering/insumos-hub-resolve', {
                method: 'POST',
                headers: hdrs(),
                body: JSON.stringify({ items: payload }),
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
                                    {['', 'Código', 'Descrição', 'Unid.', 'Preço Unit.', 'Desc%', 'Preço Final', 'Qtd', 'Custo Total', 'ABC'].map((h, i) => (
                                        <th key={i} style={{ padding: '10px 8px', textAlign: i >= 4 ? 'right' : 'left', fontWeight: 600, color: 'var(--color-text-secondary)', fontSize: '0.72rem' }}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map(ins => {
                                    const meta = CATEGORIA_META[ins.categoria];
                                    return (
                                        <tr key={ins.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                            <td style={{ padding: '6px 8px', width: 28 }}>
                                                <span title={meta.label} style={{ fontSize: '0.9rem' }}>{meta.icon}</span>
                                            </td>
                                            <td style={{ padding: '6px 8px' }}>
                                                <span style={{ fontWeight: 700, color: meta.color, fontSize: '0.75rem' }}>{ins.codigo}</span>
                                            </td>
                                            <td style={{ padding: '6px 8px', maxWidth: 280 }}>
                                                <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: '0.78rem' }} title={ins.descricao}>
                                                    {ins.descricao}
                                                </div>
                                                <div style={{ fontSize: '0.65rem', color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                                                    {ins.base}{mode === 'compositions' ? ` · ${ins.composicoesVinculadas.length} comp.` : ''}
                                                </div>
                                            </td>
                                            <td style={{ padding: '6px 8px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>{ins.unidade}</td>
                                            <td style={{ padding: '6px 8px', textAlign: 'right' }}>{fmt(ins.precoOriginal)}</td>
                                            <td style={{ padding: '6px 4px', textAlign: 'right', width: 65 }}>
                                                <input type="number" min={0} max={100} step={0.5}
                                                    value={descontoConfig.descontosPorInsumo[ins.id] ?? ins.desconto}
                                                    onChange={e => updateInsumoDesconto(ins.id, parseFloat(e.target.value) || 0)}
                                                    style={{ width: 55, padding: '3px 4px', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: '0.75rem', textAlign: 'right', background: 'var(--color-bg-base)' }} />
                                            </td>
                                            <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 600, color: ins.desconto > 0 ? '#16a34a' : 'inherit' }}>
                                                {fmt(ins.precoFinal)}
                                            </td>
                                            <td style={{ padding: '6px 8px', textAlign: 'right', color: 'var(--color-text-secondary)' }}>
                                                {ins.coeficienteTotal % 1 === 0 ? ins.coeficienteTotal : ins.coeficienteTotal.toFixed(4)}
                                            </td>
                                            <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700 }}>
                                                {fmt(ins.custoTotal)}
                                            </td>
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
                            {(Object.entries(CATEGORIA_META) as [InsumoCategoria, typeof CATEGORIA_META[InsumoCategoria]][]).map(([key, meta]) => (
                                <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                    <span style={{ fontSize: '0.85rem', width: 20 }}>{meta.icon}</span>
                                    <span style={{ flex: 1, fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-secondary)' }}>{meta.label}</span>
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
                                    {mode === 'compositions' ? '🔬 Composições' : '📋 Serviços'}
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
