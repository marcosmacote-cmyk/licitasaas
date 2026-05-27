/**
 * AjusteInteligenteModal.tsx — Ajuste inteligente de proposta de engenharia
 * 
 * Oferece 4 estratégias de desconto com foco em compliance de licitações:
 * 1. LINEAR_SEGURO: Trava mão de obra e encargos complementares a 0%, aplicando desconto nos demais.
 * 2. CURVA_ABC: Aplica descontos baseados no peso Pareto (A: 80%, B: 15%, C: 5%) preservando mão de obra.
 * 3. COEFICIENTES: Otimiza os coeficientes de produtividade de insumos não-trabalho.
 * 4. BDI: Reduz a taxa global de BDI.
 */
import React, { useState } from 'react';
import { X, Wand2, ShieldCheck, AlertTriangle, Scale, Percent, Landmark, HelpCircle, Loader2 } from 'lucide-react';

interface AjusteInteligenteModalProps {
    proposalId: string;
    currentValue: number;
    estimatedValue?: number;
    onClose: () => void;
    onSuccess: () => void;
}

type Strategy = 'LINEAR_SEGURO' | 'CURVA_ABC' | 'COEFICIENTES' | 'BDI';

export function AjusteInteligenteModal({ proposalId, currentValue, estimatedValue, onClose, onSuccess }: AjusteInteligenteModalProps) {
    const [strategy, setStrategy] = useState<Strategy>('LINEAR_SEGURO');
    const [targetValueInput, setTargetValueInput] = useState<string>('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    const getNumericTargetValue = (): number => {
        const clean = targetValueInput.replace(/\D/g, '');
        if (!clean) return 0;
        return parseFloat(clean) / 100;
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value.replace(/\D/g, '');
        if (!val) {
            setTargetValueInput('');
            return;
        }
        const numeric = parseFloat(val) / 100;
        setTargetValueInput(
            numeric.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        );
    };

    const targetValue = getNumericTargetValue();
    const discountAmount = currentValue - targetValue;
    const discountPercent = currentValue > 0 && targetValue > 0 ? (discountAmount / currentValue) * 100 : 0;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);

        if (targetValue <= 0) {
            setError('Por favor, informe um valor alvo válido.');
            return;
        }

        if (targetValue >= currentValue) {
            setError('O valor alvo deve ser menor que o valor atual para aplicar um ajuste de desconto.');
            return;
        }

        setIsLoading(true);
        try {
            const token = localStorage.getItem('token');
            const res = await fetch(`/api/engineering/proposals/${proposalId}/ajuste-inteligente`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
                },
                body: JSON.stringify({
                    targetValue,
                    strategy,
                }),
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || 'Erro ao aplicar ajuste inteligente');
            }

            onSuccess();
            onClose();
        } catch (err: any) {
            setError(err.message || 'Ocorreu um erro ao processar o ajuste.');
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div style={{
            position: 'fixed', inset: 0,
            background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1100, padding: 16
        }}>
            <div style={{
                background: 'var(--color-bg-surface)',
                border: '1px solid var(--color-border)', borderRadius: 16,
                width: 980, maxWidth: '95vw',
                height: 650, maxHeight: '90vh',
                display: 'flex', flexDirection: 'column',
                boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
                overflow: 'hidden',
                animation: 'scaleUp 0.2s cubic-bezier(0.16, 1, 0.3, 1)'
            }}>
                {/* Header */}
                <div style={{
                    padding: '18px 24px', borderBottom: '1px solid var(--color-border)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.05) 0%, rgba(59, 130, 246, 0) 100%)'
                }}>
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <Wand2 size={20} color="var(--color-primary)" />
                            <h3 style={{ margin: 0, fontSize: '1.15rem', fontWeight: 700 }}>
                                Ajuste Inteligente de Proposta
                            </h3>
                        </div>
                        <span style={{ fontSize: '0.78rem', color: 'var(--color-text-tertiary)', marginTop: 2, display: 'block' }}>
                            Simule e aplique redutores de preço em conformidade jurídica com a jurisprudência de licitações.
                        </span>
                    </div>
                    <button onClick={onClose} style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        padding: 6, borderRadius: '50%', color: 'var(--color-text-tertiary)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-base)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Content */}
                <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
                    {/* Left Column: Form & Strategies */}
                    <div style={{ width: '60%', padding: 24, borderRight: '1px solid var(--color-border)', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
                        {/* Target Value Input Section */}
                        <div style={{
                            display: 'flex', gap: 16, background: 'var(--color-bg-base)', padding: 16, borderRadius: 12, border: '1px solid var(--color-border)'
                        }}>
                            <div style={{ flex: 1 }}>
                                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-text-secondary)', marginBottom: 6 }}>
                                    VALOR ALVO DA PROPOSTA
                                </label>
                                <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                                    <span style={{ position: 'absolute', left: 12, fontSize: '1rem', fontWeight: 700, color: 'var(--color-text-secondary)' }}>R$</span>
                                    <input
                                        type="text"
                                        placeholder="0,00"
                                        value={targetValueInput}
                                        onChange={handleInputChange}
                                        style={{
                                            width: '100%',
                                            padding: '10px 12px 10px 38px',
                                            fontSize: '1.25rem',
                                            fontWeight: 800,
                                            border: '2px solid var(--color-border)',
                                            borderRadius: 8,
                                            outline: 'none',
                                            transition: 'border-color 0.2s',
                                            fontFamily: 'monospace',
                                        }}
                                        onFocus={e => e.currentTarget.style.borderColor = 'var(--color-primary)'}
                                        onBlur={e => e.currentTarget.style.borderColor = 'var(--color-border)'}
                                    />
                                </div>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', borderLeft: '1px solid var(--color-border)', paddingLeft: 16, minWidth: 160 }}>
                                <span style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)' }}>Valor Atual:</span>
                                <span style={{ fontSize: '0.95rem', fontWeight: 700 }}>{fmt(currentValue)}</span>
                                {estimatedValue && estimatedValue > 0 && (
                                    <>
                                        <span style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)', marginTop: 4 }}>Orçamento Estimado:</span>
                                        <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text-secondary)' }}>{fmt(estimatedValue)}</span>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Strategies Grid */}
                        <div>
                            <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, color: 'var(--color-text-secondary)', marginBottom: 10 }}>
                                ESTRATÉGIA DE REDUÇÃO
                            </label>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                                {/* LINEAR_SEGURO */}
                                <div
                                    onClick={() => setStrategy('LINEAR_SEGURO')}
                                    style={{
                                        border: `2px solid ${strategy === 'LINEAR_SEGURO' ? 'var(--color-primary)' : 'var(--color-border)'}`,
                                        background: strategy === 'LINEAR_SEGURO' ? 'rgba(59, 130, 246, 0.03)' : 'var(--color-bg-surface)',
                                        padding: 14, borderRadius: 10, cursor: 'pointer', transition: 'all 0.15s',
                                        display: 'flex', flexDirection: 'column', gap: 6
                                    }}
                                >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: '0.82rem' }}>
                                            <ShieldCheck size={14} color="#10b981" />
                                            Linear Seguro
                                        </div>
                                        <span style={{ fontSize: '0.62rem', background: 'rgba(16,185,129,0.1)', color: '#059669', padding: '2px 6px', borderRadius: 4, fontWeight: 700 }}>Recomendado</span>
                                    </div>
                                    <p style={{ margin: 0, fontSize: '0.7rem', color: 'var(--color-text-tertiary)', lineHeight: 1.4 }}>
                                        Desconto linear apenas em materiais/equipamentos. Trava mão de obra e encargos a 0%.
                                    </p>
                                </div>

                                {/* CURVA_ABC */}
                                <div
                                    onClick={() => setStrategy('CURVA_ABC')}
                                    style={{
                                        border: `2px solid ${strategy === 'CURVA_ABC' ? 'var(--color-primary)' : 'var(--color-border)'}`,
                                        background: strategy === 'CURVA_ABC' ? 'rgba(59, 130, 246, 0.03)' : 'var(--color-bg-surface)',
                                        padding: 14, borderRadius: 10, cursor: 'pointer', transition: 'all 0.15s',
                                        display: 'flex', flexDirection: 'column', gap: 6
                                    }}
                                >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: '0.82rem' }}>
                                            <Percent size={14} color="#3b82f6" />
                                            Curva ABC
                                        </div>
                                        <span style={{ fontSize: '0.62rem', background: 'rgba(59,130,246,0.1)', color: '#2563eb', padding: '2px 6px', borderRadius: 4, fontWeight: 700 }}>Seguro</span>
                                    </div>
                                    <p style={{ margin: 0, fontSize: '0.7rem', color: 'var(--color-text-tertiary)', lineHeight: 1.4 }}>
                                        Distribui o desconto com base no peso de relevância ABC. Mão de obra protegida.
                                    </p>
                                </div>

                                {/* COEFICIENTES */}
                                <div
                                    onClick={() => setStrategy('COEFICIENTES')}
                                    style={{
                                        border: `2px solid ${strategy === 'COEFICIENTES' ? 'var(--color-primary)' : 'var(--color-border)'}`,
                                        background: strategy === 'COEFICIENTES' ? 'rgba(59, 130, 246, 0.03)' : 'var(--color-bg-surface)',
                                        padding: 14, borderRadius: 10, cursor: 'pointer', transition: 'all 0.15s',
                                        display: 'flex', flexDirection: 'column', gap: 6
                                    }}
                                >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: '0.82rem' }}>
                                            <Scale size={14} color="#f59e0b" />
                                            Otimizar Coeficientes
                                        </div>
                                        <span style={{ fontSize: '0.62rem', background: 'rgba(245,158,11,0.1)', color: '#d97706', padding: '2px 6px', borderRadius: 4, fontWeight: 700 }}>Risco Moderado</span>
                                    </div>
                                    <p style={{ margin: 0, fontSize: '0.7rem', color: 'var(--color-text-tertiary)', lineHeight: 1.4 }}>
                                        Reduz coeficientes de consumo de insumos de materiais/equipamentos de forma assistida.
                                    </p>
                                </div>

                                {/* BDI */}
                                <div
                                    onClick={() => setStrategy('BDI')}
                                    style={{
                                        border: `2px solid ${strategy === 'BDI' ? 'var(--color-primary)' : 'var(--color-border)'}`,
                                        background: strategy === 'BDI' ? 'rgba(59, 130, 246, 0.03)' : 'var(--color-bg-surface)',
                                        padding: 14, borderRadius: 10, cursor: 'pointer', transition: 'all 0.15s',
                                        display: 'flex', flexDirection: 'column', gap: 6
                                    }}
                                >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: '0.82rem' }}>
                                            <Landmark size={14} color="#8b5cf6" />
                                            Redução de BDI
                                        </div>
                                        <span style={{ fontSize: '0.62rem', background: 'rgba(139,92,246,0.1)', color: '#7c3aed', padding: '2px 6px', borderRadius: 4, fontWeight: 700 }}>Seguro</span>
                                    </div>
                                    <p style={{ margin: 0, fontSize: '0.7rem', color: 'var(--color-text-tertiary)', lineHeight: 1.4 }}>
                                        Ajusta a taxa de BDI global da proposta para atingir o valor sem alterar custo de insumos.
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Simulation Preview Block */}
                        {targetValue > 0 && targetValue < currentValue && (
                            <div style={{ background: 'var(--color-bg-base)', border: '1px solid var(--color-border)', borderRadius: 10, padding: 14 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: '0.75rem' }}>
                                    <span style={{ color: 'var(--color-text-secondary)', fontWeight: 600 }}>Simulação do Reajuste:</span>
                                    <span style={{ color: '#ef4444', fontWeight: 700 }}>-{discountPercent.toFixed(2)}% de desconto</span>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginTop: 8 }}>
                                    <div style={{ background: 'var(--color-bg-surface)', padding: 10, borderRadius: 6, border: '1px solid var(--color-border)' }}>
                                        <div style={{ fontSize: '0.65rem', color: 'var(--color-text-tertiary)' }}>DIFERENÇA (DESCONTO)</div>
                                        <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#ef4444', fontFamily: 'monospace' }}>{fmt(discountAmount)}</div>
                                    </div>
                                    <div style={{ background: 'var(--color-bg-surface)', padding: 10, borderRadius: 6, border: '1px solid var(--color-border)' }}>
                                        <div style={{ fontSize: '0.65rem', color: 'var(--color-text-tertiary)' }}>VALOR FINAL ESTIMADO</div>
                                        <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-success)', fontFamily: 'monospace' }}>{fmt(targetValue)}</div>
                                    </div>
                                    <div style={{ background: 'var(--color-bg-surface)', padding: 10, borderRadius: 6, border: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                                        <div style={{ fontSize: '0.65rem', color: 'var(--color-text-tertiary)' }}>MÃO DE OBRA</div>
                                        <div style={{ fontSize: '0.78rem', fontWeight: 700, color: strategy === 'LINEAR_SEGURO' || strategy === 'CURVA_ABC' ? '#10b981' : '#f59e0b' }}>
                                            {strategy === 'LINEAR_SEGURO' || strategy === 'CURVA_ABC' ? 'Protegida (0% desc)' : 'Sem trava'}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Error Message */}
                        {error && (
                            <div style={{
                                padding: '12px 16px', background: 'rgba(239,68,68,0.06)',
                                border: '1px solid rgba(239,68,68,0.3)', borderRadius: 10,
                                color: '#dc2626', fontSize: '0.78rem', lineHeight: 1.5,
                                display: 'flex', gap: 10, alignItems: 'flex-start'
                            }}>
                                <AlertTriangle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
                                <div>
                                    <strong style={{ display: 'block', marginBottom: 4 }}>Erro ao Executar Ajuste</strong>
                                    {error}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Right Column: Legal References & Explanations */}
                    <div style={{ width: '40%', padding: 24, background: 'var(--color-bg-base)', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid var(--color-border)', paddingBottom: 10 }}>
                            <Scale size={16} color="var(--color-text-secondary)" />
                            <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--color-text-secondary)' }}>Doutrina & Riscos de Desclassificação</span>
                        </div>

                        {/* Risk Card 1 */}
                        <div style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', borderRadius: 10, padding: 14 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: '0.76rem', color: '#dc2626', marginBottom: 6 }}>
                                <AlertTriangle size={13} />
                                Inexequibilidade de Mão de Obra
                            </div>
                            <p style={{ margin: '0 0 8px', fontSize: '0.7rem', color: 'var(--color-text-secondary)', lineHeight: 1.4 }}>
                                Reduzir preços unitários de profissionais (salários de acordos coletivos) ou custos de encargos sociais e complementares (alimentação, EPI) é causa de <strong>desclassificação sumária</strong> pela maioria dos órgãos públicos.
                            </p>
                            <span style={{ fontSize: '0.62rem', color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>
                                Ref: Acórdão TCU 1097/2019-Plenário & Súmula TST 331.
                            </span>
                        </div>

                        {/* Risk Card 2 */}
                        <div style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', borderRadius: 10, padding: 14 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: '0.76rem', color: '#d97706', marginBottom: 6 }}>
                                <Landmark size={13} />
                                Jogo de Planilha (Overpricing/Underpricing)
                            </div>
                            <p style={{ margin: '0 0 8px', fontSize: '0.7rem', color: 'var(--color-text-secondary)', lineHeight: 1.4 }}>
                                Alterar assimetricamente preços unitários de itens de alta relevância (Curva A) para valores excessivamente abaixo do mercado, com posterior compensação em itens da Curva C, constitui distorção gravíssima de planilha.
                            </p>
                            <span style={{ fontSize: '0.62rem', color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>
                                Ref: Súmula TCU 259 & Lei 14.133/2021 (Nova Lei de Licitações).
                            </span>
                        </div>

                        {/* Risk Card 3 */}
                        <div style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', borderRadius: 10, padding: 14 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: '0.76rem', color: '#2563eb', marginBottom: 6 }}>
                                <HelpCircle size={13} />
                                Produtividade e Coeficientes
                            </div>
                            <p style={{ margin: '0 0 8px', fontSize: '0.7rem', color: 'var(--color-text-secondary)', lineHeight: 1.4 }}>
                                Ao otimizar coeficientes, você reduz o consumo teórico estimado na composição de custo (ex: horas necessárias para assentar 1m² de tijolo). Licitantes podem ter de apresentar laudo técnico detalhado provando a viabilidade produtiva.
                            </p>
                            <span style={{ fontSize: '0.62rem', color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>
                                Ref: Acórdão TCU 3020/2013-Plenário.
                            </span>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div style={{
                    padding: '16px 24px', borderTop: '1px solid var(--color-border)',
                    background: 'var(--color-bg-surface)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                }}>
                    <div style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)' }}>
                        {isLoading ? 'Ajustando planilhas, duplicando itens e recalculando composições...' : 'O processo salvará uma cópia local dos insumos oficiais na base Própria.'}
                    </div>
                    <div style={{ display: 'flex', gap: 12 }}>
                        <button onClick={onClose} className="btn btn-outline" style={{ padding: '8px 16px', fontSize: '0.82rem' }} disabled={isLoading}>
                            Cancelar
                        </button>
                        <button
                            onClick={handleSubmit}
                            className="btn btn-primary"
                            disabled={isLoading || targetValue <= 0 || targetValue >= currentValue}
                            style={{ padding: '8px 20px', fontSize: '0.82rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}
                        >
                            {isLoading ? (
                                <>
                                    <Loader2 size={14} className="spin" /> Processando...
                                </>
                            ) : (
                                <>
                                    Aplicar Ajuste <Wand2 size={14} />
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
