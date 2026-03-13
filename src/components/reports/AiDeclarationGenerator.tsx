import { FileText, Sparkles, Download, Save, Loader2, CheckCircle2, Image, X, Settings2, Plus, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '../ui';
import { useAiDeclaration } from '../hooks/useAiDeclaration';
import type { LayoutConfig } from '../hooks/useAiDeclaration';
import type { BiddingProcess, CompanyProfile } from '../../types';

interface Props {
    biddings: BiddingProcess[];
    companies: CompanyProfile[];
    onSave?: () => void;
}

export function AiDeclarationGenerator({ biddings, companies, onSave }: Props) {
    const d = useAiDeclaration({ biddings, companies, onSave });

    return (
        <>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(340px, 1fr) 2fr', gap: 'var(--space-7)', height: 'fit-content' }}>

            {/* LEFT: Configuration */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>

                {/* AI Config */}
                <div className="card" style={{ padding: 'var(--space-5)' }}>
                    <h3 style={{ margin: '0 0 var(--space-4)', fontSize: 'var(--text-lg)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                        <Sparkles size={18} color="var(--color-primary)" /> Configuração da IA
                    </h3>
                    <Field label="Licitação Alvo">
                        <select className="form-select" value={d.selectedBiddingId} onChange={(e) => d.handleBiddingChange(e.target.value)}>
                            <option value="">-- Selecione --</option>
                            {d.biddingsWithAnalysis.map(b => <option key={b.id} value={b.id}>{b.title}</option>)}
                        </select>
                    </Field>
                    <Field label="Empresa Emitente">
                        <select className="form-select" value={d.selectedCompanyId} onChange={(e) => d.handleCompanyChange(e.target.value)}>
                            <option value="">-- Selecione --</option>
                            {companies.map(c => <option key={c.id} value={c.id}>{c.razaoSocial}</option>)}
                        </select>
                    </Field>
                    <Field label="Tipo de Declaração (do Edital)">
                        {d.declarationTypesFromEdital.length === 0 ? (
                            <div style={{ padding: 'var(--space-3)', borderRadius: 'var(--radius-sm)', background: d.selectedBiddingId ? 'var(--color-warning-bg)' : 'var(--color-bg-body)', border: '1px solid var(--color-border)', fontSize: 'var(--text-md)', color: 'var(--color-text-tertiary)' }}>
                                {d.selectedBiddingId ? 'Nenhuma declaração identificada neste edital.' : 'Selecione uma licitação.'}
                            </div>
                        ) : (
                            <select className="form-select" value={d.declarationType} onChange={(e) => d.setDeclarationType(e.target.value)}>
                                {d.declarationTypesFromEdital.map((t, i) => <option key={i} value={t}>{t}</option>)}
                            </select>
                        )}
                    </Field>
                    <IssuerTypeSelector
                        issuerType={d.issuerType}
                        setIssuerType={d.setIssuerType}
                        selectedCompanyId={d.selectedCompanyId}
                        companies={companies}
                    />
                    <Field label="Instruções Adicionais">
                        <textarea className="form-select" style={{ minHeight: '60px', resize: 'vertical' }} placeholder="Opcional..." value={d.customPrompt} onChange={(e) => d.setCustomPrompt(e.target.value)} />
                    </Field>
                    <button className="btn btn-primary" style={{ width: '100%', height: '44px', gap: 'var(--space-2)', marginTop: '4px' }} onClick={d.handleGenerate} disabled={d.isGenerating || !d.selectedBiddingId || !d.selectedCompanyId || !d.declarationType}>
                        {d.isGenerating ? <Loader2 size={18} className="spin" /> : <Sparkles size={18} />}
                        {d.isGenerating ? 'Gerando...' : 'Gerar Declaração'}
                    </button>
                </div>

                {/* Layout Settings */}
                <LayoutSettingsPanel d={d} />
            </div>

            {/* RIGHT: Editor & Preview */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                <div className="card" style={{ flex: 1, minHeight: '600px', display: 'flex', flexDirection: 'column', padding: 'var(--space-5)' }}>
                    <EditorToolbar d={d} />

                    {!d.generatedText && !d.isGenerating ? (
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', opacity: 0.4, textAlign: 'center' }}>
                            <Sparkles size={56} style={{ marginBottom: 'var(--space-3)' }} />
                            <h3>Pronto para gerar</h3>
                            <p style={{ fontSize: '0.9rem' }}>Selecione uma licitação com Relatório Analítico.</p>
                        </div>
                    ) : (
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                            <DeclarationPreview layout={d.layout} declarationType={d.declarationType} generatedText={d.generatedText} setGeneratedText={d.setGeneratedText} />
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

// ═════════════════════════════════════════
// ── Sub-components ──
// ═════════════════════════════════════════

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div style={{ marginBottom: '12px' }}>
            <label className="form-label">{label}</label>
            {children}
        </div>
    );
}

function ImageUploadSection({ label, image, width, height, onUpload, onRemove, onWidthChange, onHeightChange }: {
    label: string; image: string | null; width: number; height: number;
    onUpload: (f: File) => void; onRemove: () => void; onWidthChange: (w: number) => void; onHeightChange: (h: number) => void;
}) {
    return (
        <div style={{ marginBottom: '12px' }}>
            <label className="decl-small-label">{label}</label>
            {image ? (
                <div style={{ border: '1px dashed var(--color-border)', borderRadius: '6px', padding: '8px', backgroundColor: 'var(--color-bg-body)' }}>
                    <div style={{ textAlign: 'center', marginBottom: '6px', background: 'white', padding: '6px', borderRadius: '4px' }}>
                        <img src={image} alt={label} style={{ maxWidth: `${width * 3}px`, maxHeight: `${height * 3}px`, objectFit: 'contain', display: 'block', margin: '0 auto' }} />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '6px', alignItems: 'end' }}>
                        <div><label className="decl-small-label" style={{ marginBottom: '2px' }}>Largura (mm)</label><input type="number" className="decl-small-input" value={width} onChange={(e) => onWidthChange(parseInt(e.target.value) || 10)} min={5} max={180} /></div>
                        <div><label className="decl-small-label" style={{ marginBottom: '2px' }}>Altura (mm)</label><input type="number" className="decl-small-input" value={height} onChange={(e) => onHeightChange(parseInt(e.target.value) || 5)} min={5} max={80} /></div>
                        <button className="icon-btn" onClick={onRemove} title="Remover" style={{ padding: '4px', color: 'var(--color-danger)' }}><X size={14} /></button>
                    </div>
                </div>
            ) : (
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 12px', border: '1px dashed var(--color-border)', borderRadius: '6px', cursor: 'pointer', fontSize: '0.75rem', color: 'var(--color-text-tertiary)', backgroundColor: 'var(--color-bg-body)' }}>
                    <Image size={14} /> Anexar imagem
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
        <Field label="Emitente da Declaração">
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <label style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', border: issuerType === 'company' ? '2px solid var(--color-primary)' : '1px solid var(--color-border)', background: issuerType === 'company' ? 'var(--color-primary-light)' : 'var(--color-bg-body)', fontSize: 'var(--text-sm)', fontWeight: issuerType === 'company' ? 'var(--font-semibold)' : 'var(--font-normal)' }}>
                    <input type="radio" name="issuerType" checked={issuerType === 'company'} onChange={() => setIssuerType('company')} style={{ accentColor: 'var(--color-primary)' }} />
                    Empresa (Rep. Legal)
                </label>
                <label style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-sm)', cursor: hasTechQual ? 'pointer' : 'not-allowed', border: issuerType === 'technical' ? '2px solid var(--color-primary)' : '1px solid var(--color-border)', background: issuerType === 'technical' ? 'var(--color-primary-light)' : 'var(--color-bg-body)', fontSize: 'var(--text-sm)', fontWeight: issuerType === 'technical' ? 'var(--font-semibold)' : 'var(--font-normal)', opacity: hasTechQual ? 1 : 0.4 }}>
                    <input type="radio" name="issuerType" checked={issuerType === 'technical'} onChange={() => setIssuerType('technical')} disabled={!hasTechQual} style={{ accentColor: 'var(--color-primary)' }} />
                    Profissional Técnico
                </label>
            </div>
            {issuerType === 'technical' && !hasTechQual && (
                <p style={{ color: 'var(--color-danger)', fontSize: '0.72rem', marginTop: '4px', marginBottom: 0 }}>Cadastre a qualificação técnica na aba Documentos → editar empresa.</p>
            )}
        </Field>
    );
}

function LayoutSettingsPanel({ d }: { d: ReturnType<typeof useAiDeclaration> }) {
    return (
        <div className="card" style={{ padding: 'var(--space-5)' }}>
            <div className="flex-between" style={{ marginBottom: 'var(--space-3)' }}>
                <h4 style={{ margin: 0, fontSize: 'var(--text-md)', color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <Settings2 size={14} /> Layout & Assinatura
                </h4>
                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                    <button className="btn btn-outline" style={{ fontSize: 'var(--text-sm)', padding: '3px var(--space-2)', gap: '4px' }} onClick={d.handleSaveLayout}>
                        {d.layoutSaved ? <CheckCircle2 size={12} color="var(--color-success)" /> : <Save size={12} />}
                        {d.layoutSaved ? 'Salvo!' : 'Salvar'}
                    </button>
                    <button className="btn btn-outline" style={{ fontSize: 'var(--text-sm)', padding: '3px var(--space-2)', gap: '4px' }} onClick={d.handleCreateLayout}>
                        <Plus size={12} /> Novo
                    </button>
                    <button className="btn btn-outline" style={{ fontSize: 'var(--text-sm)', padding: '3px var(--space-2)', gap: '4px', color: 'var(--color-danger)' }} onClick={d.handleResetLayout}>
                        <X size={12} /> Limpar
                    </button>
                </div>
            </div>

            {/* Layout Selector */}
            <div style={{ marginBottom: 'var(--space-4)', display: 'flex', gap: 'var(--space-2)' }}>
                <select className="form-select" style={{ flex: 1, fontSize: '0.8rem' }} value={d.currentLayoutId} onChange={(e) => d.handleSwitchLayout(e.target.value)}>
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

            {/* Addressee */}
            <div style={{ padding: 'var(--space-3)', backgroundColor: 'var(--color-bg-body)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', marginBottom: 'var(--space-3)' }}>
                <label className="form-label" style={{ fontSize: '0.7rem', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Destinatário</label>
                <input className="form-select" style={{ fontSize: '0.8rem', marginBottom: '6px' }} placeholder="Ex: Agente de Contratação" value={d.layout.addresseeName} onChange={(e) => d.updateLayout({ addresseeName: e.target.value })} />
                <textarea className="form-select" style={{ fontSize: '0.8rem', minHeight: '40px' }} placeholder="Órgão / Pregão nº..." value={d.layout.addresseeOrg} onChange={(e) => d.updateLayout({ addresseeOrg: e.target.value })} />
            </div>

            {/* City/Date */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
                <div><label className="decl-small-label">Local</label><input className="decl-small-input" value={d.layout.signatureCity} onChange={(e) => d.updateLayout({ signatureCity: e.target.value })} /></div>
                <div><label className="decl-small-label">Data</label><input className="decl-small-input" value={d.layout.signatureDate} onChange={(e) => d.updateLayout({ signatureDate: e.target.value })} /></div>
            </div>

            {/* Signatory block */}
            <div style={{ padding: 'var(--space-3)', backgroundColor: 'var(--color-bg-body)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', marginBottom: 'var(--space-3)' }}>
                <label className="form-label" style={{ fontSize: '0.7rem', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Bloco de Assinatura</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}>
                    <div><label className="decl-small-label">Nome</label><input className="decl-small-input" placeholder="NOME COMPLETO" value={d.layout.signatoryName} onChange={(e) => d.updateLayout({ signatoryName: e.target.value })} /></div>
                    <div><label className="decl-small-label">CPF</label><input className="decl-small-input" placeholder="CPF nº: 000.000.000-00" value={d.layout.signatoryCpf} onChange={(e) => d.updateLayout({ signatoryCpf: e.target.value })} /></div>
                    <div><label className="decl-small-label">Cargo</label><input className="decl-small-input" placeholder="Sócio Administrador" value={d.layout.signatoryRole} onChange={(e) => d.updateLayout({ signatoryRole: e.target.value })} /></div>
                    <div><label className="decl-small-label">Empresa</label><input className="decl-small-input" value={d.layout.signatoryCompany} onChange={(e) => d.updateLayout({ signatoryCompany: e.target.value })} /></div>
                </div>
                <div style={{ marginTop: '6px' }}><label className="decl-small-label">CNPJ</label><input className="decl-small-input" value={d.layout.signatoryCnpj} onChange={(e) => d.updateLayout({ signatoryCnpj: e.target.value })} /></div>
            </div>

            {/* Images */}
            <ImageUploadSection label="Logotipo Cabeçalho" image={d.layout.headerImage} width={d.layout.headerImageWidth} height={d.layout.headerImageHeight}
                onUpload={(f) => d.handleImageUpload('headerImage', f)} onRemove={() => d.updateLayout({ headerImage: null })}
                onWidthChange={(w) => d.updateLayout({ headerImageWidth: w })} onHeightChange={(h) => d.updateLayout({ headerImageHeight: h })} />

            <Field label="Cabeçalho (Texto)">
                <textarea className="form-select" style={{ fontSize: '0.8rem', minHeight: '40px' }} value={d.layout.headerText} onChange={(e) => d.updateLayout({ headerText: e.target.value })} placeholder="Razão Social / CNPJ" />
            </Field>

            <ImageUploadSection label="Logotipo Rodapé" image={d.layout.footerImage} width={d.layout.footerImageWidth} height={d.layout.footerImageHeight}
                onUpload={(f) => d.handleImageUpload('footerImage', f)} onRemove={() => d.updateLayout({ footerImage: null })}
                onWidthChange={(w) => d.updateLayout({ footerImageWidth: w })} onHeightChange={(h) => d.updateLayout({ footerImageHeight: h })} />

            <Field label="Rodapé (Texto)">
                <textarea className="form-select" style={{ fontSize: '0.8rem', minHeight: '40px' }} value={d.layout.footerText} onChange={(e) => d.updateLayout({ footerText: e.target.value })} placeholder="Endereço / contato" />
            </Field>
        </div>
    );
}

function EditorToolbar({ d }: { d: ReturnType<typeof useAiDeclaration> }) {
    return (
        <div className="flex-between" style={{ marginBottom: 'var(--space-4)' }}>
            <div className="flex-gap">
                <div style={{ width: '28px', height: '28px', borderRadius: 'var(--radius-sm)', background: 'var(--color-primary-light)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <FileText size={16} color="var(--color-primary)" />
                </div>
                <h3 style={{ margin: 0, fontSize: 'var(--text-lg)' }}>Editor da Declaração</h3>
            </div>
            <div className="flex-gap">
                {d.saveSuccess && <span style={{ color: 'var(--color-success)', fontSize: 'var(--text-md)' }} className="flex-gap"><CheckCircle2 size={14} /> Salvo!</span>}
                <button className="btn btn-outline flex-gap" onClick={d.handleAddToDocuments} disabled={!d.generatedText || d.isSaving} style={{ fontSize: '0.8rem' }}>
                    {d.isSaving ? <Loader2 size={14} className="spin" /> : <Save size={14} />} Vincular ao Dossiê
                </button>
                <button className="btn flex-gap" onClick={d.handleExportPDF} disabled={!d.generatedText} style={{ backgroundColor: 'var(--color-success)', color: 'white', fontSize: 'var(--text-md)' }}>
                    <Download size={14} /> Baixar PDF
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
                <div style={{ textAlign: 'center', marginBottom: '6px' }}>
                    <img src={layout.headerImage} alt="Logo" style={{ maxWidth: `${layout.headerImageWidth * 2.5}px`, maxHeight: `${layout.headerImageHeight * 2.5}px`, objectFit: 'contain' }} />
                </div>
            )}
            {layout.headerText && (
                <div style={{ textAlign: 'center', borderBottom: '1px solid #ccc', paddingBottom: '8px', marginBottom: '16px', fontSize: '0.65rem', color: '#666', whiteSpace: 'pre-line', lineHeight: 1.3 }}>
                    {layout.headerText}
                </div>
            )}

            {/* Addressee */}
            {(layout.addresseeName || layout.addresseeOrg) && (
                <div style={{ fontSize: '0.75rem', color: '#444', marginBottom: '16px', lineHeight: 1.5 }}>
                    {layout.addresseeName && <div>Ao {layout.addresseeName}</div>}
                    {layout.addresseeOrg && <div style={{ whiteSpace: 'pre-line' }}>{layout.addresseeOrg}</div>}
                </div>
            )}

            {/* Title */}
            <div style={{ textAlign: 'center', fontWeight: 'bold', marginBottom: '20px', fontSize: '0.95rem', textTransform: 'uppercase', lineHeight: 1.3, wordBreak: 'break-word' }}>
                {declarationType || 'DECLARAÇÃO'}
            </div>

            {/* Body */}
            <textarea className="decl-editor-text" value={generatedText} onChange={(e) => setGeneratedText(e.target.value)} placeholder="Texto gerado aqui..." />

            {/* Location/Date */}
            {(layout.signatureCity || layout.signatureDate) && (
                <div style={{ textAlign: 'right', marginTop: '20px', fontSize: '0.8rem', color: '#333', fontStyle: 'italic' }}>
                    {layout.signatureCity}{layout.signatureCity && layout.signatureDate ? ', ' : ''}{layout.signatureDate}.
                </div>
            )}

            {/* Signature block */}
            <div style={{ textAlign: 'center', marginTop: '30px' }}>
                <div style={{ color: '#333', marginBottom: '3px', fontSize: '0.8rem' }}>__________________________________________</div>
                {layout.signatoryName && <div style={{ fontWeight: 'bold', fontSize: '0.78rem' }}>{layout.signatoryName.toUpperCase()}</div>}
                {layout.signatoryCpf && <div style={{ fontSize: '0.7rem', color: '#555' }}>{layout.signatoryCpf}</div>}
                {layout.signatoryRole && <div style={{ fontSize: '0.7rem', color: '#555' }}>{layout.signatoryRole}</div>}
                {layout.signatoryCompany && <div style={{ fontWeight: 'bold', fontSize: '0.75rem' }}>{layout.signatoryCompany}</div>}
                {layout.signatoryCnpj && <div style={{ fontSize: '0.7rem', color: '#555' }}>{layout.signatoryCnpj}</div>}
            </div>

            {/* Footer */}
            <div style={{ marginTop: 'auto', paddingTop: '20px' }}>
                {layout.footerImage && (
                    <div style={{ textAlign: 'center', marginBottom: '4px' }}>
                        <img src={layout.footerImage} alt="Rodapé" style={{ maxWidth: `${layout.footerImageWidth * 2.5}px`, maxHeight: `${layout.footerImageHeight * 2.5}px`, objectFit: 'contain' }} />
                    </div>
                )}
                {layout.footerText && (
                    <div style={{ textAlign: 'center', borderTop: '1px solid #ccc', paddingTop: '6px', fontSize: '0.6rem', color: '#999', whiteSpace: 'pre-line' }}>
                        {layout.footerText}
                    </div>
                )}
            </div>
        </div>
    );
}
