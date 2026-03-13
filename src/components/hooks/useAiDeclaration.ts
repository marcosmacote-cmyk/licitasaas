import { useState, useMemo, useCallback, useEffect } from 'react';
import { jsPDF } from 'jspdf';
import { API_BASE_URL } from '../../config';
import type { BiddingProcess, CompanyProfile } from '../../types';
import { useToast } from '../ui';

// ── Types ──

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

// ── Hook ──

interface UseAiDeclarationParams {
    biddings: BiddingProcess[];
    companies: CompanyProfile[];
    onSave?: () => void;
}

export function useAiDeclaration({ biddings, companies, onSave }: UseAiDeclarationParams) {
    const toast = useToast();

    // ── State ──
    const [selectedBiddingId, setSelectedBiddingId] = useState('');
    const [selectedCompanyId, setSelectedCompanyId] = useState('');
    const [declarationType, setDeclarationType] = useState('');
    const [issuerType, setIssuerType] = useState<'company' | 'technical'>('company');
    const [customPrompt, setCustomPrompt] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [generatedText, setGeneratedText] = useState('');
    const [saveSuccess, setSaveSuccess] = useState(false);
    const [confirmAction, setConfirmAction] = useState<{ type: 'deleteLayout' | 'resetLayout'; onConfirm: () => void } | null>(null);
    const [layoutSaved, setLayoutSaved] = useState(false);
    const [layouts, setLayouts] = useState<LayoutConfig[]>(loadLayouts);
    const [currentLayoutId, setCurrentLayoutId] = useState<string>(layouts[0]?.id || 'default');
    const [layoutName, setLayoutName] = useState(layouts.find(l => l.id === currentLayoutId)?.name || 'Layout Principal');

    const layout = useMemo(() =>
        layouts.find(l => l.id === currentLayoutId) || layouts[0] || { ...DEFAULT_LAYOUT, id: 'default', name: 'Layout Principal' }
    , [layouts, currentLayoutId]);

    const updateLayout = useCallback((patch: Partial<LayoutConfig>) => {
        setLayouts(prev => prev.map(l => l.id === currentLayoutId ? { ...l, ...patch } : l));
    }, [currentLayoutId]);

    // Auto-save layouts
    useEffect(() => { saveLayouts(layouts); }, [layouts]);

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
        biddings.filter(b => b.status === 'Preparando Documentação' && (b.aiAnalysis || b.summary))
    , [biddings]);

    const declarationTypesFromEdital = useMemo(() => {
        if (!selectedBiddingId) return [];
        const b = biddings.find(b => b.id === selectedBiddingId);
        if (!b?.aiAnalysis?.requiredDocuments) return [];
        return extractDeclarationTypes(b.aiAnalysis.requiredDocuments);
    }, [selectedBiddingId, biddings]);

    // ── Bidding change handler ──
    const handleBiddingChange = (biddingId: string) => {
        setSelectedBiddingId(biddingId);
        setDeclarationType('');
        const b = biddings.find(x => x.id === biddingId);
        if (b) {
            const mod = (b.modality || '').trim();
            const tit = (b.title || '').trim();
            const cleanTitle = tit.replace(new RegExp(`^${mod}\\s*(nº)?\\s*`, 'i'), '').trim();
            const finalOrg = cleanTitle ? `${mod} nº ${cleanTitle}` : tit;
            updateLayout({ addresseeOrg: finalOrg });
        }
    };

    // Auto-select first declaration type
    useMemo(() => {
        if (declarationTypesFromEdital.length > 0 && !declarationType) setDeclarationType(declarationTypesFromEdital[0]);
    }, [declarationTypesFromEdital]);

    // Auto-populate company data
    useEffect(() => {
        if (!selectedCompanyId) return;
        const c = companies.find(x => x.id === selectedCompanyId);
        if (!c) return;

        const addr = c.qualification?.split(/sediada\s+(?:na|no|em)\s+/i)[1]?.split(/,?\s*neste\s+ato/i)[0]?.trim() || '';
        const qual = (c.qualification || '').trim();

        let city = '';
        const cityMatch = qual.match(/,\s*([^,.(0-9\-]{3,30})\s*[/|-]\s*([A-Z]{2})(?=\s*,|\s+CEP|\s+inscrita|\s*neste|$)/i);
        if (cityMatch) city = `${cityMatch[1].trim()}/${cityMatch[2].trim()}`;
        else {
            const cityFallback = addr.match(/,\s*([^,.(0-9\-]{3,25}(?:\/|-)[A-Z]{2})\s*$/);
            if (cityFallback) city = cityFallback[1].trim();
            else { const munMatch = qual.match(/(?:município\s+de|cidade\s+de)\s+([^,.(0-9]{3,30})/i); if (munMatch) city = munMatch[1].trim(); }
        }

        let cpf = '';
        const cpfMatch = qual.match(/(\d{3}\.\d{3}\.\d{3}-\d{2})/);
        if (cpfMatch) cpf = `CPF nº: ${cpfMatch[0]}`;

        let fullName = c.contactName || '';
        const nameMatch = qual.match(/representada\s+por\s+(?:seu\s+)?(?:Sócio\s+Administrador|representante\s+legal\s+)?(?:,\s*)?(?:a\s+Sra\.\s+|o\s+Sr\.\s+)?([^,.(0-9]{3,60})(?=\s*,\s*|,\s*brasileir|,\s*solteir|$)/i);
        if (nameMatch?.[1]) { const d = nameMatch[1].trim(); if (d.split(' ').length > (fullName.split(' ').length || 0)) fullName = d; }

        if (issuerType === 'technical' && c.technicalQualification) {
            const techLines = c.technicalQualification.split('\n').filter(l => l.trim());
            const techName = techLines[0]?.split(',')[0]?.trim() || fullName;
            const techCpfMatch = c.technicalQualification.match(/(\d{3}\.\d{3}\.\d{3}-\d{2})/);
            const techCityMatch = c.technicalQualification.match(/(?:município\s+de|cidade\s+de|em)\s+([^,.]+)/i);
            updateLayout({
                signatoryName: techName, signatoryRole: 'Responsável Técnico',
                signatoryCpf: techCpfMatch ? `CPF nº: ${techCpfMatch[0]}` : '',
                signatureCity: techCityMatch ? techCityMatch[1].trim() : city,
                footerText: `${c.razaoSocial} | CNPJ: ${c.cnpj}${addr ? `\nEnd: ${addr}` : ''}\nTel: ${c.contactPhone || ''} | Email: ${c.contactEmail || ''}`
            });
        } else {
            updateLayout({
                headerText: `${c.razaoSocial}\nCNPJ: ${c.cnpj}`,
                signatoryCompany: c.razaoSocial, signatoryCnpj: `CNPJ: ${c.cnpj}`,
                signatoryName: fullName, signatoryCpf: cpf, signatoryRole: 'Representante Legal',
                signatureCity: city,
                footerText: `${c.razaoSocial} | CNPJ: ${c.cnpj}${addr ? `\nEnd: ${addr}` : ''}\nTel: ${c.contactPhone || ''} | Email: ${c.contactEmail || ''}`
            });
        }
    }, [issuerType, selectedCompanyId, companies, updateLayout]);

    const handleCompanyChange = (companyId: string) => setSelectedCompanyId(companyId);

    // ── Generate ──
    const handleGenerate = async () => {
        if (!selectedBiddingId || !selectedCompanyId || !declarationType) {
            toast.warning('Selecione licitação, empresa e tipo de declaração.'); return;
        }
        setIsGenerating(true); setSaveSuccess(false);
        try {
            const response = await fetch(`${API_BASE_URL}/api/generate-declaration`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                body: JSON.stringify({ biddingProcessId: selectedBiddingId, companyId: selectedCompanyId, declarationType, issuerType, customPrompt, signatureCity: layout.signatureCity, signatureDate: layout.signatureDate })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.details || data.error || 'Falha ao gerar');
            setGeneratedText(data.text);
            if (data.title) setDeclarationType(data.title.toUpperCase());
        } catch (error: any) { toast.error(`Erro ao gerar declaração: ${error.message}`); }
        finally { setIsGenerating(false); }
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
            if (layout.footerText) { doc.setFontSize(7.5); doc.setTextColor(100); doc.setFont('helvetica', 'italic'); const ftLines = doc.splitTextToSize(layout.footerText, mw); fy = ph - 6; doc.text(ftLines, pw / 2, fy, { align: 'center' }); fy -= ftLines.length * 3 + 2; }
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
            const isNumbered = /^\d+[\.)]\ /.test(trimmed);
            const indent = isNumbered ? 8 : 0;
            const textWidth = mw - indent;
            const paraLines = doc.splitTextToSize(trimmed, textWidth);
            const paraHeight = paraLines.length * lh;

            if (y + paraHeight <= contentMaxY) {
                doc.text(trimmed, m + indent, y, { align: 'justify', maxWidth: textWidth });
                y += paraHeight;
            } else {
                const linesAvailable = Math.floor((contentMaxY - y) / lh);
                if (linesAvailable > 0) { const firstChunk = paraLines.slice(0, linesAvailable).join(' '); doc.text(firstChunk, m + indent, y, { align: 'justify', maxWidth: textWidth }); }
                y = newPage(); resetBodyFont();
                const remainingLines = paraLines.slice(linesAvailable > 0 ? linesAvailable : 0);
                if (remainingLines.length > 0) { const rest = remainingLines.join(' '); doc.text(rest, m + indent, y, { align: 'justify', maxWidth: textWidth }); y += remainingLines.length * lh; }
            }
            y += 3;
        }

        y += 6;
        const sigBlockHeight = 55;
        if (y + sigBlockHeight > contentMaxY) { y = newPage(); } else { y += 10; }

        // Location & Date
        if (layout.signatureCity || layout.signatureDate) {
            doc.setFontSize(10.5); doc.setFont('helvetica', 'italic'); doc.setTextColor(0);
            const dateLine = `${layout.signatureCity}${layout.signatureCity && layout.signatureDate ? ', ' : ''}${layout.signatureDate}.`;
            doc.text(dateLine, pw - m, y, { align: 'right' }); y += 15;
        }

        // Signature
        doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
        doc.text('__________________________________________', pw / 2, y, { align: 'center' }); y += 5;
        if (layout.signatoryName) { doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text(layout.signatoryName.toUpperCase(), pw / 2, y, { align: 'center' }); y += 4.5; }
        if (layout.signatoryCpf) { doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(layout.signatoryCpf, pw / 2, y, { align: 'center' }); y += 4.5; }
        if (layout.signatoryRole) { doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(layout.signatoryRole, pw / 2, y, { align: 'center' }); y += 4.5; }
        if (layout.signatoryCompany) { doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.text(layout.signatoryCompany, pw / 2, y, { align: 'center' }); y += 4.5; }
        if (layout.signatoryCnpj) { doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(layout.signatoryCnpj, pw / 2, y, { align: 'center' }); }

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
        isGenerating, isSaving, generatedText, setGeneratedText, saveSuccess,
        confirmAction, setConfirmAction, layoutSaved,
        layouts, currentLayoutId, layoutName,
        // Computed
        layout, biddingsWithAnalysis, declarationTypesFromEdital,
        // Layout actions
        updateLayout, handleCreateLayout, handleDeleteLayout, handleResetLayout,
        handleSaveLayout, handleSwitchLayout, handleUpdateLayoutName, handleImageUpload,
        // Core actions
        handleBiddingChange, handleCompanyChange, handleGenerate,
        handleExportPDF, handleAddToDocuments,
    };
}
