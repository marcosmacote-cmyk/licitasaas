/**
 * ReportConfigPanel.tsx — Configuração de Relatórios
 * 
 * Permite customizar cabeçalhos, rodapés, campos legais e
 * opções de exibição dos relatórios PDF/Excel de engenharia.
 */
import { Settings, FileText, Stamp, Eye, EyeOff } from 'lucide-react';
import type { ReportConfig } from './types';
import { DEFAULT_REPORT_CONFIG } from './types';

interface Props {
    config: ReportConfig;
    onChange: (config: ReportConfig) => void;
    companyName?: string;
}

const S = {
    panel: { display: 'flex', flexDirection: 'column' as const, gap: 20 },
    section: {
        background: 'var(--color-bg-surface)',
        borderRadius: 'var(--radius-lg)',
        border: '1px solid var(--color-border)',
        overflow: 'hidden',
    },
    sectionHeader: {
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '12px 16px',
        background: 'var(--color-bg-base)',
        borderBottom: '1px solid var(--color-border)',
        fontWeight: 700 as const, fontSize: '0.85rem',
        color: 'var(--color-text-primary)',
    },
    sectionBody: { padding: '16px', display: 'flex', flexDirection: 'column' as const, gap: 12 },
    fieldGroup: { display: 'flex', flexDirection: 'column' as const, gap: 4 },
    label: { fontSize: '0.75rem', fontWeight: 600 as const, color: 'var(--color-text-secondary)' },
    input: {
        padding: '8px 12px', borderRadius: 'var(--radius-md)',
        border: '1px solid var(--color-border)',
        fontSize: '0.85rem', background: 'var(--color-bg-base)',
        color: 'var(--color-text-primary)',
        outline: 'none',
        transition: 'border-color 0.15s',
    },
    textarea: {
        padding: '8px 12px', borderRadius: 'var(--radius-md)',
        border: '1px solid var(--color-border)',
        fontSize: '0.85rem', background: 'var(--color-bg-base)',
        color: 'var(--color-text-primary)',
        outline: 'none', resize: 'vertical' as const,
        minHeight: 60, fontFamily: 'inherit',
    },
    row: { display: 'flex', gap: 12, flexWrap: 'wrap' as const },
    half: { flex: '1 1 200px', display: 'flex', flexDirection: 'column' as const, gap: 4 },
    toggle: {
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '8px 12px', borderRadius: 'var(--radius-md)',
        border: '1px solid var(--color-border)',
        background: 'var(--color-bg-base)', cursor: 'pointer',
        fontSize: '0.8rem', color: 'var(--color-text-secondary)',
    },
    toggleActive: {
        borderColor: 'var(--color-primary)',
        background: 'rgba(37,99,235,0.04)',
        color: 'var(--color-primary)',
    },
    hint: { fontSize: '0.68rem', color: 'var(--color-text-tertiary)', marginTop: 2 },
};

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
    return (
        <div style={S.fieldGroup}>
            <label style={S.label}>{label}</label>
            {children}
            {hint && <span style={S.hint}>{hint}</span>}
        </div>
    );
}

function Toggle({ label, checked, onChange, icon }: { label: string; checked: boolean; onChange: (v: boolean) => void; icon?: React.ReactNode }) {
    return (
        <button
            type="button"
            onClick={() => onChange(!checked)}
            style={{ ...S.toggle, ...(checked ? S.toggleActive : {}) }}
        >
            {icon || (checked ? <Eye size={14} /> : <EyeOff size={14} />)}
            <span style={{ fontWeight: checked ? 600 : 400 }}>{label}</span>
            <div style={{
                marginLeft: 'auto', width: 32, height: 18, borderRadius: 9,
                background: checked ? 'var(--color-primary)' : 'var(--color-border)',
                position: 'relative', transition: 'background 0.2s',
            }}>
                <div style={{
                    position: 'absolute', top: 2, left: checked ? 16 : 2,
                    width: 14, height: 14, borderRadius: '50%',
                    background: '#fff', transition: 'left 0.2s',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                }} />
            </div>
        </button>
    );
}

export function ReportConfigPanel({ config, onChange, companyName }: Props) {
    const c = { ...DEFAULT_REPORT_CONFIG, ...config };
    const set = <K extends keyof ReportConfig>(key: K, value: ReportConfig[K]) => {
        onChange({ ...c, [key]: value });
    };

    return (
        <div style={S.panel}>
            {/* ═══ CABEÇALHO ═══ */}
            <div style={S.section}>
                <div style={S.sectionHeader}>
                    <FileText size={16} color="var(--color-primary)" />
                    Cabeçalho dos Relatórios
                </div>
                <div style={S.sectionBody}>
                    <Field label="Linha 1 (principal)" hint="Ex: nome da empresa. Deixe vazio para usar o nome do perfil.">
                        <input style={S.input} value={c.headerLine1 || ''} placeholder={companyName || 'Nome da Empresa'}
                            onChange={e => set('headerLine1', e.target.value)}
                            onFocus={e => { e.currentTarget.style.borderColor = 'var(--color-primary)'; }}
                            onBlur={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; }} />
                    </Field>
                    <Field label="Linha 2 (complementar)" hint="Ex: CNPJ, endereço, telefone">
                        <input style={S.input} value={c.headerLine2 || ''} placeholder="CNPJ: 00.000.000/0001-00"
                            onChange={e => set('headerLine2', e.target.value)}
                            onFocus={e => { e.currentTarget.style.borderColor = 'var(--color-primary)'; }}
                            onBlur={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; }} />
                    </Field>
                    <Field label="Linha 3 (opcional)" hint="Ex: endereço completo, site">
                        <input style={S.input} value={c.headerLine3 || ''} placeholder="Rua Exemplo, 123 - Cidade/UF"
                            onChange={e => set('headerLine3', e.target.value)}
                            onFocus={e => { e.currentTarget.style.borderColor = 'var(--color-primary)'; }}
                            onBlur={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; }} />
                    </Field>
                    <Toggle label="Repetir cabeçalho em todas as páginas" checked={c.showHeaderOnAllPages !== false} onChange={v => set('showHeaderOnAllPages', v)} />
                </div>
            </div>

            {/* ═══ RODAPÉ ═══ */}
            <div style={S.section}>
                <div style={S.sectionHeader}>
                    <FileText size={16} color="var(--color-primary)" />
                    Rodapé dos Relatórios
                </div>
                <div style={S.sectionBody}>
                    <div style={S.row}>
                        <div style={S.half}>
                            <Field label="Rodapé esquerdo" hint="Use {data}, {hora} para substituição automática">
                                <input style={S.input} value={c.footerLine1 || ''} placeholder="LicitaSaaS — {data} {hora}"
                                    onChange={e => set('footerLine1', e.target.value)}
                                    onFocus={e => { e.currentTarget.style.borderColor = 'var(--color-primary)'; }}
                                    onBlur={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; }} />
                            </Field>
                        </div>
                        <div style={S.half}>
                            <Field label="Rodapé direito" hint="Use {pagina}, {total} para numeração">
                                <input style={S.input} value={c.footerLine2 || ''} placeholder="Página {pagina} de {total}"
                                    onChange={e => set('footerLine2', e.target.value)}
                                    onFocus={e => { e.currentTarget.style.borderColor = 'var(--color-primary)'; }}
                                    onBlur={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; }} />
                            </Field>
                        </div>
                    </div>
                </div>
            </div>

            {/* ═══ CAMPOS LEGAIS / ASSINATURAS ═══ */}
            <div style={S.section}>
                <div style={S.sectionHeader}>
                    <Stamp size={16} color="var(--color-primary)" />
                    Responsáveis e Assinaturas
                </div>
                <div style={S.sectionBody}>
                    <div style={S.row}>
                        <div style={S.half}>
                            <Field label="Responsável Técnico">
                                <input style={S.input} value={c.responsavelTecnico || ''} placeholder="Eng. Nome Completo"
                                    onChange={e => set('responsavelTecnico', e.target.value)}
                                    onFocus={e => { e.currentTarget.style.borderColor = 'var(--color-primary)'; }}
                                    onBlur={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; }} />
                            </Field>
                        </div>
                        <div style={S.half}>
                            <Field label="Registro CREA / CAU">
                                <input style={S.input} value={c.registroCrea || ''} placeholder="CREA-XX 000000"
                                    onChange={e => set('registroCrea', e.target.value)}
                                    onFocus={e => { e.currentTarget.style.borderColor = 'var(--color-primary)'; }}
                                    onBlur={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; }} />
                            </Field>
                        </div>
                    </div>
                    <Field label="Representante Legal">
                        <input style={S.input} value={c.responsavelLegal || ''} placeholder="Nome do representante legal"
                            onChange={e => set('responsavelLegal', e.target.value)}
                            onFocus={e => { e.currentTarget.style.borderColor = 'var(--color-primary)'; }}
                            onBlur={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; }} />
                    </Field>
                    <Toggle label="Incluir linhas de assinatura nos relatórios" checked={c.showSignatureLines === true} onChange={v => set('showSignatureLines', v)} icon={<Stamp size={14} />} />
                    <Field label="Observação geral (exibida ao final de todos os relatórios)" hint="Ex: &quot;Os preços apresentados incluem todos os encargos legais e tributários.&quot;">
                        <textarea style={S.textarea} value={c.observacaoGeral || ''} placeholder="Texto livre de observação..."
                            onChange={e => set('observacaoGeral', e.target.value)}
                            onFocus={e => { e.currentTarget.style.borderColor = 'var(--color-primary)'; }}
                            onBlur={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; }} />
                    </Field>
                </div>
            </div>

            {/* ═══ OPÇÕES DE EXIBIÇÃO ═══ */}
            <div style={S.section}>
                <div style={S.sectionHeader}>
                    <Settings size={16} color="var(--color-primary)" />
                    Opções de Exibição
                </div>
                <div style={S.sectionBody}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))', gap: 8 }}>
                        <Toggle label="Coluna Custo Unitário" checked={c.showCustoUnit !== false} onChange={v => set('showCustoUnit', v)} />
                        <Toggle label="Coluna Preço Unitário" checked={c.showPrecoUnit !== false} onChange={v => set('showPrecoUnit', v)} />
                        <Toggle label="Tripé BDI (Sem/Com BDI)" checked={c.showBdiTripe !== false} onChange={v => set('showBdiTripe', v)} />
                        <Toggle label="Tabela Encargos Sociais" checked={c.showEncargosSociais !== false} onChange={v => set('showEncargosSociais', v)} />
                        <Toggle label="Coeficientes no Analítico" checked={c.showCoeficientes !== false} onChange={v => set('showCoeficientes', v)} />
                        <Toggle label="Coluna Banco de Origem" checked={c.showBancoOrigem !== false} onChange={v => set('showBancoOrigem', v)} />
                    </div>
                </div>
            </div>
        </div>
    );
}
