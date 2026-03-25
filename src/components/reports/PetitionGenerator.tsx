import {
    Sparkles, Download, Loader2, Scale, ScrollText,
    ChevronRight, Copy, Check, Image as ImageIcon, Settings2,
    Trash2, Save
} from 'lucide-react';
import { ConfirmDialog } from '../ui';
import { usePetition, PETITION_TYPES } from '../hooks/usePetition';
import type { BiddingProcess, CompanyProfile } from '../../types';

interface Props {
    biddings: BiddingProcess[];
    companies: CompanyProfile[];
    onSave?: () => void;
    initialBiddingId?: string;
}

export function PetitionGenerator({ biddings, companies, onSave, initialBiddingId }: Props) {
    const p = usePetition({ biddings, companies, onSave, initialBiddingId });

    return (
        <>
        <div style={{ display: 'grid', gridTemplateColumns: '400px 1fr', gap: 'var(--space-6)', height: 'calc(100vh - 200px)' }}>
            {/* Left: Configuration */}
            <div className="card" style={{ display: 'flex', flexDirection: 'column', padding: '0', overflowY: 'auto', background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-xl)', border: 'none', boxShadow: '0 0 0 1px var(--color-border), 0 4px 20px rgba(0,0,0,0.03)' }}>
                {/* Header */}
                <PetitionSidebarHeader onNew={p.handleNew} onClear={p.handleClear} />

                <div style={{ padding: 'var(--space-5)', display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
                    {/* Style Toggle */}
                    <StyleToggleButton showStyles={p.showStyles} onClick={() => p.setShowStyles(!p.showStyles)} />

                    {p.showStyles && (
                        <StyleConfigPanel
                            headerImage={p.headerImage} setHeaderImage={p.setHeaderImage}
                            footerImage={p.footerImage} setFooterImage={p.setFooterImage}
                            headerImageHeight={p.headerImageHeight} setHeaderImageHeight={p.setHeaderImageHeight}
                            footerImageHeight={p.footerImageHeight} setFooterImageHeight={p.setFooterImageHeight}
                            handleImageUpload={p.handleImageUpload}
                            handleSaveCompanyTemplate={p.handleSaveCompanyTemplate}
                            isSavingTemplate={p.isSavingTemplate}
                            selectedCompany={p.selectedCompany}
                            selectedCompanyId={p.selectedCompanyId}
                        />
                    )}

                    {/* Process Selection */}
                    <div className="form-group">
                        <label className="form-label form-label--sm">Processo</label>
                        <select className="form-control" value={p.selectedBiddingId} onChange={(e) => p.setSelectedBiddingId(e.target.value)} style={{ borderRadius: 'var(--radius-lg)', padding: 'var(--space-3)' }}>
                            <option value="">-- Selecione um processo --</option>
                            {p.eligibleBiddings.map(b => (<option key={b.id} value={b.id}>{b.title} ({b.portal})</option>))}
                        </select>
                    </div>

                    {/* Company Selection */}
                    <div className="form-group">
                        <label className="form-label form-label--sm">Empresa Litigante</label>
                        <select className="form-control" value={p.selectedCompanyId} onChange={(e) => p.setSelectedCompanyId(e.target.value)} style={{ borderRadius: 'var(--radius-lg)', padding: 'var(--space-3)' }}>
                            <option value="">-- Selecione a empresa --</option>
                            {companies.map(c => (<option key={c.id} value={c.id}>{c.razaoSocial}</option>))}
                        </select>
                    </div>

                    {/* Petition Type */}
                    <PetitionTypeSelector petitionTypeId={p.petitionTypeId} setPetitionTypeId={p.setPetitionTypeId} />

                    {/* Facts */}
                    <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                        <label className="form-label form-label--sm mb-0">Fatos e Argumentos (IA usará como base)</label>
                        <textarea className="form-control"
                            style={{ minHeight: '120px', fontSize: '0.875rem', borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)', border: '1.5px solid var(--color-border)', lineHeight: '1.5', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.02)', resize: 'vertical' }}
                            placeholder="Descreva aqui os motivos do recurso, irregularidades encontradas ou fatos relevantes..."
                            value={p.factsSummary} onChange={(e) => p.setFactsSummary(e.target.value)} />
                    </div>

                    {/* Attachments */}
                    <AttachmentSection attachments={p.attachments} setAttachments={p.setAttachments} handleAttachmentUpload={p.handleAttachmentUpload} />

                    {/* Generate Button */}
                    <button className="btn btn-primary"
                        style={{
                            width: '100%', height: '52px', gap: 'var(--space-3)', fontSize: 'var(--text-lg)',
                            borderRadius: 'var(--radius-xl)', fontWeight: 700,
                            background: 'linear-gradient(135deg, var(--color-primary), rgba(99,102,241,0.9))',
                            boxShadow: '0 6px 20px rgba(37,99,235,0.3)',
                            border: 'none',
                        }}
                        disabled={p.isGenerating || !p.selectedBiddingId || !p.selectedCompanyId || (!p.factsSummary && p.attachments.length === 0)}
                        onClick={p.handleGenerate}>
                        {p.isGenerating ? <Loader2 size={20} className="spin" /> : <Sparkles size={20} />}
                        {p.isGenerating ? 'IA Redigindo Peça...' : 'Gerar Peça com IA'}
                    </button>
                </div>
            </div>

            {/* Right: Draft Preview */}
            <div className="card" style={{ display: 'flex', flexDirection: 'column', padding: '0', overflow: 'hidden', background: 'var(--color-bg-base)', borderRadius: 'var(--radius-xl)', border: 'none', boxShadow: '0 0 0 1px var(--color-border)' }}>
                <EditorHeader p={p} />

                <div style={{ flex: 1, padding: 'var(--space-10)', overflowY: 'auto', background: 'var(--color-bg-base)', display: 'flex', justifyContent: 'center' }}>
                    {!p.generatedDraft && !p.isGenerating ? (
                        <EmptyState />
                    ) : p.isGenerating ? (
                        <LoadingSkeleton />
                    ) : (
                        <div id="petition-preview" style={{ width: '100%', maxWidth: '800px', background: 'white', padding: '60px', borderRadius: '4px', boxShadow: '0 4px 24px rgba(0,0,0,0.08)', height: 'fit-content', minHeight: '100%', position: 'relative' }}>
                            {p.headerImage && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: `${p.headerImageHeight}px`, overflow: 'hidden' }}>
                                <img src={p.headerImage} alt="Header Preview" style={{ width: '100%', height: 'auto' }} />
                                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '1px', background: 'rgba(0,0,0,0.05)' }}></div>
                            </div>}

                            <div
                                id="petition-editable-content"
                                key={p.editorKey}
                                ref={p.editorRef}
                                contentEditable
                                suppressContentEditableWarning
                                onInput={(e) => p.setGeneratedDraft(e.currentTarget.innerHTML)}
                                dangerouslySetInnerHTML={{ __html: p.lastAiResult.current }}
                                style={{
                                    marginTop: p.headerImage ? `${p.headerImageHeight + 20}px` : '0',
                                    marginBottom: p.footerImage ? `${p.footerImageHeight + 20}px` : '0',
                                    whiteSpace: 'pre-wrap', fontFamily: 'serif', fontSize: '1.2rem',
                                    lineHeight: '1.6', color: 'var(--color-text-primary)', textAlign: 'justify',
                                    minHeight: '400px', outline: 'none', padding: '10px'
                                }}
                            />
                            <style>{`
                                #petition-editable-content img { transition: all 0.2s; border: 2px solid transparent; border-radius: 4px; display: inline-block; vertical-align: middle; }
                                #petition-editable-content img:hover { border-color: var(--color-primary-light); }
                                #petition-editable-content img.selected { border-color: var(--color-primary); box-shadow: 0 0 0 4px rgba(37,99,235,0.15); outline: none; }
                                .tech-tag { display: none !important; pointer-events: none; }
                                @keyframes fadeIn { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
                            `}</style>

                            {p.footerImage && <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: `${p.footerImageHeight}px`, overflow: 'hidden' }}>
                                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '1px', background: 'rgba(0,0,0,0.05)' }}></div>
                                <img src={p.footerImage} alt="Footer Preview" style={{ width: '100%', height: 'auto' }} />
                            </div>}
                        </div>
                    )}
                </div>
            </div>
        </div>
            <ConfirmDialog
                open={!!p.confirmAction}
                title={p.confirmAction?.type === 'new' ? 'Nova Petição' : 'Remover Imagem'}
                message={p.confirmAction?.type === 'new' ? 'Deseja iniciar uma nova petição? Todos os dados atuais serão perdidos.' : 'Deseja remover esta imagem?'}
                variant={p.confirmAction?.type === 'new' ? 'warning' : 'danger'}
                confirmLabel={p.confirmAction?.type === 'new' ? 'Iniciar Nova' : 'Remover'}
                onConfirm={() => p.confirmAction?.onConfirm()}
                onCancel={() => p.setConfirmAction(null)}
            />
    </>
    );
}

// ═════════════════════════════════════════
// ── Sub-components ──
// ═════════════════════════════════════════

function PetitionSidebarHeader({ onNew, onClear }: { onNew: () => void; onClear: () => void }) {
    return (
        <div style={{
            padding: 'var(--space-5)', borderBottom: '1px solid var(--color-border)',
            background: 'linear-gradient(135deg, rgba(37,99,235,0.06), rgba(139,92,246,0.04))'
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-3)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                    <div style={{ width: 36, height: 36, borderRadius: 'var(--radius-lg)', background: 'linear-gradient(135deg, rgba(37,99,235,0.12), rgba(99,102,241,0.08))', border: '1px solid rgba(37,99,235,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Scale size={18} color="var(--color-primary)" />
                    </div>
                    <div>
                        <div style={{ fontSize: 'var(--text-lg)', fontWeight: 700, color: 'var(--color-text-primary)', lineHeight: 1.1 }}>Peças Jurídicas</div>
                        <div style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)', marginTop: 1 }}>Inteligência jurídica especializada — Lei 14.133</div>
                    </div>
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                    <button onClick={onNew} className="btn btn-sm btn-outline" style={{ padding: '4px 8px', fontSize: '0.7rem' }}>Novo</button>
                    <button onClick={onClear} className="btn btn-sm btn-outline" style={{ padding: '4px 8px', fontSize: '0.7rem', color: 'var(--color-danger)' }}>Limpar</button>
                </div>
            </div>
        </div>
    );
}

function StyleToggleButton({ showStyles, onClick }: { showStyles: boolean; onClick: () => void }) {
    return (
        <button onClick={onClick} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            width: '100%', padding: 'var(--space-3)', borderRadius: 'var(--radius-lg)',
            background: showStyles ? 'var(--color-primary-light)' : 'var(--color-bg-secondary)',
            border: `1px solid ${showStyles ? 'var(--color-primary)' : 'var(--color-border)'}`,
            cursor: 'pointer', transition: 'var(--transition-fast)'
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', fontWeight: 'var(--font-semibold)', fontSize: 'var(--text-md)', color: showStyles ? 'var(--color-primary)' : 'var(--color-text-secondary)' }}>
                <Settings2 size={16} /> Estilizar Relatório (Premium)
            </div>
            <ChevronRight size={16} style={{ transform: showStyles ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} />
        </button>
    );
}

function StyleConfigPanel({ headerImage, setHeaderImage, footerImage, setFooterImage, headerImageHeight, setHeaderImageHeight, footerImageHeight, setFooterImageHeight, handleImageUpload, handleSaveCompanyTemplate, isSavingTemplate, selectedCompany, selectedCompanyId }: any) {
    return (
        <div style={{ padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)', background: 'var(--color-bg-secondary)', border: 'none', boxShadow: '0 0 0 1px var(--color-border)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <div>
                <label style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 'var(--font-bold)', marginBottom: 'var(--space-2)', color: 'var(--color-text-secondary)' }}>CABEÇALHO (BANNER PNG/JPG)</label>
                <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                    <div style={{ flex: 1, height: '40px', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', background: 'white' }}>
                        {headerImage ? <img src={headerImage} alt="Header" style={{ height: '100%', width: 'auto' }} /> : <ImageIcon size={20} opacity={0.3} />}
                    </div>
                    <input type="file" id="header-up" hidden onChange={(e: any) => handleImageUpload(e, setHeaderImage)} />
                    <button onClick={() => document.getElementById('header-up')?.click()} className="btn btn-sm btn-outline"><ImageIcon size={14} /></button>
                    {headerImage && <button onClick={() => setHeaderImage('')} className="btn btn-sm btn-outline" style={{ color: 'var(--color-danger)' }}><Trash2 size={14} /></button>}
                </div>
                <div style={{ marginTop: '8px' }}>
                    <label style={{ fontSize: '0.7rem' }}>Altura: {headerImageHeight}px</label>
                    <input type="range" min="30" max="300" value={headerImageHeight} onChange={(e: any) => setHeaderImageHeight(Number(e.target.value))} style={{ width: '100%', accentColor: 'var(--color-primary)' }} />
                </div>
            </div>

            <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '12px' }}>
                <label style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 'var(--font-bold)', marginBottom: 'var(--space-2)', color: 'var(--color-text-secondary)' }}>RODAPÉ (BANNER PNG/JPG)</label>
                <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                    <div style={{ flex: 1, height: '40px', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', background: 'white' }}>
                        {footerImage ? <img src={footerImage} alt="Footer" style={{ height: '100%', width: 'auto' }} /> : <ImageIcon size={20} opacity={0.3} />}
                    </div>
                    <input type="file" id="footer-up" hidden onChange={(e: any) => handleImageUpload(e, setFooterImage)} />
                    <button onClick={() => document.getElementById('footer-up')?.click()} className="btn btn-sm btn-outline"><ImageIcon size={14} /></button>
                    {footerImage && <button onClick={() => setFooterImage('')} className="btn btn-sm btn-outline" style={{ color: 'var(--color-danger)' }}><Trash2 size={14} /></button>}
                </div>
                <div style={{ marginTop: '8px' }}>
                    <label style={{ fontSize: '0.7rem' }}>Altura: {footerImageHeight}px</label>
                    <input type="range" min="30" max="200" value={footerImageHeight} onChange={(e: any) => setFooterImageHeight(Number(e.target.value))} style={{ width: '100%', accentColor: 'var(--color-primary)' }} />
                </div>
            </div>

            <button onClick={handleSaveCompanyTemplate} disabled={isSavingTemplate || !selectedCompanyId}
                style={{ width: '100%', marginTop: '8px', fontSize: '0.72rem', padding: '8px', borderRadius: '8px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                title={selectedCompany ? `Salvar como padrão para ${selectedCompany.razaoSocial}` : 'Selecione uma empresa'}
                className="btn btn-outline">
                {isSavingTemplate ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
                {selectedCompany ? ` Salvar Padrão p/ ${selectedCompany.razaoSocial.split(' ')[0]}` : ' Salvar como Padrão'}
            </button>
        </div>
    );
}

function PetitionTypeSelector({ petitionTypeId, setPetitionTypeId }: { petitionTypeId: string; setPetitionTypeId: (v: string) => void }) {
    return (
        <div className="form-group">
            <label className="form-label form-label--sm">Tipo de Peça</label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 'var(--space-2)' }}>
                {PETITION_TYPES.map(type => (
                    <div key={type.id} onClick={() => setPetitionTypeId(type.id)} style={{
                        padding: 'var(--space-3)', borderRadius: 'var(--radius-lg)',
                        border: `1.5px solid ${petitionTypeId === type.id ? 'var(--color-primary)' : 'var(--color-border)'}`,
                        background: petitionTypeId === type.id ? 'var(--color-primary-light)' : 'white',
                        cursor: 'pointer', transition: 'var(--transition-fast)',
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        boxShadow: petitionTypeId === type.id ? '0 4px 12px rgba(37,99,235,0.1)' : 'none'
                    }}>
                        <div>
                            <div style={{ fontSize: 'var(--text-md)', fontWeight: 'var(--font-bold)', color: petitionTypeId === type.id ? 'var(--color-primary)' : 'var(--color-text-primary)' }}>{type.label}</div>
                            <div style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)', marginTop: '2px' }}>{type.law}</div>
                        </div>
                        {petitionTypeId === type.id && <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Check size={12} color="white" /></div>}
                    </div>
                ))}
            </div>
        </div>
    );
}

function AttachmentSection({ attachments, setAttachments, handleAttachmentUpload }: any) {
    return (
        <div className="form-group">
            <label className="form-label form-label--sm">Anexos de Corroboração (Atas, Provas...)</label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
                {attachments.map((att: any, idx: number) => (
                    <span key={idx} style={{ padding: '4px var(--space-3)', background: 'var(--color-primary-light)', color: 'var(--color-primary)', borderRadius: 'var(--radius-xl)', fontSize: 'var(--text-sm)', display: 'flex', alignItems: 'center', gap: '4px', border: '1px solid rgba(37,99,235,0.2)' }}>
                        <ScrollText size={12} /> {att.name}
                        <Trash2 size={12} className="cursor-pointer" onClick={() => setAttachments((prev: any[]) => prev.filter((_: any, i: number) => i !== idx))} />
                    </span>
                ))}
            </div>
            <input type="file" id="attach-up" hidden multiple onChange={handleAttachmentUpload} />
            <button onClick={() => document.getElementById('attach-up')?.click()} className="btn btn-sm btn-outline" style={{ width: '100%', borderRadius: '10px' }}>
                <ImageIcon size={14} style={{ marginRight: '6px' }} /> Anexar Documentos de Base
            </button>
        </div>
    );
}

function EditorHeader({ p }: { p: ReturnType<typeof usePetition> }) {
    return (
        <div style={{
            padding: 'var(--space-4) var(--space-6)', borderBottom: '1px solid var(--color-border)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            background: 'linear-gradient(135deg, rgba(15,23,42,0.97), rgba(30,27,75,0.95))',
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                <div style={{ width: '36px', height: '36px', borderRadius: 'var(--radius-lg)', background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <ScrollText size={18} color="rgba(255,255,255,0.8)" />
                </div>
                <div>
                    <h3 style={{ margin: 0, fontSize: 'var(--text-lg)', fontWeight: 700, color: 'white' }}>Minuta Jurídica</h3>
                    <span style={{ fontSize: 'var(--text-sm)', color: 'rgba(255,255,255,0.45)' }}>Clique no documento para editar o texto</span>
                </div>
            </div>
            <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', alignItems: 'center' }}>
                {p.selectedImg && <ImageToolbar applyImageStyle={p.applyImageStyle} handleDeleteImage={p.handleDeleteImage} />}
                <input type="file" id="content-image-up" hidden accept="image/*" onChange={p.handleInsertImage} />
                <button className="btn btn-outline" style={{ padding: 'var(--space-2) var(--space-4)', fontSize: 'var(--text-base)', borderRadius: 'var(--radius-lg)', gap: 'var(--space-2)', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.7)' }} disabled={!p.generatedDraft} onClick={() => document.getElementById('content-image-up')?.click()}>
                    <ImageIcon size={16} /> Inserir Imagem
                </button>
                <button className="btn btn-outline" style={{ padding: 'var(--space-2) var(--space-4)', fontSize: 'var(--text-base)', borderRadius: 'var(--radius-lg)', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.7)' }} disabled={!p.generatedDraft} onClick={p.handleCopy}>
                    {p.isCopied ? <Check size={16} /> : <Copy size={16} />}
                    {p.isCopied ? 'Copiado!' : 'Copiar'}
                </button>
                <button className="btn btn-primary" style={{ padding: 'var(--space-2) var(--space-5)', fontSize: 'var(--text-base)', background: 'linear-gradient(135deg, #1e3a5f, #111827)', borderColor: '#1e3a5f', borderRadius: 'var(--radius-lg)', fontWeight: 700, boxShadow: '0 3px 10px rgba(0,0,0,0.3)' }} disabled={!p.generatedDraft} onClick={p.handleExportPDF}>
                    <Download size={18} /> Exportar PDF
                </button>
            </div>
        </div>
    );
}

function ImageToolbar({ applyImageStyle, handleDeleteImage }: { applyImageStyle: (s: React.CSSProperties) => void; handleDeleteImage: () => void }) {
    return (
        <div className="image-toolbar" style={{ display: 'flex', gap: '4px', padding: '6px', background: 'var(--color-primary-light)', border: '1px solid var(--color-primary)', boxShadow: '0 4px 12px rgba(37,99,235,0.15)', borderRadius: 'var(--radius-lg)', marginRight: 'var(--space-3)', animation: 'fadeIn 0.2s ease-out' }}>
            <div style={{ fontSize: '0.65rem', fontWeight: 800, padding: '0 8px', color: 'var(--color-primary)', textTransform: 'uppercase', alignSelf: 'center' }}>Imagem</div>
            <button title="Alinhar Esquerda" onClick={() => applyImageStyle({ textAlign: 'left' })} className="btn btn-sm btn-ghost" style={{ padding: '6px' }}>
                <div style={{ width: '12px', height: '2px', background: 'currentColor', marginBottom: '2px', marginRight: '4px' }}></div>
                <div style={{ width: '8px', height: '2px', background: 'currentColor', marginBottom: '2px', marginRight: '8px' }}></div>
                <div style={{ width: '12px', height: '2px', background: 'currentColor', marginRight: '4px' }}></div>
            </button>
            <button title="Centralizar" onClick={() => applyImageStyle({ textAlign: 'center' })} className="btn btn-sm btn-ghost" style={{ padding: '6px' }}>
                <div style={{ width: '12px', height: '2px', background: 'currentColor', marginBottom: '2px' }}></div>
                <div style={{ width: '8px', height: '2px', background: 'currentColor', marginBottom: '2px' }}></div>
                <div style={{ width: '12px', height: '2px', background: 'currentColor' }}></div>
            </button>
            <button title="Alinhar Direita" onClick={() => applyImageStyle({ textAlign: 'right' })} className="btn btn-sm btn-ghost" style={{ padding: '6px' }}>
                <div style={{ width: '12px', height: '2px', background: 'currentColor', marginBottom: '2px', marginLeft: '4px' }}></div>
                <div style={{ width: '8px', height: '2px', background: 'currentColor', marginBottom: '2px', marginLeft: '8px' }}></div>
                <div style={{ width: '12px', height: '2px', background: 'currentColor', marginLeft: '4px' }}></div>
            </button>
            <div style={{ width: '1px', background: 'var(--color-border)', margin: '0 4px' }} />
            <button title="Reduzir" onClick={() => applyImageStyle({ width: '30%' })} className="btn btn-sm btn-ghost" style={{ fontWeight: 800, minWidth: '32px' }}>P</button>
            <button title="Média" onClick={() => applyImageStyle({ width: '60%' })} className="btn btn-sm btn-ghost" style={{ fontWeight: 800, minWidth: '32px' }}>M</button>
            <button title="Largura Total" onClick={() => applyImageStyle({ width: '100%' })} className="btn btn-sm btn-ghost" style={{ fontWeight: 800, minWidth: '32px' }}>G</button>
            <div style={{ width: '1px', background: 'var(--color-border)', margin: '0 4px' }} />
            <button title="Excluir Imagem" onClick={handleDeleteImage} className="btn btn-sm btn-ghost" style={{ color: 'var(--color-danger)', padding: '6px' }}><Trash2 size={16} /></button>
        </div>
    );
}

function EmptyState() {
    return (
        <div className="empty-state--centered" style={{ textAlign: 'center', padding: 'var(--space-12)' }}>
            <div style={{ width: 100, height: 100, borderRadius: '50%', background: 'rgba(37,99,235,0.05)', border: '1px solid rgba(37,99,235,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 'var(--space-5)', margin: '0 auto var(--space-5)' }}>
                <ScrollText size={40} color="var(--color-primary)" strokeWidth={1.2} />
            </div>
            <h4 style={{ margin: '0 0 var(--space-2) 0', color: 'var(--color-text-primary)', fontWeight: 700, fontSize: 'var(--text-lg)' }}>Peça pronta em instantes</h4>
            <p style={{ maxWidth: '300px', fontSize: '0.875rem', color: 'var(--color-text-tertiary)', lineHeight: 1.6, margin: '0 auto' }}>Selecione um processo ao lado e deixe nossa IA especialista elaborar sua petição.</p>
        </div>
    );
}

function LoadingSkeleton() {
    return (
        <div style={{ width: '100%', maxWidth: '800px', background: 'white', padding: '60px', borderRadius: '4px', boxShadow: '0 4px 20px rgba(0,0,0,0.05)', height: 'fit-content' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                <div className="skeleton" style={{ height: '32px', width: '60%' }}></div>
                <div className="skeleton" style={{ height: '18px', width: '100%' }}></div>
                <div className="skeleton" style={{ height: '18px', width: '90%' }}></div>
                <div className="skeleton" style={{ height: '300px', width: '100%' }}></div>
                <div className="skeleton" style={{ height: '18px', width: '40%' }}></div>
            </div>
        </div>
    );
}
