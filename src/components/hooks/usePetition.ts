import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { API_BASE_URL } from '../../config';
import type { BiddingProcess, CompanyProfile } from '../../types';
import { useToast } from '../ui';

export const PETITION_TYPES = [
    { id: 'impugnacao', label: 'Impugnação ao Edital', law: 'Lei 14.133/2021, Art. 164' },
    { id: 'recurso', label: 'Recurso Administrativo', law: 'Lei 14.133/2021, Art. 165, I' },
    { id: 'contrarrazoes', label: 'Contrarrazões ao Recurso', law: 'Lei 14.133/2021, Art. 165, § 2º' },
    { id: 'esclarecimento', label: 'Pedido de Esclarecimento', law: 'Lei 14.133/2021, Art. 164' },
    { id: 'representacao', label: 'Representação ao TC', law: 'Lei 14.133/2021, Art. 170, IV' },
];

interface UsePetitionParams {
    biddings: BiddingProcess[];
    companies: CompanyProfile[];
    onSave?: () => void;
    initialBiddingId?: string;
}

export function usePetition({ biddings, companies, initialBiddingId }: UsePetitionParams) {
    const toast = useToast();

    // ── State ──
    const [selectedBiddingId, setSelectedBiddingId] = useState(initialBiddingId || '');
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
    const [confirmAction, setConfirmAction] = useState<{ type: string; onConfirm: () => void } | null>(null);
    const [isSavingTemplate, setIsSavingTemplate] = useState(false);
    const [showStyles, setShowStyles] = useState(false);
    const [selectedImg, setSelectedImg] = useState<HTMLImageElement | null>(null);
    const editorRef = useRef<HTMLDivElement>(null);
    const lastAiResult = useRef('');
    const [editorKey, setEditorKey] = useState(0);

    const token = localStorage.getItem('token');
    const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

    // ── Computed ──
    const selectedCompany = useMemo(() => companies.find(c => c.id === selectedCompanyId), [companies, selectedCompanyId]);
    const selectedBidding = useMemo(() => biddings.find(b => b.id === selectedBiddingId), [biddings, selectedBiddingId]);
    const biddingsInRecurso = useMemo(() => biddings.filter(b => b.status === 'Recurso'), [biddings]);

    // ── Effects ──
    // Load company defaults when company changes
    useEffect(() => {
        if (selectedCompany) {
            setHeaderImage(selectedCompany.defaultProposalHeader || '');
            setFooterImage(selectedCompany.defaultProposalFooter || '');
            setHeaderImageHeight(selectedCompany.defaultProposalHeaderHeight || 80);
            setFooterImageHeight(selectedCompany.defaultProposalFooterHeight || 60);
        }
    }, [selectedCompany]);

    // Auto-infer company from selected bidding
    useEffect(() => {
        if (selectedBiddingId && !selectedCompanyId) {
            const bidding = biddings.find(b => b.id === selectedBiddingId);
            if (bidding?.companyProfileId) {
                setSelectedCompanyId(bidding.companyProfileId);
            }
        }
    }, [selectedBiddingId]);

    // Click handler for image selection in editor
    useEffect(() => {
        const el = editorRef.current;
        if (!el) return;
        const handleClick = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (target.tagName === 'IMG') {
                const img = target as HTMLImageElement;
                setSelectedImg(img);
                el.querySelectorAll('img').forEach((i: HTMLImageElement) => i.classList.remove('selected'));
                img.classList.add('selected');
            }
        };
        el.addEventListener('click', handleClick);
        return () => el.removeEventListener('click', handleClick);
    }, []);

    // Safety effect to sync content
    useEffect(() => {
        if (!isGenerating && generatedDraft && editorRef.current) {
            if (editorRef.current.innerHTML.trim() === '' || editorRef.current.innerHTML === '<br>') {
                editorRef.current.innerHTML = generatedDraft;
            }
        }
    }, [isGenerating, generatedDraft]);

    // ── Handlers ──
    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>, setter: (v: string) => void) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => { if (ev.target?.result) setter(ev.target.result as string); };
        reader.readAsDataURL(file);
    };

    const handleSaveCompanyTemplate = async () => {
        if (!selectedCompanyId) { toast.warning('Por favor, selecione uma empresa primeiro.'); return; }
        setIsSavingTemplate(true);
        try {
            const res = await fetch(`${API_BASE_URL}/api/companies/${selectedCompanyId}/proposal-template`, {
                method: 'PUT', headers,
                body: JSON.stringify({ headerImage, footerImage, headerHeight: headerImageHeight, footerHeight: footerImageHeight })
            });
            if (res.ok) toast.success(`Configurações salvas como padrão para ${selectedCompany?.razaoSocial}!`);
            else throw new Error('Falha ao salvar');
        } catch (e) { toast.error('Erro ao salvar template.'); }
        finally { setIsSavingTemplate(false); }
    };

    const handleClear = useCallback(() => {
        setFactsSummary(''); setAttachments([]); setGeneratedDraft('');
        setSelectedBiddingId(''); setSelectedImg(null);
        lastAiResult.current = ''; setEditorKey(prev => prev + 1);
        if (editorRef.current) editorRef.current.innerHTML = '';
        const fileInput = document.getElementById('attach-up') as HTMLInputElement;
        if (fileInput) fileInput.value = '';
        const imgInput = document.getElementById('content-image-up') as HTMLInputElement;
        if (imgInput) imgInput.value = '';
    }, []);

    const handleNew = () => {
        setConfirmAction({ type: 'new', onConfirm: () => { handleClear(); setConfirmAction(null); } });
    };

    const handleAttachmentUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        for (const file of files) {
            const reader = new FileReader();
            reader.onload = (ev) => {
                if (ev.target?.result) {
                    const result = ev.target.result as string;
                    const base64 = result.includes(',') ? result.split(',')[1] : '';
                    setAttachments(prev => [...prev, { name: file.name, content: `[Arquivo anexado: ${file.name}]`, data: base64, mimeType: file.type }]);
                }
            };
            reader.readAsDataURL(file);
        }
    };

    const handleCopy = () => {
        navigator.clipboard.writeText(generatedDraft);
        setIsCopied(true); setTimeout(() => setIsCopied(false), 2000);
    };

    const handleGenerate = async () => {
        if (!selectedBiddingId || !selectedCompanyId || (!factsSummary && attachments.length === 0)) {
            toast.warning('Por favor, selecione o processo, a empresa e descreva os fatos ou anexe documentos.'); return;
        }
        setIsGenerating(true);
        try {
            const response = await fetch(`${API_BASE_URL}/api/petitions/generate`, {
                method: 'POST', headers,
                body: JSON.stringify({
                    biddingProcessId: selectedBiddingId, companyId: selectedCompanyId,
                    templateType: petitionTypeId, userContext: factsSummary,
                    attachments: attachments.map(a => ({ name: a.name, data: a.data, mimeType: a.mimeType }))
                })
            });
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Erro ao gerar petição');

            const displayHtml = data.text
                .replace(/\[INICIO_ASSINATURA\]/g, '<span class="tech-tag" data-tag="start">[INICIO_ASSINATURA]</span>')
                .replace(/\[FIM_ASSINATURA\]/g, '<span class="tech-tag" data-tag="end">[FIM_ASSINATURA]</span>');

            lastAiResult.current = displayHtml;
            setGeneratedDraft(displayHtml);
            setEditorKey(prev => prev + 1);
        } catch (error: any) { console.error(error); toast.error(`Erro: ${error.message}`); }
        finally { setIsGenerating(false); }
    };

    const handleInsertImage = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            if (ev.target?.result && editorRef.current) {
                const imgHtml = `<div style="text-align: center; margin: 20px 0;"><img src="${ev.target.result}" class="petition-img" style="max-width: 100%; height: auto; border: 1px solid #ddd; border-radius: 4px; cursor: pointer;" /></div><br/>`;
                editorRef.current.focus();
                document.execCommand('insertHTML', false, imgHtml);
                const newHtml = editorRef.current.innerHTML;
                lastAiResult.current = newHtml;
                setGeneratedDraft(newHtml);
            }
        };
        reader.readAsDataURL(file);
    };

    const applyImageStyle = (style: React.CSSProperties) => {
        if (!selectedImg) { toast.info('Dica: Primeiro clique na imagem desejada dentro do texto para selecioná-la.'); return; }
        const img = selectedImg;
        if (style.textAlign) {
            let wrapper = img.parentElement;
            if (wrapper && wrapper.tagName === 'DIV' && wrapper.id !== 'petition-editable-content') {
                wrapper.style.textAlign = style.textAlign as string;
            } else {
                const div = document.createElement('div');
                div.style.textAlign = style.textAlign as string;
                div.style.margin = '20px 0';
                img.parentNode?.insertBefore(div, img);
                div.appendChild(img);
            }
        }
        if (style.width) { img.style.width = style.width as string; img.style.height = 'auto'; }
        if (editorRef.current) { const newHtml = editorRef.current.innerHTML; lastAiResult.current = newHtml; setGeneratedDraft(newHtml); }
    };

    const handleDeleteImage = () => {
        if (!selectedImg) return;
        setConfirmAction({
            type: 'deleteImage',
            onConfirm: () => {
                const img = selectedImg;
                const wrapper = img.parentElement;
                if (wrapper && wrapper.tagName === 'DIV' && wrapper.childNodes.length === 1 && wrapper.id !== 'petition-editable-content') { wrapper.remove(); }
                else { img.remove(); }
                setSelectedImg(null);
                if (editorRef.current) { const newHtml = editorRef.current.innerHTML; lastAiResult.current = newHtml; setGeneratedDraft(newHtml); }
                setConfirmAction(null);
            }
        });
    };

    const handleExportPDF = useCallback(() => {
        const editableEl = document.getElementById('petition-editable-content');
        const contentToExport = editableEl ? editableEl.innerHTML : generatedDraft;
        if (!contentToExport) return;

        const printWindow = window.open('', '_blank');
        if (!printWindow) { toast.warning('Por favor, permita pop-ups para gerar o PDF.'); return; }

        const topMargin = headerImage ? (headerImageHeight + 20) : 100;
        const bottomMargin = footerImage ? (footerImageHeight + 30) : 100;

        let cleanText = contentToExport
            .replace(/\*\*\s*(.+?)\s*\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.+?)\*/g, '<em>$1</em>')
            .replace(/^### (.+)$/gm, '<h4>$1</h4>')
            .replace(/^## (.+)$/gm, '<h3>$1</h3>')
            .replace(/^# (.+)$/gm, '<h2>$1</h2>')
            .replace(/\*\*\s*(.+?)\s*\*\*/g, '<strong>$1</strong>')
            .replace(/\*\*/g, '')
            .replace(/<span class="tech-tag"[^>]*>(\[.*?\])<\/span>/g, '$1');

        cleanText = cleanText.replace(/<div style="text-align: center;[^>]*>(<strong>)?OBJETO:/gi, '<div>$1OBJETO:');

        if (cleanText.includes('[INICIO_ASSINATURA]')) {
            const parts = cleanText.split('[INICIO_ASSINATURA]');
            const beforeSig = parts[0];
            const sigContent = parts[1].split('[FIM_ASSINATURA]')[0] || '';
            const afterSig = parts[1].split('[FIM_ASSINATURA]')[1] || '';

            const formattedSignature = `
                <div style="margin-top: 60px; width: 100%; display: block; line-height: 1.25;">
                    ${sigContent.replace(/<br\s*\/?>/gi, '\n')
                    .replace(/<\/p>|<div>/gi, '\n')
                    .replace(/<(?!\/?strong)[^>]*>/g, '')
                    .split('\n')
                    .map(line => {
                        const l = line.trim();
                        if (!l) return '';
                        const isLocalData = l.includes('Local') && l.includes('data');
                        const textAlign = isLocalData ? 'left' : 'center';
                        const style = l.includes('____') ? 'margin-bottom: 2px; margin-top: 25px;' : '';
                        return `<div style="text-align: ${textAlign}; ${style}">${l}</div>`;
                    }).join('')}
                </div>
            `;
            cleanText = beforeSig + formattedSignature + afterSig;
        }

        const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Petição - ${selectedBidding?.title || ''}</title>
            <style>
                body { font-family: 'serif', 'Times New Roman', serif; color: #111; line-height: 1.6; font-size: 13pt; margin: 0; padding: 0; }
                .fixed-header { position: fixed; top: 0; left: 0; right: 0; text-align: center; background: #fff; z-index: 100; }
                .fixed-header img { max-width: 100%; height: auto; display: block; margin: 0 auto; }
                .fixed-footer { position: fixed; bottom: 0; left: 0; right: 0; text-align: center; background: #fff; z-index: 100; }
                .fixed-footer img { max-width: 100%; height: auto; display: block; margin: 0 auto; }
                .content-wrapper { padding: 15px 40px; text-align: justify; }
                .petition-content { white-space: pre-wrap; font-size: 13pt; }
                table.print-wrapper { width: 100%; border: none; border-collapse: collapse; }
                @media print { @page { size: portrait; margin: 1cm 1.5cm; } .fixed-header, .fixed-footer { position: fixed; } button { display: none; } }
            </style></head><body>
            <script>window.onload = function() { setTimeout(() => { window.print(); window.close(); }, 800); };</script>
            <div class="fixed-header">${headerImage ? `<img src="${headerImage}" style="max-height: ${headerImageHeight}px;" />` : `<div style="border-bottom: 2px solid #222; padding: 20px 0; margin: 0 40px;"><h1 style="margin: 0; font-size: 18px;">${selectedCompany?.razaoSocial || ''}</h1><p style="margin: 5px 0; font-weight: bold;">CNPJ: ${selectedCompany?.cnpj || ''}</p></div>`}</div>
            <div class="fixed-footer">${footerImage ? `<img src="${footerImage}" style="max-height: ${footerImageHeight}px;" />` : `<div style="border-top: 1px solid #ddd; padding: 10px 0; font-size: 10px; color: #666; margin: 0 40px;">${selectedCompany?.address || ''} - ${selectedCompany?.city || ''}/${selectedCompany?.state || ''}<br/>${selectedCompany?.contactEmail || ''}</div>`}</div>
            <table class="print-wrapper"><thead><tr><td style="height: ${topMargin}px;"></td></tr></thead><tfoot><tr><td style="height: ${bottomMargin}px;"></td></tr></tfoot>
                <tbody><tr><td><div class="content-wrapper"><div class="petition-content">${cleanText}</div></div></td></tr></tbody></table>
        </body></html>`;
        printWindow.document.write(html);
        printWindow.document.close();
    }, [generatedDraft, headerImage, footerImage, headerImageHeight, footerImageHeight, selectedBidding, selectedCompany, toast]);

    return {
        // State
        selectedBiddingId, setSelectedBiddingId, selectedCompanyId, setSelectedCompanyId,
        petitionTypeId, setPetitionTypeId, factsSummary, setFactsSummary,
        attachments, setAttachments, isGenerating, generatedDraft, setGeneratedDraft,
        isCopied, confirmAction, setConfirmAction,
        headerImage, setHeaderImage, footerImage, setFooterImage,
        headerImageHeight, setHeaderImageHeight, footerImageHeight, setFooterImageHeight,
        isSavingTemplate, showStyles, setShowStyles, selectedImg,
        editorRef, lastAiResult, editorKey,
        // Computed
        selectedCompany, selectedBidding, biddingsInRecurso,
        // Handlers
        handleImageUpload, handleSaveCompanyTemplate, handleClear, handleNew,
        handleAttachmentUpload, handleCopy, handleGenerate, handleInsertImage,
        applyImageStyle, handleDeleteImage, handleExportPDF,
    };
}
