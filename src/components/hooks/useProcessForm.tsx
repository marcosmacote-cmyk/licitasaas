import { useState, useEffect, useRef, useMemo } from 'react';
import { Save, UploadCloud, ScanSearch, ArrowRight, CheckCircle, AlertTriangle, DollarSign, Monitor, Gavel, FileText } from 'lucide-react';
import { API_BASE_URL } from '../../config';
import { v4 as uuidv4 } from 'uuid';
import { useToast } from '../ui';
import type { BiddingProcess, RiskTag, CompanyProfile, ObservationLog, CompanyCredential, AiAnalysis } from '../../types';
import { resolveStage } from '../../governance';

interface UseProcessFormOptions {
    initialData: BiddingProcess | null;
    companies: CompanyProfile[];
    onClose: () => void;
    onSave: (data: Partial<BiddingProcess>, aiData?: any) => void;
    onNavigateToModule?: (module: string, processId?: string) => void;
}

export function useProcessForm({ initialData, companies, onClose, onSave, onNavigateToModule }: UseProcessFormOptions) {
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

    // Initialize form data from initialData
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

    // Credentials
    const [credentials, setCredentials] = useState<CompanyCredential[]>([]);
    const [showPassword, setShowPassword] = useState<Record<string, boolean>>({});
    const [copiedField, setCopiedField] = useState<string | null>(null);

    useEffect(() => {
        if (formData.companyProfileId) {
            const company = companies.find(c => c.id === formData.companyProfileId);
            if (company?.credentials) {
                setCredentials(company.credentials);
            } else {
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

    // File upload
    const fileInputRef = useRef<HTMLInputElement>(null);
    const aiQuickUploadRef = useRef<HTMLInputElement>(null);
    const [isUploading, setIsUploading] = useState(false);
    const [viewingPdf, setViewingPdf] = useState<string | null>(null);

    const nextStep = useMemo(() => {
        const stage = resolveStage(initialData?.status || 'Captado');
        const hasAnalysis = !!initialData?.aiAnalysis;
        const hasPdf = (formData.link || '').includes('.pdf') || (formData.link || '').includes('/uploads/');
        const expiredDocs = companyDocs.filter(d => d.status === 'Vencido' || d.status === 'Crítico');
        const expiringDocs = companyDocs.filter(d => d.status === 'Vencendo' || d.status === 'Alerta');

        if (!isEditMode) return { label: 'Salvar', desc: 'Salve a licitação para desbloquear os módulos operacionais', icon: <Save size={18} />, color: 'var(--color-primary)', action: undefined };

        if (stage === 'Captado') {
            if (!hasPdf) return { label: 'Anexar Edital', desc: 'Envie o PDF do edital para habilitar a análise com IA', icon: <UploadCloud size={18} />, color: 'var(--color-warning)', action: () => setHubTab('form') };
            if (!hasAnalysis) return { label: 'Analisar com LicitIA', desc: 'Execute a análise inteligente do edital para identificar riscos e oportunidades', icon: <ScanSearch size={18} />, color: 'var(--color-ai)', action: handleAiExtract };
            return { label: 'Mover para Análise', desc: 'O edital foi analisado. Avalie os resultados e avance no pipeline', icon: <ArrowRight size={18} />, color: 'var(--color-primary)', action: undefined };
        }
        if (stage === 'Em Análise' || stage === 'Aprovado para Participação') {
            if (!hasAnalysis) return { label: 'Analisar com LicitIA', desc: 'Execute a análise do edital para prosseguir', icon: <ScanSearch size={18} />, color: 'var(--color-ai)', action: handleAiExtract };
            if (expiredDocs.length > 0) return { label: 'Regularizar Documentos', desc: `${expiredDocs.length} documento(s) vencido(s) precisam ser renovados`, icon: <AlertTriangle size={18} />, color: 'var(--color-danger)', action: () => { onClose(); onNavigateToModule?.('companies'); } };
            return { label: 'Preparar Documentação', desc: 'Análise concluída. Inicie a preparação de proposta e documentos', icon: <FileText size={18} />, color: 'var(--color-urgency)', action: undefined };
        }
        if (stage === 'Preparando Documentação' || stage === 'Preparando Proposta') {
            if (expiredDocs.length > 0) return { label: 'Regularizar Documentos', desc: `${expiredDocs.length} documento(s) vencido(s) impedem a participação`, icon: <AlertTriangle size={18} />, color: 'var(--color-danger)', action: () => { onClose(); onNavigateToModule?.('companies'); } };
            return { label: 'Gerar Proposta', desc: 'Monte a proposta comercial para este processo', icon: <DollarSign size={18} />, color: 'var(--color-primary)', action: () => { onClose(); onNavigateToModule?.('production-proposal', initialData?.id); } };
        }
        if (stage === 'Em Sessão') {
            return { label: 'Monitorar Sessão', desc: 'Acompanhe a sessão de disputa em tempo real', icon: <Monitor size={18} />, color: 'var(--color-danger)', action: () => { onClose(); onNavigateToModule?.('monitoring'); } };
        }
        if (stage === 'Pós-Sessão' || stage === 'Recurso') {
            return { label: 'Gerar Petição', desc: 'Prepare uma petição ou impugnação se necessário', icon: <Gavel size={18} />, color: 'var(--color-warning)', action: () => { onClose(); onNavigateToModule?.('production-petition', initialData?.id); } };
        }
        if (expiringDocs.length > 0) {
            return { label: 'Atenção Documental', desc: `${expiringDocs.length} documento(s) próximo(s) do vencimento`, icon: <AlertTriangle size={18} />, color: 'var(--color-warning)', action: () => { onClose(); onNavigateToModule?.('companies'); } };
        }
        return { label: 'Processo atualizado', desc: 'Todas as ações estão em dia. Continue acompanhando.', icon: <CheckCircle size={18} />, color: 'var(--color-success)', action: undefined };
    }, [initialData, formData.link, companyDocs, isEditMode]);

    // ── Handlers ──

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

    // ── Progress state for AI analysis ──
    const [aiProgress, setAiProgress] = useState<{ step: number; total: number; percent: number; message: string; detail?: string } | null>(null);

    // Unified upload + analyze for new processes ("Preencher com IA" banner)
    const handleQuickAiUpload = () => {
        aiQuickUploadRef.current?.click();
    };

    const handleQuickAiFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;
        try {
            setIsCheckingAi(true);
            setAiProgress({ step: 1, total: 5, percent: 10, message: 'Enviando edital ao servidor...', detail: `${files.length} arquivo(s)` });

            // Step 1: Upload files
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
            if (uploadedUrls.length === 0) {
                toast.error('Falha no upload do PDF.');
                return;
            }
            // Store uploaded files in the link field
            setFormData(prev => ({
                ...prev,
                link: prev.link ? `${prev.link}, ${uploadedUrls.join(', ')}` : uploadedUrls.join(', ')
            }));

            setAiProgress({ step: 2, total: 5, percent: 25, message: 'IA extraindo dados do edital...', detail: 'Etapa 1/3 — Extração Factual' });

            // Simulated progress updates while API processes
            const progressTimer = setInterval(() => {
                setAiProgress(prev => {
                    if (!prev || prev.percent >= 90) return prev;
                    const nextPercent = Math.min(prev.percent + 8, 90);
                    const stages = [
                        { at: 40, step: 3, msg: 'IA normalizando categorias...', detail: 'Etapa 2/3 — Normalização' },
                        { at: 60, step: 4, msg: 'IA avaliando riscos jurídicos...', detail: 'Etapa 3/3 — Revisão de Risco' },
                        { at: 80, step: 5, msg: 'Validando e preenchendo campos...', detail: 'Finalizando análise' },
                    ];
                    const stage = stages.filter(s => nextPercent >= s.at).pop();
                    if (stage) return { step: stage.step, total: 5, percent: nextPercent, message: stage.msg, detail: stage.detail };
                    return { ...prev, percent: nextPercent };
                });
            }, 3000);

            // Step 2: Run AI analysis on uploaded files
            const token = localStorage.getItem('token');
            const res = await fetch(`${API_BASE_URL}/api/analyze-edital/v2`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ fileNames: uploadedUrls })
            });

            clearInterval(progressTimer);

            if (!res.ok) {
                const errorLog = await res.json();
                throw new Error(errorLog.error || 'Falha na análise');
            }
            const aiData = await res.json();

            setAiProgress({ step: 5, total: 5, percent: 100, message: 'Campos preenchidos com sucesso!', detail: 'Análise concluída' });

            // Step 3: Fill form fields — extract from schemaV2 when legacy fields are empty
            const schema = aiData.schemaV2;
            const proc = aiData.process || {};

            // Extract summary from schemaV2 or legacy
            const summary = proc.summary || proc.object || schema?.process_identification?.objeto_completo || schema?.process_identification?.objeto_resumido || '';

            // Extract title — format: "Modalidade NumProcesso - ÓRGÃO"
            let title = proc.title || '';
            if (!title && schema?.process_identification) {
                const mod = schema.process_identification.modalidade || '';
                const numProc = schema.process_identification.numero_processo || '';
                const numEdit = schema.process_identification.numero_edital || '';
                const orgao = (schema.process_identification.orgao || '').toUpperCase();
                const numero = numProc || numEdit;
                if (mod && numero && orgao) title = `${mod} ${numero} - ${orgao}`;
                else if (mod && numero) title = `${mod} ${numero}`;
                else if (numero && orgao) title = `${numero} - ${orgao}`;
                else title = schema.process_identification.objeto_resumido || numero || '';
            }

            // Extract modality
            const modality = proc.modality || schema?.process_identification?.modalidade || '';

            // Extract portal — not in legacy, try to detect from links or schema
            let portal = proc.portal || '';
            if (!portal && schema?.process_identification?.links_uteis) {
                const links = Array.isArray(schema.process_identification.links_uteis) 
                    ? schema.process_identification.links_uteis.join(' ') 
                    : String(schema.process_identification.links_uteis || '');
                if (/compras\.gov|comprasnet|cnetmobile|pncp/i.test(links)) portal = 'Compras.gov.br';
                else if (/bnc/i.test(links)) portal = 'BNC';
                else if (/bll/i.test(links)) portal = 'BLL';
                else if (/m2a/i.test(links)) portal = 'M2A';
                else if (/bbmnet/i.test(links)) portal = 'BBMNET';
                else if (/licitanet/i.test(links)) portal = 'Licitanet';
                else if (/portaldecompras|portal de compras/i.test(links)) portal = 'Portal de Compras Públicas';
            }
            // If still no portal, try from orgao name or uploaded file
            if (!portal && schema?.process_identification?.orgao) {
                const orgao = schema.process_identification.orgao.toLowerCase();
                if (orgao.includes('federal') || orgao.includes('ministério')) portal = 'Compras.gov.br';
            }

            // Extract estimatedValue — from legacy or itens_licitados sum
            let estimatedValue = proc.estimatedValue ? parseFloat(String(proc.estimatedValue).replace(/[^\d.,]/g, '').replace(',', '.')) : 0;
            if (!estimatedValue && schema?.proposal_analysis?.itens_licitados) {
                const itens = schema.proposal_analysis.itens_licitados;
                if (Array.isArray(itens) && itens.length > 0) {
                    estimatedValue = itens.reduce((sum: number, it: any) => {
                        const price = parseFloat(String(it.referencePrice || 0)) || 0;
                        const qty = parseFloat(String(it.quantity || 1)) || 1;
                        const mult = parseFloat(String(it.multiplier || 1)) || 1;
                        return sum + (price * qty * mult);
                    }, 0);
                    estimatedValue = Math.round(estimatedValue * 100) / 100;
                }
            }

            // Extract sessionDate — handle PT-BR format (dd/MM/yyyy HH:mm)
            let formattedSessionDate = formData.sessionDate;
            const rawDate = proc.sessionDate || schema?.timeline?.data_sessao || schema?.timeline?.data_abertura_propostas || '';
            if (rawDate) {
                let dateStr = rawDate;
                // Convert PT-BR "27/05/2025 09:00" to ISO
                const ptBrMatch = rawDate.match(/^(\d{2})\/(\d{2})\/(\d{4})\s*(\d{2}:\d{2})?/);
                if (ptBrMatch) {
                    dateStr = `${ptBrMatch[3]}-${ptBrMatch[2]}-${ptBrMatch[1]}T${ptBrMatch[4] || '00:00'}:00`;
                }
                const d = new Date(dateStr);
                if (!isNaN(d.getTime())) {
                    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
                    formattedSessionDate = d.toISOString().slice(0, 16);
                }
            }

            // Auto-calculate risk from critical points (severity is in PT: critica, alta, media, baixa)
            let risk = proc.risk || 'Baixo';
            if (schema?.legal_risk_review?.critical_points) {
                const criticals = schema.legal_risk_review.critical_points.filter((cp: any) => cp.severity === 'critica' || cp.severity === 'alta');
                const medias = schema.legal_risk_review.critical_points.filter((cp: any) => cp.severity === 'media');
                if (criticals.length >= 2) risk = 'Crítico';
                else if (criticals.length >= 1) risk = 'Alto';
                else if (medias.length >= 2) risk = 'Médio';
            }
            // Auto-fill reminder: 24h before session date
            let reminderDate = '';
            if (formattedSessionDate) {
                const sessionD = new Date(formattedSessionDate);
                if (!isNaN(sessionD.getTime())) {
                    sessionD.setHours(sessionD.getHours() - 24);
                    reminderDate = sessionD.toISOString().slice(0, 16);
                }
            }

            setFormData(prev => ({
                ...prev,
                title: title || prev.title,
                summary: summary || prev.summary,
                modality: modality || prev.modality,
                portal: portal || prev.portal,
                estimatedValue: estimatedValue || prev.estimatedValue,
                sessionDate: formattedSessionDate,
                risk: risk as any,
                reminderDate: reminderDate || prev.reminderDate,
            }));

            // Step 4: Store full analysis
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
                    sourceFileNames: JSON.stringify(uploadedUrls),
                    schemaV2: aiData.schemaV2 || null,
                    promptVersion: aiData._prompt_version || null,
                    modelUsed: aiData._model_used || null,
                    pipelineDurationS: aiData._pipeline_duration_s || null,
                    overallConfidence: aiData._overall_confidence || null,
                    analyzedAt: new Date().toISOString()
                };
                setAiAnalysisData(analysisObj);
                toast.success('Edital analisado com sucesso! Campos preenchidos automaticamente.');
            } else {
                toast.success('Campos preenchidos via IA!');
            }
        } catch (e: any) {
            toast.error(`Erro na análise IA: ${e.message}`);
        } finally {
            setIsCheckingAi(false);
            setTimeout(() => setAiProgress(null), 2000);
            if (aiQuickUploadRef.current) aiQuickUploadRef.current.value = '';
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

    return {
        // State
        formData, setFormData,
        observations, newObservation, setNewObservation,
        companyDocs, credentials, hubTab, setHubTab,
        isEditMode, isCheckingAi, isUploading,
        showAiModal, setShowAiModal, aiAnalysisData,
        showPassword, setShowPassword, copiedField,
        viewingPdf, setViewingPdf,
        fileInputRef, aiQuickUploadRef, nextStep, aiProgress,
        // Handlers
        handleChange, handleAddObservation,
        handleFileUploadClick, handleFileChange,
        handleAiExtract, handleQuickAiUpload, handleQuickAiFileChange,
        handleSubmit, handleCopy,
    };
}
