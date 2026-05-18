import { Settings, Loader2, Save, ClipboardList, Plus, Trash2, FileSignature, ToggleLeft, ToggleRight, PenTool, Info, Landmark, Zap, ChevronRight } from 'lucide-react';
import type { ProposalLetterWizardProps } from '../ProposalLetterWizard';
import type { useProposalWizard } from '../useProposalWizard';

export function WizardStepConfig({ p, w }: { p: ProposalLetterWizardProps, w: ReturnType<typeof useProposalWizard> }) {
    return (
        <div>
            <h3 style={{ margin: '0 0 var(--space-4)', fontSize: 'var(--text-lg)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Settings size={18} color="var(--color-primary)" /> Configuração Documental
            </h3>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-5)', marginBottom: 'var(--space-5)' }}>
                <div>
                    <label className="form-label">Validade da Proposta (dias)</label>
                    <input type="number" value={p.validityDays}
                        onChange={e => p.setValidityDays(parseInt(e.target.value) || 60)}
                        className="prop-input" />
                </div>
                <div>
                    <label className="form-label">Modelo de Assinatura</label>
                    <select value={p.signatureMode}
                        onChange={e => p.setSignatureMode(e.target.value as any)}
                        className="prop-input" style={{ padding: '6px 8px' }}>
                        <option value="LEGAL">Representante Legal</option>
                        <option value="TECH">Responsável Técnico</option>
                        <option value="BOTH">Ambos</option>
                    </select>
                </div>
            </div>

            {/* ── Dados de Assinatura Editáveis ── */}
            <div style={{
                background: 'rgba(51, 65, 133, 0.04)', padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)',
                border: '1px solid rgba(51, 65, 133, 0.15)', marginBottom: 'var(--space-4)',
            }}>
                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: '#334155', marginBottom: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <PenTool size={14} /> Dados de Assinatura
                </div>

                {/* Representante Legal */}
                {(p.signatureMode === 'LEGAL' || p.signatureMode === 'BOTH') && (
                    <div style={{ marginBottom: 'var(--space-3)', padding: 'var(--space-3)', background: 'var(--color-bg-base)', borderRadius: 'var(--radius-md)', border: 'none', boxShadow: '0 0 0 1px var(--color-border)' }}>
                        <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--color-primary)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Representante Legal</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--space-2)' }}>
                            <input value={p.sigLegal.name} onChange={e => p.setSigLegal({ ...p.sigLegal, name: e.target.value })} placeholder="Nome completo" className="prop-input" style={{ fontSize: '0.8rem' }} />
                            <input value={p.sigLegal.cpf} onChange={e => p.setSigLegal({ ...p.sigLegal, cpf: e.target.value })} placeholder="CPF" className="prop-input" style={{ fontSize: '0.8rem' }} />
                        </div>
                    </div>
                )}

                {/* Responsável Técnico */}
                {(p.signatureMode === 'TECH' || p.signatureMode === 'BOTH') && (
                    <div style={{ marginBottom: 'var(--space-3)', padding: 'var(--space-3)', background: 'var(--color-bg-base)', borderRadius: 'var(--radius-md)', border: 'none', boxShadow: '0 0 0 1px var(--color-border)' }}>
                        <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#F97316', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Responsável Técnico</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--space-2)' }}>
                            <input value={p.sigTech.name} onChange={e => p.setSigTech({ ...p.sigTech, name: e.target.value })} placeholder="Nome do responsável técnico" className="prop-input" style={{ fontSize: '0.8rem' }} />
                            <input value={p.sigTech.registration} onChange={e => p.setSigTech({ ...p.sigTech, registration: e.target.value })} placeholder="CREA/CAU/Registro" className="prop-input" style={{ fontSize: '0.8rem' }} />
                        </div>
                    </div>
                )}

                {/* Empresa */}
                <div style={{ padding: 'var(--space-3)', background: 'var(--color-bg-base)', borderRadius: 'var(--radius-md)', border: 'none', boxShadow: '0 0 0 1px var(--color-border)' }}>
                    <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#8B5CF6', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Empresa</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--space-2)' }}>
                        <input value={p.sigCompany.razaoSocial} onChange={e => p.setSigCompany({ ...p.sigCompany, razaoSocial: e.target.value })} placeholder="Razão Social" className="prop-input" style={{ fontSize: '0.8rem' }} />
                        <input value={p.sigCompany.cnpj} onChange={e => p.setSigCompany({ ...p.sigCompany, cnpj: e.target.value })} placeholder="CNPJ" className="prop-input" style={{ fontSize: '0.8rem' }} />
                    </div>
                </div>
            </div>

            {/* Header/Footer uploads */}
            <div style={{
                background: 'var(--color-primary-light)', padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)',
                border: '1px solid rgba(37, 99, 235, 0.1)', marginBottom: 'var(--space-4)',
            }}>
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
                <div style={{ borderTop: '1px solid rgba(37, 99, 235, 0.1)', paddingTop: '12px', marginTop: '12px', display: 'flex', justifyContent: 'flex-end' }}>
                    <button onClick={() => p.handleSaveCompanyTemplate()} disabled={p.isSavingTemplate} style={{
                        padding: '6px var(--space-4)', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-md)', fontWeight: 600,
                        background: 'var(--color-bg-base)', border: '1px solid var(--color-primary)',
                        color: 'var(--color-primary)', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                    }}>
                        {p.isSavingTemplate ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
                        Salvar como Padrão da Empresa
                    </button>
                </div>
            </div>

            {/* ── DATA COCKPIT — Dados do Processo ── */}
            <div style={{
                background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.04), rgba(139, 92, 246, 0.03))',
                padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)',
                border: '1px solid rgba(99, 102, 241, 0.15)', marginBottom: 'var(--space-4)',
            }}>
                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: '#6366F1', marginBottom: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <ClipboardList size={14} /> Dados do Processo
                    <span style={{ fontSize: '0.65rem', fontWeight: 400, color: 'var(--color-text-tertiary)', marginLeft: 'auto' }}>
                        Campos usados diretamente na carta proposta
                    </span>
                </div>

                {/* Rótulo da Proposta */}
                <div style={{ marginBottom: 'var(--space-3)' }}>
                    <label className="form-label" style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: 4 }}>
                        Rótulo / Título da Proposta
                    </label>
                    <input type="text"
                        value={w.cockpit.proposalTitle}
                        onChange={e => w.updateCockpit({ proposalTitle: e.target.value })}
                        placeholder="Ex: PROPOSTA DE PREÇOS"
                        className="prop-input"
                        style={{ fontSize: '0.85rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.02em' }}
                    />
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


            {/* Data summary */}
            <div style={{
                background: 'var(--color-bg-elevated)', padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)',
                border: 'none', boxShadow: '0 0 0 1px var(--color-border)', marginBottom: 'var(--space-4)',
            }}>
                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--color-text-secondary)', marginBottom: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Info size={14} /> Resumo dos dados que serão usados na carta
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)', fontSize: 'var(--text-sm)' }}>
                    <div><strong>Empresa:</strong> {p.company.razaoSocial}</div>
                    <div><strong>CNPJ:</strong> {p.company.cnpj}</div>
                    <div><strong>Processo:</strong> {p.bidding.modality} — {p.bidding.title?.substring(0, 60)}</div>
                    <div><strong>Valor:</strong> {p.totalValue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</div>
                    <div><strong>Itens:</strong> {p.items.length}</div>
                    <div><strong>BDI:</strong> {p.bdi}% | <strong>Desconto:</strong> {p.discount}%</div>
                </div>
            </div>

            {/* ── DECLARAÇÕES INLINE ── */}
            <div style={{
                background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.04), rgba(234, 88, 12, 0.03))',
                padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)',
                border: '1px solid rgba(245, 158, 11, 0.15)', marginBottom: 'var(--space-4)',
            }}>
                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: '#D97706', marginBottom: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <FileSignature size={14} /> Declarações na Carta
                    <span style={{ fontSize: '0.65rem', fontWeight: 400, color: 'var(--color-text-tertiary)', marginLeft: 'auto' }}>
                        {w.declarations.filter(d => d.enabled).length}/{w.declarations.length} ativas
                    </span>
                </div>

                {w.declarations.length === 0 && (
                    <div style={{
                        padding: 'var(--space-3)', textAlign: 'center',
                        fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)',
                        borderRadius: 'var(--radius-md)', background: 'rgba(245,158,11,0.04)',
                        border: '1px dashed rgba(245,158,11,0.2)',
                    }}>
                        Nenhuma declaração exigida encontrada no edital.
                    </div>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                    {w.declarations.map(decl => (
                        <div key={decl.id} style={{
                            display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)',
                            padding: 'var(--space-2) var(--space-3)',
                            borderRadius: 'var(--radius-md)',
                            background: decl.enabled ? 'rgba(245,158,11,0.06)' : 'var(--color-bg-body)',
                            border: `1px solid ${decl.enabled ? 'rgba(245,158,11,0.2)' : 'var(--color-border)'}`,
                            transition: 'all 0.15s',
                        }}>
                            {/* Toggle */}
                            <button
                                type="button"
                                onClick={() => w.toggleDeclaration(decl.id)}
                                style={{
                                    background: 'none', border: 'none', cursor: 'pointer',
                                    padding: '2px 0', flexShrink: 0, marginTop: 1,
                                    color: decl.enabled ? '#D97706' : 'var(--color-text-tertiary)',
                                }}
                                title={decl.enabled ? 'Desativar' : 'Ativar'}
                            >
                                {decl.enabled
                                    ? <ToggleRight size={20} />
                                    : <ToggleLeft size={20} />
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
                                        fontSize: '0.78rem', fontWeight: 600, width: '100%',
                                        color: decl.enabled ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
                                        textTransform: 'uppercase',
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
                                            width: '100%', minHeight: 44, resize: 'vertical',
                                            fontSize: '0.72rem', lineHeight: 1.5,
                                            marginTop: 'var(--space-1)',
                                            border: '1px solid rgba(245,158,11,0.15)',
                                            borderRadius: 'var(--radius-sm)',
                                            padding: 'var(--space-1) var(--space-2)',
                                            background: 'rgba(255,255,255,0.5)',
                                            color: 'var(--color-text-secondary)',
                                        }}
                                    />
                                )}

                                {/* Source badge */}
                                <span style={{
                                    fontSize: '0.58rem', fontWeight: 600,
                                    color: decl.source === 'edital' ? '#6366F1' : 'var(--color-text-tertiary)',
                                    display: 'inline-flex', alignItems: 'center', gap: 2,
                                    marginTop: 1,
                                }}>
                                    {decl.source === 'edital' ? '⚡ Edital' : '✏️ Manual'}
                                </span>
                            </div>

                            {/* Remove — apenas manuais */}
                            {decl.source === 'manual' && (
                                <button
                                    type="button"
                                    onClick={() => w.removeDeclaration(decl.id)}
                                    className="icon-btn"
                                    style={{ padding: 2, color: 'var(--color-danger)', flexShrink: 0 }}
                                    title="Remover declaração"
                                >
                                    <Trash2 size={13} />
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
                        display: 'flex', alignItems: 'center', gap: 4,
                        marginTop: 'var(--space-2)', padding: '6px 12px',
                        fontSize: '0.72rem', fontWeight: 600,
                        borderRadius: 'var(--radius-md)',
                        border: '1px dashed rgba(245,158,11,0.3)',
                        background: 'transparent', cursor: 'pointer',
                        color: '#D97706', transition: 'all 0.15s',
                    }}
                >
                    <Plus size={13} /> Adicionar Declaração
                </button>
            </div>

            {/* Dados Bancários */}
            <div style={{
                background: 'rgba(20, 184, 166, 0.04)', padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)',
                border: '1px solid rgba(20, 184, 166, 0.15)',
            }}>
                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: '#14B8A6', marginBottom: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Landmark size={14} /> Dados Bancários <span style={{ fontWeight: 400, color: 'var(--color-text-tertiary)', fontSize: '0.75rem' }}>(opcional — aparecerá na carta se preenchido)</span>
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
                        <label className="form-label" style={{ fontSize: '0.75rem' }}>Conta</label>
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
                        <label className="form-label" style={{ fontSize: '0.75rem' }}>Chave PIX</label>
                        <input type="text" value={p.bankData.pix} placeholder="CNPJ, e-mail, telefone ou chave aleatória"
                            onChange={e => p.setBankData({ ...p.bankData, pix: e.target.value })}
                            className="prop-input" style={{ fontSize: '0.8rem' }} />
                    </div>
                </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)', marginTop: 'var(--space-5)' }}>
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
                    padding: 'var(--space-2) var(--space-5)', borderRadius: 'var(--radius-lg)',
                    background: 'linear-gradient(135deg, var(--color-ai), var(--color-primary))',
                    color: 'white', border: 'none',
                    fontWeight: 700, fontSize: 'var(--text-md)', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 8,
                    opacity: w.isGenerating ? 0.6 : 1,
                }} disabled={w.isGenerating}>
                    {w.isGenerating ? <Loader2 size={16} className="spin" /> : <Zap size={16} />}
                    Gerar Rápido
                </button>
                <button onClick={w.handleValidate} style={{
                    padding: 'var(--space-2) var(--space-6)', borderRadius: 'var(--radius-lg)',
                    background: 'var(--color-primary)', color: 'white', border: 'none',
                    fontWeight: 700, fontSize: 'var(--text-md)', cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 8,
                }}>
                    Validar dados <ChevronRight size={16} />
                </button>
            </div>
        </div>
    );
}
