import { FileText, Sparkles, Download, Save, Loader2, CheckCircle2, Image, X, Settings2, Plus, Trash2, ChevronDown, ChevronUp, FileSignature, Building2, Briefcase } from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog } from '../ui';
import { useAiDeclaration } from '../hooks/useAiDeclaration';
import type { LayoutConfig } from '../hooks/useAiDeclaration';
import type { BiddingProcess, CompanyProfile } from '../../types';

interface Props {
    biddings: BiddingProcess[];
    companies: CompanyProfile[];
    onSave?: () => void;
    initialBiddingId?: string;
}

export function AiDeclarationGenerator({ biddings, companies, onSave, initialBiddingId }: Props) {
    const d = useAiDeclaration({ biddings, companies, onSave, initialBiddingId });

    return (
        <>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 380px) 1fr', gap: 'var(--space-6)', alignItems: 'start' }}>

            {/* ─────────────── LEFT: Configuration ─────────────── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', position: 'sticky', top: 'var(--space-4)' }}>

                {/* ── AI Config Card ── */}
                <div style={{
                    borderRadius: 'var(--radius-xl)',
                    border: '1px solid rgba(139,92,246,0.2)',
                    overflow: 'hidden',
                    background: 'var(--color-bg-surface)',
                    boxShadow: '0 2px 12px rgba(139,92,246,0.06)',
                }}>
                    {/* Card header */}
                    <div style={{
                        padding: 'var(--space-5) var(--space-5)',
                        background: 'linear-gradient(135deg, rgba(139,92,246,0.07) 0%, rgba(37,99,235,0.04) 60%, transparent 100%)',
                        borderBottom: '1px solid rgba(139,92,246,0.12)',
                        display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                    }}>
                        <div style={{
                            width: 40, height: 40, borderRadius: 'var(--radius-lg)',
                            background: 'linear-gradient(135deg, rgba(139,92,246,0.18), rgba(37,99,235,0.1))',
                            border: '1px solid rgba(139,92,246,0.25)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                        }}>
                            <Sparkles size={19} color="var(--color-ai)" strokeWidth={1.75} />
                        </div>
                        <div>
                            <div style={{ fontSize: 'var(--text-lg)', fontWeight: 800, color: 'var(--color-text-primary)', lineHeight: 1.1, letterSpacing: '-0.02em' }}>Configuração da IA</div>
                            <div style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)', marginTop: 2 }}>Gere declarações formais a partir do edital analisado</div>
                        </div>
                    </div>

                    {/* Fields */}
                    <div style={{ padding: 'var(--space-5)' }}>
                        <ConfigField label="Licitação Alvo" icon={<Briefcase size={10} />}>
                            <select className="form-select" value={d.selectedBiddingId} onChange={(e) => d.handleBiddingChange(e.target.value)}>
                                <option value="">— Selecione a licitação com análise IA —</option>
                                {d.biddingsWithAnalysis.map(b => <option key={b.id} value={b.id}>{b.title}</option>)}
                            </select>
                        </ConfigField>

                        <ConfigField label="Empresa Emitente" icon={<Building2 size={10} />}>
                            <select className="form-select" value={d.selectedCompanyId} onChange={(e) => d.handleCompanyChange(e.target.value)}>
                                <option value="">— Selecione a empresa —</option>
                                {companies.map(c => <option key={c.id} value={c.id}>{c.razaoSocial}</option>)}
                            </select>
                        </ConfigField>

                        <ConfigField label="Tipo de Declaração" icon={<FileSignature size={10} />}>
                            {d.declarationTypesFromEdital.length === 0 ? (
                                <div style={{
                                    padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-md)',
                                    background: d.selectedBiddingId ? 'var(--color-warning-bg)' : 'var(--color-bg-body)',
                                    border: '1px solid var(--color-border)', fontSize: 'var(--text-sm)',
                                    color: 'var(--color-text-tertiary)',
                                }}>
                                    {d.selectedBiddingId ? 'Nenhuma declaração identificada neste edital.' : 'Selecione uma licitação acima.'}
                                </div>
                            ) : (
                                <select className="form-select" value={d.declarationType} onChange={(e) => d.setDeclarationType(e.target.value)}>
                                    {d.declarationTypesFromEdital.map((t, i) => <option key={i} value={t}>{t}</option>)}
                                </select>
                            )}
                        </ConfigField>

                        {/* Issuer type */}
                        <IssuerTypeSelector
                            issuerType={d.issuerType}
                            setIssuerType={d.setIssuerType}
                            selectedCompanyId={d.selectedCompanyId}
                            companies={companies}
                        />

                        {/* Optional instructions — collapsed by default */}
                        <OptionalInstructions value={d.customPrompt} onChange={d.setCustomPrompt} />

                        {/* Generate CTA */}
                        <button
                            className="btn btn-primary"
                            style={{
                                width: '100%', height: '50px', gap: 'var(--space-2)', marginTop: 'var(--space-3)',
                                background: 'linear-gradient(135deg, var(--color-ai), var(--color-primary))',
                                border: 'none', borderRadius: 'var(--radius-xl)',
                                boxShadow: '0 6px 20px rgba(139,92,246,0.28)',
                                fontSize: 'var(--text-md)', fontWeight: 800, letterSpacing: '-0.01em',
                            }}
                            onClick={d.handleGenerate}
                            disabled={d.isGenerating || !d.selectedBiddingId || !d.selectedCompanyId || !d.declarationType}
                        >
                            {d.isGenerating ? <Loader2 size={20} className="spin" /> : <Sparkles size={20} />}
                            {d.isGenerating ? 'Gerando declaração...' : 'Gerar Declaração'}
                        </button>
                    </div>
                </div>

                {/* ── Layout & Assinatura (collapsible) ── */}
                <LayoutSettingsPanel d={d} />
            </div>

            {/* ─────────────── RIGHT: Editor & Preview ─────────────── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                <div style={{
                    borderRadius: 'var(--radius-xl)',
                    border: '1px solid var(--color-border)',
                    overflow: 'hidden',
                    background: 'var(--color-bg-surface)',
                    minHeight: 640,
                    display: 'flex', flexDirection: 'column',
                }}>
                    {/* Editor toolbar */}
                    <EditorToolbar d={d} />

                    {/* Content */}
                    {!d.generatedText && !d.isGenerating ? (
                        <EditorEmptyState />
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
// Sub-components
// ═══════════════════════════════════════════════

function ConfigField({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
    return (
        <div style={{ marginBottom: 'var(--space-4)' }}>
            <label style={{
                display: 'flex', alignItems: 'center', gap: 5,
                fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase',
                letterSpacing: '0.07em', color: 'var(--color-text-tertiary)',
                marginBottom: 'var(--space-1)',
            }}>
                {icon && <span style={{ opacity: 0.7 }}>{icon}</span>}
                {label}
            </label>
            {children}
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
    return (
        <ConfigField label="Emitente da Declaração">
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
        </ConfigField>
    );
}

function LayoutSettingsPanel({ d }: { d: ReturnType<typeof useAiDeclaration> }) {
    const [collapsed, setCollapsed] = useState(false);

    return (
        <div style={{
            borderRadius: 'var(--radius-xl)',
            border: '1px solid var(--color-border)',
            overflow: 'hidden',
            background: 'var(--color-bg-surface)',
        }}>
            {/* Panel header — always visible */}
            <div
                style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: 'var(--space-4) var(--space-5)',
                    background: collapsed ? 'var(--color-bg-surface)' : 'linear-gradient(135deg, rgba(37,99,235,0.04), rgba(99,102,241,0.02))',
                    borderBottom: collapsed ? 'none' : '1px solid var(--color-border)',
                    cursor: 'pointer',
                }}
                onClick={() => setCollapsed(c => !c)}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <div style={{ width: 26, height: 26, borderRadius: 'var(--radius-sm)', background: 'rgba(37,99,235,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Settings2 size={14} color="var(--color-primary)" />
                    </div>
                    <div>
                        <div style={{ fontSize: 'var(--text-md)', fontWeight: 700, color: 'var(--color-text-primary)', lineHeight: 1.1 }}>Layout &amp; Assinatura</div>
                        {collapsed && <div style={{ fontSize: '0.68rem', color: 'var(--color-text-tertiary)' }}>Cabeçalho, rodapé, destinatário e signatário</div>}
                    </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    {!collapsed && (
                        <>
                            <button className="btn btn-outline" style={{ fontSize: '0.7rem', padding: '3px 8px', gap: 4 }} onClick={(e) => { e.stopPropagation(); d.handleSaveLayout(); }}>
                                {d.layoutSaved ? <CheckCircle2 size={11} color="var(--color-success)" /> : <Save size={11} />}
                                {d.layoutSaved ? 'Salvo!' : 'Salvar'}
                            </button>
                            <button className="btn btn-outline" style={{ fontSize: '0.7rem', padding: '3px 8px', gap: 4 }} onClick={(e) => { e.stopPropagation(); d.handleCreateLayout(); }}>
                                <Plus size={11} /> Novo
                            </button>
                        </>
                    )}
                    {collapsed ? <ChevronDown size={15} color="var(--color-text-tertiary)" /> : <ChevronUp size={15} color="var(--color-text-tertiary)" />}
                </div>
            </div>

            {!collapsed && (
                <div style={{ padding: 'var(--space-4) var(--space-5)' }}>
                    {/* Layout selector */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 'var(--space-2)', marginBottom: 'var(--space-3)', alignItems: 'center' }}>
                        <select className="form-select" style={{ fontSize: '0.8rem' }} value={d.currentLayoutId} onChange={(e) => d.handleSwitchLayout(e.target.value)}>
                            {d.layouts.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                        </select>
                        <button className="icon-btn" style={{ color: 'var(--color-danger)', opacity: d.layouts.length > 1 ? 1 : 0.3 }} onClick={d.handleDeleteLayout} disabled={d.layouts.length <= 1}>
                            <Trash2 size={14} />
                        </button>
                    </div>

                    <div style={{ marginBottom: 'var(--space-4)' }}>
                        <label className="decl-small-label">Nome do Layout</label>
                        <input className="decl-small-input" value={d.layoutName} onChange={(e) => d.handleUpdateLayoutName(e.target.value)} placeholder="Ex: Layout Empresa A" />
                    </div>

                    {/* Destinatário — grouped block */}
                    <LayoutSection label="Destinatário">
                        <input className="form-select" style={{ fontSize: '0.8rem', marginBottom: 6 }} placeholder="Agente de Contratação" value={d.layout.addresseeName} onChange={(e) => d.updateLayout({ addresseeName: e.target.value })} />
                        <textarea className="form-select" style={{ fontSize: '0.8rem', minHeight: '38px', resize: 'none' }} placeholder="Órgão / Pregão nº..." value={d.layout.addresseeOrg} onChange={(e) => d.updateLayout({ addresseeOrg: e.target.value })} />
                    </LayoutSection>

                    {/* Local / Data — inline */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
                        <div>
                            <label className="decl-small-label">Local</label>
                            <input className="decl-small-input" value={d.layout.signatureCity} onChange={(e) => d.updateLayout({ signatureCity: e.target.value })} />
                        </div>
                        <div>
                            <label className="decl-small-label">Data</label>
                            <input className="decl-small-input" value={d.layout.signatureDate} onChange={(e) => d.updateLayout({ signatureDate: e.target.value })} />
                        </div>
                    </div>

                    {/* Signatário — grouped block */}
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
        <div style={{ marginBottom: 'var(--space-4)', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg-body)', border: '1px solid var(--color-border)' }}>
            <div style={{ fontSize: '0.62rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-2)' }}>
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
            padding: 'var(--space-4) var(--space-6)',
            borderBottom: '1px solid var(--color-border)',
            background: 'linear-gradient(135deg, rgba(37,99,235,0.03), rgba(99,102,241,0.02))',
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                <div style={{ width: 36, height: 36, borderRadius: 'var(--radius-lg)', background: 'linear-gradient(135deg, rgba(37,99,235,0.1), rgba(99,102,241,0.06))', border: '1px solid rgba(37,99,235,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <FileText size={17} color="var(--color-primary)" />
                </div>
                <div>
                    <div style={{ fontSize: 'var(--text-lg)', fontWeight: 800, color: 'var(--color-text-primary)', lineHeight: 1.1, letterSpacing: '-0.02em' }}>Documento Gerado</div>
                    <div style={{ fontSize: '0.68rem', color: 'var(--color-text-tertiary)' }}>
                        {d.generatedText ? 'Clique no texto para editar diretamente' : 'Aguardando configuração e geração'}
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
                    style={{ fontSize: '0.78rem', padding: 'var(--space-2) var(--space-3)', display: 'flex', alignItems: 'center', gap: 5 }}>
                    {d.isSaving ? <Loader2 size={13} className="spin" /> : <Save size={13} />}
                    Vincular ao Dossiê
                </button>
                <button className="btn" onClick={d.handleExportPDF} disabled={!d.generatedText}
                    style={{
                        fontSize: '0.78rem', padding: 'var(--space-2) var(--space-4)',
                        background: 'linear-gradient(135deg, var(--color-success), rgba(21,128,61,0.9))',
                        color: 'white', boxShadow: d.generatedText ? '0 3px 10px rgba(34,197,94,0.25)' : undefined,
                        display: 'flex', alignItems: 'center', gap: 5,
                    }}>
                    <Download size={13} /> Baixar PDF
                </button>
            </div>
        </div>
    );
}

function EditorEmptyState() {
    return (
        <div style={{
            flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr',
            minHeight: 500,
        }}>
            {/* LEFT: call to action */}
            <div style={{
                display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 'var(--space-5)',
                padding: 'var(--space-12) var(--space-10)',
                borderRight: '1px solid var(--color-border)',
                background: 'linear-gradient(160deg, rgba(139,92,246,0.03) 0%, transparent 60%)',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                    <div style={{
                        width: 52, height: 52, borderRadius: 'var(--radius-xl)',
                        background: 'linear-gradient(135deg, rgba(139,92,246,0.12), rgba(37,99,235,0.08))',
                        border: '1px solid rgba(139,92,246,0.2)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                        <Sparkles size={24} color="var(--color-ai)" strokeWidth={1.6} />
                    </div>
                    <div>
                        <div style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--color-ai)', marginBottom: 2 }}>Em espera</div>
                        <div style={{ fontSize: 'var(--text-lg)', fontWeight: 800, color: 'var(--color-text-primary)', lineHeight: 1.1, letterSpacing: '-0.02em' }}>Estúdio Documental</div>
                    </div>
                </div>

                <p style={{ margin: 0, fontSize: 'var(--text-md)', color: 'var(--color-text-secondary)', lineHeight: 1.65, maxWidth: 280 }}>
                    Configure a <strong>licitação</strong>, <strong>empresa emitente</strong> e <strong>tipo de declaração</strong> ao lado,
                    e clique em <strong>Gerar Declaração</strong>.
                </p>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                    {[
                        'Texto ajustado automaticamente ao tipo de declaração',
                        'Estrutura formal de documento jurídico-administrativo',
                        'Editável diretamente antes de exportar',
                        'Exporta como PDF pronto para assinatura',
                    ].map((f, i) => (
                        <div key={i} style={{ display: 'flex', alignItems: 'flex-start', gap: 7, fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)' }}>
                            <span style={{ color: 'var(--color-ai)', opacity: 0.7, marginTop: 1, flexShrink: 0 }}>·</span>
                            {f}
                        </div>
                    ))}
                </div>
            </div>

            {/* RIGHT: ghost document outline */}
            <div style={{
                display: 'flex', flexDirection: 'column', justifyContent: 'center',
                padding: 'var(--space-10) var(--space-8)',
                background: 'var(--color-bg-body)',
            }}>
                <div style={{ opacity: 0.22, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {/* Logo placeholder */}
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 4 }}>
                        <div style={{ width: 60, height: 16, borderRadius: 3, background: 'var(--color-text-tertiary)' }} />
                    </div>
                    {/* Header line */}
                    <div style={{ borderBottom: '1px solid var(--color-border)', paddingBottom: 8, marginBottom: 8, display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'center' }}>
                        <div style={{ height: 7, width: '70%', borderRadius: 3, background: 'var(--color-text-tertiary)' }} />
                        <div style={{ height: 7, width: '50%', borderRadius: 3, background: 'var(--color-text-tertiary)' }} />
                    </div>
                    {/* Addressee */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
                        <div style={{ height: 7, width: '45%', borderRadius: 3, background: 'var(--color-text-tertiary)' }} />
                        <div style={{ height: 7, width: '60%', borderRadius: 3, background: 'var(--color-text-tertiary)' }} />
                    </div>
                    {/* Title */}
                    <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 12 }}>
                        <div style={{ height: 10, width: '55%', borderRadius: 3, background: 'var(--color-ai)', opacity: 0.6 }} />
                    </div>
                    {/* Body lines */}
                    {[100, 88, 95, 75, 92, 80, 60].map((w, i) => (
                        <div key={i} style={{ height: 7, width: `${w}%`, borderRadius: 3, background: 'var(--color-text-tertiary)' }} />
                    ))}
                    {/* Signature */}
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, marginTop: 24 }}>
                        <div style={{ height: 1, width: '50%', background: 'var(--color-text-tertiary)' }} />
                        <div style={{ height: 7, width: '40%', borderRadius: 3, background: 'var(--color-text-tertiary)' }} />
                        <div style={{ height: 6, width: '35%', borderRadius: 3, background: 'var(--color-text-tertiary)' }} />
                    </div>
                </div>
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
            <textarea className="decl-editor-text" value={generatedText} onChange={(e) => setGeneratedText(e.target.value)} placeholder="Texto gerado aqui..." />

            {/* Location/Date */}
            {(layout.signatureCity || layout.signatureDate) && (
                <div style={{ textAlign: 'right', marginTop: 20, fontSize: '0.8rem', color: '#333', fontStyle: 'italic' }}>
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
