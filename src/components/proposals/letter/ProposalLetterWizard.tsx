/**
 * ══════════════════════════════════════════════════════════════
 * ProposalLetterWizard — Nova UI orientada a blocos
 * Wizard em 5 etapas: Config → Validação → Geração → Revisão → Exportação
 * ══════════════════════════════════════════════════════════════
 */

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import {
    Settings, CheckCircle2, Cpu, Edit3, Printer,
    AlertTriangle, XCircle, Info, ChevronRight, ChevronLeft,
    Loader2, Save, RefreshCw, Lock, Unlock, Sparkles,
    FileText, Table2, FileStack, ListOrdered, BarChart3,
    Zap, ChevronDown,
    Mail, ClipboardList, Building2, FileEdit, Scale,
    DollarSign, CalendarDays, Wrench, Landmark, MailCheck, PenTool, File,
    ListChecks,
} from 'lucide-react';
import type { BiddingProcess, CompanyProfile, PriceProposal, ProposalItem } from '../../../types';
import type { ProposalLetterResult, LetterBlock, ValidationResult, LetterExportMode } from './types';
import { LetterBlockType } from './types';
import { LetterDataNormalizer } from './LetterDataNormalizer';
import { ProposalLetterBuilder } from './ProposalLetterBuilder';
import { ProposalLetterValidator } from './ProposalLetterValidator';
import { LetterPdfExporter } from './LetterPdfExporter';
import type { AiLetterBlocksResponse } from './types';
import { API_BASE_URL } from '../../../config';

// ── Types ──
type WizardStep = 'config' | 'validation' | 'generation' | 'review' | 'export';

interface ProposalLetterWizardProps {
    // Data
    bidding: BiddingProcess;
    company: CompanyProfile;
    proposal: PriceProposal;
    items: ProposalItem[];
    totalValue: number;
    // Config state
    validityDays: number;
    signatureMode: 'LEGAL' | 'TECH' | 'BOTH';
    bdi: number;
    discount: number;
    headerImage: string;
    footerImage: string;
    headerImageHeight: number;
    footerImageHeight: number;
    // Callbacks
    setValidityDays: (v: number) => void;
    setSignatureMode: (v: 'LEGAL' | 'TECH' | 'BOTH') => void;
    setHeaderImage: (v: string) => void;
    setFooterImage: (v: string) => void;
    setHeaderImageHeight: (v: number) => void;
    setFooterImageHeight: (v: number) => void;
    handleImageUpload: (e: React.ChangeEvent<HTMLInputElement>, setter: (v: string) => void) => void;
    handleSaveConfig: () => void;
    handleSaveCompanyTemplate: () => void;
    isSavingTemplate: boolean;
    // Letter I/O
    letterContent: string;
    setLetterContent: (v: string) => void;
    handleSaveLetter: (contentOverride?: string) => void;
    handlePrintProposal: (type: 'FULL' | 'LETTER' | 'SPREADSHEET') => void;
    isSaving: boolean;
    printLandscape?: boolean;
    setPrintLandscape?: (v: boolean) => void;
    // Assinatura e Dados Bancários (gerenciados pelo hook, persistem entre abas)
    sigLegal: { name: string; cpf: string; role: string };
    setSigLegal: (v: { name: string; cpf: string; role: string }) => void;
    sigTech: { name: string; registration: string; role: string };
    setSigTech: (v: { name: string; registration: string; role: string }) => void;
    sigCompany: { razaoSocial: string; cnpj: string };
    setSigCompany: (v: { razaoSocial: string; cnpj: string }) => void;
    bankData: { bank: string; agency: string; account: string; accountType: string; pix: string };
    setBankData: (v: { bank: string; agency: string; account: string; accountType: string; pix: string }) => void;
    // Adjusted scenario data
    adjustedEnabled?: boolean;
    adjustedBdi?: number;
    adjustedDiscount?: number;
    adjustedTotal?: number;
}

const STEPS: { id: WizardStep; label: string; icon: React.ReactNode }[] = [
    { id: 'config',     label: 'Configuração',  icon: <Settings size={16} /> },
    { id: 'validation', label: 'Validação',      icon: <CheckCircle2 size={16} /> },
    { id: 'generation', label: 'Geração',        icon: <Cpu size={16} /> },
    { id: 'review',     label: 'Revisão',        icon: <Edit3 size={16} /> },
    { id: 'export',     label: 'Exportação',     icon: <Printer size={16} /> },
];

const BLOCK_LABELS: Record<string, { icon: React.ReactNode; color: string }> = {
    [LetterBlockType.TITLE]:                { icon: <FileText size={14} />,     color: '#1E40AF' },
    [LetterBlockType.RECIPIENT]:            { icon: <Mail size={14} />,          color: '#3B82F6' },
    [LetterBlockType.REFERENCE]:            { icon: <ClipboardList size={14} />, color: '#6366F1' },
    [LetterBlockType.QUALIFICATION]:        { icon: <Building2 size={14} />,     color: '#8B5CF6' },
    [LetterBlockType.OBJECT]:               { icon: <FileEdit size={14} />,      color: '#EC4899' },
    [LetterBlockType.COMMERCIAL]:           { icon: <Scale size={14} />,         color: '#F59E0B' },
    [LetterBlockType.PRICING_SUMMARY]:      { icon: <DollarSign size={14} />,    color: '#10B981' },
    [LetterBlockType.VALIDITY]:             { icon: <CalendarDays size={14} />,  color: '#06B6D4' },
    [LetterBlockType.PROPOSAL_CONDITIONS]:  { icon: <ListChecks size={14} />,    color: '#0EA5E9' },
    [LetterBlockType.EXECUTION]:            { icon: <Wrench size={14} />,        color: '#F97316' },
    [LetterBlockType.BANKING]:              { icon: <Landmark size={14} />,      color: '#14B8A6' },
    [LetterBlockType.CLOSING]:              { icon: <MailCheck size={14} />,     color: '#64748B' },
    [LetterBlockType.SIGNATURE]:            { icon: <PenTool size={14} />,       color: '#334155' },
};

// Agrupamento visual para revisão
const BLOCK_GROUPS = [
    { label: 'Título', ids: [LetterBlockType.TITLE] },
    { label: 'Identificação e Endereçamento', ids: [LetterBlockType.RECIPIENT, LetterBlockType.REFERENCE, LetterBlockType.QUALIFICATION] },
    { label: 'Corpo Principal da Proposta', ids: [LetterBlockType.OBJECT, LetterBlockType.COMMERCIAL, LetterBlockType.PRICING_SUMMARY, LetterBlockType.VALIDITY, LetterBlockType.PROPOSAL_CONDITIONS] },
    { label: 'Informações Complementares', ids: [LetterBlockType.EXECUTION, LetterBlockType.BANKING] },
    { label: 'Fechamento e Assinatura', ids: [LetterBlockType.CLOSING, LetterBlockType.SIGNATURE] },
];

// Blocos que merecem atenção especial na revisão
const ATTENTION_BLOCKS = new Set<string>([LetterBlockType.OBJECT, LetterBlockType.PRICING_SUMMARY, LetterBlockType.QUALIFICATION]);

export function ProposalLetterWizard(props: ProposalLetterWizardProps) {
    const [step, setStep] = useState<WizardStep>('config');
    const [validation, setValidation] = useState<ValidationResult | null>(null);
    const [letterResult, setLetterResult] = useState<ProposalLetterResult | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [generationProgress, setGenerationProgress] = useState<string[]>([]);
    const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
    const [editBuffer, setEditBuffer] = useState('');
    const [selectedExportMode, setSelectedExportMode] = useState<LetterExportMode>('FULL');
    const [collapsedBlocks, setCollapsedBlocks] = useState<Set<string>>(new Set());

    // ── Tipo de Proposta (Inicial ou Readequada) ──
    const [proposalType, setProposalType] = useState<'INICIAL' | 'READEQUADA'>('INICIAL');

    // ── Cache local de cartas salvas por tipo ──
    const [savedLetterInicial, setSavedLetterInicial] = useState<ProposalLetterResult | null>(null);
    const [savedLetterReadequada, setSavedLetterReadequada] = useState<ProposalLetterResult | null>(null);

    // Atalhos para dados de assinatura/banco (vêm do hook via props, persistem entre abas)
    const { sigLegal, setSigLegal, sigTech, setSigTech, sigCompany, setSigCompany, bankData, setBankData } = props;

    const stepIndex = STEPS.findIndex(s => s.id === step);

    // ── Normalizer ──
    const normalizedData = useMemo(() => {
        const normalizer = new LetterDataNormalizer();
        const isReadequada = proposalType === 'READEQUADA' && props.adjustedEnabled;
        const effectiveTotal = isReadequada ? (props.adjustedTotal || props.totalValue) : props.totalValue;
        const effectiveBdi = isReadequada ? (props.adjustedBdi ?? props.bdi) : props.bdi;
        const effectiveDiscount = isReadequada ? (props.adjustedDiscount ?? props.discount) : props.discount;

        const data = normalizer.normalize({
            bidding: props.bidding,
            company: props.company,
            proposal: props.proposal,
            items: props.items,
            totalValue: effectiveTotal,
            signatureMode: props.signatureMode,
            validityDays: props.validityDays,
            bdiPercentage: effectiveBdi,
            discountPercentage: effectiveDiscount,
            bankingData: (bankData.bank || bankData.agency || bankData.account || bankData.pix)
                ? bankData : undefined,
        });
        // Inject proposalType into meta for the Builder's TITLE block
        (data.meta as any).proposalType = proposalType;
        // Inject editable signature data
        data.signature.legalRepresentative = {
            name: sigLegal.name,
            cpf: sigLegal.cpf,
            role: sigLegal.role,
        };
        if (sigTech.name) {
            data.signature.technicalRepresentative = {
                name: sigTech.name,
                registration: sigTech.registration,
                role: sigTech.role,
            };
        }
        // Override company signature data
        data.company.razaoSocial = sigCompany.razaoSocial;
        data.company.cnpj = sigCompany.cnpj;
        data.company.contactName = sigLegal.name;
        data.company.contactCpf = sigLegal.cpf;
        return data;
    }, [props.bidding, props.company, props.proposal, props.items, props.totalValue,
        props.signatureMode, props.validityDays, props.bdi, props.discount, bankData,
        proposalType, sigLegal, sigTech, sigCompany, props.adjustedEnabled, props.adjustedBdi, props.adjustedDiscount, props.adjustedTotal]);

    // ── Validate ──
    const handleValidate = useCallback(() => {
        const validator = new ProposalLetterValidator();
        const result = validator.validate(normalizedData);
        setValidation(result);
        setStep('validation');
    }, [normalizedData]);

    // ── Generate ──
    const handleGenerate = useCallback(async () => {
        setIsGenerating(true);
        setGenerationProgress(['Iniciando composição...']);
        setStep('generation');

        try {
            // Step 1: Fetch AI blocks
            setGenerationProgress(prev => [...prev, '[IA] Solicitando redação IA para blocos variáveis...']);
            const token = localStorage.getItem('token');
            const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

            let aiBlocks: Record<string, string> = {};
            try {
                const aiRes = await fetch(`${API_BASE_URL}/api/proposals/ai-letter-blocks`, {
                    method: 'POST', headers,
                    body: JSON.stringify({
                        biddingProcessId: props.bidding.id,
                        requestedBlocks: ['objectBlock', 'executionBlock', 'commercialExtras'],
                    }),
                });
                if (aiRes.ok) {
                    const aiData: AiLetterBlocksResponse & { timings?: Record<string, number>; totalMs?: number } = await aiRes.json();
                    aiBlocks = aiData.blocks || {};
                    const timings = aiData.timings || {};
                    Object.entries(timings).forEach(([k, ms]) => {
                        setGenerationProgress(prev => [...prev, `[OK] ${k} redigido (${(ms / 1000).toFixed(1)}s)`]);
                    });
                } else {
                    setGenerationProgress(prev => [...prev, '[!] IA indisponível — usando dados estruturais']);
                }
            } catch {
                setGenerationProgress(prev => [...prev, '[!] Erro na IA — carta gerada sem trechos variáveis']);
            }

            // Step 2: Build letter
            setGenerationProgress(prev => [...prev, '[...] Compondo blocos estruturais...']);
            const builder = new ProposalLetterBuilder(normalizedData);
            if (aiBlocks.objectBlock) builder.setAiContent(LetterBlockType.OBJECT, aiBlocks.objectBlock);
            if (aiBlocks.executionBlock) builder.setAiContent(LetterBlockType.EXECUTION, aiBlocks.executionBlock);
            if (aiBlocks.commercialExtras) builder.setAiContent('commercialExtras', aiBlocks.commercialExtras);

            const result = builder.build();
            setLetterResult(result);

            // Auto-save no cache do tipo atual
            if (proposalType === 'READEQUADA') {
                setSavedLetterReadequada(result);
            } else {
                setSavedLetterInicial(result);
            }

            // Sync with textarea (backward compat)
            props.setLetterContent(result.plainText);

            const visibleCount = result.blocks.filter(b => b.visible).length;
            const aiCount = result.meta.aiBlockIds.length;
            setGenerationProgress(prev => [
                ...prev,
                `[OK] Carta composta: ${visibleCount} blocos (${aiCount} com IA)`,
                '[OK] Pronto para revisão!'
            ]);

            // Auto-advance after 1.5s
            setTimeout(() => setStep('review'), 1500);
        } catch (e: any) {
            setGenerationProgress(prev => [...prev, `[x] Erro: ${e.message || 'Desconhecido'}`]);
        } finally {
            setIsGenerating(false);
        }
    }, [normalizedData, props]);

    // ── Block editing ──
    const handleStartEdit = (block: LetterBlock) => {
        setEditingBlockId(block.id);
        setEditBuffer(block.content);
    };

    const handleSaveEdit = () => {
        if (!letterResult || !editingBlockId) return;
        const updatedBlocks = letterResult.blocks.map(b =>
            b.id === editingBlockId ? { ...b, content: editBuffer, aiGenerated: false } : b
        );
        const plainText = updatedBlocks.filter(b => b.visible).map(b => b.content).join('\n\n');
        setLetterResult({ ...letterResult, blocks: updatedBlocks, plainText });
        props.setLetterContent(plainText);
        setEditingBlockId(null);
    };

    const handleCancelEdit = () => {
        setEditingBlockId(null);
        setEditBuffer('');
    };

    // ── Troca de tipo com restauração ──
    const handleSwitchProposalType = useCallback((newType: 'INICIAL' | 'READEQUADA') => {
        if (newType === proposalType) return;

        // Salvar a versão atual no cache antes de trocar
        if (letterResult) {
            if (proposalType === 'INICIAL') {
                setSavedLetterInicial(letterResult);
            } else {
                setSavedLetterReadequada(letterResult);
            }
        }

        // Trocar tipo
        setProposalType(newType);

        // Verificar se a versão destino tem cache salvo
        const cachedVersion = newType === 'INICIAL' ? savedLetterInicial : savedLetterReadequada;
        if (cachedVersion) {
            setLetterResult(cachedVersion);
            setStep('review');
        } else {
            setLetterResult(null);
            setStep('config');
        }
    }, [proposalType, letterResult, savedLetterInicial, savedLetterReadequada]);

    // ── Restaurar blocos salvos ao montar (suporta v2 e v3) ──
    const hasRestoredRef = useRef(false);
    useEffect(() => {
        if (hasRestoredRef.current || !props.letterContent) return;
        try {
            const parsed = JSON.parse(props.letterContent);

            // v3: envelope com ambas versões
            if (parsed && parsed.v === 3) {
                const restoreVersion = (versionData: any, nd: any): ProposalLetterResult | null => {
                    if (!versionData || !Array.isArray(versionData.blocks) || versionData.blocks.length === 0) return null;
                    const builder = new ProposalLetterBuilder(nd);
                    const freshResult = builder.build();
                    const freshPricingBlock = freshResult.blocks.find((b: LetterBlock) => b.id === LetterBlockType.PRICING_SUMMARY);
                    const restoredBlocks = versionData.blocks.map((b: LetterBlock) => {
                        if (b.id === LetterBlockType.PRICING_SUMMARY && freshPricingBlock) return { ...b, content: freshPricingBlock.content };
                        return b;
                    });
                    return {
                        blocks: restoredBlocks,
                        plainText: restoredBlocks.filter((b: any) => b.visible).map((b: any) => b.content).join('\n\n'),
                        htmlContent: '',
                        validation: { isValid: true, errors: [], warnings: [] },
                        meta: { generatedAt: new Date().toISOString(), builderVersion: 'restored', aiBlockIds: [], dataHash: '' },
                    };
                };

                // Restaurar versão inicial
                if (parsed.inicial) {
                    const normalizer = new LetterDataNormalizer();
                    const dataI = normalizer.normalize({
                        bidding: props.bidding, company: props.company, proposal: props.proposal,
                        items: props.items, totalValue: props.totalValue,
                        signatureMode: props.signatureMode, validityDays: props.validityDays,
                        bdiPercentage: props.bdi, discountPercentage: props.discount,
                    });
                    (dataI.meta as any).proposalType = 'INICIAL';
                    const restoredI = restoreVersion(parsed.inicial, dataI);
                    if (restoredI) setSavedLetterInicial(restoredI);
                }

                // Restaurar versão readequada
                if (parsed.readequada && props.adjustedEnabled) {
                    const normalizer = new LetterDataNormalizer();
                    const dataR = normalizer.normalize({
                        bidding: props.bidding, company: props.company, proposal: props.proposal,
                        items: props.items, totalValue: props.adjustedTotal || props.totalValue,
                        signatureMode: props.signatureMode, validityDays: props.validityDays,
                        bdiPercentage: props.adjustedBdi ?? props.bdi, discountPercentage: props.adjustedDiscount ?? props.discount,
                    });
                    (dataR.meta as any).proposalType = 'READEQUADA';
                    const restoredR = restoreVersion(parsed.readequada, dataR);
                    if (restoredR) setSavedLetterReadequada(restoredR);
                }

                // Carregar a versão inicial como ativa
                if (parsed.inicial) {
                    const normalizer = new LetterDataNormalizer();
                    const dataI = normalizer.normalize({
                        bidding: props.bidding, company: props.company, proposal: props.proposal,
                        items: props.items, totalValue: props.totalValue,
                        signatureMode: props.signatureMode, validityDays: props.validityDays,
                        bdiPercentage: props.bdi, discountPercentage: props.discount,
                    });
                    (dataI.meta as any).proposalType = 'INICIAL';
                    const restoredI = restoreVersion(parsed.inicial, dataI);
                    if (restoredI) {
                        setLetterResult(restoredI);
                        setStep('review');
                    }
                }

                hasRestoredRef.current = true;
                return;
            }

            // v2: envelope de versão única (legado)
            if (parsed && parsed.v === 2 && Array.isArray(parsed.blocks) && parsed.blocks.length > 0) {
                const builder = new ProposalLetterBuilder(normalizedData);
                const freshResult = builder.build();
                const freshPricingBlock = freshResult.blocks.find(
                    (b: LetterBlock) => b.id === LetterBlockType.PRICING_SUMMARY
                );
                const restoredBlocks = parsed.blocks.map((b: LetterBlock) => {
                    if (b.id === LetterBlockType.PRICING_SUMMARY && freshPricingBlock) {
                        return { ...b, content: freshPricingBlock.content };
                    }
                    return b;
                });
                const restoredResult: ProposalLetterResult = {
                    blocks: restoredBlocks,
                    plainText: restoredBlocks.filter((b: any) => b.visible).map((b: any) => b.content).join('\n\n'),
                    htmlContent: '',
                    validation: { isValid: true, errors: [], warnings: [] },
                    meta: { generatedAt: new Date().toISOString(), builderVersion: 'restored', aiBlockIds: [], dataHash: '' },
                };
                setLetterResult(restoredResult);
                setSavedLetterInicial(restoredResult);
                setStep('review');
                hasRestoredRef.current = true;
            }
        } catch {
            // Não é JSON — texto legado, ignora
        }
    }, [props.letterContent]);

    // ── Save (v3: envelope com ambas versões) ──
    const handleSave = () => {
        // Salvar versão atual no cache local
        if (letterResult) {
            if (proposalType === 'READEQUADA') {
                setSavedLetterReadequada(letterResult);
            } else {
                setSavedLetterInicial(letterResult);
            }
        }

        // Construir envelope v3 com ambas versões
        const inicialData = proposalType === 'INICIAL' ? letterResult : savedLetterInicial;
        const readequadaData = proposalType === 'READEQUADA' ? letterResult : savedLetterReadequada;

        const envelope = {
            v: 3,
            inicial: inicialData ? { blocks: inicialData.blocks, plainText: inicialData.plainText } : null,
            readequada: readequadaData ? { blocks: readequadaData.blocks, plainText: readequadaData.plainText } : null,
        };

        const envelopeStr = JSON.stringify(envelope);
        props.setLetterContent(envelopeStr);
        // Passar diretamente para evitar race condition do setState assíncrono
        props.handleSaveLetter(envelopeStr);
    };

    // ── Export ──
    const handleExport = () => {
        // If we have structured letterResult, use the new exporter
        if (letterResult) {
            const exporter = new LetterPdfExporter();
            exporter.export({
                result: letterResult,
                data: normalizedData,
                items: props.items,
                mode: selectedExportMode,
                headerImage: props.headerImage,
                footerImage: props.footerImage,
                headerImageHeight: props.headerImageHeight,
                footerImageHeight: props.footerImageHeight,
                printLandscape: props.printLandscape,
            });
            return;
        }

        // Fallback to legacy exporter
        if (selectedExportMode === 'LETTER' || selectedExportMode === 'LETTER_WITH_SUMMARY' || selectedExportMode === 'LETTER_ANALYTICAL') {
            props.handlePrintProposal('LETTER');
        } else if (selectedExportMode === 'SPREADSHEET') {
            props.handlePrintProposal('SPREADSHEET');
        } else {
            props.handlePrintProposal('FULL');
        }
    };


    // ════════════════════════════════════
    // RENDER
    // ════════════════════════════════════

    return (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {/* ── Step Bar ── */}
            <div style={{
                display: 'flex', background: 'var(--color-bg-elevated)', borderBottom: '1px solid var(--color-border)',
                padding: '0 var(--space-2)',
            }}>
                {STEPS.map((s, i) => {
                    const isActive = s.id === step;
                    const isPast = i < stepIndex;
                    const isAccessible = i <= stepIndex || (letterResult && i <= 4);
                    return (
                        <button key={s.id}
                            onClick={() => isAccessible && setStep(s.id)}
                            style={{
                                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                                padding: 'var(--space-3) var(--space-2)',
                                background: 'none', border: 'none', cursor: isAccessible ? 'pointer' : 'default',
                                borderBottom: isActive ? '2px solid var(--color-primary)' : '2px solid transparent',
                                color: isActive ? 'var(--color-primary)'
                                    : isPast ? 'var(--color-success)' : 'var(--color-text-tertiary)',
                                fontWeight: isActive ? 700 : 500,
                                fontSize: 'var(--text-sm)',
                                opacity: isAccessible ? 1 : 0.4,
                                transition: 'all 0.2s',
                            }}>
                            {isPast ? <CheckCircle2 size={15} color="var(--color-success)" /> : s.icon}
                            <span style={{ display: 'inline' }}>{s.label}</span>
                            {i < STEPS.length - 1 && (
                                <ChevronRight size={12} style={{ marginLeft: 2, opacity: 0.3 }} />
                            )}
                        </button>
                    );
                })}
            </div>

            {/* ── Step Content ── */}
            <div style={{ padding: 'var(--space-6)' }}>

                {/* ═══ STEP 1: CONFIG ═══ */}
                {step === 'config' && (
                    <div>
                        <h3 style={{ margin: '0 0 var(--space-4)', fontSize: 'var(--text-lg)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Settings size={18} color="var(--color-primary)" /> Configuração Documental
                        </h3>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-5)', marginBottom: 'var(--space-5)' }}>
                            <div>
                                <label className="form-label">Validade da Proposta (dias)</label>
                                <input type="number" value={props.validityDays}
                                    onChange={e => props.setValidityDays(parseInt(e.target.value) || 60)}
                                    className="prop-input" />
                            </div>
                            <div>
                                <label className="form-label">Modelo de Assinatura</label>
                                <select value={props.signatureMode}
                                    onChange={e => props.setSignatureMode(e.target.value as any)}
                                    className="prop-input" style={{ padding: '6px 8px' }}>
                                    <option value="LEGAL">Representante Legal</option>
                                    <option value="TECH">Responsável Técnico</option>
                                    <option value="BOTH">Ambos</option>
                                </select>
                            </div>
                        </div>

                        {/* ── Dados de Assinatura Editáveis ── */}
                        <div style={{
                            background: 'rgba(51, 65, 133, 0.04)', padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)',
                            border: '1px solid rgba(51, 65, 133, 0.15)', marginBottom: 'var(--space-4)',
                        }}>
                            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: '#334155', marginBottom: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                <PenTool size={14} /> Dados de Assinatura
                            </div>

                            {/* Representante Legal */}
                            {(props.signatureMode === 'LEGAL' || props.signatureMode === 'BOTH') && (
                                <div style={{ marginBottom: 'var(--space-3)', padding: 'var(--space-3)', background: 'var(--color-bg-base)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                                    <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--color-primary)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Representante Legal</div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--space-2)' }}>
                                        <input value={sigLegal.name} onChange={e => setSigLegal({ ...sigLegal, name: e.target.value })} placeholder="Nome completo" className="prop-input" style={{ fontSize: '0.8rem' }} />
                                        <input value={sigLegal.cpf} onChange={e => setSigLegal({ ...sigLegal, cpf: e.target.value })} placeholder="CPF" className="prop-input" style={{ fontSize: '0.8rem' }} />
                                    </div>
                                </div>
                            )}

                            {/* Responsável Técnico */}
                            {(props.signatureMode === 'TECH' || props.signatureMode === 'BOTH') && (
                                <div style={{ marginBottom: 'var(--space-3)', padding: 'var(--space-3)', background: 'var(--color-bg-base)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                                    <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#F97316', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Responsável Técnico</div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--space-2)' }}>
                                        <input value={sigTech.name} onChange={e => setSigTech({ ...sigTech, name: e.target.value })} placeholder="Nome do responsável técnico" className="prop-input" style={{ fontSize: '0.8rem' }} />
                                        <input value={sigTech.registration} onChange={e => setSigTech({ ...sigTech, registration: e.target.value })} placeholder="CREA/CAU/Registro" className="prop-input" style={{ fontSize: '0.8rem' }} />
                                    </div>
                                </div>
                            )}

                            {/* Empresa */}
                            <div style={{ padding: 'var(--space-3)', background: 'var(--color-bg-base)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                                <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#8B5CF6', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Empresa</div>
                                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 'var(--space-2)' }}>
                                    <input value={sigCompany.razaoSocial} onChange={e => setSigCompany({ ...sigCompany, razaoSocial: e.target.value })} placeholder="Razão Social" className="prop-input" style={{ fontSize: '0.8rem' }} />
                                    <input value={sigCompany.cnpj} onChange={e => setSigCompany({ ...sigCompany, cnpj: e.target.value })} placeholder="CNPJ" className="prop-input" style={{ fontSize: '0.8rem' }} />
                                </div>
                            </div>
                        </div>

                        {/* Header/Footer uploads */}
                        <div style={{
                            background: 'var(--color-primary-light)', padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)',
                            border: '1px solid rgba(37, 99, 235, 0.1)', marginBottom: 'var(--space-4)',
                        }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-5)' }}>
                                <div>
                                    <span className="form-label">Cabeçalho (Timbrado Topo)</span>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                                        <input type="file" accept="image/*" onChange={e => props.handleImageUpload(e, props.setHeaderImage)} style={{ fontSize: '0.75rem', flex: 1 }} />
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                            <span style={{ fontSize: '0.7rem' }}>Alt:</span>
                                            <input type="number" value={props.headerImageHeight} onChange={e => props.setHeaderImageHeight(Number(e.target.value))} style={{ width: '50px', padding: '2px', fontSize: '0.75rem' }} />
                                        </div>
                                        {props.headerImage && <button type="button" onClick={() => props.setHeaderImage('')} style={{ fontSize: 'var(--text-sm)', color: 'var(--color-danger)', background: 'none', border: 'none', cursor: 'pointer' }}>Remover</button>}
                                    </div>
                                    {props.headerImage && (
                                        <div style={{ marginTop: 'var(--space-3)', border: '1px dashed var(--color-border)', padding: '4px', borderRadius: 'var(--radius-sm)', maxHeight: '80px', overflow: 'hidden', background: 'white' }}>
                                            <img src={props.headerImage} alt="Header" style={{ width: '100%', height: 'auto', maxHeight: '70px', objectFit: 'contain' }} />
                                        </div>
                                    )}
                                </div>
                                <div>
                                    <span className="form-label">Rodapé (Timbrado Base)</span>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                                        <input type="file" accept="image/*" onChange={e => props.handleImageUpload(e, props.setFooterImage)} style={{ fontSize: '0.75rem', flex: 1 }} />
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                            <span style={{ fontSize: '0.7rem' }}>Alt:</span>
                                            <input type="number" value={props.footerImageHeight} onChange={e => props.setFooterImageHeight(Number(e.target.value))} style={{ width: '50px', padding: '2px', fontSize: '0.75rem' }} />
                                        </div>
                                        {props.footerImage && <button type="button" onClick={() => props.setFooterImage('')} style={{ fontSize: 'var(--text-sm)', color: 'var(--color-danger)', background: 'none', border: 'none', cursor: 'pointer' }}>Remover</button>}
                                    </div>
                                    {props.footerImage && (
                                        <div style={{ marginTop: 'var(--space-3)', border: '1px dashed var(--color-border)', padding: '4px', borderRadius: 'var(--radius-sm)', maxHeight: '80px', overflow: 'hidden', background: 'white' }}>
                                            <img src={props.footerImage} alt="Footer" style={{ width: '100%', height: 'auto', maxHeight: '70px', objectFit: 'contain' }} />
                                        </div>
                                    )}
                                </div>
                            </div>
                            <div style={{ borderTop: '1px solid rgba(37, 99, 235, 0.1)', paddingTop: '12px', marginTop: '12px', display: 'flex', justifyContent: 'flex-end' }}>
                                <button onClick={() => props.handleSaveCompanyTemplate()} disabled={props.isSavingTemplate} style={{
                                    padding: '6px var(--space-4)', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-md)', fontWeight: 600,
                                    background: 'var(--color-bg-base)', border: '1px solid var(--color-primary)',
                                    color: 'var(--color-primary)', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
                                }}>
                                    {props.isSavingTemplate ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
                                    Salvar como Padrão da Empresa
                                </button>
                            </div>
                        </div>

                        {/* Tipo de Proposta */}
                        <div style={{
                            background: 'rgba(30, 64, 175, 0.04)', padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)',
                            border: '1px solid rgba(30, 64, 175, 0.15)', marginBottom: 'var(--space-4)',
                        }}>
                            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: '#1E40AF', marginBottom: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                <FileText size={14} /> Tipo de Proposta
                            </div>
                            <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                                <button
                                    onClick={() => handleSwitchProposalType('INICIAL')}
                                    style={{
                                        flex: 1, padding: '10px var(--space-4)', borderRadius: 'var(--radius-md)',
                                        fontSize: 'var(--text-sm)', fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s',
                                        background: proposalType === 'INICIAL' ? '#1E40AF' : 'var(--color-bg-base)',
                                        color: proposalType === 'INICIAL' ? '#fff' : 'var(--color-text-secondary)',
                                        border: `2px solid ${proposalType === 'INICIAL' ? '#1E40AF' : 'var(--color-border)'}`,
                                    }}>
                                    <ClipboardList size={14} style={{ display: 'inline', verticalAlign: 'middle' }} /> PROPOSTA DE PREÇOS INICIAL
                                    {savedLetterInicial && <span style={{ fontSize: '0.65rem', display: 'block', fontWeight: 400, marginTop: 2, color: proposalType === 'INICIAL' ? 'rgba(255,255,255,0.7)' : 'var(--color-success)' }}><CheckCircle2 size={10} style={{ display: 'inline', verticalAlign: 'middle' }} /> salva</span>}
                                </button>
                                <button
                                    onClick={() => handleSwitchProposalType('READEQUADA')}
                                    disabled={!props.adjustedEnabled}
                                    style={{
                                        flex: 1, padding: '10px var(--space-4)', borderRadius: 'var(--radius-md)',
                                        fontSize: 'var(--text-sm)', fontWeight: 700, cursor: props.adjustedEnabled ? 'pointer' : 'not-allowed', transition: 'all 0.2s',
                                        background: proposalType === 'READEQUADA' ? '#B45309' : 'var(--color-bg-base)',
                                        color: proposalType === 'READEQUADA' ? '#fff' : 'var(--color-text-secondary)',
                                        border: `2px solid ${proposalType === 'READEQUADA' ? '#B45309' : 'var(--color-border)'}`,
                                        opacity: props.adjustedEnabled ? 1 : 0.4,
                                    }}>
                                    <RefreshCw size={14} style={{ display: 'inline', verticalAlign: 'middle' }} /> PROPOSTA DE PREÇOS READEQUADA
                                    {!props.adjustedEnabled && <span style={{ fontSize: '0.65rem', display: 'block', fontWeight: 400, marginTop: 2 }}>(ative o cenário na planilha)</span>}
                                    {props.adjustedEnabled && savedLetterReadequada && <span style={{ fontSize: '0.65rem', display: 'block', fontWeight: 400, marginTop: 2, color: proposalType === 'READEQUADA' ? 'rgba(255,255,255,0.7)' : 'var(--color-success)' }}><CheckCircle2 size={10} style={{ display: 'inline', verticalAlign: 'middle' }} /> salva</span>}
                                </button>
                            </div>
                        </div>

                        {/* Data summary */}
                        <div style={{
                            background: 'var(--color-bg-elevated)', padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)',
                            border: '1px solid var(--color-border)', marginBottom: 'var(--space-4)',
                        }}>
                            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--color-text-secondary)', marginBottom: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                <Info size={14} /> Resumo dos dados que serão usados na carta
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-2)', fontSize: 'var(--text-sm)' }}>
                                <div><strong>Empresa:</strong> {props.company.razaoSocial}</div>
                                <div><strong>CNPJ:</strong> {props.company.cnpj}</div>
                                <div><strong>Processo:</strong> {props.bidding.modality} — {props.bidding.title?.substring(0, 60)}</div>
                                <div><strong>Valor:</strong> {(proposalType === 'READEQUADA' && props.adjustedEnabled ? (props.adjustedTotal || props.totalValue) : props.totalValue).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                                    {proposalType === 'READEQUADA' && props.adjustedEnabled && <span style={{ color: '#B45309', fontWeight: 600 }}> (readequada)</span>}
                                </div>
                                <div><strong>Itens:</strong> {props.items.length}</div>
                                <div><strong>BDI:</strong> {proposalType === 'READEQUADA' && props.adjustedEnabled ? (props.adjustedBdi ?? props.bdi) : props.bdi}% | <strong>Desconto:</strong> {proposalType === 'READEQUADA' && props.adjustedEnabled ? (props.adjustedDiscount ?? props.discount) : props.discount}%</div>
                            </div>
                        </div>

                        {/* Dados Bancários */}
                        <div style={{
                            background: 'rgba(20, 184, 166, 0.04)', padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)',
                            border: '1px solid rgba(20, 184, 166, 0.15)',
                        }}>
                            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: '#14B8A6', marginBottom: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                <Landmark size={14} /> Dados Bancários <span style={{ fontWeight: 400, color: 'var(--color-text-tertiary)', fontSize: '0.75rem' }}>(opcional — aparecerá na carta se preenchido)</span>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 'var(--space-3)' }}>
                                <div>
                                    <label className="form-label" style={{ fontSize: '0.75rem' }}>Banco</label>
                                    <input type="text" value={bankData.bank} placeholder="Ex: Banco do Brasil"
                                        onChange={e => setBankData({ ...bankData, bank: e.target.value })}
                                        className="prop-input" style={{ fontSize: '0.8rem' }} />
                                </div>
                                <div>
                                    <label className="form-label" style={{ fontSize: '0.75rem' }}>Agência</label>
                                    <input type="text" value={bankData.agency} placeholder="Ex: 1234-5"
                                        onChange={e => setBankData({ ...bankData, agency: e.target.value })}
                                        className="prop-input" style={{ fontSize: '0.8rem' }} />
                                </div>
                                <div>
                                    <label className="form-label" style={{ fontSize: '0.75rem' }}>Conta</label>
                                    <input type="text" value={bankData.account} placeholder="Ex: 12345-6"
                                        onChange={e => setBankData({ ...bankData, account: e.target.value })}
                                        className="prop-input" style={{ fontSize: '0.8rem' }} />
                                </div>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)', marginTop: 'var(--space-3)' }}>
                                <div>
                                    <label className="form-label" style={{ fontSize: '0.75rem' }}>Tipo de Conta</label>
                                    <select value={bankData.accountType}
                                        onChange={e => setBankData({ ...bankData, accountType: e.target.value })}
                                        className="prop-input" style={{ padding: '6px 8px', fontSize: '0.8rem' }}>
                                        <option value="Conta Corrente">Conta Corrente</option>
                                        <option value="Conta Poupança">Conta Poupança</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="form-label" style={{ fontSize: '0.75rem' }}>Chave PIX</label>
                                    <input type="text" value={bankData.pix} placeholder="CNPJ, e-mail, telefone ou chave aleatória"
                                        onChange={e => setBankData({ ...bankData, pix: e.target.value })}
                                        className="prop-input" style={{ fontSize: '0.8rem' }} />
                                </div>
                            </div>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)', marginTop: 'var(--space-5)' }}>
                            <button onClick={async () => {
                                // Modo rápido: validar → gerar → ir para revisão
                                const validator = new ProposalLetterValidator();
                                const result = validator.validate(normalizedData);
                                setValidation(result);
                                if (result.isValid) {
                                    await handleGenerate();
                                } else {
                                    setStep('validation');
                                }
                            }} style={{
                                padding: 'var(--space-2) var(--space-5)', borderRadius: 'var(--radius-lg)',
                                background: 'linear-gradient(135deg, var(--color-ai), var(--color-primary))',
                                color: 'white', border: 'none',
                                fontWeight: 700, fontSize: 'var(--text-md)', cursor: 'pointer',
                                display: 'flex', alignItems: 'center', gap: 8,
                                opacity: isGenerating ? 0.6 : 1,
                            }} disabled={isGenerating}>
                                {isGenerating ? <Loader2 size={16} className="spin" /> : <Zap size={16} />}
                                Gerar Rápido
                            </button>
                            <button onClick={handleValidate} style={{
                                padding: 'var(--space-2) var(--space-6)', borderRadius: 'var(--radius-lg)',
                                background: 'var(--color-primary)', color: 'white', border: 'none',
                                fontWeight: 700, fontSize: 'var(--text-md)', cursor: 'pointer',
                                display: 'flex', alignItems: 'center', gap: 8,
                            }}>
                                Validar dados <ChevronRight size={16} />
                            </button>
                        </div>
                    </div>
                )}

                {/* ═══ STEP 2: VALIDATION ═══ */}
                {step === 'validation' && validation && (
                    <div>
                        <h3 style={{ margin: '0 0 var(--space-4)', fontSize: 'var(--text-lg)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                            {validation.isValid
                                ? <><CheckCircle2 size={18} color="var(--color-success)" /> Dados Validados</>
                                : <><XCircle size={18} color="var(--color-danger)" /> Validação com Erros</>
                            }
                        </h3>

                        {/* Errors */}
                        {validation.errors.length > 0 && (
                            <div style={{
                                background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)',
                                borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)', marginBottom: 'var(--space-4)',
                            }}>
                                <div style={{ fontWeight: 700, color: 'var(--color-danger)', marginBottom: 'var(--space-2)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <XCircle size={15} /> {validation.errors.length} erro(s) impeditivo(s)
                                </div>
                                {validation.errors.map((e, i) => (
                                    <div key={i} style={{ fontSize: 'var(--text-sm)', padding: 'var(--space-2) 0', borderTop: i > 0 ? '1px solid rgba(239,68,68,0.1)' : 'none' }}>
                                        <span style={{ color: 'var(--color-danger)', fontWeight: 600 }}><XCircle size={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />{e.message}</span>
                                        {e.suggestion && <div style={{ color: 'var(--color-text-tertiary)', fontSize: '0.75rem', marginTop: 2 }}><Sparkles size={10} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />{e.suggestion}</div>}
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Warnings */}
                        {validation.warnings.length > 0 && (
                            <div style={{
                                background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.2)',
                                borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)', marginBottom: 'var(--space-4)',
                            }}>
                                <div style={{ fontWeight: 700, color: 'var(--color-warning)', marginBottom: 'var(--space-2)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <AlertTriangle size={15} /> {validation.warnings.length} alerta(s)
                                </div>
                                {validation.warnings.map((w, i) => (
                                    <div key={i} style={{ fontSize: 'var(--text-sm)', padding: 'var(--space-2) 0', borderTop: i > 0 ? '1px solid rgba(245,158,11,0.1)' : 'none' }}>
                                        <span style={{ color: 'var(--color-warning)' }}><AlertTriangle size={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />{w.message}</span>
                                        {w.suggestion && <div style={{ color: 'var(--color-text-tertiary)', fontSize: '0.75rem', marginTop: 2 }}><Sparkles size={10} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />{w.suggestion}</div>}
                                    </div>
                                ))}
                            </div>
                        )}

                        {/* Success */}
                        {validation.isValid && validation.errors.length === 0 && (
                            <div style={{
                                background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.2)',
                                borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)', marginBottom: 'var(--space-4)',
                                color: 'var(--color-success)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8,
                            }}>
                                <CheckCircle2 size={18} /> Todos os campos obrigatórios estão preenchidos. Pronto para gerar!
                            </div>
                        )}

                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--space-5)' }}>
                            <button onClick={() => setStep('config')} className="btn btn-outline" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <ChevronLeft size={16} /> Voltar
                            </button>
                            <button onClick={handleGenerate} disabled={!validation.isValid || isGenerating} style={{
                                padding: 'var(--space-2) var(--space-6)', borderRadius: 'var(--radius-lg)',
                                background: validation.isValid ? 'linear-gradient(135deg, var(--color-ai), var(--color-primary))' : 'var(--color-bg-elevated)',
                                color: validation.isValid ? 'white' : 'var(--color-text-tertiary)',
                                border: 'none', fontWeight: 700, fontSize: 'var(--text-md)', cursor: validation.isValid ? 'pointer' : 'default',
                                display: 'flex', alignItems: 'center', gap: 8, opacity: validation.isValid ? 1 : 0.5,
                            }}>
                                <Sparkles size={16} /> Gerar Carta <ChevronRight size={16} />
                            </button>
                        </div>
                    </div>
                )}

                {/* ═══ STEP 3: GENERATION ═══ */}
                {step === 'generation' && (
                    <div>
                        <h3 style={{ margin: '0 0 var(--space-4)', fontSize: 'var(--text-lg)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Cpu size={18} color="var(--color-primary)" /> Geração da Carta
                            {isGenerating && <Loader2 size={16} className="spin" style={{ color: 'var(--color-primary)' }} />}
                        </h3>

                        <div style={{
                            background: 'var(--color-bg-elevated)', borderRadius: 'var(--radius-lg)',
                            border: '1px solid var(--color-border)', padding: 'var(--space-4)',
                        }}>
                            {generationProgress.map((msg, i) => (
                                <div key={i} style={{
                                    padding: 'var(--space-2) 0', fontSize: 'var(--text-sm)',
                                    borderTop: i > 0 ? '1px solid var(--color-border)' : 'none',
                                    color: msg.startsWith('[x]') ? 'var(--color-danger)'
                                        : msg.startsWith('[!]') ? 'var(--color-warning)'
                                        : msg.startsWith('[OK]') ? 'var(--color-success)'
                                        : 'var(--color-text-secondary)',
                                    fontWeight: i === generationProgress.length - 1 ? 600 : 400,
                                    animation: i === generationProgress.length - 1 ? 'fadeIn 0.3s ease-in' : 'none',
                                }}>
                                    {msg}
                                </div>
                            ))}
                        </div>

                        {!isGenerating && letterResult && (
                            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-4)' }}>
                                <button onClick={() => setStep('review')} style={{
                                    padding: 'var(--space-2) var(--space-6)', borderRadius: 'var(--radius-lg)',
                                    background: 'var(--color-primary)', color: 'white', border: 'none',
                                    fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                                }}>
                                    Revisar Carta <ChevronRight size={16} />
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {/* ═══ STEP 4: REVIEW ═══ */}
                {step === 'review' && letterResult && (
                    <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
                            <h3 style={{ margin: 0, fontSize: 'var(--text-lg)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                                <Edit3 size={18} color="var(--color-primary)" /> Revisão por Blocos
                                <span style={{ fontSize: 'var(--text-sm)', fontWeight: 400, color: 'var(--color-text-tertiary)' }}>
                                    ({letterResult.blocks.filter(b => b.visible).length} blocos)
                                </span>
                            </h3>
                            <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                                <button onClick={() => { handleGenerate(); }} className="btn btn-outline" style={{ fontSize: 'var(--text-sm)', display: 'flex', alignItems: 'center', gap: 4, padding: '4px 12px' }}>
                                    <RefreshCw size={13} /> Regenerar
                                </button>
                                <button onClick={handleSave} disabled={props.isSaving} className="btn btn-outline" style={{ fontSize: 'var(--text-sm)', display: 'flex', alignItems: 'center', gap: 4, padding: '4px 12px' }}>
                                    {props.isSaving ? <Loader2 size={13} className="spin" /> : <Save size={13} />} Salvar
                                </button>
                            </div>
                        </div>

                        {/* Blocos agrupados por seção */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
                            {BLOCK_GROUPS.map(group => {
                                const groupBlocks = letterResult.blocks.filter(b => b.visible && (group.ids as string[]).includes(b.id));
                                if (groupBlocks.length === 0) return null;

                                return (
                                    <div key={group.label}>
                                        {/* Group separator */}
                                        <div style={{
                                            fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
                                            color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-2)',
                                            paddingBottom: 'var(--space-1)', borderBottom: '1px solid var(--color-border)',
                                        }}>{group.label}</div>

                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                                            {groupBlocks.map(block => {
                                                const meta = BLOCK_LABELS[block.id] || { icon: <File size={14} />, color: '#64748B' };
                                                const isEditing = editingBlockId === block.id;
                                                const isCollapsed = collapsedBlocks.has(block.id);
                                                const needsAttention = ATTENTION_BLOCKS.has(block.id);
                                                const isLongContent = (block.content || '').length > 300;

                                                return (
                                                    <div key={block.id} style={{
                                                        borderRadius: 'var(--radius-lg)',
                                                        border: isEditing ? `2px solid ${meta.color}`
                                                            : needsAttention ? `1px solid ${meta.color}30`
                                                            : '1px solid var(--color-border)',
                                                        overflow: 'hidden', transition: 'border-color 0.2s',
                                                    }}>
                                                        {/* Block header */}
                                                        <div style={{
                                                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                                            padding: '6px var(--space-3)',
                                                            background: needsAttention ? `${meta.color}06` : 'var(--color-bg-elevated)',
                                                            borderBottom: isCollapsed ? 'none' : '1px solid var(--color-border)',
                                                            cursor: 'pointer',
                                                        }} onClick={() => {
                                                            if (!isEditing) {
                                                                setCollapsedBlocks(prev => {
                                                                    const next = new Set(prev);
                                                                    next.has(block.id) ? next.delete(block.id) : next.add(block.id);
                                                                    return next;
                                                                });
                                                            }
                                                        }}>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--text-sm)', fontWeight: 600 }}>
                                                                {isCollapsed ? <ChevronRight size={13} style={{ color: 'var(--color-text-tertiary)' }} /> : <ChevronDown size={13} style={{ color: 'var(--color-text-tertiary)' }} />}
                                                                <span style={{ color: meta.color }}>{meta.icon}</span>
                                                                <span style={{ color: meta.color }}>{block.label}</span>
                                                                {block.aiGenerated && (
                                                                    <span style={{
                                                                        fontSize: '0.6rem', padding: '1px 5px', borderRadius: '99px',
                                                                        background: 'linear-gradient(135deg, rgba(168,85,247,0.12), rgba(59,130,246,0.12))',
                                                                        color: 'var(--color-ai)', fontWeight: 700,
                                                                    }}>IA</span>
                                                                )}
                                                                {needsAttention && !block.aiGenerated && (
                                                                    <span style={{
                                                                        fontSize: '0.6rem', padding: '1px 5px', borderRadius: '99px',
                                                                        background: 'rgba(245,158,11,0.1)', color: '#D97706', fontWeight: 600,
                                                                    }}>Conferir</span>
                                                                )}
                                                            </div>
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={e => e.stopPropagation()}>
                                                                {block.editable ? (
                                                                    isEditing ? (
                                                                        <>
                                                                            <button onClick={handleSaveEdit} style={{ fontSize: '0.7rem', padding: '2px 8px', background: 'var(--color-success)', color: 'white', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}>Salvar</button>
                                                                            <button onClick={handleCancelEdit} style={{ fontSize: '0.7rem', padding: '2px 8px', background: 'var(--color-bg-elevated)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}>Cancelar</button>
                                                                        </>
                                                                    ) : (
                                                                        <button onClick={() => { handleStartEdit(block); setCollapsedBlocks(prev => { const n = new Set(prev); n.delete(block.id); return n; }); }} style={{
                                                                            fontSize: '0.7rem', padding: '2px 8px', background: 'none',
                                                                            border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)',
                                                                            cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
                                                                            color: 'var(--color-text-secondary)',
                                                                        }}>
                                                                            <Unlock size={10} /> Editar
                                                                        </button>
                                                                    )
                                                                ) : (
                                                                    <span style={{ fontSize: '0.6rem', color: 'var(--color-text-tertiary)', display: 'flex', alignItems: 'center', gap: 3 }}>
                                                                        <Lock size={10} /> Fixo
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>

                                                        {/* Block content — collapsible */}
                                                        {!isCollapsed && (
                                                            <div style={{ padding: 'var(--space-3) var(--space-4)' }}>
                                                                {isEditing ? (
                                                                    <textarea value={editBuffer} onChange={e => setEditBuffer(e.target.value)}
                                                                        style={{
                                                                            width: '100%', minHeight: '120px', padding: 'var(--space-3)',
                                                                            borderRadius: 'var(--radius-md)', border: `1px solid ${meta.color}40`,
                                                                            fontSize: 'var(--text-sm)', lineHeight: 1.6, resize: 'vertical',
                                                                            background: 'var(--color-bg-base)',
                                                                        }}
                                                                    />
                                                                ) : (
                                                                    <div style={{
                                                                        fontSize: block.type === LetterBlockType.TITLE ? '1.1rem' : 'var(--text-sm)',
                                                                        lineHeight: 1.65,
                                                                        color: 'var(--color-text-primary)', whiteSpace: 'pre-wrap',
                                                                        maxHeight: isLongContent ? '250px' : 'none',
                                                                        overflow: isLongContent ? 'auto' : 'visible',
                                                                        fontWeight: block.type === LetterBlockType.TITLE ? 700 : 'normal',
                                                                        textAlign: block.type === LetterBlockType.TITLE || block.type === LetterBlockType.SIGNATURE ? 'center' : 'left',
                                                                        letterSpacing: block.type === LetterBlockType.TITLE ? '0.5px' : 'normal',
                                                                    }}>
                                                                        {block.content || <em style={{ color: 'var(--color-text-tertiary)' }}>Bloco vazio</em>}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--space-5)' }}>
                            <button onClick={() => setStep('config')} className="btn btn-outline" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <ChevronLeft size={16} /> Configuração
                            </button>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                                <button onClick={handleSave} disabled={props.isSaving} style={{
                                    padding: 'var(--space-2) var(--space-5)', borderRadius: 'var(--radius-lg)',
                                    background: 'var(--color-success)', color: 'white', border: 'none',
                                    fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                                    fontSize: 'var(--text-sm)', opacity: props.isSaving ? 0.6 : 1,
                                }}>
                                    {props.isSaving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
                                    Salvar Carta
                                </button>
                                <button onClick={() => setStep('export')} style={{
                                    padding: 'var(--space-2) var(--space-6)', borderRadius: 'var(--radius-lg)',
                                    background: 'var(--color-primary)', color: 'white', border: 'none',
                                    fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                                }}>
                                    Exportar <ChevronRight size={16} />
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* ═══ STEP 5: EXPORT ═══ */}
                {step === 'export' && (
                    <div>
                        <h3 style={{ margin: '0 0 var(--space-4)', fontSize: 'var(--text-lg)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Printer size={18} color="var(--color-primary)" /> Exportação
                        </h3>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 'var(--space-3)', marginBottom: 'var(--space-5)' }}>
                            {([
                                { mode: 'LETTER' as const, icon: <FileText size={24} />, label: 'Carta Apenas', desc: 'Carta proposta sem planilha' },
                                { mode: 'SPREADSHEET' as const, icon: <Table2 size={24} />, label: 'Planilha Apenas', desc: 'Tabela de preços isolada' },
                                { mode: 'FULL' as const, icon: <FileStack size={24} />, label: 'Completa', desc: 'Carta + Planilha de Preços' },
                            ]).map(opt => (
                                <button key={opt.mode} onClick={() => setSelectedExportMode(opt.mode)} style={{
                                    padding: 'var(--space-4)', borderRadius: 'var(--radius-lg)',
                                    border: selectedExportMode === opt.mode ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                                    background: selectedExportMode === opt.mode ? 'var(--color-primary-light)' : 'var(--color-bg-base)',
                                    cursor: 'pointer', textAlign: 'center', transition: 'all 0.2s',
                                }}>
                                    <div style={{ color: selectedExportMode === opt.mode ? 'var(--color-primary)' : 'var(--color-text-tertiary)', marginBottom: 8 }}>{opt.icon}</div>
                                    <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--color-text-primary)' }}>{opt.label}</div>
                                    <div style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)', marginTop: 4 }}>{opt.desc}</div>
                                </button>
                            ))}
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 'var(--space-3)', marginBottom: 'var(--space-5)' }}>
                            {([
                                { mode: 'LETTER_WITH_SUMMARY' as const, icon: <ListOrdered size={20} />, label: 'Carta c/ Resumo', desc: 'Carta com quadro resumido dos itens' },
                                { mode: 'LETTER_ANALYTICAL' as const, icon: <BarChart3 size={20} />, label: 'Carta Analítica', desc: 'Carta com detalhamento completo' },
                            ]).map(opt => (
                                <button key={opt.mode} onClick={() => setSelectedExportMode(opt.mode)} style={{
                                    padding: 'var(--space-3)', borderRadius: 'var(--radius-lg)',
                                    border: selectedExportMode === opt.mode ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                                    background: selectedExportMode === opt.mode ? 'var(--color-primary-light)' : 'var(--color-bg-base)',
                                    cursor: 'pointer', textAlign: 'left', transition: 'all 0.2s',
                                    display: 'flex', alignItems: 'center', gap: 12,
                                }}>
                                    <div style={{ color: selectedExportMode === opt.mode ? 'var(--color-primary)' : 'var(--color-text-tertiary)' }}>{opt.icon}</div>
                                    <div>
                                        <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--color-text-primary)' }}>{opt.label}</div>
                                        <div style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)' }}>{opt.desc}</div>
                                    </div>
                                </button>
                            ))}
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--space-5)' }}>
                            <button onClick={() => setStep('review')} className="btn btn-outline" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <ChevronLeft size={16} /> Voltar
                            </button>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                                {/* Toggle Paisagem ao lado do Exportar */}
                                <label style={{
                                    display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: 'pointer',
                                    padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-md)',
                                    backgroundColor: 'var(--color-bg-base)', border: '1px solid var(--color-border)',
                                    fontSize: 'var(--text-sm)',
                                }}>
                                    <input type="checkbox" checked={props.printLandscape || false}
                                        onChange={(e) => props.setPrintLandscape?.(e.target.checked)}
                                        style={{ width: '14px', height: '14px', accentColor: 'var(--color-primary)' }} />
                                    <Printer size={12} style={{ color: 'var(--color-text-tertiary)' }} />
                                    <span style={{ fontWeight: 500, color: 'var(--color-text-secondary)' }}>Paisagem</span>
                                </label>
                                <button onClick={handleExport} style={{
                                    padding: 'var(--space-3) var(--space-8)', borderRadius: 'var(--radius-lg)',
                                    background: 'linear-gradient(135deg, var(--color-primary), var(--color-ai))',
                                    color: 'white', border: 'none', fontWeight: 700, fontSize: 'var(--text-md)',
                                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                                    boxShadow: '0 4px 14px rgba(37, 99, 235, 0.3)',
                                }}>
                                    <Printer size={18} /> Exportar PDF
                                </button>

                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
