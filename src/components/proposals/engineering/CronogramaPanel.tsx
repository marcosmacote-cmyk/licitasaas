/**
 * CronogramaPanel — Cronograma Físico-Financeiro
 * Tabela interativa: etapas x meses, com edição de percentuais.
 * 
 * FIX ARQ-04: Agora recebe onDataChange callback para persistir dados
 * no state do componente pai (EngineeringProposalEditor), evitando
 * perda de dados ao trocar de aba.
 */
import { useState, useMemo, useCallback, useEffect } from 'react';
import { Calendar, Plus, Minus } from 'lucide-react';
import { calcularCronograma, gerarEtapasPadrao, type CronogramaEtapa } from './cronogramaEngine';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

interface Props {
    items: { itemNumber: string; description: string; totalPrice: number }[];
    /** Dados previamente salvos do cronograma — FIX ARQ-04 */
    savedData?: { meses: number; etapas: CronogramaEtapa[] } | null;
    /** Callback para persistir mudanças no pai — FIX ARQ-04 */
    onDataChange?: (data: { meses: number; etapas: CronogramaEtapa[] }) => void;
}

export function CronogramaPanel({ items, savedData, onDataChange }: Props) {
    // FIX ARQ-04: Inicializa a partir de dados salvos se disponíveis
    const [meses, setMeses] = useState(() => savedData?.meses || 6);
    const [etapas, setEtapas] = useState<CronogramaEtapa[]>(() => {
        if (savedData?.etapas && savedData.etapas.length > 0) return savedData.etapas;
        const auto = gerarEtapasPadrao(items);
        return auto.length > 0 ? auto.map(e => ({ ...e, percentuais: Array(12).fill(0) })) : [
            { id: '1', nome: 'Serviços Preliminares', valorTotal: 0, percentuais: Array(12).fill(0) },
        ];
    });

    // FIX ARQ-04: Notifica o pai sempre que dados mudam
    useEffect(() => {
        onDataChange?.({ meses, etapas });
    }, [meses, etapas]); // eslint-disable-line react-hooks/exhaustive-deps

    const updatePct = useCallback((etapaId: string, mesIdx: number, val: number) => {
        setEtapas(prev => prev.map(e =>
            e.id === etapaId ? { ...e, percentuais: e.percentuais.map((p, i) => i === mesIdx ? val : p) } : e
        ));
    }, []);

    const updateNome = useCallback((id: string, nome: string) => {
        setEtapas(prev => prev.map(e => e.id === id ? { ...e, nome } : e));
    }, []);

    const result = useMemo(() => calcularCronograma(etapas, meses), [etapas, meses]);

    if (items.length === 0) {
        return (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-tertiary)', border: '2px dashed var(--color-border)', borderRadius: 'var(--radius-xl)' }}>
                <Calendar size={32} style={{ opacity: 0.3, margin: '0 auto 8px' }} />
                <div style={{ fontWeight: 600 }}>Cronograma indisponível</div>
                <div style={{ fontSize: '0.85rem', marginTop: 4 }}>Adicione itens na planilha para gerar o cronograma.</div>
            </div>
        );
    }

    const cs: React.CSSProperties = { padding: '4px 6px', fontSize: '0.72rem', textAlign: 'right', borderRight: '1px solid var(--color-border)', borderBottom: '1px solid var(--color-border)' };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>

            {/* Controls */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 16px', background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }}>
                <Calendar size={16} color="var(--color-primary)" />
                <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>Duração da obra:</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <button onClick={() => setMeses(m => Math.max(1, m - 1))} style={{ background: 'var(--color-bg-base)', border: '1px solid var(--color-border)', borderRadius: 4, cursor: 'pointer', padding: '2px 6px' }}><Minus size={12} /></button>
                    <span style={{ fontWeight: 800, fontSize: '1rem', minWidth: 32, textAlign: 'center' }}>{meses}</span>
                    <button onClick={() => setMeses(m => Math.min(36, m + 1))} style={{ background: 'var(--color-bg-base)', border: '1px solid var(--color-border)', borderRadius: 4, cursor: 'pointer', padding: '2px 6px' }}><Plus size={12} /></button>
                </div>
                <span style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>meses</span>
                <div style={{ marginLeft: 'auto', fontSize: '0.8rem', color: 'var(--color-text-tertiary)' }}>
                    Total: <strong style={{ color: 'var(--color-primary)' }}>{fmt(result.totalGlobal)}</strong>
                </div>
            </div>

            {/* Table */}
            <div style={{ background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 600 + meses * 70 }}>
                    <thead>
                        <tr style={{ background: 'var(--color-bg-base)' }}>
                            <th style={{ ...cs, textAlign: 'left', width: 200, fontWeight: 700 }}>Etapa</th>
                            <th style={{ ...cs, width: 90, fontWeight: 700 }}>Valor Total</th>
                            {Array.from({ length: meses }, (_, i) => (
                                <th key={i} style={{ ...cs, fontWeight: 700, minWidth: 70, textAlign: 'center' }}>Mês {i + 1}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {result.etapas.map(etapa => {
                            const pctSum = etapa.percentuais.slice(0, meses).reduce((s, p) => s + p, 0);
                            return (
                                <tr key={etapa.id}>
                                    <td style={{ ...cs, textAlign: 'left' }}>
                                        <input value={etapa.nome} onChange={e => updateNome(etapa.id, e.target.value)}
                                            style={{ border: 'none', background: 'transparent', fontSize: '0.75rem', fontWeight: 600, width: '100%', padding: 0 }} />
                                    </td>
                                    <td style={{ ...cs, fontWeight: 600 }}>
                                        {fmt(etapa.valorTotal)}
                                        <div style={{ fontSize: '0.6rem', color: pctSum === 100 ? 'var(--color-success)' : pctSum > 0 ? '#ca8a04' : 'var(--color-text-tertiary)' }}>
                                            {pctSum}%
                                        </div>
                                    </td>
                                    {Array.from({ length: meses }, (_, m) => (
                                        <td key={m} style={{ ...cs, textAlign: 'center', padding: '2px 4px' }}>
                                            <input type="number" min={0} max={100} step={5}
                                                value={etapa.percentuais[m] || ''}
                                                onChange={e => updatePct(etapa.id, m, parseFloat(e.target.value) || 0)}
                                                placeholder="0"
                                                style={{ width: '100%', border: '1px solid transparent', borderRadius: 3, background: (etapa.percentuais[m] || 0) > 0 ? 'rgba(37,99,235,0.06)' : 'transparent', textAlign: 'center', fontSize: '0.72rem', padding: '3px 2px' }}
                                                onFocus={e => { e.currentTarget.style.borderColor = 'var(--color-primary)'; }}
                                                onBlur={e => { e.currentTarget.style.borderColor = 'transparent'; }}
                                            />
                                            {(etapa.valoresMensais[m] || 0) > 0 && (
                                                <div style={{ fontSize: '0.58rem', color: 'var(--color-text-tertiary)', marginTop: 1 }}>
                                                    {fmt(etapa.valoresMensais[m])}
                                                </div>
                                            )}
                                        </td>
                                    ))}
                                </tr>
                            );
                        })}
                    </tbody>
                    <tfoot>
                        <tr style={{ background: 'rgba(37,99,235,0.04)', borderTop: '2px solid var(--color-primary)' }}>
                            <td style={{ ...cs, textAlign: 'left', fontWeight: 800, color: 'var(--color-primary)' }}>Mensal</td>
                            <td style={cs}></td>
                            {result.mensalTotal.map((v, i) => (
                                <td key={i} style={{ ...cs, fontWeight: 700, textAlign: 'center', color: 'var(--color-primary)' }}>
                                    {fmt(v)}
                                    <div style={{ fontSize: '0.58rem', color: 'var(--color-text-tertiary)' }}>{result.percentMensal[i]}%</div>
                                </td>
                            ))}
                        </tr>
                        <tr style={{ background: 'rgba(37,99,235,0.08)' }}>
                            <td style={{ ...cs, textAlign: 'left', fontWeight: 800, color: 'var(--color-primary)' }}>Acumulado</td>
                            <td style={cs}></td>
                            {result.acumulado.map((v, i) => (
                                <td key={i} style={{ ...cs, fontWeight: 800, textAlign: 'center', color: 'var(--color-primary)' }}>
                                    {fmt(v)}
                                    <div style={{ fontSize: '0.58rem', fontWeight: 700, color: 'var(--color-primary)' }}>{result.percentAcumulado[i]}%</div>
                                </td>
                            ))}
                        </tr>
                    </tfoot>
                </table>
            </div>

            {/* Visual bar */}
            <div style={{ display: 'flex', height: 24, borderRadius: 'var(--radius-sm)', overflow: 'hidden', border: '1px solid var(--color-border)' }}>
                {result.mensalTotal.map((v, i) => {
                    const pct = result.totalGlobal > 0 ? (v / result.totalGlobal) * 100 : 0;
                    return pct > 0 ? (
                        <div key={i} style={{ width: `${pct}%`, background: `hsl(${220 + i * 15}, 70%, ${55 + (i % 2) * 10}%)`, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '0.55rem', fontWeight: 700 }}>
                            M{i + 1}
                        </div>
                    ) : null;
                })}
            </div>
        </div>
    );
}
