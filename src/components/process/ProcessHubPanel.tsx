import { Brain, Bot, Eye, CheckCircle, Loader2, FileText, Shield, MessageSquare, PlusCircle, DollarSign, FileArchive, Sparkles, Scale, Monitor } from 'lucide-react';
import {
    DocumentStatusRow, ReadinessPanel,
    QuickAction, SectionDivider, AiMetric,
} from '../ui';
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
    // Style objects from parent (ProcessFormModal still needs these for spread overrides)
    inputContainerStyle: React.CSSProperties;
    inputInnerStyle: React.CSSProperties;
    labelStyle: React.CSSProperties;
}

export function ProcessHubPanel({
    initialData, formData, companies, companyDocs, credentials, observations,
    newObservation, setNewObservation, handleAddObservation,
    isCheckingAi, aiAnalysisData, isEditMode,
    handleAiExtract, setHubTab,
    onClose, onRequestAiAnalysis, onNavigateToModule,
    inputContainerStyle, inputInnerStyle, labelStyle,
}: ProcessHubPanelProps) {
    if (!isEditMode) return null;

    return (
        <div style={{ padding: 'var(--space-6) var(--space-8)', overflowY: 'auto', flex: 1 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-5)' }}>

                {/* ── LicitIA Integration ── */}
                <div style={{
                    gridColumn: '1 / -1',
                    padding: 'var(--space-5)',
                    borderRadius: 'var(--radius-xl)',
                    background: initialData?.aiAnalysis ? 'var(--color-ai-bg)' : 'var(--color-bg-body)',
                    border: `1px solid ${initialData?.aiAnalysis ? 'var(--color-ai-border)' : 'var(--color-border)'}`,
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                            <Brain size={18} color={initialData?.aiAnalysis ? 'var(--color-ai)' : 'var(--color-text-tertiary)'} />
                            <span style={{ fontWeight: 'var(--font-bold)', fontSize: 'var(--text-base)', color: initialData?.aiAnalysis ? 'var(--color-ai)' : 'var(--color-text-secondary)' }}>
                                LicitIA — Análise de Edital
                            </span>
                            {initialData?.aiAnalysis?.overallConfidence && (
                                <span style={{
                                    padding: '2px 8px', borderRadius: 'var(--radius-full)', fontSize: 'var(--text-xs)', fontWeight: 'var(--font-bold)',
                                    background: initialData.aiAnalysis.overallConfidence === 'alta' ? 'var(--color-success-bg)' : 'var(--color-warning-bg)',
                                    color: initialData.aiAnalysis.overallConfidence === 'alta' ? 'var(--color-success)' : 'var(--color-warning)',
                                }}>
                                    Confiança: {initialData.aiAnalysis.overallConfidence}
                                </span>
                            )}
                        </div>
                        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                            {!initialData?.aiAnalysis && (
                                <button type="button" onClick={handleAiExtract} disabled={isCheckingAi} className="btn btn-primary" style={{
                                    padding: 'var(--space-2) var(--space-4)', fontSize: 'var(--text-sm)',
                                    background: 'var(--color-ai)', borderColor: 'var(--color-ai)',
                                    display: 'flex', alignItems: 'center', gap: '6px',
                                }}>
                                    {isCheckingAi ? <Loader2 size={14} className="spinner" /> : <Bot size={14} />}
                                    {isCheckingAi ? 'Analisando...' : 'Analisar Edital'}
                                </button>
                            )}
                            {(onRequestAiAnalysis || initialData?.aiAnalysis) && (
                                <button type="button" onClick={() => {
                                    if (onRequestAiAnalysis) onRequestAiAnalysis();
                                    else if (aiAnalysisData) {} // handled by parent
                                }} className="btn btn-outline" style={{
                                    padding: 'var(--space-2) var(--space-4)', fontSize: 'var(--text-sm)',
                                    color: 'var(--color-ai)', borderColor: 'var(--color-ai-border)',
                                    display: 'flex', alignItems: 'center', gap: '6px',
                                }}>
                                    <Eye size={14} /> Ver Relatório
                                </button>
                            )}
                        </div>
                    </div>
                    {initialData?.aiAnalysis ? (
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-3)' }}>
                            {(() => {
                                const a = initialData.aiAnalysis;
                                let docsCount = 0;
                                try { docsCount = (typeof a.requiredDocuments === 'string' ? JSON.parse(a.requiredDocuments) : a.requiredDocuments || []).length; } catch { docsCount = 0; }
                                let flagsCount = 0;
                                try { flagsCount = (typeof a.irregularitiesFlags === 'string' ? JSON.parse(a.irregularitiesFlags) : a.irregularitiesFlags || []).length; } catch { flagsCount = 0; }
                                let deadlinesCount = 0;
                                try { deadlinesCount = (typeof a.deadlines === 'string' ? JSON.parse(a.deadlines) : a.deadlines || []).length; } catch { deadlinesCount = 0; }
                                return (
                                    <>
                                        <AiMetric value={docsCount} label="Docs exigidos" color="var(--color-primary)" />
                                        <AiMetric value={flagsCount} label="Alertas / Red flags" color={flagsCount > 0 ? 'var(--color-danger)' : 'var(--color-success)'} />
                                        <AiMetric value={deadlinesCount} label="Prazos identificados" color="var(--color-warning)" />
                                    </>
                                );
                            })()}
                        </div>
                    ) : (
                        <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)' }}>
                            Nenhuma análise realizada. Anexe o edital (PDF) e clique em "Analisar Edital" para obter insights automáticos.
                        </p>
                    )}
                </div>

                {/* ── Document Readiness ── */}
                <div style={{
                    padding: 'var(--space-5)',
                    borderRadius: 'var(--radius-xl)',
                    background: 'var(--color-bg-body)',
                    border: '1px solid var(--color-border)',
                }}>
                    <SectionDivider
                        icon={<FileText size={16} color="var(--color-text-tertiary)" />}
                        title="Pendências Documentais"
                        action={<button type="button" onClick={() => { onClose(); onNavigateToModule?.('companies'); }} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 'var(--text-xs)', color: 'var(--color-primary)', fontWeight: 'var(--font-semibold)' }}>Gerenciar →</button>}
                    />
                    {formData.companyProfileId ? (
                        companyDocs.length > 0 ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', maxHeight: 180, overflowY: 'auto' }}>
                                {companyDocs
                                    .filter(d => d.status !== 'Válido')
                                    .sort((a, b) => (a.daysLeft || 999) - (b.daysLeft || 999))
                                    .slice(0, 6)
                                    .map((doc, i) => (
                                        <DocumentStatusRow key={i} docType={doc.docType} status={doc.status} daysLeft={doc.daysLeft} />
                                    ))
                                }
                                {companyDocs.filter(d => d.status !== 'Válido').length === 0 && (
                                    <div style={{ textAlign: 'center', padding: 'var(--space-3)', color: 'var(--color-success)', fontSize: 'var(--text-sm)' }}>
                                        <CheckCircle size={20} style={{ marginBottom: 4 }} />
                                        <p style={{ margin: 0 }}>Todos os documentos estão válidos</p>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)', textAlign: 'center', padding: 'var(--space-3)' }}>
                                Nenhum documento registrado para esta empresa.
                            </p>
                        )
                    ) : (
                        <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)', textAlign: 'center', padding: 'var(--space-3)' }}>
                            Selecione uma empresa para verificar documentos.
                        </p>
                    )}
                </div>

                {/* ── Company Aptitude ── */}
                {(() => {
                    const company = companies.find(c => c.id === formData.companyProfileId);
                    if (!company) return (
                        <div style={{ padding: 'var(--space-5)', borderRadius: 'var(--radius-xl)', background: 'var(--color-bg-body)', border: '1px solid var(--color-border)' }}>
                            <SectionDivider icon={<Shield size={16} color="var(--color-text-tertiary)" />} title="Aptidão da Empresa" />
                            <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)', textAlign: 'center', padding: 'var(--space-3)' }}>Selecione uma empresa.</p>
                        </div>
                    );
                    const expiredCount = companyDocs.filter(d => d.status === 'Vencido' || d.status === 'Crítico').length;
                    const totalDocs = companyDocs.length;
                    const validCount = companyDocs.filter(d => d.status === 'Válido').length;
                    const hasQual = !!company.qualification;
                    const hasTechQual = !!company.technicalQualification;
                    return (
                        <ReadinessPanel checks={[
                            { label: 'Habilitação jurídica', ok: hasQual, detail: hasQual ? 'Cadastrada' : 'Não informada' },
                            { label: 'Qualificação técnica', ok: hasTechQual, detail: hasTechQual ? 'Cadastrada' : 'Não informada' },
                            { label: 'Documentos vigentes', ok: expiredCount === 0 && totalDocs > 0, detail: totalDocs > 0 ? `${validCount}/${totalDocs} válidos` : 'Nenhum' },
                            { label: 'Credenciais de portal', ok: credentials.length > 0, detail: credentials.length > 0 ? `${credentials.length} cadastrada(s)` : 'Nenhuma' },
                        ]} />
                    );
                })()}

                {/* ── Quick Actions Grid ── */}
                <div className="col-span-full">
                    <label style={{ ...labelStyle, marginBottom: 'var(--space-3)' }}>Ações Rápidas</label>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-3)' }}>
                        <QuickAction icon={<Brain size={20} />} label="Análise IA" desc="Relatório inteligente do edital" color="var(--color-ai)" onClick={() => { onClose(); onNavigateToModule?.('intelligence', initialData?.id); }} />
                        <QuickAction icon={<DollarSign size={20} />} label="Proposta" desc="Planilha e carta comercial" color="var(--color-primary)" onClick={() => { onClose(); onNavigateToModule?.('production-proposal', initialData?.id); }} />
                        <QuickAction icon={<FileArchive size={20} />} label="Dossiê" desc="Montagem documental completa" color="var(--color-urgency)" onClick={() => { onClose(); onNavigateToModule?.('production-dossier', initialData?.id); }} />
                        <QuickAction icon={<Sparkles size={20} />} label="Declarações" desc="Gerar declarações legais" color="var(--color-success)" onClick={() => { onClose(); onNavigateToModule?.('production-declaration', initialData?.id); }} />
                        <QuickAction icon={<Scale size={20} />} label="Petição" desc="Impugnação ou recurso" color="var(--color-warning)" onClick={() => { onClose(); onNavigateToModule?.('production-petition', initialData?.id); }} />
                        <QuickAction icon={<Monitor size={20} />} label="Monitor Chat" desc="Sessão em tempo real" color="var(--color-text-secondary)" onClick={() => { onClose(); onNavigateToModule?.('monitoring', initialData?.id); }} />
                    </div>
                </div>

                {/* ── Observações inline (resumo) ── */}
                <div className="col-span-full">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-2)' }}>
                        <label style={labelStyle}>
                            <MessageSquare size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />
                            Observações ({observations.length})
                        </label>
                        <button type="button" onClick={() => setHubTab('form')} style={{
                            background: 'none', border: 'none', cursor: 'pointer',
                            fontSize: 'var(--text-xs)', color: 'var(--color-primary)', fontWeight: 'var(--font-semibold)',
                        }}>Ver todas →</button>
                    </div>
                    {observations.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', maxHeight: 120, overflowY: 'auto' }}>
                            {observations.slice(-3).reverse().map(obs => (
                                <div key={obs.id} style={{
                                    padding: 'var(--space-2) var(--space-3)',
                                    background: 'var(--color-bg-body)', borderRadius: 'var(--radius-md)',
                                    fontSize: 'var(--text-sm)', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                }}>
                                    <span style={{ color: 'var(--color-text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>{obs.text}</span>
                                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', flexShrink: 0 }}>
                                        {new Date(obs.timestamp).toLocaleDateString('pt-BR')}
                                    </span>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)' }}>Nenhuma observação registrada.</p>
                    )}
                    <div style={{ display: 'flex', gap: 'var(--space-2)', marginTop: 'var(--space-3)' }}>
                        <div style={{ ...inputContainerStyle, flex: 1, backgroundColor: 'var(--color-bg-body)' }}>
                            <input
                                value={newObservation}
                                onChange={(e) => setNewObservation(e.target.value)}
                                style={inputInnerStyle}
                                placeholder="Adicionar observação rápida..."
                                onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddObservation())}
                            />
                        </div>
                        <button type="button" className="btn btn-primary" onClick={handleAddObservation}
                            style={{ padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-md)' }}>
                            <PlusCircle size={16} />
                        </button>
                    </div>
                </div>

            </div>

            {/* Footer - Save from Hub */}
            <div style={{
                marginTop: 'var(--space-6)', display: 'flex', gap: 'var(--space-3)',
                justifyContent: 'flex-end', paddingTop: 'var(--space-4)',
                borderTop: '1px solid var(--color-border)',
            }}>
                <button type="button" className="btn btn-outline" onClick={() => setHubTab('form')} style={{ padding: 'var(--space-3) var(--space-6)' }}>
                    📝 Editar dados
                </button>
                <button type="button" className="btn btn-outline" onClick={onClose} style={{ padding: 'var(--space-3) var(--space-6)' }}>
                    Fechar
                </button>
            </div>
        </div>
    );
}
