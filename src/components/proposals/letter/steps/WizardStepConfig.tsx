import { Settings, Loader2, Save, ClipboardList, Plus, Trash2, FileSignature, ToggleLeft, ToggleRight, PenTool, Info, Landmark, Zap, ChevronRight, Building2 } from 'lucide-react';
import type { ProposalLetterWizardProps } from '../ProposalLetterWizard';
import type { useProposalWizard } from '../useProposalWizard';

export function WizardStepConfig({ p, w }: { p: ProposalLetterWizardProps, w: ReturnType<typeof useProposalWizard> }) {
    return (
        <div>
            <style>{`
                .premium-card {
                    background: var(--color-bg-elevated);
                    border: 1px solid var(--color-border);
                    border-radius: var(--radius-lg);
                    padding: var(--space-5);
                    margin-bottom: var(--space-5);
                    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
                    transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
                }
                .premium-card:hover {
                    transform: translateY(-2px);
                    box-shadow: 0 12px 20px -8px rgba(0, 0, 0, 0.08), 0 4px 20px rgba(0, 0, 0, 0.04);
                    border-color: rgba(99, 102, 241, 0.25);
                }
                .segmented-control {
                    display: inline-flex;
                    background: rgba(0, 0, 0, 0.04);
                    padding: 3px;
                    border-radius: var(--radius-lg);
                    border: 1px solid var(--color-border);
                }
                .segmented-button {
                    border: none;
                    background: transparent;
                    padding: 6px 16px;
                    font-size: 0.8rem;
                    font-weight: 600;
                    cursor: pointer;
                    border-radius: calc(var(--radius-lg) - 2px);
                    transition: all 0.2s;
                    color: var(--color-text-secondary);
                }
                .segmented-button.active {
                    background: var(--color-primary);
                    color: white;
                    box-shadow: 0 2px 8px rgba(37, 99, 235, 0.2);
                }
                .segmented-button:hover:not(.active) {
                    color: var(--color-text-primary);
                    background: rgba(0, 0, 0, 0.02);
                }
                .prop-input:focus {
                    border-color: var(--color-primary);
                    box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.15);
                    outline: none;
                }
                .signature-box {
                    padding: var(--space-3);
                    background: var(--color-bg-base);
                    border-radius: var(--radius-md);
                    border: 1px solid var(--color-border);
                    transition: all 0.2s ease;
                }
                .signature-box:focus-within {
                    border-color: var(--color-primary);
                    box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.05);
                }
            `}</style>

            <h3 style={{ margin: '0 0 var(--space-4)', fontSize: 'var(--text-lg)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Settings size={18} color="var(--color-primary)" /> Configuração Documental
            </h3>

            {/* ── Papel Timbrado e Identidade ── */}
            <div className="premium-card" style={{ borderLeft: '4px solid var(--color-primary)' }}>
                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 'var(--space-4)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Building2 size={16} color="var(--color-primary)" /> Papel Timbrado & Identidade Visual
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-5)' }}>
                    <div>
                        <span className="form-label">Cabeçalho (Timbrado Topo)</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                            <input type="file" accept="image/*" onChange={e => p.handleImageUpload(e, p.setHeaderImage)} style={{ fontSize: '0.75rem', flex: 1 }} />
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span style={{ fontSize: '0.7rem' }}>Alt:</span>
                                <input type="number" value={p.headerImageHeight} onChange={e => p.setHeaderImageHeight(Number(e.target.value))} style={{ width: '50px', padding: '2px', fontSize: '0.75rem' }} />
                            </div>
                            {p.headerImage && <button type="button" onClick={() => p.setHeaderImage('')} style={{ fontSize: 'var(--text-sm)', color: 'var(--color-danger)', background: 'none', border: 'none', cursor: 'pointer' }}>Remover</button>}
                        </div>
                        {p.headerImage && (
                            <div style={{ marginTop: 'var(--space-3)', border: '1px dashed var(--color-border)', padding: '4px', borderRadius: 'var(--radius-sm)', maxHeight: '80px', overflow: 'hidden', background: 'white' }}>
                                <img src={p.headerImage} alt="Header" style={{ width: '100%', height: 'auto', maxHeight: '70px', objectFit: 'contain' }} />
                            </div>
                        )}
                    </div>
                    <div>
                        <span className="form-label">Rodapé (Timbrado Base)</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                            <input type="file" accept="image/*" onChange={e => p.handleImageUpload(e, p.setFooterImage)} style={{ fontSize: '0.75rem', flex: 1 }} />
                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <span style={{ fontSize: '0.7rem' }}>Alt:</span>
                                <input type="number" value={p.footerImageHeight} onChange={e => p.setFooterImageHeight(Number(e.target.value))} style={{ width: '50px', padding: '2px', fontSize: '0.75rem' }} />
                            </div>
                            {p.footerImage && <button type="button" onClick={() => p.setFooterImage('')} style={{ fontSize: 'var(--text-sm)', color: 'var(--color-danger)', background: 'none', border: 'none', cursor: 'pointer' }}>Remover</button>}
                        </div>
                        {p.footerImage && (
                            <div style={{ marginTop: 'var(--space-3)', border: '1px dashed var(--color-border)', padding: '4px', borderRadius: 'var(--radius-sm)', maxHeight: '80px', overflow: 'hidden', background: 'white' }}>
                                <img src={p.footerImage} alt="Footer" style={{ width: '100%', height: 'auto', maxHeight: '70px', objectFit: 'contain' }} />
                            </div>
                        )}
                    </div>
                </div>
                <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '16px', marginTop: '16px', display: 'flex', justifyContent: 'flex-end' }}>
                    <button onClick={() => p.handleSaveCompanyTemplate()} disabled={p.isSavingTemplate} style={{
                        padding: '8px var(--space-4)', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-md)', fontWeight: 600,
                        background: 'var(--color-bg-base)', border: '1px solid var(--color-primary)',
                        color: 'var(--color-primary)', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                        transition: 'all 0.2s',
                    }}
                    onMouseEnter={e => {
                        e.currentTarget.style.background = 'var(--color-primary)';
                        e.currentTarget.style.color = 'white';
                    }}
                    onMouseLeave={e => {
                        e.currentTarget.style.background = 'var(--color-bg-base)';
                        e.currentTarget.style.color = 'var(--color-primary)';
                    }}
                    >
                        {p.isSavingTemplate ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
                        Salvar como Padrão da Empresa
                    </button>
                </div>
            </div>

            {/* ── Representantes & Assinaturas ── */}
            <div className="premium-card" style={{ borderLeft: '4px solid #F97316' }}>
                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 'var(--space-4)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <PenTool size={16} color="#F97316" /> Configuração Documental & Assinaturas
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
                    <div>
                        <label className="form-label" style={{ fontSize: '0.75rem' }}>Validade da Proposta (dias)</label>
                        <input type="number" value={p.validityDays}
                            onChange={e => p.setValidityDays(parseInt(e.target.value) || 60)}
                            className="prop-input" style={{ fontSize: '0.8rem' }} />
                    </div>
                    <div>
                        <label className="form-label" style={{ fontSize: '0.75rem' }}>Modelo de Assinatura</label>
                        <select value={p.signatureMode}
                            onChange={e => p.setSignatureMode(e.target.value as any)}
                            className="prop-input" style={{ padding: '6px 8px', fontSize: '0.8rem' }}>
                            <option value="LEGAL">Representante Legal</option>
                            <option value="TECH">Responsável Técnico</option>
                            <option value="BOTH">Ambos</option>
                        </select>
                    </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                    {/* Representante Legal */}
                    {(p.signatureMode === 'LEGAL' || p.signatureMode === 'BOTH') && (
                        <div className="signature-box">
                            <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--color-primary)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Representante Legal</div>
                            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--space-2)' }}>
                                <input value={p.sigLegal.name} onChange={e => p.setSigLegal({ ...p.sigLegal, name: e.target.value })} placeholder="Nome completo" className="prop-input" style={{ fontSize: '0.8rem' }} />
                                <input value={p.sigLegal.cpf} onChange={e => p.setSigLegal({ ...p.sigLegal, cpf: e.target.value })} placeholder="CPF" className="prop-input" style={{ fontSize: '0.8rem' }} />
                            </div>
                        </div>
                    )}

                    {/* Responsável Técnico */}
                    {(p.signatureMode === 'TECH' || p.signatureMode === 'BOTH') && (
                        <div className="signature-box">
                            <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#F97316', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Responsável Técnico</div>
                            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--space-2)' }}>
                                <input value={p.sigTech.name} onChange={e => p.setSigTech({ ...p.sigTech, name: e.target.value })} placeholder="Nome do responsável técnico" className="prop-input" style={{ fontSize: '0.8rem' }} />
                                <input value={p.sigTech.registration} onChange={e => p.setSigTech({ ...p.sigTech, registration: e.target.value })} placeholder="CREA/CAU/Registro" className="prop-input" style={{ fontSize: '0.8rem' }} />
                            </div>
                        </div>
                    )}

                    {/* Empresa */}
                    <div className="signature-box">
                        <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#8B5CF6', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Empresa</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--space-2)' }}>
                            <input value={p.sigCompany.razaoSocial} onChange={e => p.setSigCompany({ ...p.sigCompany, razaoSocial: e.target.value })} placeholder="Razão Social" className="prop-input" style={{ fontSize: '0.8rem' }} />
                            <input value={p.sigCompany.cnpj} onChange={e => p.setSigCompany({ ...p.sigCompany, cnpj: e.target.value })} placeholder="CNPJ" className="prop-input" style={{ fontSize: '0.8rem' }} />
                        </div>
                    </div>
                </div>
            </div>

            {/* ── DATA COCKPIT — Dados do Processo ── */}
            <div className="premium-card" style={{ borderLeft: '4px solid #6366F1' }}>
                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 'var(--space-4)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <ClipboardList size={16} color="#6366F1" /> Cockpit de Dados do Processo
                    <span style={{ fontSize: '0.65rem', fontWeight: 400, color: 'var(--color-text-tertiary)', marginLeft: 'auto' }}>
                        Variáveis de mesclagem na carta
                    </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
                    {/* Tipo de Proposta (Pílulas) */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <label className="form-label" style={{ fontSize: '0.75rem' }}>Tipo de Proposta</label>
                        <div>
                            <div className="segmented-control">
                                <button
                                    type="button"
                                    className={`segmented-button ${w.cockpit.proposalType !== 'READJUSTED' ? 'active' : ''}`}
                                    onClick={() => w.updateCockpit({ proposalType: 'INITIAL' })}
                                >
                                    Inicial
                                </button>
                                <button
                                    type="button"
                                    className={`segmented-button ${w.cockpit.proposalType === 'READJUSTED' ? 'active' : ''}`}
                                    onClick={() => w.updateCockpit({ proposalType: 'READJUSTED' })}
                                >
                                    Readequada (Pós-lance)
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Rótulo da Proposta */}
                    <div>
                        <label className="form-label" style={{ fontSize: '0.75rem' }}>Rótulo / Título do Documento</label>
                        <input type="text"
                            value={w.cockpit.proposalTitle}
                            onChange={e => w.updateCockpit({ proposalTitle: e.target.value })}
                            placeholder="Ex: PROPOSTA DE PREÇOS"
                            className="prop-input"
                            style={{ fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.02em' }}
                        />
                    </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
                    {/* Prazo de Execução */}
                    <div>
                        <label className="form-label" style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: 4 }}>
                            Prazo de Execução
                            {w.cockpit.executionDeadline && w.normalizedData?.execution?.executionDeadline && (
                                <span style={{
                                    fontSize: '0.6rem', padding: '1px 6px', borderRadius: '10px',
                                    background: 'rgba(99,102,241,0.1)', color: '#6366F1', fontWeight: 600,
                                }}>⚡ IA</span>
                            )}
                        </label>
                        <input type="text"
                            value={w.cockpit.executionDeadline}
                            onChange={e => w.updateCockpit({ executionDeadline: e.target.value })}
                            placeholder="Ex: 180 (cento e oitenta) dias corridos"
                            className="prop-input" style={{ fontSize: '0.8rem' }}
                        />
                    </div>

                    {/* Vigência Contratual */}
                    <div>
                        <label className="form-label" style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: 4 }}>
                            Vigência Contratual
                            {w.cockpit.contractDuration && w.normalizedData?.execution?.contractDuration && (
                                <span style={{
                                    fontSize: '0.6rem', padding: '1px 6px', borderRadius: '10px',
                                    background: 'rgba(99,102,241,0.1)', color: '#6366F1', fontWeight: 600,
                                }}>⚡ IA</span>
                            )}
                        </label>
                        <input type="text"
                            value={w.cockpit.contractDuration}
                            onChange={e => w.updateCockpit({ contractDuration: e.target.value })}
                            placeholder="Ex: 12 (doze) meses"
                            className="prop-input" style={{ fontSize: '0.8rem' }}
                        />
                    </div>

                    {/* Local de Execução */}
                    <div>
                        <label className="form-label" style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: 4 }}>
                            Local de Execução
                            {w.cockpit.executionLocation && w.normalizedData?.execution?.executionLocation && (
                                <span style={{
                                    fontSize: '0.6rem', padding: '1px 6px', borderRadius: '10px',
                                    background: 'rgba(99,102,241,0.1)', color: '#6366F1', fontWeight: 600,
                                }}>⚡ IA</span>
                            )}
                        </label>
                        <input type="text"
                            value={w.cockpit.executionLocation}
                            onChange={e => w.updateCockpit({ executionLocation: e.target.value })}
                            placeholder="Ex: Fortaleza/CE"
                            className="prop-input" style={{ fontSize: '0.8rem' }}
                        />
                    </div>

                    {/* Data do Documento */}
                    <div>
                        <label className="form-label" style={{ fontSize: '0.75rem' }}>
                            Data do Documento
                        </label>
                        <input type="date"
                            value={w.cockpit.proposalDate}
                            onChange={e => w.updateCockpit({ proposalDate: e.target.value })}
                            className="prop-input" style={{ fontSize: '0.8rem' }}
                        />
                        <span style={{ fontSize: '0.65rem', color: 'var(--color-text-tertiary)', marginTop: 2, display: 'block' }}>
                            Padrão: data de geração da carta
                        </span>
                    </div>
                </div>
            </div>

            {/* ── DECLARAÇÕES INLINE ── */}
            <div className="premium-card" style={{ borderLeft: '4px solid #F59E0B' }}>
                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 'var(--space-4)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <FileSignature size={16} color="#F59E0B" /> Declarações Integradas à Carta
                    <span style={{ fontSize: '0.65rem', fontWeight: 400, color: 'var(--color-text-tertiary)', marginLeft: 'auto' }}>
                        {w.declarations.filter(d => d.enabled).length}/{w.declarations.length} ativas
                    </span>
                </div>

                {w.declarations.length === 0 && (
                    <div style={{
                        padding: 'var(--space-4)', textAlign: 'center',
                        fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)',
                        borderRadius: 'var(--radius-md)', background: 'var(--color-bg-base)',
                        border: '1px dashed var(--color-border)',
                        marginBottom: 'var(--space-3)'
                    }}>
                        Nenhuma declaração exigida encontrada no edital.
                    </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                    {w.declarations.map(decl => (
                        <div key={decl.id} style={{
                            display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)',
                            padding: 'var(--space-3)',
                            borderRadius: 'var(--radius-md)',
                            background: decl.enabled ? 'rgba(245, 158, 11, 0.03)' : 'var(--color-bg-base)',
                            border: `1px solid ${decl.enabled ? 'rgba(245, 158, 11, 0.2)' : 'var(--color-border)'}`,
                            boxShadow: decl.enabled ? '0 2px 8px rgba(245, 158, 11, 0.04)' : 'none',
                            transition: 'all 0.2s',
                        }}>
                            {/* Toggle */}
                            <button
                                type="button"
                                onClick={() => w.toggleDeclaration(decl.id)}
                                style={{
                                    background: 'none', border: 'none', cursor: 'pointer',
                                    padding: '2px 0', flexShrink: 0, marginTop: 1,
                                    color: decl.enabled ? '#D97706' : 'var(--color-text-tertiary)',
                                    transition: 'transform 0.1s ease',
                                }}
                                onMouseDown={e => e.currentTarget.style.transform = 'scale(0.92)'}
                                onMouseUp={e => e.currentTarget.style.transform = 'scale(1)'}
                                title={decl.enabled ? 'Desativar' : 'Ativar'}
                            >
                                {decl.enabled
                                    ? <ToggleRight size={22} />
                                    : <ToggleLeft size={22} />
                                }
                            </button>

                            <div style={{ flex: 1, minWidth: 0 }}>
                                {/* Título editável */}
                                <input
                                    type="text"
                                    value={decl.title}
                                    onChange={e => w.updateDeclaration(decl.id, { title: e.target.value })}
                                    style={{
                                        background: 'transparent', border: 'none', outline: 'none',
                                        fontSize: '0.8rem', fontWeight: 700, width: '100%',
                                        color: decl.enabled ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.02em',
                                    }}
                                    placeholder="Título da declaração"
                                />

                                {/* Content preview/edit quando ativa */}
                                {decl.enabled && (
                                    <textarea
                                        value={decl.content}
                                        onChange={e => w.updateDeclaration(decl.id, { content: e.target.value })}
                                        placeholder="Texto da declaração (opcional — se vazio, será marcado para edição na revisão)"
                                        style={{
                                            width: '100%', minHeight: 60, resize: 'vertical',
                                            fontSize: '0.78rem', lineHeight: 1.5,
                                            marginTop: 'var(--space-2)',
                                            border: '1px solid var(--color-border)',
                                            borderRadius: 'var(--radius-sm)',
                                            padding: 'var(--space-2)',
                                            background: 'var(--color-bg-base)',
                                            color: 'var(--color-text-secondary)',
                                            fontFamily: 'inherit',
                                        }}
                                    />
                                )}

                                {/* Source badge */}
                                <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <span style={{
                                        fontSize: '0.62rem', fontWeight: 600,
                                        padding: '2px 8px', borderRadius: '10px',
                                        background: decl.source === 'edital' ? 'rgba(99, 102, 241, 0.08)' : 'rgba(107, 114, 128, 0.08)',
                                        color: decl.source === 'edital' ? '#6366F1' : 'var(--color-text-secondary)',
                                        display: 'inline-flex', alignItems: 'center', gap: 3,
                                    }}>
                                        {decl.source === 'edital' ? '⚡ Extraído do Edital' : '✏️ Criado Manualmente'}
                                    </span>
                                </div>
                            </div>

                            {/* Remove — apenas manuais */}
                            {decl.source === 'manual' && (
                                <button
                                    type="button"
                                    onClick={() => w.removeDeclaration(decl.id)}
                                    className="icon-btn"
                                    style={{ padding: 4, color: 'var(--color-danger)', flexShrink: 0, cursor: 'pointer', background: 'transparent', border: 'none' }}
                                    title="Remover declaração"
                                >
                                    <Trash2 size={14} />
                                </button>
                            )}
                        </div>
                    ))}
                </div>

                {/* Add manual */}
                <button
                    type="button"
                    onClick={() => w.addManualDeclaration()}
                    style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        marginTop: 'var(--space-3)', padding: '8px 16px',
                        fontSize: '0.78rem', fontWeight: 600,
                        borderRadius: 'var(--radius-md)',
                        border: '1px dashed #F59E0B',
                        background: 'transparent', cursor: 'pointer',
                        color: '#D97706', transition: 'all 0.2s',
                    }}
                    onMouseEnter={e => {
                        e.currentTarget.style.background = 'rgba(245, 158, 11, 0.05)';
                    }}
                    onMouseLeave={e => {
                        e.currentTarget.style.background = 'transparent';
                    }}
                >
                    <Plus size={14} /> Adicionar Declaração Manual
                </button>
            </div>

            {/* ── Dados Bancários ── */}
            <div className="premium-card" style={{ borderLeft: '4px solid #14B8A6' }}>
                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 'var(--space-4)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Landmark size={16} color="#14B8A6" /> Dados Bancários da Empresa
                    <span style={{ fontWeight: 400, color: 'var(--color-text-tertiary)', fontSize: '0.72rem' }}>
                        (Opcional — será anexado na carta se preenchido)
                    </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-3)' }}>
                    <div>
                        <label className="form-label" style={{ fontSize: '0.75rem' }}>Banco</label>
                        <input type="text" value={p.bankData.bank} placeholder="Ex: Banco do Brasil"
                            onChange={e => p.setBankData({ ...p.bankData, bank: e.target.value })}
                            className="prop-input" style={{ fontSize: '0.8rem' }} />
                    </div>
                    <div>
                        <label className="form-label" style={{ fontSize: '0.75rem' }}>Agência</label>
                        <input type="text" value={p.bankData.agency} placeholder="Ex: 1234-5"
                            onChange={e => p.setBankData({ ...p.bankData, agency: e.target.value })}
                            className="prop-input" style={{ fontSize: '0.8rem' }} />
                    </div>
                    <div>
                        <label className="form-label" style={{ fontSize: '0.75rem' }}>Conta Corrente / N°</label>
                        <input type="text" value={p.bankData.account} placeholder="Ex: 12345-6"
                            onChange={e => p.setBankData({ ...p.bankData, account: e.target.value })}
                            className="prop-input" style={{ fontSize: '0.8rem' }} />
                    </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)', marginTop: 'var(--space-3)' }}>
                    <div>
                        <label className="form-label" style={{ fontSize: '0.75rem' }}>Tipo de Conta</label>
                        <select value={p.bankData.accountType}
                            onChange={e => p.setBankData({ ...p.bankData, accountType: e.target.value })}
                            className="prop-input" style={{ padding: '6px 8px', fontSize: '0.8rem' }}>
                            <option value="Conta Corrente">Conta Corrente</option>
                            <option value="Conta Poupança">Conta Poupança</option>
                        </select>
                    </div>
                    <div>
                        <label className="form-label" style={{ fontSize: '0.75rem' }}>Chave PIX (opcional)</label>
                        <input type="text" value={p.bankData.pix} placeholder="CNPJ, e-mail, telefone ou chave Pix aleatória"
                            onChange={e => p.setBankData({ ...p.bankData, pix: e.target.value })}
                            className="prop-input" style={{ fontSize: '0.8rem' }} />
                    </div>
                </div>
            </div>

            {/* ── Resumo de Dados ── */}
            <div className="premium-card" style={{ borderLeft: '4px solid #6B7280' }}>
                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--color-text-primary)', marginBottom: 'var(--space-4)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Info size={16} color="#6B7280" /> Resumo Metadados do Orçamento
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', fontSize: 'var(--text-sm)' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div><strong style={{ color: 'var(--color-text-secondary)' }}>Razão Social:</strong> <span style={{ color: 'var(--color-text-primary)' }}>{p.company.razaoSocial}</span></div>
                        <div><strong style={{ color: 'var(--color-text-secondary)' }}>CNPJ da Empresa:</strong> <span style={{ color: 'var(--color-text-primary)' }}>{p.company.cnpj}</span></div>
                        <div><strong style={{ color: 'var(--color-text-secondary)' }}>Processo Licitatório:</strong> <span style={{ color: 'var(--color-text-primary)' }}>{p.bidding.modality} — {p.bidding.title?.substring(0, 60)}</span></div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <div><strong style={{ color: 'var(--color-text-secondary)' }}>Valor Total Calculado:</strong> <span style={{ color: 'var(--color-text-primary)', fontWeight: 700 }}>{p.totalValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span></div>
                        <div><strong style={{ color: 'var(--color-text-secondary)' }}>Itens do Escopo:</strong> <span style={{ color: 'var(--color-text-primary)' }}>{p.items.length} itens adaptados</span></div>
                        <div><strong style={{ color: 'var(--color-text-secondary)' }}>Parâmetros:</strong> <span style={{ color: 'var(--color-text-primary)' }}>BDI: {p.bdi}% | Desconto Global: {p.discount}%</span></div>
                    </div>
                </div>
            </div>

            {/* ── Ações Finais ── */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)', marginTop: 'var(--space-5)', borderTop: '1px solid var(--color-border)', paddingTop: '20px' }}>
                <button onClick={async () => {
                    import('../ProposalLetterValidator').then(({ ProposalLetterValidator }) => {
                        const validator = new ProposalLetterValidator();
                        const result = validator.validate(w.normalizedData);
                        w.setStep('validation');
                        if (result.isValid) {
                            w.handleGenerate();
                        }
                    });
                }} style={{
                    padding: '10px 24px', borderRadius: 'var(--radius-lg)',
                    background: 'linear-gradient(135deg, var(--color-ai), var(--color-primary))',
                    color: 'white', border: 'none',
                    fontWeight: 700, fontSize: 'var(--text-md)', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 8,
                    opacity: w.isGenerating ? 0.6 : 1,
                    transition: 'all 0.2s',
                    boxShadow: '0 4px 12px rgba(124, 58, 237, 0.15)',
                }}
                disabled={w.isGenerating}
                onMouseEnter={e => {
                    e.currentTarget.style.transform = 'translateY(-1px)';
                    e.currentTarget.style.boxShadow = '0 6px 16px rgba(124, 58, 237, 0.25)';
                }}
                onMouseLeave={e => {
                    e.currentTarget.style.transform = 'none';
                    e.currentTarget.style.boxShadow = '0 4px 12px rgba(124, 58, 237, 0.15)';
                }}
                >
                    {w.isGenerating ? <Loader2 size={16} className="spin" /> : <Zap size={16} />}
                    Gerar Rápido
                </button>
                <button onClick={w.handleValidate} style={{
                    padding: '10px 28px', borderRadius: 'var(--radius-lg)',
                    background: 'var(--color-primary)', color: 'white', border: 'none',
                    fontWeight: 700, fontSize: 'var(--text-md)', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 8,
                    transition: 'all 0.2s',
                    boxShadow: '0 4px 12px rgba(37, 99, 235, 0.15)',
                }}
                onMouseEnter={e => {
                    e.currentTarget.style.transform = 'translateY(-1px)';
                    e.currentTarget.style.boxShadow = '0 6px 16px rgba(37, 99, 235, 0.25)';
                }}
                onMouseLeave={e => {
                    e.currentTarget.style.transform = 'none';
                    e.currentTarget.style.boxShadow = '0 4px 12px rgba(37, 99, 235, 0.15)';
                }}
                >
                    Validar dados <ChevronRight size={16} />
                </button>
            </div>
        </div>
    );
}

