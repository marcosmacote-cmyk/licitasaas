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
import { toTitleCasePt, toSentenceCasePt, normalizeDeclarationContent } from './utils/textFormatting';

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
    proposalTitle: 'PROPOSTA DE PREÇOS INICIAL',
    executionDeadline: '',
    contractDuration: '',
    executionLocation: '',
    proposalDate: '',
    proposalType: 'INITIAL',
};

const _dummy = 0; // spacer

// ── Helper: restaura blocos salvos com pricing atualizado ──
function restoreFromBlocks(blocks: LetterBlock[], nd: any): ProposalLetterResult | null {
    if (!Array.isArray(blocks) || blocks.length === 0) return null;
    const builder = new ProposalLetterBuilder(nd);
    const freshResult = builder.build();
    const freshPricing = freshResult.blocks.find((b: LetterBlock) => b.id === LetterBlockType.PRICING_SUMMARY);
    const restoredBlocks = blocks.map((b: LetterBlock) => {
        let content = b.content;
        if (b.id === LetterBlockType.COMMERCIAL) {
            // Padronização e normalização de declarações antigas salvas em banco
            if (content.startsWith('Que na elaboração')) {
                content = content.replace(/^Que na elaboração/, 'Declaramos que, na elaboração');
            } else if (content.startsWith('Que, na elaboração')) {
                content = content.replace(/^Que, na elaboração/, 'Declaramos que, na elaboração');
            }
        }
        return b.id === LetterBlockType.PRICING_SUMMARY && freshPricing 
            ? { ...b, content: freshPricing.content } 
            : { ...b, content };
    });
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
                    next.proposalTitle = 'PROPOSTA DE PREÇOS INICIAL';
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
            const declsFromEdital: ProposalDeclaration[] = types.map((t, i) => {
                const colonIdx = t.indexOf(':');
                let rawTitle = t;
                let rawBody = '';
                if (colonIdx !== -1) {
                    rawTitle = t.substring(0, colonIdx).trim();
                    rawBody = t.substring(colonIdx + 1).trim();
                } else if (t.length > 60) {
                    const words = t.split(/\s+/);
                    let titleWords = [];
                    let titleLen = 0;
                    for (const word of words) {
                        if (titleLen + word.length > 40 || titleWords.length >= 6) break;
                        titleWords.push(word);
                        titleLen += word.length + 1;
                    }
                    rawTitle = titleWords.join(' ');
                    rawBody = t;
                }

                const title = toTitleCasePt(rawTitle);
                const body = normalizeDeclarationContent(title, rawBody);

                return {
                    id: `edital_${i}`,
                    title,
                    content: body,
                    source: 'edital' as const,
                    enabled: false,  // starts unchecked — user activates
                };
            });
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
            setGenerationProgress(prev => [...prev, '[IA] Solicitando redação IA para blocos variáveis e declarações...']);
            const token = localStorage.getItem('token');
            const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

            let aiBlocks: Record<string, string> = {};
            let latestDeclarations = [...declarations];
            try {
                const aiRes = await fetch(`${API_BASE_URL}/api/proposals/ai-letter-blocks`, {
                    method: 'POST', headers,
                    body: JSON.stringify({
                        biddingProcessId: props.bidding.id,
                        companyId: props.company.id,
                        requestedBlocks: ['objectBlock', 'executionBlock', 'commercialExtras'],
                        declarations: declarations.filter(d => d.enabled).map(d => ({ id: d.id, title: d.title, content: d.content })),
                    }),
                });
                if (aiRes.ok) {
                    const aiData: AiLetterBlocksResponse & { correctedDeclarations?: any[]; timings?: Record<string, number>; totalMs?: number } = await aiRes.json();
                    aiBlocks = aiData.blocks || {};
                    if (aiData.correctedDeclarations && Array.isArray(aiData.correctedDeclarations)) {
                        latestDeclarations = declarations.map(d => {
                            const corrected = aiData.correctedDeclarations!.find((c: any) => c.id === d.id);
                            if (corrected) {
                                return { ...d, title: corrected.title, content: corrected.content };
                            }
                            return d;
                        });
                        setDeclarations(latestDeclarations);
                        setGenerationProgress(prev => [...prev, `[OK] ${aiData.correctedDeclarations!.length} declaração(ões) corrigida(s) gramaticalmente por IA`]);
                    }
                    const timings = aiData.timings || {};
                    Object.entries(timings).forEach(([k, ms]) => {
                        if (k !== 'correctedDeclarations') {
                            setGenerationProgress(prev => [...prev, `[OK] ${k} redigido (${(ms / 1000).toFixed(1)}s)`]);
                        }
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
            const enabledDecls = latestDeclarations.filter(d => d.enabled);
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
    }, [effectiveData, props, declarations]);

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

        // Se for uma declaração extra, atualizar o estado 'declarations' também
        const declExtraPrefix = `${LetterBlockType.DECLARATION_EXTRA}_`;
        if (editingBlockId.startsWith(declExtraPrefix)) {
            const declId = editingBlockId.substring(declExtraPrefix.length);
            const blockContent = editBuffer;
            setDeclarations(prev => prev.map(d => d.id === declId ? { ...d, content: blockContent } : d));
        }

        setLetterResult({ ...letterResult, blocks: updatedBlocks, plainText });
        props.setLetterContent(plainText);
        setEditingBlockId(null);
    };

    const handleCancelEdit = () => {
        setEditingBlockId(null);
        setEditBuffer('');
    };

    // ── Sincronização reativa de declarações com os blocos da carta ──
    useEffect(() => {
        if (!letterResult) return;

        const blocks = [...letterResult.blocks];
        const declExtraPrefix = `${LetterBlockType.DECLARATION_EXTRA}_`;
        
        // 1. Filtrar blocos de declaração que foram desabilitados ou removidos
        let updatedBlocks = blocks.filter(b => {
            if (!b.id.startsWith(declExtraPrefix)) return true;
            const declId = b.id.substring(declExtraPrefix.length);
            const decl = declarations.find(d => d.id === declId);
            return decl && decl.enabled;
        });

        // 2. Mapear/atualizar ou adicionar as declarações habilitadas
        const enabledDecls = declarations.filter(d => d.enabled);
        const commercialIdx = updatedBlocks.findIndex(b => b.id === LetterBlockType.COMMERCIAL);
        
        const newDeclBlocks = enabledDecls.map(decl => {
            const blockId = `${LetterBlockType.DECLARATION_EXTRA}_${decl.id}`;
            const existingBlock = updatedBlocks.find(b => b.id === blockId);
            
            const content = normalizeDeclarationContent(decl.title, decl.content || '');
            
            if (existingBlock) {
                if (existingBlock.content === content && existingBlock.label === decl.title) {
                    return existingBlock;
                }
                return {
                    ...existingBlock,
                    label: decl.title || 'Declaração Extra',
                    content,
                };
            } else {
                return {
                    id: blockId,
                    type: LetterBlockType.DECLARATION_EXTRA,
                    label: decl.title || 'Declaração Extra',
                    required: false,
                    editable: true,
                    aiGenerated: false,
                    content,
                    order: 0,
                    visible: true,
                    validationStatus: 'valid' as const,
                };
            }
        });

        // 3. Verificar se houve alteração real para evitar loops
        const currentDeclBlocks = updatedBlocks.filter(b => b.id.startsWith(declExtraPrefix));
        const hasChanged = newDeclBlocks.length !== currentDeclBlocks.length ||
            newDeclBlocks.some((nb, i) => {
                const cb = currentDeclBlocks[i];
                return !cb || cb.id !== nb.id || cb.content !== nb.content || cb.label !== nb.label;
            });

        if (hasChanged) {
            // Remover antigas declarações
            updatedBlocks = updatedBlocks.filter(b => !b.id.startsWith(declExtraPrefix));
            // Inserir novas declarações logo após o bloco comercial
            const insertIdx = commercialIdx !== -1 ? commercialIdx + 1 : 0;
            updatedBlocks.splice(insertIdx, 0, ...newDeclBlocks);
            
            // Reordenar os blocos
            updatedBlocks.forEach((b, idx) => {
                b.order = idx;
            });

            const plainText = updatedBlocks.filter(b => b.visible).map(b => b.content).join('\n\n');
            
            setLetterResult(prev => {
                if (!prev) return null;
                return {
                    ...prev,
                    blocks: updatedBlocks,
                    plainText,
                };
            });
            
            // Sincronizar o envelope salvo no componente pai se for JSON
            try {
                const isJson = props.letterContent && props.letterContent.trim().startsWith('{');
                if (isJson) {
                    const envelope = {
                        v: 4,
                        blocks: updatedBlocks,
                        plainText,
                        cockpit,
                        declarations,
                        sigLegal: props.sigLegal,
                        sigTech: props.sigTech,
                        sigCompany: props.sigCompany,
                        bankData: props.bankData,
                    };
                    props.setLetterContent(JSON.stringify(envelope));
                } else {
                    props.setLetterContent(plainText);
                }
            } catch {
                props.setLetterContent(plainText);
            }
        }
    }, [declarations, letterResult, cockpit, props.sigLegal, props.sigTech, props.sigCompany, props.bankData, props.letterContent, props.setLetterContent]);


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
