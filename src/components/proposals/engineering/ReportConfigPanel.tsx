/**
 * ReportConfigPanel.tsx — Configuração de Relatórios
 * 
 * Permite customizar cabeçalhos, rodapés, campos legais e
 * opções de exibição dos relatórios PDF/Excel de engenharia.
 */
import { Settings, FileText, Stamp, Eye, EyeOff, Image as ImageIcon, Palette, RotateCcw } from 'lucide-react';
import type { ReportConfig, ColorPalette } from './types';
import { DEFAULT_REPORT_CONFIG, DEFAULT_COLOR_PALETTE } from './types';

interface Props {
    config: ReportConfig;
    onChange: (config: ReportConfig) => void;
    companyName?: string;
    /** Logo Base64 from CompanyProfile (read-only preview) */
    logoBase64?: string;
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

export function ReportConfigPanel({ config, onChange, companyName, logoBase64 }: Props) {
    const c = { ...DEFAULT_REPORT_CONFIG, ...config };
    const set = <K extends keyof ReportConfig>(key: K, value: ReportConfig[K]) => {
        onChange({ ...c, [key]: value });
    };

    return (
        <div style={S.panel}>
            {/* ═══ LOGOTIPO ═══ */}
            <div style={S.section}>
                <div style={S.sectionHeader}>
                    <ImageIcon size={16} color="var(--color-primary)" />
                    Logotipo nos Relatórios
                </div>
                <div style={S.sectionBody}>
                    {logoBase64 ? (
                        <>
                            <div style={{
                                padding: '12px', borderRadius: 'var(--radius-md)',
                                border: '1px dashed var(--color-border)', background: 'var(--color-bg-base)',
                                textAlign: (c.logoPosition || 'left') as any,
                            }}>
                                <img
                                    src={logoBase64}
                                    alt="Logo da empresa"
                                    style={{ maxHeight: c.logoMaxHeight || 50, maxWidth: '90%', objectFit: 'contain' }}
                                />
                            </div>
                            <div style={S.row}>
                                <div style={S.half}>
                                    <Field label="Posição do logo">
                                        <div style={{ display: 'flex', gap: 6 }}>
                                            {(['left', 'center', 'right'] as const).map(pos => (
                                                <button key={pos} type="button"
                                                    onClick={() => set('logoPosition', pos)}
                                                    style={{
                                                        flex: 1, padding: '6px 10px', borderRadius: 'var(--radius-md)',
                                                        border: c.logoPosition === pos ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                                                        background: c.logoPosition === pos ? 'rgba(37,99,235,0.06)' : 'var(--color-bg-base)',
                                                        cursor: 'pointer', fontSize: '0.78rem', fontWeight: c.logoPosition === pos ? 700 : 400,
                                                        color: c.logoPosition === pos ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                                                    }}
                                                >
                                                    {pos === 'left' ? 'Esquerda' : pos === 'center' ? 'Centro' : 'Direita'}
                                                </button>
                                            ))}
                                        </div>
                                    </Field>
                                </div>
                                <div style={{ flex: '0 0 120px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                                    <Field label="Altura máx. (px)">
                                        <input type="number" style={{ ...S.input, textAlign: 'center' }}
                                            value={c.logoMaxHeight || 50} min={20} max={120} step={5}
                                            onChange={e => set('logoMaxHeight', Number(e.target.value) || 50)}
                                            onFocus={e => { e.currentTarget.style.borderColor = 'var(--color-primary)'; }}
                                            onBlur={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; }} />
                                    </Field>
                                </div>
                            </div>
                        </>
                    ) : (
                        <div style={{ padding: '16px', textAlign: 'center', color: 'var(--color-text-tertiary)', fontSize: '0.82rem' }}>
                            <ImageIcon size={24} style={{ marginBottom: 6, opacity: 0.4 }} />
                            <div>Nenhum timbrado configurado.</div>
                            <div style={{ fontSize: '0.72rem', marginTop: 4 }}>
                                Configure o timbrado no <strong>Perfil da Empresa</strong> (Passo 4 → Configuração).
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* ═══ CABEÇALHO ═══ */}
            <div style={S.section}>
                <div style={S.sectionHeader}>
                    <FileText size={16} color="var(--color-primary)" />
                    Cabeçalho dos Relatórios
                </div>
                <div style={S.sectionBody}>
                    {/* Header image upload */}
                    <Field label="Imagem do cabeçalho (timbrado)" hint="Imagem que aparecerá no topo de cada relatório. Formatos: PNG, JPG. Recomendado: 1000×120px.">
                        {c.headerImageBase64 ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                <div style={{ padding: 8, border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg-base)', textAlign: 'center' }}>
                                    <img src={c.headerImageBase64} alt="Cabeçalho" style={{ maxHeight: c.headerImageHeight || 80, maxWidth: '100%', objectFit: 'contain' }} />
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <label style={S.label}>Altura (px):</label>
                                    <input type="number" style={{ ...S.input, width: 70, textAlign: 'center' }} value={c.headerImageHeight || 80} min={30} max={200} step={5}
                                        onChange={e => set('headerImageHeight', Number(e.target.value) || 80)} />
                                    <button type="button" onClick={() => { set('headerImageBase64', ''); set('headerImageHeight', 80); }}
                                        style={{ marginLeft: 'auto', fontSize: '0.72rem', color: 'var(--color-danger)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
                                        Remover imagem
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '14px', border: '2px dashed var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: '0.78rem', color: 'var(--color-text-tertiary)', transition: 'border-color 0.2s' }}>
                                <ImageIcon size={16} />
                                Clique para enviar imagem do cabeçalho
                                <input type="file" accept="image/png,image/jpeg,image/jpg" style={{ display: 'none' }}
                                    onChange={e => { const f = e.target.files?.[0]; if (!f) return; const reader = new FileReader(); reader.onload = ev => { set('headerImageBase64', ev.target?.result as string); }; reader.readAsDataURL(f); }} />
                            </label>
                        )}
                    </Field>

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
                    {/* Footer image upload */}
                    <Field label="Imagem do rodapé" hint="Imagem que aparecerá no final de cada relatório. Formatos: PNG, JPG. Recomendado: 1000×80px.">
                        {c.footerImageBase64 ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                <div style={{ padding: 8, border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg-base)', textAlign: 'center' }}>
                                    <img src={c.footerImageBase64} alt="Rodapé" style={{ maxHeight: c.footerImageHeight || 60, maxWidth: '100%', objectFit: 'contain' }} />
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <label style={S.label}>Altura (px):</label>
                                    <input type="number" style={{ ...S.input, width: 70, textAlign: 'center' }} value={c.footerImageHeight || 60} min={20} max={150} step={5}
                                        onChange={e => set('footerImageHeight', Number(e.target.value) || 60)} />
                                    <button type="button" onClick={() => { set('footerImageBase64', ''); set('footerImageHeight', 60); }}
                                        style={{ marginLeft: 'auto', fontSize: '0.72rem', color: 'var(--color-danger)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600 }}>
                                        Remover imagem
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '14px', border: '2px dashed var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer', fontSize: '0.78rem', color: 'var(--color-text-tertiary)', transition: 'border-color 0.2s' }}>
                                <ImageIcon size={16} />
                                Clique para enviar imagem do rodapé
                                <input type="file" accept="image/png,image/jpeg,image/jpg" style={{ display: 'none' }}
                                    onChange={e => { const f = e.target.files?.[0]; if (!f) return; const reader = new FileReader(); reader.onload = ev => { set('footerImageBase64', ev.target?.result as string); }; reader.readAsDataURL(f); }} />
                            </label>
                        )}
                    </Field>

                    <div style={S.row}>
                        <div style={S.half}>
                            <Field label="Rodapé esquerdo (texto)" hint="Use {data}, {hora} para substituição automática">
                                <input style={S.input} value={c.footerLine1 || ''} placeholder="LicitaSaaS — {data} {hora}"
                                    onChange={e => set('footerLine1', e.target.value)}
                                    onFocus={e => { e.currentTarget.style.borderColor = 'var(--color-primary)'; }}
                                    onBlur={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; }} />
                            </Field>
                        </div>
                        <div style={S.half}>
                            <Field label="Rodapé direito (texto)" hint="Use {pagina}, {total} para numeração">
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
                        <Toggle label="Exportar planilhas Excel com fórmulas dinâmicas nas linhas" checked={c.exportExcelWithFormulas === true} onChange={v => set('exportExcelWithFormulas', v)} />
                    </div>
                </div>
            </div>

            {/* ═══ PALETA DE CORES ═══ */}
            <div style={S.section}>
                <div style={S.sectionHeader}>
                    <Palette size={16} color="var(--color-primary)" />
                    Paleta de Cores dos Relatórios
                </div>
                <div style={S.sectionBody}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
                        {([
                            { key: 'primary', label: 'Cor Primária', hint: 'Headers de tabela, totais gerais' },
                            { key: 'accent', label: 'Cor de Destaque', hint: 'Seções, badges, etapas' },
                            { key: 'etapaBg', label: 'Fundo de Etapas', hint: 'Fundo dos títulos de etapa' },
                            { key: 'composicaoBg', label: 'Fundo Composições', hint: 'Fundo do header de composição' },
                            { key: 'insumoBg', label: 'Fundo Insumos', hint: 'Fundo dos itens de insumo' },
                            { key: 'subtotalBg', label: 'Fundo Subtotais', hint: 'Fundo das linhas de subtotal' },
                        ] as { key: keyof ColorPalette; label: string; hint: string }[]).map(({ key, label, hint }) => {
                            const palette = { ...DEFAULT_COLOR_PALETTE, ...c.colorPalette };
                            return (
                                <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                    <label style={S.label}>{label}</label>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <input
                                            type="color"
                                            value={palette[key]}
                                            onChange={e => set('colorPalette', { ...palette, [key]: e.target.value })}
                                            style={{ width: 36, height: 28, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer', padding: 2 }}
                                        />
                                        <span style={{ fontSize: '0.72rem', fontFamily: 'monospace', color: 'var(--color-text-tertiary)' }}>{palette[key]}</span>
                                    </div>
                                    <span style={S.hint}>{hint}</span>
                                </div>
                            );
                        })}
                    </div>
                    {/* Preview strip */}
                    <div style={{ marginTop: 12, display: 'flex', gap: 0, borderRadius: 'var(--radius-md)', overflow: 'hidden', border: '1px solid var(--color-border)' }}>
                        {(['primary', 'accent', 'etapaBg', 'composicaoBg', 'insumoBg', 'subtotalBg'] as (keyof ColorPalette)[]).map(k => {
                            const palette = { ...DEFAULT_COLOR_PALETTE, ...c.colorPalette };
                            return <div key={k} style={{ flex: 1, height: 18, background: palette[k] }} title={k} />;
                        })}
                    </div>
                    {/* Reset button */}
                    <button
                        type="button"
                        onClick={() => set('colorPalette', { ...DEFAULT_COLOR_PALETTE })}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, padding: '6px 12px', fontSize: '0.75rem', color: 'var(--color-text-tertiary)', background: 'none', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}
                    >
                        <RotateCcw size={12} />
                        Restaurar cores padrão
                    </button>
                </div>
            </div>
        </div>
    );
}
