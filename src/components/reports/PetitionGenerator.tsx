import { useState, useMemo, useEffect } from 'react';
import {
    Sparkles, Download, Loader2, Scale, ScrollText, AlertCircle,
    ChevronRight, Copy, Check, Image as ImageIcon, Settings2,
    Trash2, Save
} from 'lucide-react';
import { API_BASE_URL } from '../../config';
import type { BiddingProcess, CompanyProfile } from '../../types';

interface Props {
    biddings: BiddingProcess[];
    companies: CompanyProfile[];
    onSave?: () => void;
}

const PETITION_TYPES = [
    { id: 'impugnacao', label: 'Impugnação ao Edital', law: 'Lei 14.133/2021, Art. 164' },
    { id: 'recurso', label: 'Recurso Administrativo', law: 'Lei 14.133/2021, Art. 165, I' },
    { id: 'contrarrazoes', label: 'Contrarrazões ao Recurso', law: 'Lei 14.133/2021, Art. 165, § 2º' },
    { id: 'esclarecimento', label: 'Pedido de Esclarecimento', law: 'Lei 14.133/2021, Art. 164' },
    { id: 'representacao', label: 'Representação ao TC', law: 'Lei 14.133/2021, Art. 170, IV' },
];

export function PetitionGenerator({ biddings, companies }: Props) {
    const [selectedBiddingId, setSelectedBiddingId] = useState('');
    const [selectedCompanyId, setSelectedCompanyId] = useState('');
    const [petitionTypeId, setPetitionTypeId] = useState('recurso');
    const [factsSummary, setFactsSummary] = useState('');
    const [attachments, setAttachments] = useState<{ name: string; content: string; data?: string; mimeType?: string }[]>([]);
    const [isGenerating, setIsGenerating] = useState(false);
    const [generatedDraft, setGeneratedDraft] = useState('');
    const [isCopied, setIsCopied] = useState(false);

    // Image states
    const [headerImage, setHeaderImage] = useState('');
    const [footerImage, setFooterImage] = useState('');
    const [headerImageHeight, setHeaderImageHeight] = useState(80);
    const [footerImageHeight, setFooterImageHeight] = useState(60);
    const [isSavingTemplate, setIsSavingTemplate] = useState(false);
    const [showStyles, setShowStyles] = useState(false);
    const [selectedImg, setSelectedImg] = useState<HTMLImageElement | null>(null);

    const token = localStorage.getItem('token');
    const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

    const selectedCompany = useMemo(() => companies.find(c => c.id === selectedCompanyId), [companies, selectedCompanyId]);
    const selectedBidding = useMemo(() => biddings.find(b => b.id === selectedBiddingId), [biddings, selectedBiddingId]);

    // Load company defaults when company changes
    useEffect(() => {
        if (selectedCompany) {
            setHeaderImage(selectedCompany.defaultProposalHeader || '');
            setFooterImage(selectedCompany.defaultProposalFooter || '');
            setHeaderImageHeight(selectedCompany.defaultProposalHeaderHeight || 80);
            setFooterImageHeight(selectedCompany.defaultProposalFooterHeight || 60);
        }
    }, [selectedCompany]);

    useEffect(() => {
        const el = document.getElementById('petition-editable-content');
        if (!el) return;

        const handleClick = (e: MouseEvent) => {
            if ((e.target as HTMLElement).tagName === 'IMG') {
                const target = e.target as HTMLImageElement;
                setSelectedImg(target);
                // Manage classes
                el.querySelectorAll('img').forEach(i => i.classList.remove('selected'));
                target.classList.add('selected');
            }
        };

        el.addEventListener('click', handleClick);
        return () => el.removeEventListener('click', handleClick);
    }, [generatedDraft]);

    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>, setter: (v: string) => void) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            if (ev.target?.result) setter(ev.target.result as string);
        };
        reader.readAsDataURL(file);
    };

    const handleSaveCompanyTemplate = async () => {
        if (!selectedCompanyId) {
            alert('Por favor, selecione uma empresa primeiro.');
            return;
        }
        setIsSavingTemplate(true);
        try {
            const res = await fetch(`${API_BASE_URL}/api/companies/${selectedCompanyId}/proposal-template`, {
                method: 'PUT', headers,
                body: JSON.stringify({
                    headerImage,
                    footerImage,
                    headerHeight: headerImageHeight,
                    footerHeight: footerImageHeight,
                })
            });
            if (res.ok) alert(`Configurações salvas como padrão para ${selectedCompany?.razaoSocial}!`);
            else throw new Error('Falha ao salvar');
        } catch (e) {
            alert('Erro ao salvar template.');
        } finally {
            setIsSavingTemplate(false);
        }
    };

    // Filter biddings in "Recurso" status
    const biddingsInRecurso = useMemo(() =>
        biddings.filter(b => b.status === 'Recurso')
        , [biddings]);

    const handleClear = () => {
        setFactsSummary('');
        setAttachments([]);
        setGeneratedDraft('');
        setSelectedBiddingId('');
    };

    const handleNew = () => {
        if (confirm('Deseja iniciar uma nova petição? Todos os dados atuais serão perdidos.')) {
            handleClear();
        }
    };

    const handleAttachmentUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        for (const file of files) {
            const reader = new FileReader();
            reader.onload = (ev) => {
                if (ev.target?.result) {
                    const result = ev.target.result as string;
                    const base64 = result.includes(',') ? result.split(',')[1] : '';

                    setAttachments(prev => [...prev, {
                        name: file.name,
                        content: `[Arquivo anexado: ${file.name}]`,
                        data: base64,
                        mimeType: file.type
                    }]);
                }
            };
            reader.readAsDataURL(file);
        }
    };

    const handleCopy = () => {
        navigator.clipboard.writeText(generatedDraft);
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
    };

    const handleGenerate = async () => {
        if (!selectedBiddingId || !selectedCompanyId || (!factsSummary && attachments.length === 0)) {
            alert('Por favor, selecione o processo, a empresa e descreva os fatos ou anexe documentos.');
            return;
        }

        setIsGenerating(true);
        try {
            const token = localStorage.getItem('token');
            const response = await fetch(`${API_BASE_URL}/api/petitions/generate`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    biddingProcessId: selectedBiddingId,
                    companyId: selectedCompanyId,
                    templateType: petitionTypeId,
                    userContext: factsSummary,
                    attachments: attachments.map(a => ({
                        name: a.name,
                        data: a.data,
                        mimeType: a.mimeType
                    }))
                })
            });

            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Erro ao gerar petição');
            setGeneratedDraft(data.text);
        } catch (error: any) {
            console.error(error);
            alert(`Erro: ${error.message}`);
        } finally {
            setIsGenerating(false);
        }
    };

    const handleInsertImage = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            if (ev.target?.result) {
                const imgHtml = `<div style="text-align: center; margin: 20px 0;"><img src="${ev.target.result}" style="max-width: 100%; height: auto; border: 1px solid #ddd; borderRadius: 4px; cursor: pointer;" /></div><br/>`;
                // Append image to the document
                const el = document.getElementById('petition-editable-content');
                if (el) {
                    el.innerHTML += imgHtml;
                    setGeneratedDraft(el.innerHTML);
                }
            }
        };
        reader.readAsDataURL(file);
    };

    const applyImageStyle = (style: React.CSSProperties) => {
        if (!selectedImg) {
            alert('Dica: Primeiro clique na imagem desejada dentro do texto para selecioná-la.');
            return;
        }

        const img = selectedImg;
        if (style.textAlign) {
            let wrapper = img.parentElement;
            if (wrapper && wrapper.tagName === 'DIV') {
                wrapper.style.textAlign = style.textAlign as string;
            } else {
                const div = document.createElement('div');
                div.style.textAlign = style.textAlign as string;
                div.style.margin = '20px 0';
                img.parentNode?.insertBefore(div, img);
                div.appendChild(img);
            }
        }
        if (style.width) {
            img.style.width = style.width as string;
            img.style.height = 'auto';
        }

        const el = document.getElementById('petition-editable-content');
        if (el) setGeneratedDraft(el.innerHTML);
    };

    const handleDeleteImage = () => {
        if (!selectedImg) return;
        if (confirm('Deseja remover esta imagem?')) {
            const wrapper = selectedImg.parentElement;
            if (wrapper && wrapper.tagName === 'DIV' && wrapper.childNodes.length === 1) {
                wrapper.remove();
            } else {
                selectedImg.remove();
            }
            setSelectedImg(null);
            setGeneratedDraft(document.getElementById('petition-editable-content')?.innerHTML || '');
        }
    };

    const handleExportPDF = () => {
        const editableEl = document.getElementById('petition-editable-content');
        const contentToExport = editableEl ? editableEl.innerHTML : generatedDraft;

        if (!contentToExport) return;

        const printWindow = window.open('', '_blank');
        if (!printWindow) {
            alert('Por favor, permita pop-ups para gerar o PDF.');
            return;
        }

        const topMargin = headerImage ? (headerImageHeight + 20) : 100;
        const bottomMargin = footerImage ? (footerImageHeight + 30) : 100;

        // Process markdown AND clean up remaining stars
        let cleanText = contentToExport
            .replace(/\*\*\s*(.+?)\s*\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.+?)\*/g, '<em>$1</em>')
            .replace(/^### (.+)$/gm, '<h4>$1</h4>')
            .replace(/^## (.+)$/gm, '<h3>$1</h3>')
            .replace(/^# (.+)$/gm, '<h2>$1</h2>')
            // Limpeza de asteriscos que sobraram
            .replace(/\*\*\s*(.+?)\s*\*\*/g, '<strong>$1</strong>')
            .replace(/\*\*/g, '')
            // Centralização da Assinatura (Detecta por CNPJ/CPF ou linha horizontal)
            .split('\n').map(line => {
                const trimmed = line.trim();
                if (trimmed.includes('____') || trimmed.includes('CNPJ:') || trimmed.includes('CPF:') || (trimmed.startsWith('**') && trimmed.endsWith('**') && (line.length > 50 && line.length < 150))) {
                    return `<div style="text-align: center; margin: 0 auto; width: 100%;">${line}</div>`;
                }
                return line;
            }).join('\n');

        const html = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="UTF-8">
                <title>Petição - ${selectedBidding?.title || ''}</title>
                <style>
                    body { font-family: 'serif', 'Times New Roman', serif; color: #111; line-height: 1.6; font-size: 13pt; margin: 0; padding: 0; }
                    .fixed-header { position: fixed; top: 0; left: 0; right: 0; text-align: center; background: #fff; z-index: 100; }
                    .fixed-header img { max-width: 100%; height: auto; display: block; margin: 0 auto; }
                    .fixed-footer { position: fixed; bottom: 0; left: 0; right: 0; text-align: center; background: #fff; z-index: 100; }
                    .fixed-footer img { max-width: 100%; height: auto; display: block; margin: 0 auto; }
                    .content-wrapper { padding: 15px 40px; text-align: justify; }
                    .petition-content { white-space: pre-wrap; font-size: 13pt; }
                    table.print-wrapper { width: 100%; border: none; border-collapse: collapse; }
                    @media print {
                        @page { size: portrait; margin: 1cm 1.5cm; }
                        .fixed-header, .fixed-footer { position: fixed; }
                        button { display: none; }
                    }
                </style>
            </head>
            <body>
                <script>
                    window.onload = function() {
                        setTimeout(() => { window.print(); window.close(); }, 800);
                    };
                </script>
                
                <div class="fixed-header">
                    ${headerImage ? `<img src="${headerImage}" style="max-height: ${headerImageHeight}px;" />` : `
                        <div style="border-bottom: 2px solid #222; padding: 20px 0; margin: 0 40px;">
                            <h1 style="margin: 0; font-size: 18px;">${selectedCompany?.razaoSocial || ''}</h1>
                            <p style="margin: 5px 0; font-weight: bold;">CNPJ: ${selectedCompany?.cnpj || ''}</p>
                        </div>
                    `}
                </div>

                <div class="fixed-footer">
                    ${footerImage ? `<img src="${footerImage}" style="max-height: ${footerImageHeight}px;" />` : `
                        <div style="border-top: 1px solid #ddd; padding: 10px 0; font-size: 10px; color: #666; margin: 0 40px;">
                            ${selectedCompany?.address || ''} - ${selectedCompany?.city || ''}/${selectedCompany?.state || ''}<br/>
                            ${selectedCompany?.contactEmail || ''}
                        </div>
                    `}
                </div>

                <table class="print-wrapper">
                    <thead><tr><td style="height: ${topMargin}px;"></td></tr></thead>
                    <tfoot><tr><td style="height: ${bottomMargin}px;"></td></tr></tfoot>
                    <tbody><tr><td>
                        <div class="content-wrapper">
                            <div class="petition-content">${cleanText}</div>
                        </div>
                    </td></tr></tbody>
                </table>
            </body>
            </html>
        `;
        printWindow.document.write(html);
        printWindow.document.close();
    };



    return (
        <div style={{ display: 'grid', gridTemplateColumns: '400px 1fr', gap: '24px', height: 'calc(100vh - 200px)' }}>
            {/* Left: Configuration */}
            <div className="card" style={{ display: 'flex', flexDirection: 'column', padding: '0', overflowY: 'auto', background: 'var(--color-bg-surface)', borderRadius: '16px', border: '1px solid var(--color-border)' }}>
                <div style={{ padding: '20px', borderBottom: '1px solid var(--color-border)', background: 'linear-gradient(135deg, rgba(37,99,235,0.05), rgba(139,92,246,0.05))' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                        <h3 style={{ margin: 0, fontSize: '1.2rem', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-text-primary)' }}>
                            <Scale size={20} color="var(--color-primary)" />
                            Mestre de Petições
                        </h3>
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <button onClick={handleNew} className="btn btn-sm btn-outline" style={{ padding: '4px 8px', fontSize: '0.7rem' }}>Novo</button>
                            <button onClick={handleClear} className="btn btn-sm btn-outline" style={{ padding: '4px 8px', fontSize: '0.7rem', color: 'var(--color-danger)' }}>Limpar</button>
                        </div>
                    </div>
                    <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-text-tertiary)' }}>
                        Inteligência Jurídica Especializada Lei 14.133.
                    </p>
                </div>

                <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    {/* Estilo do Relatório Toggle */}
                    <button
                        onClick={() => setShowStyles(!showStyles)}
                        style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            width: '100%', padding: '12px', borderRadius: '12px',
                            background: showStyles ? 'rgba(37,99,235,0.08)' : 'var(--color-bg-secondary)',
                            border: `1px solid ${showStyles ? 'var(--color-primary)' : 'var(--color-border)'}`,
                            cursor: 'pointer', transition: 'all 0.2s'
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600, fontSize: '0.85rem', color: showStyles ? 'var(--color-primary)' : 'var(--color-text-secondary)' }}>
                            <Settings2 size={16} /> Estilizar Relatório (Premium)
                        </div>
                        <ChevronRight size={16} style={{ transform: showStyles ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s' }} />
                    </button>

                    {showStyles && (
                        <div style={{ padding: '16px', borderRadius: '12px', background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            <div>
                                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, marginBottom: '8px', color: 'var(--color-text-secondary)' }}>
                                    CABEÇALHO (BANNER PNG/JPG)
                                </label>
                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                    <div style={{
                                        flex: 1, height: '40px', border: '1px dashed var(--color-border)', borderRadius: '8px',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', background: 'white'
                                    }}>
                                        {headerImage ? <img src={headerImage} alt="Header" style={{ height: '100%', width: 'auto' }} /> : <ImageIcon size={20} opacity={0.3} />}
                                    </div>
                                    <input type="file" id="header-up" hidden onChange={(e) => handleImageUpload(e, setHeaderImage)} />
                                    <button onClick={() => document.getElementById('header-up')?.click()} className="btn btn-sm btn-outline"><ImageIcon size={14} /></button>
                                    {headerImage && <button onClick={() => setHeaderImage('')} className="btn btn-sm btn-outline" style={{ color: 'var(--color-danger)' }}><Trash2 size={14} /></button>}
                                </div>
                                <div style={{ marginTop: '8px' }}>
                                    <label style={{ fontSize: '0.7rem' }}>Altura: {headerImageHeight}px</label>
                                    <input type="range" min="30" max="300" value={headerImageHeight} onChange={(e) => setHeaderImageHeight(Number(e.target.value))} style={{ width: '100%', accentColor: 'var(--color-primary)' }} />
                                </div>
                            </div>

                            <div style={{ borderTop: '1px solid var(--color-border)', paddingTop: '12px' }}>
                                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 700, marginBottom: '8px', color: 'var(--color-text-secondary)' }}>
                                    RODAPÉ (BANNER PNG/JPG)
                                </label>
                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                    <div style={{
                                        flex: 1, height: '40px', border: '1px dashed var(--color-border)', borderRadius: '8px',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', background: 'white'
                                    }}>
                                        {footerImage ? <img src={footerImage} alt="Footer" style={{ height: '100%', width: 'auto' }} /> : <ImageIcon size={20} opacity={0.3} />}
                                    </div>
                                    <input type="file" id="footer-up" hidden onChange={(e) => handleImageUpload(e, setFooterImage)} />
                                    <button onClick={() => document.getElementById('footer-up')?.click()} className="btn btn-sm btn-outline"><ImageIcon size={14} /></button>
                                    {footerImage && <button onClick={() => setFooterImage('')} className="btn btn-sm btn-outline" style={{ color: 'var(--color-danger)' }}><Trash2 size={14} /></button>}
                                </div>
                                <div style={{ marginTop: '8px' }}>
                                    <label style={{ fontSize: '0.7rem' }}>Altura: {footerImageHeight}px</label>
                                    <input type="range" min="30" max="200" value={footerImageHeight} onChange={(e) => setFooterImageHeight(Number(e.target.value))} style={{ width: '100%', accentColor: 'var(--color-primary)' }} />
                                </div>
                            </div>

                            <button
                                onClick={handleSaveCompanyTemplate}
                                disabled={isSavingTemplate || !selectedCompanyId}
                                style={{ width: '100%', marginTop: '8px', fontSize: '0.72rem', padding: '8px', borderRadius: '8px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                                title={selectedCompany ? `Salvar como padrão para ${selectedCompany.razaoSocial}` : 'Selecione uma empresa'}
                                className="btn btn-outline"
                            >
                                {isSavingTemplate ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
                                {selectedCompany ? ` Salvar Padrão p/ ${selectedCompany.razaoSocial.split(' ')[0]}` : ' Salvar como Padrão'}
                            </button>
                        </div>
                    )}

                    <div className="form-group">
                        <label className="form-label" style={{ fontSize: '0.8rem', fontWeight: 600 }}>Processo (na coluna Recurso)</label>
                        <select
                            className="form-control"
                            value={selectedBiddingId}
                            onChange={(e) => setSelectedBiddingId(e.target.value)}
                            style={{ borderRadius: '12px', padding: '12px' }}
                        >
                            <option value="">-- Selecione um processo --</option>
                            {biddingsInRecurso.map(b => (
                                <option key={b.id} value={b.id}>{b.title} ({b.portal})</option>
                            ))}
                        </select>
                        {biddingsInRecurso.length === 0 && (
                            <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: 'var(--color-danger)' }}>
                                <AlertCircle size={12} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
                                Nenhum processo na coluna "Recurso".
                            </p>
                        )}
                    </div>

                    <div className="form-group">
                        <label className="form-label" style={{ fontSize: '0.8rem', fontWeight: 600 }}>Empresa Litigante</label>
                        <select
                            className="form-control"
                            value={selectedCompanyId}
                            onChange={(e) => setSelectedCompanyId(e.target.value)}
                            style={{ borderRadius: '12px', padding: '12px' }}
                        >
                            <option value="">-- Selecione a empresa --</option>
                            {companies.map(c => (
                                <option key={c.id} value={c.id}>{c.razaoSocial}</option>
                            ))}
                        </select>
                    </div>

                    <div className="form-group">
                        <label className="form-label" style={{ fontSize: '0.8rem', fontWeight: 600 }}>Tipo de Peça</label>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8px' }}>
                            {PETITION_TYPES.map(type => (
                                <div
                                    key={type.id}
                                    onClick={() => setPetitionTypeId(type.id)}
                                    style={{
                                        padding: '12px',
                                        borderRadius: '12px',
                                        border: `1.5px solid ${petitionTypeId === type.id ? 'var(--color-primary)' : 'var(--color-border)'}`,
                                        background: petitionTypeId === type.id ? 'rgba(37, 99, 235, 0.05)' : 'white',
                                        cursor: 'pointer',
                                        transition: 'all 0.2s ease',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        boxShadow: petitionTypeId === type.id ? '0 4px 12px rgba(37,99,235,0.1)' : 'none'
                                    }}
                                >
                                    <div>
                                        <div style={{ fontSize: '0.85rem', fontWeight: 700, color: petitionTypeId === type.id ? 'var(--color-primary)' : 'var(--color-text-primary)' }}>
                                            {type.label}
                                        </div>
                                        <div style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)', marginTop: '2px' }}>{type.law}</div>
                                    </div>
                                    {petitionTypeId === type.id && <div style={{ width: '20px', height: '20px', borderRadius: '50%', background: 'var(--color-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                        <Check size={12} color="white" />
                                    </div>}
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="form-group" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <label className="form-label" style={{ fontSize: '0.8rem', fontWeight: 600, marginBottom: '0' }}>Fatos e Argumentos (IA usará como base)</label>
                        <textarea
                            className="form-control"
                            style={{
                                minHeight: '120px',
                                fontSize: '0.875rem',
                                borderRadius: '12px',
                                padding: '16px',
                                border: '1.5px solid var(--color-border)',
                                lineHeight: '1.5',
                                boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.02)',
                                resize: 'vertical'
                            }}
                            placeholder="Descreva aqui os motivos do recurso, irregularidades encontradas ou fatos relevantes..."
                            value={factsSummary}
                            onChange={(e) => setFactsSummary(e.target.value)}
                        />
                    </div>

                    <div className="form-group">
                        <label className="form-label" style={{ fontSize: '0.8rem', fontWeight: 600 }}>Anexos de Corroboração (Atas, Provas...)</label>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }}>
                            {attachments.map((att, idx) => (
                                <span key={idx} style={{
                                    padding: '4px 10px', background: 'rgba(37,99,235,0.1)',
                                    color: 'var(--color-primary)', borderRadius: '20px', fontSize: '0.75rem',
                                    display: 'flex', alignItems: 'center', gap: '4px', border: '1px solid rgba(37,99,235,0.2)'
                                }}>
                                    <ScrollText size={12} /> {att.name}
                                    <Trash2 size={12} style={{ cursor: 'pointer' }} onClick={() => setAttachments(prev => prev.filter((_, i) => i !== idx))} />
                                </span>
                            ))}
                        </div>
                        <input type="file" id="attach-up" hidden multiple onChange={handleAttachmentUpload} />
                        <button onClick={() => document.getElementById('attach-up')?.click()} className="btn btn-sm btn-outline" style={{ width: '100%', borderRadius: '10px' }}>
                            <ImageIcon size={14} style={{ marginRight: '6px' }} /> Anexar Documentos de Base
                        </button>
                    </div>

                    <button
                        className="btn btn-primary"
                        style={{ width: '100%', height: '52px', gap: '10px', fontSize: '1rem', borderRadius: '14px', fontWeight: 700, boxShadow: '0 4px 14px rgba(37,99,235,0.25)' }}
                        disabled={isGenerating || !selectedBiddingId || !selectedCompanyId || (!factsSummary && attachments.length === 0)}
                        onClick={handleGenerate}
                    >
                        {isGenerating ? <Loader2 size={20} className="spin" /> : <Sparkles size={20} />}
                        {isGenerating ? 'IA Redigindo Peça...' : 'Gerar Peça com IA'}
                    </button>
                </div>
            </div>

            {/* Right: Draft Preview */}
            <div className="card" style={{ display: 'flex', flexDirection: 'column', padding: '0', overflow: 'hidden', background: 'var(--color-bg-base)', borderRadius: '16px', border: '1px solid var(--color-border)' }}>
                <div style={{
                    padding: '16px 24px',
                    borderBottom: '1px solid var(--color-border)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: 'white'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'rgba(37,99,235,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <ScrollText size={20} color="var(--color-primary)" />
                        </div>
                        <div>
                            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>Minuta Jurídica</h3>
                            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>Clique abaixo para editar o texto</span>
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
                        {generatedDraft && (
                            <div style={{ display: 'flex', gap: '4px', padding: '4px', background: 'var(--color-bg-secondary)', border: '1px solid var(--color-border)', borderRadius: '10px', marginRight: '10px' }}>
                                <div style={{ fontSize: '0.65rem', fontWeight: 800, padding: '0 8px', color: 'var(--color-text-tertiary)', textTransform: 'uppercase' }}>Imagem</div>
                                <button title="Alinhar Esquerda" onClick={() => applyImageStyle({ textAlign: 'left' })} className="btn btn-sm btn-ghost" style={{ padding: '6px' }}>
                                    <div style={{ width: '12px', height: '2px', background: 'currentColor', marginBottom: '2px', marginRight: '4px' }}></div>
                                    <div style={{ width: '8px', height: '2px', background: 'currentColor', marginBottom: '2px', marginRight: '8px' }}></div>
                                    <div style={{ width: '12px', height: '2px', background: 'currentColor', marginRight: '4px' }}></div>
                                </button>
                                <button title="Centralizar" onClick={() => applyImageStyle({ textAlign: 'center' })} className="btn btn-sm btn-ghost" style={{ padding: '6px' }}>
                                    <div style={{ width: '12px', height: '2px', background: 'currentColor', marginBottom: '2px' }}></div>
                                    <div style={{ width: '8px', height: '2px', background: 'currentColor', marginBottom: '2px' }}></div>
                                    <div style={{ width: '12px', height: '2px', background: 'currentColor' }}></div>
                                </button>
                                <button title="Alinhar Direita" onClick={() => applyImageStyle({ textAlign: 'right' })} className="btn btn-sm btn-ghost" style={{ padding: '6px' }}>
                                    <div style={{ width: '12px', height: '2px', background: 'currentColor', marginBottom: '2px', marginLeft: '4px' }}></div>
                                    <div style={{ width: '8px', height: '2px', background: 'currentColor', marginBottom: '2px', marginLeft: '8px' }}></div>
                                    <div style={{ width: '12px', height: '2px', background: 'currentColor', marginLeft: '4px' }}></div>
                                </button>
                                <div style={{ width: '1px', background: 'var(--color-border)', margin: '0 4px' }} />
                                <button title="Reduzir" onClick={() => applyImageStyle({ width: '30%' })} className="btn btn-sm btn-ghost" style={{ fontWeight: 800, minWidth: '32px' }}>P</button>
                                <button title="Média" onClick={() => applyImageStyle({ width: '60%' })} className="btn btn-sm btn-ghost" style={{ fontWeight: 800, minWidth: '32px' }}>M</button>
                                <button title="Largura Total" onClick={() => applyImageStyle({ width: '100%' })} className="btn btn-sm btn-ghost" style={{ fontWeight: 800, minWidth: '32px' }}>G</button>
                                <div style={{ width: '1px', background: 'var(--color-border)', margin: '0 4px' }} />
                                <button title="Excluir Imagem" onClick={handleDeleteImage} className="btn btn-sm btn-ghost" style={{ color: 'var(--color-danger)', padding: '6px' }}>
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        )}
                        <input type="file" id="content-image-up" hidden accept="image/*" onChange={handleInsertImage} />
                        <button
                            className="btn btn-outline"
                            style={{ padding: '8px 16px', fontSize: '0.875rem', borderRadius: '10px', gap: '6px' }}
                            disabled={!generatedDraft}
                            onClick={() => document.getElementById('content-image-up')?.click()}
                        >
                            <ImageIcon size={16} /> Inserir Imagem
                        </button>
                        <button
                            className="btn btn-outline"
                            style={{ padding: '8px 16px', fontSize: '0.875rem', borderRadius: '10px' }}
                            disabled={!generatedDraft}
                            onClick={handleCopy}
                        >
                            {isCopied ? <Check size={16} /> : <Copy size={16} />}
                            {isCopied ? 'Copiado!' : 'Copiar'}
                        </button>
                        <button
                            className="btn btn-primary"
                            style={{ padding: '8px 20px', fontSize: '0.875rem', background: '#111', borderColor: '#111', borderRadius: '10px', fontWeight: 600 }}
                            disabled={!generatedDraft}
                            onClick={handleExportPDF}
                        >
                            <Download size={18} /> Exportar Relatório Premium
                        </button>
                    </div>
                </div>

                <div style={{ flex: 1, padding: '40px', overflowY: 'auto', background: '#f8f9fa', display: 'flex', justifyContent: 'center' }}>
                    {!generatedDraft && !isGenerating ? (
                        <div style={{
                            height: '100%',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'var(--color-text-tertiary)',
                            textAlign: 'center'
                        }}>
                            <div style={{ width: '120px', height: '120px', borderRadius: '50%', background: 'rgba(0,0,0,0.03)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '24px' }}>
                                <ScrollText size={48} style={{ opacity: 0.2 }} />
                            </div>
                            <h4 style={{ margin: '0 0 8px 0', color: 'var(--color-text-secondary)' }}>Peça pronta em instantes</h4>
                            <p style={{ maxWidth: '300px', fontSize: '0.9rem' }}>
                                Selecione um processo ao lado e deixe nossa IA especialista elaborar sua petição.
                            </p>
                        </div>
                    ) : isGenerating ? (
                        <div style={{ width: '100%', maxWidth: '800px', background: 'white', padding: '60px', borderRadius: '4px', boxShadow: '0 4px 20px rgba(0,0,0,0.05)', height: 'fit-content' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                                <div className="skeleton" style={{ height: '32px', width: '60%' }}></div>
                                <div className="skeleton" style={{ height: '18px', width: '100%' }}></div>
                                <div className="skeleton" style={{ height: '18px', width: '90%' }}></div>
                                <div className="skeleton" style={{ height: '300px', width: '100%' }}></div>
                                <div className="skeleton" style={{ height: '18px', width: '40%' }}></div>
                            </div>
                        </div>
                    ) : (
                        <div id="petition-preview" style={{
                            width: '100%',
                            maxWidth: '800px',
                            background: 'white',
                            padding: '60px',
                            borderRadius: '4px',
                            boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
                            height: 'fit-content',
                            minHeight: '100%',
                            position: 'relative'
                        }}>
                            {/* Visual Preview of Header/Footer */}
                            {headerImage && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: `${headerImageHeight}px`, overflow: 'hidden' }}>
                                <img src={headerImage} alt="Header Preview" style={{ width: '100%', height: 'auto' }} />
                                <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '1px', background: 'rgba(0,0,0,0.05)' }}></div>
                            </div>}

                            <div
                                id="petition-editable-content"
                                contentEditable
                                suppressContentEditableWarning
                                onInput={(e) => setGeneratedDraft(e.currentTarget.innerHTML)}
                                style={{
                                    marginTop: headerImage ? `${headerImageHeight + 20}px` : '0',
                                    marginBottom: footerImage ? `${footerImageHeight + 20}px` : '0',
                                    whiteSpace: 'pre-wrap',
                                    fontFamily: 'serif',
                                    fontSize: '1.2rem',
                                    lineHeight: '1.6',
                                    color: '#1a1a1a',
                                    textAlign: 'justify',
                                    minHeight: '400px',
                                    outline: 'none',
                                    padding: '10px'
                                }}
                                dangerouslySetInnerHTML={{ __html: generatedDraft }}
                            />
                            <style>{`
                                #petition-editable-content img { transition: all 0.2s; border: 2px solid transparent; border-radius: 4px; }
                                #petition-editable-content img:hover { border-color: var(--color-primary-light); }
                                #petition-editable-content img.selected { border-color: var(--color-primary); box-shadow: 0 0 10px rgba(37,99,235,0.25); }
                            `}</style>

                            {footerImage && <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: `${footerImageHeight}px`, overflow: 'hidden' }}>
                                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '1px', background: 'rgba(0,0,0,0.05)' }}></div>
                                <img src={footerImage} alt="Footer Preview" style={{ width: '100%', height: 'auto' }} />
                            </div>}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
