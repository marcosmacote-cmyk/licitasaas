import { useState } from 'react';
import { X, Save, UploadCloud, Loader2, MessageSquare, PlusCircle, Briefcase, Globe, Tag, Link, DollarSign, Calendar, ExternalLink, ScanSearch, SignalHigh, CheckCircle, AlertTriangle, Building2, FileText, Paperclip, Link2, Pencil } from 'lucide-react';
import { API_BASE_URL } from '../config';
import { AiReportModal } from './AiReportModal';
import { LiveCountdown, StatusBadge, NextStepBanner } from './ui';
import { useProcessForm } from './hooks/useProcessForm';
import { ProcessHubPanel } from './process/ProcessHubPanel';
import { ReminderConfig } from './process/ReminderConfig';
import { CredentialMatcher } from './process/CredentialMatcher';
import type { BiddingProcess, RiskTag, CompanyProfile } from '../types';

interface Props {
    initialData: BiddingProcess | null;
    companies: CompanyProfile[];
    onClose: () => void;
    onSave: (data: Partial<BiddingProcess>, aiData?: any) => void;
    onRequestAiAnalysis?: () => void;
    onNavigateToModule?: (module: string, processId?: string) => void;
}

export function ProcessFormModal({ initialData, companies, onClose, onSave, onRequestAiAnalysis, onNavigateToModule }: Props) {
    const form = useProcessForm({ initialData, companies, onClose, onSave, onNavigateToModule });
    const [linksExpanded, setLinksExpanded] = useState(false);
    const [linksEditMode, setLinksEditMode] = useState(false);

    return (
        <>
            <div className="modal-overlay" style={{
                position: 'fixed',
                top: 0, left: 0, right: 0, bottom: 0,
                zIndex: 1000,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                backgroundColor: 'rgba(0, 0, 0, 0.4)',
                backdropFilter: 'blur(8px)',
                animation: 'fadeIn 0.2s ease-out'
            }}>
                <div className="modal-content" style={{
                    maxWidth: form.isEditMode ? '1100px' : '800px',
                    width: '100%', maxHeight: '90vh',
                    borderRadius: 'var(--radius-xl)',
                    boxShadow: 'var(--shadow-xl), 0 0 0 1px var(--color-border)',
                    overflow: 'hidden',
                    backgroundColor: 'var(--color-bg-surface)',
                    border: 'none',
                    animation: 'slideUp 0.3s ease-out',
                    display: 'flex', flexDirection: 'column'
                }}>
                    {/* ═══ HEADER ═══ */}
                    <div style={{
                        padding: 'var(--space-5) var(--space-8)',
                        borderBottom: '1px solid var(--color-border)',
                        background: 'linear-gradient(to right, var(--color-bg-surface), var(--color-bg-surface-hover))'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div className="flex-center gap-4" style={{ flex: 1 }}>
                                <div style={{ padding: 'var(--space-3)', background: 'var(--color-primary-light)', borderRadius: 'var(--radius-lg)', color: 'var(--color-primary)' }}>
                                    <Briefcase size={24} />
                                </div>
                                <div className="flex-1">
                                    <div className="flex-center gap-3" style={{ flexWrap: 'wrap' }}>
                                        <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--font-bold)', color: 'var(--color-text-primary)', margin: 0 }}>
                                            {initialData ? (form.formData.title || 'Editar Licitação') : 'Nova Oportunidade'}
                                        </h2>
                                        {initialData?.status && <StatusBadge status={initialData.status} />}
                                        {initialData?.sessionDate && <LiveCountdown targetDate={initialData.sessionDate} />}
                                    </div>
                                    {form.isEditMode && form.formData.companyProfileId && (
                                        <p style={{ color: 'var(--color-text-tertiary)', fontSize: 'var(--text-sm)', margin: '2px 0 0 0' }}>
                                            {companies.find(c => c.id === form.formData.companyProfileId)?.razaoSocial || ''}
                                            {form.formData.modality ? ` · ${form.formData.modality}` : ''}
                                            {form.formData.portal ? ` · ${form.formData.portal}` : ''}
                                        </p>
                                    )}
                                </div>
                            </div>
                            <button className="icon-btn" onClick={onClose} style={{ background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-full)', padding: 'var(--space-2)', boxShadow: 'var(--shadow-sm)', flexShrink: 0 }}>
                                <X size={20} />
                            </button>
                        </div>

                        {/* Next Step Recommendation */}
                        {form.isEditMode && form.nextStep && (
                            <NextStepBanner label={form.nextStep.label} desc={form.nextStep.desc} icon={form.nextStep.icon} color={form.nextStep.color} onClick={form.nextStep.action} />
                        )}

                        {/* Tab switcher for edit mode */}
                        {form.isEditMode && (
                            <div style={{ display: 'flex', gap: '4px', marginTop: 'var(--space-4)', background: 'var(--color-bg-body)', borderRadius: 'var(--radius-full)', padding: '4px', border: '1px solid var(--color-border)', boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.02)' }}>
                                <button type="button" onClick={() => form.setHubTab('hub')} style={{
                                    flex: 1, padding: 'var(--space-2) var(--space-4)', borderRadius: 'var(--radius-full)', border: 'none', cursor: 'pointer',
                                    fontSize: '0.8125rem', fontWeight: 700, transition: 'all 0.2s ease',
                                    background: form.hubTab === 'hub' ? 'var(--color-bg-surface)' : 'transparent',
                                    color: form.hubTab === 'hub' ? 'var(--color-primary)' : 'var(--color-text-tertiary)',
                                    boxShadow: form.hubTab === 'hub' ? 'var(--shadow-sm), 0 0 0 1px var(--color-border)' : 'none',
                                }}>Hub Operacional</button>
                                <button type="button" onClick={() => form.setHubTab('form')} style={{
                                    flex: 1, padding: 'var(--space-2) var(--space-4)', borderRadius: 'var(--radius-full)', border: 'none', cursor: 'pointer',
                                    fontSize: '0.8125rem', fontWeight: 700, transition: 'all 0.2s ease',
                                    background: form.hubTab === 'form' ? 'var(--color-bg-surface)' : 'transparent',
                                    color: form.hubTab === 'form' ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
                                    boxShadow: form.hubTab === 'form' ? 'var(--shadow-sm), 0 0 0 1px var(--color-border)' : 'none',
                                }}>Dados do Processo</button>
                            </div>
                        )}
                    </div>

                    {/* ═══ HUB OPERACIONAL ═══ */}
                    {form.isEditMode && form.hubTab === 'hub' && (
                        <ProcessHubPanel
                            initialData={initialData}
                            formData={form.formData}
                            companies={companies}
                            companyDocs={form.companyDocs}
                            credentials={form.credentials}
                            observations={form.observations}
                            newObservation={form.newObservation}
                            setNewObservation={form.setNewObservation}
                            handleAddObservation={form.handleAddObservation}
                            isCheckingAi={form.isCheckingAi}
                            aiAnalysisData={form.aiAnalysisData}
                            isEditMode={form.isEditMode}
                            showAiModal={form.showAiModal}
                            setShowAiModal={form.setShowAiModal}
                            handleAiExtract={form.handleAiExtract}
                            setHubTab={form.setHubTab}
                            onClose={onClose}
                            onRequestAiAnalysis={onRequestAiAnalysis}
                            onNavigateToModule={onNavigateToModule}
                            inputContainerStyle={inputContainerStyle}
                            inputInnerStyle={inputInnerStyle}
                            labelStyle={labelStyle}
                        />
                    )}

                    {/* ═══ FORM TAB ═══ */}
                    <form onSubmit={form.handleSubmit} style={{ padding: 'var(--space-8)', overflowY: 'auto', flex: 1, display: (!form.isEditMode || form.hubTab === 'form') ? undefined : 'none' }}>


                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-6)' }}>

                            {/* Título */}
                            <div className="col-span-full">
                                <label style={labelStyle}>Título / Identificação do Processo *</label>
                                <div style={inputContainerStyle}>
                                    <input type="text" name="title" style={inputInnerStyle}
                                        placeholder="Ex: Pregão Eletrônico 01/2026 - Material de Expediente"
                                        value={form.formData.title || ''} onChange={form.handleChange} />
                                </div>
                            </div>

                            {/* Empresa Participante */}
                            <div className="col-span-full">
                                <label style={labelStyle}>Empresa Participante</label>
                                <div style={inputContainerStyle}>
                                    <select name="companyProfileId" value={form.formData.companyProfileId || ''} onChange={form.handleChange} style={inputInnerStyle}>
                                        <option value="">-- Selecione uma Empresa --</option>
                                        {companies.map(company => (
                                            <option key={company.id} value={company.id}>
                                                {company.razaoSocial} ({company.isHeadquarters ? 'Matriz' : 'Filial'})
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            {/* Objeto */}
                            <div className="col-span-full">
                                <label style={labelStyle}>Objeto Resumido</label>
                                <div style={{ ...inputContainerStyle, alignItems: 'flex-start' }}>
                                    <textarea name="summary" style={{ ...inputInnerStyle, height: '80px', resize: 'none' }}
                                        placeholder="Descrição breve do que está sendo licitado..."
                                        value={form.formData.summary || ''} onChange={form.handleChange} />
                                </div>
                            </div>

                            {/* Portal e Modalidade */}
                            <div>
                                <label style={labelStyle}>Portal / Origem *</label>
                                <div style={inputContainerStyle}>
                                    <Globe size={18} color="var(--color-text-tertiary)" />
                                    {(!form.formData.portal || [
                                        "ComprasNet", "Compras.gov.br", "BLL", "BNC", "Licitações-e (BB)", 
                                        "Portal de Compras Públicas", "BEC/SP", "M2A Tecnologia", "PNCP", "BBMNet", "Licita Mais Brasil"
                                    ].includes(form.formData.portal)) && form.formData.portal !== 'Outro_Manual_Entry' ? (
                                        <select name="portal" style={inputInnerStyle} value={form.formData.portal || ''} onChange={(e) => {
                                            if (e.target.value === 'Outro') {
                                                form.setFormData(prev => ({ ...prev, portal: 'Outro_Manual_Entry' }));
                                            } else {
                                                form.handleChange(e);
                                            }
                                        }}>
                                            <option value="">-- Selecione --</option>
                                            {["ComprasNet", "Compras.gov.br", "BLL", "BNC", "Licitações-e (BB)", "Portal de Compras Públicas", "BEC/SP", "M2A Tecnologia", "PNCP", "BBMNet", "Licita Mais Brasil"].map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                            <option value="Outro">Outro...</option>
                                        </select>
                                    ) : (
                                        <div style={{ display: 'flex', width: '100%', alignItems: 'center', gap: '8px' }}>
                                            <input type="text" name="portal" style={inputInnerStyle}
                                                placeholder="Nome do portal" 
                                                value={form.formData.portal === 'Outro_Manual_Entry' ? '' : (form.formData.portal || '')} 
                                                onChange={(e) => form.setFormData(prev => ({ ...prev, portal: e.target.value }))} autoFocus />
                                            <button type="button" onClick={() => form.setFormData(prev => ({ ...prev, portal: '' }))}
                                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-tertiary)', padding: '2px', display: 'flex' }} title="Voltar para a lista">
                                                <X size={14} />
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div>
                                <label style={labelStyle}>Modalidade *</label>
                                <div style={inputContainerStyle}>
                                    <Tag size={18} color="var(--color-text-tertiary)" />
                                    <input type="text" name="modality" style={inputInnerStyle}
                                        placeholder="Ex: Pregão Eletrônico" value={form.formData.modality || ''} onChange={form.handleChange} />
                                </div>
                            </div>

                            {/* ── Monitor de Chat Banner ── */}
                            {(() => {
                                const link = (form.formData.link || '').toLowerCase();
                                const portal = (form.formData.portal || '').toLowerCase();
                                
                                const isComprasNet = link.includes('cnetmobile') || link.includes('comprasnet') || portal.includes('comprasnet') || portal.includes('compras.gov');
                                const isBLL = link.includes('bllcompras') || portal.includes('BLL');
                                const isBNC = link.includes('bnccompras') || portal.includes('BNC');
                                const isM2A = link.includes('m2atecnologia') || portal.includes('M2A');
                                const isBBMNet = link.includes('bbmnet') || portal.includes('BBMNet');
                                const isLicitaMaisBrasil = link.includes('licitamaisbrasil') || portal.includes('Licita Mais Brasil');
                                const isPCP = link.includes('portaldecompraspublicas') || portal.includes('portal de compras');
                                
                                const isMonitorable = isComprasNet || isBLL || isBNC || isM2A || isBBMNet || isLicitaMaisBrasil || isPCP;
                                
                                const validLinksExt = link.split(',').filter(l => !l.includes('supabase.co'));
                                const hasComprasNetLink = validLinksExt.some(l => l.includes('cnetmobile') || l.includes('comprasnet'));
                                const needsComprasNetLink = isComprasNet && !hasComprasNetLink;
                                const isOtherPlatform = link.includes('pncp.gov.br') && !isMonitorable;

                                let hasCredentials = true;
                                if (isMonitorable && form.formData.companyProfileId) {
                                    if (!form.credentials || form.credentials.length === 0) {
                                        hasCredentials = false;
                                    } else {
                                        const scored = form.credentials.map(cred => {
                                            const cp = cred.platform.toLowerCase();
                                            const cu = (cred.url || '').toLowerCase();
                                            let score = 0;
                                            if (isComprasNet && (cp.includes('comprasnet') || cp.includes('compras.gov') || cu.includes('comprasnet') || cu.includes('compras.gov') || cu.includes('gov.br/compras'))) score++;
                                            if (isBLL && (cp.includes('bll') || cu.includes('bll'))) score++;
                                            if (isBNC && (cp.includes('bnc') || cu.includes('bnc'))) score++;
                                            if (isM2A && (cp.includes('m2a') || cu.includes('m2a'))) score++;
                                            if (isBBMNet && (cp.includes('bbmnet') || cu.includes('bbmnet'))) score++;
                                            if (isLicitaMaisBrasil && (cp.includes('licita mais') || cu.includes('licitamaisbrasil'))) score++;
                                            if (isPCP && (cp.includes('portal de compras') || cp.includes('pcp') || cu.includes('portaldecompraspublicas'))) score++;
                                            return score;
                                        });
                                        hasCredentials = Math.max(...scored) > 0;
                                    }
                                }

                                const bgStyle = isMonitorable
                                    ? needsComprasNetLink
                                        ? 'linear-gradient(135deg, rgba(245, 158, 11, 0.06), rgba(234, 179, 8, 0.06))'
                                        : 'linear-gradient(135deg, rgba(34, 197, 94, 0.06), rgba(37, 99, 235, 0.06))'
                                    : 'var(--color-bg-secondary)';
                                const borderColor = isMonitorable
                                    ? needsComprasNetLink ? 'rgba(245, 158, 11, 0.25)' : 'rgba(34, 197, 94, 0.2)'
                                    : 'var(--color-border)';
                                const iconBg = isMonitorable
                                    ? needsComprasNetLink ? 'rgba(245, 158, 11, 0.12)' : 'rgba(34, 197, 94, 0.12)'
                                    : isOtherPlatform ? 'rgba(99, 102, 241, 0.1)' : 'rgba(107, 114, 128, 0.1)';
                                const iconColor = isMonitorable
                                    ? needsComprasNetLink ? '#f59e0b' : '#22c55e'
                                    : isOtherPlatform ? '#6366f1' : '#6b7280';

                                const platformLabel = isComprasNet ? 'ComprasNet' : isBLL ? 'BLL' : isBNC ? 'BNC' : isM2A ? 'M2A' : isBBMNet ? 'BBMNet' : isLicitaMaisBrasil ? 'Licita Mais Brasil' : isPCP ? 'Portal de Compras Públicas' : '';
                                const title = isMonitorable
                                    ? needsComprasNetLink
                                        ? 'Link do ComprasNet necessário'
                                        : `Monitoramento ${platformLabel} suportado`
                                    : isOtherPlatform
                                        ? 'Licitação em portal externo'
                                        : 'Monitor de Chat';
                                const titleColor = isMonitorable
                                    ? needsComprasNetLink ? '#f59e0b' : '#22c55e'
                                    : 'var(--color-text-tertiary)';

                                const subtitle = isMonitorable
                                    ? needsComprasNetLink
                                        ? <span style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                            <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                                                <AlertTriangle size={11} color="#f59e0b" /> Adicione o link do ComprasNet (cnetmobile) nos links para ativar o monitoramento de chat.
                                            </span>
                                            <span style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '2px' }}>
                                                <a 
                                                    href="https://cnetmobile.estaleiro.serpro.gov.br/comprasnet-web/public/compras" 
                                                    target="_blank" 
                                                    rel="noopener noreferrer"
                                                    style={{
                                                        fontSize: '11px', color: '#2563eb', textDecoration: 'underline',
                                                        cursor: 'pointer'
                                                    }}
                                                >
                                                    🔍 Buscar processo no Acesso Público
                                                </a>
                                                <span style={{ fontSize: '10px', color: '#9ca3af' }}>→ copie o link da página do processo e cole em "Editar links"</span>
                                            </span>
                                          </span>
                                        : <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                                            <CheckCircle size={11} color="#22c55e" /> Detectado para {platformLabel}. O chat será monitorado.
                                          </span>
                                    : isOtherPlatform
                                        ? <span>Monitoramento apenas para ComprasNet, BLL, BNC, M2A, BBMNet, Licita Mais Brasil e Portal de Compras Públicas.</span>
                                        : <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
                                            <AlertTriangle size={11} color="#9ca3af" /> Adicione o portal correto para ativar o monitoramento
                                          </span>;

                                const IconComponent = isOtherPlatform ? Globe : SignalHigh;

                                return (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', gridColumn: '1 / -1' }}>
                                        <div style={{
                                            padding: 'var(--space-3) var(--space-4)',
                                            borderRadius: 'var(--radius-md)',
                                            background: bgStyle,
                                            border: `1px solid ${borderColor}`,
                                            display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap',
                                        }}>
                                            <div style={{
                                                width: '28px', height: '28px', borderRadius: 'var(--radius-md)',
                                                background: iconBg,
                                                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                                            }}>
                                                <IconComponent size={16} color={iconColor} />
                                            </div>
                                            <div style={{ flex: 1, minWidth: '200px' }}>
                                                <div style={{ fontSize: '0.75rem', fontWeight: 600, color: titleColor, marginBottom: '2px' }}>
                                                    {title}
                                                </div>
                                                <div style={{ fontSize: '0.6875rem', color: 'var(--color-text-secondary)' }}>
                                                    {subtitle}
                                                </div>
                                            </div>
                                        </div>

                                        {isMonitorable && !hasCredentials && form.formData.companyProfileId && (
                                            <div style={{
                                                padding: 'var(--space-3) var(--space-4)',
                                                borderRadius: 'var(--radius-md)',
                                                background: 'rgba(239, 68, 68, 0.06)',
                                                border: '1px solid rgba(239, 68, 68, 0.2)',
                                                display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)'
                                            }}>
                                                <AlertTriangle size={16} color="var(--color-danger)" style={{ marginTop: '2px', flexShrink: 0 }} />
                                                <div>
                                                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-danger)', marginBottom: '2px' }}>
                                                        Credenciais Ausentes para o Portal
                                                    </div>
                                                    <div style={{ fontSize: '0.6875rem', color: 'var(--color-text-secondary)' }}>
                                                        A empresa selecionada não possui credenciais salvas para o portal {platformLabel}. O monitoramento de chat do LicitaSaaS não funcionará até que você adicione as credenciais no menu "Minhas Empresas".
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })()}

                            {/* Valor e Data */}
                            <div>
                                <label style={labelStyle}>Valor Estimado (R$)</label>
                                <div style={inputContainerStyle}>
                                    <DollarSign size={18} color="var(--color-text-tertiary)" />
                                    <input type="number" step="0.01" name="estimatedValue" style={inputInnerStyle}
                                        value={form.formData.estimatedValue} onChange={form.handleChange} />
                                </div>
                            </div>
                            <div>
                                <label style={labelStyle}>Data/Hora da Sessão *</label>
                                <div style={inputContainerStyle}>
                                    <Calendar size={18} color="var(--color-text-tertiary)" />
                                    <input type="datetime-local" name="sessionDate" style={inputInnerStyle}
                                        value={form.formData.sessionDate} onChange={form.handleChange} />
                                </div>
                            </div>

                            {/* Tag de Risco */}
                            <div className="col-span-full">
                                <label style={labelStyle}>Tag de Risco</label>
                                <div style={{ display: 'flex', gap: '12px' }}>
                                    {['Baixo', 'Médio', 'Alto', 'Crítico'].map((level) => (
                                        <button key={level} type="button"
                                            onClick={() => form.setFormData(p => ({ ...p, risk: level as RiskTag }))}
                                            style={{
                                                flex: 1, padding: 'var(--space-3)', borderRadius: 'var(--radius-lg)',
                                                border: 'none',
                                                background: form.formData.risk === level ? 'var(--color-bg-surface-hover)' : 'var(--color-bg-surface)',
                                                color: form.formData.risk === level ? (
                                                    level === 'Crítico' ? 'var(--color-danger)' :
                                                        level === 'Alto' ? 'var(--color-danger)' :
                                                            level === 'Médio' ? 'var(--color-warning)' : 'var(--color-success)'
                                                ) : 'var(--color-text-secondary)',
                                                fontWeight: form.formData.risk === level ? 700 : 500,
                                                boxShadow: form.formData.risk === level ? 'var(--shadow-sm), inset 0 0 0 2px currentColor' : '0 0 0 1px var(--color-border)',
                                                transition: 'all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
                                            }}>
                                            {level}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Link / Upload + PDF Viewer + Credenciais */}
                            <div className="col-span-full">
                                <label style={labelStyle}>Links e Documentos do Processo</label>

                                {/* ── Links individualizados com tipo + expand/collapse ── */}
                                {(() => {
                                    const allParts = (form.formData.link || '').split(',').map(s => s.trim()).filter(s => s);
                                    const externalLinks = allParts.filter(s => s.startsWith('http'));
                                    const uploadPaths = allParts.filter(s => s.startsWith('/uploads/'));

                                    // Classificar cada link
                                    const classifyLink = (url: string) => {
                                        if (url.includes('supabase.co') && url.includes('.pdf')) return { type: 'PDF', IconComp: FileText, color: '#ef4444', label: 'PDF do Edital' };
                                        if (url.includes('supabase.co')) return { type: 'Arquivo', IconComp: Paperclip, color: '#8b5cf6', label: 'Arquivo Anexo' };
                                        if (url.includes('pncp.gov.br')) return { type: 'PNCP', IconComp: Building2, color: '#6366f1', label: 'Portal PNCP' };
                                        if (url.includes('cnetmobile') || url.includes('comprasnet')) return { type: 'ComprasNet', IconComp: MessageSquare, color: '#22c55e', label: 'ComprasNet (Chat)' };
                                        if (url.includes('bllcompras') || url.includes('bll.org')) return { type: 'BLL', IconComp: MessageSquare, color: '#f59e0b', label: 'BLL Compras (Chat)' };
                                        if (url.includes('bnccompras')) return { type: 'BNC', IconComp: MessageSquare, color: '#3b82f6', label: 'BNC Compras (Chat)' };
                                        return { type: 'Link', IconComp: Link2, color: '#3b82f6', label: 'Link Externo' };
                                    };

                                    return (
                                        <>
                                            {/* Chips dos links (expandable) */}
                                            {externalLinks.length > 0 && (
                                                <div style={{ marginBottom: '10px' }}>
                                                    <button type="button" onClick={() => setLinksExpanded(prev => !prev)}
                                                        style={{
                                                            background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0',
                                                            fontSize: '0.7rem', color: 'var(--color-primary)', fontWeight: 600,
                                                            display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '6px',
                                                        }}>
                                                        <span style={{ transform: linksExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.2s', display: 'inline-block' }}>▶</span>
                                                        {externalLinks.length} link(s) detectado(s)
                                                    </button>

                                                    {linksExpanded && (
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', paddingLeft: '12px', borderLeft: '2px solid var(--color-border)' }}>
                                                            {externalLinks.map((link, idx) => {
                                                                const info = classifyLink(link);
                                                                return (
                                                                    <div key={idx} style={{
                                                                        display: 'flex', alignItems: 'center', gap: '8px',
                                                                        padding: '6px 10px', borderRadius: 'var(--radius-md)',
                                                                        background: 'var(--color-bg-body)', border: '1px solid var(--color-border)',
                                                                        fontSize: '0.75rem', transition: 'var(--transition-fast)',
                                                                    }}>
                                                                        <span style={{
                                                                            padding: '2px 8px', borderRadius: '10px', fontSize: '0.65rem',
                                                                            fontWeight: 700, color: 'white', background: info.color, whiteSpace: 'nowrap',
                                                                            display: 'flex', alignItems: 'center', gap: '3px',
                                                                        }}>
                                                                            <info.IconComp size={10} /> {info.label}
                                                                        </span>
                                                                        <span style={{
                                                                            flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                                                            color: 'var(--color-text-secondary)', fontSize: '0.7rem',
                                                                        }}>
                                                                            {link.length > 80 ? link.substring(0, 77) + '...' : link}
                                                                        </span>
                                                                        <a href={link} target="_blank" rel="noopener noreferrer"
                                                                            style={{
                                                                                flexShrink: 0, color: 'var(--color-primary)', display: 'flex',
                                                                                alignItems: 'center', gap: '3px', fontSize: '0.7rem',
                                                                                fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap',
                                                                            }}>
                                                                            <ExternalLink size={12} /> Abrir
                                                                        </a>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    )}
                                                </div>
                                            )}

                                            {/* Botão para editar links + input condicional */}
                                            <div style={{ marginBottom: '10px' }}>
                                                <button type="button" onClick={() => setLinksEditMode(prev => !prev)}
                                                    style={{
                                                        background: 'none', border: 'none', cursor: 'pointer', padding: '4px 0',
                                                        fontSize: '0.7rem', color: 'var(--color-text-tertiary)', fontWeight: 600,
                                                        display: 'flex', alignItems: 'center', gap: '4px',
                                                    }}>
                                                    <Pencil size={11} /> {linksEditMode ? 'Ocultar edição' : 'Editar links'}
                                                </button>
                                                {linksEditMode && (
                                                    <div style={{ display: 'flex', gap: '12px', marginTop: '6px' }}>
                                                        <div style={{ ...inputContainerStyle, flex: 1 }}>
                                                            <Globe size={18} color="var(--color-text-tertiary)" />
                                                            <input type="text" style={inputInnerStyle}
                                                                placeholder="Link do portal de compras (PNCP, ComprasNet, etc.)"
                                                                value={externalLinks.join(', ')}
                                                                onChange={(e) => {
                                                                    const newExternalLinks = e.target.value;
                                                                    const newLink = [newExternalLinks, ...uploadPaths].filter(s => s.trim()).join(', ');
                                                                    form.setFormData(prev => ({ ...prev, link: newLink }));
                                                                }} />
                                                        </div>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Upload section */}
                                            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                                                <div style={{ ...inputContainerStyle, flex: 1, background: 'var(--color-bg-body)', borderStyle: 'dashed' }}>
                                                    <Link size={18} color="var(--color-text-tertiary)" />
                                                    <span style={{ color: 'var(--color-text-tertiary)', fontSize: '0.85rem' }}>
                                                        {uploadPaths.length > 0 ? `${uploadPaths.length} arquivo(s) anexado(s)` : 'Nenhum edital anexado'}
                                                    </span>
                                                </div>
                                                <input type="file" ref={form.fileInputRef} style={{ display: 'none' }}
                                                    onChange={form.handleFileChange} multiple accept="application/pdf" />
                                                <button type="button" className="btn btn-outline" onClick={form.handleFileUploadClick} disabled={form.isUploading}
                                                    style={{ padding: '0 20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    {form.isUploading ? <Loader2 size={18} className="spinner" /> : <UploadCloud size={18} />}
                                                    Anexar PDF
                                                </button>
                                            </div>
                                        </>
                                    );
                                })()}

                                {/* Attached Files Chips + Viewer */}
                                {form.formData.link && form.formData.link.includes('/uploads/') && (() => {
                                    const allParts = form.formData.link.split(',').map(s => s.trim()).filter(s => s);
                                    const pdfFiles = allParts.filter(s => s.startsWith('/uploads/'));
                                    if (pdfFiles.length === 0) return null;
                                    return (
                                        <div style={{ marginTop: '10px' }}>
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: form.viewingPdf ? '12px' : 0 }}>
                                                {pdfFiles.map((file, idx) => {
                                                    const name = decodeURIComponent(file.split('/').pop() || `Edital_${idx + 1}.pdf`);
                                                    const shortName = name.length > 30 ? name.substring(0, 28) + '...' : name;
                                                    const isViewing = form.viewingPdf === file;
                                                    return (
                                                        <div key={idx} style={{
                                                            display: 'flex', alignItems: 'center', gap: '6px',
                                                            padding: '6px 12px', borderRadius: '20px',
                                                            border: isViewing ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                                                            background: isViewing ? 'rgba(59,130,246,0.06)' : 'var(--color-bg-body)',
                                                            fontSize: '0.75rem', fontWeight: 500
                                                        }}>
                                                            <span style={{ color: 'var(--color-danger)', fontSize: '0.7rem', fontWeight: 700 }}>PDF</span>
                                                            <span style={{ color: 'var(--color-text-primary)', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shortName}</span>
                                                            <button type="button" onClick={() => form.setViewingPdf(isViewing ? null : file)}
                                                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: isViewing ? 'var(--color-primary)' : 'var(--color-text-tertiary)', fontWeight: 600, fontSize: '0.7rem' }}
                                                                title="Visualizar PDF">
                                                                {isViewing ? '✕ Fechar' : 'Visualizar'}
                                                            </button>
                                                            <a href={`${API_BASE_URL}${file}`} target="_blank" rel="noopener noreferrer"
                                                                style={{ color: 'var(--color-text-tertiary)', fontSize: '0.7rem', textDecoration: 'none' }} title="Abrir em nova aba">
                                                                ↗
                                                            </a>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                            {form.viewingPdf && (
                                                <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden', background: 'var(--color-text-secondary)', position: 'relative' }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 14px', background: 'var(--color-bg-surface)', borderBottom: '1px solid var(--color-border)', fontSize: '0.75rem' }}>
                                                        <span style={{ color: 'var(--color-text-secondary)', fontWeight: 600 }}>Visualizador de Documento</span>
                                                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                            <a href={`${API_BASE_URL}${form.viewingPdf}`} target="_blank" rel="noopener noreferrer" className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: '0.7rem' }}>
                                                                Abrir em Nova Aba ↗
                                                            </a>
                                                            <button type="button" onClick={() => form.setViewingPdf(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: 'var(--color-text-tertiary)' }}>
                                                                <X size={16} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                    <iframe src={`${API_BASE_URL}${form.viewingPdf}`} style={{ width: '100%', height: '500px', border: 'none' }} title="Visualizador de PDF" />
                                                </div>
                                            )}
                                        </div>
                                    );
                                })()}

                                {/* Credential Integration */}
                                <CredentialMatcher
                                    credentials={form.credentials}
                                    portal={form.formData.portal || ''}
                                    link={form.formData.link || ''}
                                    showPassword={form.showPassword}
                                    setShowPassword={form.setShowPassword}
                                    copiedField={form.copiedField}
                                    handleCopy={form.handleCopy}
                                />
                            </div>

                            {/* Sistema de Lembrete Inteligente */}
                            <div className="col-span-full">
                                <ReminderConfig
                                    formData={form.formData}
                                    setFormData={form.setFormData}
                                    handleChange={form.handleChange}
                                    inputContainerStyle={inputContainerStyle}
                                    inputInnerStyle={inputInnerStyle}
                                />
                            </div>

                            {/* Observações */}
                            <div className="col-span-full">
                                <label style={labelStyle}>Historico de Observações</label>
                                <div style={{
                                    background: 'var(--color-bg-base)', borderRadius: 'var(--radius-xl)',
                                    border: '1px solid var(--color-border)', padding: 'var(--space-5)',
                                    display: 'flex', flexDirection: 'column', gap: '16px'
                                }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '180px', overflowY: 'auto' }}>
                                        {form.observations.length === 0 ? (
                                            <div style={{ textAlign: 'center', padding: '20px', color: 'var(--color-text-tertiary)' }}>
                                                <MessageSquare size={32} style={{ marginBottom: '8px', opacity: 0.2 }} />
                                                <p style={{ margin: 0, fontSize: '0.875rem' }}>Nenhum comentário registrado.</p>
                                            </div>
                                        ) : (
                                            form.observations.map(obs => (
                                                <div key={obs.id} style={{
                                                    padding: '12px 16px', background: 'var(--color-bg-surface)',
                                                    borderRadius: '0.75rem', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)'
                                                }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                                                        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-primary)' }}>Equipe Licita</span>
                                                        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>
                                                            {new Date(obs.timestamp).toLocaleString('pt-BR')}
                                                        </span>
                                                    </div>
                                                    <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--color-text-primary)', lineHeight: 1.5 }}>{obs.text}</p>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                    <div style={{ display: 'flex', gap: '12px' }}>
                                        <div style={{ ...inputContainerStyle, flex: 1, backgroundColor: 'var(--color-bg-surface)' }}>
                                            <input value={form.newObservation} onChange={(e) => form.setNewObservation(e.target.value)}
                                                style={inputInnerStyle} placeholder="Adicionar atualização..."
                                                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), form.handleAddObservation())} />
                                        </div>
                                        <button type="button" className="btn btn-primary" onClick={form.handleAddObservation}
                                            style={{ padding: '12px', borderRadius: 'var(--radius-md)' }}>
                                            <PlusCircle size={20} />
                                        </button>
                                    </div>
                                </div>
                            </div>

                        </div>

                        <div style={{
                            marginTop: 'var(--space-10)', display: 'flex', gap: 'var(--space-3)',
                            justifyContent: 'flex-end', paddingTop: 'var(--space-6)', borderTop: '1px solid var(--color-border)'
                        }}>
                            {(onRequestAiAnalysis || form.aiAnalysisData) && (
                                <button type="button" className="btn btn-secondary" onClick={() => {
                                    if (onRequestAiAnalysis) { onRequestAiAnalysis(); } else { form.setShowAiModal(true); }
                                }} style={{
                                    padding: 'var(--space-3) var(--space-6)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                                    color: 'var(--color-ai)', borderColor: 'var(--color-ai-border)', background: 'var(--color-ai-bg)',
                                    marginRight: 'auto'
                                }}>
                                    <ScanSearch size={18} /> Ver Relatório IA
                                </button>
                            )}
                            <button type="button" className="btn btn-outline" onClick={onClose} style={{ padding: 'var(--space-3) var(--space-6)' }}>
                                Cancelar
                            </button>
                            <button type="submit" className="btn btn-primary" style={{
                                padding: 'var(--space-3) var(--space-10)',
                                background: 'linear-gradient(135deg, var(--color-primary), var(--color-primary-hover))',
                                boxShadow: 'var(--shadow-md)', fontWeight: 'var(--font-semibold)'
                            }}>
                                <Save size={18} /> Salvar Licitação
                            </button>
                        </div>
                    </form>
                </div>

                <style>{`
@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
@keyframes slideUp { from { transform: translateY(20px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
                ::-webkit-scrollbar { width: 6px; }
                ::-webkit-scrollbar-track { background: transparent; }
                ::-webkit-scrollbar-thumb { background: var(--color-border); border-radius: 10px; }
                ::-webkit-scrollbar-thumb:hover { background: var(--color-text-tertiary); }
`}</style>
            </div>
            {form.showAiModal && form.aiAnalysisData && (
                <AiReportModal
                    analysis={form.aiAnalysisData}
                    process={{ ...form.formData } as BiddingProcess}
                    onClose={() => form.setShowAiModal(false)}
                    onUpdate={() => { }}
                />
            )}
        </>
    );
}

const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: 'var(--text-md)',
    fontWeight: 'var(--font-semibold)',
    color: 'var(--color-text-secondary)',
    marginBottom: 'var(--space-3)'
};

const inputContainerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-3)',
    padding: 'var(--space-3) var(--space-4)',
    backgroundColor: 'var(--color-bg-base)',
    border: 'none',
    boxShadow: '0 0 0 1px var(--color-border)',
    borderRadius: 'var(--radius-lg)',
    transition: 'all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
};

const inputInnerStyle: React.CSSProperties = {
    border: 'none',
    background: 'transparent',
    outline: 'none',
    width: '100%',
    color: 'var(--color-text-primary)',
    fontSize: 'var(--text-base)',
};
