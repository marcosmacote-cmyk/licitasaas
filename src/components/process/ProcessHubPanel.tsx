import { ScanSearch, Cpu, Loader2, Eye, ChevronRight, CheckCircle2, AlertTriangle, XCircle, FileText, DollarSign, FolderArchive, Gavel, Monitor, MessageSquare, PlusCircle, Edit3, Shield } from 'lucide-react';
import type { BiddingProcess, CompanyProfile, CompanyCredential, ObservationLog } from '../../types';

interface ProcessHubPanelProps {
    initialData: BiddingProcess | null;
    formData: Partial<BiddingProcess>;
    companies: CompanyProfile[];
    companyDocs: { name: string; docType: string; status: string; expirationDate: string; daysLeft?: number }[];
    credentials: CompanyCredential[];
    observations: ObservationLog[];
    newObservation: string;
    setNewObservation: (v: string) => void;
    handleAddObservation: () => void;
    isCheckingAi: boolean;
    aiAnalysisData: any;
    isEditMode: boolean;
    showAiModal: boolean;
    setShowAiModal: (v: boolean) => void;
    handleAiExtract: () => void;
    setHubTab: (tab: 'hub' | 'form') => void;
    onClose: () => void;
    onRequestAiAnalysis?: () => void;
    onNavigateToModule?: (module: string, processId?: string) => void;
    inputContainerStyle: React.CSSProperties;
    inputInnerStyle: React.CSSProperties;
    labelStyle: React.CSSProperties;
}

// ── Helpers ───────────────────────────────────────────────────

function parseJsonField(val: any): any[] {
    if (!val) return [];
    try { return typeof val === 'string' ? JSON.parse(val) : val; } catch { return []; }
}

// ── Sub-components ────────────────────────────────────────────

function CheckRow({ ok, label, detail, critical = false }: { ok: boolean; label: string; detail?: string; critical?: boolean }) {
    const Icon = ok ? CheckCircle2 : critical ? XCircle : AlertTriangle;
    const color = ok ? 'var(--color-success)' : critical ? 'var(--color-danger)' : 'var(--color-warning)';
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--color-border)' }}>
            <Icon size={14} color={color} style={{ flexShrink: 0 }} />
            <span style={{ fontSize: 'var(--text-md)', color: 'var(--color-text-primary)', flex: 1 }}>{label}</span>
            {detail && <span style={{ fontSize: 'var(--text-xs)', color: ok ? 'var(--color-success)' : color, fontWeight: 600, whiteSpace: 'nowrap' }}>{detail}</span>}
        </div>
    );
}

function DocPendency({ docType, status, daysLeft }: { docType: string; status: string; daysLeft?: number }) {
    const isCritical = status === 'Vencido';
    const color = isCritical ? 'var(--color-danger)' : 'var(--color-warning)';
    return (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: '1px solid var(--color-border)' }}>
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>{docType}</span>
            <span style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color, flexShrink: 0 }}>
                {status === 'Vencido' ? 'Vencido' : status === 'Crítico' ? 'Crítico' : `${daysLeft}d`}
            </span>
        </div>
    );
}

// ── Main ──────────────────────────────────────────────────────

export function ProcessHubPanel({
    initialData, formData, companies, companyDocs, credentials, observations,
    newObservation, setNewObservation, handleAddObservation,
    isCheckingAi, isEditMode,
    handleAiExtract, setHubTab,
    onClose, onRequestAiAnalysis, onNavigateToModule,
}: ProcessHubPanelProps) {
    if (!isEditMode) return null;

    const company = companies.find(c => c.id === formData.companyProfileId);

    // ── Aptidão computada ─────────────────────────────────────
    const expiredDocs = companyDocs.filter(d => d.status === 'Vencido' || d.status === 'Crítico');
    const validDocs = companyDocs.filter(d => d.status === 'Válido');
    const pendingDocs = companyDocs.filter(d => d.status !== 'Válido');
    const hasQual = !!company?.qualification;
    const hasTechQual = !!company?.technicalQualification;
    const hasCreds = credentials.length > 0;
    const docsOk = expiredDocs.length === 0 && companyDocs.length > 0;

    const aptidaoChecks = [
        { label: 'Habilitação jurídica', ok: hasQual, detail: hasQual ? 'Cadastrada' : 'Não informada', critical: !hasQual },
        { label: 'Qualificação técnica', ok: hasTechQual, detail: hasTechQual ? 'Cadastrada' : 'Não informada', critical: false },
        { label: 'Documentos vigentes', ok: docsOk, detail: companyDocs.length > 0 ? `${validDocs.length}/${companyDocs.length} válidos` : 'Nenhum', critical: expiredDocs.length > 0 },
        { label: 'Credenciais de portal', ok: hasCreds, detail: hasCreds ? `${credentials.length} cadastrada(s)` : 'Nenhuma', critical: false },
    ];

    const allOk = aptidaoChecks.every(c => c.ok);
    const someOk = aptidaoChecks.some(c => c.ok);
    const aptidaoStatus = !company ? null : allOk ? 'APTA' : someOk ? 'PARCIAL' : 'INAPTA';
    const aptidaoColor = allOk ? 'var(--color-success)' : someOk ? 'var(--color-warning)' : 'var(--color-danger)';

    // ── IA análise ────────────────────────────────────────────
    const ai = initialData?.aiAnalysis;
    const docsCount = ai ? parseJsonField(ai.requiredDocuments).length : 0;
    const flagsCount = ai ? parseJsonField(ai.irregularitiesFlags).length : 0;
    const deadlinesCount = ai ? parseJsonField(ai.deadlines).length : 0;
    const hasPdf = (formData.link || '').includes('/uploads/');

    // ── Quick actions ──────────────────────────────────────────
    const quickActions = [
        { icon: <ScanSearch size={15} />, label: 'Análise IA', color: 'var(--color-ai)', action: () => { onClose(); onNavigateToModule?.('intelligence', initialData?.id); } },
        { icon: <DollarSign size={15} />, label: 'Proposta', color: 'var(--color-primary)', action: () => { onClose(); onNavigateToModule?.('production-proposal', initialData?.id); } },
        { icon: <FolderArchive size={15} />, label: 'Dossiê', color: 'var(--color-urgency)', action: () => { onClose(); onNavigateToModule?.('production-dossier', initialData?.id); } },
        { icon: <FileText size={15} />, label: 'Declarações', color: 'var(--color-success)', action: () => { onClose(); onNavigateToModule?.('production-declaration', initialData?.id); } },
        { icon: <Gavel size={15} />, label: 'Petição', color: 'var(--color-warning)', action: () => { onClose(); onNavigateToModule?.('production-petition', initialData?.id); } },
        { icon: <Monitor size={15} />, label: 'Monitor', color: 'var(--color-text-secondary)', action: () => { onClose(); onNavigateToModule?.('monitoring', initialData?.id); } },
    ];

    return (
        <div style={{ padding: 'var(--space-5) var(--space-7)', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>

            {/* ═══ FAIXA DE DECISÃO ═══ */}
            {company && (
                <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: 'var(--space-4) var(--space-5)',
                    borderRadius: 'var(--radius-lg)',
                    background: `color-mix(in srgb, ${aptidaoColor} 7%, transparent)`,
                    border: `1px solid color-mix(in srgb, ${aptidaoColor} 25%, transparent)`,
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                        <Shield size={18} color={aptidaoColor} />
                        <div>
                            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)', fontWeight: 500, lineHeight: 1 }}>Posso participar?</div>
                            <div style={{ fontSize: 'var(--text-xl)', fontWeight: 800, color: aptidaoColor, lineHeight: 1.2, marginTop: 2 }}>
                                {aptidaoStatus}
                            </div>
                        </div>
                    </div>
                    {expiredDocs.length > 0 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 'var(--radius-md)', background: 'var(--color-danger-bg)', border: '1px solid rgba(239,68,68,0.2)' }}>
                            <XCircle size={14} color="var(--color-danger)" />
                            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-danger)', fontWeight: 700 }}>
                                {expiredDocs.length} doc{expiredDocs.length > 1 ? 's' : ''} vencido{expiredDocs.length > 1 ? 's' : ''}
                            </span>
                        </div>
                    )}
                    {!company && (
                        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)' }}>Selecione uma empresa</span>
                    )}
                </div>
            )}

            {/* ═══ CORPO PRINCIPAL: 2 colunas ═══ */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)', flex: 1 }}>

                {/* ── COLUNA ESQUERDA: LicitIA + Ações ── */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>

                    {/* LicitIA compacto */}
                    <div style={{
                        padding: 'var(--space-4)',
                        borderRadius: 'var(--radius-lg)',
                        background: ai ? 'var(--color-ai-bg)' : 'var(--color-bg-body)',
                        border: `1px solid ${ai ? 'var(--color-ai-border)' : 'var(--color-border)'}`,
                    }}>
                        {/* Header compacto */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: ai ? 'var(--space-3)' : 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <ScanSearch size={15} color={ai ? 'var(--color-ai)' : 'var(--color-text-tertiary)'} />
                                <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: ai ? 'var(--color-ai)' : 'var(--color-text-secondary)', letterSpacing: '-0.01em' }}>
                                    LicitIA
                                </span>
                                {ai?.overallConfidence && (
                                    <span style={{ padding: '1px 7px', borderRadius: 'var(--radius-full)', fontSize: 'var(--text-xs)', fontWeight: 700, background: ai.overallConfidence === 'alta' ? 'var(--color-success-bg)' : 'var(--color-warning-bg)', color: ai.overallConfidence === 'alta' ? 'var(--color-success)' : 'var(--color-warning)' }}>
                                        {ai.overallConfidence}
                                    </span>
                                )}
                            </div>
                            <div style={{ display: 'flex', gap: 6 }}>
                                {!ai && (
                                    <button type="button" onClick={handleAiExtract} disabled={isCheckingAi || !hasPdf} className="btn btn-primary" style={{ padding: '4px 12px', fontSize: 'var(--text-xs)', background: 'var(--color-ai)', borderColor: 'var(--color-ai)', display: 'flex', alignItems: 'center', gap: 4 }}>
                                        {isCheckingAi ? <Loader2 size={12} className="spinner" /> : <Cpu size={12} />}
                                        {isCheckingAi ? 'Analisando...' : 'Analisar'}
                                    </button>
                                )}
                                {(onRequestAiAnalysis || ai) && (
                                    <button type="button" onClick={() => { if (onRequestAiAnalysis) onRequestAiAnalysis(); }} className="btn btn-outline" style={{ padding: '4px 10px', fontSize: 'var(--text-xs)', color: 'var(--color-ai)', borderColor: 'var(--color-ai-border)', display: 'flex', alignItems: 'center', gap: 4 }}>
                                        <Eye size={12} /> Relatório
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Métricas inline */}
                        {ai ? (
                            <div style={{ display: 'flex', gap: 0, borderRadius: 'var(--radius-md)', overflow: 'hidden', border: '1px solid var(--color-ai-border)' }}>
                                {[
                                    { value: docsCount, label: 'Docs exigidos', color: 'var(--color-primary)' },
                                    { value: flagsCount, label: 'Red flags', color: flagsCount > 0 ? 'var(--color-danger)' : 'var(--color-success)' },
                                    { value: deadlinesCount, label: 'Prazos', color: 'var(--color-warning)' },
                                ].map((m, i) => (
                                    <div key={i} style={{ flex: 1, padding: '8px 10px', textAlign: 'center', borderRight: i < 2 ? '1px solid var(--color-ai-border)' : 'none', background: 'rgba(59,130,246,0.03)' }}>
                                        <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: m.color, lineHeight: 1 }}>{m.value}</div>
                                        <div style={{ fontSize: '0.65rem', color: 'var(--color-text-tertiary)', marginTop: 2, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{m.label}</div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', lineHeight: 1.5 }}>
                                {hasPdf ? 'Edital anexado. Clique em "Analisar" para obter insights automáticos.' : 'Anexe o edital (PDF) na aba Dados do Processo para habilitar a análise.'}
                            </p>
                        )}
                    </div>

                    {/* Ações rápidas — lista compacta */}
                    <div style={{ padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)', background: 'var(--color-bg-body)', border: '1px solid var(--color-border)' }}>
                        <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 'var(--space-2)' }}>
                            Abrir módulo
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                            {quickActions.map((a, i) => (
                                <button key={i} type="button" onClick={a.action}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 8,
                                        padding: '7px 8px', borderRadius: 'var(--radius-sm)',
                                        border: 'none', background: 'transparent', cursor: 'pointer',
                                        fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)',
                                        fontWeight: 500, textAlign: 'left', width: '100%',
                                        transition: 'background 0.15s',
                                    }}
                                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-bg-surface-hover)')}
                                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                                >
                                    <span style={{ color: a.color, display: 'flex', flexShrink: 0 }}>{a.icon}</span>
                                    <span style={{ flex: 1 }}>{a.label}</span>
                                    <ChevronRight size={12} color="var(--color-text-tertiary)" />
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* ── COLUNA DIREITA: Verificação unificada ── */}
                <div style={{ padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)', background: 'var(--color-bg-body)', border: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>

                    {/* Checklist de aptidão */}
                    <div>
                        <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>
                            O que está bloqueando?
                        </div>
                        {company ? (
                            <div>
                                {aptidaoChecks.map((c, i) => (
                                    <CheckRow key={i} ok={c.ok} label={c.label} detail={c.detail} critical={c.critical} />
                                ))}
                            </div>
                        ) : (
                            <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)', padding: 'var(--space-2) 0' }}>
                                Selecione uma empresa na aba Dados do Processo.
                            </p>
                        )}
                    </div>

                    {/* Pendências documentais */}
                    {company && companyDocs.length > 0 && pendingDocs.length > 0 && (
                        <div>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                                <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--color-danger)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                                    Pendências ({pendingDocs.length})
                                </div>
                                <button type="button" onClick={() => { onClose(); onNavigateToModule?.('companies'); }}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 'var(--text-xs)', color: 'var(--color-primary)', fontWeight: 600 }}>
                                    Regularizar →
                                </button>
                            </div>
                            <div style={{ maxHeight: 120, overflowY: 'auto' }}>
                                {pendingDocs.slice(0, 6).map((doc, i) => (
                                    <DocPendency key={i} docType={doc.docType} status={doc.status} daysLeft={doc.daysLeft} />
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Tudo ok */}
                    {company && companyDocs.length > 0 && pendingDocs.length === 0 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: 'var(--space-2) 0' }}>
                            <CheckCircle2 size={14} color="var(--color-success)" />
                            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-success)', fontWeight: 600 }}>Documentação em dia</span>
                        </div>
                    )}

                    {/* Spacer + Próximo passo */}
                    {company && (
                        <div style={{ marginTop: 'auto', paddingTop: 'var(--space-3)', borderTop: '1px solid var(--color-border)' }}>
                            <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>
                                Próximo passo recomendado
                            </div>
                            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)', lineHeight: 1.5 }}>
                                {!hasPdf
                                    ? 'Anexe o edital PDF para habilitar a análise automática da LicitIA.'
                                    : !ai
                                    ? 'Execute a análise do edital com LicitIA para identificar riscos e exigências.'
                                    : expiredDocs.length > 0
                                    ? 'Regularize os documentos vencidos antes de prosseguir com a proposta.'
                                    : !hasQual || !hasTechQual
                                    ? 'Complete o cadastro da empresa (habilitação e qualificação técnica).'
                                    : 'Empresa apta. Avance para Proposta ou Montagem de Dossiê.'}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* ═══ OBSERVAÇÕES — nível rebaixado ═══ */}
            <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: 'var(--space-3)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <MessageSquare size={12} color="var(--color-text-tertiary)" />
                        <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                            Observações {observations.length > 0 && `(${observations.length})`}
                        </span>
                    </div>
                    {observations.length > 0 && (
                        <button type="button" onClick={() => setHubTab('form')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 'var(--text-xs)', color: 'var(--color-primary)', fontWeight: 600 }}>
                            Ver todas →
                        </button>
                    )}
                </div>

                {observations.length > 0 && (
                    <div style={{ marginBottom: 'var(--space-2)', display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 80, overflowY: 'auto' }}>
                        {observations.slice(-2).reverse().map(obs => (
                            <div key={obs.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' }}>
                                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '80%' }}>{obs.text}</span>
                                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', flexShrink: 0 }}>{new Date(obs.timestamp).toLocaleDateString('pt-BR')}</span>
                            </div>
                        ))}
                    </div>
                )}

                <div style={{ display: 'flex', gap: 6 }}>
                    <input
                        value={newObservation}
                        onChange={e => setNewObservation(e.target.value)}
                        placeholder="Registrar observação..."
                        onKeyPress={e => e.key === 'Enter' && (e.preventDefault(), handleAddObservation())}
                        style={{
                            flex: 1, padding: '6px 10px', fontSize: 'var(--text-sm)',
                            border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
                            background: 'var(--color-bg-body)', color: 'var(--color-text-primary)',
                            outline: 'none',
                        }}
                    />
                    <button type="button" onClick={handleAddObservation} className="btn btn-outline"
                        style={{ padding: '6px 10px', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center' }}>
                        <PlusCircle size={14} />
                    </button>
                </div>
            </div>

            {/* ═══ FOOTER ═══ */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', paddingTop: 'var(--space-3)', borderTop: '1px solid var(--color-border)' }}>
                <button type="button" className="btn btn-ghost" onClick={() => setHubTab('form')} style={{ padding: 'var(--space-2) var(--space-4)', fontSize: 'var(--text-sm)', display: 'flex', alignItems: 'center', gap: 5, color: 'var(--color-text-secondary)' }}>
                    <Edit3 size={13} /> Editar dados
                </button>
                <button type="button" className="btn btn-outline" onClick={onClose} style={{ padding: 'var(--space-2) var(--space-5)', fontSize: 'var(--text-sm)' }}>
                    Fechar
                </button>
            </div>
        </div>
    );
}
