import { FileText, Sparkles, Download, Save, Loader2, CheckCircle2, Image, X, Settings2, Plus, Trash2, ChevronDown, ChevronUp, FileSignature, Building2, Briefcase, ArrowLeft, RotateCcw, AlertTriangle, Shield, ChevronRight, Scale, PenLine, FileDown, Zap, Ban, Info } from 'lucide-react';
import { useState, useEffect } from 'react';
import { ConfirmDialog } from '../ui';
import { useAiDeclaration } from '../hooks/useAiDeclaration';
import type { LayoutConfig, QualityReportFrontend, DeclarationTemplate } from '../hooks/useAiDeclaration';
import type { BiddingProcess, CompanyProfile } from '../../types';

interface Props {
    biddings: BiddingProcess[];
    companies: CompanyProfile[];
    onSave?: () => void;
    initialBiddingId?: string;
}

export function AiDeclarationGenerator({ biddings, companies, onSave, initialBiddingId }: Props) {
    const d = useAiDeclaration({ biddings, companies, onSave, initialBiddingId });
    const [manageTemplatesOpen, setManageTemplatesOpen] = useState(false);
    
    useEffect(() => {
        if (d.generationMode !== 'ai') {
            if (d.selectedTemplateIds.length === 1) {
                const active = d.templates.find(t => t.id === d.selectedTemplateIds[0]);
                if (active) {
                    d.setDeclarationType(active.title.toUpperCase());
                }
            } else if (d.selectedTemplateIds.length > 1) {
                d.setDeclarationType('DECLARAÇÃO UNIFICADA DE HABILITAÇÃO');
            } else {
                d.setDeclarationType('');
            }
        }
    }, [d.selectedTemplateIds, d.generationMode, d.templates]);

    const hasResult = !!d.generatedText || d.isGenerating;

    return (
        <>
        {!hasResult ? (
            /* ═══════════════════════════════════════════
               STEP 1: Wizard focado — O que gerar?
               ═══════════════════════════════════════════ */
            <WizardStep1 d={d} companies={companies} biddings={biddings} setManageTemplatesOpen={setManageTemplatesOpen} />
        ) : (
            /* ═══════════════════════════════════════════
               STEP 2: Editor + Refinamento
               ═══════════════════════════════════════════ */
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 340px) 1fr', gap: 'var(--space-6)', alignItems: 'start' }}>

                {/* LEFT: Refinement sidebar */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', position: 'sticky', top: 'var(--space-4)' }}>

                    {/* Back + Summary */}
                    <div style={{
                        borderRadius: 'var(--radius-xl)',
                        border: 'none',
                        overflow: 'hidden',
                        background: 'var(--color-bg-surface)',
                        boxShadow: '0 0 0 1px rgba(139,92,246,0.15), 0 2px 12px rgba(139,92,246,0.06)',
                    }}>
                        {/* Header with back */}
                        <div style={{
                            padding: 'var(--space-3) var(--space-4)',
                            background: 'linear-gradient(135deg, rgba(139,92,246,0.07) 0%, rgba(37,99,235,0.04) 60%, transparent 100%)',
                            borderBottom: '1px solid rgba(139,92,246,0.12)',
                            display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                        }}>
                            <button
                                className="icon-btn"
                                onClick={() => { d.setGeneratedText(''); }}
                                title="Voltar e configurar"
                                style={{ padding: 4, flexShrink: 0 }}
                            >
                                <ArrowLeft size={16} color="var(--color-ai)" />
                            </button>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--color-text-primary)', lineHeight: 1.2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {d.declarationType || 'Declaração'}
                                </div>
                                <div style={{ fontSize: '0.65rem', color: 'var(--color-text-tertiary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {companies.find(c => c.id === d.selectedCompanyId)?.razaoSocial || ''}
                                </div>
                            </div>
                            <button
                                className="btn btn-outline"
                                style={{ fontSize: '0.7rem', padding: '4px 10px', gap: 4, flexShrink: 0 }}
                                onClick={d.handleGenerate}
                                disabled={d.isGenerating}
                            >
                            {d.isGenerating ? <Loader2 size={11} className="spin" /> : <RotateCcw size={11} />}
                                Regenerar
                            </button>
                            {d.qualityReport && d.qualityReport.grade === 'D' && !d.isGenerating && (
                                <span style={{ fontSize: '0.6rem', color: 'var(--color-danger)', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 2 }}><AlertTriangle size={10} /> Baixa</span>
                            )}
                        </div>

                        <div style={{ padding: 'var(--space-4)' }}>
                            {/* Emitente — toggle sutil */}
                            <IssuerTypeSelector
                                issuerType={d.issuerType}
                                setIssuerType={d.setIssuerType}
                                selectedCompanyId={d.selectedCompanyId}
                                companies={companies}
                            />
                        </div>
                    </div>

                    {/* Layout & Assinatura (collapsible) */}
                    <LayoutSettingsPanel d={d} />
                </div>

                {/* RIGHT: Editor & Preview */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                    <div style={{
                        borderRadius: 'var(--radius-xl)',
                        border: 'none',
                        boxShadow: '0 0 0 1px var(--color-border), 0 4px 12px rgba(0,0,0,0.02)',
                        overflow: 'hidden',
                        background: 'var(--color-bg-surface)',
                        minHeight: 640,
                        display: 'flex', flexDirection: 'column',
                    }}>
                        <EditorToolbar d={d} />

                        {/* Quality Badge Bar */}
                        {d.qualityReport && !d.isGenerating && d.generatedText && (
                            <QualityBadgeBar report={d.qualityReport} />
                        )}

                        {/* Non-blocking warning */}
                        {d.qualityWarning && !d.isGenerating && (
                            <div style={{
                                display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)',
                                padding: 'var(--space-2) var(--space-4)',
                                borderBottom: '1px solid rgba(245,158,11,0.2)',
                                background: 'rgba(245,158,11,0.05)',
                                fontSize: '0.72rem', color: 'var(--color-warning)',
                                lineHeight: 1.4,
                            }}>
                                <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: 1 }} />
                                <span>{d.qualityWarning}</span>
                            </div>
                        )}

                        {d.isGenerating && !d.generatedText ? (
                            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 'var(--space-4)' }}>
                                <Loader2 size={36} className="spin" color="var(--color-ai)" />
                                <div style={{ fontSize: 'var(--text-md)', color: 'var(--color-text-tertiary)', fontWeight: 600 }}>Gerando declaração com IA...</div>
                            </div>
                        ) : (
                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                                <DeclarationPreview
                                    layout={d.layout}
                                    declarationType={d.declarationType}
                                    generatedText={d.generatedText}
                                    setGeneratedText={d.setGeneratedText}
                                    updateLayout={d.updateLayout}
                                    setDeclarationType={d.setDeclarationType}
                                />
                            </div>
                        )}
                    </div>
                </div>
            </div>
        )}
        <ConfirmDialog
            open={!!d.confirmAction}
            title={d.confirmAction?.type === 'deleteLayout' ? 'Excluir Layout' : 'Limpar Layout'}
            message={d.confirmAction?.type === 'deleteLayout' ? 'Excluir este layout permanentemente? Esta ação não pode ser desfeita.' : 'Limpar todos os campos deste layout?'}
            variant={d.confirmAction?.type === 'deleteLayout' ? 'danger' : 'warning'}
            confirmLabel={d.confirmAction?.type === 'deleteLayout' ? 'Excluir' : 'Limpar'}
            onConfirm={() => d.confirmAction?.onConfirm()}
            onCancel={() => d.setConfirmAction(null)}
        />
        <TemplateManagementModal
            open={manageTemplatesOpen}
            onClose={() => setManageTemplatesOpen(false)}
            d={d}
        />
        </>
    );
}

// ═══════════════════════════════════════════════
// STEP 1 — Wizard Focado
// ═══════════════════════════════════════════════

function WizardStep1({ d, companies, biddings, setManageTemplatesOpen }: {
    d: ReturnType<typeof useAiDeclaration>;
    companies: CompanyProfile[];
    biddings: BiddingProcess[];
    setManageTemplatesOpen: (open: boolean) => void;
}) {
    return (
        <div style={{ maxWidth: 1400, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 'var(--space-6)', alignItems: 'start' }}>

            {/* COLUMN 1: Config */}
            <div style={{
                borderRadius: 'var(--radius-xl)',
                border: 'none',
                overflow: 'hidden',
                background: 'var(--color-bg-surface)',
                boxShadow: '0 0 0 1px rgba(139,92,246,0.15), 0 4px 24px rgba(139,92,246,0.08)',
            }}>
                {/* Header */}
                <div style={{
                    padding: 'var(--space-6) var(--space-6)',
                    background: 'linear-gradient(135deg, rgba(139,92,246,0.07) 0%, rgba(37,99,235,0.04) 60%, transparent 100%)',
                    borderBottom: '1px solid rgba(139,92,246,0.12)',
                    display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                }}>
                    <div style={{
                        width: 44, height: 44, borderRadius: 'var(--radius-lg)',
                        background: 'linear-gradient(135deg, rgba(139,92,246,0.18), rgba(37,99,235,0.1))',
                        border: '1px solid rgba(139,92,246,0.25)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}>
                        <Sparkles size={22} color="var(--color-ai)" strokeWidth={1.75} />
                    </div>
                    <div>
                        <div style={{ fontSize: 'var(--text-xl)', fontWeight: 800, color: 'var(--color-text-primary)', lineHeight: 1.1, letterSpacing: '-0.02em' }}>Nova Declaração</div>
                        <div style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)', marginTop: 3 }}>Gere declarações formais a partir do edital ou modelos</div>
                    </div>
                </div>

                {/* Fields */}
                <div style={{ padding: 'var(--space-5) var(--space-6)' }}>
                    <ConfigField label="Licitação" icon={<Briefcase size={10} />} stepNumber={1}>
                        <select className="form-select" value={d.selectedBiddingId} onChange={(e) => d.handleBiddingChange(e.target.value)}>
                            <option value="">— Selecione a licitação —</option>
                            {d.biddingsWithAnalysis.map(b => <option key={b.id} value={b.id}>{b.title}</option>)}
                        </select>
                    </ConfigField>

                    <ConfigField label="Empresa" icon={<Building2 size={10} />} stepNumber={2}>
                        <select className="form-select" value={d.selectedCompanyId} onChange={(e) => d.handleCompanyChange(e.target.value)}>
                            <option value="">— Selecione a empresa —</option>
                            {companies.map(c => <option key={c.id} value={c.id}>{c.razaoSocial}</option>)}
                        </select>
                    </ConfigField>

                    <ConfigField label="Modo de Geração" stepNumber={3}>
                        <div style={{ display: 'flex', gap: 'var(--space-1)', marginBottom: 'var(--space-2)' }}>
                            {[
                                { value: 'ai', label: '100% IA', desc: 'IA cria via edital', icon: <Sparkles size={13} /> },
                                { value: 'static', label: 'Estático', desc: 'Modelo preenchido', icon: <FileText size={13} /> },
                                { value: 'mixed', label: 'Misto', desc: 'IA adapta modelo', icon: <Zap size={13} /> }
                            ].map(m => (
                                <button
                                    key={m.value}
                                    type="button"
                                    onClick={() => d.setGenerationMode(m.value as any)}
                                    style={{
                                        flex: 1, padding: '8px 10px',
                                        borderRadius: 'var(--radius-md)',
                                        border: 'none',
                                        boxShadow: d.generationMode === m.value ? '0 0 0 2px var(--color-primary), 0 4px 12px rgba(0,0,0,0.05)' : '0 0 0 1px var(--color-border)',
                                        background: d.generationMode === m.value ? 'var(--color-primary-light)' : 'var(--color-bg-body)',
                                        cursor: 'pointer',
                                        fontSize: '0.72rem', fontWeight: d.generationMode === m.value ? 700 : 400,
                                        color: d.generationMode === m.value ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                                        transition: 'all 0.15s',
                                        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
                                        lineHeight: 1.2,
                                    }}
                                >
                                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>{m.icon} {m.label}</span>
                                    <span style={{ fontSize: '0.58rem', color: 'var(--color-text-tertiary)', fontWeight: 400 }}>{m.desc}</span>
                                </button>
                            ))}
                        </div>
                    </ConfigField>

                    {d.generationMode === 'ai' ? (
                        <ConfigField label="Tipo de Declaração" icon={<FileSignature size={10} />} stepNumber={4}>
                            {d.declarationTypesFromEdital.length === 0 ? (
                                d.selectedBiddingId ? (
                                    <input
                                        className="form-select"
                                        placeholder="Digite o tipo de declaração desejado..."
                                        value={d.declarationType}
                                        onChange={(e) => d.setDeclarationType(e.target.value)}
                                        style={{ fontSize: 'var(--text-sm)' }}
                                    />
                                ) : (
                                    <div style={{
                                        padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-md)',
                                        background: 'var(--color-bg-body)',
                                        border: '1px solid var(--color-border)', fontSize: 'var(--text-sm)',
                                        color: 'var(--color-text-tertiary)',
                                    }}>
                                        Selecione uma licitação acima.
                                    </div>
                                )
                            ) : (
                                <>
                                    <select className="form-select" value={d.declarationType} onChange={(e) => {
                                        if (e.target.value === '__custom__') d.setDeclarationType('');
                                        else d.setDeclarationType(e.target.value);
                                    }}>
                                        {d.declarationTypesFromEdital.map((t: string, i: number) => <option key={i} value={t}>{t}</option>)}
                                        <option value="__custom__">Outro tipo...</option>
                                    </select>
                                    {!d.declarationTypesFromEdital.includes(d.declarationType) && (
                                        <input
                                            className="form-select"
                                            placeholder="Descreva o tipo de declaração..."
                                            value={d.declarationType}
                                            onChange={(e) => d.setDeclarationType(e.target.value)}
                                            style={{ fontSize: 'var(--text-sm)', marginTop: 'var(--space-1)' }}
                                            autoFocus
                                        />
                                    )}
                                </>
                            )}
                        </ConfigField>
                    ) : (
                        <div style={{ marginBottom: 'var(--space-4)' }}>
                            <label style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 5,
                                fontSize: '0.68rem',
                                fontWeight: 700,
                                textTransform: 'uppercase',
                                letterSpacing: '0.07em',
                                color: 'var(--color-text-tertiary)',
                                marginBottom: 'var(--space-1)',
                            }}>
                                <span style={{
                                    width: 16, height: 16, borderRadius: '50%',
                                    background: 'var(--color-primary)', color: 'white',
                                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                    fontSize: '0.58rem', fontWeight: 800, letterSpacing: 0, flexShrink: 0,
                                    marginRight: 2
                                }}>4</span>
                                <FileSignature size={10} style={{ opacity: 0.7 }} />
                                Selecione os Modelos
                            </label>
                            <TemplateChecklist d={d} setManageTemplatesOpen={setManageTemplatesOpen} />
                        </div>
                    )}

                    {/* Style selector - hide in static mode */}
                    {d.generationMode !== 'static' && (
                        <DeclarationStyleSelector
                            style={d.declarationStyle}
                            setStyle={d.setDeclarationStyle}
                        />
                    )}

                    {/* Instruções adicionais - hide in static mode */}
                    {d.generationMode !== 'static' && (
                        <OptionalInstructions value={d.customPrompt} onChange={d.setCustomPrompt} />
                    )}

                    {/* Generate CTA */}
                    <button
                        className="btn btn-primary"
                        style={{
                            width: '100%', height: '52px', gap: 'var(--space-2)', marginTop: 'var(--space-2)',
                            background: 'linear-gradient(135deg, var(--color-ai), var(--color-primary))',
                            border: 'none', borderRadius: 'var(--radius-xl)',
                            boxShadow: d.selectedBiddingId && d.selectedCompanyId && (d.generationMode === 'ai' ? d.declarationType : d.selectedTemplateIds.length > 0) ? '0 6px 24px rgba(139,92,246,0.30)' : undefined,
                            fontSize: 'var(--text-md)', fontWeight: 800, letterSpacing: '-0.01em',
                            opacity: (!d.selectedBiddingId || !d.selectedCompanyId || (d.generationMode === 'ai' ? !d.declarationType : d.selectedTemplateIds.length === 0)) ? 0.5 : 1,
                            transition: 'all 0.2s',
                        }}
                        onClick={d.handleGenerate}
                        disabled={d.isGenerating || !d.selectedBiddingId || !d.selectedCompanyId || (d.generationMode === 'ai' ? !d.declarationType : d.selectedTemplateIds.length === 0)}
                    >
                        {d.isGenerating ? <Loader2 size={20} className="spin" /> : (d.generationMode === 'static' ? <FileText size={20} /> : <Sparkles size={20} />)}
                        {d.isGenerating ? (d.generationMode === 'static' ? 'Mesclando dados...' : 'Gerando declaração...') : (d.generationMode === 'static' ? 'Preencher Declaração' : 'Gerar Declaração')}
                    </button>
                </div>
            </div>

            {/* COLUMN 2: Layout & Assinatura (expanded by default) */}
            <LayoutSettingsPanel key="step1-layout" d={d} initiallyCollapsed={false} />

            {/* COLUMN 3: Info / Certame panel */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
                {d.selectedBiddingId ? (
                    <EditalRequirementsMatchPanel d={d} biddings={biddings} />
                ) : (
                    <>
                        {/* Feature cards */}
                        <div style={{
                            display: 'flex', flexDirection: 'column', gap: 'var(--space-4)',
                            padding: 'var(--space-8) var(--space-6)',
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
                                <div style={{
                                    width: 48, height: 48, borderRadius: 'var(--radius-xl)',
                                    background: 'linear-gradient(135deg, rgba(139,92,246,0.12), rgba(37,99,235,0.08))',
                                    border: '1px solid rgba(139,92,246,0.2)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                }}>
                                    <FileText size={22} color="var(--color-ai)" strokeWidth={1.6} />
                                </div>
                                <div>
                                    <div style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--color-ai)', marginBottom: 2 }}>Estúdio Documental</div>
                                    <div style={{ fontSize: 'var(--text-lg)', fontWeight: 800, color: 'var(--color-text-primary)', lineHeight: 1.1, letterSpacing: '-0.02em' }}>Gerador de Declarações</div>
                                </div>
                            </div>

                            <p style={{ margin: 0, fontSize: 'var(--text-md)', color: 'var(--color-text-secondary)', lineHeight: 1.7, maxWidth: 360 }}>
                                Selecione a <strong>licitação</strong> e o <strong>tipo</strong>, e a IA ou o sistema irá preencher e gerar a declaração formal.
                            </p>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', marginTop: 'var(--space-2)' }}>
                                {[
                                    { icon: 'sparkles', title: 'Frentes Flexíveis', desc: 'Geração 100% IA, via modelo estático ou modo misto combinado' },
                                    { icon: 'scale', title: 'Rigor Jurídico', desc: 'Linguagem formal aderente à Lei 14.133/2021' },
                                    { icon: 'penline', title: 'Editável', desc: 'Revise e ajuste o texto diretamente no modelo antes de exportar' },
                                    { icon: 'filedown', title: 'PDF Pronto', desc: 'Exporta como PDF com cabeçalho e assinatura' },
                                ].map((f, i) => (
                                    <div key={i} style={{
                                        display: 'flex',
                                        alignItems: 'flex-start',
                                        gap: 'var(--space-3)',
                                        padding: 'var(--space-3) var(--space-4)',
                                        borderRadius: 'var(--radius-lg)',
                                        background: 'var(--color-bg-surface)',
                                        border: '1px solid var(--color-border)',
                                    }}>
                                        <span style={{ flexShrink: 0, width: 28, height: 28, borderRadius: 'var(--radius-md)', background: 'rgba(139,92,246,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            {f.icon === 'sparkles' && <Sparkles size={14} color="var(--color-ai)" />}
                                            {f.icon === 'scale' && <Scale size={14} color="var(--color-ai)" />}
                                            {f.icon === 'penline' && <PenLine size={14} color="var(--color-ai)" />}
                                            {f.icon === 'filedown' && <FileDown size={14} color="var(--color-ai)" />}
                                        </span>
                                        <div>
                                            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 1 }}>{f.title}</div>
                                            <div style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)', lineHeight: 1.4 }}>{f.desc}</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Ghost document outline */}
                        <div style={{ padding: 'var(--space-6)', background: 'var(--color-bg-body)', borderRadius: 'var(--radius-xl)', border: 'none', boxShadow: '0 0 0 1px var(--color-border)' }}>
                            <div style={{ opacity: 0.18, display: 'flex', flexDirection: 'column', gap: 8 }}>
                                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 3 }}>
                                    <div style={{ width: 50, height: 14, borderRadius: 3, background: 'var(--color-text-tertiary)' }} />
                                </div>
                                <div style={{ borderBottom: '1px solid var(--color-border)', paddingBottom: 6, marginBottom: 6, display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'center' }}>
                                    <div style={{ height: 6, width: '65%', borderRadius: 3, background: 'var(--color-text-tertiary)' }} />
                                    <div style={{ height: 6, width: '45%', borderRadius: 3, background: 'var(--color-text-tertiary)' }} />
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginBottom: 6 }}>
                                    <div style={{ height: 6, width: '40%', borderRadius: 3, background: 'var(--color-text-tertiary)' }} />
                                    <div style={{ height: 6, width: '55%', borderRadius: 3, background: 'var(--color-text-tertiary)' }} />
                                </div>
                                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
                                    <div style={{ height: 8, width: '50%', borderRadius: 3, background: 'var(--color-ai)', opacity: 0.5 }} />
                                </div>
                                {[95, 85, 90, 70, 88, 75, 55].map((w, i) => (
                                    <div key={i} style={{ height: 6, width: `${w}%`, borderRadius: 3, background: 'var(--color-text-tertiary)' }} />
                                ))}
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, marginTop: 18 }}>
                                    <div style={{ height: 1, width: '45%', background: 'var(--color-text-tertiary)' }} />
                                    <div style={{ height: 6, width: '35%', borderRadius: 3, background: 'var(--color-text-tertiary)' }} />
                                    <div style={{ height: 5, width: '30%', borderRadius: 3, background: 'var(--color-text-tertiary)' }} />
                                </div>
                            </div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════════

function ConfigField({ label, icon, children, stepNumber }: { label: string; icon?: React.ReactNode; children: React.ReactNode; stepNumber?: number }) {
    return (
        <div style={{ marginBottom: 'var(--space-4)' }}>
            <label style={{
                display: 'flex', alignItems: 'center', gap: 5,
                fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '0.07em', color: 'var(--color-text-tertiary)',
                marginBottom: 'var(--space-1)',
            }}>
                {stepNumber && (
                    <span style={{
                        width: 16, height: 16, borderRadius: '50%',
                        background: 'var(--color-primary)', color: 'white',
                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '0.58rem', fontWeight: 800, letterSpacing: 0, flexShrink: 0,
                    }}>{stepNumber}</span>
                )}
                {icon && !stepNumber && <span style={{ opacity: 0.7 }}>{icon}</span>}
                {label}
            </label>
            {children}
        </div>
    );
}

const STYLE_OPTIONS: { value: 'objetiva' | 'formal' | 'robusta'; label: string; desc: string; Icon: typeof PenLine }[] = [
    { value: 'objetiva', label: 'Objetiva', desc: 'Direta, sem prolixidade', Icon: PenLine },
    { value: 'formal', label: 'Formal', desc: 'Completa e moderada', Icon: Scale },
    { value: 'robusta', label: 'Robusta', desc: 'Detalhada e extensa', Icon: FileText },
];

function DeclarationStyleSelector({ style, setStyle }: {
    style: 'objetiva' | 'formal' | 'robusta';
    setStyle: (v: 'objetiva' | 'formal' | 'robusta') => void;
}) {
    return (
        <div style={{ marginBottom: 'var(--space-4)' }}>
            <label style={{
                display: 'flex', alignItems: 'center', gap: 5,
                fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '0.07em', color: 'var(--color-text-tertiary)',
                marginBottom: 'var(--space-1)',
            }}>
                Estilo de Redação
            </label>
            <div style={{ display: 'flex', gap: 'var(--space-1)' }}>
                {STYLE_OPTIONS.map(opt => (
                    <button
                        key={opt.value}
                        type="button"
                        title={opt.desc}
                        onClick={() => setStyle(opt.value)}
                        style={{
                            flex: 1, padding: '6px 8px',
                            borderRadius: 'var(--radius-md)',
                            border: 'none', boxShadow: style === opt.value ? '0 0 0 2px var(--color-primary), 0 4px 12px rgba(0,0,0,0.05)' : '0 0 0 1px var(--color-border)',
                            background: style === opt.value ? 'var(--color-primary-light)' : 'var(--color-bg-body)',
                            cursor: 'pointer',
                            fontSize: '0.72rem', fontWeight: style === opt.value ? 700 : 400,
                            color: style === opt.value ? 'var(--color-primary)' : 'var(--color-text-secondary)',
                            transition: 'all 0.15s',
                            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1,
                            lineHeight: 1.2,
                        }}
                    >
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><opt.Icon size={13} /> {opt.label}</span>
                        <span style={{ fontSize: '0.58rem', color: 'var(--color-text-tertiary)', fontWeight: 400 }}>{opt.desc}</span>
                    </button>
                ))}
            </div>
        </div>
    );
}

function OptionalInstructions({ value, onChange }: { value: string; onChange: (v: string) => void }) {
    const [open, setOpen] = useState(false);
    return (
        <div style={{ marginBottom: 'var(--space-3)' }}>
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                style={{
                    background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                    display: 'flex', alignItems: 'center', gap: 5,
                    fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase',
                    letterSpacing: '0.07em', color: open ? 'var(--color-primary)' : 'var(--color-text-tertiary)',
                }}
            >
                {open ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                Instruções Adicionais {value ? '·' : '(opcional)'}
            </button>
            {open && (
                <textarea
                    className="form-select"
                    style={{ minHeight: '64px', resize: 'vertical', marginTop: 'var(--space-1)', fontSize: 'var(--text-sm)' }}
                    placeholder="Contexto extra para a IA (variantes, referências legais específicas…)"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                />
            )}
        </div>
    );
}

function ImageUploadSection({ label, image, width, height, onUpload, onRemove, onWidthChange, onHeightChange }: {
    label: string; image: string | null; width: number; height: number;
    onUpload: (f: File) => void; onRemove: () => void; onWidthChange: (w: number) => void; onHeightChange: (h: number) => void;
}) {
    return (
        <div style={{ marginBottom: 'var(--space-3)' }}>
            <label className="decl-small-label">{label}</label>
            {image ? (
                <div style={{ border: '1px dashed var(--color-border)', borderRadius: 6, padding: 8, backgroundColor: 'var(--color-bg-body)' }}>
                    <div style={{ textAlign: 'center', marginBottom: 6, background: 'white', padding: 6, borderRadius: 4 }}>
                        <img src={image} alt={label} style={{ maxWidth: `${width * 3}px`, maxHeight: `${height * 3}px`, objectFit: 'contain', display: 'block', margin: '0 auto' }} />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 6, alignItems: 'end' }}>
                        <div><label className="decl-small-label" style={{ marginBottom: 2 }}>Largura (mm)</label><input type="number" className="decl-small-input" value={width} onChange={(e) => onWidthChange(parseInt(e.target.value) || 10)} min={5} max={180} /></div>
                        <div><label className="decl-small-label" style={{ marginBottom: 2 }}>Altura (mm)</label><input type="number" className="decl-small-input" value={height} onChange={(e) => onHeightChange(parseInt(e.target.value) || 5)} min={5} max={80} /></div>
                        <button className="icon-btn" onClick={onRemove} title="Remover" style={{ padding: 4, color: 'var(--color-danger)' }}><X size={14} /></button>
                    </div>
                </div>
            ) : (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', border: '1px dashed var(--color-border)', borderRadius: 6, cursor: 'pointer', fontSize: '0.73rem', color: 'var(--color-text-tertiary)', backgroundColor: 'var(--color-bg-body)' }}>
                    <Image size={13} /> Anexar imagem
                    <input type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); }} style={{ display: 'none' }} />
                </label>
            )}
        </div>
    );
}

function IssuerTypeSelector({ issuerType, setIssuerType, selectedCompanyId, companies }: {
    issuerType: 'company' | 'technical'; setIssuerType: (v: 'company' | 'technical') => void;
    selectedCompanyId: string; companies: CompanyProfile[];
}) {
    const hasTechQual = selectedCompanyId && companies.find(c => c.id === selectedCompanyId)?.technicalQualification;
    if (!hasTechQual && issuerType === 'company') return null; // Hide if no RT and already on company
    return (
        <LayoutSection label="Emitente da Declaração">
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <label style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-md)', cursor: 'pointer', border: 'none', boxShadow: issuerType === 'company' ? '0 0 0 2px var(--color-primary), 0 4px 12px rgba(0,0,0,0.05)' : '0 0 0 1px var(--color-border)', background: issuerType === 'company' ? 'var(--color-primary-light)' : 'var(--color-bg-body)', fontSize: 'var(--text-sm)', fontWeight: issuerType === 'company' ? 600 : 400, transition: 'all 0.15s' }}>
                    <input type="radio" name="issuerType" checked={issuerType === 'company'} onChange={() => setIssuerType('company')} style={{ accentColor: 'var(--color-primary)', width: 13, height: 13 }} />
                    Empresa (Rep. Legal)
                </label>
                <label style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-md)', cursor: hasTechQual ? 'pointer' : 'not-allowed', border: 'none', boxShadow: issuerType === 'technical' ? '0 0 0 2px var(--color-primary), 0 4px 12px rgba(0,0,0,0.05)' : '0 0 0 1px var(--color-border)', background: issuerType === 'technical' ? 'var(--color-primary-light)' : 'var(--color-bg-body)', fontSize: 'var(--text-sm)', fontWeight: issuerType === 'technical' ? 600 : 400, opacity: hasTechQual ? 1 : 0.4, transition: 'all 0.15s' }}>
                    <input type="radio" name="issuerType" checked={issuerType === 'technical'} onChange={() => setIssuerType('technical')} disabled={!hasTechQual} style={{ accentColor: 'var(--color-primary)', width: 13, height: 13 }} />
                    Profissional Técnico
                </label>
            </div>
            {issuerType === 'technical' && !hasTechQual && (
                <p style={{ color: 'var(--color-danger)', fontSize: '0.72rem', marginTop: 4, marginBottom: 0 }}>Cadastre a qualificação técnica na aba Documentos → editar empresa.</p>
            )}
        </LayoutSection>
    );
}

function LayoutSettingsPanel({ d, initiallyCollapsed = true }: { d: ReturnType<typeof useAiDeclaration>; initiallyCollapsed?: boolean }) {
    const [collapsed, setCollapsed] = useState(initiallyCollapsed);

    return (
        <div style={{
            borderRadius: 'var(--radius-xl)',
            border: 'none',
            boxShadow: '0 0 0 1px var(--color-border)',
            overflow: 'hidden',
            background: 'var(--color-bg-surface)',
        }}>
            {/* Panel header — always visible */}
            <div
                style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: 'var(--space-3) var(--space-4)',
                    background: collapsed ? 'var(--color-bg-surface)' : 'linear-gradient(135deg, rgba(37,99,235,0.04), rgba(99,102,241,0.02))',
                    borderBottom: collapsed ? 'none' : '1px solid var(--color-border)',
                    cursor: 'pointer',
                }}
                onClick={() => setCollapsed(c => !c)}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <div style={{ width: 24, height: 24, borderRadius: 'var(--radius-sm)', background: 'rgba(37,99,235,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Settings2 size={13} color="var(--color-primary)" />
                    </div>
                    <div>
                        <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--color-text-primary)', lineHeight: 1.1 }}>Layout &amp; Assinatura</div>
                        {collapsed && <div style={{ fontSize: '0.62rem', color: 'var(--color-text-tertiary)' }}>Cabeçalho, rodapé e signatário</div>}
                    </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    {!collapsed && (
                        <>
                            <button className="btn btn-outline" style={{ fontSize: '0.68rem', padding: '2px 8px', gap: 3 }} onClick={(e) => { e.stopPropagation(); d.handleSaveLayout(); }}>
                                {d.layoutSaved ? <CheckCircle2 size={10} color="var(--color-success)" /> : <Save size={10} />}
                                {d.layoutSaved ? 'Salvo!' : 'Salvar'}
                            </button>
                            <button className="btn btn-outline" style={{ fontSize: '0.68rem', padding: '2px 8px', gap: 3 }} onClick={(e) => { e.stopPropagation(); d.handleCreateLayout(); }}>
                                <Plus size={10} /> Novo
                            </button>
                        </>
                    )}
                    {collapsed ? <ChevronDown size={14} color="var(--color-text-tertiary)" /> : <ChevronUp size={14} color="var(--color-text-tertiary)" />}
                </div>
            </div>

            {!collapsed && (
                <div style={{ padding: 'var(--space-3) var(--space-4)' }}>
                    {/* Layout selector */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 'var(--space-2)', marginBottom: 'var(--space-3)', alignItems: 'center' }}>
                        <select className="form-select" style={{ fontSize: '0.78rem' }} value={d.currentLayoutId} onChange={(e) => d.handleSwitchLayout(e.target.value)}>
                            {d.layouts.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                        </select>
                        <button className="icon-btn" style={{ color: 'var(--color-danger)', opacity: d.layouts.length > 1 ? 1 : 0.3 }} onClick={d.handleDeleteLayout} disabled={d.layouts.length <= 1}>
                            <Trash2 size={13} />
                        </button>
                    </div>

                    <div style={{ marginBottom: 'var(--space-3)' }}>
                        <label className="decl-small-label">Nome do Layout</label>
                        <input className="decl-small-input" value={d.layoutName} onChange={(e) => d.handleUpdateLayoutName(e.target.value)} placeholder="Ex: Layout Empresa A" />
                    </div>

                    {/* Local / Data — inline */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
                        <div>
                            <label className="decl-small-label">Local</label>
                            <input className="decl-small-input" value={d.layout.signatureCity} onChange={(e) => d.updateLayout({ signatureCity: e.target.value })} />
                        </div>
                        <div>
                            <label className="decl-small-label">Data</label>
                            <input className="decl-small-input" value={d.layout.signatureDate} onChange={(e) => d.updateLayout({ signatureDate: e.target.value })} />
                        </div>
                    </div>

                    {/* Signatário */}
                    <LayoutSection label="Bloco de Assinatura">
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.72rem', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 8, cursor: 'pointer' }}>
                            <input
                                type="checkbox"
                                checked={d.layout.doubleSignature || false}
                                onChange={(e) => d.updateLayout({ doubleSignature: e.target.checked })}
                                style={{ accentColor: 'var(--color-primary)' }}
                            />
                            Habilitar Assinatura Dupla (RT)
                        </label>

                        <div style={{ fontSize: '0.62rem', fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', marginBottom: 4 }}>
                            {d.layout.doubleSignature ? 'Assinatura 1 (Legal)' : 'Assinatura'}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 12 }}>
                            <div><label className="decl-small-label">Nome</label><input className="decl-small-input" placeholder="NOME COMPLETO" value={d.layout.signatoryName} onChange={(e) => d.updateLayout({ signatoryName: e.target.value })} /></div>
                            <div><label className="decl-small-label">CPF</label><input className="decl-small-input" placeholder="000.000.000-00" value={d.layout.signatoryCpf} onChange={(e) => d.updateLayout({ signatoryCpf: e.target.value })} /></div>
                            <div><label className="decl-small-label">Cargo</label><input className="decl-small-input" placeholder="Sócio Administrador" value={d.layout.signatoryRole} onChange={(e) => d.updateLayout({ signatoryRole: e.target.value })} /></div>
                            <div><label className="decl-small-label">Empresa</label><input className="decl-small-input" value={d.layout.signatoryCompany} onChange={(e) => d.updateLayout({ signatoryCompany: e.target.value })} /></div>
                        </div>
                        <div style={{ marginBottom: d.layout.doubleSignature ? 12 : 0 }}><label className="decl-small-label">CNPJ</label><input className="decl-small-input" value={d.layout.signatoryCnpj} onChange={(e) => d.updateLayout({ signatoryCnpj: e.target.value })} /></div>

                        {d.layout.doubleSignature && (
                            <>
                                <div style={{ fontSize: '0.62rem', fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', marginBottom: 4, borderTop: '1px solid var(--color-border)', paddingTop: 8 }}>
                                    Assinatura 2 (Resp. Técnico)
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                                    <div><label className="decl-small-label">Nome RT</label><input className="decl-small-input" placeholder="Nome do RT" value={d.layout.rtName} onChange={(e) => d.updateLayout({ rtName: e.target.value })} /></div>
                                    <div><label className="decl-small-label">CPF RT</label><input className="decl-small-input" placeholder="000.000.000-00" value={d.layout.rtCpf} onChange={(e) => d.updateLayout({ rtCpf: e.target.value })} /></div>
                                    <div><label className="decl-small-label">Cargo RT</label><input className="decl-small-input" placeholder="Responsável Técnico" value={d.layout.rtRole} onChange={(e) => d.updateLayout({ rtRole: e.target.value })} /></div>
                                    <div><label className="decl-small-label">Registro (CREA/CAU)</label><input className="decl-small-input" placeholder="CREA/SP 123456" value={d.layout.rtRegister} onChange={(e) => d.updateLayout({ rtRegister: e.target.value })} /></div>
                                </div>
                            </>
                        )}
                    </LayoutSection>

                    {/* Images */}
                    <LayoutSection label="Cabeçalho">
                        <ImageUploadSection label="Logotipo" image={d.layout.headerImage} width={d.layout.headerImageWidth} height={d.layout.headerImageHeight}
                            onUpload={(f) => d.handleImageUpload('headerImage', f)} onRemove={() => d.updateLayout({ headerImage: null })}
                            onWidthChange={(w) => d.updateLayout({ headerImageWidth: w })} onHeightChange={(h) => d.updateLayout({ headerImageHeight: h })} />
                        <div>
                            <label className="decl-small-label">Texto do Cabeçalho</label>
                            <textarea className="form-select" style={{ fontSize: '0.8rem', minHeight: '38px', resize: 'none' }} value={d.layout.headerText} onChange={(e) => d.updateLayout({ headerText: e.target.value })} placeholder="Razão Social / CNPJ" />
                        </div>
                    </LayoutSection>

                    <LayoutSection label="Rodapé">
                        <ImageUploadSection label="Logotipo" image={d.layout.footerImage} width={d.layout.footerImageWidth} height={d.layout.footerImageHeight}
                            onUpload={(f) => d.handleImageUpload('footerImage', f)} onRemove={() => d.updateLayout({ footerImage: null })}
                            onWidthChange={(w) => d.updateLayout({ footerImageWidth: w })} onHeightChange={(h) => d.updateLayout({ footerImageHeight: h })} />
                        <div>
                            <label className="decl-small-label">Texto do Rodapé</label>
                            <textarea className="form-select" style={{ fontSize: '0.8rem', minHeight: '38px', resize: 'none' }} value={d.layout.footerText} onChange={(e) => d.updateLayout({ footerText: e.target.value })} placeholder="Endereço / contato" />
                        </div>
                    </LayoutSection>
                </div>
            )}
        </div>
    );
}

function LayoutSection({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div style={{ marginBottom: 'var(--space-3)', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg-body)', border: 'none', boxShadow: '0 0 0 1px var(--color-border)' }}>
            <div style={{ fontSize: '0.6rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-2)' }}>
                {label}
            </div>
            {children}
        </div>
    );
}

function EditorToolbar({ d }: { d: ReturnType<typeof useAiDeclaration> }) {
    return (
        <div style={{
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            padding: 'var(--space-3) var(--space-5)',
            borderBottom: '1px solid var(--color-border)',
            background: 'linear-gradient(135deg, rgba(37,99,235,0.03), rgba(99,102,241,0.02))',
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <div style={{ width: 32, height: 32, borderRadius: 'var(--radius-lg)', background: 'linear-gradient(135deg, rgba(37,99,235,0.1), rgba(99,102,241,0.06))', border: '1px solid rgba(37,99,235,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <FileText size={15} color="var(--color-primary)" />
                </div>
                <div>
                    <div style={{ fontSize: 'var(--text-md)', fontWeight: 700, color: 'var(--color-text-primary)', lineHeight: 1.1 }}>Documento Gerado</div>
                    <div style={{ fontSize: '0.65rem', color: 'var(--color-text-tertiary)' }}>
                        {d.generatedText ? 'Clique no texto para editar diretamente' : 'Aguardando geração'}
                    </div>
                </div>
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                {d.saveSuccess && (
                    <span style={{ color: 'var(--color-success)', fontSize: 'var(--text-sm)', display: 'flex', alignItems: 'center', gap: 4, fontWeight: 600 }}>
                        <CheckCircle2 size={13} /> Salvo!
                    </span>
                )}
                <button className="btn btn-outline" onClick={d.handleAddToDocuments} disabled={!d.generatedText || d.isSaving}
                    style={{ fontSize: '0.75rem', padding: 'var(--space-2) var(--space-3)', display: 'flex', alignItems: 'center', gap: 4 }}>
                    {d.isSaving ? <Loader2 size={12} className="spin" /> : <Save size={12} />}
                    Vincular ao Dossiê
                </button>
                <button className="btn" onClick={d.handleExportPDF} disabled={!d.generatedText}
                    style={{
                        fontSize: '0.75rem', padding: 'var(--space-2) var(--space-3)',
                        background: 'linear-gradient(135deg, var(--color-success), rgba(21,128,61,0.9))',
                        color: 'white', boxShadow: d.generatedText ? '0 3px 10px rgba(34,197,94,0.25)' : undefined,
                        display: 'flex', alignItems: 'center', gap: 4,
                    }}>
                    <Download size={12} /> Baixar PDF
                </button>
            </div>
        </div>
    );
}

function DeclarationPreview({
    layout,
    declarationType,
    generatedText,
    setGeneratedText,
    updateLayout,
    setDeclarationType,
}: {
    layout: LayoutConfig;
    declarationType: string;
    generatedText: string;
    setGeneratedText: (v: string) => void;
    updateLayout: (patch: Partial<LayoutConfig>) => void;
    setDeclarationType: (v: string) => void;
}) {
    const handleFocus = (e: any) => {
        e.target.style.borderBottomColor = '#ccc';
    };
    const handleBlur = (e: any) => {
        e.target.style.borderBottomColor = 'transparent';
    };

    const inputStyle = (bold = false, fontSize = '0.75rem', align = 'center') => ({
        border: 'none',
        outline: 'none',
        background: 'transparent',
        fontWeight: bold ? 'bold' : ('normal' as any),
        fontSize,
        textAlign: align as any,
        width: '100%',
        padding: '2px 4px',
        color: '#333',
        fontFamily: 'inherit',
        borderBottom: '1px dashed transparent',
        transition: 'border-color 0.2s',
    });

    const inputProps = (bold = false, fontSize = '0.75rem', align = 'center') => ({
        style: inputStyle(bold, fontSize, align),
        onFocus: handleFocus,
        onBlur: handleBlur,
    });

    return (
        <div className="decl-page-mockup">
            {/* Header */}
            {layout.headerImage && (
                <div style={{ textAlign: 'center', marginBottom: 6 }}>
                    <img src={layout.headerImage} alt="Logo" style={{ maxWidth: `${layout.headerImageWidth * 2.5}px`, maxHeight: `${layout.headerImageHeight * 2.5}px`, objectFit: 'contain' }} />
                </div>
            )}
            {layout.headerText !== undefined && (
                <textarea
                    style={{
                        width: '100%',
                        textAlign: 'center',
                        border: 'none',
                        borderBottom: '1px solid #ccc',
                        outline: 'none',
                        paddingBottom: 8,
                        marginBottom: 16,
                        fontSize: '0.65rem',
                        color: '#666',
                        background: 'transparent',
                        resize: 'none',
                        fontFamily: 'inherit',
                        lineHeight: 1.3
                    }}
                    value={layout.headerText}
                    onChange={(e) => updateLayout({ headerText: e.target.value })}
                    rows={layout.headerText.split('\n').length || 2}
                />
            )}

            {/* Addressee */}
            <div style={{ fontSize: '0.75rem', color: '#444', marginBottom: 16, lineHeight: 1.5, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ color: '#666', fontWeight: 600 }}>Ao</span>
                    <input
                        style={{
                            border: 'none',
                            outline: 'none',
                            background: 'transparent',
                            color: '#444',
                            fontSize: '0.75rem',
                            fontFamily: 'inherit',
                            fontWeight: 500,
                            flex: 1,
                            padding: '2px 4px',
                            borderBottom: '1px dashed transparent',
                            transition: 'border-color 0.2s',
                        }}
                        onFocus={handleFocus}
                        onBlur={handleBlur}
                        value={layout.addresseeName}
                        onChange={(e) => updateLayout({ addresseeName: e.target.value })}
                        placeholder="Nome do Destinatário"
                    />
                </div>
                <textarea
                    style={{
                        border: 'none',
                        outline: 'none',
                        background: 'transparent',
                        color: '#444',
                        fontSize: '0.75rem',
                        fontFamily: 'inherit',
                        width: '100%',
                        resize: 'none',
                        padding: '2px 4px',
                        lineHeight: 1.4,
                        borderBottom: '1px dashed transparent',
                        transition: 'border-color 0.2s',
                    }}
                    onFocus={handleFocus}
                    onBlur={handleBlur}
                    value={layout.addresseeOrg}
                    onChange={(e) => updateLayout({ addresseeOrg: e.target.value })}
                    placeholder="Órgão Licitante (e.g. Prefeitura de...)"
                    rows={layout.addresseeOrg.split('\n').length || 2}
                />
            </div>

            {/* Title */}
            <textarea
                style={{
                    width: '100%',
                    textAlign: 'center',
                    fontWeight: 'bold',
                    border: 'none',
                    outline: 'none',
                    background: 'transparent',
                    marginBottom: 20,
                    fontSize: '0.95rem',
                    fontFamily: 'inherit',
                    textTransform: 'uppercase',
                    lineHeight: 1.3,
                    resize: 'none',
                    padding: '2px 4px',
                    borderBottom: '1px dashed transparent',
                    transition: 'border-color 0.2s',
                }}
                onFocus={handleFocus}
                onBlur={handleBlur}
                value={declarationType}
                onChange={(e) => setDeclarationType(e.target.value)}
                placeholder="TÍTULO DA DECLARAÇÃO"
                rows={declarationType.split('\n').length || 1}
            />

            {/* Body */}
            <textarea className="decl-editor-text" value={generatedText} onChange={(e) => setGeneratedText(e.target.value)} placeholder="Texto gerado aqui..." style={{ textAlign: 'justify' }} />

            {/* Location/Date */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 4, marginTop: 20, fontSize: '0.8rem', color: '#333' }}>
                <input
                    style={{
                        border: 'none',
                        outline: 'none',
                        background: 'transparent',
                        textAlign: 'right',
                        fontSize: '0.8rem',
                        fontFamily: 'inherit',
                        color: '#333',
                        width: '200px',
                        padding: '2px 4px',
                        borderBottom: '1px dashed transparent',
                        transition: 'border-color 0.2s',
                    }}
                    onFocus={handleFocus}
                    onBlur={handleBlur}
                    value={layout.signatureCity}
                    onChange={(e) => updateLayout({ signatureCity: e.target.value })}
                    placeholder="Cidade"
                />
                <span>,</span>
                <input
                    style={{
                        border: 'none',
                        outline: 'none',
                        background: 'transparent',
                        textAlign: 'left',
                        fontSize: '0.8rem',
                        fontFamily: 'inherit',
                        color: '#333',
                        width: '200px',
                        padding: '2px 4px',
                        borderBottom: '1px dashed transparent',
                        transition: 'border-color 0.2s',
                    }}
                    onFocus={handleFocus}
                    onBlur={handleBlur}
                    value={layout.signatureDate}
                    onChange={(e) => updateLayout({ signatureDate: e.target.value })}
                    placeholder="Data"
                />
            </div>

            {/* Signature block */}
            {layout.doubleSignature ? (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginTop: 30, textAlign: 'center' }}>
                    {/* Left block (Legal representative) */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <div style={{ color: '#333', marginBottom: 3, fontSize: '0.8rem' }}>__________________________________________</div>
                        <input
                            {...inputProps(true, '0.78rem')}
                            value={layout.signatoryName}
                            onChange={(e) => updateLayout({ signatoryName: e.target.value })}
                            placeholder="Representante Legal"
                        />
                        <input
                            {...inputProps(false, '0.7rem')}
                            value={layout.signatoryCpf}
                            onChange={(e) => updateLayout({ signatoryCpf: e.target.value })}
                            placeholder="CPF"
                        />
                        <input
                            {...inputProps(false, '0.7rem')}
                            value={layout.signatoryRole}
                            onChange={(e) => updateLayout({ signatoryRole: e.target.value })}
                            placeholder="Cargo"
                        />
                        <input
                            {...inputProps(true, '0.75rem')}
                            value={layout.signatoryCompany}
                            onChange={(e) => updateLayout({ signatoryCompany: e.target.value })}
                            placeholder="Empresa"
                        />
                        <input
                            {...inputProps(false, '0.7rem')}
                            value={layout.signatoryCnpj}
                            onChange={(e) => updateLayout({ signatoryCnpj: e.target.value })}
                            placeholder="CNPJ"
                        />
                    </div>
                    {/* Right block (Technical representative / RT) */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <div style={{ color: '#333', marginBottom: 3, fontSize: '0.8rem' }}>__________________________________________</div>
                        <input
                            {...inputProps(true, '0.78rem')}
                            value={layout.rtName}
                            onChange={(e) => updateLayout({ rtName: e.target.value })}
                            placeholder="Responsável Técnico"
                        />
                        <input
                            {...inputProps(false, '0.7rem')}
                            value={layout.rtCpf}
                            onChange={(e) => updateLayout({ rtCpf: e.target.value })}
                            placeholder="CPF do RT"
                        />
                        <input
                            {...inputProps(false, '0.7rem')}
                            value={layout.rtRole}
                            onChange={(e) => updateLayout({ rtRole: e.target.value })}
                            placeholder="Título do RT"
                        />
                        <input
                            {...inputProps(false, '0.7rem')}
                            value={layout.rtRegister}
                            onChange={(e) => updateLayout({ rtRegister: e.target.value })}
                            placeholder="Registro (CREA/CAU)"
                        />
                        <input
                            {...inputProps(true, '0.75rem')}
                            value={layout.signatoryCompany}
                            onChange={(e) => updateLayout({ signatoryCompany: e.target.value })}
                            placeholder="Empresa"
                        />
                    </div>
                </div>
            ) : (
                <div style={{ textAlign: 'center', marginTop: 30, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <div style={{ color: '#333', marginBottom: 3, fontSize: '0.8rem' }}>__________________________________________</div>
                    <input
                        {...inputProps(true, '0.78rem')}
                        value={layout.signatoryName}
                        onChange={(e) => updateLayout({ signatoryName: e.target.value })}
                        placeholder="Representante Legal"
                    />
                    <input
                        {...inputProps(false, '0.7rem')}
                        value={layout.signatoryCpf}
                        onChange={(e) => updateLayout({ signatoryCpf: e.target.value })}
                        placeholder="CPF"
                    />
                    <input
                        {...inputProps(false, '0.7rem')}
                        value={layout.signatoryRole}
                        onChange={(e) => updateLayout({ signatoryRole: e.target.value })}
                        placeholder="Cargo"
                    />
                    <input
                        {...inputProps(true, '0.75rem')}
                        value={layout.signatoryCompany}
                        onChange={(e) => updateLayout({ signatoryCompany: e.target.value })}
                        placeholder="Empresa"
                    />
                    <input
                        {...inputProps(false, '0.7rem')}
                        value={layout.signatoryCnpj}
                        onChange={(e) => updateLayout({ signatoryCnpj: e.target.value })}
                        placeholder="CNPJ"
                    />
                </div>
            )}

            {/* Footer */}
            <div style={{ marginTop: 'auto', paddingTop: 20 }}>
                {layout.footerImage && (
                    <div style={{ textAlign: 'center', marginBottom: 4 }}>
                        <img src={layout.footerImage} alt="Rodapé" style={{ maxWidth: `${layout.footerImageWidth * 2.5}px`, maxHeight: `${layout.footerImageHeight * 2.5}px`, objectFit: 'contain' }} />
                    </div>
                )}
                {layout.footerText !== undefined && (
                    <textarea
                        style={{
                            width: '100%',
                            textAlign: 'center',
                            border: 'none',
                            borderTop: '1px solid #ccc',
                            outline: 'none',
                            paddingTop: 6,
                            fontSize: '0.6rem',
                            color: '#999',
                            background: 'transparent',
                            resize: 'none',
                            fontFamily: 'inherit',
                            lineHeight: 1.4
                        }}
                        value={layout.footerText}
                        onChange={(e) => updateLayout({ footerText: e.target.value })}
                        placeholder="Endereço / Contatos"
                        rows={layout.footerText.split('\n').length || 2}
                    />
                )}
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════
// Quality Badge Bar + Details Panel
// ═══════════════════════════════════════════════

const GRADE_CONFIG = {
    A: { bg: 'rgba(34,197,94,0.06)', pill: 'var(--color-success)', label: 'Excelente' },
    B: { bg: 'rgba(245,158,11,0.06)', pill: 'var(--color-warning)', label: 'Boa' },
    C: { bg: 'rgba(245,158,11,0.08)', pill: '#d97706', label: 'Regular' },
    D: { bg: 'rgba(239,68,68,0.06)', pill: 'var(--color-danger)', label: 'Insuficiente' },
} as const;

function QualityChip({ ok, labelOk, labelFail, icon }: { ok: boolean; labelOk: string; labelFail: string; icon?: React.ReactNode }) {
    return (
        <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 3,
            padding: '2px 8px', borderRadius: 'var(--radius-full)',
            fontSize: '0.62rem', fontWeight: 600, letterSpacing: '0.02em',
            background: ok ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
            color: ok ? 'var(--color-success)' : 'var(--color-danger)',
            whiteSpace: 'nowrap',
        }}>
            {icon || (ok ? '✓' : '✗')} {ok ? labelOk : labelFail}
        </span>
    );
}

function QualityBadgeBar({ report }: { report: QualityReportFrontend }) {
    const [showDetails, setShowDetails] = useState(false);
    const grade = report.grade as keyof typeof GRADE_CONFIG;
    const config = GRADE_CONFIG[grade] || GRADE_CONFIG.D;

    return (
        <div style={{ borderBottom: '1px solid var(--color-border)' }}>
            {/* Main bar */}
            <div style={{
                display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                padding: 'var(--space-2) var(--space-4)',
                background: config.bg,
                fontSize: '0.75rem',
                flexWrap: 'wrap',
            }}>
                {/* Grade pill */}
                <span style={{
                    padding: '2px 10px', borderRadius: 'var(--radius-full)', fontWeight: 800,
                    fontSize: '0.7rem', letterSpacing: '0.05em',
                    background: config.pill, color: 'white',
                    minWidth: 52, textAlign: 'center',
                }}>
                    {report.grade} {report.score}%
                </span>

                {/* Boolean chips */}
                <QualityChip ok={report.factualConsistency} labelOk="Fidelidade" labelFail="Dados divergentes" />
                <QualityChip ok={report.declarationTypeMatch} labelOk="Tipo" labelFail="Tipo divergente" />
                <QualityChip ok={report.structureAdequate} labelOk="Estrutura" labelFail="Estrutura fraca" />
                <QualityChip ok={!report.contaminationDetected} labelOk="Limpo" labelFail="Contaminada" icon={report.contaminationDetected ? <AlertTriangle size={9} /> : <Shield size={9} />} />

                {/* Auto-corrected badge */}
                {report.corrected && (
                    <span style={{
                        padding: '2px 8px', borderRadius: 'var(--radius-full)',
                        background: 'rgba(139,92,246,0.12)', color: 'var(--color-ai)',
                        fontSize: '0.62rem', fontWeight: 700,
                    }}>
                        <Zap size={10} /> Auto-corrigido ({report.corrections.length})
                    </span>
                )}

                {/* Spacer + family + details toggle */}
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <span style={{ color: 'var(--color-text-tertiary)', fontSize: '0.6rem', fontStyle: 'italic' }}>
                        {report.family.replace(/_/g, ' ')}
                    </span>
                    {report.issues.length > 0 && (
                        <button
                            type="button"
                            onClick={() => setShowDetails(d => !d)}
                            style={{
                                background: 'none', border: 'none', cursor: 'pointer',
                                display: 'flex', alignItems: 'center', gap: 2,
                                fontSize: '0.62rem', fontWeight: 600, color: 'var(--color-primary)',
                                padding: '1px 4px', borderRadius: 'var(--radius-sm)',
                            }}
                        >
                            {showDetails ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                            {report.issues.length} {report.issues.length === 1 ? 'ponto' : 'pontos'}
                        </button>
                    )}
                </div>
            </div>

            {/* Expandable details */}
            {showDetails && <QualityDetailsPanel report={report} />}
        </div>
    );
}

function QualityDetailsPanel({ report }: { report: QualityReportFrontend }) {
    const critical = report.issues.filter(i => i.severity === 'critical');
    const major = report.issues.filter(i => i.severity === 'major');
    const minor = report.issues.filter(i => i.severity === 'minor');

    const SeverityGroup = ({ label, icon, issues, color }: { label: string; icon: React.ReactNode; issues: typeof report.issues; color: string }) => {
        if (issues.length === 0) return null;
        return (
            <div style={{ marginBottom: 'var(--space-2)' }}>
                <div style={{ fontSize: '0.62rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color, marginBottom: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span>{icon}</span> {label} ({issues.length})
                </div>
                {issues.map((issue, i) => (
                    <div key={i} style={{
                        display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)',
                        padding: '3px 0', fontSize: '0.7rem', color: 'var(--color-text-secondary)',
                        lineHeight: 1.35,
                    }}>
                        <ChevronRight size={9} style={{ flexShrink: 0, marginTop: 2, color }} />
                        <span><code style={{ fontSize: '0.6rem', padding: '0 3px', borderRadius: 2, background: 'rgba(0,0,0,0.04)', color: 'var(--color-text-tertiary)' }}>{issue.code}</code> {issue.message}</span>
                    </div>
                ))}
            </div>
        );
    };

    return (
        <div style={{
            padding: 'var(--space-3) var(--space-4)',
            background: 'var(--color-bg-body)',
            borderTop: '1px solid var(--color-border)',
            maxHeight: 200, overflowY: 'auto',
        }}>
            <SeverityGroup label="Crítico" icon={<Ban size={10} />} issues={critical} color="var(--color-danger)" />
            <SeverityGroup label="Importante" icon={<AlertTriangle size={10} />} issues={major} color="#d97706" />
            <SeverityGroup label="Informativo" icon={<Info size={10} />} issues={minor} color="var(--color-text-tertiary)" />

            {report.corrections.length > 0 && (
                <div style={{ marginTop: 'var(--space-2)', paddingTop: 'var(--space-2)', borderTop: '1px solid var(--color-border)' }}>
                    <div style={{ fontSize: '0.62rem', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-success)', marginBottom: 3, display: 'flex', alignItems: 'center', gap: 4 }}>
                        <CheckCircle2 size={10} /> Correções Aplicadas ({report.corrections.length})
                    </div>
                    {report.corrections.map((c, i) => (
                        <div key={i} style={{ fontSize: '0.68rem', color: 'var(--color-success)', padding: '2px 0', display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)' }}>
                            <span style={{ flexShrink: 0 }}>✓</span>
                            <span style={{ color: 'var(--color-text-secondary)' }}>{c}</span>
                        </div>
                    ))}
                </div>
            )}

            {report.issues.length === 0 && report.corrections.length === 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: '0.72rem', color: 'var(--color-success)', fontWeight: 600 }}>
                    <Shield size={13} /> Nenhuma inconsistência detectada.
                </div>
            )}

            {/* Meta info */}
            <div style={{ display: 'flex', gap: 'var(--space-3)', marginTop: 'var(--space-2)', fontSize: '0.6rem', color: 'var(--color-text-tertiary)' }}>
                <span>Tentativas: {report.attempts}</span>
                <span>•</span>
                <span>Score: {report.score}/100</span>
                <span>•</span>
                <span>Grade: {report.grade}</span>
            </div>
        </div>
    );
}

/* ═══════════════════════════════════════════════
   Template Management Modal & Custom Forms
   ═══════════════════════════════════════════════ */

interface TemplateManagementModalProps {
    open: boolean;
    onClose: () => void;
    d: ReturnType<typeof useAiDeclaration>;
}

function TemplateManagementModal({ open, onClose, d }: TemplateManagementModalProps) {
    const [editingTemplate, setEditingTemplate] = useState<DeclarationTemplate | null>(null);
    const [title, setTitle] = useState('');
    const [content, setContent] = useState('');
    const [isFormOpen, setIsFormOpen] = useState(false);

    if (!open) return null;

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!title.trim() || !content.trim()) return;

        if (editingTemplate) {
            await d.handleUpdateTemplate(editingTemplate.id, title, content);
        } else {
            await d.handleCreateTemplate(title, content);
        }
        
        // Reset form
        setTitle('');
        setContent('');
        setEditingTemplate(null);
        setIsFormOpen(false);
    };

    const handleEditClick = (template: DeclarationTemplate) => {
        setEditingTemplate(template);
        setTitle(template.title);
        setContent(template.content);
        setIsFormOpen(true);
    };

    const handleNewClick = () => {
        setEditingTemplate(null);
        setTitle('');
        setContent('');
        setIsFormOpen(true);
    };

    const handleCancel = () => {
        setEditingTemplate(null);
        setTitle('');
        setContent('');
        setIsFormOpen(false);
    };

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 9999, padding: 'var(--space-4)'
        }}>
            <div style={{
                background: 'var(--color-bg-surface)',
                borderRadius: 'var(--radius-xl)',
                boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
                border: '1px solid var(--color-border)',
                width: '100%', maxWidth: 720, maxHeight: '90vh',
                display: 'flex', flexDirection: 'column', overflow: 'hidden'
            }}>
                {/* Header */}
                <div style={{
                    padding: 'var(--space-4) var(--space-5)',
                    borderBottom: '1px solid var(--color-border)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    background: 'linear-gradient(135deg, rgba(139,92,246,0.04) 0%, rgba(37,99,235,0.02) 100%)'
                }}>
                    <div>
                        <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 800, margin: 0, color: 'var(--color-text-primary)' }}>
                            Gerenciar Modelos de Declaração
                        </h3>
                        <p style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)', margin: '2px 0 0 0' }}>
                            Gerencie os templates de declarações e crie novos modelos para o seu painel.
                        </p>
                    </div>
                    <button onClick={onClose} className="icon-btn" style={{ padding: 6 }}>
                        <X size={18} />
                    </button>
                </div>

                {/* Content */}
                <div style={{ padding: 'var(--space-5)', overflowY: 'auto', flex: 1 }}>
                    {isFormOpen ? (
                        /* Add/Edit Form */
                        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                            <h4 style={{ fontSize: 'var(--text-md)', fontWeight: 700, margin: 0 }}>
                                {editingTemplate ? 'Editar Modelo' : 'Novo Modelo'}
                            </h4>
                            
                            <div>
                                <label className="decl-small-label">Título do Modelo</label>
                                <input
                                    className="form-select"
                                    style={{ fontSize: 'var(--text-sm)' }}
                                    value={title}
                                    onChange={(e) => setTitle(e.target.value)}
                                    placeholder="Ex: Declaração de Regularidade Fiscal"
                                    required
                                />
                            </div>

                            <div>
                                <label className="decl-small-label">Texto da Declaração (Suporta placeholders)</label>
                                <textarea
                                    className="form-select"
                                    style={{ minHeight: 220, fontSize: 'var(--text-sm)', resize: 'vertical', lineHeight: 1.5 }}
                                    value={content}
                                    onChange={(e) => setContent(e.target.value)}
                                    placeholder="A empresa {empresaRazaoSocial}, inscrita no CNPJ sob nº {empresaCnpj}... declara..."
                                    required
                                />
                            </div>

                            {/* Reference Placeholders */}
                            <div style={{
                                background: 'var(--color-bg-body)',
                                borderRadius: 'var(--radius-lg)',
                                padding: 'var(--space-3) var(--space-4)',
                                border: '1px solid var(--color-border)',
                            }}>
                                <div style={{ fontSize: '0.65rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--color-text-tertiary)', marginBottom: 6 }}>
                                    Tags de Placeholders Disponíveis (substituídos na geração):
                                </div>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 12px', fontSize: '0.62rem', color: 'var(--color-text-secondary)', fontFamily: 'monospace' }}>
                                    <span>{'{empresaRazaoSocial}'}</span>
                                    <span>{'{empresaCnpj}'}</span>
                                    <span>{'{empresaEndereco}'}</span>
                                    <span>{'{representanteNome}'}</span>
                                    <span>{'{representanteCpf}'}</span>
                                    <span>{'{representanteCargo}'}</span>
                                    <span>{'{orgaoLicitante}'}</span>
                                    <span>{'{modalidade}'}</span>
                                    <span>{'{editalNumero}'}</span>
                                    <span>{'{processoNumero}'}</span>
                                    <span>{'{objeto}'}</span>
                                </div>
                            </div>

                            {/* Actions */}
                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
                                <button type="button" className="btn btn-outline" onClick={handleCancel}>
                                    Cancelar
                                </button>
                                <button type="submit" className="btn btn-primary" style={{ background: 'linear-gradient(135deg, var(--color-primary), rgba(37,99,235,0.9))', border: 'none' }}>
                                    Salvar Modelo
                                </button>
                            </div>
                        </form>
                    ) : (
                        /* Template List */
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>
                                    Modelos cadastrados ({d.templates.length})
                                </span>
                                <button type="button" className="btn btn-primary" style={{ fontSize: '0.75rem', padding: '6px 12px', gap: 4 }} onClick={handleNewClick}>
                                    <Plus size={13} />
                                    Novo Modelo
                                </button>
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
                                {d.templates.map(t => {
                                    const isSystem = t.tenantId === null;
                                    return (
                                        <div key={t.id} style={{
                                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                            padding: 'var(--space-3) var(--space-4)',
                                            borderRadius: 'var(--radius-lg)',
                                            background: 'var(--color-bg-surface)',
                                            border: '1px solid var(--color-border)',
                                            gap: 'var(--space-4)'
                                        }}>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                                                    <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                        {t.title}
                                                    </span>
                                                    <span style={{
                                                        padding: '1px 6px', borderRadius: 'var(--radius-full)',
                                                        fontSize: '0.58rem', fontWeight: 700,
                                                        background: isSystem ? 'rgba(37,99,235,0.1)' : 'rgba(139,92,246,0.1)',
                                                        color: isSystem ? 'var(--color-primary)' : 'var(--color-ai)'
                                                    }}>
                                                        {isSystem ? 'Sistema' : 'Personalizado'}
                                                    </span>
                                                </div>
                                                <div style={{
                                                    fontSize: '0.68rem', color: 'var(--color-text-tertiary)',
                                                    marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis',
                                                    whiteSpace: 'nowrap', maxWidth: 450
                                                }}>
                                                    {t.content}
                                                </div>
                                            </div>

                                            <div style={{ display: 'flex', gap: 'var(--space-1)', alignItems: 'center' }}>
                                                {!isSystem ? (
                                                    <>
                                                        <button
                                                            className="btn btn-outline"
                                                            style={{ fontSize: '0.68rem', padding: '4px 8px' }}
                                                            onClick={() => handleEditClick(t)}
                                                        >
                                                            Editar
                                                        </button>
                                                        <button
                                                            className="icon-btn"
                                                            style={{ color: 'var(--color-danger)', padding: 6 }}
                                                            onClick={() => d.handleDeleteTemplate(t.id)}
                                                            title="Excluir"
                                                        >
                                                            <Trash2 size={13} />
                                                        </button>
                                                    </>
                                                ) : (
                                                    <button
                                                        className="btn btn-outline"
                                                        style={{ fontSize: '0.68rem', padding: '4px 8px', opacity: 0.6 }}
                                                        onClick={() => {
                                                            setTitle(t.title + " (Cópia)");
                                                            setContent(t.content);
                                                            setIsFormOpen(true);
                                                        }}
                                                        title="Duplicar e Customizar"
                                                    >
                                                        Customizar
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div style={{
                    padding: 'var(--space-3) var(--space-5)',
                    borderTop: '1px solid var(--color-border)',
                    display: 'flex', justifyContent: 'flex-end',
                    background: 'var(--color-bg-body)'
                }}>
                    <button className="btn btn-outline" style={{ fontSize: '0.78rem' }} onClick={onClose}>
                        Fechar
                    </button>
                </div>
            </div>
        </div>
    );
}

function TemplateChecklist({ d, setManageTemplatesOpen }: {
    d: ReturnType<typeof useAiDeclaration>;
    setManageTemplatesOpen: (open: boolean) => void;
}) {
    const [searchTerm, setSearchTerm] = useState('');

    const filteredTemplates = d.templates.filter(t => 
        t.title.toLowerCase().includes(searchTerm.toLowerCase())
    );

    const handleToggle = (id: string) => {
        d.setSelectedTemplateIds(prev => 
            prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
        );
    };

    const handleSelectAll = () => {
        d.setSelectedTemplateIds(filteredTemplates.map(t => t.id));
    };

    const handleClearAll = () => {
        d.setSelectedTemplateIds([]);
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {/* Header: Search and Shortcuts */}
            <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                <input
                    type="text"
                    className="form-select"
                    placeholder="Filtrar modelos..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    style={{ fontSize: '0.78rem', flex: 1, height: '36px' }}
                />
                <button
                    type="button"
                    className="btn btn-outline"
                    style={{ fontSize: '0.72rem', padding: '0 12px', height: '36px', gap: 4, whiteSpace: 'nowrap', display: 'flex', alignItems: 'center' }}
                    onClick={() => setManageTemplatesOpen(true)}
                >
                    <Settings2 size={12} />
                    Gerenciar
                </button>
            </div>

            {/* Selection Shortcuts & Counter */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.7rem', padding: '0 2px' }}>
                <span style={{ color: 'var(--color-text-secondary)', fontWeight: 600 }}>
                    {d.selectedTemplateIds.length} selecionado{d.selectedTemplateIds.length !== 1 ? 's' : ''}
                </span>
                <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                    <button
                        type="button"
                        onClick={handleSelectAll}
                        style={{ background: 'none', border: 'none', color: 'var(--color-primary)', fontWeight: 600, cursor: 'pointer', padding: 0 }}
                    >
                        Selecionar Todos
                    </button>
                    <button
                        type="button"
                        onClick={handleClearAll}
                        style={{ background: 'none', border: 'none', color: 'var(--color-text-tertiary)', fontWeight: 600, cursor: 'pointer', padding: 0 }}
                    >
                        Limpar
                    </button>
                </div>
            </div>

            {/* Scrollable Container */}
            <div style={{
                maxHeight: '190px',
                overflowY: 'auto',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-lg)',
                background: 'var(--color-bg-body)',
                display: 'flex',
                flexDirection: 'column',
                boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.03)'
            }}>
                {filteredTemplates.length === 0 ? (
                    <div style={{ padding: 'var(--space-6)', textAlign: 'center', color: 'var(--color-text-tertiary)', fontSize: 'var(--text-sm)' }}>
                        Nenhum modelo encontrado.
                    </div>
                ) : (
                    filteredTemplates.map(t => {
                        const isChecked = d.selectedTemplateIds.includes(t.id);
                        const isSystem = t.tenantId === null;
                        return (
                            <div
                                key={t.id}
                                onClick={() => handleToggle(t.id)}
                                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = isChecked ? 'rgba(139, 92, 246, 0.06)' : 'rgba(0, 0, 0, 0.02)'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = isChecked ? 'rgba(139, 92, 246, 0.03)' : 'transparent'; }}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 'var(--space-3)',
                                    padding: 'var(--space-2) var(--space-3)',
                                    borderBottom: '1px solid var(--color-border)',
                                    cursor: 'pointer',
                                    background: isChecked ? 'rgba(139, 92, 246, 0.03)' : 'transparent',
                                    transition: 'background-color 0.15s ease',
                                }}
                            >
                                <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={() => {}} // Controlled by container onClick
                                    style={{
                                        accentColor: 'var(--color-ai)',
                                        cursor: 'pointer',
                                        width: 14,
                                        height: 14,
                                        flexShrink: 0
                                    }}
                                />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{
                                        fontSize: '0.76rem',
                                        fontWeight: isChecked ? 600 : 400,
                                        color: isChecked ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                                        whiteSpace: 'nowrap',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                    }} title={t.title}>
                                        {t.title}
                                    </div>
                                </div>
                                <span style={{
                                    fontSize: '0.55rem',
                                    fontWeight: 700,
                                    padding: '2px 6px',
                                    borderRadius: '10px',
                                    textTransform: 'uppercase',
                                    letterSpacing: '0.02em',
                                    flexShrink: 0,
                                    background: isSystem ? 'rgba(37,99,235,0.06)' : 'rgba(139,92,246,0.06)',
                                    color: isSystem ? 'var(--color-primary)' : 'var(--color-ai)',
                                    border: isSystem ? '1px solid rgba(37,99,235,0.12)' : '1px solid rgba(139,92,246,0.12)'
                                }}>
                                    {isSystem ? 'Sistema' : 'Personalizado'}
                                </span>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
}

export function findMatchingTemplate(requiredText: string, templates: DeclarationTemplate[]): DeclarationTemplate | null {
    const lowerText = requiredText.toLowerCase();
    
    const matchMap: Record<string, string[]> = {
        'sys-menor': ['menor', 'infantil', 'xxxiii', 'art. 7', 'criança'],
        'sys-impedimento': ['impedimento', 'fato impeditivo', 'superveniente', 'idoneidade', 'inidoneidade'],
        'sys-me-epp': ['me/epp', 'microempresa', 'pequeno porte', 'enquadramento', 'lc 123'],
        'sys-nepotismo': ['nepotismo', 'parentesco', 'terceiro grau'],
        'sys-elaboracao': ['elaboração independente', 'independente', 'conluio'],
        'sys-plena': ['plena', 'plena habilitação', 'art. 63', 'requisitos de habilitação'],
        'sys-vagas': ['vagas', 'pcd', 'deficiente', 'menor aprendiz', 'reserva de vagas'],
        'sys-trabalho-escravo': ['escravo', 'trabalho forçado', 'degradante'],
        'sys-nepotismo-servidores': ['vínculo', 'servidores', 'servidor', 'cargo de direção'],
        'sys-compromisso-edital': ['compromisso', 'aceitação', 'edital', 'termo de referência'],
        'sys-lgpd': ['lgpd', 'lei geral de proteção de dados', 'dados pessoais', 'privacidade'],
        'sys-anticorrupcao': ['anticorrupção', 'ética', 'integridade', 'corrupção', 'fraude'],
        'sys-ceis-cnep': ['ceis', 'cnep', 'cadastro nacional', 'empresas punidas', 'inidôneas'],
        'sys-declinio-vistoria': ['declínio de vistoria', 'renúncia de vistoria', 'não realização de vistoria', 'declínio de visita'],
        'sys-custos-trabalhistas': ['integralidade de custos', 'direitos trabalhistas', 'custos trabalhistas', 'convenções coletivas'],
        'sys-autenticidade-documental': ['autenticidade', 'documentação digital', 'documentos eletrônicos', 'documentos digitais']
    };

    let bestMatch: DeclarationTemplate | null = null;
    let maxScore = 0;

    for (const template of templates) {
        let score = 0;
        const lowerTitle = template.title.toLowerCase();

        if (lowerText.includes(lowerTitle) || lowerTitle.includes(lowerText)) {
            score += 10;
        }

        const keywords = matchMap[template.id] || [];
        for (const keyword of keywords) {
            if (lowerText.includes(keyword)) {
                score += 5;
            }
        }

        const textWords = lowerText.split(/\s+/).filter(w => w.length > 3);
        const titleWords = lowerTitle.split(/\s+/).filter(w => w.length > 3);
        const commonWords = textWords.filter(w => titleWords.includes(w));
        score += commonWords.length;

        if (score > maxScore && score >= 3) {
            maxScore = score;
            bestMatch = template;
        }
    }

    return bestMatch;
}

export function extractAllDocuments(rawReq: any): string[] {
    const docs: string[] = [];
    try {
        const parsed = typeof rawReq === 'string' ? JSON.parse(rawReq) : rawReq;
        let items: any[] = [];
        if (Array.isArray(parsed)) items = parsed;
        else if (typeof parsed === 'object' && parsed !== null) {
            Object.entries(parsed).forEach(([category, categoryItems]: [string, any]) => {
                if (Array.isArray(categoryItems)) {
                    categoryItems.forEach((item: any) => {
                        const desc = typeof item === 'string' ? item : (item.description || item.item || '');
                        if (desc) {
                            docs.push(`${category}: ${desc}`);
                        }
                    });
                }
            });
        }
        if (docs.length === 0 && items.length > 0) {
            items.forEach((item: any) => {
                const desc = typeof item === 'string' ? item : (item.description || item.item || '');
                if (desc) docs.push(desc);
            });
        }
    } catch { /* ignore */ }
    return docs;
}

function EditalRequirementsMatchPanel({ d, biddings }: { d: ReturnType<typeof useAiDeclaration>; biddings: BiddingProcess[] }) {
    const bidding = d.fullBidding || biddings.find(x => x.id === d.selectedBiddingId);
    const analysis = bidding?.aiAnalysis;
    const allDocs = analysis ? extractAllDocuments(analysis.requiredDocuments) : [];
    const [showAllDocs, setShowAllDocs] = useState(false);

    if (d.isBiddingLoading) {
        return (
            <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 'var(--space-4)',
                padding: 'var(--space-12) var(--space-6)',
                background: 'var(--color-bg-surface)',
                borderRadius: 'var(--radius-xl)',
                border: 'none',
                boxShadow: '0 0 0 1px rgba(139,92,246,0.12), 0 4px 16px rgba(139,92,246,0.04)',
            }}>
                <Loader2 size={32} className="spin" color="var(--color-ai)" />
                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)', fontWeight: 600 }}>Carregando exigências do edital...</div>
            </div>
        );
    }

    return (
        <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-4)',
            padding: 'var(--space-6) var(--space-6)',
            background: 'var(--color-bg-surface)',
            borderRadius: 'var(--radius-xl)',
            border: 'none',
            boxShadow: '0 0 0 1px rgba(139,92,246,0.12), 0 4px 16px rgba(139,92,246,0.04)',
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
                <div style={{
                    width: 44, height: 44, borderRadius: 'var(--radius-lg)',
                    background: 'linear-gradient(135deg, rgba(37,99,235,0.12), rgba(139,92,246,0.08))',
                    border: '1px solid rgba(37,99,235,0.2)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                    <Scale size={20} color="var(--color-primary)" />
                </div>
                <div>
                    <div style={{ fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--color-primary)', marginBottom: 2 }}>Edital Licitatório</div>
                    <div style={{ fontSize: 'var(--text-lg)', fontWeight: 800, color: 'var(--color-text-primary)', lineHeight: 1.1, letterSpacing: '-0.02em' }}>Exigências do Certame</div>
                </div>
            </div>

            {d.declarationTypesFromEdital.length > 0 ? (
                <>
                    <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', lineHeight: 1.5 }}>
                        Declarações identificadas no edital. Clique no correspondente para adicionar à seleção de templates ou gerar com IA:
                    </p>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', marginTop: 'var(--space-2)' }}>
                        {d.declarationTypesFromEdital.map((reqText: string, i: number) => {
                            const match = findMatchingTemplate(reqText, d.templates);
                            const isMatchedSelected = match ? d.selectedTemplateIds.includes(match.id) : false;
                            const isAiSelected = d.generationMode === 'ai' && d.declarationType === reqText;

                            return (
                                <div
                                    key={i}
                                    style={{
                                        padding: 'var(--space-3) var(--space-4)',
                                        borderRadius: 'var(--radius-lg)',
                                        background: (isMatchedSelected || isAiSelected) ? 'rgba(37,99,235,0.03)' : 'var(--color-bg-body)',
                                        border: (isMatchedSelected || isAiSelected) ? '1px solid var(--color-primary)' : '1px solid var(--color-border)',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: 'var(--space-3)',
                                        transition: 'all 0.2s ease'
                                    }}
                                >
                                    {/* Requirement name */}
                                    <div style={{
                                        fontSize: '0.78rem',
                                        fontWeight: 600,
                                        color: 'var(--color-text-primary)',
                                        lineHeight: 1.4,
                                        display: 'flex',
                                        alignItems: 'flex-start',
                                        gap: 6
                                    }}>
                                        <span style={{
                                            width: 6, height: 6, borderRadius: '50%',
                                            background: 'var(--color-primary)',
                                            marginTop: 6, flexShrink: 0
                                        }} />
                                        {reqText}
                                    </div>

                                    {/* Match result block */}
                                    <div style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        gap: 10,
                                        borderTop: '1px dashed var(--color-border)',
                                        paddingTop: 8,
                                        flexWrap: 'wrap'
                                    }}>
                                        {match ? (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
                                                <div style={{ fontSize: '0.62rem', fontWeight: 700, color: 'var(--color-success)', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 3 }}>
                                                    <CheckCircle2 size={11} /> Modelo Correspondente
                                                </div>
                                                <div style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={match.title}>
                                                    {match.title}
                                                </div>
                                            </div>
                                        ) : (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0, flex: 1 }}>
                                                <div style={{ fontSize: '0.62rem', fontWeight: 700, color: 'var(--color-warning)', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 3 }}>
                                                    <Info size={11} /> Modelo não mapeado
                                                </div>
                                                <div style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)' }}>
                                                    Recomendado: Geração 100% IA
                                                </div>
                                            </div>
                                        )}

                                        {/* Action button */}
                                        {match ? (
                                            <button
                                                type="button"
                                                className={`btn ${isMatchedSelected ? 'btn-primary' : 'btn-outline'}`}
                                                style={{ fontSize: '0.68rem', padding: '6px 12px', height: '28px', whiteSpace: 'nowrap' }}
                                                onClick={() => {
                                                    d.setGenerationMode(d.generationMode === 'ai' ? 'mixed' : d.generationMode);
                                                    d.setSelectedTemplateIds(prev =>
                                                        prev.includes(match.id) ? prev.filter(x => x !== match.id) : [...prev, match.id]
                                                    );
                                                }}
                                            >
                                                {isMatchedSelected ? 'Remover' : 'Usar Modelo'}
                                            </button>
                                        ) : (
                                            <button
                                                type="button"
                                                className={`btn ${isAiSelected ? 'btn-primary' : 'btn-outline'}`}
                                                style={{ fontSize: '0.68rem', padding: '6px 12px', height: '28px', whiteSpace: 'nowrap' }}
                                                onClick={() => {
                                                    d.setGenerationMode('ai');
                                                    d.setDeclarationType(reqText);
                                                }}
                                            >
                                                {isAiSelected ? 'Selecionado' : 'Gerar via IA'}
                                            </button>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', padding: 'var(--space-2) 0' }}>
                    {!analysis ? (
                        <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-start', padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)', background: 'rgba(245,158,11,0.05)', border: '1px solid rgba(245,158,11,0.15)' }}>
                            <AlertTriangle size={18} color="var(--color-warning)" style={{ flexShrink: 0, marginTop: 2 }} />
                            <div>
                                <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 2 }}>Sem Análise de Edital</div>
                                <div style={{ fontSize: '0.72rem', color: 'var(--color-text-secondary)', lineHeight: 1.4 }}>
                                    Este processo ainda não possui uma análise de edital gerada por IA. Você pode prosseguir gerando livremente por IA ou usando os modelos estáticos ao lado.
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-start', padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)', background: 'rgba(37,99,235,0.03)', border: '1px solid rgba(37,99,235,0.1)' }}>
                            <Info size={18} color="var(--color-primary)" style={{ flexShrink: 0, marginTop: 2 }} />
                            <div>
                                <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 2 }}>Sem Declarações Mapeadas</div>
                                <div style={{ fontSize: '0.72rem', color: 'var(--color-text-secondary)', lineHeight: 1.4 }}>
                                    A análise do edital não identificou exigências específicas de declarações formais neste processo. Você pode prosseguir gerando livremente por IA ou usando os modelos estáticos ao lado.
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Collapsible details for other documents */}
            {allDocs.length > 0 && (
                <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 'var(--space-4)', marginTop: 'var(--space-2)' }}>
                    <button
                        type="button"
                        style={{
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%',
                            background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                            fontSize: '0.74rem', fontWeight: 700, color: 'var(--color-text-secondary)'
                        }}
                        onClick={() => setShowAllDocs(v => !v)}
                    >
                        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <FileText size={13} color="var(--color-primary)" />
                            Documentos Exigidos no Edital ({allDocs.length})
                        </span>
                        {showAllDocs ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    </button>

                    {showAllDocs && (
                        <div style={{
                            maxHeight: '220px',
                            overflowY: 'auto',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 6,
                            padding: 'var(--space-3)',
                            background: 'var(--color-bg-body)',
                            borderRadius: 'var(--radius-lg)',
                            border: '1px solid var(--color-border)',
                            marginTop: 'var(--space-3)'
                        }}>
                            {allDocs.map((doc, idx) => {
                                const parts = doc.split(/:\s*(.+)/);
                                const hasCategory = parts.length > 1;
                                return (
                                    <div key={idx} style={{ fontSize: '0.72rem', color: 'var(--color-text-secondary)', display: 'flex', gap: 6, alignItems: 'flex-start', lineHeight: 1.4 }}>
                                        <span style={{ color: 'var(--color-primary)', fontWeight: 700, marginTop: 1 }}>•</span>
                                        <span>
                                            {hasCategory ? (
                                                <>
                                                    <strong style={{ color: 'var(--color-text-primary)' }}>{parts[0]}:</strong> {parts[1]}
                                                </>
                                            ) : doc}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
