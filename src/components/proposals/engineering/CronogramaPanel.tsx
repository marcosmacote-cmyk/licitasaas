/**
 * CronogramaPanel — Cronograma Físico-Financeiro
 * Tabela interativa: etapas x meses, com edição de percentuais.
 * 
 * FIX ARQ-04: Agora recebe onDataChange callback para persistir dados
 * no state do componente pai (EngineeringProposalEditor), evitando
 * perda de dados ao trocar de aba.
 * 
 * FIX F4.1: Auto-sync planilha → cronograma (etapa values update automatically)
 * FIX F4.2: Auto-distribuição (Linear / Curva S / Limpar)
 * FIX F4.3: Adicionar/Remover etapas manuais + edição de valor total
 */
import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { Calendar, Plus, Minus, Trash2, BarChart3, TrendingUp, RotateCcw, Cpu, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { calcularCronograma, gerarEtapasPadrao, type CronogramaEtapa } from './cronogramaEngine';
import { syncCronogramaFromItems } from './cronogramaSync';
import { isGrouper } from './types';
import { CronogramaImportModal } from './CronogramaImportModal';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

interface Props {
    items: { itemNumber: string; description: string; totalPrice: number; type?: string }[];
    /** Dados previamente salvos do cronograma — FIX ARQ-04 */
    savedData?: { meses: number; etapas: CronogramaEtapa[] } | null;
    /** Callback para persistir mudanças no pai — FIX ARQ-04 */
    onDataChange?: (data: { meses: number; etapas: CronogramaEtapa[] }) => void;
}

export function CronogramaPanel({ items, savedData, onDataChange }: Props) {
    // FIX ARQ-04: Inicializa a partir de dados salvos se disponíveis
    const [meses, setMeses] = useState(() => savedData?.meses || 6);
    const [showImportModal, setShowImportModal] = useState(false);
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

    // ══════════════════════════════════════════
    // FIX STAB/SYNC-01: Auto-sync planilha → cronograma
    // Uses unified cronogramaSync instead of inline duplicated logic
    // ══════════════════════════════════════════
    const prevItemsRef = useRef<string>('');
    useEffect(() => {
        if (items.length === 0) return;
        
        // Build fingerprint to avoid unnecessary updates
        const etapaItems = items.filter(it => it.type === 'ETAPA');
        if (etapaItems.length === 0) return;
        const fingerprint = etapaItems.map(e => `${e.itemNumber}:${e.totalPrice}`).join('|');
        if (fingerprint === prevItemsRef.current) return;
        prevItemsRef.current = fingerprint;

        setEtapas(prev => {
            const { etapas: updated, changed } = syncCronogramaFromItems(items, prev);
            return changed ? updated : prev;
        });
    }, [items]);

    const updatePct = useCallback((etapaId: string, mesIdx: number, val: number) => {
        setEtapas(prev => prev.map(e =>
            e.id === etapaId ? { ...e, percentuais: e.percentuais.map((p, i) => i === mesIdx ? val : p) } : e
        ));
    }, []);

    const updateNome = useCallback((id: string, nome: string) => {
        setEtapas(prev => prev.map(e => e.id === id ? { ...e, nome } : e));
    }, []);

    // ══════════════════════════════════════════
    // FIX F4.3: Add/Remove etapas
    // ══════════════════════════════════════════
    const addEtapa = useCallback(() => {
        const newId = String(Date.now());
        setEtapas(prev => [...prev, {
            id: newId,
            nome: `Nova Etapa ${prev.length + 1}`,
            valorTotal: 0,
            percentuais: Array(12).fill(0),
        }]);
    }, []);

    const removeEtapa = useCallback((id: string) => {
        setEtapas(prev => prev.length > 1 ? prev.filter(e => e.id !== id) : prev);
    }, []);

    const updateValorTotal = useCallback((id: string, valor: number) => {
        setEtapas(prev => prev.map(e => e.id === id ? { ...e, valorTotal: valor } : e));
    }, []);

    // ══════════════════════════════════════════
    // FIX F4.2: Auto-distribuição de percentuais
    // ══════════════════════════════════════════
    const distribuirLinear = useCallback(() => {
        const pctPerMonth = Math.round((100 / meses) * 100) / 100;
        const lastPct = Math.round((100 - pctPerMonth * (meses - 1)) * 100) / 100;
        setEtapas(prev => prev.map(e => ({
            ...e,
            percentuais: Array(12).fill(0).map((_, i) =>
                i < meses ? (i === meses - 1 ? lastPct : pctPerMonth) : 0
            ),
        })));
    }, [meses]);

    const distribuirCurvaS = useCallback(() => {
        // Bell curve (S-curve) — concentrates in the middle
        const raw: number[] = [];
        for (let i = 0; i < meses; i++) {
            const x = (i / (meses - 1 || 1)) * Math.PI;
            raw.push(Math.sin(x));
        }
        const sum = raw.reduce((a, b) => a + b, 0);
        const normalized = raw.map(v => Math.round((v / sum) * 10000) / 100);
        // Adjust last month to ensure exactly 100%
        const total = normalized.reduce((a, b) => a + b, 0);
        normalized[meses - 1] += Math.round((100 - total) * 100) / 100;

        setEtapas(prev => prev.map(e => ({
            ...e,
            percentuais: Array(12).fill(0).map((_, i) => i < meses ? normalized[i] : 0),
        })));
    }, [meses]);

    const limparDistribuicao = useCallback(() => {
        setEtapas(prev => prev.map(e => ({
            ...e,
            percentuais: Array(12).fill(0),
        })));
    }, []);

    const result = useMemo(() => calcularCronograma(etapas, meses), [etapas, meses]);

    const etapasInvalidas = useMemo(() => {
        return etapas
            .filter(e => e.valorTotal > 0)
            .map(e => {
                const soma = e.percentuais.slice(0, meses).reduce((s, p) => s + p, 0);
                const diff = Math.abs(soma - 100);
                return { etapa: e, soma, invalida: diff > 0.005 };
            })
            .filter(x => x.invalida);
    }, [etapas, meses]);

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
        <>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>

            {etapasInvalidas.length > 0 && (
                <div style={{
                    padding: '12px 16px',
                    background: 'rgba(239,68,68,0.06)',
                    border: '1px solid rgba(239,68,68,0.15)',
                    borderRadius: 'var(--radius-lg)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#dc2626', fontWeight: 700, fontSize: '0.85rem' }}>
                        <AlertTriangle size={16} />
                        Aviso: Inconsistência nos Percentuais de Execução
                    </div>
                    <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--color-text-secondary)', lineHeight: 1.4 }}>
                        As seguintes etapas não somam exatamente 100,00% de execução ao longo dos meses ativos. Ajuste os valores para garantir a consistência do cronograma físico-financeiro:
                    </p>
                    <ul style={{ margin: '4px 0 0 0', paddingLeft: 20, fontSize: '0.72rem', color: '#dc2626', fontWeight: 600 }}>
                        {etapasInvalidas.map(x => (
                            <li key={x.etapa.id}>
                                {x.etapa.nome}: soma atual é <strong>{x.soma.toFixed(2)}%</strong> (deve ser 100,00%)
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Controls */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 16px', background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', flexWrap: 'wrap' }}>
                <Calendar size={16} color="var(--color-primary)" />
                <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>Duração da obra:</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <button onClick={() => setMeses(m => Math.max(1, m - 1))} style={{ background: 'var(--color-bg-base)', border: '1px solid var(--color-border)', borderRadius: 4, cursor: 'pointer', padding: '2px 6px' }}><Minus size={12} /></button>
                    <span style={{ fontWeight: 800, fontSize: '1rem', minWidth: 32, textAlign: 'center' }}>{meses}</span>
                    <button onClick={() => setMeses(m => Math.min(36, m + 1))} style={{ background: 'var(--color-bg-base)', border: '1px solid var(--color-border)', borderRadius: 4, cursor: 'pointer', padding: '2px 6px' }}><Plus size={12} /></button>
                </div>
                <span style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>meses</span>

                {/* FIX F4.2: Distribution buttons */}
                <div style={{ width: 1, height: 20, background: 'var(--color-border)' }} />
                <button onClick={distribuirLinear} className="btn btn-outline"
                    style={{ padding: '4px 10px', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: 4 }}
                    title="Distribui 100% igualmente entre os meses">
                    <BarChart3 size={12} /> Linear
                </button>
                <button onClick={distribuirCurvaS} className="btn btn-outline"
                    style={{ padding: '4px 10px', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: 4 }}
                    title="Distribui com concentração no meio (curva S)">
                    <TrendingUp size={12} /> Curva S
                </button>
                <button onClick={limparDistribuicao} className="btn btn-outline"
                    style={{ padding: '4px 10px', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: 4 }}
                    title="Zera todos os percentuais">
                    <RotateCcw size={12} /> Limpar
                </button>

                <div style={{ width: 1, height: 20, background: 'var(--color-border)' }} />
                <button onClick={() => setShowImportModal(true)} className="btn btn-outline"
                    style={{ padding: '4px 10px', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: 4, borderColor: 'rgba(14,116,144,0.3)', color: '#0e7490' }}
                    title="Extrair cronograma de imagem/print via IA">
                    <Cpu size={12} /> Extração via IA
                </button>

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
                            <th style={{ ...cs, width: 110, fontWeight: 700 }}>Valor Total</th>
                            {Array.from({ length: meses }, (_, i) => (
                                <th key={i} style={{ ...cs, fontWeight: 700, minWidth: 70, textAlign: 'center' }}>Mês {i + 1}</th>
                            ))}
                            <th style={{ ...cs, width: 40, textAlign: 'center', fontWeight: 700 }}></th>
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
                                    {/* FIX F4.3: Editable valor total */}
                                    <td style={{ ...cs, fontWeight: 600 }}>
                                        <input
                                            type="number"
                                            value={etapa.valorTotal || ''}
                                            onChange={e => updateValorTotal(etapa.id, parseFloat(e.target.value) || 0)}
                                            style={{ width: '100%', border: '1px solid transparent', borderRadius: 3, background: 'transparent', textAlign: 'right', fontSize: '0.72rem', fontWeight: 600, padding: '2px 4px' }}
                                            onFocus={e => { e.currentTarget.style.borderColor = 'var(--color-primary)'; }}
                                            onBlur={e => { e.currentTarget.style.borderColor = 'transparent'; }}
                                        />
                                        <div style={{ fontSize: '0.6rem', color: pctSum === 100 ? 'var(--color-success)' : pctSum > 0 ? '#ca8a04' : 'var(--color-text-tertiary)' }}>
                                            {pctSum.toFixed(1)}%
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
                                    {/* FIX F4.3: Remove etapa button */}
                                    <td style={{ ...cs, textAlign: 'center' }}>
                                        <button onClick={() => removeEtapa(etapa.id)}
                                            disabled={result.etapas.length <= 1}
                                            style={{ background: 'none', border: 'none', cursor: result.etapas.length > 1 ? 'pointer' : 'default', padding: 2, color: result.etapas.length > 1 ? 'var(--color-danger)' : 'var(--color-text-tertiary)', opacity: result.etapas.length > 1 ? 0.6 : 0.2 }}
                                            title="Remover etapa">
                                            <Trash2 size={12} />
                                        </button>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                    <tfoot>
                        {/* FIX F4.3: Add etapa row */}
                        <tr>
                            <td colSpan={2 + meses + 1} style={{ padding: '6px 8px', borderBottom: '1px solid var(--color-border)' }}>
                                <button onClick={addEtapa} className="btn btn-outline"
                                    style={{ padding: '3px 10px', fontSize: '0.72rem', display: 'flex', alignItems: 'center', gap: 4 }}>
                                    <Plus size={12} /> Adicionar Etapa
                                </button>
                            </td>
                        </tr>
                        <tr style={{ background: 'rgba(37,99,235,0.04)', borderTop: '2px solid var(--color-primary)' }}>
                            <td style={{ ...cs, textAlign: 'left', fontWeight: 800, color: 'var(--color-primary)' }}>Mensal</td>
                            <td style={cs}></td>
                            {result.mensalTotal.map((v, i) => (
                                <td key={i} style={{ ...cs, fontWeight: 700, textAlign: 'center', color: 'var(--color-primary)' }}>
                                    {fmt(v)}
                                    <div style={{ fontSize: '0.58rem', color: 'var(--color-text-tertiary)' }}>{result.percentMensal[i]}%</div>
                                </td>
                            ))}
                            <td style={cs}></td>
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
                            <td style={cs}></td>
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

            {showImportModal && (
                <CronogramaImportModal
                    onClose={() => setShowImportModal(false)}
                    onImport={(data) => {
                        setMeses(data.meses);
                        setEtapas(data.etapas);
                        setShowImportModal(false);
                    }}
                    existingEtapas={etapas.map(e => e.nome)}
                />
            )}
        </>
    );
}
