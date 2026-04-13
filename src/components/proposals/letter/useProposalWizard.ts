import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import type { ProposalLetterWizardProps } from './ProposalLetterWizard';
import type { ProposalLetterResult, LetterBlock, ValidationResult, LetterExportMode } from './types';
import { LetterBlockType } from './types';
import { LetterDataNormalizer } from './LetterDataNormalizer';
import { ProposalLetterBuilder } from './ProposalLetterBuilder';
import { ProposalLetterValidator } from './ProposalLetterValidator';
import { LetterPdfExporter } from './LetterPdfExporter';
import { exportCompositionPdf, buildCompositionInlineHtml } from '../composition/compositionPdfExporter';
import type { AiLetterBlocksResponse } from './types';
import { API_BASE_URL } from '../../../config';

export type WizardStep = 'config' | 'validation' | 'generation' | 'review' | 'export';

export function useProposalWizard(props: ProposalLetterWizardProps) {
    const [step, setStep] = useState<WizardStep>('config');
    const [validation, setValidation] = useState<ValidationResult | null>(null);
    const [letterResult, setLetterResult] = useState<ProposalLetterResult | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [generationProgress, setGenerationProgress] = useState<string[]>([]);
    const [editingBlockId, setEditingBlockId] = useState<string | null>(null);
    const [editBuffer, setEditBuffer] = useState('');
    const [selectedExportMode, setSelectedExportMode] = useState<LetterExportMode>('FULL');
    const [collapsedBlocks, setCollapsedBlocks] = useState<Set<string>>(new Set());

    const [proposalType, setProposalType] = useState<'INICIAL' | 'READEQUADA'>('INICIAL');
    const [savedLetterInicial, setSavedLetterInicial] = useState<ProposalLetterResult | null>(null);
    const [savedLetterReadequada, setSavedLetterReadequada] = useState<ProposalLetterResult | null>(null);

    const { sigLegal, setSigLegal, sigTech, setSigTech, sigCompany, setSigCompany, bankData, setBankData } = props;

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
        (data.meta as any).proposalType = proposalType;
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
        data.company.razaoSocial = sigCompany.razaoSocial;
        data.company.cnpj = sigCompany.cnpj;
        data.company.contactName = sigLegal.name;
        data.company.contactCpf = sigLegal.cpf;
        return data;
    }, [props.bidding, props.company, props.proposal, props.items, props.totalValue,
        props.signatureMode, props.validityDays, props.bdi, props.discount, bankData,
        proposalType, sigLegal, sigTech, sigCompany, props.adjustedEnabled, props.adjustedBdi, props.adjustedDiscount, props.adjustedTotal]);

    const handleValidate = useCallback(() => {
        const validator = new ProposalLetterValidator();
        const result = validator.validate(normalizedData);
        setValidation(result);
        setStep('validation');
    }, [normalizedData]);

    const handleGenerate = useCallback(async () => {
        setIsGenerating(true);
        setGenerationProgress(['Iniciando composição...']);
        setStep('generation');

        try {
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

            setGenerationProgress(prev => [...prev, '[...] Compondo blocos estruturais...']);
            const builder = new ProposalLetterBuilder(normalizedData);
            if (aiBlocks.objectBlock) builder.setAiContent(LetterBlockType.OBJECT, aiBlocks.objectBlock);
            if (aiBlocks.executionBlock) builder.setAiContent(LetterBlockType.EXECUTION, aiBlocks.executionBlock);
            if (aiBlocks.commercialExtras) builder.setAiContent('commercialExtras', aiBlocks.commercialExtras);

            const result = builder.build();
            setLetterResult(result);

            if (proposalType === 'READEQUADA') {
                setSavedLetterReadequada(result);
            } else {
                setSavedLetterInicial(result);
            }

            props.setLetterContent(result.plainText);

            const visibleCount = result.blocks.filter(b => b.visible).length;
            const aiCount = result.meta.aiBlockIds.length;
            setGenerationProgress(prev => [
                ...prev,
                `[OK] Carta composta: ${visibleCount} blocos (${aiCount} com IA)`,
                '[OK] Pronto para revisão!'
            ]);

            setTimeout(() => setStep('review'), 1500);
        } catch (e: any) {
            setGenerationProgress(prev => [...prev, `[x] Erro: ${e.message || 'Desconhecido'}`]);
        } finally {
            setIsGenerating(false);
        }
    }, [normalizedData, props, proposalType]);

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

    const handleSwitchProposalType = useCallback((newType: 'INICIAL' | 'READEQUADA') => {
        if (newType === proposalType) return;

        if (letterResult) {
            if (proposalType === 'INICIAL') {
                setSavedLetterInicial(letterResult);
            } else {
                setSavedLetterReadequada(letterResult);
            }
        }

        setProposalType(newType);

        const cachedVersion = newType === 'INICIAL' ? savedLetterInicial : savedLetterReadequada;
        if (cachedVersion) {
            setLetterResult(cachedVersion);
            setStep('review');
        } else {
            setLetterResult(null);
            setStep('config');
        }
    }, [proposalType, letterResult, savedLetterInicial, savedLetterReadequada]);

    const hasRestoredRef = useRef(false);
    useEffect(() => {
        if (hasRestoredRef.current || !props.letterContent) return;
        try {
            const parsed = JSON.parse(props.letterContent);

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
        }
    }, [props.letterContent, props.bidding, props.company, props.proposal, props.items, props.totalValue, props.signatureMode, props.validityDays, props.bdi, props.discount, props.adjustedEnabled, props.adjustedTotal, props.adjustedBdi, props.adjustedDiscount, normalizedData]);

    const handleSave = () => {
        if (letterResult) {
            if (proposalType === 'READEQUADA') {
                setSavedLetterReadequada(letterResult);
            } else {
                setSavedLetterInicial(letterResult);
            }
        }

        const inicialData = proposalType === 'INICIAL' ? letterResult : savedLetterInicial;
        const readequadaData = proposalType === 'READEQUADA' ? letterResult : savedLetterReadequada;

        const envelope = {
            v: 3,
            inicial: inicialData ? { blocks: inicialData.blocks, plainText: inicialData.plainText } : null,
            readequada: readequadaData ? { blocks: readequadaData.blocks, plainText: readequadaData.plainText } : null,
        };

        const envelopeStr = JSON.stringify(envelope);
        props.setLetterContent(envelopeStr);
        props.handleSaveLetter(envelopeStr);
    };

    const handleExport = () => {
        const isCompositionOnly = selectedExportMode === 'COMPOSITION_ONLY';
        const isFullWithComp = selectedExportMode === 'FULL_WITH_COMPOSITION';
        const isFullWithoutComp = selectedExportMode === 'FULL_WITHOUT_COMPOSITION';
        const isReadequada = proposalType === 'READEQUADA' && props.adjustedEnabled;
        const effectiveBdi = isReadequada ? (props.adjustedBdi ?? props.bdi) : props.bdi;

        if (isCompositionOnly) {
            exportCompositionPdf({
                items: props.items,
                bdi: effectiveBdi,
                company: props.company,
                headerImage: props.headerImage,
                footerImage: props.footerImage,
                headerImageHeight: props.headerImageHeight,
                footerImageHeight: props.footerImageHeight,
                printLandscape: true,
                processTitle: props.bidding?.title,
                processNumber: props.bidding?.modality,
                isReadequada,
            });
            return;
        }

        const baseMode: LetterExportMode = (isFullWithComp || isFullWithoutComp) ? 'FULL' : selectedExportMode;
        const compositionHtml = isFullWithComp
            ? buildCompositionInlineHtml(props.items, effectiveBdi, isReadequada)
            : undefined;

        if (letterResult) {
            const exporter = new LetterPdfExporter();
            exporter.export({
                result: letterResult,
                data: normalizedData,
                items: props.items,
                mode: baseMode,
                headerImage: props.headerImage,
                footerImage: props.footerImage,
                headerImageHeight: props.headerImageHeight,
                footerImageHeight: props.footerImageHeight,
                printLandscape: props.printLandscape,
                compositionHtml,
            });
        } else {
            if (baseMode === 'LETTER' || baseMode === 'LETTER_WITH_SUMMARY' || baseMode === 'LETTER_ANALYTICAL') {
                props.handlePrintProposal('LETTER');
            } else if (baseMode === 'SPREADSHEET') {
                props.handlePrintProposal('SPREADSHEET');
            } else {
                props.handlePrintProposal('FULL');
            }
        }
    };

    return {
        step, setStep,
        validation,
        letterResult,
        isGenerating,
        generationProgress,
        editingBlockId, setEditingBlockId,
        editBuffer, setEditBuffer,
        selectedExportMode, setSelectedExportMode,
        collapsedBlocks, setCollapsedBlocks,
        proposalType, setProposalType,
        savedLetterInicial,
        savedLetterReadequada,
        handleValidate,
        handleGenerate,
        handleStartEdit,
        handleSaveEdit,
        handleCancelEdit,
        handleSwitchProposalType,
        handleSave,
        handleExport,
        normalizedData
    };
}
