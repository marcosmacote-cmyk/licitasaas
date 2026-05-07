/**
 * Step1ConfigPanel.tsx — Configuração do Orçamento (Step 1 do Wizard)
 * Agrupa: Dados do Orçamento, BDI (TCU 2622), Encargos Sociais
 */
import React, { useState } from 'react';
import { Wrench, Calculator, Wand2, Loader2, Split, ChevronDown, RefreshCw, Save, Users, Plus, Trash2, FileImage, CheckCircle2 } from 'lucide-react';
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
    setHasUnsavedChanges?: (v: boolean) => void;
    saveMsg?: React.ReactNode;
    setSaveMsg?: (v: React.ReactNode) => void;
}

const ITEMS_DEF = [
    { group: 'A', title: 'GRUPO A — Encargos Sociais Básicos', color: '#1e40af', items: [
        { code: 'A1', name: 'INSS', hKey: 'a1_h', mKey: 'a1_m' },
        { code: 'A2', name: 'SESI', hKey: 'a2_h', mKey: 'a2_m' },
        { code: 'A3', name: 'SENAI', hKey: 'a3_h', mKey: 'a3_m' },
        { code: 'A4', name: 'INCRA', hKey: 'a4_h', mKey: 'a4_m' },
        { code: 'A5', name: 'SEBRAE', hKey: 'a5_h', mKey: 'a5_m' },
        { code: 'A6', name: 'Salário Educação', hKey: 'a6_h', mKey: 'a6_m' },
        { code: 'A7', name: 'Seguro Contra Acidentes de Trabalho', hKey: 'a7_h', mKey: 'a7_m' },
        { code: 'A8', name: 'FGTS', hKey: 'a8_h', mKey: 'a8_m' },
        { code: 'A9', name: 'SECONCI', hKey: 'a9_h', mKey: 'a9_m' },
    ]},
    { group: 'B', title: 'GRUPO B — Encargos Trabalhistas', color: '#6d28d9', items: [
        { code: 'B1', name: 'Repouso Semanal Remunerado', hKey: 'b1_h', mKey: 'b1_m' },
        { code: 'B2', name: 'Feriados', hKey: 'b2_h', mKey: 'b2_m' },
        { code: 'B3', name: 'Auxílio Enfermidade', hKey: 'b3_h', mKey: 'b3_m' },
        { code: 'B4', name: '13º Salário', hKey: 'b4_h', mKey: 'b4_m' },
        { code: 'B5', name: 'Licença Paternidade', hKey: 'b5_h', mKey: 'b5_m' },
        { code: 'B6', name: 'Faltas Justificadas', hKey: 'b6_h', mKey: 'b6_m' },
        { code: 'B7', name: 'Dias de Chuvas', hKey: 'b7_h', mKey: 'b7_m' },
        { code: 'B8', name: 'Auxílio Acidente de Trabalho', hKey: 'b8_h', mKey: 'b8_m' },
        { code: 'B9', name: 'Férias Gozadas', hKey: 'b9_h', mKey: 'b9_m' },
        { code: 'B10', name: 'Salário Maternidade', hKey: 'b10_h', mKey: 'b10_m' },
    ]},
    { group: 'C', title: 'GRUPO C — Encargos Rescisórios', color: '#0e7490', items: [
        { code: 'C1', name: 'Aviso Prévio Indenizado', hKey: 'c1_h', mKey: 'c1_m' },
        { code: 'C2', name: 'Aviso Prévio Trabalhado', hKey: 'c2_h', mKey: 'c2_m' },
        { code: 'C3', name: 'Férias Indenizadas', hKey: 'c3_h', mKey: 'c3_m' },
        { code: 'C4', name: 'Depósito Rescisão Sem Justa Causa', hKey: 'c4_h', mKey: 'c4_m' },
        { code: 'C5', name: 'Indenização Adicional', hKey: 'c5_h', mKey: 'c5_m' },
    ]},
    { group: 'D', title: 'GRUPO D — Reincidências', color: '#92400e', items: [
        { code: 'D1', name: 'Reincidência de Grupo A sobre Grupo B', hKey: 'd1_h', mKey: 'd1_m' },
        { code: 'D2', name: 'Reinc. Grupo A s/ Aviso Prévio Trab. e FGTS s/ AP Ind.', hKey: 'd2_h', mKey: 'd2_m' },
    ]},
];

function EncargosDetailTable({ es, onChange }: { es: any, onChange: (newEs: any) => void }) {
    const updateItem = (key: string, val: number) => {
        const nextEs: any = { ...es, [key]: val };
        const sumItems = (keys: string[]) => keys.reduce((s, k) => s + (nextEs[k] || 0), 0);
        nextEs.grupoA_horista = Math.round(sumItems(['a1_h','a2_h','a3_h','a4_h','a5_h','a6_h','a7_h','a8_h','a9_h']) * 100) / 100;
        nextEs.grupoA_mensalista = Math.round(sumItems(['a1_m','a2_m','a3_m','a4_m','a5_m','a6_m','a7_m','a8_m','a9_m']) * 100) / 100;
        nextEs.grupoB_horista = Math.round(sumItems(['b1_h','b2_h','b3_h','b4_h','b5_h','b6_h','b7_h','b8_h','b9_h','b10_h']) * 100) / 100;
        nextEs.grupoB_mensalista = Math.round(sumItems(['b1_m','b2_m','b3_m','b4_m','b5_m','b6_m','b7_m','b8_m','b9_m','b10_m']) * 100) / 100;
        nextEs.grupoC_horista = Math.round(sumItems(['c1_h','c2_h','c3_h','c4_h','c5_h']) * 100) / 100;
        nextEs.grupoC_mensalista = Math.round(sumItems(['c1_m','c2_m','c3_m','c4_m','c5_m']) * 100) / 100;
        nextEs.grupoD_horista = Math.round(sumItems(['d1_h','d2_h']) * 100) / 100;
        nextEs.grupoD_mensalista = Math.round(sumItems(['d1_m','d2_m']) * 100) / 100;
        nextEs.horista = Math.round((nextEs.grupoA_horista + nextEs.grupoB_horista + nextEs.grupoC_horista + nextEs.grupoD_horista) * 100) / 100;
        nextEs.mensalista = Math.round((nextEs.grupoA_mensalista + nextEs.grupoB_mensalista + nextEs.grupoC_mensalista + nextEs.grupoD_mensalista) * 100) / 100;
        onChange(nextEs);
    };
    const inputSty = { width: 68, fontSize: '0.78rem', fontWeight: 600, textAlign: 'right' as const, padding: '3px 5px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' };
    return (
        <div style={{ marginTop: 8 }}>
            <span style={{ fontSize: '0.65rem', color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>
                Estrutura SINAPI — Itens individuais {es?.basePrincipal ? `(${es.basePrincipal})` : ''}
            </span>
            <div style={{ display: 'grid', gridTemplateColumns: '36px 1fr 72px 72px', gap: 4, fontSize: '0.65rem', fontWeight: 800, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '6px 4px 4px', borderBottom: '2px solid var(--color-border)' }}>
                <span>COD</span><span>DESCRIÇÃO</span><span style={{ textAlign: 'right' }}>HORISTA %</span><span style={{ textAlign: 'right' }}>MENSALISTA %</span>
            </div>
            {ITEMS_DEF.map(grp => (
                <div key={grp.group} style={{ marginBottom: 4 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '36px 1fr 72px 72px', gap: 4, padding: '6px 4px', background: 'var(--color-bg-base)', borderBottom: '1px solid var(--color-border)' }}>
                        <span style={{ fontSize: '0.72rem', fontWeight: 800, color: grp.color }}>{grp.group}</span>
                        <span style={{ fontSize: '0.72rem', fontWeight: 800, color: grp.color }}>{grp.title}</span>
                        <span></span><span></span>
                    </div>
                    {grp.items.map(item => (
                        <div key={item.code} style={{ display: 'grid', gridTemplateColumns: '36px 1fr 72px 72px', gap: 4, alignItems: 'center', padding: '3px 4px', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                            <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--color-text-secondary)' }}>{item.code}</span>
                            <span style={{ fontSize: '0.72rem', color: 'var(--color-text-primary)' }}>{item.name}</span>
                            <input type="number" step="0.01" className="form-input" value={es?.[item.hKey] || 0} onChange={e => updateItem(item.hKey, parseLocaleNumber(e.target.value))} style={inputSty} />
                            <input type="number" step="0.01" className="form-input" value={es?.[item.mKey] || 0} onChange={e => updateItem(item.mKey, parseLocaleNumber(e.target.value))} style={inputSty} />
                        </div>
                    ))}
                    <div style={{ display: 'grid', gridTemplateColumns: '36px 1fr 72px 72px', gap: 4, padding: '4px 4px', borderBottom: '2px solid var(--color-border)', background: 'rgba(0,0,0,0.02)' }}>
                        <span></span>
                        <span style={{ fontSize: '0.72rem', fontWeight: 800, color: grp.color, textAlign: 'right', paddingRight: 6 }}>TOTAL</span>
                        <span style={{ fontSize: '0.78rem', fontWeight: 800, color: grp.color, textAlign: 'right' }}>{(es?.[`grupo${grp.group}_horista`] as number || 0).toFixed(2)}</span>
                        <span style={{ fontSize: '0.78rem', fontWeight: 800, color: grp.color, textAlign: 'right' }}>{(es?.[`grupo${grp.group}_mensalista`] as number || 0).toFixed(2)}</span>
                    </div>
                </div>
            ))}
            <div style={{ display: 'grid', gridTemplateColumns: '36px 1fr 72px 72px', gap: 4, padding: '8px 4px', borderTop: '3px double #6d28d9', fontWeight: 800, fontSize: '0.85rem', marginTop: 4 }}>
                <span></span><span style={{ color: '#6d28d9' }}>A + B + C + D =</span>
                <span style={{ textAlign: 'right', color: '#6d28d9' }}>{(es?.horista || 0).toFixed(2)}</span>
                <span style={{ textAlign: 'right', color: '#6d28d9' }}>{(es?.mensalista || 0).toFixed(2)}</span>
            </div>
        </div>
    );
}

export function Step1ConfigPanel({
    engineeringConfig, bdiConfig, isExtractingBdi, isExtractingConfig, isExtractingEncargos, isAuditing, isSaving,
    onConfigChange, onBdiChange, onExtractBdi, onExtractBdiFornecimento, onExtractConfig, onExtractEncargos, onSyncBases, onSave, onNext,
    setHasUnsavedChanges: parentSetHasUnsavedChanges, setSaveMsg: parentSetSaveMsg,
}: Props) {
    const [localSaveMsg, setLocalSaveMsg] = useState<React.ReactNode>(null);
    const setSaveMsg = parentSetSaveMsg || setLocalSaveMsg;
    const setHasUnsavedChanges = parentSetHasUnsavedChanges || (() => {});
    const [showEncargosDetail, setShowEncargosDetail] = useState(false);
    const [showAdicionalDetail, setShowAdicionalDetail] = useState<Record<number, boolean>>({});
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
                                <label style={{ ...labelStyle, marginBottom: 4, fontSize: '0.7rem', fontWeight: 700, color: 'var(--color-primary)' }}>Tributos (I) = {((bdiConfig.tcu.pis || 0) + (bdiConfig.tcu.cofins || 0) + (bdiConfig.tcu.iss || 0) + (bdiConfig.tcu.csll || 0)).toFixed(2)}%</label>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8 }}>
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
                                    <div>
                                        <label style={{ ...labelStyle, marginBottom: 3, fontSize: '0.65rem' }}>CSLL (%)</label>
                                        <input type="number" className="form-input" value={bdiConfig.tcu.csll || 0}
                                            onChange={e => updateTcu('csll', parseLocaleNumber(e.target.value))}
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
                                        <label style={{ ...labelStyle, marginBottom: 4, fontSize: '0.68rem', fontWeight: 700, color: '#92400e' }}>Tributos (I) = {((tcuF.pis || 0) + (tcuF.cofins || 0) + (tcuF.iss || 0) + (tcuF.csll || 0)).toFixed(2)}%</label>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 6 }}>
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
                                            <div>
                                                <label style={{ ...labelStyle, marginBottom: 3, fontSize: '0.62rem', color: '#92400e' }}>CSLL (%)</label>
                                                <input type="number" className="form-input" value={tcuF.csll || 0}
                                                    onChange={e => updateTcuFornecimento('csll', parseLocaleNumber(e.target.value))}
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
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <Users size={18} color="#6d28d9" />
                                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>Encargos Sociais</h3>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                {/* Botão de Colar Imagem para o Encargo Principal */}
                                <button onClick={async () => {
                                    try {
                                        const clipItems = await navigator.clipboard.read();
                                        let imageBlob: Blob | null = null;
                                        for (const item of clipItems) {
                                            for (const type of item.types) {
                                                if (type.startsWith('image/')) { imageBlob = await item.getType(type); break; }
                                            }
                                            if (imageBlob) break;
                                        }
                                        if (!imageBlob) { alert('Nenhuma imagem no clipboard. Copie uma imagem (PrintScreen/Ctrl+C) e tente novamente.'); return; }
                                        const reader = new FileReader();
                                        reader.onload = async () => {
                                            const base64 = (reader.result as string).split(',')[1];
                                            const mimeType = imageBlob!.type;
                                            try {
                                                setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#6d28d9' }}><Loader2 size={14} className="spin" /> Extraindo encargos da imagem...</span>);
                                                const resp = await fetch('/api/engineering/ai-extract-encargos-image', {
                                                    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
                                                    body: JSON.stringify({ imageBase64: base64, mimeType, label: 'Principal' })
                                                });
                                                const result = await resp.json();
                                                if (result.found) {
                                                    const d = result.data || result;
                                                    const encargosUpdate: any = {
                                                        ...engineeringConfig.encargosSociais,
                                                        horista: d.totalHorista || engineeringConfig.encargosSociais?.horista,
                                                        mensalista: d.totalMensalista || engineeringConfig.encargosSociais?.mensalista,
                                                        basePrincipal: d.basePrincipal || null,
                                                        grupoA_horista: d.grupoA_horista || 0, grupoA_mensalista: d.grupoA_mensalista || 0,
                                                        grupoB_horista: d.grupoB_horista || 0, grupoB_mensalista: d.grupoB_mensalista || 0,
                                                        grupoC_horista: d.grupoC_horista || 0, grupoC_mensalista: d.grupoC_mensalista || 0,
                                                        grupoD_horista: d.grupoD_horista || 0, grupoD_mensalista: d.grupoD_mensalista || 0,
                                                        a1_h: d.a1_h || 0, a1_m: d.a1_m || 0, a2_h: d.a2_h || 0, a2_m: d.a2_m || 0,
                                                        a3_h: d.a3_h || 0, a3_m: d.a3_m || 0, a4_h: d.a4_h || 0, a4_m: d.a4_m || 0,
                                                        a5_h: d.a5_h || 0, a5_m: d.a5_m || 0, a6_h: d.a6_h || 0, a6_m: d.a6_m || 0,
                                                        a7_h: d.a7_h || 0, a7_m: d.a7_m || 0, a8_h: d.a8_h || 0, a8_m: d.a8_m || 0,
                                                        a9_h: d.a9_h || 0, a9_m: d.a9_m || 0,
                                                        b1_h: d.b1_h || 0, b1_m: d.b1_m || 0, b2_h: d.b2_h || 0, b2_m: d.b2_m || 0,
                                                        b3_h: d.b3_h || 0, b3_m: d.b3_m || 0, b4_h: d.b4_h || 0, b4_m: d.b4_m || 0,
                                                        b5_h: d.b5_h || 0, b5_m: d.b5_m || 0, b6_h: d.b6_h || 0, b6_m: d.b6_m || 0,
                                                        b7_h: d.b7_h || 0, b7_m: d.b7_m || 0, b8_h: d.b8_h || 0, b8_m: d.b8_m || 0,
                                                        b9_h: d.b9_h || 0, b9_m: d.b9_m || 0, b10_h: d.b10_h || 0, b10_m: d.b10_m || 0,
                                                        c1_h: d.c1_h || 0, c1_m: d.c1_m || 0, c2_h: d.c2_h || 0, c2_m: d.c2_m || 0,
                                                        c3_h: d.c3_h || 0, c3_m: d.c3_m || 0, c4_h: d.c4_h || 0, c4_m: d.c4_m || 0,
                                                        c5_h: d.c5_h || 0, c5_m: d.c5_m || 0,
                                                        d1_h: d.d1_h || 0, d1_m: d.d1_m || 0, d2_h: d.d2_h || 0, d2_m: d.d2_m || 0,
                                                    };
                                                    onConfigChange({ ...engineeringConfig, encargosSociais: encargosUpdate });
                                                    setHasUnsavedChanges(true);
                                                    setShowEncargosDetail(true); // Auto-open detail
                                                    setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-success)' }}><CheckCircle2 size={14} /> Encargos extraídos da imagem! H={d.totalHorista}% M={d.totalMensalista}%</span>);
                                                } else { alert('Não foi possível extrair encargos da imagem.'); setSaveMsg(null); }
                                                setTimeout(() => setSaveMsg(null), 4000);
                                            } catch (err: any) { alert('Erro: ' + err.message); setSaveMsg(null); }
                                        };
                                        reader.readAsDataURL(imageBlob);
                                    } catch (err: any) { alert('Erro ao ler clipboard: ' + err.message); }
                                }} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', fontWeight: 700, padding: '7px 12px', borderRadius: 'var(--radius-md)', background: 'linear-gradient(135deg, #10b981, #059669)', color: 'white', border: 'none', cursor: 'pointer', boxShadow: '0 2px 6px rgba(16,185,129,0.25)' }}>
                                    <FileImage size={14} /> Colar Imagem
                                </button>
                                {onExtractEncargos && (
                                    <button style={{ padding: '7px 14px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: 6, background: 'linear-gradient(135deg, #7c3aed, #6d28d9)', color: '#fff', border: 'none', borderRadius: 'var(--radius-md)', cursor: isExtractingEncargos ? 'wait' : 'pointer', fontWeight: 700, boxShadow: '0 2px 8px rgba(109,40,217,0.25)', transition: 'all 0.2s', opacity: isExtractingEncargos ? 0.7 : 1 }}
                                        onClick={onExtractEncargos} disabled={isExtractingEncargos}>
                                        {isExtractingEncargos ? <Loader2 size={14} className="spin" /> : <Wand2 size={14} />} Extrair do Edital
                                    </button>
                                )}
                            </div>
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
                            {showEncargosDetail && (
                                <EncargosDetailTable 
                                    es={engineeringConfig.encargosSociais || {}} 
                                    onChange={newEs => {
                                        onConfigChange({ ...engineeringConfig, encargosSociais: newEs });
                                        setHasUnsavedChanges(true);
                                    }} 
                                />
                            )}
                        </div>

                        {/* Planilhas Adicionais de Encargos */}
                        <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 12 }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                                <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-text-primary)' }}>
                                    📋 Planilhas Adicionais de Encargos
                                </span>
                                <button onClick={() => {
                                    const sheets = [...(engineeringConfig.encargosSociais?.encargosAdicionais || [])];
                                    sheets.push({ label: `Base ${sheets.length + 2}`, horista: 0, mensalista: 0 });
                                    onConfigChange({ ...engineeringConfig, encargosSociais: { ...engineeringConfig.encargosSociais, encargosAdicionais: sheets } });
                                }} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', fontWeight: 700, padding: '5px 12px', borderRadius: 'var(--radius-md)', border: '1px dashed rgba(109,40,217,0.4)', background: 'rgba(109,40,217,0.04)', color: '#6d28d9', cursor: 'pointer' }}>
                                    <Plus size={13} /> Adicionar Planilha
                                </button>
                            </div>
                            <p style={{ fontSize: '0.68rem', color: 'var(--color-text-tertiary)', margin: '0 0 8px', lineHeight: 1.4 }}>
                                Para editais com múltiplas tabelas oficiais (SINAPI, SEINFRA, etc.), adicione uma planilha por base.
                                Você pode extrair via IA colando uma imagem (Ctrl+V) ou preenchendo manualmente.
                            </p>

                            {(engineeringConfig.encargosSociais?.encargosAdicionais || []).map((sheet: any, idx: number) => (
                                <div key={idx} style={{ marginBottom: 12, padding: 14, background: 'linear-gradient(to right, rgba(109,40,217,0.03), rgba(139,92,246,0.03))', border: '1px solid rgba(109,40,217,0.15)', borderRadius: 'var(--radius-lg)' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                                        <input type="text" className="form-input" placeholder={`Base ${idx + 2}`}
                                            value={sheet.label || ''}
                                            onChange={e => {
                                                const sheets = [...(engineeringConfig.encargosSociais?.encargosAdicionais || [])];
                                                sheets[idx] = { ...sheets[idx], label: e.target.value };
                                                onConfigChange({ ...engineeringConfig, encargosSociais: { ...engineeringConfig.encargosSociais, encargosAdicionais: sheets } });
                                            }}
                                            style={{ flex: 1, fontSize: '0.82rem', fontWeight: 700, padding: '6px 10px', borderRadius: 'var(--radius-md)', borderColor: 'rgba(109,40,217,0.2)' }} />
                                        {/* Image paste button */}
                                        <button onClick={async () => {
                                            try {
                                                const clipItems = await navigator.clipboard.read();
                                                let imageBlob: Blob | null = null;
                                                for (const item of clipItems) {
                                                    for (const type of item.types) {
                                                        if (type.startsWith('image/')) { imageBlob = await item.getType(type); break; }
                                                    }
                                                    if (imageBlob) break;
                                                }
                                                if (!imageBlob) { alert('Nenhuma imagem no clipboard. Copie uma imagem (PrintScreen/Ctrl+C) e tente novamente.'); return; }
                                                const reader = new FileReader();
                                                reader.onload = async () => {
                                                    const base64 = (reader.result as string).split(',')[1];
                                                    const mimeType = imageBlob!.type;
                                                    try {
                                                        setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#6d28d9' }}><Loader2 size={14} className="spin" /> Extraindo encargos da imagem...</span>);
                                                        const resp = await fetch('/api/engineering/ai-extract-encargos-image', {
                                                            method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
                                                            body: JSON.stringify({ imageBase64: base64, mimeType, label: sheet.label || `Base ${idx + 2}` })
                                                        });
                                                        const result = await resp.json();
                                                        if (result.found) {
                                                            const d = result.data || result;
                                                            const sheets = [...(engineeringConfig.encargosSociais?.encargosAdicionais || [])];
                                                            sheets[idx] = { 
                                                                ...sheets[idx], 
                                                                ...d, 
                                                                horista: d.totalHorista || d.horista || sheets[idx].horista,
                                                                mensalista: d.totalMensalista || d.mensalista || sheets[idx].mensalista,
                                                                label: sheet.label || d.basePrincipal || `Base ${idx + 2}` 
                                                            };
                                                            onConfigChange({ ...engineeringConfig, encargosSociais: { ...engineeringConfig.encargosSociais, encargosAdicionais: sheets } });
                                                            setHasUnsavedChanges(true);
                                                            // Auto-open detail for this sheet
                                                            setShowAdicionalDetail(prev => ({ ...prev, [idx]: true }));
                                                            setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-success)' }}><CheckCircle2 size={14} /> Encargos extraídos! H={d.totalHorista}% M={d.totalMensalista}%</span>);
                                                        } else { alert('Não foi possível extrair encargos da imagem.'); setSaveMsg(null); }
                                                        setTimeout(() => setSaveMsg(null), 4000);
                                                    } catch (err: any) { alert('Erro: ' + err.message); setSaveMsg(null); }
                                                };
                                                reader.readAsDataURL(imageBlob);
                                            } catch (err: any) { alert('Erro ao ler clipboard: ' + err.message); }
                                        }} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.72rem', fontWeight: 700, padding: '5px 10px', borderRadius: 'var(--radius-md)', background: 'linear-gradient(135deg, #6d28d9, #8b5cf6)', color: 'white', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                                            <FileImage size={13} /> Colar Imagem
                                        </button>
                                        <button onClick={() => {
                                            const sheets = [...(engineeringConfig.encargosSociais?.encargosAdicionais || [])];
                                            sheets.splice(idx, 1);
                                            onConfigChange({ ...engineeringConfig, encargosSociais: { ...engineeringConfig.encargosSociais, encargosAdicionais: sheets } });
                                        }} style={{ padding: '4px 6px', borderRadius: 'var(--radius-sm)', border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.05)', color: '#dc2626', cursor: 'pointer', fontSize: '0.7rem' }}>
                                            <Trash2 size={12} />
                                        </button>
                                    </div>
                                    {/* Totals */}
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 8 }}>
                                        <div style={{ background: 'white', padding: 8, borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', textAlign: 'center' }}>
                                            <label style={{ ...labelStyle, marginBottom: 4, fontSize: '0.65rem', color: '#6d28d9' }}>Horista (%)</label>
                                            <input type="number" step="0.01" className="form-input"
                                                value={sheet.horista || 0}
                                                onChange={e => {
                                                    const sheets = [...(engineeringConfig.encargosSociais?.encargosAdicionais || [])];
                                                    sheets[idx] = { ...sheets[idx], horista: parseLocaleNumber(e.target.value) };
                                                    onConfigChange({ ...engineeringConfig, encargosSociais: { ...engineeringConfig.encargosSociais, encargosAdicionais: sheets } });
                                                }}
                                                style={{ ...inputStyle, textAlign: 'center', fontSize: '1rem', fontWeight: 700, padding: '4px', border: 'none' }} />
                                        </div>
                                        <div style={{ background: 'white', padding: 8, borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', textAlign: 'center' }}>
                                            <label style={{ ...labelStyle, marginBottom: 4, fontSize: '0.65rem', color: '#6d28d9' }}>Mensalista (%)</label>
                                            <input type="number" step="0.01" className="form-input"
                                                value={sheet.mensalista || 0}
                                                onChange={e => {
                                                    const sheets = [...(engineeringConfig.encargosSociais?.encargosAdicionais || [])];
                                                    sheets[idx] = { ...sheets[idx], mensalista: parseLocaleNumber(e.target.value) };
                                                    onConfigChange({ ...engineeringConfig, encargosSociais: { ...engineeringConfig.encargosSociais, encargosAdicionais: sheets } });
                                                }}
                                                style={{ ...inputStyle, textAlign: 'center', fontSize: '1rem', fontWeight: 700, padding: '4px', border: 'none' }} />
                                        </div>
                                    </div>
                                    
                                    {/* Analytical Breakdown Toggle */}
                                    <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 8 }}>
                                        <button onClick={() => setShowAdicionalDetail(prev => ({ ...prev, [idx]: !prev[idx] }))}
                                            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', border: 'none', background: 'transparent', cursor: 'pointer', padding: '4px 0' }}>
                                            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: showAdicionalDetail[idx] ? '#6d28d9' : 'var(--color-text-primary)' }}>Composição Analítica</span>
                                            <ChevronDown size={14} style={{ color: 'var(--color-text-tertiary)', transform: showAdicionalDetail[idx] ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
                                        </button>
                                        {showAdicionalDetail[idx] && (
                                            <EncargosDetailTable 
                                                es={sheet || {}} 
                                                onChange={newEs => {
                                                    const sheets = [...(engineeringConfig.encargosSociais?.encargosAdicionais || [])];
                                                    sheets[idx] = newEs;
                                                    onConfigChange({ ...engineeringConfig, encargosSociais: { ...engineeringConfig.encargosSociais, encargosAdicionais: sheets } });
                                                    setHasUnsavedChanges(true);
                                                }} 
                                            />
                                        )}
                                    </div>
                                </div>
                            ))}

                            {/* Encargo ativo selector */}
                            {((engineeringConfig.encargosSociais?.encargosAdicionais || []).length > 0) && (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                                    <label style={{ flex: '1 1 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px 10px', borderRadius: 'var(--radius-md)', border: `1px solid ${(engineeringConfig.encargosSociais?.encargoAtivo || 0) === 0 ? '#6d28d9' : 'var(--color-border)'}`, background: (engineeringConfig.encargosSociais?.encargoAtivo || 0) === 0 ? 'rgba(109,40,217,0.08)' : 'white', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 700, color: (engineeringConfig.encargosSociais?.encargoAtivo || 0) === 0 ? '#6d28d9' : 'var(--color-text-secondary)' }}>
                                        <input type="radio" name="encargoAtivo" checked={(engineeringConfig.encargosSociais?.encargoAtivo || 0) === 0}
                                            onChange={() => onConfigChange({ ...engineeringConfig, encargosSociais: { ...engineeringConfig.encargosSociais, encargoAtivo: 0 } })}
                                            style={{ accentColor: '#6d28d9', width: 14, height: 14 }} />
                                        Principal
                                    </label>
                                    {(engineeringConfig.encargosSociais?.encargosAdicionais || []).map((_: any, i: number) => (
                                        <label key={i} style={{ flex: '1 1 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px 10px', borderRadius: 'var(--radius-md)', border: `1px solid ${(engineeringConfig.encargosSociais?.encargoAtivo || 0) === i + 1 ? '#6d28d9' : 'var(--color-border)'}`, background: (engineeringConfig.encargosSociais?.encargoAtivo || 0) === i + 1 ? 'rgba(109,40,217,0.08)' : 'white', cursor: 'pointer', fontSize: '0.75rem', fontWeight: 700, color: (engineeringConfig.encargosSociais?.encargoAtivo || 0) === i + 1 ? '#6d28d9' : 'var(--color-text-secondary)' }}>
                                            <input type="radio" name="encargoAtivo" checked={(engineeringConfig.encargosSociais?.encargoAtivo || 0) === i + 1}
                                                onChange={() => onConfigChange({ ...engineeringConfig, encargosSociais: { ...engineeringConfig.encargosSociais, encargoAtivo: i + 1 } })}
                                                style={{ accentColor: '#6d28d9', width: 14, height: 14 }} />
                                            {_.label || `Base ${i + 2}`}
                                        </label>
                                    ))}
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
