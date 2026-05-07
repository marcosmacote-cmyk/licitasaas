/**
 * Step1ConfigPanel.tsx — Configuração do Orçamento (Step 1 do Wizard)
 * Agrupa: Dados do Orçamento, BDI (TCU 2622), Encargos Sociais
 */
import { useState } from 'react';
import { Wrench, Calculator, Wand2, Loader2, Split, ChevronDown, RefreshCw, Save, Users } from 'lucide-react';
import { calculateBdiTCU, autoDistributeBdi, DEFAULT_TCU_FORNECIMENTO_PARAMS, type BdiConfig, type BdiTcuParams } from '../bdiEngine';
import type { EngineeringConfig } from '../types';

const BRAZILIAN_UFS = [
    'AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT',
    'PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO',
];

function parseLocaleNumber(value: unknown, fallback = 0): number {
    if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
    const raw = String(value ?? '').trim();
    if (!raw) return fallback;
    const normalized = raw.includes(',') ? raw.replace(/\./g, '').replace(',', '.') : raw;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : fallback;
}

interface Props {
    engineeringConfig: EngineeringConfig;
    bdiConfig: BdiConfig;
    isExtractingBdi: boolean;
    isAuditing: boolean;
    isSaving: boolean;
    isExtractingConfig?: boolean;
    isExtractingEncargos?: boolean;
    onConfigChange: (config: EngineeringConfig) => void;
    onBdiChange: (config: BdiConfig) => void;
    onExtractBdi: () => void;
    onExtractBdiFornecimento?: () => void;
    onExtractConfig?: () => void;
    onExtractEncargos?: () => void;
    onSyncBases: () => void;
    onSave: () => void;
    onNext: () => void;
}

export function Step1ConfigPanel({
    engineeringConfig, bdiConfig, isExtractingBdi, isExtractingConfig, isExtractingEncargos, isAuditing, isSaving,
    onConfigChange, onBdiChange, onExtractBdi, onExtractBdiFornecimento, onExtractConfig, onExtractEncargos, onSyncBases, onSave, onNext,
}: Props) {
    const [showEncargosDetail, setShowEncargosDetail] = useState(false);
    const [showEncargos2, setShowEncargos2] = useState(!!engineeringConfig.encargosSociais?.encargos2);
    const effectiveBdi = bdiConfig.bdiGlobal;

    const updateTcu = (field: keyof BdiTcuParams, val: number) => {
        const nextTcu = { ...bdiConfig.tcu, [field]: val };
        const calculatedBdi = calculateBdiTCU(nextTcu);
        onBdiChange({ ...bdiConfig, mode: 'TCU', tcu: nextTcu, bdiGlobal: calculatedBdi });
    };

    const updateTcuFornecimento = (field: keyof BdiTcuParams, val: number) => {
        const nextTcu = { ...(bdiConfig.tcuFornecimento || DEFAULT_TCU_FORNECIMENTO_PARAMS), [field]: val };
        const calculatedBdi = calculateBdiTCU(nextTcu);
        onConfigChange({ ...engineeringConfig, bdiFornecimento: calculatedBdi });
        onBdiChange({ ...bdiConfig, tcuFornecimento: nextTcu });
    };
    const tcuF = bdiConfig.tcuFornecimento || DEFAULT_TCU_FORNECIMENTO_PARAMS;

    const sectionStyle: React.CSSProperties = {
        background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--color-border)', padding: 24, display: 'flex', flexDirection: 'column', gap: 16,
    };
    const labelStyle: React.CSSProperties = {
        display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 6,
    };
    const inputStyle: React.CSSProperties = {
        width: '100%', fontSize: '0.85rem', background: 'var(--color-bg-base)', padding: '6px 10px',
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>

                {/* ═══ LEFT COLUMN: Dados do Orçamento ═══ */}
                <div style={sectionStyle}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Wrench size={18} color="var(--color-primary)" />
                            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>Dados do Orçamento</h3>
                        </div>
                        {onExtractConfig && (
                            <button style={{ padding: '8px 16px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: 6, background: 'linear-gradient(135deg, #3b82f6, #6366f1)', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', cursor: isExtractingConfig ? 'wait' : 'pointer', opacity: isExtractingConfig ? 0.7 : 1, fontWeight: 700, boxShadow: '0 2px 8px rgba(99,102,241,0.25)', transition: 'all 0.2s' }}
                                onClick={onExtractConfig} disabled={isExtractingConfig}>
                                {isExtractingConfig ? <Loader2 size={14} className="spin" /> : <Wand2 size={14} />} Extrair via IA
                            </button>
                        )}
                    </div>

                    {/* Objeto */}
                    <div>
                        <label style={labelStyle}>Objeto da Obra</label>
                        <textarea className="form-input" rows={2} value={engineeringConfig.objeto}
                            onChange={e => onConfigChange({ ...engineeringConfig, objeto: e.target.value })}
                            placeholder="Ex: Construção de quadra poliesportiva..."
                            style={{ ...inputStyle, resize: 'none', padding: '8px 12px', borderRadius: 'var(--radius-md)' }} />
                    </div>

                    {/* UF */}
                    <div>
                        <label style={labelStyle}>UF da Obra / Base Oficial</label>
                        <select className="form-select" value={engineeringConfig.ufReferencia || ''}
                            onChange={e => onConfigChange({ ...engineeringConfig, ufReferencia: e.target.value })}
                            style={inputStyle}>
                            <option value="">Automático</option>
                            {BRAZILIAN_UFS.map(uf => <option key={uf} value={uf}>{uf}</option>)}
                        </select>
                    </div>

                    {/* Bases */}
                    <div>
                        <label style={labelStyle}>Bases de Referência</label>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {['SINAPI', 'SEINFRA', 'SICOR', 'ORSE', 'SICRO', 'SBC', 'PROPRIA'].map(base => {
                                const isChecked = engineeringConfig.basesConsideradas.includes(base);
                                return (
                                    <label key={base} style={{
                                        display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', fontWeight: 600,
                                        background: isChecked ? 'var(--color-primary-light)' : 'var(--color-bg-base)',
                                        color: isChecked ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                                        padding: '4px 10px', borderRadius: 'var(--radius-full)',
                                        border: `1px solid ${isChecked ? 'var(--color-primary)' : 'var(--color-border)'}`,
                                        cursor: 'pointer', transition: 'all 0.2s', userSelect: 'none',
                                    }}>
                                        <input type="checkbox" checked={isChecked} style={{ display: 'none' }}
                                            onChange={e => {
                                                const b = engineeringConfig.basesConsideradas;
                                                onConfigChange({ ...engineeringConfig, basesConsideradas: e.target.checked ? [...b, base] : b.filter(x => x !== base) });
                                            }} />
                                        {base}
                                    </label>
                                );
                            })}
                        </div>
                    </div>

                    {/* Regime */}
                    <div>
                        <label style={labelStyle}>Regime de Desoneração</label>
                        <select className="form-select" value={engineeringConfig.regimeOneracao}
                            onChange={e => onConfigChange({ ...engineeringConfig, regimeOneracao: e.target.value as 'DESONERADO' | 'ONERADO' })}
                            style={inputStyle}>
                            <option value="DESONERADO">Desonerado</option>
                            <option value="ONERADO">Onerado</option>
                        </select>
                    </div>

                    {/* Data Base por Fonte */}
                    <div>
                        <label style={labelStyle}>Data Base (Referência Temporal)</label>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, background: 'var(--color-bg-base)', padding: 10, borderRadius: 'var(--radius-md)' }}>
                            {engineeringConfig.basesConsideradas.length === 0 && <span style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>Nenhuma base selecionada</span>}
                            {engineeringConfig.basesConsideradas.map(base => (
                                <div key={base} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-secondary)' }}>{base}</span>
                                    <input type="month" className="form-input"
                                        value={engineeringConfig.dataBases?.[base] || engineeringConfig.dataBase || ''}
                                        onChange={e => onConfigChange({
                                            ...engineeringConfig,
                                            dataBase: engineeringConfig.dataBase || e.target.value,
                                            dataBases: { ...engineeringConfig.dataBases, [base]: e.target.value }
                                        })}
                                        style={{ width: 140, fontSize: '0.8rem', padding: '4px 8px' }} />
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Arredondamento */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                        <div>
                            <label style={labelStyle}>Critério de Arredondamento</label>
                            <select className="form-select" value={engineeringConfig.precision.tipo}
                                onChange={e => onConfigChange({ ...engineeringConfig, precision: { ...engineeringConfig.precision, tipo: e.target.value as 'ROUND' | 'TRUNCATE' } })}
                                style={inputStyle}>
                                <option value="ROUND">Arredondar ABNT</option>
                                <option value="TRUNCATE">Truncar</option>
                            </select>
                        </div>
                        <div>
                            <label style={labelStyle}>Casas Decimais</label>
                            <input type="number" min="2" max="4" className="form-input"
                                value={engineeringConfig.precision.casasDecimais}
                                onChange={e => onConfigChange({ ...engineeringConfig, precision: { ...engineeringConfig.precision, casasDecimais: parseLocaleNumber(e.target.value) } })}
                                style={inputStyle} />
                        </div>
                    </div>

                </div>


                {/* ═══ RIGHT COLUMN: BDI + Encargos ═══ */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>

                    {/* BDI Calculator — Premium */}
                    <div style={sectionStyle}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <Calculator size={18} color="var(--color-primary)" />
                                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>BDI — Serviços</h3>
                            </div>
                            <button style={{ padding: '8px 16px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: 6, background: 'linear-gradient(135deg, #3b82f6, #6366f1)', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', cursor: isExtractingBdi ? 'wait' : 'pointer', fontWeight: 700, boxShadow: '0 2px 8px rgba(99,102,241,0.25)', transition: 'all 0.2s', opacity: isExtractingBdi ? 0.7 : 1 }}
                                onClick={onExtractBdi} disabled={isExtractingBdi}>
                                {isExtractingBdi ? <Loader2 size={14} className="spin" /> : <Wand2 size={14} />} Extrair via IA
                            </button>
                        </div>

                        {/* BDI Global — Read-Only Card */}
                        <div style={{ padding: 20, borderRadius: 'var(--radius-lg)', background: 'linear-gradient(135deg, rgba(37,99,235,0.06), rgba(139,92,246,0.06))', border: '1px solid rgba(37,99,235,0.12)', textAlign: 'center' }}>
                            <div style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>BDI Global — Serviços (TCU 2622)</div>
                            <div style={{ fontSize: '2.2rem', fontWeight: 800, color: 'var(--color-primary)', lineHeight: 1 }}>{calculateBdiTCU(bdiConfig.tcu).toFixed(2)}%</div>
                            <div style={{ fontSize: '0.65rem', color: 'var(--color-text-tertiary)', marginTop: 6, fontStyle: 'italic' }}>Calculado automaticamente a partir da composição abaixo</div>
                        </div>

                        {/* TCU Breakdown — Always visible */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                                {([['adminCentral', 'Adm. Central (%)'], ['seguros', 'Seguros (%)'], ['garantias', 'Garantias (%)'], ['riscos', 'Riscos (%)']] as const).map(([key, label]) => (
                                    <div key={key}>
                                        <label style={{ ...labelStyle, marginBottom: 4, fontSize: '0.7rem' }}>{label}</label>
                                        <input type="number" className="form-input" value={bdiConfig.tcu[key]}
                                            onChange={e => updateTcu(key, parseLocaleNumber(e.target.value))}
                                            style={{ ...inputStyle, padding: '8px 12px', borderRadius: 'var(--radius-md)', fontSize: '0.85rem', fontWeight: 600 }} step="0.01" />
                                    </div>
                                ))}
                            </div>
                            <div style={{ borderTop: '1px dashed var(--color-border)', margin: '2px 0' }} />
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                                <div>
                                    <label style={{ ...labelStyle, marginBottom: 4, fontSize: '0.7rem' }}>Desp. Financeiras (%)</label>
                                    <input type="number" className="form-input" value={bdiConfig.tcu.despFinanceiras}
                                        onChange={e => updateTcu('despFinanceiras', parseLocaleNumber(e.target.value))}
                                        style={{ ...inputStyle, padding: '8px 12px', borderRadius: 'var(--radius-md)', fontSize: '0.85rem', fontWeight: 600 }} step="0.01" />
                                </div>
                                <div>
                                    <label style={{ ...labelStyle, marginBottom: 4, fontSize: '0.7rem' }}>Lucro / Remuneração (%)</label>
                                    <input type="number" className="form-input" value={bdiConfig.tcu.lucro}
                                        onChange={e => updateTcu('lucro', parseLocaleNumber(e.target.value))}
                                        style={{ ...inputStyle, padding: '8px 12px', borderRadius: 'var(--radius-md)', fontSize: '0.85rem', fontWeight: 600, borderColor: 'rgba(37,99,235,0.25)' }} step="0.01" />
                                </div>
                            </div>
                            <div style={{ borderTop: '1px solid rgba(37,99,235,0.12)', paddingTop: 8, marginTop: 4 }}>
                                <label style={{ ...labelStyle, marginBottom: 4, fontSize: '0.7rem', fontWeight: 700, color: 'var(--color-primary)' }}>Tributos (PIS + COFINS + ISS) = {((bdiConfig.tcu.pis || 0) + (bdiConfig.tcu.cofins || 0) + (bdiConfig.tcu.iss || 0)).toFixed(2)}%</label>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                                    <div>
                                        <label style={{ ...labelStyle, marginBottom: 3, fontSize: '0.65rem' }}>PIS (%)</label>
                                        <input type="number" className="form-input" value={bdiConfig.tcu.pis}
                                            onChange={e => updateTcu('pis', parseLocaleNumber(e.target.value))}
                                            style={{ ...inputStyle, padding: '8px 12px', borderRadius: 'var(--radius-md)', fontSize: '0.85rem', fontWeight: 600 }} step="0.01" />
                                    </div>
                                    <div>
                                        <label style={{ ...labelStyle, marginBottom: 3, fontSize: '0.65rem' }}>COFINS (%)</label>
                                        <input type="number" className="form-input" value={bdiConfig.tcu.cofins}
                                            onChange={e => updateTcu('cofins', parseLocaleNumber(e.target.value))}
                                            style={{ ...inputStyle, padding: '8px 12px', borderRadius: 'var(--radius-md)', fontSize: '0.85rem', fontWeight: 600 }} step="0.01" />
                                    </div>
                                    <div>
                                        <label style={{ ...labelStyle, marginBottom: 3, fontSize: '0.65rem' }}>ISS (%)</label>
                                        <input type="number" className="form-input" value={bdiConfig.tcu.iss}
                                            onChange={e => updateTcu('iss', parseLocaleNumber(e.target.value))}
                                            style={{ ...inputStyle, padding: '8px 12px', borderRadius: 'var(--radius-md)', fontSize: '0.85rem', fontWeight: 600 }} step="0.01" />
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* BDI Diferenciado Toggle + Breakdown */}
                        <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 12 }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.8rem', fontWeight: 600, color: engineeringConfig.bdiDiferenciado ? '#b45309' : 'var(--color-text-primary)', cursor: 'pointer', userSelect: 'none' }}>
                                    <input type="checkbox" checked={!!engineeringConfig.bdiDiferenciado}
                                        onChange={e => onConfigChange({ ...engineeringConfig, bdiDiferenciado: e.target.checked })}
                                        style={{ width: 16, height: 16, accentColor: '#b45309', cursor: 'pointer' }} />
                                <Split size={16} color={engineeringConfig.bdiDiferenciado ? '#b45309' : 'var(--color-text-tertiary)'} />
                                Ativar BDI Diferenciado — Fornecimento
                            </label>
                            {onExtractBdiFornecimento && (
                                <button style={{ padding: '8px 16px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: 6, background: 'linear-gradient(135deg, #d97706, #b45309)', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', cursor: isExtractingBdi ? 'wait' : 'pointer', fontWeight: 700, boxShadow: '0 2px 8px rgba(180,83,9,0.25)', transition: 'all 0.2s', opacity: isExtractingBdi ? 0.7 : 1 }}
                                    onClick={onExtractBdiFornecimento} disabled={isExtractingBdi}>
                                    {isExtractingBdi ? <Loader2 size={14} className="spin" /> : <Wand2 size={14} />} Extrair via IA
                                </button>
                            )}
                            </div>
                            {engineeringConfig.bdiDiferenciado && (
                                <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px dashed rgba(180,83,9,0.2)', display: 'flex', flexDirection: 'column', gap: 10 }}>
                                    {/* BDI Fornecimento — Read-Only Card */}
                                    <div style={{ padding: 16, borderRadius: 'var(--radius-lg)', background: 'linear-gradient(135deg, rgba(180,83,9,0.06), rgba(217,119,6,0.06))', border: '1px solid rgba(180,83,9,0.12)', textAlign: 'center' }}>
                                        <div style={{ fontSize: '0.65rem', fontWeight: 800, color: '#92400e', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>BDI Diferenciado — Fornecimento (TCU 2622)</div>
                                        <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#b45309', lineHeight: 1 }}>{calculateBdiTCU(tcuF).toFixed(2)}%</div>
                                        <div style={{ fontSize: '0.6rem', color: '#92400e', marginTop: 6, fontStyle: 'italic' }}>Aplicado a itens de MATERIAL e EQUIPAMENTO</div>
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                                        {([['adminCentral', 'Adm. Central'], ['seguros', 'Seguros'], ['garantias', 'Garantias'], ['riscos', 'Riscos']] as const).map(([key, label]) => (
                                            <div key={key}>
                                                <label style={{ ...labelStyle, marginBottom: 3, fontSize: '0.68rem', color: '#92400e' }}>{label} (%)</label>
                                                <input type="number" className="form-input" value={tcuF[key]}
                                                    onChange={e => updateTcuFornecimento(key, parseLocaleNumber(e.target.value))}
                                                    style={{ ...inputStyle, padding: '7px 10px', borderRadius: 'var(--radius-md)', borderColor: 'rgba(180,83,9,0.2)', fontSize: '0.82rem', fontWeight: 600 }} step="0.01" />
                                            </div>
                                        ))}
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                                        <div>
                                            <label style={{ ...labelStyle, marginBottom: 3, fontSize: '0.68rem', color: '#92400e' }}>Desp. Financeiras (%)</label>
                                            <input type="number" className="form-input" value={tcuF.despFinanceiras}
                                                onChange={e => updateTcuFornecimento('despFinanceiras', parseLocaleNumber(e.target.value))}
                                                style={{ ...inputStyle, padding: '7px 10px', borderRadius: 'var(--radius-md)', borderColor: 'rgba(180,83,9,0.2)', fontSize: '0.82rem', fontWeight: 600 }} step="0.01" />
                                        </div>
                                        <div>
                                            <label style={{ ...labelStyle, marginBottom: 3, fontSize: '0.68rem', color: '#92400e' }}>Lucro (%)</label>
                                            <input type="number" className="form-input" value={tcuF.lucro}
                                                onChange={e => updateTcuFornecimento('lucro', parseLocaleNumber(e.target.value))}
                                                style={{ ...inputStyle, padding: '7px 10px', borderRadius: 'var(--radius-md)', borderColor: 'rgba(180,83,9,0.25)', fontSize: '0.82rem', fontWeight: 600 }} step="0.01" />
                                        </div>
                                    </div>
                                    <div style={{ borderTop: '1px solid rgba(180,83,9,0.15)', paddingTop: 8, marginTop: 4 }}>
                                        <label style={{ ...labelStyle, marginBottom: 4, fontSize: '0.68rem', fontWeight: 700, color: '#92400e' }}>Tributos (PIS + COFINS + ISS) = {((tcuF.pis || 0) + (tcuF.cofins || 0) + (tcuF.iss || 0)).toFixed(2)}%</label>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
                                            <div>
                                                <label style={{ ...labelStyle, marginBottom: 3, fontSize: '0.62rem', color: '#92400e' }}>PIS (%)</label>
                                                <input type="number" className="form-input" value={tcuF.pis}
                                                    onChange={e => updateTcuFornecimento('pis', parseLocaleNumber(e.target.value))}
                                                    style={{ ...inputStyle, padding: '7px 10px', borderRadius: 'var(--radius-md)', borderColor: 'rgba(180,83,9,0.2)', fontSize: '0.82rem', fontWeight: 600 }} step="0.01" />
                                            </div>
                                            <div>
                                                <label style={{ ...labelStyle, marginBottom: 3, fontSize: '0.62rem', color: '#92400e' }}>COFINS (%)</label>
                                                <input type="number" className="form-input" value={tcuF.cofins}
                                                    onChange={e => updateTcuFornecimento('cofins', parseLocaleNumber(e.target.value))}
                                                    style={{ ...inputStyle, padding: '7px 10px', borderRadius: 'var(--radius-md)', borderColor: 'rgba(180,83,9,0.2)', fontSize: '0.82rem', fontWeight: 600 }} step="0.01" />
                                            </div>
                                            <div>
                                                <label style={{ ...labelStyle, marginBottom: 3, fontSize: '0.62rem', color: '#92400e' }}>ISS (%)</label>
                                                <input type="number" className="form-input" value={tcuF.iss}
                                                    onChange={e => updateTcuFornecimento('iss', parseLocaleNumber(e.target.value))}
                                                    style={{ ...inputStyle, padding: '7px 10px', borderRadius: 'var(--radius-md)', borderColor: 'rgba(180,83,9,0.2)', fontSize: '0.82rem', fontWeight: 600 }} step="0.01" />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Encargos Sociais */}
                    <div style={sectionStyle}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <Users size={18} color="#6d28d9" />
                                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>Encargos Sociais</h3>
                            </div>
                            {onExtractEncargos && (
                                <button style={{ padding: '8px 16px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: 6, background: 'linear-gradient(135deg, #7c3aed, #6d28d9)', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', cursor: isExtractingEncargos ? 'wait' : 'pointer', fontWeight: 700, boxShadow: '0 2px 8px rgba(109,40,217,0.25)', transition: 'all 0.2s', opacity: isExtractingEncargos ? 0.7 : 1 }}
                                    onClick={onExtractEncargos} disabled={isExtractingEncargos}>
                                    {isExtractingEncargos ? <Loader2 size={14} className="spin" /> : <Wand2 size={14} />} Extrair via IA
                                </button>
                            )}
                        </div>

                        {/* Totals */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                            <div style={{ padding: 16, borderRadius: 'var(--radius-lg)', background: 'linear-gradient(135deg, rgba(30,64,175,0.04), rgba(59,130,246,0.06))', border: '1px solid rgba(30,64,175,0.15)', textAlign: 'center', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
                                <div style={{ fontSize: '0.68rem', fontWeight: 800, color: '#1e40af', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Total Horista</div>
                                <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#1e40af', lineHeight: 1 }}>{(engineeringConfig.encargosSociais?.horista || 0).toFixed(2)}%</div>
                                <input type="number" step="0.01" className="form-input" value={engineeringConfig.encargosSociais?.horista || 0}
                                    onChange={e => onConfigChange({ ...engineeringConfig, encargosSociais: { ...engineeringConfig.encargosSociais, horista: parseLocaleNumber(e.target.value) } })}
                                    style={{ width: '100%', marginTop: 12, textAlign: 'center', fontSize: '0.85rem', fontWeight: 700, padding: '6px', borderRadius: 'var(--radius-md)', border: '1px solid rgba(30,64,175,0.2)' }} />
                            </div>
                            <div style={{ padding: 16, borderRadius: 'var(--radius-lg)', background: 'linear-gradient(135deg, rgba(109,40,217,0.04), rgba(139,92,246,0.06))', border: '1px solid rgba(109,40,217,0.15)', textAlign: 'center', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
                                <div style={{ fontSize: '0.68rem', fontWeight: 800, color: '#6d28d9', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>Total Mensalista</div>
                                <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#6d28d9', lineHeight: 1 }}>{(engineeringConfig.encargosSociais?.mensalista || 0).toFixed(2)}%</div>
                                <input type="number" step="0.01" className="form-input" value={engineeringConfig.encargosSociais?.mensalista || 0}
                                    onChange={e => onConfigChange({ ...engineeringConfig, encargosSociais: { ...engineeringConfig.encargosSociais, mensalista: parseLocaleNumber(e.target.value) } })}
                                    style={{ width: '100%', marginTop: 12, textAlign: 'center', fontSize: '0.85rem', fontWeight: 700, padding: '6px', borderRadius: 'var(--radius-md)', border: '1px solid rgba(109,40,217,0.2)' }} />
                            </div>
                        </div>

                        {/* Analytical Breakdown Toggle */}
                        <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 8 }}>
                            <button onClick={() => setShowEncargosDetail(!showEncargosDetail)}
                                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', border: 'none', background: 'transparent', cursor: 'pointer', padding: '4px 0' }}>
                                <span style={{ fontSize: '0.8rem', fontWeight: 700, color: showEncargosDetail ? '#6d28d9' : 'var(--color-text-primary)' }}>Composição Analítica</span>
                                <ChevronDown size={14} style={{ color: 'var(--color-text-tertiary)', transform: showEncargosDetail ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                            </button>
                            {showEncargosDetail && (() => {
                                const es = engineeringConfig.encargosSociais;
                                const groups = [
                                    { key: 'A', title: 'A — Encargos Sociais Básicos', desc: 'INSS, SESI, SENAI, INCRA, SEBRAE, Sal. Educação, FGTS, SAT/RAT', color: '#1e40af', horista: es?.grupoA_horista || 0, mensalista: es?.grupoA_mensalista || 0 },
                                    { key: 'B', title: 'B — Encargos Trabalhistas', desc: 'Repouso, Feriados, 13º Sal., Férias + 1/3, Aux. Enfermidade, Lic. Paternidade', color: '#6d28d9', horista: es?.grupoB_horista || 0, mensalista: es?.grupoB_mensalista || 0 },
                                    { key: 'C', title: 'C — Encargos Rescisórios', desc: 'Aviso Prévio, Férias Indenizadas, Dep. Rescisão, Indenização Adicional', color: '#0e7490', horista: es?.grupoC_horista || 0, mensalista: es?.grupoC_mensalista || 0 },
                                    { key: 'D', title: 'D — Reincidências', desc: 'Incidência do Grupo A sobre B e sobre Aviso Prévio Trabalhado', color: '#92400e', horista: es?.grupoD_horista || 0, mensalista: es?.grupoD_mensalista || 0 },
                                ];
                                const updateGroup = (groupKey: string, field: 'horista' | 'mensalista', val: number) => {
                                    const fieldName = `grupo${groupKey}_${field}`;
                                    const nextEs = { ...es, [fieldName]: val };
                                    // Recalculate totals
                                    const totalH = (nextEs.grupoA_horista||0) + (nextEs.grupoB_horista||0) + (nextEs.grupoC_horista||0) + (nextEs.grupoD_horista||0);
                                    const totalM = (nextEs.grupoA_mensalista||0) + (nextEs.grupoB_mensalista||0) + (nextEs.grupoC_mensalista||0) + (nextEs.grupoD_mensalista||0);
                                    nextEs.horista = Math.round(totalH * 100) / 100;
                                    nextEs.mensalista = Math.round(totalM * 100) / 100;
                                    onConfigChange({ ...engineeringConfig, encargosSociais: nextEs });
                                };
                                return (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                                        <span style={{ fontSize: '0.65rem', color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>
                                            Estrutura SINAPI — Subtotais por grupo {es?.basePrincipal ? `(${es.basePrincipal})` : ''}
                                        </span>
                                        {/* Header */}
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px', gap: 6, fontSize: '0.68rem', fontWeight: 800, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                            <span>Grupo</span>
                                            <span style={{ textAlign: 'right' }}>Horista (%)</span>
                                            <span style={{ textAlign: 'right' }}>Mensalista (%)</span>
                                        </div>
                                        {groups.map(g => (
                                            <div key={g.key} style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px', gap: 6, alignItems: 'center', background: 'var(--color-bg-base)', padding: '8px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                                                <div>
                                                    <div style={{ fontSize: '0.75rem', fontWeight: 800, color: g.color }}>{g.title}</div>
                                                    <div style={{ fontSize: '0.6rem', color: 'var(--color-text-tertiary)', marginTop: 2, lineHeight: 1.2 }}>{g.desc}</div>
                                                </div>
                                                <input type="number" step="0.01" className="form-input"
                                                    value={g.horista}
                                                    onChange={e => updateGroup(g.key, 'horista', parseLocaleNumber(e.target.value))}
                                                    style={{ width: '100%', fontSize: '0.8rem', fontWeight: 600, textAlign: 'right', padding: '4px 6px', borderRadius: 'var(--radius-sm)', borderColor: 'var(--color-border)' }} />
                                                <input type="number" step="0.01" className="form-input"
                                                    value={g.mensalista}
                                                    onChange={e => updateGroup(g.key, 'mensalista', parseLocaleNumber(e.target.value))}
                                                    style={{ width: '100%', fontSize: '0.8rem', fontWeight: 600, textAlign: 'right', padding: '4px 6px', borderRadius: 'var(--radius-sm)', borderColor: 'var(--color-border)' }} />
                                            </div>
                                        ))}
                                        {/* Totals row */}
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 80px', gap: 6, alignItems: 'center', padding: '8px 10px', borderTop: '2px solid #6d28d9', fontWeight: 800, fontSize: '0.85rem' }}>
                                            <span style={{ color: '#6d28d9' }}>TOTAL (A+B+C+D)</span>
                                            <span style={{ textAlign: 'right', color: '#6d28d9' }}>{(es?.horista || 0).toFixed(2)}%</span>
                                            <span style={{ textAlign: 'right', color: '#6d28d9' }}>{(es?.mensalista || 0).toFixed(2)}%</span>
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>

                        {/* 2º Encargo Social */}
                        <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 12 }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer', userSelect: 'none', color: showEncargos2 ? '#6d28d9' : 'var(--color-text-primary)' }}>
                                <input type="checkbox" checked={showEncargos2}
                                    onChange={e => { setShowEncargos2(e.target.checked); if (!e.target.checked) { const { encargos2, ...rest } = engineeringConfig.encargosSociais as any; onConfigChange({ ...engineeringConfig, encargosSociais: { ...rest, encargoAtivo: 1 } }); } }}
                                    style={{ accentColor: '#6d28d9' }} />
                                2º Encargo Social (comparativo)
                            </label>
                            {showEncargos2 && (
                                <div style={{ marginTop: 12, padding: 16, background: 'linear-gradient(to right, rgba(109,40,217,0.03), rgba(139,92,246,0.03))', border: '1px solid rgba(109,40,217,0.15)', borderRadius: 'var(--radius-lg)', display: 'flex', flexDirection: 'column', gap: 12 }}>
                                    <input type="text" className="form-input" placeholder="Ex: Encargos Onerado"
                                        value={engineeringConfig.encargosSociais?.encargos2?.label || ''}
                                        onChange={e => onConfigChange({ ...engineeringConfig, encargosSociais: { ...engineeringConfig.encargosSociais, encargos2: { ...engineeringConfig.encargosSociais?.encargos2 || { horista: 0, mensalista: 0 }, label: e.target.value } } })}
                                        style={{ fontSize: '0.85rem', fontWeight: 600, padding: '8px 12px', borderRadius: 'var(--radius-md)', borderColor: 'rgba(109,40,217,0.2)' }} />
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                                        <div style={{ background: 'white', padding: 10, borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', textAlign: 'center' }}>
                                            <label style={{ ...labelStyle, marginBottom: 6, fontSize: '0.68rem', color: '#6d28d9' }}>Horista 2 (%)</label>
                                            <input type="number" step="0.01" className="form-input"
                                                value={engineeringConfig.encargosSociais?.encargos2?.horista || 0}
                                                onChange={e => onConfigChange({ ...engineeringConfig, encargosSociais: { ...engineeringConfig.encargosSociais, encargos2: { ...engineeringConfig.encargosSociais?.encargos2 || { horista: 0, mensalista: 0 }, horista: parseLocaleNumber(e.target.value) } } })}
                                                style={{ ...inputStyle, textAlign: 'center', fontSize: '1.1rem', fontWeight: 700, padding: '6px', border: 'none', outline: 'none' }} />
                                        </div>
                                        <div style={{ background: 'white', padding: 10, borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', textAlign: 'center' }}>
                                            <label style={{ ...labelStyle, marginBottom: 6, fontSize: '0.68rem', color: '#6d28d9' }}>Mensalista 2 (%)</label>
                                            <input type="number" step="0.01" className="form-input"
                                                value={engineeringConfig.encargosSociais?.encargos2?.mensalista || 0}
                                                onChange={e => onConfigChange({ ...engineeringConfig, encargosSociais: { ...engineeringConfig.encargosSociais, encargos2: { ...engineeringConfig.encargosSociais?.encargos2 || { horista: 0, mensalista: 0 }, mensalista: parseLocaleNumber(e.target.value) } } })}
                                                style={{ ...inputStyle, textAlign: 'center', fontSize: '1.1rem', fontWeight: 700, padding: '6px', border: 'none', outline: 'none' }} />
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                                        {[1, 2].map(n => (
                                            <label key={n} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '10px 12px', borderRadius: 'var(--radius-md)', border: `1px solid ${(engineeringConfig.encargosSociais?.encargoAtivo || 1) === n ? '#6d28d9' : 'var(--color-border)'}`, background: (engineeringConfig.encargosSociais?.encargoAtivo || 1) === n ? 'rgba(109,40,217,0.08)' : 'white', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 700, color: (engineeringConfig.encargosSociais?.encargoAtivo || 1) === n ? '#6d28d9' : 'var(--color-text-secondary)', transition: 'all 0.2s', boxShadow: (engineeringConfig.encargosSociais?.encargoAtivo || 1) === n ? '0 2px 4px rgba(109,40,217,0.1)' : 'none' }}>
                                                <input type="radio" name="encargoAtivo" checked={(engineeringConfig.encargosSociais?.encargoAtivo || 1) === n}
                                                    onChange={() => onConfigChange({ ...engineeringConfig, encargosSociais: { ...engineeringConfig.encargosSociais, encargoAtivo: n as 1|2 } })}
                                                    style={{ accentColor: '#6d28d9', width: 16, height: 16 }} />
                                                {n === 1 ? 'Aplicar Encargo Principal' : `Aplicar ${engineeringConfig.encargosSociais?.encargos2?.label || 'Encargo 2'}`}
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Footer: Save + Next */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 0' }}>
                <button className="btn btn-outline" onClick={onSave} disabled={isSaving}
                    style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {isSaving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
                    Salvar Configuração
                </button>
                <button className="btn btn-primary" onClick={onNext}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 24px', fontSize: '0.9rem', fontWeight: 700 }}>
                    Próximo: Planilha Orçamentária →
                </button>
            </div>
        </div>
    );
}
