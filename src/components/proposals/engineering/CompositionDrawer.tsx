/**
 * CompositionDrawer — Drawer lateral que mostra a composição de custos unitários
 * de um serviço de engenharia (drill-down completo de insumos).
 * 
 * Mostra: Material + Mão de Obra + Equipamento + Composições Auxiliares
 * com coeficientes e preços unitários.
 */
import { useState, useEffect } from 'react';
import { X, Layers, Package, HardHat, Wrench, ChevronDown, ChevronRight, Loader2, AlertCircle } from 'lucide-react';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtCoef = (v: number) => v.toFixed(4);
const token = () => localStorage.getItem('token') || '';
const hdrs = () => ({ 'Authorization': `Bearer ${token()}`, 'Content-Type': 'application/json' });

interface Props {
    code: string;
    description: string;
    databaseId?: string;
    onClose: () => void;
}

const GROUP_META: Record<string, { label: string; icon: any; color: string }> = {
    MATERIAL: { label: 'Materiais', icon: Package, color: '#2563eb' },
    MAO_DE_OBRA: { label: 'Mão de Obra', icon: HardHat, color: '#16a34a' },
    EQUIPAMENTO: { label: 'Equipamentos', icon: Wrench, color: '#d97706' },
    AUXILIAR: { label: 'Composições Auxiliares', icon: Layers, color: '#7c3aed' },
};

export function CompositionDrawer({ code, description, databaseId, onClose }: Props) {
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [expandedAux, setExpandedAux] = useState<Set<string>>(new Set());

    useEffect(() => {
        const url = `/api/engineering/compositions/${encodeURIComponent(code)}${databaseId ? `?databaseId=${databaseId}` : ''}`;
        fetch(url, { headers: hdrs() })
            .then(r => { if (!r.ok) throw new Error('not_found'); return r.json(); })
            .then(d => { setData(d); setLoading(false); })
            .catch(() => { setError('Composição não encontrada na base oficial.'); setLoading(false); });
    }, [code, databaseId]);

    const toggleAux = (id: string) => setExpandedAux(prev => {
        const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
    });

    return (
        <>
            {/* Backdrop */}
            <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1000, backdropFilter: 'blur(2px)' }} />

            {/* Drawer */}
            <div style={{
                position: 'fixed', top: 0, right: 0, bottom: 0, width: 560, maxWidth: '90vw',
                background: 'var(--color-bg-surface)', zIndex: 1001, display: 'flex', flexDirection: 'column',
                boxShadow: '-4px 0 24px rgba(0,0,0,0.15)', animation: 'slideInRight 0.2s ease-out',
            }}>
                {/* Header */}
                <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--color-border)', background: 'linear-gradient(135deg, rgba(37,99,235,0.04), rgba(124,58,237,0.04))' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ flex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                <Layers size={16} color="var(--color-primary)" />
                                <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--color-primary)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                                    Composição de Custos Unitários
                                </span>
                            </div>
                            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, lineHeight: 1.3 }}>{description}</h3>
                            <span style={{ fontSize: '0.8rem', color: 'var(--color-text-tertiary)', marginTop: 4, display: 'block' }}>
                                Código: <strong>{code}</strong>
                                {data?.database && <> · Base: <strong>{data.database.name} {data.database.uf || ''}</strong></>}
                            </span>
                        </div>
                        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
                            <X size={20} color="var(--color-text-tertiary)" />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px' }}>
                    {loading && (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 60, gap: 10, color: 'var(--color-text-tertiary)' }}>
                            <Loader2 size={20} className="spin" /> Carregando composição...
                        </div>
                    )}

                    {error && (
                        <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-tertiary)' }}>
                            <AlertCircle size={32} style={{ opacity: 0.4, margin: '0 auto 12px', display: 'block' }} />
                            <div style={{ fontWeight: 600, marginBottom: 4 }}>{error}</div>
                            <div style={{ fontSize: '0.8rem' }}>
                                Esta composição ainda não foi importada. Importe a planilha de composições analíticas (SINAPI/SEINFRA) para visualizar o detalhamento.
                            </div>
                        </div>
                    )}

                    {data && !error && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                            {Object.entries(GROUP_META).map(([groupKey, meta]) => {
                                const items = data.groups?.[groupKey] || [];
                                if (items.length === 0) return null;
                                const Icon = meta.icon;
                                const groupTotal = items.reduce((s: number, ci: any) => s + (ci.price || 0), 0);

                                return (
                                    <div key={groupKey} style={{ border: `1px solid ${meta.color}20`, borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
                                        {/* Group header */}
                                        <div style={{
                                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                            padding: '10px 16px', background: `${meta.color}08`,
                                            borderBottom: `1px solid ${meta.color}15`,
                                        }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                <Icon size={15} color={meta.color} />
                                                <span style={{ fontWeight: 700, fontSize: '0.85rem', color: meta.color }}>{meta.label}</span>
                                                <span style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)' }}>({items.length})</span>
                                            </div>
                                            <span style={{ fontWeight: 700, fontSize: '0.85rem', color: meta.color }}>{fmt(groupTotal)}</span>
                                        </div>

                                        {/* Table header */}
                                        <div style={{ display: 'grid', gridTemplateColumns: '2.5fr 50px 65px 75px 80px', gap: 4, padding: '6px 16px', borderBottom: '1px solid var(--color-border)' }}>
                                            {['Insumo', 'Unid.', 'Coef.', 'Preço Unit.', 'Subtotal'].map((h, i) => (
                                                <span key={i} style={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-tertiary)', textAlign: i >= 2 ? 'right' : 'left' }}>{h}</span>
                                            ))}
                                        </div>

                                        {/* Rows */}
                                        {items.map((ci: any, idx: number) => {
                                            const isAux = groupKey === 'AUXILIAR';
                                            const itemData = ci.item || ci.auxiliaryComposition;
                                            const isExpanded = expandedAux.has(ci.id);

                                            return (
                                                <div key={ci.id || idx}>
                                                    <div
                                                        style={{ display: 'grid', gridTemplateColumns: '2.5fr 50px 65px 75px 80px', gap: 4, padding: '6px 16px', alignItems: 'center', borderBottom: '1px solid var(--color-border)', cursor: isAux ? 'pointer' : 'default' }}
                                                        onClick={isAux ? () => toggleAux(ci.id) : undefined}
                                                    >
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                                            {isAux && (isExpanded ? <ChevronDown size={12} color={meta.color} /> : <ChevronRight size={12} color={meta.color} />)}
                                                            <div>
                                                                <div style={{ fontSize: '0.78rem', fontWeight: 500, lineHeight: 1.2 }}>
                                                                    {itemData?.description || '—'}
                                                                </div>
                                                                {itemData?.code && (
                                                                    <span style={{ fontSize: '0.65rem', color: 'var(--color-text-tertiary)' }}>{itemData.code}</span>
                                                                )}
                                                            </div>
                                                        </div>
                                                        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', textAlign: 'center' }}>{itemData?.unit || '—'}</span>
                                                        <span style={{ fontSize: '0.75rem', textAlign: 'right', fontFamily: 'monospace' }}>{fmtCoef(ci.coefficient)}</span>
                                                        <span style={{ fontSize: '0.75rem', textAlign: 'right' }}>{fmt(itemData?.price || itemData?.totalPrice || 0)}</span>
                                                        <span style={{ fontSize: '0.75rem', textAlign: 'right', fontWeight: 600, color: meta.color }}>{fmt(ci.price)}</span>
                                                    </div>

                                                    {/* Expanded auxiliary composition */}
                                                    {isAux && isExpanded && ci.auxiliaryComposition?.items && (
                                                        <div style={{ background: 'rgba(124,58,237,0.03)', paddingLeft: 32 }}>
                                                            {ci.auxiliaryComposition.items.map((subCi: any, subIdx: number) => (
                                                                <div key={subIdx} style={{ display: 'grid', gridTemplateColumns: '2.5fr 50px 65px 75px 80px', gap: 4, padding: '4px 16px', borderBottom: '1px solid var(--color-border)', fontSize: '0.72rem' }}>
                                                                    <span style={{ color: 'var(--color-text-secondary)' }}>↳ {subCi.item?.description || '—'}</span>
                                                                    <span style={{ textAlign: 'center', color: 'var(--color-text-tertiary)' }}>{subCi.item?.unit || '—'}</span>
                                                                    <span style={{ textAlign: 'right', fontFamily: 'monospace' }}>{fmtCoef(subCi.coefficient)}</span>
                                                                    <span style={{ textAlign: 'right' }}>{fmt(subCi.item?.price || 0)}</span>
                                                                    <span style={{ textAlign: 'right', fontWeight: 600 }}>{fmt(subCi.price)}</span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Footer with total */}
                {data && !error && (
                    <div style={{ padding: '16px 24px', borderTop: '1px solid var(--color-border)', background: 'linear-gradient(135deg, rgba(37,99,235,0.05), rgba(124,58,237,0.04))' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                                <div style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-tertiary)' }}>
                                    Custo Unitário do Serviço (S/ BDI)
                                </div>
                                <div style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                                    {data.items?.length || 0} insumos na composição
                                </div>
                            </div>
                            <div style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--color-primary)' }}>
                                {fmt(data.totalPrice || data.totalDirect || 0)}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            <style>{`
                @keyframes slideInRight {
                    from { transform: translateX(100%); }
                    to { transform: translateX(0); }
                }
            `}</style>
        </>
    );
}
