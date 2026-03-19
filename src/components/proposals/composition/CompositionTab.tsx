/**
 * CompositionTab — Container principal da aba "Composição de Preços"
 *
 * Lista todos os itens com resumo e permite editar a composição de cada um.
 */

import { useState, useCallback, useEffect } from 'react';
import {
    BarChart3, ChevronLeft, Package, Layers, Copy,
    AlertTriangle, CheckCircle2, Save, Loader2,
} from 'lucide-react';
import type { ProposalItem } from '../../../types';
import type { CompositionMap, ItemCostComposition } from './types';
import {
    calculateCompositionTotals, deserializeComposition,
    serializeComposition, recalcComposition, createEmptyComposition,
} from './compositionEngine';
import { ItemCompositionEditor } from './ItemCompositionEditor';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtPct = (v: number) => v.toFixed(2) + '%';

interface Props {
    items: ProposalItem[];
    bdi: number;
    onSaveComposition: (itemId: string, compositionJson: string) => Promise<void>;
    isSaving: boolean;
}

export function CompositionTab({ items, bdi, onSaveComposition, isSaving }: Props) {
    const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
    const [compositions, setCompositions] = useState<CompositionMap>({});
    const [copySourceId, setCopySourceId] = useState<string | null>(null);

    // Load compositions from items.costComposition on mount / items change
    useEffect(() => {
        const map: CompositionMap = {};
        for (const item of items) {
            map[item.id] = deserializeComposition(item.costComposition, item.id);
        }
        setCompositions(map);
    }, [items]);

    const selectedItem = items.find(i => i.id === selectedItemId);
    const selectedComp = selectedItemId ? (compositions[selectedItemId] || createEmptyComposition(selectedItemId)) : null;

    const handleUpdateComposition = useCallback((comp: ItemCostComposition) => {
        const recalced = recalcComposition(comp);
        setCompositions(prev => ({ ...prev, [comp.itemId]: recalced }));
    }, []);

    const handleSave = useCallback(async (itemId: string) => {
        const comp = compositions[itemId];
        if (!comp) return;
        const json = serializeComposition(comp);
        await onSaveComposition(itemId, json);
    }, [compositions, onSaveComposition]);

    const handleCopyTo = useCallback((targetItemId: string) => {
        if (!copySourceId || !compositions[copySourceId]) return;
        const source = compositions[copySourceId];
        const newComp: ItemCostComposition = {
            itemId: targetItemId,
            lines: source.lines.map(l => ({
                ...l,
                id: `cl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            })),
            templateUsed: source.templateUsed,
        };
        setCompositions(prev => ({ ...prev, [targetItemId]: newComp }));
        setCopySourceId(null);
    }, [copySourceId, compositions]);

    // ════════════════════════════════════
    // DETAIL VIEW (editing one item)
    // ════════════════════════════════════
    if (selectedItem && selectedComp) {
        return (
            <div className="card" style={{ padding: 'var(--space-5)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-4)' }}>
                    <button onClick={() => setSelectedItemId(null)} style={{
                        background: 'rgba(37,99,235,0.06)', border: '1px solid rgba(37,99,235,0.12)',
                        cursor: 'pointer', color: 'var(--color-primary)', padding: '6px 12px',
                        borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', gap: 6,
                        fontSize: 'var(--text-sm)', fontWeight: 600,
                    }}>
                        <ChevronLeft size={14} /> Voltar
                    </button>
                    <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 'var(--text-lg)', fontWeight: 700, color: 'var(--color-text-primary)' }}>
                            Item {selectedItem.itemNumber}: {selectedItem.description?.substring(0, 80) || '(sem descrição)'}
                        </div>
                        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                            Preço unitário na planilha: <strong style={{ color: 'var(--color-primary)' }}>{fmt(selectedItem.unitPrice)}</strong>
                            {' · '}Custo unitário: {fmt(selectedItem.unitCost)}
                            {' · '}BDI planilha: {fmtPct(bdi)}
                        </div>
                    </div>
                    <button
                        onClick={() => handleSave(selectedItem.id)}
                        disabled={isSaving}
                        style={{
                            padding: '8px 20px', borderRadius: 'var(--radius-lg)',
                            background: 'var(--color-success)', color: 'white', border: 'none',
                            fontWeight: 700, fontSize: 'var(--text-sm)', cursor: 'pointer',
                            display: 'flex', alignItems: 'center', gap: 6,
                            opacity: isSaving ? 0.6 : 1,
                        }}
                    >
                        {isSaving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
                        Salvar Composição
                    </button>
                </div>

                <ItemCompositionEditor
                    composition={selectedComp}
                    unitPriceFromSheet={selectedItem.unitPrice}
                    unitCostFromSheet={selectedItem.unitCost}
                    bdiSheet={bdi}
                    onChange={handleUpdateComposition}
                />
            </div>
        );
    }

    // ════════════════════════════════════
    // LIST VIEW (all items summary)
    // ════════════════════════════════════
    return (
        <div className="card" style={{ padding: 'var(--space-5)' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                    <div style={{
                        width: 36, height: 36, borderRadius: 'var(--radius-lg)',
                        background: 'linear-gradient(135deg, rgba(37,99,235,0.12), rgba(99,102,241,0.08))',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                        <Layers size={18} color="var(--color-primary)" />
                    </div>
                    <div>
                        <h3 style={{ margin: 0, fontSize: 'var(--text-lg)', fontWeight: 700 }}>
                            Composição de Preços Unitários
                        </h3>
                        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)' }}>
                            Selecione um item para detalhar os elementos que compõem seu preço
                        </div>
                    </div>
                </div>
                {copySourceId && (
                    <div style={{
                        padding: '6px 14px', borderRadius: 'var(--radius-lg)',
                        background: 'rgba(37,99,235,0.06)', border: '1px solid rgba(37,99,235,0.15)',
                        fontSize: 'var(--text-sm)', color: 'var(--color-primary)', fontWeight: 600,
                        display: 'flex', alignItems: 'center', gap: 6,
                    }}>
                        <Copy size={13} />
                        Clique em um item para colar a composição
                        <button onClick={() => setCopySourceId(null)} style={{
                            background: 'none', border: 'none', color: 'var(--color-text-tertiary)',
                            cursor: 'pointer', padding: '2px 6px', fontSize: 'var(--text-xs)',
                        }}>✕</button>
                    </div>
                )}
            </div>

            {/* Items Table */}
            <div style={{ borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                    <thead>
                        <tr style={{ background: 'linear-gradient(135deg, rgba(37,99,235,0.06), rgba(99,102,241,0.04))', borderBottom: '2px solid var(--color-border)' }}>
                            <th style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 700, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-tertiary)', width: 40 }}>#</th>
                            <th style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 700, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-primary)', minWidth: 200 }}>Descrição</th>
                            <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-tertiary)' }}>Custo Direto</th>
                            <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-tertiary)' }}>Custo Indireto</th>
                            <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-tertiary)' }}>Tributos</th>
                            <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-tertiary)' }}>Lucro</th>
                            <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-primary)' }}>Total Comp.</th>
                            <th style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-tertiary)' }}>BDI Impl.</th>
                            <th style={{ padding: '10px 14px', textAlign: 'center', fontWeight: 700, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-tertiary)' }}>Status</th>
                            <th style={{ padding: '10px 14px', textAlign: 'center', width: 60 }}></th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.map(item => {
                            const comp = compositions[item.id];
                            const hasComp = comp && comp.lines.length > 0;
                            const totals = hasComp ? calculateCompositionTotals(comp.lines) : null;
                            const diff = totals ? Math.abs(totals.grandTotal - item.unitPrice) : 0;
                            const isAligned = diff < 0.02; // tolerance

                            return (
                                <tr
                                    key={item.id}
                                    onClick={() => {
                                        if (copySourceId) {
                                            handleCopyTo(item.id);
                                        } else {
                                            setSelectedItemId(item.id);
                                        }
                                    }}
                                    style={{
                                        borderBottom: '1px solid var(--color-border)',
                                        cursor: 'pointer',
                                        transition: 'background 0.15s',
                                        background: copySourceId === item.id ? 'rgba(37,99,235,0.06)' : undefined,
                                    }}
                                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(37,99,235,0.03)'; }}
                                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = copySourceId === item.id ? 'rgba(37,99,235,0.06)' : ''; }}
                                >
                                    <td style={{ padding: '10px 14px', textAlign: 'center', color: 'var(--color-text-tertiary)' }}>{item.itemNumber}</td>
                                    <td style={{ padding: '10px 14px' }}>
                                        <div style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>{item.description?.substring(0, 60) || '(sem descrição)'}</div>
                                        <div style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)', marginTop: 2 }}>
                                            Preço planilha: {fmt(item.unitPrice)}
                                        </div>
                                    </td>
                                    <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 500 }}>{hasComp ? fmt(totals!.totalDirect) : '-'}</td>
                                    <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 500 }}>{hasComp ? fmt(totals!.totalIndirect) : '-'}</td>
                                    <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 500 }}>{hasComp ? fmt(totals!.totalTaxes) : '-'}</td>
                                    <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 500 }}>{hasComp ? fmt(totals!.profit) : '-'}</td>
                                    <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: 'var(--color-primary)' }}>{hasComp ? fmt(totals!.grandTotal) : '-'}</td>
                                    <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: 'var(--color-text-secondary)' }}>{hasComp ? fmtPct(totals!.bdiImplicit) : '-'}</td>
                                    <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                                        {!hasComp ? (
                                            <span style={{ fontSize: '0.7rem', padding: '3px 8px', borderRadius: 'var(--radius-full)', background: 'var(--color-bg-base)', border: '1px solid var(--color-border)', color: 'var(--color-text-tertiary)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                                                Pendente
                                            </span>
                                        ) : isAligned ? (
                                            <span style={{ fontSize: '0.7rem', padding: '3px 8px', borderRadius: 'var(--radius-full)', background: 'var(--color-success-bg)', color: 'var(--color-success)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 3, whiteSpace: 'nowrap' }}>
                                                <CheckCircle2 size={11} /> Alinhado
                                            </span>
                                        ) : (
                                            <span style={{ fontSize: '0.7rem', padding: '3px 8px', borderRadius: 'var(--radius-full)', background: 'var(--color-danger-bg)', color: 'var(--color-danger)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 3, whiteSpace: 'nowrap' }}>
                                                <AlertTriangle size={11} /> Δ {fmt(diff)}
                                            </span>
                                        )}
                                    </td>
                                    <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                                        {hasComp && (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); setCopySourceId(item.id); }}
                                                title="Copiar composição para outro item"
                                                style={{
                                                    background: 'none', border: 'none', cursor: 'pointer',
                                                    color: 'var(--color-text-tertiary)', padding: '4px',
                                                    borderRadius: 'var(--radius-sm)',
                                                }}
                                            >
                                                <Copy size={14} />
                                            </button>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                        {items.length === 0 && (
                            <tr>
                                <td colSpan={10} style={{ textAlign: 'center', padding: 'var(--space-10)', color: 'var(--color-text-tertiary)' }}>
                                    <Package size={28} style={{ opacity: 0.3, margin: '0 auto var(--space-2)' }} />
                                    <div>Nenhum item na proposta. Adicione itens na aba "Planilha de Preços".</div>
                                </td>
                            </tr>
                        )}
                    </tbody>
                </table>
            </div>

            {/* Summary footer */}
            {items.length > 0 && (
                <div style={{
                    marginTop: 'var(--space-3)', padding: 'var(--space-3) var(--space-4)',
                    borderRadius: 'var(--radius-lg)', background: 'var(--color-bg-base)',
                    border: '1px solid var(--color-border)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                        <BarChart3 size={14} color="var(--color-primary)" />
                        <span>
                            <strong>{items.filter(i => (compositions[i.id]?.lines.length || 0) > 0).length}</strong> de {items.length} itens com composição detalhada
                        </span>
                    </div>
                    <div style={{ fontWeight: 600 }}>
                        BDI referência da planilha: <span style={{ color: 'var(--color-primary)' }}>{fmtPct(bdi)}</span>
                    </div>
                </div>
            )}
        </div>
    );
}
