import { useState, useMemo, useCallback, useEffect } from 'react';
import { jsPDF } from 'jspdf';
import { API_BASE_URL } from '../../config';
import type { BiddingProcess, CompanyProfile } from '../../types';
import { useToast } from '../ui';
import { resolveStage, isModuleAllowed } from '../../governance';
import { useSSE, submitBackgroundJob, fetchJobResult } from './useSSE';

// ── Types ──

export type DeclarationStyleOption = 'objetiva' | 'formal' | 'robusta';

export interface QualityIssue {
    code: string;
    severity: 'critical' | 'major' | 'minor';
    message: string;
}

export interface QualityReportFrontend {
    score: number;
    grade: 'A' | 'B' | 'C' | 'D';
    issues: QualityIssue[];
    corrections: string[];
    corrected: boolean;
    family: string;
    attempts: number;
    factualConsistency: boolean;
    declarationTypeMatch: boolean;
    structureAdequate: boolean;
    contaminationDetected: boolean;
}

export interface DeclarationTemplate {
    id: string;
    tenantId: string | null;
    title: string;
    content: string;
    createdAt?: string;
    updatedAt?: string;
}

export interface LayoutConfig {
    id: string;
    name: string;
    headerImage: string | null;
    footerImage: string | null;
    headerImageWidth: number;
    headerImageHeight: number;
    footerImageWidth: number;
    footerImageHeight: number;
    headerText: string;
    footerText: string;
    signatureCity: string;
    signatureDate: string;
    signatoryName: string;
    signatoryRole: string;
    signatoryCpf: string;
    signatoryCompany: string;
    signatoryCnpj: string;
    addresseeName: string;
    addresseeOrg: string;
    doubleSignature: boolean;
    rtName: string;
    rtRole: string;
    rtCpf: string;
    rtRegister: string;
}

export const DEFAULT_LAYOUT: Omit<LayoutConfig, 'id' | 'name'> = {
    headerImage: null, footerImage: null,
    headerImageWidth: 40, headerImageHeight: 20,
    footerImageWidth: 40, footerImageHeight: 20,
    headerText: '', footerText: '',
    signatureCity: '', signatureDate: '',
    signatoryName: '', signatoryRole: '',
    signatoryCpf: '', signatoryCompany: '',
    signatoryCnpj: '',
    addresseeName: 'Agente de Contratação',
    addresseeOrg: '',
    doubleSignature: false,
    rtName: '',
    rtRole: '',
    rtCpf: '',
    rtRegister: '',
};

const STORAGE_KEY = 'declaration_layouts';

function loadLayouts(): LayoutConfig[] {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) { const parsed = JSON.parse(saved); if (Array.isArray(parsed) && parsed.length > 0) return parsed; }
        const old = localStorage.getItem('declaration_layout_config');
        if (old) { const oldParsed = JSON.parse(old); localStorage.removeItem('declaration_layout_config'); return [{ ...DEFAULT_LAYOUT, ...oldParsed, id: 'default', name: 'Layout Principal' }]; }
    } catch { /* ignore */ }
    return [{ ...DEFAULT_LAYOUT, id: 'default', name: 'Layout Principal' } as LayoutConfig];
}

function saveLayouts(layouts: LayoutConfig[]) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(layouts)); } catch { /* ignore */ }
}

export function extractDeclarationTypes(rawReq: any): string[] {
    const declarations: string[] = [];
    try {
        const parsed = typeof rawReq === 'string' ? JSON.parse(rawReq) : rawReq;
        let items: any[] = [];
        if (Array.isArray(parsed)) items = parsed;
        else if (typeof parsed === 'object') items = Object.values(parsed).flat();
        items.forEach((d: any) => {
            const text = typeof d === 'string' ? d : (d.description || '');
            if (!text) return;
            const lower = text.toLowerCase();
            if (lower.includes('declaraç') || lower.includes('declarac') || lower.includes('declare') ||
                lower.includes('indicação do pessoal técnico') || lower.includes('indicacao do pessoal tecnico') ||
                lower.includes('equipe técnica') || lower.includes('equipe tecnica'))
                declarations.push(text);
        });
    } catch { /* ignore */ }
    return declarations;
}

export function findMatchingTemplateLocal(requiredText: string, templates: DeclarationTemplate[]): DeclarationTemplate | null {
    const lowerText = requiredText.toLowerCase();
    
    const matchMap: Record<string, string[]> = {
        'sys-menor': ['menor', 'infantil', 'xxxiii', 'art. 7', 'criança'],
        'sys-impedimento': ['impedimento', 'fato impeditivo', 'superveniente', 'idoneidade', 'inidoneidade'],
        'sys-me-epp': ['me/epp', 'microempresa', 'pequeno porte', 'enquadramento', 'lc 123'],
        'sys-nepotismo': ['nepotismo', 'parentesco', 'terceiro grau'],
        'sys-elaboracao': ['elaboração independente', 'independente', 'conluio'],
        'sys-plena': ['plena', 'plena habilitação', 'art. 63', 'requisitos de habilitação'],
        'sys-vagas': ['vagas', 'pcd', 'deficiente', 'menor aprendiz', 'reserva de vagas'],
        'sys-trabalho-escravo': ['escravo', 'trabalho forçado', 'degradante'],
        'sys-nepotismo-servidores': ['vínculo', 'servidores', 'servidor', 'cargo de direção'],
        'sys-compromisso-edital': ['compromisso', 'aceitação', 'edital', 'termo de referência'],
        'sys-lgpd': ['lgpd', 'lei geral de proteção de dados', 'dados pessoais', 'privacidade'],
        'sys-anticorrupcao': ['anticorrupção', 'ética', 'integridade', 'corrupção', 'fraude'],
        'sys-ceis-cnep': ['ceis', 'cnep', 'cadastro nacional', 'empresas punidas', 'inidôneas'],
        'sys-declinio-vistoria': ['declínio de vistoria', 'renúncia de vistoria', 'não realização de vistoria', 'declínio de visita'],
        'sys-custos-trabalhistas': ['integralidade de custos', 'direitos trabalhistas', 'custos trabalhistas', 'convenções coletivas'],
        'sys-autenticidade-documental': ['autenticidade', 'documentação digital', 'documentos eletrônicos', 'documentos digitais']
    };

    let bestMatch: DeclarationTemplate | null = null;
    let maxScore = 0;

    for (const template of templates) {
        let score = 0;
        const lowerTitle = template.title.toLowerCase();

        if (lowerText.includes(lowerTitle) || lowerTitle.includes(lowerText)) {
            score += 10;
        }

        const keywords = matchMap[template.id] || [];
        for (const keyword of keywords) {
            if (lowerText.includes(keyword)) {
                score += 5;
            }
        }

        const textWords = lowerText.split(/\s+/).filter(w => w.length > 3);
        const titleWords = lowerTitle.split(/\s+/).filter(w => w.length > 3);
        const commonWords = textWords.filter(w => titleWords.includes(w));
        score += commonWords.length;

        if (score > maxScore && score >= 3) {
            maxScore = score;
            bestMatch = template;
        }
    }

    return bestMatch;
}

// ── Hook ──

interface UseAiDeclarationParams {
    biddings: BiddingProcess[];
    companies: CompanyProfile[];
    onSave?: () => void;
    initialBiddingId?: string;
}

export function useAiDeclaration({ biddings, companies, onSave, initialBiddingId }: UseAiDeclarationParams) {
    const toast = useToast();

    // ── State ──
    const [selectedBiddingId, setSelectedBiddingId] = useState(initialBiddingId || '');
    const [lastAutoSelectedBiddingId, setLastAutoSelectedBiddingId] = useState('');
    const [fullBidding, setFullBidding] = useState<BiddingProcess | null>(null);
    const [isBiddingLoading, setIsBiddingLoading] = useState(false);
    const [selectedCompanyId, setSelectedCompanyId] = useState('');
    const [declarationType, setDeclarationType] = useState('');
    const [issuerType, setIssuerType] = useState<'company' | 'technical'>('company');
    const [customPrompt, setCustomPrompt] = useState('');
    const [declarationStyle, setDeclarationStyle] = useState<DeclarationStyleOption>('objetiva');
    const [isGenerating, setIsGenerating] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [generatedText, setGeneratedText] = useState('');
    const [saveSuccess, setSaveSuccess] = useState(false);
    const [confirmAction, setConfirmAction] = useState<{ type: 'deleteLayout' | 'resetLayout'; onConfirm: () => void } | null>(null);
    const [layoutSaved, setLayoutSaved] = useState(false);
    const [qualityReport, setQualityReport] = useState<QualityReportFrontend | null>(null);
    const [qualityWarning, setQualityWarning] = useState<string | null>(null);
    const [layouts, setLayouts] = useState<LayoutConfig[]>(loadLayouts);
    const [currentLayoutId, setCurrentLayoutId] = useState<string>(layouts[0]?.id || 'default');
    const [layoutName, setLayoutName] = useState(layouts.find(l => l.id === currentLayoutId)?.name || 'Layout Principal');

    const [generationMode, setGenerationMode] = useState<'ai' | 'static' | 'mixed'>('ai');
    const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>([]);

    const selectedTemplateId = selectedTemplateIds[0] || '';
    const setSelectedTemplateId = useCallback((id: string) => {
        setSelectedTemplateIds(id ? [id] : []);
    }, []);

    const [templates, setTemplates] = useState<DeclarationTemplate[]>([]);
    const [isTemplatesLoading, setIsTemplatesLoading] = useState(false);

    const fetchTemplates = useCallback(async () => {
        setIsTemplatesLoading(true);
        try {
            const res = await fetch(`${API_BASE_URL}/api/declaration-templates`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
            });
            if (res.ok) {
                const data = await res.json();
                setTemplates(data);
                if (data.length > 0 && selectedTemplateIds.length === 0) {
                    setSelectedTemplateIds([data[0].id]);
                }
            }
        } catch (e) {
            console.error("Error fetching templates:", e);
        } finally {
            setIsTemplatesLoading(false);
        }
    }, [selectedTemplateIds]);

    useEffect(() => {
        fetchTemplates();
    }, []);

    const handleCreateTemplate = async (title: string, content: string) => {
        try {
            const res = await fetch(`${API_BASE_URL}/api/declaration-templates`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify({ title, content })
            });
            if (res.ok) {
                toast.success('Modelo criado com sucesso!');
                fetchTemplates();
            } else {
                const err = await res.json();
                toast.error(err.error || 'Erro ao criar modelo.');
            }
        } catch (e) {
            toast.error('Erro ao criar modelo.');
        }
    };

    const handleUpdateTemplate = async (id: string, title: string, content: string) => {
        try {
            const res = await fetch(`${API_BASE_URL}/api/declaration-templates/${id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify({ title, content })
            });
            if (res.ok) {
                toast.success('Modelo atualizado com sucesso!');
                fetchTemplates();
            } else {
                const err = await res.json();
                toast.error(err.error || 'Erro ao atualizar modelo.');
            }
        } catch (e) {
            toast.error('Erro ao atualizar modelo.');
        }
    };

    const handleDeleteTemplate = async (id: string) => {
        try {
            const res = await fetch(`${API_BASE_URL}/api/declaration-templates/${id}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                }
            });
            if (res.ok) {
                toast.success('Modelo excluído com sucesso!');
                setSelectedTemplateIds(prev => prev.filter(x => x !== id));
                fetchTemplates();
            } else {
                const err = await res.json();
                toast.error(err.error || 'Erro ao excluir modelo.');
            }
        } catch (e) {
            toast.error('Erro ao excluir modelo.');
        }
    };

    const layout = useMemo(() =>
        layouts.find(l => l.id === currentLayoutId) || layouts[0] || { ...DEFAULT_LAYOUT, id: 'default', name: 'Layout Principal' }
    , [layouts, currentLayoutId]);

    const updateLayout = useCallback((patch: Partial<LayoutConfig>) => {
        setLayouts(prev => prev.map(l => l.id === currentLayoutId ? { ...l, ...patch } : l));
    }, [currentLayoutId]);

    // Auto-save layouts
    useEffect(() => { saveLayouts(layouts); }, [layouts]);

    // Fetch full bidding process details asynchronously under selectedBiddingId changes
    useEffect(() => {
        if (!selectedBiddingId) {
            setFullBidding(null);
            return;
        }
        setIsBiddingLoading(true);
        fetch(`${API_BASE_URL}/api/biddings/${selectedBiddingId}`, {
            headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
        })
            .then(res => res.ok ? res.json() : null)
            .then(data => {
                setFullBidding(data);
            })
            .catch(err => {
                console.error("Error fetching full bidding:", err);
            })
            .finally(() => {
                setIsBiddingLoading(false);
            });
    }, [selectedBiddingId]);

    // Auto-infer company from selected bidding
    useEffect(() => {
        if (selectedBiddingId && !selectedCompanyId) {
            const bidding = biddings.find(b => b.id === selectedBiddingId);
            if (bidding?.companyProfileId) {
                setSelectedCompanyId(bidding.companyProfileId);
            }
        }
    }, [selectedBiddingId]);

    // Auto-update destinatário whenever bidding changes (including initialBiddingId)
    // Usa setLayouts diretamente para evitar stale closure do updateLayout
    useEffect(() => {
        if (!selectedBiddingId) return;
        const b = biddings.find(x => x.id === selectedBiddingId);
        if (!b) return;

        const tit = (b.title || '').trim();
        const mod = (b.modality || '').trim();
        const dashParts = tit.split(/\s+-\s+/);
        const parts: string[] = [];

        if (dashParts.length >= 2) {
            const firstPart = dashParts[0].trim();
            const orgPart = dashParts.slice(1).join(' - ').trim();
            if (orgPart) parts.push(orgPart);
            if (/\d/.test(firstPart)) {
                const editalRef = firstPart.startsWith(mod) ? firstPart : `${mod} ${firstPart}`.trim();
                parts.push(editalRef);
            }
        } else {
            // Sem separador " - ": usar título completo como referência
            parts.push(tit);
        }

        const addresseeOrg = parts.join('\n');
        // Escrever direto nos layouts para garantir que atualiza o layout CORRETO (currentLayoutId pode ter mudado)
        setLayouts(prev => prev.map(l => l.id === currentLayoutId
            ? { ...l, addresseeOrg, addresseeName: 'Agente de Contratação' }
            : l
        ));
    }, [selectedBiddingId, biddings, currentLayoutId]);

    // Ensure date is always today on mount
    useEffect(() => {
        const today = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
        if (layout && !layout.signatureDate) updateLayout({ signatureDate: today });
    }, [layout, updateLayout]);

    // ── Layout Actions ──
    const handleCreateLayout = () => {
        const newId = `layout_${Date.now()}`;
        const today = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
        const newLayout: LayoutConfig = { ...DEFAULT_LAYOUT, id: newId, name: 'Novo Layout', signatureDate: today };
        setLayouts(prev => [...prev, newLayout]);
        setCurrentLayoutId(newId); setLayoutName('Novo Layout');
    };

    const handleDeleteLayout = () => {
        if (layouts.length <= 1) return;
        setConfirmAction({
            type: 'deleteLayout',
            onConfirm: () => {
                const remaining = layouts.filter(l => l.id !== currentLayoutId);
                setLayouts(remaining); saveLayouts(remaining);
                setCurrentLayoutId(remaining[0].id); setLayoutName(remaining[0].name);
                setConfirmAction(null);
            }
        });
    };

    const handleResetLayout = () => {
        setConfirmAction({
            type: 'resetLayout',
            onConfirm: () => { updateLayout({ ...DEFAULT_LAYOUT, name: layoutName }); setConfirmAction(null); }
        });
    };

    const handleSaveLayout = () => {
        saveLayouts(layouts); setLayoutSaved(true);
        setTimeout(() => setLayoutSaved(false), 2000);
    };

    const handleSwitchLayout = (layoutId: string) => {
        const found = layouts.find(l => l.id === layoutId);
        setCurrentLayoutId(layoutId);
        if (found) setLayoutName(found.name);
    };

    const handleUpdateLayoutName = (name: string) => {
        setLayoutName(name); updateLayout({ name });
    };

    const handleImageUpload = (target: 'headerImage' | 'footerImage', file: File) => {
        const reader = new FileReader();
        reader.onload = () => updateLayout({ [target]: reader.result as string });
        reader.readAsDataURL(file);
    };

    // ── Computed ──
    const biddingsWithAnalysis = useMemo(() =>
        biddings.filter(b => {
            const stage = resolveStage(b.status);
            return isModuleAllowed(stage, b.substage, 'production-declaration') && (b.aiAnalysis || b.summary);
        })
    , [biddings]);

    const declarationTypesFromEdital = useMemo(() => {
        if (!selectedBiddingId) return [];
        const b = fullBidding || biddings.find(b => b.id === selectedBiddingId);
        if (!b?.aiAnalysis) return [];

        // 1. Priorizar schemaV2.operational_outputs.declaration_routes (estruturado)
        let schema = b.aiAnalysis.schemaV2;
        if (typeof schema === 'string') {
            try {
                schema = JSON.parse(schema);
            } catch {
                schema = null;
            }
        }
        if (schema?.operational_outputs?.declaration_routes?.length > 0) {
            return schema.operational_outputs.declaration_routes.map(
                (d: any) => typeof d === 'string' ? d : (d.name || d.title || JSON.stringify(d))
            );
        }

        // 2. Fallback para requiredDocuments (heurística de keywords)
        if (b.aiAnalysis.requiredDocuments) {
            return extractDeclarationTypes(b.aiAnalysis.requiredDocuments);
        }
        return [];
    }, [selectedBiddingId, biddings, fullBidding]);

    const handleBiddingChange = (biddingId: string) => {
        setSelectedBiddingId(biddingId); // useEffect acima cuida do destinatário
        setDeclarationType('');
    };

    // Auto-select matched templates when edital requirements are loaded (once per bidding selection)
    useEffect(() => {
        if (!selectedBiddingId) return;
        if (isTemplatesLoading) return;
        if (selectedBiddingId === lastAutoSelectedBiddingId) return;

        const isBiddingFinishedLoading = !isBiddingLoading;
        if (declarationTypesFromEdital.length > 0 || isBiddingFinishedLoading) {
            const matchedIds: string[] = [];
            if (templates.length > 0) {
                declarationTypesFromEdital.forEach((reqText: string) => {
                    const match = findMatchingTemplateLocal(reqText, templates);
                    if (match) {
                        matchedIds.push(match.id);
                    }
                });
            }

            if (matchedIds.length > 0) {
                setSelectedTemplateIds(matchedIds);
                setGenerationMode('mixed');
                if (matchedIds.length > 1) {
                    setDeclarationType('DECLARAÇÃO UNIFICADA DE HABILITAÇÃO');
                } else {
                    const matchTpl = templates.find(t => t.id === matchedIds[0]);
                    setDeclarationType((matchTpl?.title || 'Declaração').toUpperCase());
                }
            } else {
                setSelectedTemplateIds([]);
                setGenerationMode('ai');
                if (declarationTypesFromEdital[0]) {
                    setDeclarationType(declarationTypesFromEdital[0]);
                }
            }
            setLastAutoSelectedBiddingId(selectedBiddingId);
        }
    }, [selectedBiddingId, declarationTypesFromEdital, templates, isTemplatesLoading, isBiddingLoading, lastAutoSelectedBiddingId]);

    // Auto-populate company data + auto-select matching layout
    useEffect(() => {
        if (!selectedCompanyId) return;
        const c = companies.find(x => x.id === selectedCompanyId);
        if (!c) return;

        // Auto-select layout that matches this company (by signatoryCompany)
        const matchingLayout = layouts.find(l => l.signatoryCompany && l.signatoryCompany === c.razaoSocial);
        if (matchingLayout && matchingLayout.id !== currentLayoutId) {
            setCurrentLayoutId(matchingLayout.id);
            setLayoutName(matchingLayout.name);
            // Não precisa atualizar empresa — layout já tem os dados corretos
            return;
        }

        // Se não encontrou layout da empresa, limpar imagens de outra empresa
        const currentLay = layouts.find(l => l.id === currentLayoutId);
        if (currentLay?.signatoryCompany && currentLay.signatoryCompany !== c.razaoSocial) {
            updateLayout({ headerImage: null, footerImage: null });
        }

        // Prioritize structured address fields, fall back to qualification parsing
        const addr = c.address ? [
            c.address,
            c.bairro,
            c.city && c.state ? `${c.city}/${c.state}` : (c.city || c.state || ''),
            c.cep ? `CEP: ${c.cep}` : ''
        ].filter(Boolean).join(', ') : (c.qualification?.split(/sediada\s+(?:na|no|em)\s+/i)[1]?.split(/,?\s*neste\s+ato/i)[0]?.trim() || '');
        const qual = (c.qualification || '').trim();

        let city = c.city || '';
        if (city && c.state) {
            city = `${city}/${c.state}`;
        } else if (!city) {
            const cityMatch = qual.match(/,\s*([^,.(0-9\-]{3,30})\s*[/|-]\s*([A-Z]{2})(?=\s*,|\s+CEP|\s+inscrita|\s*neste|$)/i);
            if (cityMatch) city = `${cityMatch[1].trim()}/${cityMatch[2].trim()}`;
            else {
                const cityFallback = addr.match(/,\s*([^,.(0-9\-]{3,25}(?:\/|-)[A-Z]{2})\s*$/);
                if (cityFallback) city = cityFallback[1].trim();
                else { const munMatch = qual.match(/(?:município\s+de|cidade\s+de)\s+([^,.(0-9]{3,30})/i); if (munMatch) city = munMatch[1].trim(); }
            }
        }

        let cpf = c.contactCpf || '';
        if (cpf && !cpf.startsWith('CPF nº:')) {
            cpf = `CPF nº: ${cpf}`;
        }
        if (!cpf) {
            const cpfMatch = qual.match(/(\d{3}\.\d{3}\.\d{3}-\d{2})/);
            if (cpfMatch) cpf = `CPF nº: ${cpfMatch[0]}`;
        }

        let fullName = c.contactName || '';
        if (!fullName) {
            const nameMatch = qual.match(/representada\s+por\s+(?:seu\s+)?(?:Sócio\s+Administrador|representante\s+legal\s+)?(?:,\s*)?(?:a\s+Sra\.\s+|o\s+Sr\.\s+)?([^,.(0-9]{3,60})(?=\s*,\s*|,\s*brasileir|,\s*solteir|$)/i);
            if (nameMatch?.[1]) fullName = nameMatch[1].trim();
        }

        let rtName = c.techName || '';
        let rtCpf = c.techCpf || '';
        if (rtCpf && !rtCpf.startsWith('CPF nº:')) {
            rtCpf = `CPF nº: ${rtCpf}`;
        }
        let rtRegister = c.techRegistration || '';
        let rtRole = c.techTitle || 'Responsável Técnico';
        
        if (!rtName && c.technicalQualification) {
            const techLines = c.technicalQualification.split('\n').filter(l => l.trim());
            rtName = techLines[0]?.split(',')[0]?.trim() || '';
            const techCpfMatch = c.technicalQualification.match(/(\d{3}\.\d{3}\.\d{3}-\d{2})/);
            if (techCpfMatch) rtCpf = `CPF nº: ${techCpfMatch[0]}`;
            const regMatch = c.technicalQualification.match(/(?:CREA|CAU)(?:\/[A-Z]{2})?\s*(?:nº|sob\s+o\s+nº|:)?\s*[0-9a-zA-Z\-/.]+(?:\s+[0-9a-zA-Z\-/.]+)?/i);
            if (regMatch) {
                rtRegister = regMatch[0].trim().replace(/^(?:CREA|CAU)\s*:\s*(?=(?:CREA|CAU))/i, '');
            }
            rtRole = 'Responsável Técnico';
        }

        if (issuerType === 'technical' && (c.techName || c.technicalQualification)) {
            updateLayout({
                signatoryName: rtName || fullName, signatoryRole: rtRole || 'Responsável Técnico',
                signatoryCpf: rtCpf || cpf,
                signatureCity: city,
                footerText: `${c.razaoSocial} | CNPJ: ${c.cnpj}${addr ? `\nEnd: ${addr}` : ''}\nTel: ${c.contactPhone || ''} | Email: ${c.contactEmail || ''}`,
                rtName,
                rtCpf,
                rtRole,
                rtRegister,
                headerImage: c.defaultProposalHeader || null,
                footerImage: c.defaultProposalFooter || null,
            });
        } else {
            updateLayout({
                headerText: `${c.razaoSocial}\nCNPJ: ${c.cnpj}`,
                signatoryCompany: c.razaoSocial, signatoryCnpj: `CNPJ: ${c.cnpj}`,
                signatoryName: fullName, signatoryCpf: cpf, signatoryRole: c.contactCargo || 'Representante Legal',
                signatureCity: city,
                footerText: `${c.razaoSocial} | CNPJ: ${c.cnpj}${addr ? `\nEnd: ${addr}` : ''}\nTel: ${c.contactPhone || ''} | Email: ${c.contactEmail || ''}`,
                rtName,
                rtCpf,
                rtRole: rtName ? rtRole : '',
                rtRegister,
                headerImage: c.defaultProposalHeader || null,
                footerImage: c.defaultProposalFooter || null,
            });
        }
    }, [issuerType, selectedCompanyId, companies, updateLayout]);

    const handleCompanyChange = (companyId: string) => setSelectedCompanyId(companyId);

    const [activeJobId, setActiveJobId] = useState<string | null>(null);
    const [progressMsg, setProgressMsg] = useState<string>('');

    useSSE((event) => {
        if (event.jobId === activeJobId) {
            if (event.type === 'job_progress') {
                setProgressMsg(event.progressMsg || `Gerando (${event.progress}%)`);
            } else if (event.type === 'job_completed') {
                fetchJobResult(event.jobId).then(data => {
                    setGeneratedText(data.text);
                    if (data.title) setDeclarationType(data.title.toUpperCase());
                    
                    if (data.quality) {
                        setQualityReport(data.quality);
                        if (data.quality.corrected) {
                            toast.warning(`Declaração auto-corrigida: ${data.quality.corrections.length} problema(s) resolvido(s) automaticamente.`);
                        }
                        if (data.quality.contaminationDetected) {
                            toast.error('Possível contaminação de dados de outro certame detectada. Revise com atenção.');
                        } else if (data.quality.grade === 'D') {
                            toast.error('Qualidade baixa. Revise a declaração antes de exportar.');
                        }
                    } else {
                        setQualityReport(null);
                    }
                    if (data.warning) setQualityWarning(data.warning);

                    setProgressMsg('');
                    setActiveJobId(null);
                    setIsGenerating(false);
                }).catch(_err => {
                    toast.error('Erro ao baixar declaração.');
                    setIsGenerating(false);
                    setActiveJobId(null);
                    setProgressMsg('');
                });
            } else if (event.type === 'job_failed') {
                toast.error(event.error || 'Erro na geração da declaração.');
                setIsGenerating(false);
                setActiveJobId(null);
                setProgressMsg('');
            }
        }
    });

    // ── Generate ──
    const handleGenerate = async () => {
        if (!selectedBiddingId || !selectedCompanyId) {
            toast.warning('Selecione licitação e empresa.'); return;
        }
        if (generationMode === 'ai' && !declarationType) {
            toast.warning('Selecione ou digite o tipo de declaração.'); return;
        }
        if (generationMode !== 'ai' && selectedTemplateIds.length === 0) {
            toast.warning('Selecione ao menos um modelo de declaração.'); return;
        }

        const selectedBidding = fullBidding || biddings.find(b => b.id === selectedBiddingId);
        const selectedCompany = companies.find(c => c.id === selectedCompanyId);
        
        // Atualizar data para o dia da geração
        const today = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
        updateLayout({ signatureDate: today });

        const activeTemplates = templates.filter(t => selectedTemplateIds.includes(t.id));
        const targetDeclarationType = generationMode === 'ai' 
            ? declarationType 
            : (activeTemplates.length > 1 
                ? 'DECLARAÇÃO UNIFICADA DE HABILITAÇÃO' 
                : (activeTemplates[0]?.title || 'Declaração'));

        if (generationMode === 'static') {
            setIsGenerating(true);
            setSaveSuccess(false);
            setQualityWarning(null);
            setQualityReport(null);
            setProgressMsg('Preenchendo modelo...');

            try {
                // Compile the template content by replacing placeholders
                const facts = {
                    empresaRazaoSocial: selectedCompany?.razaoSocial || '',
                    empresaCnpj: selectedCompany?.cnpj || '',
                    empresaEndereco: layout.signatoryCompany || selectedCompany?.address || '',
                    representanteNome: layout.signatoryName || selectedCompany?.contactName || '',
                    representanteCpf: layout.signatoryCpf || selectedCompany?.contactCpf || '',
                    representanteCargo: layout.signatoryRole || selectedCompany?.contactCargo || '',
                    orgaoLicitante: layout.addresseeOrg?.split('\n')?.[0] || selectedBidding?.title?.split(' - ')?.[1] || '',
                    modalidade: selectedBidding?.modality || '',
                    editalNumero: selectedBidding?.aiAnalysis?.schemaV2?.process_identification?.numero_edital || '',
                    processoNumero: selectedBidding?.aiAnalysis?.schemaV2?.process_identification?.numero_processo || '',
                    objeto: selectedBidding?.aiAnalysis?.schemaV2?.process_identification?.objeto || selectedBidding?.summary || '',
                    signatureCity: layout.signatureCity || '',
                    signatureDate: today
                };

                const compiled = mergeTemplatesStatically(activeTemplates, facts);
                setGeneratedText(compiled);
                setDeclarationType(targetDeclarationType.toUpperCase());
                setIsGenerating(false);
                setProgressMsg('');
            } catch (error: any) {
                toast.error(`Erro ao preencher modelo: ${error.message}`);
                setIsGenerating(false);
                setProgressMsg('');
            }
            return;
        }

        setIsGenerating(true); setSaveSuccess(false); setQualityWarning(null);
        setProgressMsg('Iniciando...');
        try {
            const { jobId } = await submitBackgroundJob({
                type: 'declaration',
                targetId: selectedBidding?.id,
                targetTitle: selectedBidding?.title || 'Licitação',
                input: { 
                    biddingProcessId: selectedBiddingId, 
                    companyId: selectedCompanyId, 
                    declarationType: targetDeclarationType, 
                    issuerType, 
                    customPrompt, 
                    style: declarationStyle, 
                    signatureCity: layout.signatureCity, 
                    signatureDate: today,
                    mode: generationMode,
                    templateContent: activeTemplates[0]?.content || '',
                    selectedTemplates: activeTemplates.map(t => ({ title: t.title, content: t.content })),
                    doubleSignature: layout.doubleSignature,
                    rtName: layout.rtName,
                    rtCpf: layout.rtCpf,
                    rtRegister: layout.rtRegister,
                    rtRole: layout.rtRole
                }
            });
            setActiveJobId(jobId);
        } catch (error: any) { 
            toast.error(`Erro ao iniciar geração de declaração: ${error.message}`); 
            setIsGenerating(false);
            setProgressMsg('');
        }
    };

    // ── PDF Builder ──
    const buildPDF = useCallback(() => {
        const doc = new jsPDF();
        const pw = doc.internal.pageSize.getWidth();
        const ph = doc.internal.pageSize.getHeight();
        const m = 20;
        const mw = pw - m * 2;

        let footerHeight = 0;
        if (layout.footerImage) footerHeight += layout.footerImageHeight + 4;
        if (layout.footerText) footerHeight += 8;
        if (footerHeight > 0) footerHeight += 3;
        const footerY = ph - footerHeight - 3;

        const drawHeader = () => {
            let hy = 10;
            if (layout.headerImage) { const imgX = (pw - layout.headerImageWidth) / 2; doc.addImage(layout.headerImage, 'PNG', imgX, hy, layout.headerImageWidth, layout.headerImageHeight); hy += layout.headerImageHeight + 3; }
            if (layout.headerText) { doc.setFontSize(9); doc.setTextColor(60); doc.setFont('helvetica', 'normal'); const hl = doc.splitTextToSize(layout.headerText, mw); doc.text(hl, pw / 2, hy, { align: 'center' }); hy += hl.length * 3.5 + 2; doc.setDrawColor(160); doc.line(m, hy, pw - m, hy); hy += 6; }
            return hy;
        };

        const drawFooter = () => {
            let fy = ph;
            if (layout.footerText) { doc.setFontSize(7.5); doc.setTextColor(100); doc.setFont('helvetica', 'italic'); const ftLines = doc.splitTextToSize(layout.footerText, mw); fy = ph - 14; doc.text(ftLines, pw / 2, fy, { align: 'center' }); fy -= ftLines.length * 3 + 2; }
            if (layout.footerImage) { const imgY = layout.footerText ? fy - layout.footerImageHeight : ph - layout.footerImageHeight - 5; const imgX = (pw - layout.footerImageWidth) / 2; doc.addImage(layout.footerImage, 'PNG', imgX, imgY, layout.footerImageWidth, layout.footerImageHeight); }
        };

        const newPage = () => { drawFooter(); doc.addPage(); return drawHeader(); };
        const contentMaxY = footerY - 8;

        let y = drawHeader();

        // Addressee
        if (layout.addresseeName || layout.addresseeOrg) {
            doc.setFontSize(10); doc.setTextColor(0); doc.setFont('helvetica', 'normal');
            if (layout.addresseeName) { doc.text(`Ao ${layout.addresseeName}`, m, y); y += 5; }
            if (layout.addresseeOrg) { layout.addresseeOrg.split('\n').forEach(l => { if (l.trim()) { doc.text(l.trim(), m, y); y += 5; } }); }
            y += 6;
        }

        // Title
        doc.setFontSize(12); doc.setTextColor(0); doc.setFont('helvetica', 'bold');
        const tl = doc.splitTextToSize(declarationType.toUpperCase(), mw - 20);
        tl.forEach((line: string) => { doc.text(line, pw / 2, y, { align: 'center' }); y += 6; });
        y += 6;

        // Body
        doc.setFontSize(10.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(0);
        const paragraphs = generatedText.split(/\n\s*\n|\n/).filter(p => p.trim());
        const lh = 5;
        const resetBodyFont = () => { doc.setFontSize(10.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(0); };

        for (const para of paragraphs) {
            const trimmed = para.trim();
            if (!trimmed) continue;
            const isNumbered = /^\d+[\.)\ ]/.test(trimmed);
            const indent = isNumbered ? 8 : 0;
            const textWidth = mw - indent;
            const paraLines = doc.splitTextToSize(trimmed, textWidth);
            const paraHeight = paraLines.length * lh;

            if (y + paraHeight <= contentMaxY) {
                // Cabe inteiro na página — renderiza justificado
                doc.text(trimmed, m + indent, y, { align: 'justify', maxWidth: textWidth });
                y += paraHeight;
            } else {
                // Não cabe — divide entre páginas, linha a linha
                for (let li = 0; li < paraLines.length; li++) {
                    if (y + lh > contentMaxY) {
                        y = newPage(); resetBodyFont();
                    }
                    doc.text(paraLines[li], m + indent, y);
                    y += lh;
                }
            }
            y += 3;
        }

        y += 6;
        const sigBlockHeight = 55;
        if (y + sigBlockHeight > contentMaxY) { y = newPage(); } else { y += 10; }

        // Location & Date
        if (layout.signatureCity || layout.signatureDate) {
            doc.setFontSize(10.5); doc.setFont('helvetica', 'normal'); doc.setTextColor(0);
            const dateLine = `${layout.signatureCity}${layout.signatureCity && layout.signatureDate ? ', ' : ''}${layout.signatureDate}.`;
            doc.text(dateLine, pw - m, y, { align: 'right' }); y += 15;
        }

        // Signature
        if (layout.doubleSignature) {
            const leftX = pw / 4;
            const rightX = (pw * 3) / 4;

            doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
            
            doc.text('__________________________________', leftX, y, { align: 'center' });
            doc.text('__________________________________', rightX, y, { align: 'center' });
            y += 5;

            let ly = y;
            if (layout.signatoryName) {
                doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5);
                doc.text(layout.signatoryName.toUpperCase(), leftX, ly, { align: 'center' });
                ly += 4.5;
            }
            doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
            if (layout.signatoryCpf) {
                doc.text(layout.signatoryCpf, leftX, ly, { align: 'center' });
                ly += 4.5;
            }
            if (layout.signatoryRole) {
                doc.text(layout.signatoryRole, leftX, ly, { align: 'center' });
                ly += 4.5;
            }
            if (layout.signatoryCompany) {
                doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
                doc.text(layout.signatoryCompany, leftX, ly, { align: 'center' });
                ly += 4.5;
            }
            if (layout.signatoryCnpj) {
                doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
                doc.text(layout.signatoryCnpj, leftX, ly, { align: 'center' });
            }

            let ry = y;
            if (layout.rtName) {
                doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5);
                doc.text(layout.rtName.toUpperCase(), rightX, ry, { align: 'center' });
                ry += 4.5;
            }
            doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
            if (layout.rtCpf) {
                doc.text(layout.rtCpf, rightX, ry, { align: 'center' });
                ry += 4.5;
            }
            if (layout.rtRole) {
                doc.text(layout.rtRole, rightX, ry, { align: 'center' });
                ry += 4.5;
            }
            if (layout.rtRegister) {
                doc.text(layout.rtRegister, rightX, ry, { align: 'center' });
                ry += 4.5;
            }
            if (layout.signatoryCompany) {
                doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
                doc.text(layout.signatoryCompany, rightX, ry, { align: 'center' });
            }

            y = Math.max(ly, ry);
        } else {
            doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
            doc.text('__________________________________________', pw / 2, y, { align: 'center' }); y += 5;
            if (layout.signatoryName) { doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text(layout.signatoryName.toUpperCase(), pw / 2, y, { align: 'center' }); y += 4.5; }
            if (layout.signatoryCpf) { doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(layout.signatoryCpf, pw / 2, y, { align: 'center' }); y += 4.5; }
            if (layout.signatoryRole) { doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(layout.signatoryRole, pw / 2, y, { align: 'center' }); y += 4.5; }
            if (layout.signatoryCompany) { doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.text(layout.signatoryCompany, pw / 2, y, { align: 'center' }); y += 4.5; }
            if (layout.signatoryCnpj) { doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(layout.signatoryCnpj, pw / 2, y, { align: 'center' }); }
        }

        drawFooter();
        return doc;
    }, [layout, generatedText, declarationType]);

    const handleExportPDF = () => {
        if (!generatedText) return;
        buildPDF().save(`Declaracao_${declarationType.replace(/\s+/g, '_').substring(0, 40)}_${Date.now()}.pdf`);
    };

    const handleAddToDocuments = async () => {
        if (!generatedText) return;
        setIsSaving(true);
        try {
            const blob = buildPDF().output('blob');
            const fileName = `Declaracao_${declarationType.replace(/\s+/g, '_').substring(0, 40)}.pdf`;
            const formData = new FormData();
            formData.append('file', new File([blob], fileName, { type: 'application/pdf' }));
            formData.append('companyProfileId', selectedCompanyId);
            formData.append('docType', `Declaração: ${declarationType}`);
            formData.append('expirationDate', new Date(Date.now() + 365 * 86400000).toISOString());
            formData.append('status', 'Válido');
            formData.append('docGroup', 'Declarações');
            const res = await fetch(`${API_BASE_URL}/api/documents`, { method: 'POST', headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }, body: formData });
            if (!res.ok) throw new Error('Falha ao salvar');
            setSaveSuccess(true); onSave?.();
            setTimeout(() => setSaveSuccess(false), 3000);
        } catch (e) { toast.error('Erro ao salvar declaração.'); }
        finally { setIsSaving(false); }
    };

    return {
        // State
        selectedBiddingId, selectedCompanyId, declarationType, setDeclarationType,
        issuerType, setIssuerType, customPrompt, setCustomPrompt,
        declarationStyle, setDeclarationStyle,
        isGenerating, isSaving, generatedText, setGeneratedText, saveSuccess,
        confirmAction, setConfirmAction, layoutSaved,
        layouts, currentLayoutId, layoutName, qualityReport, qualityWarning, progressMsg,
        generationMode, setGenerationMode, selectedTemplateId, setSelectedTemplateId,
        selectedTemplateIds, setSelectedTemplateIds,
        templates, isTemplatesLoading,
        fullBidding, isBiddingLoading,
        // Computed
        layout, biddingsWithAnalysis, declarationTypesFromEdital,
        // Layout actions
        updateLayout, handleCreateLayout, handleDeleteLayout, handleResetLayout,
        handleSaveLayout, handleSwitchLayout, handleUpdateLayoutName, handleImageUpload,
        // Core actions
        handleBiddingChange, handleCompanyChange, handleGenerate,
        handleExportPDF, handleAddToDocuments,
        // Template Actions
        handleCreateTemplate, handleUpdateTemplate, handleDeleteTemplate, fetchTemplates
    };
}

export function cleanTemplateBody(content: string, templateId?: string): string {
    const systemCleaned: Record<string, string> = {
        'sys-menor': 'Não emprega menores de 18 (dezoito) anos em trabalho noturno, perigoso ou insalubre, e não emprega menores de 16 (dezesseis) anos em qualquer trabalho, salvo na condição de aprendiz, a partir de 14 (quatorze) anos.',
        'sys-impedimento': 'Inexistência de fatos supervenientes impeditivos para sua habilitação neste certame licitatório, ciente da obrigatoriedade de declarar ocorrências posteriores. Declara ainda que não foi declarada inidônea e nem se encontra suspensa ou impedida de licitar ou contratar com a Administração Pública.',
        'sys-me-epp': 'Se enquadra na condição de Microempresa (ME) ou Empresa de Pequeno Porte (EPP), nos termos da Lei Complementar nº 123/2006, cumprindo todos os requisitos legais para fazer jus aos benefícios nela previstos. Declara ainda que não incorre em nenhuma das vedações previstas no § 4º do artigo 3º da referida Lei Complementar.',
        'sys-nepotismo': 'Nenhum de seus sócios, administradores ou empregados com poder de decisão possui relação de parentesco, consanguínea ou afim, até o terceiro grau, inclusive, com servidores que exerçam cargos de direção, chefia ou assessoramento, ou que desempenhem funções de contratação ou fiscalização no âmbito do(a) {orgaoLicitante}.',
        'sys-elaboracao': 'A proposta de preços apresentada para participação nesta licitação foi elaborada de forma independente, e que o conteúdo da mesma não foi, no todo ou em parte, direta ou indiretamente, informado, discutido ou recebido de qualquer outro participante potencial ou ativo deste certame.',
        'sys-plena': 'Cumpre plenamente todos os requisitos de habilitação exigidos no Edital do certame regido pelo(a) {orgaoLicitante}, ciente da obrigatoriedade de informar qualquer alteração posterior.',
        'sys-vagas': 'Cumpre integralmente as reservas de cargos previstas em lei para pessoa com deficiência ou para reabilitado da Previdência Social, conforme o art. 93 da Lei nº 8.213/1991, bem como a reserva de vagas para menor aprendiz, de acordo com o art. 429 da CLT, conforme exigência do certame promovido pelo(a) {orgaoLicitante}.',
        'sys-trabalho-escravo': 'Não utiliza mão de obra infantil em qualquer trabalho e que não explora, direta ou indiretamente, o trabalho degradante ou análogo à condição de escravo, em conformidade com as normas legais e regulamentares vigentes e em atendimento às exigências do certame conduzido pelo(a) {orgaoLicitante}.',
        'sys-nepotismo-servidores': 'Não possui em seu quadro societário, gerencial ou técnico, servidores públicos, empregados ou dirigentes do(a) {orgaoLicitante}, ou cônjuges, companheiros ou parentes em linha reta, colateral ou por afinidade, até o terceiro grau, inclusive, em conformidade com os princípios da moralidade e impessoalidade que regem as contratações públicas.',
        'sys-compromisso-edital': 'Tomou conhecimento de todas as condições locais, especificações e exigências constantes no Edital de licitação promovido pelo(a) {orgaoLicitante}, Edital nº {editalNumero}, Processo nº {processoNumero}, aceitando-as integralmente e comprometendo-se a executar fielmente o seu objeto caso seja consagrada vencedora.',
        'sys-lgpd': 'Cumpre integralmente as disposições da Lei nº 13.709/2018 (Lei Geral de Proteção de Dados - LGPD), comprometendo-se a tratar todos os dados pessoais a que tiver acesso em razão do certame promovido pelo(a) {orgaoLicitante} de acordo com as bases legais, princípios e regras estabelecidos na referida lei. Declara ainda que adota medidas de segurança, técnicas e administrativas aptas a proteger os dados pessoais de acessos não autorizados e de situações acidentais ou ilícitas de destruição, perda, alteração ou qualquer forma de tratamento inadequado.',
        'sys-anticorrupcao': 'Não praticou, não pratica e se compromete a não praticar atos de corrupção, fraudes, conluios, práticas coercitivas ou obstrutivas em nenhuma fase deste certame promovido pelo(a) {orgaoLicitante} ou na execução do contrato dele decorrente, em estrita observância à Lei nº 12.846/2013 (Lei Anticorrupção) e demais normativos éticos e de integridade.',
        'sys-ceis-cnep': 'Não possui inscrição ativa no Cadastro Nacional de Empresas Inidôneas e Suspensas (CEIS) ou no Cadastro Nacional de Empresas Punidas (CNEP), inexistindo qualquer impedimento legal ou sanção vigente que obste sua participação neste certame licitatório promovido pelo(a) {orgaoLicitante} ou contratação com a Administração Pública.',
        'sys-declinio-vistoria': 'Opta por não realizar a vistoria técnica nos locais onde serão executados os serviços objeto do certame promovido pelo(a) {orgaoLicitante}, Processo nº {processoNumero}, Edital nº {editalNumero}. Declara, outrossim, que detém pleno conhecimento de todas as condições locais, peculiaridades, características e exigências necessárias ao perfeito cumprimento das obrigações contratuais, assumindo inteira e exclusiva responsabilidade por qualquer omissão, erro ou dificuldade futura decorrente do declínio da vistoria, renunciando a qualquer pleito de reequilíbrio econômico-financeiro ou dilação de prazo sob tal alegação.',
        'sys-custos-trabalhistas': 'A proposta econômica apresentada para o certame promovido pelo(a) {orgaoLicitante} compreende a integralidade de todos os custos necessários para o pleno e fiel atendimento de todos os direitos trabalhistas assegurados na Constituição Federal, nas leis trabalhistas (CLT), nas convenções coletivas de trabalho vigentes e nos termos de ajustamento de conduta aplicáveis.',
        'sys-autenticidade-documental': 'Toda a documentação anexada em formato digital no Sistema de Licitações Eletrônicas para participação neste certame promovido pelo(a) {orgaoLicitante} é autêntica e corresponde fielmente aos documentos originais, estando ciente das sanções administrativas e penais aplicáveis em caso de falsidade documental.'
    };

    if (templateId && systemCleaned[templateId]) {
        return systemCleaned[templateId];
    }

    let clean = content.trim();

    // Remove footer
    clean = clean.replace(/Por\s+ser\s+expressão\s+da\s+verdade,?\s+firmamos\s+a\s+presente\.?/gi, '');
    clean = clean.replace(/Nestes\s+termos,?\s+pede\s+deferimento\.?/gi, '');
    clean = clean.trim();

    // Fallback regex cleaning
    const declIndex = clean.search(/\bDECLAR[AO]\b/i);
    if (declIndex !== -1) {
        let rest = clean.substring(declIndex + 7).trim();
        rest = rest.replace(/^[\s,;.-]+/, '');
        rest = rest.replace(/^(?:sob\s+as\s+(?:penas|sanções)\s+da\s+lei|sob\s+as\s+sanções\s+administrativas\s+e\s+sob\s+as\s+penas\s+da\s+lei)/i, '');
        rest = rest.replace(/^[\s,;.-]+/, '');
        rest = rest.replace(/^(?:para\s+fins\s+do\s+disposto\s+no\s+[^,;]+(?:,\s*c\/c\s+[^,;]+)?|em\s+especial\s+para\s+os\s+fins\s+do\s+disposto\s+no\s+[^,;]+|em\s+especial\s+o\s+art\.\s+[^,;]+)/i, '');
        rest = rest.replace(/^[\s,;.-]+/, '');
        rest = rest.replace(/^que\s+/i, '');
        rest = rest.replace(/^[\s,;.-]+/, '');
        clean = rest;
    }

    clean = clean.trim();
    if (clean.length > 0) {
        clean = clean.charAt(0).toUpperCase() + clean.slice(1);
    }
    return clean;
}

export function mergeTemplatesStatically(selectedTemplates: DeclarationTemplate[], facts: any): string {
    if (selectedTemplates.length === 0) return '';
    if (selectedTemplates.length === 1) {
        return compileTemplate(selectedTemplates[0].content, facts);
    }

    const header = `A empresa ${facts.empresaRazaoSocial}, inscrita no CNPJ sob o nº ${facts.empresaCnpj}, com sede em ${facts.empresaEndereco || '[endereço da sede]'}, por intermédio de seu representante legal, o(a) Sr(a). ${facts.representanteNome || '[nome do representante]'}, portador(a) do CPF nº ${facts.representanteCpf || '[CPF do representante]'}, no cargo de ${facts.representanteCargo || 'Representante Legal'}, DECLARA para fins de participação no certame promovido pelo(a) ${facts.orgaoLicitante || '[órgão licitante]'}, Edital nº ${facts.editalNumero || '[número do edital]'}, Processo nº ${facts.processoNumero || '[número do processo]'}, sob as penas da lei, as seguintes condições:`;

    const items = selectedTemplates.map((t, idx) => {
        let body = cleanTemplateBody(t.content, t.id);
        body = compileTemplate(body, facts);
        return `${idx + 1}. ${body}`;
    });

    const footer = `Por ser expressão da verdade, firmamos a presente.`;

    return `${header}\n\n${items.join('\n\n')}\n\n${footer}`;
}

function compileTemplate(content: string, facts: any): string {
    return content
        .replace(/{empresaRazaoSocial}/g, facts.empresaRazaoSocial)
        .replace(/{empresaCnpj}/g, facts.empresaCnpj)
        .replace(/{empresaEndereco}/g, facts.empresaEndereco)
        .replace(/{representanteNome}/g, facts.representanteNome)
        .replace(/{representanteCpf}/g, facts.representanteCpf)
        .replace(/{representanteCargo}/g, facts.representanteCargo)
        .replace(/{orgaoLicitante}/g, facts.orgaoLicitante)
        .replace(/{modalidade}/g, facts.modalidade)
        .replace(/{editalNumero}/g, facts.editalNumero)
        .replace(/{processoNumero}/g, facts.processoNumero)
        .replace(/{objeto}/g, facts.objeto)
        .replace(/{signatureCity}/g, facts.signatureCity)
        .replace(/{signatureDate}/g, facts.signatureDate);
}
