import { useState, useMemo, useCallback, useEffect } from 'react';
import { FileText, Sparkles, Download, Save, Loader2, CheckCircle2, Image, X, Settings2, Plus, Trash2 } from 'lucide-react';
import { jsPDF } from 'jspdf';
import { API_BASE_URL } from '../../config';
import type { BiddingProcess, CompanyProfile } from '../../types';
import { useToast, ConfirmDialog } from '../ui';

interface Props {
    biddings: BiddingProcess[];
    companies: CompanyProfile[];
    onSave?: () => void;
}

interface LayoutConfig {
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

const DEFAULT_LAYOUT: Omit<LayoutConfig, 'id' | 'name'> = {
    headerImage: null,
    footerImage: null,
    headerImageWidth: 40,
    headerImageHeight: 20,
    footerImageWidth: 40,
    footerImageHeight: 20,
    headerText: '',
    footerText: '',
    signatureCity: '',
    signatureDate: '', // Will be filled dynamically
    signatoryName: '',
    signatoryRole: '',
    signatoryCpf: '',
    signatoryCompany: '',
    signatoryCnpj: '',
    addresseeName: 'Agente de Contratação',
    addresseeOrg: '',
};

const STORAGE_KEY = 'declaration_layouts';

function loadLayouts(): LayoutConfig[] {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }

        // Migrate old single config
        const old = localStorage.getItem('declaration_layout_config');
        if (old) {
            const oldParsed = JSON.parse(old);
            localStorage.removeItem('declaration_layout_config');
            return [{ ...DEFAULT_LAYOUT, ...oldParsed, id: 'default', name: 'Layout Principal' }];
        }
    } catch { /* ignore */ }
    return [{ ...DEFAULT_LAYOUT, id: 'default', name: 'Layout Principal' } as LayoutConfig];
}

function saveLayouts(layouts: LayoutConfig[]) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(layouts)); } catch { /* ignore */ }
}

function extractDeclarationTypes(rawReq: any): string[] {
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
            if (
                lower.includes('declaraç') ||
                lower.includes('declarac') ||
                lower.includes('declare') ||
                lower.includes('indicação do pessoal técnico') ||
                lower.includes('indicacao do pessoal tecnico') ||
                lower.includes('equipe técnica') ||
                lower.includes('equipe tecnica')
            ) {
                declarations.push(text);
            }
        });
    } catch { /* ignore */ }
    return declarations;
}

export function AiDeclarationGenerator({ biddings, companies, onSave }: Props) {
    const toast = useToast();
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
    useEffect(() => {
        saveLayouts(layouts);
    }, [layouts]);

    // Ensure date is always today on mount
    useEffect(() => {
        const today = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
        if (layout && !layout.signatureDate) {
            updateLayout({ signatureDate: today });
        }
    }, [layout, updateLayout]);

    const handleCreateLayout = () => {
        const newId = `layout_${Date.now()}`;
        const today = new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
        const newLayout: LayoutConfig = { ...DEFAULT_LAYOUT, id: newId, name: 'Novo Layout', signatureDate: today };
        setLayouts(prev => [...prev, newLayout]);
        setCurrentLayoutId(newId);
        setLayoutName('Novo Layout');
    };

    const handleDeleteLayout = () => {
        if (layouts.length <= 1) return;
        setConfirmAction({
            type: 'deleteLayout',
            onConfirm: () => {
                const remaining = layouts.filter(l => l.id !== currentLayoutId);
                setLayouts(remaining);
                saveLayouts(remaining);
                setCurrentLayoutId(remaining[0].id);
                setLayoutName(remaining[0].name);
                setConfirmAction(null);
            }
        });
    };

    const handleResetLayout = () => {
        setConfirmAction({
            type: 'resetLayout',
            onConfirm: () => {
                updateLayout({ ...DEFAULT_LAYOUT, name: layoutName });
                setConfirmAction(null);
            }
        });
    };

    const biddingsWithAnalysis = useMemo(() =>
        biddings.filter(b => b.status === 'Preparando Documentação' && (b.aiAnalysis || b.summary))
        , [biddings]);

    const declarationTypesFromEdital = useMemo(() => {
        if (!selectedBiddingId) return [];
        const b = biddings.find(b => b.id === selectedBiddingId);
        if (!b?.aiAnalysis?.requiredDocuments) return [];
        return extractDeclarationTypes(b.aiAnalysis.requiredDocuments);
    }, [selectedBiddingId, biddings]);

    const handleBiddingChange = (biddingId: string) => {
        setSelectedBiddingId(biddingId);
        setDeclarationType('');
        const b = biddings.find(x => x.id === biddingId);
        if (b) {
            const mod = (b.modality || '').trim();
            const tit = (b.title || '').trim();

            // Evitar duplicação: se o título já contém a modalidade, extraímos apenas o número
            // Ex: Modality="Pregão Eletrônico", Title="Pregão Eletrônico nº 004/26" -> Org="Pregão Eletrônico nº 004/26"
            const cleanTitle = tit.replace(new RegExp(`^${mod}\\s*(nº)?\\s*`, 'i'), '').trim();
            const finalOrg = cleanTitle ? `${mod} nº ${cleanTitle}` : tit;

            updateLayout({
                addresseeOrg: finalOrg
            });
        }
    };

    // Auto-select first type
    useMemo(() => {
        if (declarationTypesFromEdital.length > 0 && !declarationType) {
            setDeclarationType(declarationTypesFromEdital[0]);
        }
    }, [declarationTypesFromEdital]);

    // Auto-populate company data on selection & issuer type change
    useEffect(() => {
        if (!selectedCompanyId) return;
        const c = companies.find(x => x.id === selectedCompanyId);
        if (!c) return;

        const addr = c.qualification?.split(/sediada\s+(?:na|no|em)\s+/i)[1]?.split(/,?\s*neste\s+ato/i)[0]?.trim() || '';
        const qual = (c.qualification || '').trim();

        // 1. Extração robusta do Local (Cidade/UF)
        let city = '';
        // Padrão comum: ", Cidade/UF," ou ", Cidade - UF,"
        const cityMatch = qual.match(/,\s*([^,.(0-9\-]{3,30})\s*[/|-]\s*([A-Z]{2})(?=\s*,|\s+CEP|\s+inscrita|\s*neste|$)/i);
        if (cityMatch) {
            city = `${cityMatch[1].trim()}/${cityMatch[2].trim()}`;
        } else {
            // Fallback Cidade/UF no fim do addr
            const cityFallback = addr.match(/,\s*([^,.(0-9\-]{3,25}(?:\/|-)[A-Z]{2})\s*$/);
            if (cityFallback) city = cityFallback[1].trim();
            else {
                const munMatch = qual.match(/(?:município\s+de|cidade\s+de)\s+([^,.(0-9]{3,30})/i);
                if (munMatch) city = munMatch[1].trim();
            }
        }

        // 2. Extração robusta do CPF
        let cpf = '';
        const cpfMatch = qual.match(/(\d{3}\.\d{3}\.\d{3}-\d{2})/);
        if (cpfMatch) {
            cpf = `CPF nº: ${cpfMatch[0]}`;
        }

        // 3. Nome completo
        let fullName = c.contactName || '';
        const nameMatch = qual.match(/representada\s+por\s+(?:seu\s+)?(?:Sócio\s+Administrador|representante\s+legal\s+)?(?:,\s*)?(?:a\s+Sra\.\s+|o\s+Sr\.\s+)?([^,.(0-9]{3,60})(?=\s*,\s*|,\s*brasileir|,\s*solteir|$)/i);
        if (nameMatch && nameMatch[1]) {
            const detectedName = nameMatch[1].trim();
            if (detectedName.split(' ').length > (fullName.split(' ').length || 0)) {
                fullName = detectedName;
            }
        }

        if (issuerType === 'technical' && c.technicalQualification) {
            const techLines = c.technicalQualification.split('\n').filter(l => l.trim());
            const techName = techLines[0]?.split(',')[0]?.trim() || fullName;
            // CPF e Local do Técnico
            const techCpfMatch = c.technicalQualification.match(/(\d{3}\.\d{3}\.\d{3}-\d{2})/);
            const techCityMatch = c.technicalQualification.match(/(?:município\s+de|cidade\s+de|em)\s+([^,.]+)/i);

            updateLayout({
                signatoryName: techName,
                signatoryRole: 'Responsável Técnico',
                signatoryCpf: techCpfMatch ? `CPF nº: ${techCpfMatch[0]}` : '',
                signatureCity: techCityMatch ? techCityMatch[1].trim() : city,
                footerText: `${c.razaoSocial} | CNPJ: ${c.cnpj}${addr ? `\nEnd: ${addr}` : ''}\nTel: ${c.contactPhone || ''} | Email: ${c.contactEmail || ''}`
            });
        } else {
            updateLayout({
                headerText: `${c.razaoSocial}\nCNPJ: ${c.cnpj}`,
                signatoryCompany: c.razaoSocial,
                signatoryCnpj: `CNPJ: ${c.cnpj}`,
                signatoryName: fullName,
                signatoryCpf: cpf,
                signatoryRole: 'Representante Legal',
                signatureCity: city,
                footerText: `${c.razaoSocial} | CNPJ: ${c.cnpj}${addr ? `\nEnd: ${addr}` : ''}\nTel: ${c.contactPhone || ''} | Email: ${c.contactEmail || ''}`
            });
        }
    }, [issuerType, selectedCompanyId, companies, updateLayout]);

    const handleCompanyChange = (companyId: string) => {
        setSelectedCompanyId(companyId);
    };

    const handleSaveLayout = () => {
        saveLayouts(layouts);
        setLayoutSaved(true);
        setTimeout(() => setLayoutSaved(false), 2000);
    };

    const handleImageUpload = (target: 'headerImage' | 'footerImage', file: File) => {
        const reader = new FileReader();
        reader.onload = () => updateLayout({ [target]: reader.result as string });
        reader.readAsDataURL(file);
    };

    const handleGenerate = async () => {
        if (!selectedBiddingId || !selectedCompanyId || !declarationType) {
            toast.warning('Selecione licitação, empresa e tipo de declaração.');
            return;
        }
        setIsGenerating(true);
        setSaveSuccess(false);
        try {
            const response = await fetch(`${API_BASE_URL}/api/generate-declaration`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify({
                    biddingProcessId: selectedBiddingId,
                    companyId: selectedCompanyId,
                    declarationType,
                    issuerType,
                    customPrompt,
                    signatureCity: layout.signatureCity,
                    signatureDate: layout.signatureDate
                })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.details || data.error || 'Falha ao gerar');
            setGeneratedText(data.text);
            if (data.title) setDeclarationType(data.title.toUpperCase());
        } catch (error: any) {
            toast.error(`Erro ao gerar declaração: ${error.message}`);
        } finally {
            setIsGenerating(false);
        }
    };

    // ── PDF Builder ──
    const buildPDF = () => {
        const doc = new jsPDF();
        const pw = doc.internal.pageSize.getWidth();
        const ph = doc.internal.pageSize.getHeight();
        const m = 20; // narrower margins
        const mw = pw - m * 2;

        // ── Calculate footer height for content area ──
        let footerHeight = 0;
        if (layout.footerImage) footerHeight += layout.footerImageHeight + 4;
        if (layout.footerText) footerHeight += 8;
        if (footerHeight > 0) footerHeight += 3; // extra padding
        const footerY = ph - footerHeight - 3; // where footer starts

        // ── Calculate header height ──
        let headerHeight = 10;
        if (layout.headerImage) headerHeight += layout.headerImageHeight + 3;
        if (layout.headerText) headerHeight += 15; // approximate

        // ── Helper: Draw header on current page ──
        const drawHeader = () => {
            let hy = 10;
            if (layout.headerImage) {
                const imgX = (pw - layout.headerImageWidth) / 2;
                doc.addImage(layout.headerImage, 'PNG', imgX, hy, layout.headerImageWidth, layout.headerImageHeight);
                hy += layout.headerImageHeight + 3;
            }
            if (layout.headerText) {
                doc.setFontSize(9);
                doc.setTextColor(60);
                doc.setFont('helvetica', 'normal');
                const hl = doc.splitTextToSize(layout.headerText, mw);
                doc.text(hl, pw / 2, hy, { align: 'center' });
                hy += hl.length * 3.5 + 2;
                doc.setDrawColor(160);
                doc.line(m, hy, pw - m, hy);
                hy += 6;
            }
            return hy;
        };

        // ── Helper: Draw footer on current page ──
        const drawFooter = () => {
            let fy = ph;
            if (layout.footerText) {
                doc.setFontSize(7.5);
                doc.setTextColor(100);
                doc.setFont('helvetica', 'italic');
                const ftLines = doc.splitTextToSize(layout.footerText, mw);
                fy = ph - 6;
                doc.text(ftLines, pw / 2, fy, { align: 'center' });
                fy -= ftLines.length * 3 + 2;
            }
            if (layout.footerImage) {
                const imgY = layout.footerText ? fy - layout.footerImageHeight : ph - layout.footerImageHeight - 5;
                const imgX = (pw - layout.footerImageWidth) / 2;
                doc.addImage(layout.footerImage, 'PNG', imgX, imgY, layout.footerImageWidth, layout.footerImageHeight);
            }
        };

        // ── Helper: New page with header + footer ──
        const newPage = () => {
            drawFooter(); // footer on current page
            doc.addPage();
            return drawHeader(); // header on new page, returns y position
        };

        // Max Y for content before triggering page break
        const contentMaxY = footerY - 8;

        // ── PAGE 1: Header ──
        let y = drawHeader();

        // ── ADDRESSEE BLOCK ──
        if (layout.addresseeName || layout.addresseeOrg) {
            doc.setFontSize(10);
            doc.setTextColor(0);
            doc.setFont('helvetica', 'normal');
            if (layout.addresseeName) { doc.text(`Ao ${layout.addresseeName}`, m, y); y += 5; }
            if (layout.addresseeOrg) {
                layout.addresseeOrg.split('\n').forEach(l => {
                    if (l.trim()) { doc.text(l.trim(), m, y); y += 5; }
                });
            }
            y += 6;
        }

        // ── TITLE ──
        doc.setFontSize(12);
        doc.setTextColor(0);
        doc.setFont('helvetica', 'bold');
        const tl = doc.splitTextToSize(declarationType.toUpperCase(), mw - 20);
        tl.forEach((line: string) => {
            doc.text(line, pw / 2, y, { align: 'center' });
            y += 6;
        });
        y += 6;

        // ── BODY – justified, paragraph-aware ──
        doc.setFontSize(10.5);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(0);

        const paragraphs = generatedText.split(/\n\s*\n|\n/).filter(p => p.trim());
        const lh = 5;

        const resetBodyFont = () => {
            doc.setFontSize(10.5);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(0);
        };

        for (const para of paragraphs) {
            const trimmed = para.trim();
            if (!trimmed) continue;

            const isNumbered = /^\d+[\.\)]\s/.test(trimmed);
            const indent = isNumbered ? 8 : 0;
            const textWidth = mw - indent;

            const paraLines = doc.splitTextToSize(trimmed, textWidth);
            const paraHeight = paraLines.length * lh;

            // Check if entire paragraph fits on current page
            if (y + paraHeight <= contentMaxY) {
                // Render entire paragraph as one block — jsPDF justifies correctly
                doc.text(trimmed, m + indent, y, { align: 'justify', maxWidth: textWidth });
                y += paraHeight;
            } else {
                // Paragraph spans pages — split into chunks
                const linesAvailable = Math.floor((contentMaxY - y) / lh);

                if (linesAvailable > 0) {
                    // Render what fits on current page as a joined block
                    const firstChunk = paraLines.slice(0, linesAvailable).join(' ');
                    doc.text(firstChunk, m + indent, y, { align: 'justify', maxWidth: textWidth });
                }

                // New page
                y = newPage();
                resetBodyFont();

                // Render remaining lines on new page
                const remainingLines = paraLines.slice(linesAvailable > 0 ? linesAvailable : 0);
                if (remainingLines.length > 0) {
                    const rest = remainingLines.join(' ');
                    doc.text(rest, m + indent, y, { align: 'justify', maxWidth: textWidth });
                    y += remainingLines.length * lh;
                }
            }
            y += 3;
        }

        y += 6;

        // ── Check if signature block fits on current page ──
        // signatoryName + city/date + line + other details
        const sigBlockHeight = 55;

        if (y + sigBlockHeight > contentMaxY) {
            y = newPage();
        } else {
            y += 10; // Margin after text
        }

        // ── LOCATION & DATE ──
        if (layout.signatureCity || layout.signatureDate) {
            doc.setFontSize(10.5);
            doc.setFont('helvetica', 'italic');
            doc.setTextColor(0);
            const dateLine = `${layout.signatureCity}${layout.signatureCity && layout.signatureDate ? ', ' : ''}${layout.signatureDate}.`;
            doc.text(dateLine, pw - m, y, { align: 'right' });
            y += 15;
        }

        // ── SIGNATURE ──
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.text('__________________________________________', pw / 2, y, { align: 'center' });
        y += 5;
        if (layout.signatoryName) { doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text(layout.signatoryName.toUpperCase(), pw / 2, y, { align: 'center' }); y += 4.5; }
        if (layout.signatoryCpf) { doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(layout.signatoryCpf, pw / 2, y, { align: 'center' }); y += 4.5; }
        if (layout.signatoryRole) { doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(layout.signatoryRole, pw / 2, y, { align: 'center' }); y += 4.5; }
        if (layout.signatoryCompany) { doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.text(layout.signatoryCompany, pw / 2, y, { align: 'center' }); y += 4.5; }
        if (layout.signatoryCnpj) { doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(layout.signatoryCnpj, pw / 2, y, { align: 'center' }); }

        // ── FOOTER on last page ──
        drawFooter();

        return doc;
    };

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
            const res = await fetch(`${API_BASE_URL}/api/documents`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                body: formData
            });
            if (!res.ok) throw new Error('Falha ao salvar');
            setSaveSuccess(true);
            onSave?.();
            setTimeout(() => setSaveSuccess(false), 3000);
        } catch (e) { toast.error('Erro ao salvar declaração.'); }
        finally { setIsSaving(false); }
    };

    // ── RENDER ──
    return (
        <>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(340px, 1fr) 2fr', gap: 'var(--space-7)', height: 'fit-content' }}>

            {/* LEFT: Configuration */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>

                {/* AI Config */}
                <div style={cardStyle}>
                    <h3 style={{ margin: '0 0 var(--space-4)', fontSize: 'var(--text-lg)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                        <Sparkles size={18} color="var(--color-primary)" /> Configuração da IA
                    </h3>
                    <Field label="Licitação Alvo">
                        <select style={inputStyle} value={selectedBiddingId} onChange={(e) => handleBiddingChange(e.target.value)}>
                            <option value="">-- Selecione --</option>
                            {biddingsWithAnalysis.map(b => <option key={b.id} value={b.id}>{b.title}</option>)}
                        </select>
                    </Field>
                    <Field label="Empresa Emitente">
                        <select style={inputStyle} value={selectedCompanyId} onChange={(e) => handleCompanyChange(e.target.value)}>
                            <option value="">-- Selecione --</option>
                            {companies.map(c => <option key={c.id} value={c.id}>{c.razaoSocial}</option>)}
                        </select>
                    </Field>
                    <Field label="Tipo de Declaração (do Edital)">
                        {declarationTypesFromEdital.length === 0 ? (
                            <div style={{ padding: 'var(--space-3)', borderRadius: 'var(--radius-sm)', background: selectedBiddingId ? 'var(--color-warning-bg)' : 'var(--color-bg-body)', border: '1px solid var(--color-border)', fontSize: 'var(--text-md)', color: 'var(--color-text-tertiary)' }}>
                                {selectedBiddingId ? 'Nenhuma declaração identificada neste edital.' : 'Selecione uma licitação.'}
                            </div>
                        ) : (
                            <select style={inputStyle} value={declarationType} onChange={(e) => setDeclarationType(e.target.value)}>
                                {declarationTypesFromEdital.map((t, i) => <option key={i} value={t}>{t}</option>)}
                            </select>
                        )}
                    </Field>
                    <Field label="Emitente da Declaração">
                        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                            <label style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', border: issuerType === 'company' ? '2px solid var(--color-primary)' : '1px solid var(--color-border)', background: issuerType === 'company' ? 'var(--color-primary-light)' : 'var(--color-bg-body)', fontSize: 'var(--text-sm)', fontWeight: issuerType === 'company' ? 'var(--font-semibold)' : 'var(--font-normal)' }}>
                                <input type="radio" name="issuerType" checked={issuerType === 'company'} onChange={() => setIssuerType('company')} style={{ accentColor: 'var(--color-primary)' }} />
                                Empresa (Rep. Legal)
                            </label>
                            <label style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-sm)', cursor: selectedCompanyId && companies.find(c => c.id === selectedCompanyId)?.technicalQualification ? 'pointer' : 'not-allowed', border: issuerType === 'technical' ? '2px solid var(--color-primary)' : '1px solid var(--color-border)', background: issuerType === 'technical' ? 'var(--color-primary-light)' : 'var(--color-bg-body)', fontSize: 'var(--text-sm)', fontWeight: issuerType === 'technical' ? 'var(--font-semibold)' : 'var(--font-normal)', opacity: selectedCompanyId && companies.find(c => c.id === selectedCompanyId)?.technicalQualification ? 1 : 0.4 }}>
                                <input type="radio" name="issuerType" checked={issuerType === 'technical'} onChange={() => setIssuerType('technical')} disabled={!selectedCompanyId || !companies.find(c => c.id === selectedCompanyId)?.technicalQualification} style={{ accentColor: 'var(--color-primary)' }} />
                                Profissional Técnico
                            </label>
                        </div>
                        {issuerType === 'technical' && !companies.find(c => c.id === selectedCompanyId)?.technicalQualification && (
                            <p style={{ color: 'var(--color-danger)', fontSize: '0.72rem', marginTop: '4px', marginBottom: 0 }}>Cadastre a qualificação técnica na aba Documentos → editar empresa.</p>
                        )}
                    </Field>
                    <Field label="Instruções Adicionais">
                        <textarea style={{ ...inputStyle, minHeight: '60px', resize: 'vertical' }} placeholder="Opcional..." value={customPrompt} onChange={(e) => setCustomPrompt(e.target.value)} />
                    </Field>
                    <button className="btn btn-primary" style={{ width: '100%', height: '44px', gap: 'var(--space-2)', marginTop: '4px' }} onClick={handleGenerate} disabled={isGenerating || !selectedBiddingId || !selectedCompanyId || !declarationType}>
                        {isGenerating ? <Loader2 size={18} className="spin" /> : <Sparkles size={18} />}
                        {isGenerating ? 'Gerando...' : 'Gerar Declaração'}
                    </button>
                </div>

                {/* Layout Settings */}
                <div style={cardStyle}>
                    <div className="flex-between" style={{ marginBottom: 'var(--space-3)' }}>
                        <h4 style={{ margin: 0, fontSize: 'var(--text-md)', color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                            <Settings2 size={14} /> Layout & Assinatura
                        </h4>
                        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                            <button className="btn btn-outline" style={{ fontSize: 'var(--text-sm)', padding: '3px var(--space-2)', gap: '4px' }} onClick={handleSaveLayout}>
                                {layoutSaved ? <CheckCircle2 size={12} color="var(--color-success)" /> : <Save size={12} />}
                                {layoutSaved ? 'Salvo!' : 'Salvar'}
                            </button>
                            <button className="btn btn-outline" style={{ fontSize: 'var(--text-sm)', padding: '3px var(--space-2)', gap: '4px' }} onClick={handleCreateLayout}>
                                <Plus size={12} /> Novo
                            </button>
                            <button className="btn btn-outline" style={{ fontSize: 'var(--text-sm)', padding: '3px var(--space-2)', gap: '4px', color: 'var(--color-danger)' }} onClick={handleResetLayout}>
                                <X size={12} /> Limpar
                            </button>
                        </div>
                    </div>

                    {/* Layout Selector */}
                    <div style={{ marginBottom: 'var(--space-4)', display: 'flex', gap: 'var(--space-2)' }}>
                        <select style={{ ...inputStyle, flex: 1, fontSize: '0.8rem' }} value={currentLayoutId} onChange={(e) => {
                            const found = layouts.find(l => l.id === e.target.value);
                            setCurrentLayoutId(e.target.value);
                            if (found) setLayoutName(found.name);
                        }}>
                            {layouts.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                        </select>
                        <button className="icon-btn" style={{ color: 'var(--color-danger)', opacity: layouts.length > 1 ? 1 : 0.3 }} onClick={handleDeleteLayout} disabled={layouts.length <= 1}>
                            <Trash2 size={14} />
                        </button>
                    </div>

                    <div style={{ marginBottom: 'var(--space-4)' }}>
                        <label style={smallLabel}>Nome do Layout</label>
                        <input style={smallInput} value={layoutName} onChange={(e) => {
                            setLayoutName(e.target.value);
                            updateLayout({ name: e.target.value });
                        }} placeholder="Ex: Layout Empresa A" />
                    </div>

                    {/* Addressee */}
                    <div style={{ padding: 'var(--space-3)', backgroundColor: 'var(--color-bg-body)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', marginBottom: 'var(--space-3)' }}>
                        <label style={{ ...labelStyle, fontSize: '0.7rem', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Destinatário</label>
                        <input style={{ ...inputStyle, fontSize: '0.8rem', marginBottom: '6px' }} placeholder="Ex: Agente de Contratação" value={layout.addresseeName} onChange={(e) => updateLayout({ addresseeName: e.target.value })} />
                        <textarea style={{ ...inputStyle, fontSize: '0.8rem', minHeight: '40px' }} placeholder="Órgão / Pregão nº..." value={layout.addresseeOrg} onChange={(e) => updateLayout({ addresseeOrg: e.target.value })} />
                    </div>

                    {/* City/Date */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
                        <div><label style={smallLabel}>Local</label><input style={smallInput} value={layout.signatureCity} onChange={(e) => updateLayout({ signatureCity: e.target.value })} /></div>
                        <div><label style={smallLabel}>Data</label><input style={smallInput} value={layout.signatureDate} onChange={(e) => updateLayout({ signatureDate: e.target.value })} /></div>
                    </div>

                    {/* Signatory block */}
                    <div style={{ padding: 'var(--space-3)', backgroundColor: 'var(--color-bg-body)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', marginBottom: 'var(--space-3)' }}>
                        <label style={{ ...labelStyle, fontSize: '0.7rem', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Bloco de Assinatura</label>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)' }}>
                            <div><label style={smallLabel}>Nome</label><input style={smallInput} placeholder="NOME COMPLETO" value={layout.signatoryName} onChange={(e) => updateLayout({ signatoryName: e.target.value })} /></div>
                            <div><label style={smallLabel}>CPF</label><input style={smallInput} placeholder="CPF nº: 000.000.000-00" value={layout.signatoryCpf} onChange={(e) => updateLayout({ signatoryCpf: e.target.value })} /></div>
                            <div><label style={smallLabel}>Cargo</label><input style={smallInput} placeholder="Sócio Administrador" value={layout.signatoryRole} onChange={(e) => updateLayout({ signatoryRole: e.target.value })} /></div>
                            <div><label style={smallLabel}>Empresa</label><input style={smallInput} value={layout.signatoryCompany} onChange={(e) => updateLayout({ signatoryCompany: e.target.value })} /></div>
                        </div>
                        <div style={{ marginTop: '6px' }}><label style={smallLabel}>CNPJ</label><input style={smallInput} value={layout.signatoryCnpj} onChange={(e) => updateLayout({ signatoryCnpj: e.target.value })} /></div>
                    </div>

                    {/* Images */}
                    <ImageUploadSection label="Logotipo Cabeçalho" image={layout.headerImage} width={layout.headerImageWidth} height={layout.headerImageHeight}
                        onUpload={(f) => handleImageUpload('headerImage', f)} onRemove={() => updateLayout({ headerImage: null })}
                        onWidthChange={(w) => updateLayout({ headerImageWidth: w })} onHeightChange={(h) => updateLayout({ headerImageHeight: h })} />

                    <Field label="Cabeçalho (Texto)">
                        <textarea style={{ ...inputStyle, fontSize: '0.8rem', minHeight: '40px' }} value={layout.headerText} onChange={(e) => updateLayout({ headerText: e.target.value })} placeholder="Razão Social / CNPJ" />
                    </Field>

                    <ImageUploadSection label="Logotipo Rodapé" image={layout.footerImage} width={layout.footerImageWidth} height={layout.footerImageHeight}
                        onUpload={(f) => handleImageUpload('footerImage', f)} onRemove={() => updateLayout({ footerImage: null })}
                        onWidthChange={(w) => updateLayout({ footerImageWidth: w })} onHeightChange={(h) => updateLayout({ footerImageHeight: h })} />

                    <Field label="Rodapé (Texto)">
                        <textarea style={{ ...inputStyle, fontSize: '0.8rem', minHeight: '40px' }} value={layout.footerText} onChange={(e) => updateLayout({ footerText: e.target.value })} placeholder="Endereço / contato" />
                    </Field>
                </div>
            </div>

            {/* RIGHT: Editor & Preview */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                <div style={{ ...cardStyle, flex: 1, minHeight: '600px', display: 'flex', flexDirection: 'column' }}>
                    <div className="flex-between" style={{ marginBottom: 'var(--space-4)' }}>
                        <div className="flex-gap">
                            <div style={{ width: '28px', height: '28px', borderRadius: 'var(--radius-sm)', background: 'var(--color-primary-light)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <FileText size={16} color="var(--color-primary)" />
                            </div>
                            <h3 style={{ margin: 0, fontSize: 'var(--text-lg)' }}>Editor da Declaração</h3>
                        </div>
                        <div className="flex-gap">
                            {saveSuccess && <span style={{ color: 'var(--color-success)', fontSize: 'var(--text-md)' }} className="flex-gap"><CheckCircle2 size={14} /> Salvo!</span>}
                            <button className="btn btn-outline flex-gap" onClick={handleAddToDocuments} disabled={!generatedText || isSaving} style={{ fontSize: '0.8rem' }}>
                                {isSaving ? <Loader2 size={14} className="spin" /> : <Save size={14} />} Vincular ao Dossiê
                            </button>
                            <button className="btn flex-gap" onClick={handleExportPDF} disabled={!generatedText} style={{ backgroundColor: 'var(--color-success)', color: 'white', fontSize: 'var(--text-md)' }}>
                                <Download size={14} /> Baixar PDF
                            </button>
                        </div>
                    </div>

                    {!generatedText && !isGenerating ? (
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', opacity: 0.4, textAlign: 'center' }}>
                            <Sparkles size={56} style={{ marginBottom: 'var(--space-3)' }} />
                            <h3>Pronto para gerar</h3>
                            <p style={{ fontSize: '0.9rem' }}>Selecione uma licitação com Relatório Analítico.</p>
                        </div>
                    ) : (
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                            <div style={pageMockupStyle}>
                                {/* Header */}
                                {layout.headerImage && (
                                    <div style={{ textAlign: 'center', marginBottom: '6px' }}>
                                        <img src={layout.headerImage} alt="Logo" style={{ maxWidth: `${layout.headerImageWidth * 2.5}px`, maxHeight: `${layout.headerImageHeight * 2.5}px`, objectFit: 'contain' }} />
                                    </div>
                                )}
                                {layout.headerText && (
                                    <div style={{ textAlign: 'center', borderBottom: '1px solid #ccc', paddingBottom: '8px', marginBottom: '16px', fontSize: '0.65rem', color: '#666', whiteSpace: 'pre-line', lineHeight: 1.3 }}>
                                        {layout.headerText}
                                    </div>
                                )}

                                {/* Addressee */}
                                {(layout.addresseeName || layout.addresseeOrg) && (
                                    <div style={{ fontSize: '0.75rem', color: '#444', marginBottom: '16px', lineHeight: 1.5 }}>
                                        {layout.addresseeName && <div>Ao {layout.addresseeName}</div>}
                                        {layout.addresseeOrg && <div style={{ whiteSpace: 'pre-line' }}>{layout.addresseeOrg}</div>}
                                    </div>
                                )}

                                {/* Title */}
                                <div style={{ textAlign: 'center', fontWeight: 'bold', marginBottom: '20px', fontSize: '0.95rem', textTransform: 'uppercase', lineHeight: 1.3, wordBreak: 'break-word' }}>
                                    {declarationType || 'DECLARAÇÃO'}
                                </div>

                                {/* Body */}
                                <textarea style={editorTextStyle} value={generatedText} onChange={(e) => setGeneratedText(e.target.value)} placeholder="Texto gerado aqui..." />

                                {/* Location/Date */}
                                {(layout.signatureCity || layout.signatureDate) && (
                                    <div style={{ textAlign: 'right', marginTop: '20px', fontSize: '0.8rem', color: '#333', fontStyle: 'italic' }}>
                                        {layout.signatureCity}{layout.signatureCity && layout.signatureDate ? ', ' : ''}{layout.signatureDate}.
                                    </div>
                                )}

                                {/* Signature block */}
                                <div style={{ textAlign: 'center', marginTop: '30px' }}>
                                    <div style={{ color: '#333', marginBottom: '3px', fontSize: '0.8rem' }}>__________________________________________</div>
                                    {layout.signatoryName && <div style={{ fontWeight: 'bold', fontSize: '0.78rem' }}>{layout.signatoryName.toUpperCase()}</div>}
                                    {layout.signatoryCpf && <div style={{ fontSize: '0.7rem', color: '#555' }}>{layout.signatoryCpf}</div>}
                                    {layout.signatoryRole && <div style={{ fontSize: '0.7rem', color: '#555' }}>{layout.signatoryRole}</div>}
                                    {layout.signatoryCompany && <div style={{ fontWeight: 'bold', fontSize: '0.75rem' }}>{layout.signatoryCompany}</div>}
                                    {layout.signatoryCnpj && <div style={{ fontSize: '0.7rem', color: '#555' }}>{layout.signatoryCnpj}</div>}
                                </div>

                                {/* Footer */}
                                <div style={{ marginTop: 'auto', paddingTop: '20px' }}>
                                    {layout.footerImage && (
                                        <div style={{ textAlign: 'center', marginBottom: '4px' }}>
                                            <img src={layout.footerImage} alt="Rodapé" style={{ maxWidth: `${layout.footerImageWidth * 2.5}px`, maxHeight: `${layout.footerImageHeight * 2.5}px`, objectFit: 'contain' }} />
                                        </div>
                                    )}
                                    {layout.footerText && (
                                        <div style={{ textAlign: 'center', borderTop: '1px solid #ccc', paddingTop: '6px', fontSize: '0.6rem', color: '#999', whiteSpace: 'pre-line' }}>
                                            {layout.footerText}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
            <ConfirmDialog
                open={!!confirmAction}
                title={confirmAction?.type === 'deleteLayout' ? 'Excluir Layout' : 'Limpar Layout'}
                message={confirmAction?.type === 'deleteLayout' ? 'Excluir este layout permanentemente? Esta ação não pode ser desfeita.' : 'Limpar todos os campos deste layout?'}
                variant={confirmAction?.type === 'deleteLayout' ? 'danger' : 'warning'}
                confirmLabel={confirmAction?.type === 'deleteLayout' ? 'Excluir' : 'Limpar'}
                onConfirm={() => confirmAction?.onConfirm()}
                onCancel={() => setConfirmAction(null)}
            />
        </>
    );
}

// ── Sub-components ──

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div style={{ marginBottom: '12px' }}>
            <label style={labelStyle}>{label}</label>
            {children}
        </div>
    );
}

function ImageUploadSection({ label, image, width, height, onUpload, onRemove, onWidthChange, onHeightChange }: {
    label: string; image: string | null; width: number; height: number;
    onUpload: (f: File) => void; onRemove: () => void; onWidthChange: (w: number) => void; onHeightChange: (h: number) => void;
}) {
    return (
        <div style={{ marginBottom: '12px' }}>
            <label style={smallLabel}>{label}</label>
            {image ? (
                <div style={{ border: '1px dashed var(--color-border)', borderRadius: '6px', padding: '8px', backgroundColor: 'var(--color-bg-body)' }}>
                    <div style={{ textAlign: 'center', marginBottom: '6px', background: 'white', padding: '6px', borderRadius: '4px' }}>
                        <img src={image} alt={label} style={{ maxWidth: `${width * 3}px`, maxHeight: `${height * 3}px`, objectFit: 'contain', display: 'block', margin: '0 auto' }} />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: '6px', alignItems: 'end' }}>
                        <div><label style={{ ...smallLabel, marginBottom: '2px' }}>Largura (mm)</label><input type="number" style={smallInput} value={width} onChange={(e) => onWidthChange(parseInt(e.target.value) || 10)} min={5} max={180} /></div>
                        <div><label style={{ ...smallLabel, marginBottom: '2px' }}>Altura (mm)</label><input type="number" style={smallInput} value={height} onChange={(e) => onHeightChange(parseInt(e.target.value) || 5)} min={5} max={80} /></div>
                        <button className="icon-btn" onClick={onRemove} title="Remover" style={{ padding: '4px', color: 'var(--color-danger)' }}><X size={14} /></button>
                    </div>
                </div>
            ) : (
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 12px', border: '1px dashed var(--color-border)', borderRadius: '6px', cursor: 'pointer', fontSize: '0.75rem', color: 'var(--color-text-tertiary)', backgroundColor: 'var(--color-bg-body)' }}>
                    <Image size={14} /> Anexar imagem
                    <input type="file" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) onUpload(f); }} style={{ display: 'none' }} />
                </label>
            )}
        </div>
    );
}

// ── Styles ──

const cardStyle: React.CSSProperties = { background: 'var(--color-bg-surface)', padding: 'var(--space-5)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-sm)' };
const labelStyle: React.CSSProperties = { display: 'block', marginBottom: 'var(--space-2)', fontSize: 'var(--text-md)', fontWeight: 'var(--font-semibold)', color: 'var(--color-text-secondary)' };
const smallLabel: React.CSSProperties = { display: 'block', marginBottom: '4px', fontSize: 'var(--text-sm)', fontWeight: 'var(--font-semibold)', color: 'var(--color-text-tertiary)' };
const inputStyle: React.CSSProperties = { width: '100%', padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', background: 'var(--color-bg-body)', color: 'var(--color-text-primary)', fontSize: 'var(--text-base)', outline: 'none' };
const smallInput: React.CSSProperties = { width: '100%', padding: '6px var(--space-2)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', background: 'var(--color-bg-body)', color: 'var(--color-text-primary)', fontSize: 'var(--text-md)', outline: 'none' };
const pageMockupStyle: React.CSSProperties = { background: 'white', padding: '50px', borderRadius: 'var(--radius-sm)', boxShadow: 'var(--shadow-md)', flex: 1, display: 'flex', flexDirection: 'column', color: '#333', minHeight: '700px' };
const editorTextStyle: React.CSSProperties = { flex: 1, width: '100%', border: 'none', outline: 'none', fontSize: 'var(--text-md)', lineHeight: '1.7', color: '#333', resize: 'none', background: 'transparent', fontFamily: 'serif', textAlign: 'justify' };
