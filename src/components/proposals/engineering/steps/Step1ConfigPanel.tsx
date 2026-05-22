/**
 * Step1ConfigPanel.tsx — Configuração do Orçamento (Step 1 do Wizard)
 * Agrupa: Dados do Orçamento, BDI (TCU 2622), Encargos Sociais
 */
import React, { useState } from 'react';
import { Wrench, Calculator, Wand2, Loader2, Split, ChevronDown, RefreshCw, Save, Users, Plus, Trash2, FileImage, CheckCircle2, AlertTriangle, Info, ClipboardList, RotateCcw } from 'lucide-react';
import { calculateBdiTCU, autoDistributeBdi, DEFAULT_TCU_FORNECIMENTO_PARAMS, type BdiConfig, type BdiTcuParams } from '../bdiEngine';
import { applyPrecision } from '../precisionEngine';
import type { EngineeringConfig, PrecisionConfig } from '../types';

// ═══════════════════════════════════════════════════════════
// P0: Match System — compara valores atuais com o edital
// Prioridade: 1) Valores extraídos pela IA do edital
//             2) Fallback: Faixas TCU 2622/2013
// ═══════════════════════════════════════════════════════════
const TCU_RANGES: Record<string, { label: string; q1: number; median: number; q3: number }> = {
    adminCentral:    { label: 'Adm. Central',      q1: 3.00,  median: 4.00,  q3: 5.50  },
    seguros:         { label: 'Seguros',            q1: 0.50,  median: 0.80,  q3: 1.00  },
    garantias:       { label: 'Garantias',          q1: 0.00,  median: 0.42,  q3: 0.88  },
    riscos:          { label: 'Riscos',             q1: 0.50,  median: 0.97,  q3: 1.27  },
    despFinanceiras: { label: 'Desp. Financeiras',  q1: 0.50,  median: 1.11,  q3: 1.39  },
    lucro:           { label: 'Lucro',              q1: 5.00,  median: 6.16,  q3: 8.96  },
};

type MatchStatus = 'ok' | 'warn' | 'divergent' | 'info';

const MATCH_STYLES: Record<MatchStatus, { color: string; bg: string }> = {
    ok:        { color: '#059669', bg: 'rgba(5,150,105,0.08)'  },
    warn:      { color: '#d97706', bg: 'rgba(217,119,6,0.08)'  },
    divergent: { color: '#dc2626', bg: 'rgba(220,38,38,0.08)'  },
    info:      { color: '#3b82f6', bg: 'rgba(59,130,246,0.08)' },
};

function MatchBadge({ status, label, title }: { status: MatchStatus; label: string; title: string }) {
    const style = MATCH_STYLES[status];
    const IconComp = status === 'ok' ? CheckCircle2 : status === 'info' ? Info : AlertTriangle;
    return (
        <span title={title} style={{
            display: 'inline-flex', alignItems: 'center', gap: 3,
            padding: '2px 7px', borderRadius: 4,
            background: style.bg, color: style.color,
            fontSize: '0.62rem', fontWeight: 800, whiteSpace: 'nowrap',
            lineHeight: 1.3, cursor: 'help',
        }}>
            <IconComp size={10} />{label}
        </span>
    );
}

/**
 * Match Badge for BDI fields.
 * Priority: Compare against AI-extracted edital values. Fallback to TCU ranges.
 */
function bdiMatchBadge(field: string, value: number, aiRef?: any): React.ReactNode {
    if (value === 0) return null;

    // P1: Compare against AI-extracted edital reference
    if (aiRef && aiRef[field] != null && aiRef[field] !== undefined) {
        const editalVal = Number(aiRef[field]);
        if (editalVal === 0 && value === 0) return null;
        const diff = Math.abs(value - editalVal);
        if (diff < 0.005) {
            return <MatchBadge status="ok" label="✓ Edital" title={`Confere com o edital: ${editalVal.toFixed(2)}%`} />;
        }
        if (diff <= 0.1) {
            return <MatchBadge status="warn" label={`Edital: ${editalVal.toFixed(2)}%`} title={`Valor no edital: ${editalVal.toFixed(2)}%. Diferença de ${diff.toFixed(2)}%`} />;
        }
        return <MatchBadge status="divergent" label={`Edital: ${editalVal.toFixed(2)}%`} title={`⚠ DIVERGE do edital: ${editalVal.toFixed(2)}%. Valor atual: ${value.toFixed(2)}%`} />;
    }

    // Fallback: TCU range check
    const range = TCU_RANGES[field];
    if (!range) return null;
    if (value >= range.q1 && value <= range.q3) {
        return <MatchBadge status="ok" label="Faixa TCU" title={`${range.label}: ${value.toFixed(2)}% está dentro da faixa TCU 2622 (${range.q1}% — ${range.q3}%)`} />;
    }
    if (value < range.q1) {
        return <MatchBadge status="warn" label={`< Q1 (${range.q1}%)`} title={`${range.label}: ${value.toFixed(2)}% está ABAIXO do 1° quartil TCU 2622 (${range.q1}%). Faixa: ${range.q1}% — ${range.q3}%`} />;
    }
    return <MatchBadge status="warn" label={`> Q3 (${range.q3}%)`} title={`${range.label}: ${value.toFixed(2)}% está ACIMA do 3° quartil TCU 2622 (${range.q3}%). Faixa: ${range.q1}% — ${range.q3}%`} />;
}

/**
 * Match Badge for Encargos fields.
 * Compares current value against AI-extracted edital reference.
 */
function encargosMatchBadge(field: string, value: number, aiRef?: any): React.ReactNode {
    if (!aiRef || aiRef[field] == null) return null;
    const editalVal = Number(aiRef[field]);
    if (editalVal === 0 && value === 0) return null;
    const diff = Math.abs(value - editalVal);
    if (diff < 0.005) {
        return <MatchBadge status="ok" label="✓ Edital" title={`Confere com o edital: ${editalVal.toFixed(2)}%`} />;
    }
    if (diff <= 0.5) {
        return <MatchBadge status="warn" label={`Edital: ${editalVal.toFixed(2)}%`} title={`Valor no edital: ${editalVal.toFixed(2)}%. Diferença: ${diff.toFixed(2)}%`} />;
    }
    return <MatchBadge status="divergent" label={`Edital: ${editalVal.toFixed(2)}%`} title={`⚠ DIVERGE do edital: ${editalVal.toFixed(2)}%. Atual: ${value.toFixed(2)}%`} />;
}

/** Compact icon-only badge for individual encargos item rows (no text, just colored dot with tooltip) */
function encargosMatchIcon(field: string, value: number, aiRef?: any): React.ReactNode {
    if (!aiRef || aiRef[field] == null) return null;
    const editalVal = Number(aiRef[field]);
    if (editalVal === 0 && value === 0) return null;
    const diff = Math.abs(value - editalVal);
    const style = diff < 0.005 ? MATCH_STYLES.ok : diff <= 0.5 ? MATCH_STYLES.warn : MATCH_STYLES.divergent;
    const Icon = diff < 0.005 ? CheckCircle2 : AlertTriangle;
    const tip = diff < 0.005 ? `✓ Confere: ${editalVal.toFixed(2)}%` : `Edital: ${editalVal.toFixed(2)}% (dif: ${diff.toFixed(2)}%)`;
    return <span title={tip} style={{ cursor: 'help', display: 'inline-flex', alignItems: 'center' }}><Icon size={11} color={style.color} /></span>;
}

function configConsistencyBadge(field: string, currentValue: string | undefined, ref: any): React.ReactNode {
    if (!ref) return null;
    const refValue = ref[field];
    if (refValue == null || refValue === '') return null;
    if (!currentValue || currentValue === '') return <MatchBadge status="info" label="IA extraiu" title={`IA extraiu: "${refValue}". Preencha o campo para validar.`} />;
    const normalize = (v: string) => v.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (normalize(String(currentValue)) === normalize(String(refValue))) {
        return <MatchBadge status="ok" label="Confere" title={`Valor confere com a extração da IA: "${refValue}"`} />;
    }
    return <MatchBadge status="divergent" label="Editado" title={`Valor diferente do extraído pela IA. Extraído: "${refValue}", Atual: "${currentValue}"`} />;
}

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

function EncargosDetailTable({ es, onChange, precision, aiRef }: { es: any, onChange: (newEs: any) => void, precision?: PrecisionConfig, aiRef?: any }) {
    const p = (v: number) => applyPrecision(v, { precision });
    const updateItem = (key: string, val: number) => {
        const nextEs: any = { ...es, [key]: val };
        const sumItems = (keys: string[]) => keys.reduce((s, k) => s + (nextEs[k] || 0), 0);
        nextEs.grupoA_horista = p(sumItems(['a1_h','a2_h','a3_h','a4_h','a5_h','a6_h','a7_h','a8_h','a9_h']));
        nextEs.grupoA_mensalista = p(sumItems(['a1_m','a2_m','a3_m','a4_m','a5_m','a6_m','a7_m','a8_m','a9_m']));
        nextEs.grupoB_horista = p(sumItems(['b1_h','b2_h','b3_h','b4_h','b5_h','b6_h','b7_h','b8_h','b9_h','b10_h']));
        nextEs.grupoB_mensalista = p(sumItems(['b1_m','b2_m','b3_m','b4_m','b5_m','b6_m','b7_m','b8_m','b9_m','b10_m']));
        nextEs.grupoC_horista = p(sumItems(['c1_h','c2_h','c3_h','c4_h','c5_h']));
        nextEs.grupoC_mensalista = p(sumItems(['c1_m','c2_m','c3_m','c4_m','c5_m']));
        nextEs.grupoD_horista = p(sumItems(['d1_h','d2_h']));
        nextEs.grupoD_mensalista = p(sumItems(['d1_m','d2_m']));
        nextEs.horista = p(nextEs.grupoA_horista + nextEs.grupoB_horista + nextEs.grupoC_horista + nextEs.grupoD_horista);
        nextEs.mensalista = p(nextEs.grupoA_mensalista + nextEs.grupoB_mensalista + nextEs.grupoC_mensalista + nextEs.grupoD_mensalista);
        onChange(nextEs);
    };
    const inputSty = { width: 68, fontSize: '0.78rem', fontWeight: 600, textAlign: 'right' as const, padding: '4px 6px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'var(--color-bg-base)', outline: 'none', transition: 'border-color 0.2s' };
    return (
        <div style={{ marginTop: 8 }}>
            <span style={{ fontSize: '0.65rem', color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>
                Estrutura SINAPI — Itens individuais {es?.basePrincipal ? `(${es.basePrincipal})` : ''}
            </span>
            <div style={{ display: 'grid', gridTemplateColumns: '36px 1fr 72px 14px 72px 14px', gap: 4, fontSize: '0.65rem', fontWeight: 800, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.04em', padding: '6px 4px 4px', borderBottom: '2px solid var(--color-border)' }}>
                <span>COD</span><span>DESCRIÇÃO</span><span style={{ textAlign: 'right' }}>HORISTA %</span><span></span><span style={{ textAlign: 'right' }}>MENSALISTA %</span><span></span>
            </div>
            {ITEMS_DEF.map(grp => (
                <div key={grp.group} style={{ marginBottom: 4 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '36px 1fr 72px 14px 72px 14px', gap: 4, padding: '6px 4px', background: 'var(--color-bg-base)', borderBottom: '1px solid var(--color-border)' }}>
                        <span style={{ fontSize: '0.72rem', fontWeight: 800, color: grp.color }}>{grp.group}</span>
                        <span style={{ fontSize: '0.72rem', fontWeight: 800, color: grp.color }}>{grp.title}</span>
                        <span></span><span></span><span></span><span></span>
                    </div>
                    {grp.items.map(item => (
                        <div key={item.code} style={{ display: 'grid', gridTemplateColumns: '36px 1fr 72px 14px 72px 14px', gap: 4, alignItems: 'center', padding: '3px 4px', borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
                            <span style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--color-text-secondary)' }}>{item.code}</span>
                            <span style={{ fontSize: '0.72rem', color: 'var(--color-text-primary)' }}>{item.name}</span>
                            <input type="number" step="0.01" className="form-input" value={es?.[item.hKey] || 0} onChange={e => updateItem(item.hKey, parseLocaleNumber(e.target.value))} style={inputSty} />
                            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{encargosMatchIcon(item.hKey, es?.[item.hKey] || 0, aiRef)}</span>
                            <input type="number" step="0.01" className="form-input" value={es?.[item.mKey] || 0} onChange={e => updateItem(item.mKey, parseLocaleNumber(e.target.value))} style={inputSty} />
                            <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{encargosMatchIcon(item.mKey, es?.[item.mKey] || 0, aiRef)}</span>
                        </div>
                    ))}
                    <div style={{ display: 'grid', gridTemplateColumns: '36px 1fr 72px auto 72px auto', gap: 4, padding: '4px 4px', borderBottom: '2px solid var(--color-border)', background: 'rgba(0,0,0,0.02)' }}>
                        <span></span>
                        <span style={{ fontSize: '0.72rem', fontWeight: 800, color: grp.color, textAlign: 'right', paddingRight: 6 }}>TOTAL</span>
                        <span style={{ fontSize: '0.78rem', fontWeight: 800, color: grp.color, textAlign: 'right' }}>{(es?.[`grupo${grp.group}_horista`] as number || 0).toFixed(2)}</span>
                        <span style={{ display: 'flex', alignItems: 'center' }}>{encargosMatchBadge(`grupo${grp.group}_horista`, es?.[`grupo${grp.group}_horista`] || 0, aiRef)}</span>
                        <span style={{ fontSize: '0.78rem', fontWeight: 800, color: grp.color, textAlign: 'right' }}>{(es?.[`grupo${grp.group}_mensalista`] as number || 0).toFixed(2)}</span>
                        <span style={{ display: 'flex', alignItems: 'center' }}>{encargosMatchBadge(`grupo${grp.group}_mensalista`, es?.[`grupo${grp.group}_mensalista`] || 0, aiRef)}</span>
                    </div>
                </div>
            ))}
            <div style={{ display: 'grid', gridTemplateColumns: '36px 1fr 72px auto 72px auto', gap: 4, padding: '8px 4px', borderTop: '3px double #6d28d9', fontWeight: 800, fontSize: '0.85rem', marginTop: 4 }}>
                <span></span><span style={{ color: '#6d28d9' }}>A + B + C + D =</span>
                <span style={{ textAlign: 'right', color: '#6d28d9' }}>{(es?.horista || 0).toFixed(2)}</span>
                <span style={{ display: 'flex', alignItems: 'center' }}>{encargosMatchBadge('horista', es?.horista || 0, aiRef)}</span>
                <span style={{ textAlign: 'right', color: '#6d28d9' }}>{(es?.mensalista || 0).toFixed(2)}</span>
                <span style={{ display: 'flex', alignItems: 'center' }}>{encargosMatchBadge('mensalista', es?.mensalista || 0, aiRef)}</span>
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

    // Image paste loading and progress states
    const [isProcessingConfigImage, setIsProcessingConfigImage] = useState(false);
    const [isProcessingBdiImage, setIsProcessingBdiImage] = useState(false);
    const [isProcessingEncargosImage, setIsProcessingEncargosImage] = useState(false);
    const [isProcessingAdditionalImage, setIsProcessingAdditionalImage] = useState<Record<number, boolean>>({});

    const [configImageProgress, setConfigImageProgress] = useState<number | null>(null);
    const [bdiImageProgress, setBdiImageProgress] = useState<number | null>(null);
    const [encargosImageProgress, setEncargosImageProgress] = useState<number | null>(null);
    const [additionalImageProgress, setAdditionalImageProgress] = useState<Record<number, number | null>>({});

    const startSimulatedProgress = (setProgress: (p: number | null) => void) => {
        setProgress(0);
        let current = 0;
        const interval = setInterval(() => {
            if (current < 90) {
                const increment = current < 50 ? 15 : current < 75 ? 8 : 3;
                current = Math.min(90, current + increment);
                setProgress(current);
            }
        }, 500);
        return () => {
            clearInterval(interval);
            setProgress(100);
            setTimeout(() => setProgress(null), 800);
        };
    };

    const ProgressBar = ({ progress, color = '#3b82f6' }: { progress: number | null; color?: string }) => {
        if (progress === null) return null;
        return (
            <div style={{ width: '100%', height: 4, background: 'var(--color-bg-base)', borderRadius: 2, overflow: 'hidden', marginTop: 6, position: 'relative' }}>
                <div style={{
                    width: `${progress}%`,
                    height: '100%',
                    background: `linear-gradient(90deg, ${color}, #8b5cf6)`,
                    transition: progress === 100 ? 'width 0.2s ease-out' : 'width 0.5s cubic-bezier(0.1, 0.8, 0.1, 1)',
                    borderRadius: 2
                }} />
            </div>
        );
    };

    const updateTcu = (field: keyof BdiTcuParams, val: number) => {
        const nextTcu = { ...bdiConfig.tcu, [field]: val };
        const calculatedBdi = calculateBdiTCU(nextTcu, engineeringConfig.precision);
        onBdiChange({ ...bdiConfig, mode: 'TCU', tcu: nextTcu, bdiGlobal: calculatedBdi });
    };

    const updateTcuFornecimento = (field: keyof BdiTcuParams, val: number) => {
        const nextTcu = { ...(bdiConfig.tcuFornecimento || DEFAULT_TCU_FORNECIMENTO_PARAMS), [field]: val };
        const calculatedBdi = calculateBdiTCU(nextTcu, engineeringConfig.precision);
        onConfigChange({ ...engineeringConfig, bdiFornecimento: calculatedBdi });
        onBdiChange({ ...bdiConfig, tcuFornecimento: nextTcu });
    };
    const tcuF = bdiConfig.tcuFornecimento || DEFAULT_TCU_FORNECIMENTO_PARAMS;

    const sectionStyle: React.CSSProperties = {
        background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--color-border)', padding: 24, display: 'flex', flexDirection: 'column', gap: 16,
    };
    const labelStyle: React.CSSProperties = {
        display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4,
    };
    const smallLabelStyle: React.CSSProperties = {
        ...labelStyle, fontSize: '0.7rem',
    };
    const inputStyle: React.CSSProperties = {
        width: '100%', fontSize: '0.85rem', fontWeight: 600, background: 'var(--color-bg-base)', padding: '8px 12px',
        border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
        transition: 'border-color 0.2s', outline: 'none',
    };
    const btnGreen: React.CSSProperties = {
        padding: '7px 14px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: 6,
        background: 'linear-gradient(135deg, #10b981, #059669)', color: 'white', border: 'none',
        borderRadius: 'var(--radius-md)', cursor: 'pointer', fontWeight: 700,
        boxShadow: '0 2px 6px rgba(16,185,129,0.2)', transition: 'all 0.2s', whiteSpace: 'nowrap',
    };
    const btnBlue: React.CSSProperties = {
        padding: '7px 14px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: 6,
        background: 'linear-gradient(135deg, #3b82f6, #6366f1)', color: '#fff', border: 'none',
        borderRadius: 'var(--radius-md)', fontWeight: 700,
        boxShadow: '0 2px 6px rgba(99,102,241,0.2)', transition: 'all 0.2s', whiteSpace: 'nowrap',
    };
    const btnClear: React.CSSProperties = {
        padding: '6px 10px', fontSize: '0.68rem', display: 'flex', alignItems: 'center', gap: 4,
        background: 'transparent', color: '#dc2626', border: '1px solid rgba(220,38,38,0.25)',
        borderRadius: 'var(--radius-md)', cursor: 'pointer', fontWeight: 700,
        transition: 'all 0.2s', whiteSpace: 'nowrap',
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
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end', minWidth: 260 }}>
                                <div style={{ display: 'flex', gap: 8 }}>
                                    <button onClick={() => {
                                        if (!confirm('Limpar todos os dados extraídos da Configuração? Você poderá extrair novamente.')) return;
                                        onConfigChange({ ...engineeringConfig, objeto: '', ufReferencia: '', basesConsideradas: ['SINAPI'], regimeOneracao: 'DESONERADO', dataBase: '', dataBases: {}, _aiExtractedRef: undefined } as any);
                                        setHasUnsavedChanges(true);
                                        setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#dc2626' }}><RotateCcw size={14} /> Configuração limpa</span>);
                                        setTimeout(() => setSaveMsg(null), 3000);
                                    }} style={btnClear} title="Limpar dados extraídos para re-extrair">
                                        <RotateCcw size={12} /> Limpar
                                    </button>
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
                                            if (!imageBlob) { alert('Nenhuma imagem no clipboard. Copie uma imagem e tente novamente.'); return; }
                                            
                                            setIsProcessingConfigImage(true);
                                            const stopProgress = startSimulatedProgress(setConfigImageProgress);
                                            
                                            const reader = new FileReader();
                                            reader.onload = async () => {
                                                const base64 = (reader.result as string).split(',')[1];
                                                try {
                                                    setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#3b82f6' }}><Loader2 size={14} className="spin" /> Lendo imagem do Orçamento...</span>);
                                                    const resp = await fetch('/api/engineering/ai-extract-config-image', {
                                                        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
                                                        body: JSON.stringify({ imageBase64: base64, mimeType: imageBlob!.type })
                                                    });
                                                    const result = await resp.json();
                                                    if (result.found) {
                                                        const d = result.data || result;
                                                        const updates: any = {};
                                                        if (d.objeto) updates.objeto = d.objeto;
                                                        if (d.uf) updates.ufReferencia = d.uf;
                                                        if (Array.isArray(d.bases) && d.bases.length > 0) updates.basesConsideradas = d.bases;
                                                        if (d.dataBase) updates.dataBase = d.dataBase;
                                                        if (d.dataBasesPorFonte && typeof d.dataBasesPorFonte === 'object') {
                                                            updates.dataBases = d.dataBasesPorFonte;
                                                            if (!d.dataBase) updates.dataBase = Object.values(d.dataBasesPorFonte)[0] as string;
                                                        }
                                                        if (d.regime === 'ONERADO' || d.regime === 'DESONERADO') updates.regimeOneracao = d.regime;
                                                        // P1: Store AI-extracted snapshot for consistency badges
                                                        updates._aiExtractedRef = {
                                                            objeto: d.objeto || undefined,
                                                            ufReferencia: d.uf || undefined,
                                                            regimeOneracao: d.regime || undefined,
                                                            dataBase: d.dataBase || undefined,
                                                            dataBases: d.dataBasesPorFonte || undefined,
                                                            basesConsideradas: Array.isArray(d.bases) ? d.bases : undefined,
                                                        };
                                                        onConfigChange({ ...engineeringConfig, ...updates });
                                                        setHasUnsavedChanges(true);
                                                        setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-success)' }}><CheckCircle2 size={14} /> Configurações extraídas!</span>);
                                                    } else { alert('Não foi possível extrair configurações da imagem.'); setSaveMsg(null); }
                                                    setTimeout(() => setSaveMsg(null), 4000);
                                                } catch (err: any) { alert('Erro: ' + err.message); setSaveMsg(null); }
                                                finally {
                                                    stopProgress();
                                                    setIsProcessingConfigImage(false);
                                                }
                                            };
                                            reader.readAsDataURL(imageBlob);
                                        } catch (err: any) { alert('Erro ao ler clipboard: ' + err.message); }
                                    }} style={{ ...btnGreen, cursor: isProcessingConfigImage ? 'wait' : 'pointer', opacity: isProcessingConfigImage ? 0.7 : 1 }} disabled={isProcessingConfigImage}>
                                        {isProcessingConfigImage ? <Loader2 size={14} className="spin" /> : <FileImage size={14} />} {isProcessingConfigImage ? 'Processando...' : 'Extrair de Print (Ctrl+V)'}
                                    </button>
                                    {onExtractConfig && (
                                        <button style={{ ...btnBlue, cursor: isExtractingConfig ? 'wait' : 'pointer', opacity: isExtractingConfig ? 0.7 : 1 }}
                                            onClick={onExtractConfig} disabled={isExtractingConfig || isProcessingConfigImage}>
                                            {isExtractingConfig ? <Loader2 size={14} className="spin" /> : <Wand2 size={14} />} Extrair via IA
                                        </button>
                                    )}
                                </div>
                                <ProgressBar progress={configImageProgress} />
                            </div>
                    </div>

                    {/* Objeto */}
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <label style={labelStyle}>Objeto da Obra</label>
                            {configConsistencyBadge('objeto', engineeringConfig.objeto, engineeringConfig._aiExtractedRef)}
                        </div>
                        <textarea className="form-input" rows={2} value={engineeringConfig.objeto}
                            onChange={e => onConfigChange({ ...engineeringConfig, objeto: e.target.value })}
                            placeholder="Ex: Construção de quadra poliesportiva..."
                            style={{ ...inputStyle, resize: 'none' }} />
                    </div>

                    {/* UF */}
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <label style={labelStyle}>UF da Obra / Base Oficial</label>
                            {configConsistencyBadge('ufReferencia', engineeringConfig.ufReferencia, engineeringConfig._aiExtractedRef)}
                        </div>
                        <select className="form-select" value={engineeringConfig.ufReferencia || ''}
                            onChange={e => onConfigChange({ ...engineeringConfig, ufReferencia: e.target.value })}
                            style={inputStyle}>
                            <option value="">Automático</option>
                            {BRAZILIAN_UFS.map(uf => <option key={uf} value={uf}>{uf}</option>)}
                        </select>
                    </div>

                    {/* Bases */}
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <label style={labelStyle}>Bases de Referência</label>
                            {engineeringConfig._aiExtractedRef?.basesConsideradas && (() => {
                                const aiB = engineeringConfig._aiExtractedRef.basesConsideradas || [];
                                const curB = engineeringConfig.basesConsideradas || [];
                                const match = aiB.length === curB.length && aiB.every((b: string) => curB.includes(b));
                                return match
                                    ? <MatchBadge status="ok" label="✓ Edital" title={`Bases conferem com o edital: ${aiB.join(', ')}`} />
                                    : <MatchBadge status="divergent" label={`Edital: ${aiB.join(', ')}`} title={`IA extraiu: ${aiB.join(', ')}. Selecionadas: ${curB.join(', ')}`} />;
                            })()}
                        </div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                            {['SINAPI', 'SEINFRA', 'SICOR', 'ORSE', 'SICRO', 'SBC', 'PROPRIA'].map(base => {
                                const isChecked = engineeringConfig.basesConsideradas.includes(base);
                                const aiDetected = engineeringConfig._aiExtractedRef?.basesConsideradas?.includes(base);
                                return (
                                    <label key={base} style={{
                                        display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.75rem', fontWeight: 600,
                                        background: isChecked ? 'var(--color-primary-light)' : 'var(--color-bg-base)',
                                        color: isChecked ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                                        padding: '4px 10px', borderRadius: 'var(--radius-full)',
                                        border: `1px solid ${isChecked ? 'var(--color-primary)' : 'var(--color-border)'}`,
                                        cursor: 'pointer', transition: 'all 0.2s', userSelect: 'none',
                                        boxShadow: aiDetected && !isChecked ? '0 0 0 2px rgba(239,68,68,0.3)' : undefined,
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
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <label style={labelStyle}>Regime de Desoneração</label>
                            {configConsistencyBadge('regimeOneracao', engineeringConfig.regimeOneracao, engineeringConfig._aiExtractedRef)}
                        </div>
                        <select className="form-select" value={engineeringConfig.regimeOneracao}
                            onChange={e => onConfigChange({ ...engineeringConfig, regimeOneracao: e.target.value as 'DESONERADO' | 'ONERADO' })}
                            style={inputStyle}>
                            <option value="DESONERADO">Desonerado</option>
                            <option value="ONERADO">Onerado</option>
                        </select>
                    </div>

                    <div>
                        <label style={labelStyle}>Data Base (Referência Temporal)</label>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, background: 'var(--color-bg-base)', padding: 10, borderRadius: 'var(--radius-md)' }}>
                            {engineeringConfig.basesConsideradas.length === 0 && <span style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>Nenhuma base selecionada</span>}
                            {engineeringConfig.basesConsideradas.map(base => {
                                // Bases that use version-based identification (SEINFRA 028/028.1) instead of monthly cadence
                                const VERSION_BASES = ['SEINFRA', 'SICRO', 'SBC'];
                                const isVersionBased = VERSION_BASES.some(vb => base.toUpperCase().includes(vb));

                                const curVal = engineeringConfig.dataBases?.[base] || engineeringConfig.dataBase || '';
                                const aiDbs = engineeringConfig._aiExtractedRef?.dataBases;
                                const aiVal = aiDbs?.[base] || engineeringConfig._aiExtractedRef?.dataBase;
                                let dateBadge: React.ReactNode = null;
                                if (!isVersionBased) {
                                    if (aiVal && curVal) {
                                        dateBadge = curVal === aiVal
                                            ? <MatchBadge status="ok" label="✓ Edital" title={`Data base confere com o edital: ${aiVal}`} />
                                            : <MatchBadge status="divergent" label={`Edital: ${aiVal}`} title={`IA extraiu: ${aiVal}. Atual: ${curVal}`} />;
                                    } else if (aiVal && !curVal) {
                                        dateBadge = <MatchBadge status="info" label={`IA: ${aiVal}`} title={`IA extraiu: ${aiVal}. Preencha o campo.`} />;
                                    }
                                }
                                return (
                                    <div key={base} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                                        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-secondary)' }}>{base}</span>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                            {isVersionBased ? (
                                                <span style={{ fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-tertiary)', padding: '6px 12px', background: 'var(--color-bg-base)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', fontStyle: 'italic' }}>
                                                    Identificada por versão (sem data-base mensal)
                                                </span>
                                            ) : (
                                                <>
                                                    {dateBadge}
                                                    <input type="month" className="form-input"
                                                        value={curVal}
                                                        onChange={e => onConfigChange({
                                                            ...engineeringConfig,
                                                            dataBase: engineeringConfig.dataBase || e.target.value,
                                                            dataBases: { ...engineeringConfig.dataBases, [base]: e.target.value }
                                                        })}
                                                        style={{ ...inputStyle, width: 160 }} />
                                                </>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Arredondamento */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
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
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end', minWidth: 260 }}>
                                <div style={{ display: 'flex', gap: 8 }}>
                                    <button onClick={() => {
                                        if (!confirm('Limpar todos os valores do BDI? Você poderá extrair novamente.')) return;
                                        const defaultTcu: BdiTcuParams = { adminCentral: 0, seguros: 0, garantias: 0, riscos: 0, despFinanceiras: 0, lucro: 0, pis: 0, cofins: 0, iss: 0, csll: 0, cprb: 0 };
                                        onBdiChange({ ...bdiConfig, mode: 'TCU', tcu: defaultTcu, bdiGlobal: 0 });
                                        onConfigChange({ ...engineeringConfig, _aiExtractedBdi: undefined } as any);
                                        setHasUnsavedChanges(true);
                                        setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#dc2626' }}><RotateCcw size={14} /> BDI limpo</span>);
                                        setTimeout(() => setSaveMsg(null), 3000);
                                    }} style={btnClear} title="Limpar BDI para re-extrair">
                                        <RotateCcw size={12} /> Limpar
                                    </button>
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
                                            if (!imageBlob) { alert('Nenhuma imagem no clipboard. Copie uma imagem e tente novamente.'); return; }
                                            
                                            setIsProcessingBdiImage(true);
                                            const stopProgress = startSimulatedProgress(setBdiImageProgress);
                                            
                                            const reader = new FileReader();
                                            reader.onload = async () => {
                                                const base64 = (reader.result as string).split(',')[1];
                                                try {
                                                    setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#3b82f6' }}><Loader2 size={14} className="spin" /> Lendo imagem do BDI...</span>);
                                                    const resp = await fetch('/api/engineering/ai-extract-bdi-image', {
                                                        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` },
                                                        body: JSON.stringify({ imageBase64: base64, mimeType: imageBlob!.type, isOnerado: engineeringConfig.regimeOneracao === 'ONERADO' })
                                                    });
                                                    const result = await resp.json();
                                                    if (result.found) {
                                                        const d = result.data || result;
                                                        if (d.tcu) {
                                                            const rawTcu = d.tcu;
                                                            if (rawTcu.tributos != null && rawTcu.pis == null) {
                                                                const total = rawTcu.tributos;
                                                                rawTcu.pis = 0.65;
                                                                rawTcu.cofins = 3.00;
                                                                rawTcu.iss = Math.max(0, total - 0.65 - 3.00);
                                                                delete rawTcu.tributos;
                                                            }
                                                            const tcu = { ...bdiConfig.tcu, ...rawTcu };
                                                            onBdiChange({ ...bdiConfig, mode: 'TCU', tcu, bdiGlobal: d.tcu.bdiGlobal || bdiConfig.bdiGlobal });
                                                            setHasUnsavedChanges(true);
                                                            setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-success)' }}><CheckCircle2 size={14} /> BDI extraído!</span>);
                                                        }
                                                    } else { alert('Não foi possível extrair BDI da imagem.'); setSaveMsg(null); }
                                                    setTimeout(() => setSaveMsg(null), 4000);
                                                } catch (err: any) { alert('Erro: ' + err.message); setSaveMsg(null); }
                                                finally {
                                                    stopProgress();
                                                    setIsProcessingBdiImage(false);
                                                }
                                            };
                                            reader.readAsDataURL(imageBlob);
                                        } catch (err: any) { alert('Erro ao ler clipboard: ' + err.message); }
                                    }} style={{ ...btnGreen, cursor: isProcessingBdiImage ? 'wait' : 'pointer', opacity: isProcessingBdiImage ? 0.7 : 1 }} disabled={isProcessingBdiImage}>
                                        {isProcessingBdiImage ? <Loader2 size={14} className="spin" /> : <FileImage size={14} />} {isProcessingBdiImage ? 'Processando...' : 'Extrair de Print (Ctrl+V)'}
                                    </button>
                                    {onExtractBdi && (
                                        <button style={{ ...btnBlue, cursor: isExtractingBdi ? 'wait' : 'pointer', opacity: isExtractingBdi ? 0.7 : 1 }}
                                            onClick={onExtractBdi} disabled={isExtractingBdi || isProcessingBdiImage}>
                                            {isExtractingBdi ? <Loader2 size={14} className="spin" /> : <Wand2 size={14} />} Extrair via IA
                                        </button>
                                    )}
                                </div>
                                <ProgressBar progress={bdiImageProgress} />
                            </div>
                        </div>

                        {/* BDI Global — Read-Only Card */}
                        <div style={{ padding: 20, borderRadius: 'var(--radius-lg)', background: 'linear-gradient(135deg, rgba(37,99,235,0.06), rgba(139,92,246,0.06))', border: '1px solid rgba(37,99,235,0.12)', textAlign: 'center' }}>
                            <div style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4 }}>BDI Global — Serviços (TCU 2622)</div>
                            <div style={{ fontSize: '2.2rem', fontWeight: 800, color: 'var(--color-primary)', lineHeight: 1 }}>{calculateBdiTCU(bdiConfig.tcu, engineeringConfig.precision).toFixed(engineeringConfig.precision?.casasDecimais || 2)}%</div>
                            <div style={{ fontSize: '0.65rem', color: 'var(--color-text-tertiary)', marginTop: 6, fontStyle: 'italic' }}>Calculado automaticamente a partir da composição abaixo</div>
                        </div>

                        {/* TCU Breakdown — Always visible */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                                {([['adminCentral', 'Adm. Central (%)'], ['seguros', 'Seguros (%)'], ['garantias', 'Garantias (%)'], ['riscos', 'Riscos (%)']] as const).map(([key, label]) => (
                                    <div key={key}>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                            <label style={smallLabelStyle}>{label}</label>
                                            {bdiMatchBadge(key, bdiConfig.tcu[key], (engineeringConfig as any)._aiExtractedBdi)}
                                        </div>
                                        <input type="number" className="form-input" value={bdiConfig.tcu[key]}
                                            onChange={e => updateTcu(key, parseLocaleNumber(e.target.value))}
                                            style={inputStyle} step="0.01" />
                                    </div>
                                ))}
                            </div>
                            <div style={{ borderTop: '1px dashed var(--color-border)', margin: '2px 0' }} />
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                                <div>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                        <label style={smallLabelStyle}>Desp. Financeiras (%)</label>
                                        {bdiMatchBadge('despFinanceiras', bdiConfig.tcu.despFinanceiras, (engineeringConfig as any)._aiExtractedBdi)}
                                    </div>
                                    <input type="number" className="form-input" value={bdiConfig.tcu.despFinanceiras}
                                        onChange={e => updateTcu('despFinanceiras', parseLocaleNumber(e.target.value))}
                                        style={inputStyle} step="0.01" />
                                </div>
                                <div>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                        <label style={smallLabelStyle}>Lucro / Remuneração (%)</label>
                                        {bdiMatchBadge('lucro', bdiConfig.tcu.lucro, (engineeringConfig as any)._aiExtractedBdi)}
                                    </div>
                                    <input type="number" className="form-input" value={bdiConfig.tcu.lucro}
                                        onChange={e => updateTcu('lucro', parseLocaleNumber(e.target.value))}
                                        style={inputStyle} step="0.01" />
                                </div>
                            </div>
                            <div style={{ borderTop: '1px solid rgba(37,99,235,0.12)', paddingTop: 8, marginTop: 4 }}>
                                <label style={{ ...smallLabelStyle, fontWeight: 700, color: 'var(--color-primary)' }}>Tributos (I) = {((bdiConfig.tcu.pis || 0) + (bdiConfig.tcu.cofins || 0) + (bdiConfig.tcu.iss || 0) + (bdiConfig.tcu.csll || 0) + (bdiConfig.tcu.cprb || 0)).toFixed(2)}%</label>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8 }}>
                                    <div>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                            <label style={smallLabelStyle}>PIS (%)</label>
                                            {bdiMatchBadge('pis', bdiConfig.tcu.pis, (engineeringConfig as any)._aiExtractedBdi)}
                                        </div>
                                        <input type="number" className="form-input" value={bdiConfig.tcu.pis}
                                            onChange={e => updateTcu('pis', parseLocaleNumber(e.target.value))}
                                            style={inputStyle} step="0.01" />
                                    </div>
                                    <div>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                            <label style={smallLabelStyle}>COFINS (%)</label>
                                            {bdiMatchBadge('cofins', bdiConfig.tcu.cofins, (engineeringConfig as any)._aiExtractedBdi)}
                                        </div>
                                        <input type="number" className="form-input" value={bdiConfig.tcu.cofins}
                                            onChange={e => updateTcu('cofins', parseLocaleNumber(e.target.value))}
                                            style={inputStyle} step="0.01" />
                                    </div>
                                    <div>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                            <label style={smallLabelStyle}>ISS (%)</label>
                                            {bdiMatchBadge('iss', bdiConfig.tcu.iss, (engineeringConfig as any)._aiExtractedBdi)}
                                        </div>
                                        <input type="number" className="form-input" value={bdiConfig.tcu.iss}
                                            onChange={e => updateTcu('iss', parseLocaleNumber(e.target.value))}
                                            style={inputStyle} step="0.01" />
                                    </div>
                                    <div>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                            <label style={smallLabelStyle}>CSLL (%)</label>
                                            {bdiMatchBadge('csll', bdiConfig.tcu.csll || 0, (engineeringConfig as any)._aiExtractedBdi)}
                                        </div>
                                        <input type="number" className="form-input" value={bdiConfig.tcu.csll || 0}
                                            onChange={e => updateTcu('csll', parseLocaleNumber(e.target.value))}
                                            style={inputStyle} step="0.01" />
                                    </div>
                                    <div>
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                            <label style={smallLabelStyle}>CPRB (%)</label>
                                            {bdiMatchBadge('cprb', bdiConfig.tcu.cprb || 0, (engineeringConfig as any)._aiExtractedBdi)}
                                        </div>
                                        <input type="number" className="form-input" value={bdiConfig.tcu.cprb || 0}
                                            onChange={e => updateTcu('cprb', parseLocaleNumber(e.target.value))}
                                            style={inputStyle} step="0.01" />
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
                                <button style={{ ...btnBlue, background: 'linear-gradient(135deg, #d97706, #b45309)', boxShadow: '0 2px 6px rgba(180,83,9,0.2)', cursor: isExtractingBdi ? 'wait' : 'pointer', opacity: isExtractingBdi ? 0.7 : 1 }}
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
                                        <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#b45309', lineHeight: 1 }}>{calculateBdiTCU(tcuF, engineeringConfig.precision).toFixed(engineeringConfig.precision?.casasDecimais || 2)}%</div>
                                        <div style={{ fontSize: '0.6rem', color: '#92400e', marginTop: 6, fontStyle: 'italic' }}>Aplicado a itens de MATERIAL e EQUIPAMENTO</div>
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                                        {([['adminCentral', 'Adm. Central'], ['seguros', 'Seguros'], ['garantias', 'Garantias'], ['riscos', 'Riscos']] as const).map(([key, label]) => (
                                            <div key={key}>
                                                <label style={{ ...smallLabelStyle, color: '#92400e' }}>{label} (%)</label>
                                                <input type="number" className="form-input" value={tcuF[key]}
                                                    onChange={e => updateTcuFornecimento(key, parseLocaleNumber(e.target.value))}
                                                    style={inputStyle} step="0.01" />
                                            </div>
                                        ))}
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                                        <div>
                                            <label style={{ ...labelStyle, marginBottom: 3, fontSize: '0.68rem', color: '#92400e' }}>Desp. Financeiras (%)</label>
                                            <input type="number" className="form-input" value={tcuF.despFinanceiras}
                                                onChange={e => updateTcuFornecimento('despFinanceiras', parseLocaleNumber(e.target.value))}
                                                style={inputStyle} step="0.01" />
                                        </div>
                                        <div>
                                            <label style={{ ...labelStyle, marginBottom: 3, fontSize: '0.68rem', color: '#92400e' }}>Lucro (%)</label>
                                            <input type="number" className="form-input" value={tcuF.lucro}
                                                onChange={e => updateTcuFornecimento('lucro', parseLocaleNumber(e.target.value))}
                                                style={inputStyle} step="0.01" />
                                        </div>
                                    </div>
                                    <div style={{ borderTop: '1px solid rgba(180,83,9,0.15)', paddingTop: 8, marginTop: 4 }}>
                                        <label style={{ ...smallLabelStyle, fontWeight: 700, color: '#92400e' }}>Tributos (I) = {((tcuF.pis || 0) + (tcuF.cofins || 0) + (tcuF.iss || 0) + (tcuF.csll || 0) + (tcuF.cprb || 0)).toFixed(2)}%</label>
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
                                            <div>
                                                <label style={{ ...smallLabelStyle, color: '#92400e' }}>PIS (%)</label>
                                                <input type="number" className="form-input" value={tcuF.pis}
                                                    onChange={e => updateTcuFornecimento('pis', parseLocaleNumber(e.target.value))}
                                                    style={inputStyle} step="0.01" />
                                            </div>
                                            <div>
                                                <label style={{ ...smallLabelStyle, color: '#92400e' }}>COFINS (%)</label>
                                                <input type="number" className="form-input" value={tcuF.cofins}
                                                    onChange={e => updateTcuFornecimento('cofins', parseLocaleNumber(e.target.value))}
                                                    style={inputStyle} step="0.01" />
                                            </div>
                                            <div>
                                                <label style={{ ...smallLabelStyle, color: '#92400e' }}>ISS (%)</label>
                                                <input type="number" className="form-input" value={tcuF.iss}
                                                    onChange={e => updateTcuFornecimento('iss', parseLocaleNumber(e.target.value))}
                                                    style={inputStyle} step="0.01" />
                                            </div>
                                            <div>
                                                <label style={{ ...smallLabelStyle, color: '#92400e' }}>CSLL (%)</label>
                                                <input type="number" className="form-input" value={tcuF.csll || 0}
                                                    onChange={e => updateTcuFornecimento('csll', parseLocaleNumber(e.target.value))}
                                                    style={inputStyle} step="0.01" />
                                            </div>
                                            <div>
                                                <label style={{ ...smallLabelStyle, color: '#92400e' }}>CPRB (%)</label>
                                                <input type="number" className="form-input" value={tcuF.cprb || 0}
                                                    onChange={e => updateTcuFornecimento('cprb', parseLocaleNumber(e.target.value))}
                                                    style={inputStyle} step="0.01" />
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
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end', minWidth: 260 }}>
                                <div style={{ display: 'flex', gap: 8 }}>
                                    <button onClick={() => {
                                        if (!confirm('Limpar os Encargos Sociais principais? Você poderá extrair novamente.')) return;
                                        const emptyEs = { horista: 0, mensalista: 0, basePrincipal: null, encargosAdicionais: engineeringConfig.encargosSociais?.encargosAdicionais, encargoAtivo: engineeringConfig.encargosSociais?.encargoAtivo };
                                        onConfigChange({ ...engineeringConfig, encargosSociais: emptyEs as any, _aiExtractedEncargos: undefined } as any);
                                        setHasUnsavedChanges(true);
                                        setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#dc2626' }}><RotateCcw size={14} /> Encargos limpos</span>);
                                        setTimeout(() => setSaveMsg(null), 3000);
                                    }} style={btnClear} title="Limpar encargos principais para re-extrair">
                                        <RotateCcw size={12} /> Limpar
                                    </button>
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
                                            
                                            setIsProcessingEncargosImage(true);
                                            const stopProgress = startSimulatedProgress(setEncargosImageProgress);
                                            
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
                                                finally {
                                                    stopProgress();
                                                    setIsProcessingEncargosImage(false);
                                                }
                                            };
                                            reader.readAsDataURL(imageBlob);
                                        } catch (err: any) { alert('Erro ao ler clipboard: ' + err.message); }
                                    }} style={{ ...btnGreen, cursor: isProcessingEncargosImage ? 'wait' : 'pointer', opacity: isProcessingEncargosImage ? 0.7 : 1 }} disabled={isProcessingEncargosImage}>
                                        {isProcessingEncargosImage ? <Loader2 size={14} className="spin" /> : <FileImage size={14} />} {isProcessingEncargosImage ? 'Processando...' : 'Extrair de Print (Ctrl+V)'}
                                    </button>
                                    {onExtractEncargos && (
                                        <button style={{ ...btnBlue, background: 'linear-gradient(135deg, #7c3aed, #6d28d9)', boxShadow: '0 2px 6px rgba(109,40,217,0.2)', cursor: isExtractingEncargos ? 'wait' : 'pointer', opacity: isExtractingEncargos ? 0.7 : 1 }}
                                            onClick={onExtractEncargos} disabled={isExtractingEncargos || isProcessingEncargosImage}>
                                            {isExtractingEncargos ? <Loader2 size={14} className="spin" /> : <Wand2 size={14} />} Extrair via IA
                                        </button>
                                    )}
                                </div>
                                <ProgressBar progress={encargosImageProgress} color="#6d28d9" />
                            </div>
                        </div>

                        {/* Totals */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                            <div style={{ padding: 16, borderRadius: 'var(--radius-lg)', background: 'linear-gradient(135deg, rgba(30,64,175,0.04), rgba(59,130,246,0.06))', border: '1px solid rgba(30,64,175,0.15)', textAlign: 'center', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 4 }}>
                                    <span style={{ fontSize: '0.7rem', fontWeight: 800, color: '#1e40af', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Horista</span>
                                    {encargosMatchBadge('horista', engineeringConfig.encargosSociais?.horista || 0, (engineeringConfig as any)._aiExtractedEncargos)}
                                </div>
                                <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#1e40af', lineHeight: 1 }}>{(engineeringConfig.encargosSociais?.horista || 0).toFixed(2)}%</div>
                                <input type="number" step="0.01" className="form-input" value={engineeringConfig.encargosSociais?.horista || 0}
                                    onChange={e => onConfigChange({ ...engineeringConfig, encargosSociais: { ...engineeringConfig.encargosSociais, horista: parseLocaleNumber(e.target.value) } })}
                                    style={{ ...inputStyle, marginTop: 12, textAlign: 'center', border: 'none', background: 'transparent' }} />
                            </div>
                            <div style={{ padding: 16, borderRadius: 'var(--radius-lg)', background: 'linear-gradient(135deg, rgba(109,40,217,0.04), rgba(139,92,246,0.06))', border: '1px solid rgba(109,40,217,0.15)', textAlign: 'center', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: 4 }}>
                                    <span style={{ fontSize: '0.7rem', fontWeight: 800, color: '#6d28d9', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Mensalista</span>
                                    {encargosMatchBadge('mensalista', engineeringConfig.encargosSociais?.mensalista || 0, (engineeringConfig as any)._aiExtractedEncargos)}
                                </div>
                                <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#6d28d9', lineHeight: 1 }}>{(engineeringConfig.encargosSociais?.mensalista || 0).toFixed(2)}%</div>
                                <input type="number" step="0.01" className="form-input" value={engineeringConfig.encargosSociais?.mensalista || 0}
                                    onChange={e => onConfigChange({ ...engineeringConfig, encargosSociais: { ...engineeringConfig.encargosSociais, mensalista: parseLocaleNumber(e.target.value) } })}
                                    style={{ ...inputStyle, marginTop: 12, textAlign: 'center', border: 'none', background: 'transparent' }} />
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
                                    precision={engineeringConfig.precision}
                                    aiRef={(engineeringConfig as any)._aiExtractedEncargos}
                                    onChange={newEs => {
                                        onConfigChange({ ...engineeringConfig, encargosSociais: newEs });
                                        setHasUnsavedChanges(true);
                                    }} 
                                />
                            )}
                        </div>

                        <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 12 }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                                <span style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--color-text-primary)' }}>
                                    <ClipboardList size={14} style={{display:'inline',verticalAlign:-2,marginRight:4}} /> Planilhas Adicionais de Encargos
                                </span>
                            </div>
                            <p style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)', margin: '0 0 8px', lineHeight: 1.4 }}>
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
                                            style={{ ...inputStyle, flex: 1 }} />
                                        {/* Image paste button */}
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, alignItems: 'flex-end' }}>
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
                                                    
                                                    setIsProcessingAdditionalImage(prev => ({ ...prev, [idx]: true }));
                                                    const stopProgress = startSimulatedProgress(p => setAdditionalImageProgress(prev => ({ ...prev, [idx]: p })));
                                                    
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
                                                                onConfigChange({ 
                                                                    ...engineeringConfig, 
                                                                    encargosSociais: { ...engineeringConfig.encargosSociais, encargosAdicionais: sheets },
                                                                    _aiExtractedEncargosAdicionais: (() => {
                                                                        const arr = [...((engineeringConfig as any)._aiExtractedEncargosAdicionais || [])];
                                                                        arr[idx] = { ...d, horista: d.totalHorista || 0, mensalista: d.totalMensalista || 0 };
                                                                        return arr;
                                                                    })(),
                                                                } as any);
                                                                setHasUnsavedChanges(true);
                                                                // Auto-open detail for this sheet
                                                                setShowAdicionalDetail(prev => ({ ...prev, [idx]: true }));
                                                                setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-success)' }}><CheckCircle2 size={14} /> Encargos extraídos! H={d.totalHorista}% M={d.totalMensalista}%</span>);
                                                            } else { alert('Não foi possível extrair encargos da imagem.'); setSaveMsg(null); }
                                                            setTimeout(() => setSaveMsg(null), 4000);
                                                        } catch (err: any) { alert('Erro: ' + err.message); setSaveMsg(null); }
                                                        finally {
                                                            stopProgress();
                                                            setIsProcessingAdditionalImage(prev => ({ ...prev, [idx]: false }));
                                                        }
                                                    };
                                                    reader.readAsDataURL(imageBlob);
                                                } catch (err: any) { alert('Erro ao ler clipboard: ' + err.message); }
                                            }} style={{ ...btnGreen, background: 'linear-gradient(135deg, #6d28d9, #8b5cf6)', boxShadow: '0 2px 6px rgba(109,40,217,0.2)', cursor: isProcessingAdditionalImage[idx] ? 'wait' : 'pointer', opacity: isProcessingAdditionalImage[idx] ? 0.7 : 1 }} disabled={isProcessingAdditionalImage[idx]}>
                                                {isProcessingAdditionalImage[idx] ? <Loader2 size={13} className="spin" /> : <FileImage size={13} />} {isProcessingAdditionalImage[idx] ? 'Processando...' : 'Extrair de Print (Ctrl+V)'}
                                            </button>
                                            <ProgressBar progress={additionalImageProgress[idx] ?? null} color="#6d28d9" />
                                        </div>
                                        <button onClick={() => {
                                            if (!confirm(`Limpar os valores desta planilha (${sheet.label || 'Base ' + (idx+2)})? Você poderá extrair novamente.`)) return;
                                            const sheets = [...(engineeringConfig.encargosSociais?.encargosAdicionais || [])];
                                            sheets[idx] = { label: sheet.label, horista: 0, mensalista: 0 };
                                            const aiArr = [...((engineeringConfig as any)._aiExtractedEncargosAdicionais || [])];
                                            aiArr[idx] = undefined;
                                            onConfigChange({ ...engineeringConfig, encargosSociais: { ...engineeringConfig.encargosSociais, encargosAdicionais: sheets }, _aiExtractedEncargosAdicionais: aiArr } as any);
                                            setHasUnsavedChanges(true);
                                            setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#dc2626' }}><RotateCcw size={14} /> Planilha limpa</span>);
                                            setTimeout(() => setSaveMsg(null), 3000);
                                        }} style={btnClear} title="Limpar valores desta planilha para re-extrair" disabled={isProcessingAdditionalImage[idx]}>
                                            <RotateCcw size={12} /> Limpar
                                        </button>
                                        <button onClick={() => {
                                            const sheets = [...(engineeringConfig.encargosSociais?.encargosAdicionais || [])];
                                            sheets.splice(idx, 1);
                                            onConfigChange({ ...engineeringConfig, encargosSociais: { ...engineeringConfig.encargosSociais, encargosAdicionais: sheets } });
                                        }} style={{ padding: '7px 8px', borderRadius: 'var(--radius-md)', border: '1px solid rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.05)', color: '#dc2626', cursor: 'pointer', fontSize: '0.75rem', display: 'flex', alignItems: 'center' }} disabled={isProcessingAdditionalImage[idx]} title="Remover esta planilha">
                                            <Trash2 size={12} />
                                        </button>
                                    </div>
                                    {/* Totals */}
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 8 }}>
                                        <div style={{ background: 'white', padding: 8, borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', textAlign: 'center' }}>
                                            <label style={{ ...smallLabelStyle, color: '#6d28d9', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>Horista (%) {encargosMatchBadge('horista', sheet.horista || 0, (engineeringConfig as any)._aiExtractedEncargosAdicionais?.[idx])}</label>
                                            <input type="number" step="0.01" className="form-input"
                                                value={sheet.horista || 0}
                                                onChange={e => {
                                                    const sheets = [...(engineeringConfig.encargosSociais?.encargosAdicionais || [])];
                                                    sheets[idx] = { ...sheets[idx], horista: parseLocaleNumber(e.target.value) };
                                                    onConfigChange({ ...engineeringConfig, encargosSociais: { ...engineeringConfig.encargosSociais, encargosAdicionais: sheets } });
                                                }}
                                                style={{ ...inputStyle, textAlign: 'center', border: 'none', background: 'transparent' }} />
                                        </div>
                                        <div style={{ background: 'white', padding: 8, borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', textAlign: 'center' }}>
                                            <label style={{ ...smallLabelStyle, color: '#6d28d9', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4 }}>Mensalista (%) {encargosMatchBadge('mensalista', sheet.mensalista || 0, (engineeringConfig as any)._aiExtractedEncargosAdicionais?.[idx])}</label>
                                            <input type="number" step="0.01" className="form-input"
                                                value={sheet.mensalista || 0}
                                                onChange={e => {
                                                    const sheets = [...(engineeringConfig.encargosSociais?.encargosAdicionais || [])];
                                                    sheets[idx] = { ...sheets[idx], mensalista: parseLocaleNumber(e.target.value) };
                                                    onConfigChange({ ...engineeringConfig, encargosSociais: { ...engineeringConfig.encargosSociais, encargosAdicionais: sheets } });
                                                }}
                                                style={{ ...inputStyle, textAlign: 'center', border: 'none', background: 'transparent' }} />
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
                                                precision={engineeringConfig.precision}
                                                aiRef={(engineeringConfig as any)._aiExtractedEncargosAdicionais?.[idx] || null}
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

                            {/* Adicionar Planilha — always at the bottom after all sheets */}
                            <button onClick={() => {
                                const sheets = [...(engineeringConfig.encargosSociais?.encargosAdicionais || [])];
                                sheets.push({ label: `Base ${sheets.length + 2}`, horista: 0, mensalista: 0 });
                                onConfigChange({ ...engineeringConfig, encargosSociais: { ...engineeringConfig.encargosSociais, encargosAdicionais: sheets } });
                            }} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, width: '100%', fontSize: '0.75rem', fontWeight: 700, padding: '10px 14px', marginTop: 8, borderRadius: 'var(--radius-md)', border: '1px dashed rgba(109,40,217,0.4)', background: 'rgba(109,40,217,0.04)', color: '#6d28d9', cursor: 'pointer' }}>
                                <Plus size={13} /> Adicionar Planilha Manualmente
                            </button>
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
