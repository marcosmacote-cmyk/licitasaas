/**
 * ItemCompositionEditor — Editor completo da composição de um item
 *
 * Permite selecionar template, adicionar/remover linhas por grupo (accordion),
 * e mostra totalizadores com BDI implícito e comparação com planilha.
 */

import { useState, useMemo } from 'react';
import {
    Plus, Trash2, ChevronDown, ChevronRight, AlertTriangle,
    CheckCircle2, FileSpreadsheet,
} from 'lucide-react';
import type { ItemCostComposition, CostCompositionLine, CostGroup } from './types';
import { COST_GROUP_META, COMPOSITION_UNITS } from './types';
import {
    calculateCompositionTotals, generateLineId,
} from './compositionEngine';
import { COMPOSITION_TEMPLATES, applyTemplate } from './compositionTemplates';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtPct = (v: number) => v.toFixed(2) + '%';

interface Props {
    composition: ItemCostComposition;
    unitPriceFromSheet: number;
    unitCostFromSheet: number;
    bdiSheet: number;
    onChange: (comp: ItemCostComposition) => void;
}

export function ItemCompositionEditor({ composition, unitPriceFromSheet, unitCostFromSheet: _unitCostFromSheet, bdiSheet, onChange }: Props) {
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(
        COST_GROUP_META.map(g => g.key) // all expanded by default
    ));
    const [showTemplateMenu, setShowTemplateMenu] = useState(false);

    const totals = useMemo(() => calculateCompositionTotals(composition.lines), [composition.lines]);
    const diff = totals.grandTotal - unitPriceFromSheet;
    const isAligned = Math.abs(diff) < 0.02;

    // Group lines by CostGroup
    const groupedLines = useMemo(() => {
        const map: Record<string, CostCompositionLine[]> = {};
        for (const meta of COST_GROUP_META) {
            const lines = composition.lines.filter(l => l.group === meta.key);
            if (lines.length > 0) {
                map[meta.key] = lines;
            }
        }
        return map;
    }, [composition.lines]);

    // Available groups (that have lines + all groups for adding)
    const activeGroups = COST_GROUP_META.filter(g => groupedLines[g.key]?.length);

    const toggleGroup = (key: string) => {
        setExpandedGroups(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    const updateLine = (lineId: string, field: keyof CostCompositionLine, value: any) => {
        const newLines = composition.lines.map(l => {
            if (l.id !== lineId) return l;
            const updated = { ...l, [field]: value };
            updated.totalValue = Math.round(updated.quantity * updated.unitValue * 100) / 100;
            return updated;
        });
        onChange({ ...composition, lines: newLines });
    };

    const addLine = (group: CostGroup) => {
        const newLine: CostCompositionLine = {
            id: generateLineId(),
            group,
            description: '',
            unit: 'UN',
            quantity: 1,
            unitValue: 0,
            totalValue: 0,
        };
        onChange({ ...composition, lines: [...composition.lines, newLine] });
        setExpandedGroups(prev => new Set(prev).add(group));
    };

    const removeLine = (lineId: string) => {
        onChange({ ...composition, lines: composition.lines.filter(l => l.id !== lineId) });
    };

    const handleApplyTemplate = (templateKey: string) => {
        const result = applyTemplate(templateKey, composition.itemId);
        onChange(result);
        setShowTemplateMenu(false);
        setExpandedGroups(new Set(COST_GROUP_META.map(g => g.key)));
    };

    // ════════════════════════════════════
    // RENDER
    // ════════════════════════════════════

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>

            {/* Template Selector + Add Group */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                    {/* Template dropdown */}
                    <div style={{ position: 'relative' }}>
                        <button
                            onClick={() => setShowTemplateMenu(!showTemplateMenu)}
                            style={{
                                padding: '7px 14px', borderRadius: 'var(--radius-md)',
                                background: 'linear-gradient(135deg, rgba(37,99,235,0.08), rgba(99,102,241,0.06))',
                                border: '1px solid rgba(37,99,235,0.15)', cursor: 'pointer',
                                fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--color-primary)',
                                display: 'flex', alignItems: 'center', gap: 6,
                            }}
                        >
                            <FileSpreadsheet size={14} />
                            Aplicar Template
                            <ChevronDown size={12} />
                        </button>
                        {showTemplateMenu && (
                            <>
                                <div onClick={() => setShowTemplateMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 998 }} />
                                <div style={{
                                    position: 'absolute', top: '100%', left: 0, marginTop: 4,
                                    background: 'var(--color-bg-surface)', border: 'none',
                                    borderRadius: 'var(--radius-lg)', boxShadow: '0 0 0 1px var(--color-border), 0 8px 32px rgba(0,0,0,0.12)',
                                    zIndex: 999, minWidth: 280, overflow: 'hidden',
                                }}>
                                    {COMPOSITION_TEMPLATES.map(t => (
                                        <button key={t.key} onClick={() => handleApplyTemplate(t.key)} style={{
                                            width: '100%', padding: '10px 16px', border: 'none', background: 'transparent',
                                            cursor: 'pointer', textAlign: 'left', borderBottom: '1px solid var(--color-border)',
                                        }}>
                                            <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)' }}>{t.label}</div>
                                            <div style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)', marginTop: 2 }}>{t.description}</div>
                                        </button>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>

                    {composition.templateUsed && (
                        <span style={{
                            fontSize: '0.7rem', padding: '3px 10px', borderRadius: 'var(--radius-full)',
                            background: 'rgba(37,99,235,0.06)', color: 'var(--color-primary)', fontWeight: 600,
                        }}>
                            Template: {COMPOSITION_TEMPLATES.find(t => t.key === composition.templateUsed)?.label || composition.templateUsed}
                        </span>
                    )}
                </div>

                {/* Add group dropdown */}
                <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                    {COST_GROUP_META.filter(g => g.key !== 'OUTRO').map(g => (
                        <button key={g.key} onClick={() => addLine(g.key)} title={`Adicionar linha: ${g.label}`} style={{
                            padding: '4px 8px', borderRadius: 'var(--radius-sm)',
                            background: `${g.color}10`, border: `1px solid ${g.color}25`,
                            color: g.color, fontSize: '0.65rem', fontWeight: 600, cursor: 'pointer',
                            display: 'flex', alignItems: 'center', gap: 3, whiteSpace: 'nowrap',
                        }}>
                            <Plus size={10} /> {g.label.split('/')[0].split(' ')[0]}
                        </button>
                    ))}
                </div>
            </div>

            {/* Groups / Accordion */}
            {activeGroups.length === 0 ? (
                <div style={{
                    padding: 'var(--space-10)', textAlign: 'center', color: 'var(--color-text-tertiary)',
                    border: '2px dashed var(--color-border)', borderRadius: 'var(--radius-xl)',
                }}>
                    <FileSpreadsheet size={32} style={{ opacity: 0.3, margin: '0 auto var(--space-3)' }} />
                    <div style={{ fontWeight: 600, fontSize: 'var(--text-base)', color: 'var(--color-text-secondary)' }}>
                        Composição vazia
                    </div>
                    <div style={{ fontSize: 'var(--text-sm)', marginTop: 4 }}>
                        Aplique um <strong>template</strong> acima ou adicione elementos manualmente
                    </div>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                    {/* Category headers */}
                    {(['DIRETO', 'INDIRETO', 'TRIBUTO', 'LUCRO'] as const).map(cat => {
                        const catGroups = activeGroups.filter(g => g.category === cat);
                        if (catGroups.length === 0) return null;
                        const catLabel = cat === 'DIRETO' ? 'CUSTOS DIRETOS' : cat === 'INDIRETO' ? 'CUSTOS INDIRETOS' : cat === 'TRIBUTO' ? 'TRIBUTOS' : 'LUCRO / BENEFÍCIO';
                        return (
                            <div key={cat}>
                                <div style={{
                                    padding: '6px 12px', fontSize: '0.65rem', fontWeight: 800,
                                    textTransform: 'uppercase', letterSpacing: '0.1em',
                                    color: 'var(--color-text-tertiary)',
                                    borderBottom: '1px solid var(--color-border)',
                                    marginTop: 'var(--space-2)',
                                }}>
                                    {catLabel}
                                </div>
                                {catGroups.map(groupMeta => {
                                    const lines = groupedLines[groupMeta.key] || [];
                                    const groupTotal = lines.reduce((s, l) => s + l.totalValue, 0);
                                    const isExpanded = expandedGroups.has(groupMeta.key);

                                    return (
                                        <div key={groupMeta.key} style={{
                                            border: `1px solid ${groupMeta.color}20`,
                                            borderRadius: 'var(--radius-md)',
                                            overflow: 'hidden',
                                            marginTop: 4,
                                        }}>
                                            {/* Group header */}
                                            <div
                                                onClick={() => toggleGroup(groupMeta.key)}
                                                style={{
                                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                                    padding: '8px 14px', cursor: 'pointer',
                                                    background: `${groupMeta.color}08`,
                                                    borderBottom: isExpanded ? `1px solid ${groupMeta.color}15` : 'none',
                                                }}
                                            >
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                    {isExpanded ? <ChevronDown size={14} color={groupMeta.color} /> : <ChevronRight size={14} color={groupMeta.color} />}
                                                    <span style={{ fontWeight: 700, fontSize: 'var(--text-sm)', color: groupMeta.color }}>{groupMeta.label}</span>
                                                    <span style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)' }}>({lines.length} {lines.length === 1 ? 'linha' : 'linhas'})</span>
                                                </div>
                                                <span style={{ fontWeight: 700, fontSize: 'var(--text-sm)', color: groupMeta.color }}>
                                                    {fmt(groupTotal)}
                                                </span>
                                            </div>

                                            {/* Lines */}
                                            {isExpanded && (
                                                <div style={{ padding: '6px 0' }}>
                                                    {/* Mini header */}
                                                    <div style={{
                                                        display: 'grid', gridTemplateColumns: '2fr 70px 80px 80px 90px 60px 32px',
                                                        gap: 6, padding: '0 14px 4px', alignItems: 'center',
                                                    }}>
                                                        <span style={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-text-tertiary)', letterSpacing: '0.06em' }}>Descrição</span>
                                                        <span style={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-text-tertiary)', letterSpacing: '0.06em', textAlign: 'center' }}>Unid.</span>
                                                        <span style={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-text-tertiary)', letterSpacing: '0.06em', textAlign: 'right' }}>Qtd./Coef.</span>
                                                        <span style={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-text-tertiary)', letterSpacing: '0.06em', textAlign: 'right' }}>Valor Unit.</span>
                                                        <span style={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-text-tertiary)', letterSpacing: '0.06em', textAlign: 'right' }}>Total</span>
                                                        <span style={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', color: 'var(--color-text-tertiary)', letterSpacing: '0.06em', textAlign: 'center' }}>Fonte</span>
                                                        <span></span>
                                                    </div>
                                                    {lines.map(line => (
                                                        <div key={line.id} style={{
                                                            display: 'grid', gridTemplateColumns: '2fr 70px 80px 80px 90px 60px 32px',
                                                            gap: 6, padding: '3px 14px', alignItems: 'center',
                                                            transition: 'background 0.1s',
                                                        }}
                                                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(0,0,0,0.015)'; }}
                                                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = ''; }}
                                                        >
                                                            <input
                                                                value={line.description}
                                                                onChange={e => updateLine(line.id, 'description', e.target.value)}
                                                                placeholder="Descrição do insumo"
                                                                className="prop-input"
                                                                style={{ fontSize: '0.78rem', height: 28, padding: '0 8px' }}
                                                            />
                                                            <select
                                                                value={line.unit}
                                                                onChange={e => updateLine(line.id, 'unit', e.target.value)}
                                                                className="prop-input"
                                                                style={{ fontSize: '0.75rem', height: 28, textAlign: 'center', padding: '0 2px' }}
                                                            >
                                                                {COMPOSITION_UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                                                            </select>
                                                            <input
                                                                type="number"
                                                                value={line.quantity}
                                                                onChange={e => updateLine(line.id, 'quantity', parseFloat(e.target.value) || 0)}
                                                                className="prop-input"
                                                                style={{ fontSize: '0.78rem', height: 28, textAlign: 'right', padding: '0 6px' }}
                                                                step="0.01"
                                                            />
                                                            <input
                                                                type="number"
                                                                value={line.unitValue}
                                                                onChange={e => updateLine(line.id, 'unitValue', parseFloat(e.target.value) || 0)}
                                                                className="prop-input"
                                                                style={{ fontSize: '0.78rem', height: 28, textAlign: 'right', padding: '0 6px' }}
                                                                step="0.01"
                                                            />
                                                            <span style={{ textAlign: 'right', fontWeight: 600, fontSize: '0.78rem', color: groupMeta.color }}>
                                                                {fmt(line.totalValue)}
                                                            </span>
                                                            <input
                                                                value={line.source || ''}
                                                                onChange={e => updateLine(line.id, 'source', e.target.value)}
                                                                placeholder="—"
                                                                className="prop-input"
                                                                style={{ fontSize: '0.65rem', height: 28, textAlign: 'center', padding: '0 4px' }}
                                                            />
                                                            <button onClick={() => removeLine(line.id)} style={{
                                                                background: 'none', border: 'none', cursor: 'pointer',
                                                                color: 'var(--color-danger)', padding: 2, borderRadius: 'var(--radius-sm)',
                                                                opacity: 0.5,
                                                            }}
                                                            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}
                                                            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '0.5'; }}
                                                            >
                                                                <Trash2 size={13} />
                                                            </button>
                                                        </div>
                                                    ))}
                                                    {/* Add line button */}
                                                    <button
                                                        onClick={() => addLine(groupMeta.key as CostGroup)}
                                                        style={{
                                                            margin: '4px 14px', padding: '4px 10px', borderRadius: 'var(--radius-sm)',
                                                            background: 'transparent', border: `1px dashed ${groupMeta.color}30`,
                                                            cursor: 'pointer', color: groupMeta.color, fontSize: '0.72rem',
                                                            fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4,
                                                            opacity: 0.7, width: 'fit-content',
                                                        }}
                                                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}
                                                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '0.7'; }}
                                                    >
                                                        <Plus size={11} /> Adicionar
                                                    </button>
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

            {/* ════════ TOTALS ════════ */}
            {composition.lines.length > 0 && (
                <div style={{
                    borderRadius: 'var(--radius-xl)', overflow: 'hidden',
                    border: 'none', boxShadow: '0 0 0 1px var(--color-border)',
                }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', borderBottom: '1px solid var(--color-border)' }}>
                        {[
                            { label: 'Custo Direto', value: totals.totalDirect, color: '#2563eb' },
                            { label: 'Custo Indireto', value: totals.totalIndirect, color: '#7c3aed' },
                            { label: 'Tributos', value: totals.totalTaxes, color: '#dc2626' },
                            { label: 'Lucro', value: totals.profit, color: '#16a34a' },
                        ].map(item => (
                            <div key={item.label} style={{
                                padding: 'var(--space-3) var(--space-4)',
                                borderRight: '1px solid var(--color-border)',
                                textAlign: 'center',
                            }}>
                                <div style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-tertiary)', marginBottom: 2 }}>
                                    {item.label}
                                </div>
                                <div style={{ fontSize: 'var(--text-base)', fontWeight: 700, color: item.color }}>
                                    {fmt(item.value)}
                                </div>
                            </div>
                        ))}
                    </div>
                    <div style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: 'var(--space-4) var(--space-5)',
                        background: 'linear-gradient(135deg, rgba(37,99,235,0.05), rgba(139,92,246,0.05))',
                    }}>
                        <div>
                            <div style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-tertiary)' }}>
                                Preço Unitário Composto
                            </div>
                            <div style={{ fontSize: '1.3rem', fontWeight: 800, color: 'var(--color-primary)' }}>
                                {fmt(totals.grandTotal)}
                            </div>
                        </div>
                        <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-tertiary)' }}>
                                BDI Implícito
                            </div>
                            <div style={{ fontSize: 'var(--text-lg)', fontWeight: 700, color: 'var(--color-text-secondary)' }}>
                                {fmtPct(totals.bdiImplicit)}
                            </div>
                            <div style={{ fontSize: '0.65rem', color: 'var(--color-text-tertiary)' }}>
                                (planilha: {fmtPct(bdiSheet)})
                            </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--color-text-tertiary)' }}>
                                Preço Planilha
                            </div>
                            <div style={{ fontSize: 'var(--text-lg)', fontWeight: 700, color: 'var(--color-text-primary)' }}>
                                {fmt(unitPriceFromSheet)}
                            </div>
                        </div>
                    </div>
                    {/* Divergence alert */}
                    <div style={{
                        padding: 'var(--space-2) var(--space-5)',
                        background: isAligned ? 'var(--color-success-bg)' : 'var(--color-danger-bg)',
                        borderTop: `1px solid ${isAligned ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`,
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        fontSize: '0.8rem', fontWeight: 600,
                        color: isAligned ? 'var(--color-success)' : 'var(--color-danger)',
                    }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            {isAligned
                                ? <><CheckCircle2 size={14} /> Composição alinhada com o preço da planilha</>
                                : <><AlertTriangle size={14} /> Divergência de {fmt(Math.abs(diff))} ({diff > 0 ? 'acima' : 'abaixo'} da planilha)</>
                            }
                        </span>
                        <span>Composição: {fmt(totals.grandTotal)} × Planilha: {fmt(unitPriceFromSheet)}</span>
                    </div>
                </div>
            )}
        </div>
    );
}
