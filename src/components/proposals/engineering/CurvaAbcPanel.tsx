/**
 * CurvaAbcPanel — Painel da Curva ABC integrado ao editor de engenharia
 * Mostra classificação Pareto dos itens com tabela + resumo por classe.
 */
import { useMemo } from 'react';
import { BarChart3, TrendingUp } from 'lucide-react';
import { calculateCurvaAbc, type AbcItem } from './abcEngine';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

interface Props {
    items: { itemNumber: string; code: string; description: string; unit: string; quantity: number; unitPrice: number; totalPrice: number }[];
}

const CLASS_COLORS: Record<string, { bg: string; text: string; border: string }> = {
    A: { bg: 'rgba(239,68,68,0.08)', text: '#dc2626', border: 'rgba(239,68,68,0.2)' },
    B: { bg: 'rgba(234,179,8,0.08)', text: '#ca8a04', border: 'rgba(234,179,8,0.2)' },
    C: { bg: 'rgba(34,197,94,0.08)', text: '#16a34a', border: 'rgba(34,197,94,0.2)' },
};

export function CurvaAbcPanel({ items }: Props) {
    const abc = useMemo(() => calculateCurvaAbc(items), [items]);

    if (abc.items.length === 0) {
        return (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-tertiary)', border: '2px dashed var(--color-border)', borderRadius: 'var(--radius-xl)' }}>
                <BarChart3 size={32} style={{ opacity: 0.3, margin: '0 auto 8px' }} />
                <div style={{ fontWeight: 600 }}>Curva ABC indisponível</div>
                <div style={{ fontSize: '0.85rem', marginTop: 4 }}>Adicione itens com preço na planilha para gerar a classificação.</div>
            </div>
        );
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>

            {/* Summary Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                {[
                    { cls: 'A', label: 'Classe A — Críticos', data: abc.classA, desc: '~80% do custo' },
                    { cls: 'B', label: 'Classe B — Intermediários', data: abc.classB, desc: '~15% do custo' },
                    { cls: 'C', label: 'Classe C — Triviais', data: abc.classC, desc: '~5% do custo' },
                ].map(({ cls, label, data, desc }) => {
                    const colors = CLASS_COLORS[cls];
                    return (
                        <div key={cls} style={{ padding: 16, borderRadius: 'var(--radius-lg)', background: colors.bg, border: `1px solid ${colors.border}` }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                <span style={{ fontSize: '1.2rem', fontWeight: 800, color: colors.text }}>{cls}</span>
                                <span style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)' }}>{desc}</span>
                            </div>
                            <div style={{ fontSize: '1.1rem', fontWeight: 700, color: colors.text }}>{fmt(data.total)}</div>
                            <div style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', marginTop: 4 }}>
                                {data.count} {data.count === 1 ? 'item' : 'itens'} · {data.percent.toFixed(1)}% do total
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Visual Bar */}
            <div style={{ display: 'flex', height: 28, borderRadius: 'var(--radius-md)', overflow: 'hidden', border: '1px solid var(--color-border)' }}>
                {abc.classA.percent > 0 && <div style={{ width: `${abc.classA.percent}%`, background: '#dc2626', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '0.65rem', fontWeight: 700 }}>A ({abc.classA.count})</div>}
                {abc.classB.percent > 0 && <div style={{ width: `${abc.classB.percent}%`, background: '#ca8a04', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '0.65rem', fontWeight: 700 }}>B ({abc.classB.count})</div>}
                {abc.classC.percent > 0 && <div style={{ width: `${abc.classC.percent}%`, background: '#16a34a', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '0.65rem', fontWeight: 700 }}>C ({abc.classC.count})</div>}
            </div>

            {/* Table */}
            <div style={{ background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                    <thead>
                        <tr style={{ background: 'var(--color-bg-base)', borderBottom: '1px solid var(--color-border)' }}>
                            {['#', 'Classe', 'Item', 'Descrição', 'Qtd.', 'Preço Unit.', 'Total', '% Total', '% Acum.'].map((h, i) => (
                                <th key={i} style={{ padding: '8px 10px', textAlign: i >= 4 ? 'right' : 'left', fontWeight: 600, color: 'var(--color-text-secondary)' }}>{h}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {abc.items.map((it: AbcItem) => {
                            const colors = CLASS_COLORS[it.classification];
                            return (
                                <tr key={it.rank} style={{ borderBottom: '1px solid var(--color-border)', background: it.classification === 'A' ? 'rgba(239,68,68,0.02)' : undefined }}>
                                    <td style={{ padding: '6px 10px', fontWeight: 600, color: 'var(--color-text-tertiary)' }}>{it.rank}</td>
                                    <td style={{ padding: '6px 10px' }}>
                                        <span style={{ display: 'inline-block', width: 24, height: 24, lineHeight: '24px', textAlign: 'center', borderRadius: '50%', background: colors.bg, color: colors.text, fontWeight: 800, fontSize: '0.7rem', border: `1px solid ${colors.border}` }}>
                                            {it.classification}
                                        </span>
                                    </td>
                                    <td style={{ padding: '6px 10px', fontWeight: 600 }}>{it.itemNumber}</td>
                                    <td style={{ padding: '6px 10px', maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.description}</td>
                                    <td style={{ padding: '6px 10px', textAlign: 'right' }}>{it.quantity}</td>
                                    <td style={{ padding: '6px 10px', textAlign: 'right' }}>{fmt(it.unitPrice)}</td>
                                    <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 700, color: colors.text }}>{fmt(it.totalPrice)}</td>
                                    <td style={{ padding: '6px 10px', textAlign: 'right' }}>{it.percentOfTotal.toFixed(2)}%</td>
                                    <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600 }}>{it.cumulativePercent.toFixed(2)}%</td>
                                </tr>
                            );
                        })}
                    </tbody>
                    <tfoot>
                        <tr style={{ background: 'var(--color-bg-base)', borderTop: '2px solid var(--color-border)' }}>
                            <td colSpan={6} style={{ padding: '10px', fontWeight: 700, textAlign: 'right' }}>TOTAL GLOBAL</td>
                            <td style={{ padding: '10px', textAlign: 'right', fontWeight: 800, color: 'var(--color-primary)', fontSize: '1rem' }}>{fmt(abc.totalGlobal)}</td>
                            <td style={{ padding: '10px', textAlign: 'right', fontWeight: 700 }}>100%</td>
                            <td></td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        </div>
    );
}
