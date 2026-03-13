import { useState, useEffect, useRef, useMemo } from 'react';
import { X, Save, UploadCloud, Loader2, MessageSquare, Bell, PlusCircle, Briefcase, Globe, Tag, Link, DollarSign, Calendar, KeyRound, Copy, Eye, EyeOff, RefreshCw, ExternalLink, Bot, Brain, Scale, Sparkles, FileArchive, ArrowRight, CheckCircle, AlertTriangle, Shield, Monitor, FileText, ChevronRight } from 'lucide-react';
import { API_BASE_URL } from '../config';
import { v4 as uuidv4 } from 'uuid';
import { AiReportModal } from './AiReportModal';
import { CountdownBadge, useToast } from './ui';
import type { BiddingProcess, RiskTag, CompanyProfile, ObservationLog, CompanyCredential, AiAnalysis } from '../types';

interface Props {
    initialData: BiddingProcess | null;
    companies: CompanyProfile[];
    onClose: () => void;
    onSave: (data: Partial<BiddingProcess>, aiData?: any) => void;
    onRequestAiAnalysis?: () => void;
    onNavigateToModule?: (module: string, processId?: string) => void;
}

export function ProcessFormModal({ initialData, companies, onClose, onSave, onRequestAiAnalysis, onNavigateToModule }: Props) {
    const toast = useToast();
    const [showAiModal, setShowAiModal] = useState(false);
    const [aiAnalysisData, setAiAnalysisData] = useState<any>(null);
    const [isCheckingAi, setIsCheckingAi] = useState(false);
    const [formData, setFormData] = useState<Partial<BiddingProcess>>({
        title: '',
        summary: '',
        modality: '',
        portal: '',
        estimatedValue: 0,
        sessionDate: '',
        risk: 'Baixo' as RiskTag,
        link: '',
        companyProfileId: '',
        observations: '[]',
        reminderDate: '',
        reminderStatus: 'pending',
        reminderType: 'once',
        reminderDays: '[]'
    });

    const [newObservation, setNewObservation] = useState('');
    const [observations, setObservations] = useState<ObservationLog[]>([]);
    const [companyDocs, setCompanyDocs] = useState<{ name: string; docType: string; status: string; expirationDate: string; daysLeft?: number }[]>([]);
    const [hubTab, setHubTab] = useState<'hub' | 'form'>('hub');

    const isEditMode = !!initialData?.id;

    useEffect(() => {
        if (initialData) {
            let formattedSessionDate = '';
            if (initialData.sessionDate) {
                const d = new Date(initialData.sessionDate);
                if (!isNaN(d.getTime())) {
                    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
                    formattedSessionDate = d.toISOString().slice(0, 16);
                }
            }

            let formattedReminderDate = '';
            if (initialData.reminderDate) {
                const d = new Date(initialData.reminderDate);
                if (!isNaN(d.getTime())) {
                    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
                    formattedReminderDate = d.toISOString().slice(0, 16);
                }
            }

            setFormData({
                ...initialData,
                sessionDate: formattedSessionDate,
                reminderDate: formattedReminderDate
            });

            try {
                const obs = JSON.parse(initialData.observations || '[]');
                setObservations(obs);
            } catch (e) {
                setObservations([]);
            }
        }
    }, [initialData]);

    // Fetch company documents for readiness check
    useEffect(() => {
        if (formData.companyProfileId) {
            fetch(`${API_BASE_URL}/api/documents?companyId=${formData.companyProfileId}`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
            })
                .then(res => res.ok ? res.json() : [])
                .then(data => {
                    const docs = (Array.isArray(data) ? data : []).map((d: any) => {
                        const exp = new Date(d.expirationDate);
                        const now = new Date();
                        const daysLeft = Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
                        return { name: d.fileName || d.docType, docType: d.docType, status: d.status, expirationDate: d.expirationDate, daysLeft };
                    });
                    setCompanyDocs(docs);
                })
                .catch(() => setCompanyDocs([]));
        } else {
            setCompanyDocs([]);
        }
    }, [formData.companyProfileId]);

    // ── Next step recommendation based on status ──
    const nextStep = useMemo(() => {
        const status = initialData?.status;
        const hasAnalysis = !!initialData?.aiAnalysis;
        const hasPdf = (formData.link || '').includes('.pdf') || (formData.link || '').includes('/uploads/');
        const expiredDocs = companyDocs.filter(d => d.status === 'Vencido' || d.status === 'Crítico');
        const expiringDocs = companyDocs.filter(d => d.status === 'Vencendo' || d.status === 'Alerta');

        if (!isEditMode) return { label: 'Salvar', desc: 'Salve a licitação para desbloquear os módulos operacionais', icon: <Save size={18} />, color: 'var(--color-primary)', action: undefined };

        if (status === 'Captado') {
            if (!hasPdf) return { label: 'Anexar Edital', desc: 'Envie o PDF do edital para habilitar a análise com IA', icon: <UploadCloud size={18} />, color: 'var(--color-warning)', action: () => setHubTab('form') };
            if (!hasAnalysis) return { label: 'Analisar com LicitIA', desc: 'Execute a análise inteligente do edital para identificar riscos e oportunidades', icon: <Brain size={18} />, color: 'var(--color-ai)', action: handleAiExtract };
            return { label: 'Mover para Análise', desc: 'O edital foi analisado. Avalie os resultados e avance no pipeline', icon: <ArrowRight size={18} />, color: 'var(--color-primary)', action: undefined };
        }
        if (status === 'Em Análise de Edital') {
            if (!hasAnalysis) return { label: 'Analisar com LicitIA', desc: 'Execute a análise do edital para prosseguir', icon: <Brain size={18} />, color: 'var(--color-ai)', action: handleAiExtract };
            if (expiredDocs.length > 0) return { label: 'Regularizar Documentos', desc: `${expiredDocs.length} documento(s) vencido(s) precisam ser renovados`, icon: <AlertTriangle size={18} />, color: 'var(--color-danger)', action: () => { onClose(); onNavigateToModule?.('companies'); } };
            return { label: 'Preparar Documentação', desc: 'Análise concluída. Inicie a preparação de proposta e documentos', icon: <FileText size={18} />, color: 'var(--color-urgency)', action: undefined };
        }
        if (status === 'Preparando Documentação') {
            if (expiredDocs.length > 0) return { label: 'Regularizar Documentos', desc: `${expiredDocs.length} documento(s) vencido(s) impedem a participação`, icon: <AlertTriangle size={18} />, color: 'var(--color-danger)', action: () => { onClose(); onNavigateToModule?.('companies'); } };
            return { label: 'Gerar Proposta', desc: 'Monte a proposta comercial para este processo', icon: <DollarSign size={18} />, color: 'var(--color-primary)', action: () => { onClose(); onNavigateToModule?.('production-proposal', initialData?.id); } };
        }
        if (status === 'Participando') {
            return { label: 'Monitorar Sessão', desc: 'Acompanhe a sessão de disputa em tempo real', icon: <Monitor size={18} />, color: 'var(--color-warning)', action: () => { onClose(); onNavigateToModule?.('monitoring'); } };
        }
        if (status === 'Monitorando' || status === 'Recurso') {
            return { label: 'Gerar Petição', desc: 'Prepare uma petição ou impugnação se necessário', icon: <Scale size={18} />, color: 'var(--color-warning)', action: () => { onClose(); onNavigateToModule?.('production-petition', initialData?.id); } };
        }
        if (expiringDocs.length > 0) {
            return { label: 'Atenção Documental', desc: `${expiringDocs.length} documento(s) próximo(s) do vencimento`, icon: <AlertTriangle size={18} />, color: 'var(--color-warning)', action: () => { onClose(); onNavigateToModule?.('companies'); } };
        }
        return { label: 'Processo atualizado', desc: 'Todas as ações estão em dia. Continue acompanhando.', icon: <CheckCircle size={18} />, color: 'var(--color-success)', action: undefined };
    }, [initialData, formData.link, companyDocs, isEditMode]);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [credentials, setCredentials] = useState<CompanyCredential[]>([]);
    const [showPassword, setShowPassword] = useState<Record<string, boolean>>({});
    const [copiedField, setCopiedField] = useState<string | null>(null);
    const [viewingPdf, setViewingPdf] = useState<string | null>(null);

    // Fetch credentials when company changes
    useEffect(() => {
        if (formData.companyProfileId) {
            const company = companies.find(c => c.id === formData.companyProfileId);
            if (company?.credentials) {
                setCredentials(company.credentials);
            } else {
                // Fetch from API
                fetch(`${API_BASE_URL}/api/credentials?companyId=${formData.companyProfileId}`, {
                    headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
                })
                    .then(res => res.ok ? res.json() : [])
                    .then(data => setCredentials(Array.isArray(data) ? data : []))
                    .catch(() => setCredentials([]));
            }
        } else {
            setCredentials([]);
        }
    }, [formData.companyProfileId, companies]);

    const handleCopy = (text: string, fieldId: string) => {
        navigator.clipboard.writeText(text);
        setCopiedField(fieldId);
        setTimeout(() => setCopiedField(null), 2000);
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
        const { name, value } = e.target;
        let finalValue: any = value;
        if (name === 'estimatedValue') {
            const sanitizedValue = value.replace(',', '.');
            finalValue = sanitizedValue === '' ? 0 : parseFloat(sanitizedValue);
            if (isNaN(finalValue)) finalValue = 0;
        }
        setFormData(prev => ({ ...prev, [name]: finalValue }));
    };

    const handleAddObservation = () => {
        if (!newObservation.trim()) return;
        const log: ObservationLog = {
            id: uuidv4(),
            text: newObservation.trim(),
            timestamp: new Date().toISOString()
        };
        const updatedObs = [...observations, log];
        setObservations(updatedObs);
        setFormData(prev => ({ ...prev, observations: JSON.stringify(updatedObs) }));
        setNewObservation('');
    };

    const handleFileUploadClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;
        try {
            setIsUploading(true);
            const uploadedUrls: string[] = [];
            for (const file of files) {
                const bodyData = new FormData();
                bodyData.append('file', file);
                const uploadResponse = await fetch(`${API_BASE_URL}/api/upload`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                    body: bodyData
                });
                if (uploadResponse.ok) {
                    const uploadData = await uploadResponse.json();
                    uploadedUrls.push(uploadData.fileUrl);
                }
            }
            if (uploadedUrls.length > 0) {
                setFormData(prev => ({
                    ...prev,
                    link: prev.link ? `${prev.link}, ${uploadedUrls.join(', ')} ` : uploadedUrls.join(', ')
                }));
            }
        } catch (err) {
            console.error(err);
        } finally {
            setIsUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleAiExtract = async () => {
        const fileNames = formData.link ? formData.link.split(',').map(l => l.trim()).filter(l => l.length > 0) : [];
        const hasUploadedFile = fileNames.some(f => f.includes('.pdf') || f.includes('/uploads/'));

        if (!hasUploadedFile) {
            toast.warning('Adicione um anexo PDF (Edital) para habilitar o preenchimento automático via IA.');
            return;
        }

        try {
            setIsCheckingAi(true);
            const token = localStorage.getItem('token');
            const res = await fetch(`${API_BASE_URL}/api/analyze-edital/v2`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ fileNames: fileNames.filter(f => f.includes('.pdf') || f.includes('/uploads/')) })
            });

            if (!res.ok) {
                const errorLog = await res.json();
                throw new Error(errorLog.error || "Falha na análise");
            }

            const aiData = await res.json();

            if (aiData.process) {
                // Formatting Date properly if it exists
                let formattedSessionDate = formData.sessionDate;
                if (aiData.process.sessionDate) {
                    const d = new Date(aiData.process.sessionDate);
                    if (!isNaN(d.getTime())) {
                        d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
                        formattedSessionDate = d.toISOString().slice(0, 16);
                    }
                }

                setFormData(prev => ({
                    ...prev,
                    title: aiData.process.title || prev.title,
                    summary: aiData.process.summary || prev.summary,
                    modality: aiData.process.modality || prev.modality,
                    portal: aiData.process.portal || prev.portal,
                    estimatedValue: aiData.process.estimatedValue || prev.estimatedValue,
                    sessionDate: formattedSessionDate,
                    risk: aiData.process.risk || prev.risk
                }));
            }
            if (aiData.analysis) {
                const analysisObj: AiAnalysis = {
                    id: uuidv4(),
                    biddingProcessId: '',
                    requiredDocuments: JSON.stringify(aiData.analysis.requiredDocuments || []),
                    biddingItems: aiData.analysis.biddingItems || '',
                    pricingConsiderations: aiData.analysis.pricingConsiderations || '',
                    irregularitiesFlags: JSON.stringify(aiData.analysis.irregularitiesFlags || []),
                    fullSummary: aiData.analysis.fullSummary || '',
                    deadlines: JSON.stringify(aiData.analysis.deadlines || []),
                    penalties: aiData.analysis.penalties || '',
                    qualificationRequirements: aiData.analysis.qualificationRequirements || '',
                    sourceFileNames: JSON.stringify(fileNames),
                    schemaV2: aiData.schemaV2 || null,
                    promptVersion: aiData._prompt_version || null,
                    modelUsed: aiData._model_used || null,
                    pipelineDurationS: aiData._pipeline_duration_s || null,
                    overallConfidence: aiData._overall_confidence || null,
                    analyzedAt: new Date().toISOString()
                };
                setAiAnalysisData(analysisObj);
                toast.success('Campos extraídos com sucesso via IA! Confira o Relatório Analítico.');
            }
        } catch (e: any) {
            toast.error(`Erro na Extração IA: ${e.message}`);
        } finally {
            setIsCheckingAi(false);
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        if (!formData.title?.trim() || !formData.portal?.trim() || !formData.modality?.trim() || !formData.sessionDate) {
            toast.warning('Preencha todos os campos obrigatórios marcados com * (Título, Portal, Modalidade e Data da Sessão).');
            return;
        }

        onSave({
            ...formData,
            sessionDate: formData.sessionDate ? new Date(formData.sessionDate).toISOString() : new Date().toISOString(),
            reminderDate: formData.reminderDate ? new Date(formData.reminderDate).toISOString() : (null as any),
            reminderStatus: formData.reminderDate ? 'pending' : (null as any)
        }, aiAnalysisData);
    };

    return (
        <>
            <div className="modal-overlay" style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: 1000,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'rgba(15, 23, 42, 0.6)',
                backdropFilter: 'blur(4px)',
                animation: 'fadeIn 0.2s ease-out'
            }}>
                <div className="modal-content" style={{
                    maxWidth: isEditMode ? '1100px' : '800px',
                    width: '100%',
                    maxHeight: '90vh',
                    borderRadius: 'var(--radius-xl)',
                    boxShadow: 'var(--shadow-xl)',
                    overflow: 'hidden',
                    backgroundColor: 'var(--color-bg-surface)',
                    border: '1px solid var(--color-border)',
                    animation: 'slideUp 0.3s ease-out',
                    display: 'flex',
                    flexDirection: 'column'
                }}>
                    {/* ═══ HEADER ═══ */}
                    <div style={{
                        padding: 'var(--space-5) var(--space-8)',
                        borderBottom: '1px solid var(--color-border)',
                        background: 'linear-gradient(to right, var(--color-bg-surface), var(--color-bg-surface-hover))'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', flex: 1 }}>
                                <div style={{ padding: 'var(--space-3)', background: 'var(--color-primary-light)', borderRadius: 'var(--radius-lg)', color: 'var(--color-primary)' }}>
                                    <Briefcase size={24} />
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
                                        <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--font-bold)', color: 'var(--color-text-primary)', margin: 0 }}>
                                            {initialData ? (formData.title || 'Editar Licitação') : 'Nova Oportunidade'}
                                        </h2>
                                        {initialData?.status && (
                                            <span style={{
                                                padding: '2px 10px', borderRadius: 'var(--radius-full)',
                                                fontSize: 'var(--text-xs)', fontWeight: 'var(--font-bold)',
                                                background: initialData.status === 'Vencido' ? 'var(--color-success-bg)' : initialData.status === 'Perdido' ? 'var(--color-danger-bg)' : 'var(--color-primary-light)',
                                                color: initialData.status === 'Vencido' ? 'var(--color-success)' : initialData.status === 'Perdido' ? 'var(--color-danger)' : 'var(--color-primary)',
                                            }}>
                                                {initialData.status}
                                            </span>
                                        )}
                                        {initialData?.sessionDate && (
                                            <CountdownBadge targetDate={initialData.sessionDate} />
                                        )}
                                    </div>
                                    {isEditMode && formData.companyProfileId && (
                                        <p style={{ color: 'var(--color-text-tertiary)', fontSize: 'var(--text-sm)', margin: '2px 0 0 0' }}>
                                            {companies.find(c => c.id === formData.companyProfileId)?.razaoSocial || ''}
                                            {formData.modality ? ` · ${formData.modality}` : ''}
                                            {formData.portal ? ` · ${formData.portal}` : ''}
                                        </p>
                                    )}
                                </div>
                            </div>
                            <button
                                className="icon-btn"
                                onClick={onClose}
                                style={{ background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-full)', padding: 'var(--space-2)', boxShadow: 'var(--shadow-sm)', flexShrink: 0 }}
                            >
                                <X size={20} />
                            </button>
                        </div>

                        {/* Next Step Recommendation */}
                        {isEditMode && nextStep && (
                            <div
                                onClick={nextStep.action}
                                style={{
                                    marginTop: 'var(--space-3)',
                                    padding: 'var(--space-3) var(--space-4)',
                                    borderRadius: 'var(--radius-lg)',
                                    background: `color-mix(in srgb, ${nextStep.color} 8%, transparent)`,
                                    border: `1px solid color-mix(in srgb, ${nextStep.color} 25%, transparent)`,
                                    display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                                    cursor: nextStep.action ? 'pointer' : 'default',
                                    transition: 'var(--transition-fast)',
                                }}
                            >
                                <div style={{ color: nextStep.color, flexShrink: 0 }}>{nextStep.icon}</div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-bold)', color: nextStep.color }}>
                                        Próximo passo: {nextStep.label}
                                    </div>
                                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', marginTop: '1px' }}>
                                        {nextStep.desc}
                                    </div>
                                </div>
                                {nextStep.action && <ChevronRight size={16} style={{ color: nextStep.color, flexShrink: 0 }} />}
                            </div>
                        )}

                        {/* Tab switcher for edit mode */}
                        {isEditMode && (
                            <div style={{ display: 'flex', gap: '2px', marginTop: 'var(--space-3)', background: 'var(--color-bg-body)', borderRadius: 'var(--radius-md)', padding: '2px' }}>
                                <button type="button" onClick={() => setHubTab('hub')} style={{
                                    flex: 1, padding: 'var(--space-2)', borderRadius: 'var(--radius-sm)', border: 'none', cursor: 'pointer',
                                    fontSize: 'var(--text-sm)', fontWeight: 'var(--font-semibold)', transition: 'var(--transition-fast)',
                                    background: hubTab === 'hub' ? 'var(--color-bg-surface)' : 'transparent',
                                    color: hubTab === 'hub' ? 'var(--color-primary)' : 'var(--color-text-tertiary)',
                                    boxShadow: hubTab === 'hub' ? 'var(--shadow-sm)' : 'none',
                                }}>🎯 Hub Operacional</button>
                                <button type="button" onClick={() => setHubTab('form')} style={{
                                    flex: 1, padding: 'var(--space-2)', borderRadius: 'var(--radius-sm)', border: 'none', cursor: 'pointer',
                                    fontSize: 'var(--text-sm)', fontWeight: 'var(--font-semibold)', transition: 'var(--transition-fast)',
                                    background: hubTab === 'form' ? 'var(--color-bg-surface)' : 'transparent',
                                    color: hubTab === 'form' ? 'var(--color-primary)' : 'var(--color-text-tertiary)',
                                    boxShadow: hubTab === 'form' ? 'var(--shadow-sm)' : 'none',
                                }}>📝 Dados do Processo</button>
                            </div>
                        )}
                    </div>

                    {/* ═══ HUB OPERACIONAL ═══ */}
                    {isEditMode && hubTab === 'hub' && (
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
                                                    else if (aiAnalysisData) setShowAiModal(true);
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
                                                        <div style={{ padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg-surface)', textAlign: 'center' }}>
                                                            <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--font-bold)', color: 'var(--color-primary)' }}>{docsCount}</div>
                                                            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>Docs exigidos</div>
                                                        </div>
                                                        <div style={{ padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg-surface)', textAlign: 'center' }}>
                                                            <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--font-bold)', color: flagsCount > 0 ? 'var(--color-danger)' : 'var(--color-success)' }}>{flagsCount}</div>
                                                            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>Alertas / Red flags</div>
                                                        </div>
                                                        <div style={{ padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg-surface)', textAlign: 'center' }}>
                                                            <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--font-bold)', color: 'var(--color-warning)' }}>{deadlinesCount}</div>
                                                            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>Prazos identificados</div>
                                                        </div>
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
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-3)' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                                            <FileText size={16} color="var(--color-text-tertiary)" />
                                            <span style={{ fontWeight: 'var(--font-semibold)', fontSize: 'var(--text-sm)' }}>Pendências Documentais</span>
                                        </div>
                                        <button type="button" onClick={() => { onClose(); onNavigateToModule?.('companies'); }} style={{
                                            background: 'none', border: 'none', cursor: 'pointer',
                                            fontSize: 'var(--text-xs)', color: 'var(--color-primary)', fontWeight: 'var(--font-semibold)',
                                        }}>Gerenciar →</button>
                                    </div>
                                    {formData.companyProfileId ? (
                                        companyDocs.length > 0 ? (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', maxHeight: 180, overflowY: 'auto' }}>
                                                {companyDocs
                                                    .filter(d => d.status !== 'Válido')
                                                    .sort((a, b) => (a.daysLeft || 999) - (b.daysLeft || 999))
                                                    .slice(0, 6)
                                                    .map((doc, i) => (
                                                        <div key={i} style={{
                                                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                                            padding: 'var(--space-2) var(--space-3)',
                                                            borderRadius: 'var(--radius-md)',
                                                            background: doc.status === 'Vencido' || doc.status === 'Crítico' ? 'var(--color-danger-bg)' : 'var(--color-warning-bg)',
                                                            fontSize: 'var(--text-sm)',
                                                        }}>
                                                            <span style={{ color: 'var(--color-text-primary)', fontWeight: 'var(--font-medium)' }}>{doc.docType}</span>
                                                            <span style={{
                                                                fontSize: 'var(--text-xs)', fontWeight: 'var(--font-bold)',
                                                                color: doc.status === 'Vencido' || doc.status === 'Crítico' ? 'var(--color-danger)' : 'var(--color-warning)',
                                                            }}>
                                                                {doc.status === 'Vencido' ? '⛔ Vencido' : doc.status === 'Crítico' ? '🔴 Crítico' : `⚠️ ${doc.daysLeft}d`}
                                                            </span>
                                                        </div>
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
                                <div style={{
                                    padding: 'var(--space-5)',
                                    borderRadius: 'var(--radius-xl)',
                                    background: 'var(--color-bg-body)',
                                    border: '1px solid var(--color-border)',
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
                                        <Shield size={16} color="var(--color-text-tertiary)" />
                                        <span style={{ fontWeight: 'var(--font-semibold)', fontSize: 'var(--text-sm)' }}>Aptidão da Empresa</span>
                                    </div>
                                    {(() => {
                                        const company = companies.find(c => c.id === formData.companyProfileId);
                                        if (!company) return <p style={{ margin: 0, fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)', textAlign: 'center', padding: 'var(--space-3)' }}>Selecione uma empresa.</p>;
                                        const expiredCount = companyDocs.filter(d => d.status === 'Vencido' || d.status === 'Crítico').length;
                                        const totalDocs = companyDocs.length;
                                        const validCount = companyDocs.filter(d => d.status === 'Válido').length;
                                        const hasQual = !!company.qualification;
                                        const hasTechQual = !!company.technicalQualification;
                                        const checks = [
                                            { label: 'Habilitação jurídica', ok: hasQual, detail: hasQual ? 'Cadastrada' : 'Não informada' },
                                            { label: 'Qualificação técnica', ok: hasTechQual, detail: hasTechQual ? 'Cadastrada' : 'Não informada' },
                                            { label: 'Documentos vigentes', ok: expiredCount === 0 && totalDocs > 0, detail: totalDocs > 0 ? `${validCount}/${totalDocs} válidos` : 'Nenhum' },
                                            { label: 'Credenciais de portal', ok: credentials.length > 0, detail: credentials.length > 0 ? `${credentials.length} cadastrada(s)` : 'Nenhuma' },
                                        ];
                                        const readyCount = checks.filter(c => c.ok).length;
                                        return (
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                                                {checks.map((check, i) => (
                                                    <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--space-2) 0' }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                                                            {check.ok
                                                                ? <CheckCircle size={14} color="var(--color-success)" />
                                                                : <AlertTriangle size={14} color="var(--color-warning)" />}
                                                            <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-primary)' }}>{check.label}</span>
                                                        </div>
                                                        <span style={{ fontSize: 'var(--text-xs)', color: check.ok ? 'var(--color-success)' : 'var(--color-warning)', fontWeight: 'var(--font-semibold)' }}>
                                                            {check.detail}
                                                        </span>
                                                    </div>
                                                ))}
                                                <div style={{
                                                    marginTop: 'var(--space-2)', padding: 'var(--space-2) var(--space-3)',
                                                    borderRadius: 'var(--radius-md)', textAlign: 'center',
                                                    fontSize: 'var(--text-xs)', fontWeight: 'var(--font-bold)',
                                                    background: readyCount === 4 ? 'var(--color-success-bg)' : readyCount >= 2 ? 'var(--color-warning-bg)' : 'var(--color-danger-bg)',
                                                    color: readyCount === 4 ? 'var(--color-success)' : readyCount >= 2 ? 'var(--color-warning)' : 'var(--color-danger)',
                                                }}>
                                                    {readyCount === 4 ? '✅ Empresa apta para licitar' : readyCount >= 2 ? '⚠️ Parcialmente apta' : '❌ Empresa com pendências críticas'}
                                                </div>
                                            </div>
                                        );
                                    })()}
                                </div>

                                {/* ── Quick Actions Grid ── */}
                                <div style={{ gridColumn: '1 / -1' }}>
                                    <label style={{ ...labelStyle, marginBottom: 'var(--space-3)' }}>Ações Rápidas</label>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-3)' }}>
                                        {[
                                            { label: 'Análise IA', desc: 'Relatório inteligente do edital', icon: <Brain size={20} />, color: 'var(--color-ai)', border: 'var(--color-ai-border)', module: 'intelligence', hasAnalysis: !!initialData?.aiAnalysis },
                                            { label: 'Proposta', desc: 'Planilha e carta comercial', icon: <DollarSign size={20} />, color: 'var(--color-primary)', border: 'var(--color-border)', module: 'production-proposal' },
                                            { label: 'Dossiê', desc: 'Montagem documental completa', icon: <FileArchive size={20} />, color: 'var(--color-urgency)', border: 'var(--color-border)', module: 'production-dossier' },
                                            { label: 'Declarações', desc: 'Gerar declarações legais', icon: <Sparkles size={20} />, color: 'var(--color-success)', border: 'var(--color-border)', module: 'production-declaration' },
                                            { label: 'Petição', desc: 'Impugnação ou recurso', icon: <Scale size={20} />, color: 'var(--color-warning)', border: 'var(--color-border)', module: 'production-petition' },
                                            { label: 'Monitor Chat', desc: 'Sessão em tempo real', icon: <Monitor size={20} />, color: 'var(--color-text-secondary)', border: 'var(--color-border)', module: 'monitoring' },
                                        ].map((action, i) => (
                                            <button
                                                key={i}
                                                type="button"
                                                className="card card-interactive"
                                                onClick={() => {
                                                    onClose();
                                                    onNavigateToModule?.(action.module, initialData?.id);
                                                }}
                                                style={{
                                                    padding: 'var(--space-4)',
                                                    display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)',
                                                    border: `1px solid ${action.border}`,
                                                    textAlign: 'left',
                                                }}
                                            >
                                                <div style={{ color: action.color, flexShrink: 0 }}>{action.icon}</div>
                                                <div>
                                                    <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-bold)', color: 'var(--color-text-primary)' }}>{action.label}</div>
                                                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', marginTop: '2px' }}>{action.desc}</div>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* ── Observações inline (resumo) ── */}
                                <div style={{ gridColumn: '1 / -1' }}>
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
                    )}

                    {/* ═══ FORM TAB ═══ */}
                    <form onSubmit={handleSubmit} style={{ padding: 'var(--space-8)', overflowY: 'auto', flex: 1, display: (!isEditMode || hubTab === 'form') ? undefined : 'none' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-6)' }}>

                            {/* Título */}
                            <div style={{ gridColumn: '1 / -1' }}>
                                <label style={labelStyle}>Título / Identificação do Processo *</label>
                                <div style={inputContainerStyle}>
                                    <input
                                        type="text"
                                        name="title"
                                        style={inputInnerStyle}
                                        placeholder="Ex: Pregão Eletrônico 01/2026 - Material de Expediente"
                                        value={formData.title || ''}
                                        onChange={handleChange}
                                    />
                                </div>
                            </div>

                            {/* Empresa Participante */}
                            <div style={{ gridColumn: '1 / -1' }}>
                                <label style={labelStyle}>Empresa Participante</label>
                                <div style={inputContainerStyle}>
                                    <select
                                        name="companyProfileId"
                                        value={formData.companyProfileId || ''}
                                        onChange={handleChange}
                                        style={inputInnerStyle}
                                    >
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
                            <div style={{ gridColumn: '1 / -1' }}>
                                <label style={labelStyle}>Objeto Resumido</label>
                                <div style={{ ...inputContainerStyle, alignItems: 'flex-start' }}>
                                    <textarea
                                        name="summary"
                                        style={{ ...inputInnerStyle, height: '80px', resize: 'none' }}
                                        placeholder="Descrição breve do que está sendo licitado..."
                                        value={formData.summary || ''}
                                        onChange={handleChange}
                                    />
                                </div>
                            </div>

                            {/* Portal e Modalidade */}
                            <div>
                                <label style={labelStyle}>Portal / Origem *</label>
                                <div style={inputContainerStyle}>
                                    <Globe size={18} color="var(--color-text-tertiary)" />
                                    <input
                                        type="text"
                                        name="portal"
                                        style={inputInnerStyle}
                                        placeholder="Ex: ComprasNet"
                                        value={formData.portal || ''}
                                        onChange={handleChange}
                                    />
                                </div>
                            </div>
                            <div>
                                <label style={labelStyle}>Modalidade *</label>
                                <div style={inputContainerStyle}>
                                    <Tag size={18} color="var(--color-text-tertiary)" />
                                    <input
                                        type="text"
                                        name="modality"
                                        style={inputInnerStyle}
                                        placeholder="Ex: Pregão Eletrônico"
                                        value={formData.modality || ''}
                                        onChange={handleChange}
                                    />
                                </div>
                            </div>

                            {/* Valor, Data e Risco */}
                            {/* ComprasNet Fields — only when portal indicates comprasnet */}
                            {(formData.portal?.toLowerCase().includes('compras') || formData.portal?.toLowerCase().includes('cnet') || formData.link?.toLowerCase().includes('comprasnet') || formData.link?.toLowerCase().includes('cnetmobile')) && (
                                <div style={{ gridColumn: '1 / -1', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-md)', padding: 'var(--space-4)', border: '1px solid var(--color-border)' }}>
                                    <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-semibold)', color: 'var(--color-primary)', marginBottom: 'var(--space-3)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                        📡 Dados ComprasNet (para monitoramento de chat)
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 'var(--space-3)' }}>
                                        <div>
                                            <label style={{ ...labelStyle, fontSize: '0.7rem' }}>UASG</label>
                                            <input type="text" name="uasg" style={{ ...inputInnerStyle, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '8px 12px' }}
                                                placeholder="Ex: 943001" value={formData.uasg || ''} onChange={handleChange} />
                                        </div>
                                        <div>
                                            <label style={{ ...labelStyle, fontSize: '0.7rem' }}>Cód. Modalidade</label>
                                            <select name="modalityCode" style={{ ...inputInnerStyle, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '8px 12px' }}
                                                value={formData.modalityCode || ''} onChange={handleChange}>
                                                <option value="">Selecione</option>
                                                <option value="5">5 - Pregão Eletrônico</option>
                                                <option value="6">6 - Concorrência Eletrônica</option>
                                                <option value="1">1 - Convite</option>
                                                <option value="2">2 - Tomada de Preços</option>
                                                <option value="3">3 - Concorrência</option>
                                                <option value="4">4 - Pregão</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label style={{ ...labelStyle, fontSize: '0.7rem' }}>Nº Processo</label>
                                            <input type="text" name="processNumber" style={{ ...inputInnerStyle, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '8px 12px' }}
                                                placeholder="Ex: 91398" value={formData.processNumber || ''} onChange={handleChange} />
                                        </div>
                                        <div>
                                            <label style={{ ...labelStyle, fontSize: '0.7rem' }}>Ano</label>
                                            <input type="text" name="processYear" style={{ ...inputInnerStyle, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', padding: '8px 12px' }}
                                                placeholder="Ex: 2025" value={formData.processYear || ''} onChange={handleChange} />
                                        </div>
                                    </div>
                                </div>
                            )}
                            <div>
                                <label style={labelStyle}>Valor Estimado (R$)</label>
                                <div style={inputContainerStyle}>
                                    <DollarSign size={18} color="var(--color-text-tertiary)" />
                                    <input
                                        type="number"
                                        step="0.01"
                                        name="estimatedValue"
                                        style={inputInnerStyle}
                                        value={formData.estimatedValue}
                                        onChange={handleChange}
                                    />
                                </div>
                            </div>
                            <div>
                                <label style={labelStyle}>Data/Hora da Sessão *</label>
                                <div style={inputContainerStyle}>
                                    <Calendar size={18} color="var(--color-text-tertiary)" />
                                    <input
                                        type="datetime-local"
                                        name="sessionDate"
                                        style={inputInnerStyle}
                                        value={formData.sessionDate}
                                        onChange={handleChange}
                                    />
                                </div>
                            </div>
                            <div style={{ gridColumn: '1 / -1' }}>
                                <label style={labelStyle}>Tag de Risco</label>
                                <div style={{ display: 'flex', gap: '12px' }}>
                                    {['Baixo', 'Médio', 'Alto', 'Crítico'].map((level) => (
                                        <button
                                            key={level}
                                            type="button"
                                            onClick={() => setFormData(p => ({ ...p, risk: level as RiskTag }))}
                                            style={{
                                                flex: 1,
                                                padding: 'var(--space-3)',
                                                borderRadius: 'var(--radius-md)',
                                                border: '1px solid var(--color-border)',
                                                background: formData.risk === level ? 'var(--color-bg-surface-hover)' : 'var(--color-bg-surface)',
                                                color: formData.risk === level ? (
                                                    level === 'Crítico' ? 'var(--color-danger)' :
                                                        level === 'Alto' ? 'var(--color-danger)' :
                                                            level === 'Médio' ? 'var(--color-warning)' : 'var(--color-success)'
                                                ) : 'var(--color-text-secondary)',
                                                fontWeight: formData.risk === level ? 'var(--font-semibold)' : 'var(--font-normal)',
                                                boxShadow: formData.risk === level ? 'inset 0 2px 4px rgba(0,0,0,0.05)' : 'none',
                                                transition: 'var(--transition-fast)',
                                                borderColor: formData.risk === level ? 'currentColor' : 'var(--color-border)'
                                            }}
                                        >
                                            {level}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Link / Upload + PDF Viewer + Credenciais */}
                            <div style={{ gridColumn: '1 / -1' }}>
                                <label style={labelStyle}>Documentos do Edital / TR</label>

                                {/* ── External Portal Link (PNCP / Other) ── */}
                                {(() => {
                                    const allParts = (formData.link || '').split(',').map(s => s.trim()).filter(s => s);
                                    const externalLinks = allParts.filter(s => s.startsWith('http'));
                                    const uploadPaths = allParts.filter(s => s.startsWith('/uploads/'));

                                    return (
                                        <>
                                            {/* External link input */}
                                            <div style={{ display: 'flex', gap: '12px', marginBottom: '10px' }}>
                                                <div style={{ ...inputContainerStyle, flex: 1 }}>
                                                    <Globe size={18} color="var(--color-text-tertiary)" />
                                                    <input
                                                        type="text"
                                                        style={inputInnerStyle}
                                                        placeholder="Link do portal de compras (PNCP, ComprasNet, etc.)"
                                                        value={externalLinks.join(', ')}
                                                        onChange={(e) => {
                                                            const newExternalLinks = e.target.value;
                                                            const newLink = [newExternalLinks, ...uploadPaths].filter(s => s.trim()).join(', ');
                                                            setFormData(prev => ({ ...prev, link: newLink }));
                                                        }}
                                                    />
                                                    {externalLinks.length > 0 && externalLinks[0].startsWith('http') && (
                                                        <a href={externalLinks[0]} target="_blank" rel="noopener noreferrer" style={{ flexShrink: 0, color: 'var(--color-primary)', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap' }}>
                                                            <ExternalLink size={16} /> Abrir
                                                        </a>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Upload section */}
                                            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                                                <div style={{ ...inputContainerStyle, flex: 1, background: 'var(--color-bg-body)', borderStyle: 'dashed' }}>
                                                    <Link size={18} color="var(--color-text-tertiary)" />
                                                    <span style={{ color: 'var(--color-text-tertiary)', fontSize: '0.85rem' }}>
                                                        {uploadPaths.length > 0 ? `${uploadPaths.length} arquivo(s) anexado(s)` : 'Nenhum edital anexado'}
                                                    </span>
                                                </div>
                                                <input
                                                    type="file"
                                                    ref={fileInputRef}
                                                    style={{ display: 'none' }}
                                                    onChange={handleFileChange}
                                                    multiple
                                                    accept="application/pdf"
                                                />
                                                <button
                                                    type="button"
                                                    className="btn btn-outline"
                                                    onClick={handleFileUploadClick}
                                                    disabled={isUploading}
                                                    style={{ padding: '0 20px', display: 'flex', alignItems: 'center', gap: '8px' }}
                                                >
                                                    {isUploading ? <Loader2 size={18} className="spinner" /> : <UploadCloud size={18} />}
                                                    Anexar PDF
                                                </button>
                                            </div>
                                        </>
                                    );
                                })()}

                                {/* ── Attached Files Chips + Viewer ── */}
                                {formData.link && formData.link.includes('/uploads/') && (() => {
                                    const allParts = formData.link.split(',').map(s => s.trim()).filter(s => s);
                                    const pdfFiles = allParts.filter(s => s.startsWith('/uploads/'));
                                    if (pdfFiles.length === 0) return null;
                                    return (
                                        <div style={{ marginTop: '10px' }}>
                                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: viewingPdf ? '12px' : 0 }}>
                                                {pdfFiles.map((file, idx) => {
                                                    const name = decodeURIComponent(file.split('/').pop() || `Edital_${idx + 1}.pdf`);
                                                    const shortName = name.length > 30 ? name.substring(0, 28) + '...' : name;
                                                    const isViewing = viewingPdf === file;
                                                    return (
                                                        <div key={idx} style={{
                                                            display: 'flex', alignItems: 'center', gap: '6px',
                                                            padding: '6px 12px', borderRadius: '20px',
                                                            border: isViewing ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                                                            background: isViewing ? 'rgba(59,130,246,0.06)' : 'var(--color-bg-body)',
                                                            fontSize: '0.75rem', fontWeight: 500
                                                        }}>
                                                            <span style={{ color: 'var(--color-danger)' }}>📄</span>
                                                            <span style={{ color: 'var(--color-text-primary)', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{shortName}</span>
                                                            <button
                                                                type="button"
                                                                onClick={() => setViewingPdf(isViewing ? null : file)}
                                                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: isViewing ? 'var(--color-primary)' : 'var(--color-text-tertiary)', fontWeight: 600, fontSize: '0.7rem' }}
                                                                title="Visualizar PDF"
                                                            >
                                                                {isViewing ? '✕ Fechar' : '👁 Visualizar'}
                                                            </button>
                                                            <a
                                                                href={`${API_BASE_URL}${file}`}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                style={{ color: 'var(--color-text-tertiary)', fontSize: '0.7rem', textDecoration: 'none' }}
                                                                title="Abrir em nova aba"
                                                            >
                                                                ↗
                                                            </a>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                            {/* ── Inline PDF Viewer ── */}
                                            {viewingPdf && (
                                                <div style={{
                                                    border: '1px solid var(--color-border)',
                                                    borderRadius: 'var(--radius-lg)',
                                                    overflow: 'hidden',
                                                    background: 'var(--color-text-secondary)',
                                                    position: 'relative'
                                                }}>
                                                    <div style={{
                                                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                                        padding: '8px 14px', background: 'var(--color-bg-surface)',
                                                        borderBottom: '1px solid var(--color-border)',
                                                        fontSize: '0.75rem'
                                                    }}>
                                                        <span style={{ color: 'var(--color-text-secondary)', fontWeight: 600 }}>
                                                            📄 Visualizador de Documento
                                                        </span>
                                                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                            <a
                                                                href={`${API_BASE_URL}${viewingPdf}`}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                                className="btn btn-secondary"
                                                                style={{ padding: '4px 10px', fontSize: '0.7rem' }}
                                                            >
                                                                Abrir em Nova Aba ↗
                                                            </a>
                                                            <button
                                                                type="button"
                                                                onClick={() => setViewingPdf(null)}
                                                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: 'var(--color-text-tertiary)' }}
                                                            >
                                                                <X size={16} />
                                                            </button>
                                                        </div>
                                                    </div>
                                                    <iframe
                                                        src={`${API_BASE_URL}${viewingPdf}`}
                                                        style={{ width: '100%', height: '500px', border: 'none' }}
                                                        title="Visualizador de PDF"
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    );
                                })()}

                                {/* ── Credential Integration (AI-matched) ── */}
                                {credentials.length > 0 && (() => {
                                    const portal = (formData.portal || '').toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
                                    const link = (formData.link || '').toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');

                                    // Score each credential for match
                                    const scored = credentials.map(cred => {
                                        const cp = cred.platform.toLowerCase();
                                        const cu = (cred.url || '').toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
                                        let score = 0;

                                        // Exact URL match
                                        if (cu && portal && (cu.includes(portal) || portal.includes(cu))) score += 10;
                                        if (cu && link && (cu.includes(link) || link.includes(cu))) score += 10;
                                        // Platform name match
                                        if (cp && portal && (cp.includes(portal) || portal.includes(cp))) score += 5;
                                        if (cp && link && link.includes(cp)) score += 5;
                                        // Partial domain match
                                        const portalDomain = portal.split('/')[0];
                                        const credDomain = cu.split('/')[0];
                                        if (portalDomain && credDomain && (portalDomain.includes(credDomain) || credDomain.includes(portalDomain))) score += 8;

                                        return { cred, score };
                                    });

                                    scored.sort((a, b) => b.score - a.score);
                                    const bestMatch = scored[0]?.score > 0 ? scored[0].cred.id : null;

                                    return (
                                        <div style={{
                                            marginTop: 'var(--space-3)',
                                            padding: 'var(--space-4) var(--space-5)',
                                            background: 'var(--color-ai-bg)',
                                            borderRadius: 'var(--radius-xl)',
                                            border: '1px solid var(--color-ai-border)'
                                        }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--color-ai)', marginBottom: 'var(--space-3)' }}>
                                                <KeyRound size={16} />
                                                <span style={{ fontWeight: 'var(--font-semibold)', fontSize: 'var(--text-base)' }}>Credenciais de Acesso ao Portal</span>
                                                {bestMatch && (
                                                    <span style={{
                                                        marginLeft: 'auto', padding: '3px 10px',
                                                        background: 'linear-gradient(135deg, var(--color-ai), var(--color-ai-hover))',
                                                        color: 'white', borderRadius: 'var(--radius-lg)',
                                                        fontSize: 'var(--text-xs)', fontWeight: 'var(--font-bold)',
                                                        display: 'flex', alignItems: 'center', gap: '4px'
                                                    }}>
                                                        ✨ IA identificou a credencial
                                                    </span>
                                                )}
                                            </div>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                                                {scored.map(({ cred, score: _score }) => {
                                                    const isMatch = cred.id === bestMatch;
                                                    return (
                                                        <div key={cred.id} style={{
                                                            padding: isMatch ? 'var(--space-4)' : 'var(--space-3)',
                                                            background: isMatch ? 'var(--color-ai-bg)' : 'var(--color-bg-surface)',
                                                            borderRadius: 'var(--radius-lg)',
                                                            border: isMatch ? '2px solid var(--color-ai)' : '1px solid var(--color-border)',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: 'var(--space-4)',
                                                            flexWrap: 'wrap',
                                                            transition: 'var(--transition-fast)',
                                                            position: 'relative'
                                                        }}>
                                                            {isMatch && (
                                                                <span style={{
                                                                    position: 'absolute', top: -8, right: 12,
                                                                    padding: '2px 8px', background: 'var(--color-success)',
                                                                    color: 'white', borderRadius: 'var(--radius-md)',
                                                                    fontSize: 'var(--text-xs)', fontWeight: 'var(--font-bold)'
                                                                }}>
                                                                    ✓ RECOMENDADA
                                                                </span>
                                                            )}
                                                            <div style={{ flex: '1 1 120px', minWidth: '120px' }}>
                                                                <span style={{
                                                                    fontSize: 'var(--text-xs)', fontWeight: 'var(--font-bold)',
                                                                    textTransform: 'uppercase',
                                                                    color: isMatch ? 'var(--color-ai)' : 'var(--color-text-tertiary)',
                                                                    letterSpacing: '0.05em'
                                                                }}>
                                                                    {cred.platform}
                                                                </span>
                                                                {cred.url && (
                                                                    <a href={cred.url} target="_blank" rel="noopener noreferrer" style={{
                                                                        display: 'block', fontSize: '0.72rem',
                                                                        color: isMatch ? 'var(--color-primary)' : 'var(--color-text-tertiary)',
                                                                        marginTop: '2px'
                                                                    }}>
                                                                        {cred.url.replace(/^https?:\/\//, '').slice(0, 40)}{cred.url.length > 45 ? '...' : ''}
                                                                    </a>
                                                                )}
                                                            </div>
                                                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                                <div style={{
                                                                    padding: '6px 12px', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-md)',
                                                                    border: '1px solid var(--color-border)', fontSize: 'var(--text-base)',
                                                                    fontFamily: 'monospace', color: 'var(--color-text-primary)'
                                                                }}>
                                                                    {cred.login}
                                                                </div>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleCopy(cred.login, `login-${cred.id}`)}
                                                                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: copiedField === `login-${cred.id}` ? 'var(--color-success)' : 'var(--color-text-tertiary)' }}
                                                                    title="Copiar login"
                                                                >
                                                                    <Copy size={14} />
                                                                </button>
                                                            </div>
                                                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                                <div style={{
                                                                    padding: '6px 12px', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-md)',
                                                                    border: '1px solid var(--color-border)', fontSize: '0.8125rem',
                                                                    fontFamily: 'monospace', color: 'var(--color-text-primary)', minWidth: '80px'
                                                                }}>
                                                                    {showPassword[cred.id] ? (cred.password || '***') : '••••••••'}
                                                                </div>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setShowPassword(prev => ({ ...prev, [cred.id]: !prev[cred.id] }))}
                                                                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: 'var(--color-text-tertiary)' }}
                                                                    title={showPassword[cred.id] ? 'Ocultar senha' : 'Mostrar senha'}
                                                                >
                                                                    {showPassword[cred.id] ? <EyeOff size={14} /> : <Eye size={14} />}
                                                                </button>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleCopy(cred.password || '', `pass-${cred.id}`)}
                                                                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', color: copiedField === `pass-${cred.id}` ? 'var(--color-success)' : 'var(--color-text-tertiary)' }}
                                                                    title="Copiar senha"
                                                                >
                                                                    <Copy size={14} />
                                                                </button>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    );
                                })()}
                            </div>

                            {/* Sistema de Lembrete Inteligente */}
                            <div style={{ gridColumn: '1 / -1' }}>
                                <div style={{
                                    padding: 'var(--space-6)',
                                    background: formData.reminderType === 'weekdays'
                                        ? 'var(--color-urgency-bg)'
                                        : 'var(--color-warning-bg)',
                                    borderRadius: 'var(--radius-xl)',
                                    border: `1px solid ${formData.reminderType === 'weekdays' ? 'var(--color-urgency-border)' : 'var(--color-warning-border)'}`,
                                    transition: 'var(--transition-normal)'
                                }}>
                                    {/* Header */}
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--color-warning-hover)' }}>
                                            <Bell size={18} />
                                            <span style={{ fontWeight: 'var(--font-semibold)' }}>Lembrete Inteligente</span>
                                        </div>
                                        {/* Tipo toggle */}
                                        <div style={{ display: 'flex', gap: '4px', padding: '3px', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
                                            <button
                                                type="button"
                                                onClick={() => setFormData(p => ({ ...p, reminderType: 'once' }))}
                                                style={{
                                                    padding: '5px 14px',
                                                    borderRadius: 'var(--radius-md)',
                                                    border: 'none',
                                                    background: formData.reminderType === 'once' ? 'var(--color-bg-surface)' : 'transparent',
                                                    boxShadow: formData.reminderType === 'once' ? 'var(--shadow-sm)' : 'none',
                                                    color: formData.reminderType === 'once' ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
                                                    fontSize: 'var(--text-sm)',
                                                    fontWeight: 'var(--font-semibold)',
                                                    cursor: 'pointer',
                                                    transition: 'all 0.2s'
                                                }}
                                            >
                                                Único
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setFormData(p => ({ ...p, reminderType: 'weekdays' }))}
                                                style={{
                                                    padding: '5px 14px',
                                                    borderRadius: 'var(--radius-md)',
                                                    border: 'none',
                                                    background: formData.reminderType === 'weekdays' ? 'var(--color-bg-surface)' : 'transparent',
                                                    boxShadow: formData.reminderType === 'weekdays' ? 'var(--shadow-sm)' : 'none',
                                                    color: formData.reminderType === 'weekdays' ? 'var(--color-urgency)' : 'var(--color-text-tertiary)',
                                                    fontSize: 'var(--text-sm)',
                                                    fontWeight: 'var(--font-semibold)',
                                                    cursor: 'pointer',
                                                    transition: 'all 0.2s'
                                                }}
                                            >
                                                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                    <RefreshCw size={11} /> Recorrente
                                                </span>
                                            </button>
                                        </div>
                                    </div>

                                    {/* Date/Time row */}
                                    <div style={{ display: 'flex', gap: '16px', alignItems: 'center', marginBottom: formData.reminderType === 'weekdays' ? '16px' : '0' }}>
                                        <div style={{ ...inputContainerStyle, flex: 1, backgroundColor: 'var(--color-bg-surface)' }}>
                                            <Calendar size={16} color="var(--color-warning-hover)" />
                                            <input
                                                type={formData.reminderType === 'weekdays' ? 'time' : 'datetime-local'}
                                                name="reminderDate"
                                                style={inputInnerStyle}
                                                value={formData.reminderType === 'weekdays'
                                                    ? (formData.reminderDate ? formData.reminderDate.slice(11, 16) : '')
                                                    : (formData.reminderDate || '')
                                                }
                                                onChange={(e) => {
                                                    if (formData.reminderType === 'weekdays') {
                                                        // Store as a full datetime using today's date + selected time
                                                        const today = new Date();
                                                        const [h, m] = e.target.value.split(':');
                                                        today.setHours(parseInt(h), parseInt(m), 0, 0);
                                                        today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
                                                        setFormData(prev => ({ ...prev, reminderDate: today.toISOString().slice(0, 16) }));
                                                    } else {
                                                        handleChange(e);
                                                    }
                                                }}
                                            />
                                        </div>
                                        <p style={{ margin: 0, fontSize: 'var(--text-base)', color: 'var(--color-warning-hover)', maxWidth: '260px', lineHeight: 1.4 }}>
                                            {formData.reminderType === 'weekdays'
                                                ? 'Horário do alarme nos dias selecionados abaixo.'
                                                : 'Um aviso será disparado para toda a equipe no horário configurado.'
                                            }
                                        </p>
                                    </div>

                                    {/* Weekday selector (shown only in recurring mode) */}
                                    {formData.reminderType === 'weekdays' && (() => {
                                        const selectedDays: number[] = (() => {
                                            try { return JSON.parse(formData.reminderDays || '[]'); } catch { return []; }
                                        })();
                                        const dayLabels = [
                                            { num: 1, short: 'Seg', long: 'Segunda' },
                                            { num: 2, short: 'Ter', long: 'Terça' },
                                            { num: 3, short: 'Qua', long: 'Quarta' },
                                            { num: 4, short: 'Qui', long: 'Quinta' },
                                            { num: 5, short: 'Sex', long: 'Sexta' },
                                            { num: 6, short: 'Sáb', long: 'Sábado' },
                                            { num: 0, short: 'Dom', long: 'Domingo' },
                                        ];
                                        const toggleDay = (day: number) => {
                                            const newDays = selectedDays.includes(day)
                                                ? selectedDays.filter(d => d !== day)
                                                : [...selectedDays, day];
                                            setFormData(prev => ({ ...prev, reminderDays: JSON.stringify(newDays) }));
                                        };
                                        const weekdaysOnly = [1, 2, 3, 4, 5];
                                        const allDays = [0, 1, 2, 3, 4, 5, 6];
                                        const isWeekdaysSelected = weekdaysOnly.every(d => selectedDays.includes(d)) && selectedDays.length === 5;
                                        const isAllSelected = allDays.every(d => selectedDays.includes(d));

                                        return (
                                            <div>
                                                <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
                                                    {dayLabels.map(day => (
                                                        <button
                                                            key={day.num}
                                                            type="button"
                                                            onClick={() => toggleDay(day.num)}
                                                            title={day.long}
                                                            style={{
                                                                flex: 1,
                                                                padding: '8px 0',
                                                                borderRadius: 'var(--radius-lg)',
                                                                border: `2px solid ${selectedDays.includes(day.num) ? 'var(--color-warning)' : 'var(--color-border)'}`,
                                                                background: selectedDays.includes(day.num)
                                                                    ? 'linear-gradient(135deg, var(--color-warning), var(--color-warning-hover))'
                                                                    : 'var(--color-bg-surface)',
                                                                color: selectedDays.includes(day.num) ? 'white' : 'var(--color-text-tertiary)',
                                                                fontSize: '0.75rem',
                                                                fontWeight: 700,
                                                                cursor: 'pointer',
                                                                transition: 'var(--transition-fast)',
                                                                boxShadow: selectedDays.includes(day.num) ? '0 2px 8px rgba(245, 158, 11, 0.3)' : 'none'
                                                            }}
                                                        >
                                                            {day.short}
                                                        </button>
                                                    ))}
                                                </div>
                                                {/* Quick presets */}
                                                <div style={{ display: 'flex', gap: '8px' }}>
                                                    <button
                                                        type="button"
                                                        onClick={() => setFormData(prev => ({ ...prev, reminderDays: JSON.stringify(weekdaysOnly) }))}
                                                        style={{
                                                            padding: '4px 12px',
                                                            borderRadius: 'var(--radius-md)',
                                                            border: `1px solid ${isWeekdaysSelected ? 'var(--color-warning)' : 'var(--color-border)'}`,
                                                            background: isWeekdaysSelected ? 'var(--color-warning-bg)' : 'var(--color-bg-surface)',
                                                            color: isWeekdaysSelected ? 'var(--color-warning-hover)' : 'var(--color-text-secondary)',
                                                            fontSize: '0.6875rem',
                                                            fontWeight: 600,
                                                            cursor: 'pointer'
                                                        }}
                                                    >
                                                        Dias úteis
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => setFormData(prev => ({ ...prev, reminderDays: JSON.stringify(allDays) }))}
                                                        style={{
                                                            padding: '4px 12px',
                                                            borderRadius: 'var(--radius-md)',
                                                            border: `1px solid ${isAllSelected ? 'var(--color-warning)' : 'var(--color-border)'}`,
                                                            background: isAllSelected ? 'var(--color-warning-bg)' : 'var(--color-bg-surface)',
                                                            color: isAllSelected ? 'var(--color-warning-hover)' : 'var(--color-text-secondary)',
                                                            fontSize: '0.6875rem',
                                                            fontWeight: 600,
                                                            cursor: 'pointer'
                                                        }}
                                                    >
                                                        Todos os dias
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => setFormData(prev => ({ ...prev, reminderDays: '[]' }))}
                                                        style={{
                                                            padding: '4px 12px',
                                                            borderRadius: 'var(--radius-md)',
                                                            border: '1px solid var(--color-border)',
                                                            background: 'var(--color-bg-surface)',
                                                            color: 'var(--color-text-tertiary)',
                                                            fontSize: '0.6875rem',
                                                            fontWeight: 600,
                                                            cursor: 'pointer'
                                                        }}
                                                    >
                                                        Limpar
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })()}
                                </div>
                            </div>

                            {/* Observações */}
                            <div style={{ gridColumn: '1 / -1' }}>
                                <label style={labelStyle}>Historico de Observações</label>
                                <div style={{
                                    background: 'var(--color-bg-base)',
                                    borderRadius: 'var(--radius-xl)',
                                    border: '1px solid var(--color-border)',
                                    padding: 'var(--space-5)',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '16px'
                                }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '180px', overflowY: 'auto' }}>
                                        {observations.length === 0 ? (
                                            <div style={{ textAlign: 'center', padding: '20px', color: 'var(--color-text-tertiary)' }}>
                                                <MessageSquare size={32} style={{ marginBottom: '8px', opacity: 0.2 }} />
                                                <p style={{ margin: 0, fontSize: '0.875rem' }}>Nenhum comentário registrado.</p>
                                            </div>
                                        ) : (
                                            observations.map(obs => (
                                                <div key={obs.id} style={{
                                                    padding: '12px 16px',
                                                    background: 'var(--color-bg-surface)',
                                                    borderRadius: '0.75rem',
                                                    border: '1px solid var(--color-border)',
                                                    boxShadow: 'var(--shadow-sm)'
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
                                            <input
                                                value={newObservation}
                                                onChange={(e) => setNewObservation(e.target.value)}
                                                style={inputInnerStyle}
                                                placeholder="Adicionar atualização..."
                                                onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddObservation())}
                                            />
                                        </div>
                                        <button
                                            type="button"
                                            className="btn btn-primary"
                                            onClick={handleAddObservation}
                                            style={{ padding: '12px', borderRadius: 'var(--radius-md)' }}
                                        >
                                            <PlusCircle size={20} />
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Ações rápidas movidas para o Hub Operacional */}

                        </div>

                        <div style={{
                            marginTop: 'var(--space-10)',
                            display: 'flex',
                            gap: 'var(--space-3)',
                            justifyContent: 'flex-end',
                            paddingTop: 'var(--space-6)',
                            borderTop: '1px solid var(--color-border)'
                        }}>
                            {(onRequestAiAnalysis || aiAnalysisData) && (
                                <button
                                    type="button"
                                    className="btn btn-secondary"
                                    onClick={() => {
                                        if (onRequestAiAnalysis) {
                                            onRequestAiAnalysis();
                                        } else {
                                            setShowAiModal(true);
                                        }
                                    }}
                                    style={{
                                        padding: 'var(--space-3) var(--space-6)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 'var(--space-2)',
                                        color: 'var(--color-ai)',
                                        borderColor: 'var(--color-ai-border)',
                                        background: 'var(--color-ai-bg)'
                                    }}
                                >
                                    <Brain size={18} /> Ver Relatório IA
                                </button>
                            )}
                            <button
                                type="button"
                                className="btn btn-primary"
                                onClick={handleAiExtract}
                                style={{
                                    padding: 'var(--space-3) var(--space-6)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 'var(--space-2)',
                                    marginRight: 'auto',
                                    backgroundColor: 'var(--color-ai)',
                                    borderColor: 'var(--color-ai)'
                                }}
                                disabled={isCheckingAi}
                            >
                                {isCheckingAi ? <Loader2 size={18} className="spinner" /> : <Bot size={18} />}
                                {isCheckingAi ? 'Analisando PDF...' : 'IA: Extrair edital'}
                            </button>
                            <button type="button" className="btn btn-outline" onClick={onClose} style={{ padding: 'var(--space-3) var(--space-6)' }}>
                                Cancelar
                            </button>
                            <button
                                type="submit"
                                className="btn btn-primary"
                                style={{
                                    padding: 'var(--space-3) var(--space-10)',
                                    background: 'linear-gradient(135deg, var(--color-primary), var(--color-primary-hover))',
                                    boxShadow: 'var(--shadow-md)',
                                    fontWeight: 'var(--font-semibold)'
                                }}
                            >
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
            {showAiModal && aiAnalysisData && (
                <AiReportModal
                    analysis={aiAnalysisData}
                    process={{ ...formData } as BiddingProcess}
                    onClose={() => setShowAiModal(false)}
                    onUpdate={() => { }} // Not needed here since it's only in memory
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
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    transition: 'var(--transition-fast)',
};

const inputInnerStyle: React.CSSProperties = {
    border: 'none',
    background: 'transparent',
    outline: 'none',
    width: '100%',
    color: 'var(--color-text-primary)',
    fontSize: 'var(--text-base)',
};
