import { FileText, Sparkles, Download, Save, Loader2, CheckCircle2, Image, X, Settings2, Plus, Trash2, ChevronDown, ChevronUp, FileSignature, Building2, Briefcase, ArrowLeft, RotateCcw, AlertTriangle, Shield, ChevronRight, Scale, PenLine, FileDown, Zap, Ban, Info } from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog } from '../ui';
import { useAiDeclaration } from '../hooks/useAiDeclaration';
import type { LayoutConfig, QualityReportFrontend } from '../hooks/useAiDeclaration';
import type { BiddingProcess, CompanyProfile } from '../../types';

interface Props {
    biddings: BiddingProcess[];
    companies: CompanyProfile[];
    onSave?: () => void;
    initialBiddingId?: string;
}

export function AiDeclarationGenerator({ biddings, companies, onSave, initialBiddingId }: Props) {
    const d = useAiDeclaration({ biddings, companies, onSave, initialBiddingId });
    const hasResult = !!d.generatedText || d.isGenerating;

    return (
        <>
        {!hasResult ? (
            /* ═══════════════════════════════════════════
               STEP 1: Wizard focado — O que gerar?
               ═══════════════════════════════════════════ */
            <WizardStep1 d={d} companies={companies} />
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
        </>
    );
}

// ═══════════════════════════════════════════════
// STEP 1 — Wizard Focado
// ═══════════════════════════════════════════════

function WizardStep1({ d, companies }: { d: ReturnType<typeof useAiDeclaration>; companies: CompanyProfile[] }) {
    return (
        <div style={{ maxWidth: 900, margin: '0 auto', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-8)', alignItems: 'start' }}>

            {/* LEFT: Config */}
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
                        <div style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)', marginTop: 3 }}>Gere declarações formais a partir do edital com IA</div>
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

                    <ConfigField label="Tipo de Declaração" icon={<FileSignature size={10} />} stepNumber={3}>
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

                    {/* Style selector */}
                    <DeclarationStyleSelector
                        style={d.declarationStyle}
                        setStyle={d.setDeclarationStyle}
                    />

                    {/* Instruções adicionais — sutil */}
                    <OptionalInstructions value={d.customPrompt} onChange={d.setCustomPrompt} />

                    {/* Generate CTA */}
                    <button
                        className="btn btn-primary"
                        style={{
                            width: '100%', height: '52px', gap: 'var(--space-2)', marginTop: 'var(--space-2)',
                            background: 'linear-gradient(135deg, var(--color-ai), var(--color-primary))',
                            border: 'none', borderRadius: 'var(--radius-xl)',
                            boxShadow: d.selectedBiddingId && d.selectedCompanyId && d.declarationType ? '0 6px 24px rgba(139,92,246,0.30)' : undefined,
                            fontSize: 'var(--text-md)', fontWeight: 800, letterSpacing: '-0.01em',
                            opacity: (!d.selectedBiddingId || !d.selectedCompanyId || !d.declarationType) ? 0.5 : 1,
                            transition: 'all 0.2s',
                        }}
                        onClick={d.handleGenerate}
                        disabled={d.isGenerating || !d.selectedBiddingId || !d.selectedCompanyId || !d.declarationType}
                    >
                        {d.isGenerating ? <Loader2 size={20} className="spin" /> : <Sparkles size={20} />}
                        {d.isGenerating ? 'Gerando declaração...' : 'Gerar Declaração'}
                    </button>
                </div>
            </div>

            {/* RIGHT: Info panel */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
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
                        Selecione a <strong>licitação</strong> e o <strong>tipo</strong>, e a IA irá gerar a declaração formal com base nas exigências do edital.
                    </p>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', marginTop: 'var(--space-2)' }}>
                        {[
                            { icon: 'sparkles', title: 'Inteligência do Edital', desc: 'Texto gerado com base na análise IA do edital' },
                            { icon: 'scale', title: 'Rigor Jurídico', desc: 'Linguagem formal aderente à Lei 14.133/2021' },
                            { icon: 'penline', title: 'Editável', desc: 'Revise e ajuste o texto antes de exportar' },
                            { icon: 'filedown', title: 'PDF Pronto', desc: 'Exporta como PDF com cabeçalho e assinatura' },
                        ].map((f, i) => (
                            <div key={i} style={{
                                display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)',
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
                            border: style === opt.value ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
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
                <label style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-md)', cursor: 'pointer', border: issuerType === 'company' ? '2px solid var(--color-primary)' : '1px solid var(--color-border)', background: issuerType === 'company' ? 'var(--color-primary-light)' : 'var(--color-bg-body)', fontSize: 'var(--text-sm)', fontWeight: issuerType === 'company' ? 600 : 400, transition: 'all 0.15s' }}>
                    <input type="radio" name="issuerType" checked={issuerType === 'company'} onChange={() => setIssuerType('company')} style={{ accentColor: 'var(--color-primary)', width: 13, height: 13 }} />
                    Empresa (Rep. Legal)
                </label>
                <label style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-md)', cursor: hasTechQual ? 'pointer' : 'not-allowed', border: issuerType === 'technical' ? '2px solid var(--color-primary)' : '1px solid var(--color-border)', background: issuerType === 'technical' ? 'var(--color-primary-light)' : 'var(--color-bg-body)', fontSize: 'var(--text-sm)', fontWeight: issuerType === 'technical' ? 600 : 400, opacity: hasTechQual ? 1 : 0.4, transition: 'all 0.15s' }}>
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

function LayoutSettingsPanel({ d }: { d: ReturnType<typeof useAiDeclaration> }) {
    const [collapsed, setCollapsed] = useState(true); // Start collapsed

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
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
                            <div><label className="decl-small-label">Nome</label><input className="decl-small-input" placeholder="NOME COMPLETO" value={d.layout.signatoryName} onChange={(e) => d.updateLayout({ signatoryName: e.target.value })} /></div>
                            <div><label className="decl-small-label">CPF</label><input className="decl-small-input" placeholder="000.000.000-00" value={d.layout.signatoryCpf} onChange={(e) => d.updateLayout({ signatoryCpf: e.target.value })} /></div>
                            <div><label className="decl-small-label">Cargo</label><input className="decl-small-input" placeholder="Sócio Administrador" value={d.layout.signatoryRole} onChange={(e) => d.updateLayout({ signatoryRole: e.target.value })} /></div>
                            <div><label className="decl-small-label">Empresa</label><input className="decl-small-input" value={d.layout.signatoryCompany} onChange={(e) => d.updateLayout({ signatoryCompany: e.target.value })} /></div>
                        </div>
                        <div><label className="decl-small-label">CNPJ</label><input className="decl-small-input" value={d.layout.signatoryCnpj} onChange={(e) => d.updateLayout({ signatoryCnpj: e.target.value })} /></div>
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
        <div style={{ marginBottom: 'var(--space-3)', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg-body)', border: '1px solid var(--color-border)' }}>
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

function DeclarationPreview({ layout, declarationType, generatedText, setGeneratedText }: {
    layout: LayoutConfig; declarationType: string; generatedText: string; setGeneratedText: (v: string) => void;
}) {
    return (
        <div className="decl-page-mockup">
            {/* Header */}
            {layout.headerImage && (
                <div style={{ textAlign: 'center', marginBottom: 6 }}>
                    <img src={layout.headerImage} alt="Logo" style={{ maxWidth: `${layout.headerImageWidth * 2.5}px`, maxHeight: `${layout.headerImageHeight * 2.5}px`, objectFit: 'contain' }} />
                </div>
            )}
            {layout.headerText && (
                <div style={{ textAlign: 'center', borderBottom: '1px solid #ccc', paddingBottom: 8, marginBottom: 16, fontSize: '0.65rem', color: '#666', whiteSpace: 'pre-line', lineHeight: 1.3 }}>
                    {layout.headerText}
                </div>
            )}

            {/* Addressee */}
            {(layout.addresseeName || layout.addresseeOrg) && (
                <div style={{ fontSize: '0.75rem', color: '#444', marginBottom: 16, lineHeight: 1.5 }}>
                    {layout.addresseeName && <div>Ao {layout.addresseeName}</div>}
                    {layout.addresseeOrg && <div style={{ whiteSpace: 'pre-line' }}>{layout.addresseeOrg}</div>}
                </div>
            )}

            {/* Title */}
            <div style={{ textAlign: 'center', fontWeight: 'bold', marginBottom: 20, fontSize: '0.95rem', textTransform: 'uppercase', lineHeight: 1.3, wordBreak: 'break-word' }}>
                {declarationType || 'DECLARAÇÃO'}
            </div>

            {/* Body */}
            <textarea className="decl-editor-text" value={generatedText} onChange={(e) => setGeneratedText(e.target.value)} placeholder="Texto gerado aqui..." style={{ textAlign: 'justify' }} />

            {/* Location/Date */}
            {(layout.signatureCity || layout.signatureDate) && (
                <div style={{ textAlign: 'right', marginTop: 20, fontSize: '0.8rem', color: '#333' }}>
                    {layout.signatureCity}{layout.signatureCity && layout.signatureDate ? ', ' : ''}{layout.signatureDate}.
                </div>
            )}

            {/* Signature block */}
            <div style={{ textAlign: 'center', marginTop: 30 }}>
                <div style={{ color: '#333', marginBottom: 3, fontSize: '0.8rem' }}>__________________________________________</div>
                {layout.signatoryName && <div style={{ fontWeight: 'bold', fontSize: '0.78rem' }}>{layout.signatoryName.toUpperCase()}</div>}
                {layout.signatoryCpf && <div style={{ fontSize: '0.7rem', color: '#555' }}>{layout.signatoryCpf}</div>}
                {layout.signatoryRole && <div style={{ fontSize: '0.7rem', color: '#555' }}>{layout.signatoryRole}</div>}
                {layout.signatoryCompany && <div style={{ fontWeight: 'bold', fontSize: '0.75rem' }}>{layout.signatoryCompany}</div>}
                {layout.signatoryCnpj && <div style={{ fontSize: '0.7rem', color: '#555' }}>{layout.signatoryCnpj}</div>}
            </div>

            {/* Footer */}
            <div style={{ marginTop: 'auto', paddingTop: 20 }}>
                {layout.footerImage && (
                    <div style={{ textAlign: 'center', marginBottom: 4 }}>
                        <img src={layout.footerImage} alt="Rodapé" style={{ maxWidth: `${layout.footerImageWidth * 2.5}px`, maxHeight: `${layout.footerImageHeight * 2.5}px`, objectFit: 'contain' }} />
                    </div>
                )}
                {layout.footerText && (
                    <div style={{ textAlign: 'center', borderTop: '1px solid #ccc', paddingTop: 6, fontSize: '0.6rem', color: '#999', whiteSpace: 'pre-line' }}>
                        {layout.footerText}
                    </div>
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
