import { ScanSearch, Cpu, Loader2, Eye, ChevronRight, CheckCircle2, AlertTriangle, XCircle, FileText, DollarSign, FolderArchive, Gavel, Monitor, MessageSquare, PlusCircle, Edit3, Shield, FileWarning } from 'lucide-react';
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

// Label de seção uniforme
function SectionLabel({ children }: { children: React.ReactNode }) {
    return (
        <div style={{
            fontSize: '0.65rem', fontWeight: 700, color: 'var(--color-text-tertiary)',
            textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6,
        }}>
            {children}
        </div>
    );
}

function CheckRow({ ok, label, detail, critical = false }: { ok: boolean; label: string; detail?: string; critical?: boolean }) {
    const Icon = ok ? CheckCircle2 : critical ? XCircle : AlertTriangle;
    const color = ok ? 'var(--color-success)' : critical ? 'var(--color-danger)' : 'var(--color-warning)';
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid var(--color-border)' }}>
            <Icon size={13} color={color} style={{ flexShrink: 0 }} />
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)', flex: 1 }}>{label}</span>
            {detail && <span style={{ fontSize: '0.7rem', color: ok ? 'var(--color-success)' : color, fontWeight: 700, whiteSpace: 'nowrap' }}>{detail}</span>}
        </div>
    );
}

function DocPendency({ docType, status, daysLeft }: { docType: string; status: string; daysLeft?: number }) {
    const isCritical = status === 'Vencido';
    const color = isCritical ? 'var(--color-danger)' : 'var(--color-warning)';
    return (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0', borderBottom: '1px solid var(--color-border)' }}>
            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, paddingRight: 8 }}>{docType}</span>
            <span style={{ fontSize: '0.7rem', fontWeight: 700, color, flexShrink: 0 }}>
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
    const validDocs   = companyDocs.filter(d => d.status === 'Válido');
    const pendingDocs = companyDocs.filter(d => d.status !== 'Válido');
    const hasQual     = !!company?.qualification;
    const hasTechQual = !!company?.technicalQualification;
    const hasCreds    = credentials.length > 0;
    const docsOk      = expiredDocs.length === 0 && companyDocs.length > 0;

    const aptidaoChecks = [
        { label: 'Habilitação jurídica',  ok: hasQual,     detail: hasQual     ? 'Cadastrada'           : 'Não informada', critical: !hasQual },
        { label: 'Qualificação técnica',  ok: hasTechQual, detail: hasTechQual ? 'Cadastrada'           : 'Não informada', critical: false },
        { label: 'Documentos vigentes',   ok: docsOk,      detail: companyDocs.length > 0 ? `${validDocs.length}/${companyDocs.length} válidos` : 'Nenhum', critical: expiredDocs.length > 0 },
        { label: 'Credenciais de portal', ok: hasCreds,    detail: hasCreds    ? `${credentials.length} cadastrada(s)` : 'Nenhuma', critical: false },
    ];

    const allOk         = aptidaoChecks.every(c => c.ok);
    const someOk        = aptidaoChecks.some(c => c.ok);
    const blockers      = aptidaoChecks.filter(c => !c.ok);
    const aptidaoStatus = !company ? null : allOk ? 'APTA' : someOk ? 'PARCIAL' : 'INAPTA';
    const aptidaoColor  = allOk   ? 'var(--color-success)' : someOk ? 'var(--color-warning)' : 'var(--color-danger)';

    // ── IA análise ────────────────────────────────────────────
    const ai           = initialData?.aiAnalysis;
    const docsCount    = ai ? parseJsonField(ai.requiredDocuments).length : 0;
    const flagsCount   = ai ? parseJsonField(ai.irregularitiesFlags).length : 0;
    const deadlinesCount = ai ? parseJsonField(ai.deadlines).length : 0;
    const hasPdf       = (formData.link || '').includes('/uploads/');

    // ── Quick actions ──────────────────────────────────────────
    const quickActions = [
        { icon: <ScanSearch size={14} />, label: 'Análise IA',    color: 'var(--color-ai)',            action: () => { onClose(); onNavigateToModule?.('intelligence',          initialData?.id); } },
        { icon: <DollarSign size={14} />, label: 'Proposta',      color: 'var(--color-primary)',       action: () => { onClose(); onNavigateToModule?.('production-proposal',   initialData?.id); } },
        { icon: <FolderArchive size={14}/>,label: 'Dossiê',       color: 'var(--color-urgency)',       action: () => { onClose(); onNavigateToModule?.('production-dossier',    initialData?.id); } },
        { icon: <FileText size={14} />,   label: 'Declarações',   color: 'var(--color-success)',       action: () => { onClose(); onNavigateToModule?.('production-declaration',initialData?.id); } },
        { icon: <Gavel size={14} />,      label: 'Petição',       color: 'var(--color-warning)',       action: () => { onClose(); onNavigateToModule?.('production-petition',   initialData?.id); } },
        { icon: <Monitor size={14} />,    label: 'Monitor Chat',  color: 'var(--color-text-secondary)',action: () => { onClose(); onNavigateToModule?.('monitoring',             initialData?.id); } },
    ];

    // ── Próximo passo ──────────────────────────────────────────
    const nextStep = !hasPdf
        ? 'Anexe o edital PDF para habilitar a análise da LicitIA.'
        : !ai
        ? 'Execute a análise do edital para identificar riscos e exigências.'
        : expiredDocs.length > 0
        ? `Regularize ${expiredDocs.length} documento(s) vencido(s) antes de prosseguir.`
        : !hasQual || !hasTechQual
        ? 'Complete o cadastro da empresa (habilitação e qualificação técnica).'
        : 'Empresa apta. Avance para Proposta ou Montagem de Dossiê.';

    return (
        <div style={{ padding: 'var(--space-5) var(--space-8)', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>

            {/* ═══ FAIXA DE DECISÃO ═══ */}
            {company && (
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: 'auto 1fr auto',
                    alignItems: 'center',
                    gap: 'var(--space-4)',
                    padding: 'var(--space-3) var(--space-5)',
                    borderRadius: 'var(--radius-lg)',
                    background: `color-mix(in srgb, ${aptidaoColor} 6%, transparent)`,
                    border: `1px solid color-mix(in srgb, ${aptidaoColor} 22%, transparent)`,
                }}>
                    {/* Status principal */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <Shield size={20} color={aptidaoColor} />
                        <div>
                            <div style={{ fontSize: '0.65rem', color: 'var(--color-text-tertiary)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.07em', lineHeight: 1 }}>
                                Posso participar?
                            </div>
                            <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: aptidaoColor, lineHeight: 1.15, marginTop: 1 }}>
                                {aptidaoStatus}
                            </div>
                        </div>
                    </div>

                    {/* Sumário inline — aproveita largura */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, paddingLeft: 'var(--space-3)', borderLeft: `2px solid color-mix(in srgb, ${aptidaoColor} 20%, transparent)` }}>
                        {blockers.length === 0 ? (
                            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-success)', fontWeight: 600 }}>
                                Todos os critérios atendidos
                            </span>
                        ) : (
                            blockers.slice(0, 2).map((b, i) => (
                                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                    <div style={{ width: 5, height: 5, borderRadius: '50%', background: b.critical ? 'var(--color-danger)' : 'var(--color-warning)', flexShrink: 0 }} />
                                    <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)' }}>{b.label}: <strong style={{ color: b.critical ? 'var(--color-danger)' : 'var(--color-warning)' }}>{b.detail}</strong></span>
                                </div>
                            ))
                        )}
                        {blockers.length > 2 && (
                            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>
                                +{blockers.length - 2} outro(s) bloqueio(s)
                            </span>
                        )}
                    </div>

                    {/* Badge de impacto */}
                    {expiredDocs.length > 0 ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 'var(--radius-md)', background: 'var(--color-danger-bg)', border: '1px solid rgba(239,68,68,0.2)', flexShrink: 0 }}>
                            <FileWarning size={13} color="var(--color-danger)" />
                            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-danger)', fontWeight: 700, whiteSpace: 'nowrap' }}>
                                {expiredDocs.length} vencido{expiredDocs.length > 1 ? 's' : ''}
                            </span>
                        </div>
                    ) : aptidaoStatus === 'APTA' ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 10px', borderRadius: 'var(--radius-md)', background: 'var(--color-success-bg)', border: '1px solid rgba(34,197,94,0.2)', flexShrink: 0 }}>
                            <CheckCircle2 size={13} color="var(--color-success)" />
                            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-success)', fontWeight: 700 }}>Pronto</span>
                        </div>
                    ) : null}
                </div>
            )}

            {/* ═══ CORPO PRINCIPAL: 2 colunas ═══ */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)', flex: 1 }}>

                {/* ── COLUNA ESQUERDA: LicitIA + Ações ── */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>

                    {/* LicitIA */}
                    <div style={{
                        padding: 'var(--space-3) var(--space-4)',
                        borderRadius: 'var(--radius-lg)',
                        background: ai ? 'var(--color-ai-bg)' : 'var(--color-bg-body)',
                        border: `1px solid ${ai ? 'var(--color-ai-border)' : 'var(--color-border)'}`,
                    }}>
                        {/* Header: nome + badge confiança + botões — tudo numa linha */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: ai ? 'var(--space-3)' : 'var(--space-2)' }}>
                            <ScanSearch size={14} color={ai ? 'var(--color-ai)' : 'var(--color-text-tertiary)'} style={{ flexShrink: 0 }} />
                            <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: ai ? 'var(--color-ai)' : 'var(--color-text-secondary)' }}>
                                LicitIA
                            </span>
                            {ai?.overallConfidence && (
                                <span style={{
                                    padding: '1px 6px', borderRadius: 'var(--radius-full)',
                                    fontSize: '0.65rem', fontWeight: 700,
                                    background: ai.overallConfidence === 'alta' ? 'var(--color-success-bg)' : 'var(--color-warning-bg)',
                                    color: ai.overallConfidence === 'alta' ? 'var(--color-success)' : 'var(--color-warning)',
                                }}>
                                    {ai.overallConfidence}
                                </span>
                            )}
                            {/* Botões empurrados para direita */}
                            <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                                {!ai && (
                                    <button type="button" onClick={handleAiExtract}
                                        disabled={isCheckingAi || !hasPdf}
                                        className="btn btn-primary"
                                        style={{ padding: '3px 10px', fontSize: '0.7rem', background: 'var(--color-ai)', borderColor: 'var(--color-ai)', display: 'flex', alignItems: 'center', gap: 3, opacity: (!hasPdf && !isCheckingAi) ? 0.5 : 1 }}>
                                        {isCheckingAi ? <Loader2 size={11} className="spinner" /> : <Cpu size={11} />}
                                        {isCheckingAi ? 'Analisando...' : 'Analisar'}
                                    </button>
                                )}
                                {(onRequestAiAnalysis || ai) && (
                                    <button type="button" onClick={() => { if (onRequestAiAnalysis) onRequestAiAnalysis(); }}
                                        className="btn btn-outline"
                                        style={{ padding: '3px 9px', fontSize: '0.7rem', color: 'var(--color-ai)', borderColor: 'var(--color-ai-border)', display: 'flex', alignItems: 'center', gap: 3 }}>
                                        <Eye size={11} /> Relatório
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Métricas inline ou estado vazio */}
                        {ai ? (
                            <div style={{ display: 'flex', borderRadius: 'var(--radius-sm)', overflow: 'hidden', border: '1px solid var(--color-ai-border)' }}>
                                {[
                                    { value: docsCount,     label: 'Docs exigidos', color: 'var(--color-primary)' },
                                    { value: flagsCount,    label: 'Red flags',     color: flagsCount > 0 ? 'var(--color-danger)' : 'var(--color-success)' },
                                    { value: deadlinesCount,label: 'Prazos',        color: 'var(--color-warning)' },
                                ].map((m, i) => (
                                    <div key={i} style={{
                                        flex: 1, padding: '7px 6px', textAlign: 'center',
                                        borderRight: i < 2 ? '1px solid var(--color-ai-border)' : 'none',
                                        background: 'rgba(59,130,246,0.03)',
                                    }}>
                                        <div style={{ fontSize: 'var(--text-xl)', fontWeight: 800, color: m.color, lineHeight: 1 }}>{m.value}</div>
                                        <div style={{ fontSize: '0.6rem', color: 'var(--color-text-tertiary)', marginTop: 2, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{m.label}</div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', lineHeight: 1.5 }}>
                                {hasPdf
                                    ? 'Edital anexado. Clique em "Analisar" para obter insights.'
                                    : 'Anexe o edital (PDF) na aba Dados do Processo.'}
                            </p>
                        )}
                    </div>

                    {/* Ações rápidas — lista compacta */}
                    <div style={{ padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-lg)', background: 'var(--color-bg-body)', border: '1px solid var(--color-border)', flex: 1 }}>
                        <SectionLabel>Abrir módulo</SectionLabel>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                            {quickActions.map((a, i) => (
                                <button key={i} type="button" onClick={a.action}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: 7,
                                        padding: '6px 6px', borderRadius: 'var(--radius-sm)',
                                        border: 'none', background: 'transparent', cursor: 'pointer',
                                        fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)',
                                        fontWeight: 500, textAlign: 'left', width: '100%',
                                        transition: 'background 0.12s',
                                    }}
                                    onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-bg-surface-hover)')}
                                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                                >
                                    <span style={{ color: a.color, display: 'flex', flexShrink: 0 }}>{a.icon}</span>
                                    <span style={{ flex: 1 }}>{a.label}</span>
                                    <ChevronRight size={11} color="var(--color-text-tertiary)" />
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* ── COLUNA DIREITA: Verificação unificada ── */}
                <div style={{
                    padding: 'var(--space-3) var(--space-4)',
                    borderRadius: 'var(--radius-lg)',
                    background: 'var(--color-bg-body)',
                    border: '1px solid var(--color-border)',
                    display: 'flex', flexDirection: 'column', gap: 'var(--space-3)'
                }}>

                    {/* Checklist de aptidão */}
                    <div>
                        <SectionLabel>O que está bloqueando?</SectionLabel>
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
                    {company && pendingDocs.length > 0 && (
                        <div>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                                <SectionLabel>Pendências ({pendingDocs.length})</SectionLabel>
                                <button type="button"
                                    onClick={() => { onClose(); onNavigateToModule?.('companies'); }}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.7rem', color: 'var(--color-primary)', fontWeight: 600, marginTop: -4 }}>
                                    Regularizar →
                                </button>
                            </div>
                            <div style={{ maxHeight: 110, overflowY: 'auto' }}>
                                {pendingDocs.slice(0, 6).map((doc, i) => (
                                    <DocPendency key={i} docType={doc.docType} status={doc.status} daysLeft={doc.daysLeft} />
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Tudo ok */}
                    {company && companyDocs.length > 0 && pendingDocs.length === 0 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0' }}>
                            <CheckCircle2 size={13} color="var(--color-success)" />
                            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-success)', fontWeight: 600 }}>Documentação em dia</span>
                        </div>
                    )}

                    {/* Próximo passo — sempre visível se empresa selecionada */}
                    {company && (
                        <div style={{ marginTop: 'auto', paddingTop: 'var(--space-3)', borderTop: '1px solid var(--color-border)' }}>
                            <SectionLabel>Próximo passo</SectionLabel>
                            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)', lineHeight: 1.5 }}>
                                {nextStep}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* ═══ OBSERVAÇÕES — tratamento discreto ═══ */}
            <div style={{ borderTop: '1px dashed var(--color-border)', paddingTop: 'var(--space-2)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 'var(--space-2)' }}>
                    <MessageSquare size={11} color="var(--color-text-tertiary)" />
                    <span style={{ fontSize: '0.65rem', color: 'var(--color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 600 }}>
                        Observações{observations.length > 0 ? ` · ${observations.length}` : ''}
                    </span>
                    {observations.length > 0 && (
                        <button type="button" onClick={() => setHubTab('form')}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.65rem', color: 'var(--color-primary)', fontWeight: 600, marginLeft: 'auto' }}>
                            Ver todas →
                        </button>
                    )}
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                    <input
                        value={newObservation}
                        onChange={e => setNewObservation(e.target.value)}
                        placeholder={observations.length > 0 ? `Última: ${observations[observations.length - 1]?.text?.slice(0, 40)}...` : 'Registrar observação...'}
                        onKeyPress={e => e.key === 'Enter' && (e.preventDefault(), handleAddObservation())}
                        style={{
                            flex: 1, padding: '5px 10px', fontSize: 'var(--text-sm)',
                            border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
                            background: 'var(--color-bg-body)', color: 'var(--color-text-primary)',
                            outline: 'none',
                        }}
                    />
                    <button type="button" onClick={handleAddObservation} className="btn btn-outline"
                        style={{ padding: '5px 9px', borderRadius: 'var(--radius-md)', display: 'flex', alignItems: 'center' }}>
                        <PlusCircle size={13} />
                    </button>
                </div>
            </div>

            {/* ═══ FOOTER ═══ */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-2)', paddingTop: 'var(--space-2)', borderTop: '1px solid var(--color-border)' }}>
                <button type="button" className="btn btn-ghost" onClick={() => setHubTab('form')}
                    style={{ padding: 'var(--space-2) var(--space-4)', fontSize: 'var(--text-sm)', display: 'flex', alignItems: 'center', gap: 5, color: 'var(--color-text-secondary)' }}>
                    <Edit3 size={13} /> Editar dados
                </button>
                <button type="button" className="btn btn-outline" onClick={onClose}
                    style={{ padding: 'var(--space-2) var(--space-5)', fontSize: 'var(--text-sm)' }}>
                    Fechar
                </button>
            </div>
        </div>
    );
}
