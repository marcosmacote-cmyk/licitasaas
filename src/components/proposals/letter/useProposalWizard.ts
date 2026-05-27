import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import type { ProposalLetterWizardProps } from './ProposalLetterWizard';
import type { ProposalLetterResult, LetterBlock, ValidationResult, LetterExportMode, ProposalDeclaration } from './types';
import { LetterBlockType } from './types';
import { extractDeclarationTypes } from '../../hooks/useAiDeclaration';
import { LetterDataNormalizer } from './LetterDataNormalizer';
import { ProposalLetterBuilder } from './ProposalLetterBuilder';
import { ProposalLetterValidator } from './ProposalLetterValidator';
import { ComplianceChecker } from './ComplianceChecker';
import type { ComplianceResult } from './ComplianceChecker';
import { LetterPdfExporter } from './LetterPdfExporter';
import { exportCompositionPdf, buildCompositionInlineHtml } from '../composition/compositionPdfExporter';
import type { AiLetterBlocksResponse } from './types';
import { API_BASE_URL } from '../../../config';

export type WizardStep = 'config' | 'validation' | 'generation' | 'review' | 'export';

// ── Data Cockpit: campos editáveis do processo ──
export interface CockpitData {
    proposalTitle: string;
    executionDeadline: string;
    contractDuration: string;
    executionLocation: string;
    proposalDate: string;       // YYYY-MM-DD override ou '' = data de geração
    proposalType?: 'INITIAL' | 'READJUSTED';
}

const COCKPIT_DEFAULTS: CockpitData = {
    proposalTitle: 'PROPOSTA DE PREÇOS',
    executionDeadline: '',
    contractDuration: '',
    executionLocation: '',
    proposalDate: '',
    proposalType: 'INITIAL',
};

// ── Helper: restaura blocos salvos com pricing atualizado ──
function restoreFromBlocks(blocks: LetterBlock[], nd: any): ProposalLetterResult | null {
    if (!Array.isArray(blocks) || blocks.length === 0) return null;
    const builder = new ProposalLetterBuilder(nd);
    const freshResult = builder.build();
    const freshPricing = freshResult.blocks.find((b: LetterBlock) => b.id === LetterBlockType.PRICING_SUMMARY);
    const restoredBlocks = blocks.map((b: LetterBlock) =>
        b.id === LetterBlockType.PRICING_SUMMARY && freshPricing ? { ...b, content: freshPricing.content } : b
    );
    return {
        blocks: restoredBlocks,
        plainText: restoredBlocks.filter((b: any) => b.visible).map((b: any) => b.content).join('\n\n'),
        htmlContent: '',
        validation: { isValid: true, errors: [], warnings: [] },
        meta: { generatedAt: new Date().toISOString(), builderVersion: 'restored', aiBlockIds: [], dataHash: '' },
    };
}

// ── Helper: formata data BR por extenso ──
function formatDateBR(dateStr: string): string {
    if (!dateStr) return '';
    try {
        const [year, month, day] = dateStr.split('-').map(Number);
        const d = new Date(year, month - 1, day);
        return new Intl.DateTimeFormat('pt-BR', {
            day: '2-digit', month: 'long', year: 'numeric',
        }).format(d);
    } catch { return dateStr; }
}

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
    // FIX F3.2: Preview HTML state
    const [previewHtml, setPreviewHtml] = useState<string>('');
    const [showPreview, setShowPreview] = useState(false);

    // ── Compliance Guard state ──
    const [complianceResult, setComplianceResult] = useState<ComplianceResult | null>(null);
    const [showComplianceGuard, setShowComplianceGuard] = useState(false);

    // ── Data Cockpit state ──
    const [cockpit, setCockpit] = useState<CockpitData>(COCKPIT_DEFAULTS);
    const updateCockpit = useCallback((patch: Partial<CockpitData>) => {
        setCockpit(prev => {
            const next = { ...prev, ...patch };
            if (patch.proposalType && patch.proposalType !== prev.proposalType) {
                if (patch.proposalType === 'READJUSTED') {
                    next.proposalTitle = 'PROPOSTA DE PREÇOS READEQUADA';
                } else {
                    next.proposalTitle = 'PROPOSTA DE PREÇOS';
                }
            }
            return next;
        });
    }, []);

    // ── Declarações inline ──
    const [declarations, setDeclarations] = useState<ProposalDeclaration[]>([]);

    const toggleDeclaration = useCallback((id: string) => {
        setDeclarations(prev => prev.map(d => d.id === id ? { ...d, enabled: !d.enabled } : d));
    }, []);

    const addManualDeclaration = useCallback(() => {
        const newDecl: ProposalDeclaration = {
            id: `manual_${Date.now()}`,
            title: 'NOVA DECLARAÇÃO',
            content: '',
            source: 'manual',
            enabled: true,
        };
        setDeclarations(prev => [...prev, newDecl]);
    }, []);

    const removeDeclaration = useCallback((id: string) => {
        setDeclarations(prev => prev.filter(d => d.id !== id));
    }, []);

    const updateDeclaration = useCallback((id: string, patch: Partial<ProposalDeclaration>) => {
        setDeclarations(prev => prev.map(d => d.id === id ? { ...d, ...patch } : d));
    }, []);

    const { sigLegal, setSigLegal, sigTech, setSigTech, sigCompany, setSigCompany, bankData, setBankData } = props;

    // ── Normalização de dados base (sem cockpit overrides) ──
    const normalizedData = useMemo(() => {
        const normalizer = new LetterDataNormalizer();
        const data = normalizer.normalize({
            bidding: props.bidding,
            company: props.company,
            proposal: props.proposal,
            items: props.items,
            totalValue: props.totalValue,
            signatureMode: props.signatureMode,
            validityDays: props.validityDays,
            bdiPercentage: props.bdi,
            discountPercentage: props.discount,
            bankingData: (bankData.bank || bankData.agency || bankData.account || bankData.pix)
                ? bankData : undefined,
        });
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
        sigLegal, sigTech, sigCompany]);

    // ── Pré-popular cockpit com dados IA (apenas uma vez) ──
    const hasPrepopulatedCockpitRef = useRef(false);
    useEffect(() => {
        if (hasPrepopulatedCockpitRef.current) return;
        const exec = normalizedData.execution || {};
        const hasSomething = exec.executionDeadline || exec.contractDuration || exec.executionLocation;
        if (hasSomething) {
            setCockpit(prev => ({
                ...prev,
                executionDeadline: prev.executionDeadline || exec.executionDeadline || '',
                contractDuration: prev.contractDuration || exec.contractDuration || '',
                executionLocation: prev.executionLocation || exec.executionLocation || '',
            }));
            hasPrepopulatedCockpitRef.current = true;
        }
    }, [normalizedData]);

    // ── Pré-popular declarações do edital (apenas uma vez) ──
    const hasPrepopulatedDeclRef = useRef(false);
    useEffect(() => {
        if (hasPrepopulatedDeclRef.current || declarations.length > 0) return;
        const schema = (props.bidding?.aiAnalysis as any)?.schemaV2;
        let types: string[] = [];

        // 1. Priorizar declaration_routes (estruturado)
        if (schema?.operational_outputs?.declaration_routes?.length > 0) {
            types = schema.operational_outputs.declaration_routes.map(
                (d: any) => typeof d === 'string' ? d : (d.name || d.title || '')
            ).filter(Boolean);
        }
        // 2. Fallback: requiredDocuments com heurística
        if (types.length === 0 && props.bidding?.aiAnalysis?.requiredDocuments) {
            types = extractDeclarationTypes(props.bidding.aiAnalysis.requiredDocuments);
        }

        if (types.length > 0) {
            const declsFromEdital: ProposalDeclaration[] = types.map((t, i) => ({
                id: `edital_${i}`,
                title: t.toUpperCase(),
                content: '',
                source: 'edital' as const,
                enabled: false,  // starts unchecked — user activates
            }));
            setDeclarations(declsFromEdital);
            hasPrepopulatedDeclRef.current = true;
        }
    }, [props.bidding, declarations.length]);

    // ── Dados efetivos: normalizedData + cockpit overrides ──
    const effectiveData = useMemo(() => {
        const data = JSON.parse(JSON.stringify(normalizedData)); // deep clone

        // Cockpit overrides → execução
        if (cockpit.executionDeadline) data.execution.executionDeadline = cockpit.executionDeadline;
        if (cockpit.contractDuration) data.execution.contractDuration = cockpit.contractDuration;
        if (cockpit.executionLocation) data.execution.executionLocation = cockpit.executionLocation;

        // Cockpit → título customizado
        (data.meta as any).customTitle = cockpit.proposalTitle;

        // Cockpit → data do documento
        if (cockpit.proposalDate) {
            const dateBR = formatDateBR(cockpit.proposalDate);
            // Substitui apenas a porção de data, preservando cidade/UF
            const parts = data.signature.localDate.split(',');
            if (parts.length > 1) {
                data.signature.localDate = `${parts[0].trim()}, ${dateBR}`;
            } else {
                data.signature.localDate = dateBR;
            }
        }

        return data;
    }, [normalizedData, cockpit]);

    const handleValidate = useCallback(() => {
        const validator = new ProposalLetterValidator();
        const result = validator.validate(effectiveData);
        setValidation(result);
        setStep('validation');
    }, [effectiveData]);

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
            const builder = new ProposalLetterBuilder(effectiveData);
            if (aiBlocks.objectBlock) builder.setAiContent(LetterBlockType.OBJECT, aiBlocks.objectBlock);
            if (aiBlocks.executionBlock) builder.setAiContent(LetterBlockType.EXECUTION, aiBlocks.executionBlock);
            if (aiBlocks.commercialExtras) builder.setAiContent('commercialExtras', aiBlocks.commercialExtras);

            // Injetar declarações habilitadas
            const enabledDecls = declarations.filter(d => d.enabled);
            if (enabledDecls.length > 0) {
                builder.setDeclarations(enabledDecls);
                setGenerationProgress(prev => [...prev, `[OK] ${enabledDecls.length} declaração(ões) adicionada(s)`]);
            }

            const result = builder.build();
            setLetterResult(result);
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
    }, [effectiveData, props]);

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

    // ── Restauração de carta salva (suporte v2, v3, v4) ──
    const hasRestoredRef = useRef(false);
    useEffect(() => {
        if (hasRestoredRef.current || !props.letterContent) return;
        try {
            const parsed = JSON.parse(props.letterContent);

            // ── v4: estrutura flat com cockpit + declarações ──
            if (parsed && parsed.v === 4 && Array.isArray(parsed.blocks)) {
                const restored = restoreFromBlocks(parsed.blocks, effectiveData);
                if (restored) {
                    setLetterResult(restored);
                    setStep('review');
                }
                // Restaurar cockpit salvo
                if (parsed.cockpit) {
                    setCockpit(prev => ({
                        ...prev,
                        ...parsed.cockpit,
                    }));
                    hasPrepopulatedCockpitRef.current = true;
                }
                // Restaurar declarações salvas
                if (parsed.declarations && Array.isArray(parsed.declarations)) {
                    setDeclarations(parsed.declarations);
                    hasPrepopulatedDeclRef.current = true;
                }
                hasRestoredRef.current = true;
                return;
            }

            // ── v3: migração automática (usa slot 'inicial' como base) ──
            if (parsed && parsed.v === 3) {
                const sourceBlocks = parsed.inicial?.blocks || parsed.readequada?.blocks;
                if (sourceBlocks) {
                    const restored = restoreFromBlocks(sourceBlocks, effectiveData);
                    if (restored) {
                        setLetterResult(restored);
                        setStep('review');
                    }
                }
                hasRestoredRef.current = true;
                return;
            }

            // ── v2: legado ──
            if (parsed && parsed.v === 2 && Array.isArray(parsed.blocks) && parsed.blocks.length > 0) {
                const restored = restoreFromBlocks(parsed.blocks, effectiveData);
                if (restored) {
                    setLetterResult(restored);
                    setStep('review');
                }
                hasRestoredRef.current = true;
            }
        } catch {
        }
    }, [props.letterContent, effectiveData]);

    // ── Salvar carta (envelope v4 com cockpit) ──
    const handleSave = async () => {
        if (!letterResult) return;

        const envelope = {
            v: 4,
            blocks: letterResult.blocks,
            plainText: letterResult.plainText,
            cockpit,
            declarations,
            sigLegal: props.sigLegal,
            sigTech: props.sigTech,
            sigCompany: props.sigCompany,
            bankData: props.bankData,
        };

        const envelopeStr = JSON.stringify(envelope);
        props.setLetterContent(envelopeStr);
        await props.handleSaveLetter(envelopeStr);
    };

    const handleExport = () => {
        // ── Compliance Guard: executar antes de exportar ──
        if (!complianceResult && letterResult) {
            runCompliance();
            setShowComplianceGuard(true);
            return;
        }
        // Se tem falhas críticas, mostrar modal ao invés de exportar
        if (complianceResult && complianceResult.failCount > 0 && !showComplianceGuard) {
            setShowComplianceGuard(true);
            return;
        }
        doExport();
    };

    const forceExport = () => {
        setShowComplianceGuard(false);
        doExport();
    };

    const runCompliance = useCallback(() => {
        if (!letterResult) return;
        const checker = new ComplianceChecker();
        const result = checker.check({
            blocks: letterResult.blocks,
            data: effectiveData,
            declarations,
            bidding: props.bidding,
            cockpit,
        });
        setComplianceResult(result);
    }, [letterResult, effectiveData, declarations, props.bidding, cockpit]);

    const doExport = () => {
        const isCompositionOnly = selectedExportMode === 'COMPOSITION_ONLY';
        const isFullWithComp = selectedExportMode === 'FULL_WITH_COMPOSITION';
        const isFullWithoutComp = selectedExportMode === 'FULL_WITHOUT_COMPOSITION';
        const effectiveBdi = props.bdi;

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
                isReadequada: false,
            });
            return;
        }

        const baseMode: LetterExportMode = (isFullWithComp || isFullWithoutComp) ? 'FULL' : selectedExportMode;
        const compositionHtml = isFullWithComp
            ? buildCompositionInlineHtml(props.items, effectiveBdi, false)
            : undefined;

        if (letterResult) {
            const exporter = new LetterPdfExporter();
            exporter.export({
                result: letterResult,
                data: effectiveData,
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

    // FIX F3.2: Preview in iframe (no auto-print)
    const handlePreview = () => {
        if (!letterResult) return;
        const effectiveBdi = props.bdi;
        const isFullWithComp = selectedExportMode === 'FULL_WITH_COMPOSITION';
        const baseMode: LetterExportMode = (isFullWithComp || selectedExportMode === 'FULL_WITHOUT_COMPOSITION') ? 'FULL' : selectedExportMode;
        const compositionHtml = isFullWithComp
            ? buildCompositionInlineHtml(props.items, effectiveBdi, false)
            : undefined;

        const exporter = new LetterPdfExporter();
        const html = exporter.buildHtml({
            result: letterResult,
            data: effectiveData,
            items: props.items,
            mode: baseMode === 'COMPOSITION_ONLY' ? 'FULL' : baseMode,
            headerImage: props.headerImage,
            footerImage: props.footerImage,
            headerImageHeight: props.headerImageHeight,
            footerImageHeight: props.footerImageHeight,
            printLandscape: props.printLandscape,
            compositionHtml,
        });
        setPreviewHtml(html);
        setShowPreview(true);
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
        // Data Cockpit
        cockpit, updateCockpit,
        // Declarações
        declarations, toggleDeclaration, addManualDeclaration, removeDeclaration, updateDeclaration,
        // Compliance Guard
        complianceResult, showComplianceGuard, setShowComplianceGuard, runCompliance, forceExport,
        handleValidate,
        handleGenerate,
        handleStartEdit,
        handleSaveEdit,
        handleCancelEdit,
        handleSave,
        handleExport,
        handlePreview,
        previewHtml, showPreview, setShowPreview,
        normalizedData: effectiveData,
    };
}
