import { useState, useMemo, useEffect } from 'react';
import { API_BASE_URL } from '../../config';
import type { BiddingProcess, CompanyProfile, PriceProposal, ProposalItem } from '../../types';
import { useToast } from '../ui';
import { resolveStage, isModuleAllowed } from '../../governance';
import { calculateItem, calculateTotals } from '../proposals/engine';
import type { RoundingMode } from '../proposals/engine';
import { exportExcelProposal, generateProposalPdf } from '../proposals/exportServices';

interface UseProposalOptions {
    biddings: BiddingProcess[];
    companies: CompanyProfile[];
    initialBiddingId?: string;
}

export function useProposal({ biddings, companies, initialBiddingId }: UseProposalOptions) {
    const toast = useToast();
    const [selectedBiddingId, setSelectedBiddingId] = useState(initialBiddingId || '');
    const [selectedCompanyId, setSelectedCompanyId] = useState('');
    const [proposal, setProposal] = useState<PriceProposal | null>(null);
    const [proposals, setProposals] = useState<PriceProposal[]>([]);
    const [items, setItems] = useState<ProposalItem[]>([]);
    const [bdi, setBdi] = useState(0);
    const [discount, setDiscount] = useState(0);
    const [roundingMode, setRoundingMode] = useState<RoundingMode>('ROUND');
    const [validityDays, setValidityDays] = useState(60);
    const [isLoading, setIsLoading] = useState(false);
    const [isAiLoading, setIsAiLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [editingItemId, setEditingItemId] = useState<string | null>(null);
    const [confirmDeleteItemId, setConfirmDeleteItemId] = useState<string | null>(null);
    const [isBulkEditing, setIsBulkEditing] = useState(false);
    const [showConfig, setShowConfig] = useState(true);
    const [saveMessage, setSaveMessage] = useState('');

    // Tab & letter
    const [activeTab, setActiveTab] = useState<'items' | 'letter'>('items');
    const [letterContent, setLetterContent] = useState('');

    // Config states
    const [headerImage, setHeaderImage] = useState('');
    const [footerImage, setFooterImage] = useState('');
    const [signatureMode, setSignatureMode] = useState<'LEGAL' | 'TECH' | 'BOTH'>('LEGAL');
    const [headerImageHeight, setHeaderImageHeight] = useState(150);
    const [footerImageHeight, setFooterImageHeight] = useState(100);
    const [isSavingTemplate, setIsSavingTemplate] = useState(false);
    const [printLandscape, setPrintLandscape] = useState(false);

    // ── Dados de Assinatura e Bancários (persistem entre abas) ──
    const [sigLegal, setSigLegal] = useState({ name: '', cpf: '', role: 'Representante Legal' });
    const [sigTech, setSigTech] = useState({ name: '', registration: '', role: 'Responsável Técnico' });
    const [sigCompany, setSigCompany] = useState({ razaoSocial: '', cnpj: '' });
    const [bankData, setBankData] = useState({ bank: '', agency: '', account: '', accountType: 'Conta Corrente', pix: '' });

    const token = localStorage.getItem('token');
    const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

    // Filter biddings eligible for proposal module per governance
    const availableBiddings = useMemo(() =>
        biddings.filter(b => {
            const stage = resolveStage(b.status);
            return isModuleAllowed(stage, b.substage, 'production-proposal');
        })
        , [biddings]);

    const selectedBidding = biddings.find(b => b.id === selectedBiddingId);
    const selectedCompany = companies.find(c => c.id === selectedCompanyId);

    // ── Inicializar dados de assinatura/banco quando empresa muda ──
    useEffect(() => {
        if (!selectedCompany) return;
        const co = selectedCompany;

        // ─── 1. Fonte primária: JSON dedicado (defaultSignatureConfig) ───
        let loadedFromJson = false;
        try {
            const raw = co.defaultSignatureConfig;
            if (raw) {
                const cfg = JSON.parse(raw);
                if (cfg.sigLegal)  { setSigLegal(cfg.sigLegal); loadedFromJson = true; }
                if (cfg.sigTech)   { setSigTech(cfg.sigTech); loadedFromJson = true; }
                if (cfg.sigCompany) setSigCompany(cfg.sigCompany);
                if (cfg.bankData)  setBankData(cfg.bankData);
                if (cfg.signatureMode) setSignatureMode(cfg.signatureMode as 'LEGAL' | 'TECH' | 'BOTH');
                if (cfg.validityDays)  setValidityDays(cfg.validityDays);
            }
        } catch { /* ignore */ }

        // ─── 2. Fallback legado: defaultLetterContent JSON ───
        if (!loadedFromJson) {
            try {
                const raw = co.defaultLetterContent;
                if (raw && raw.startsWith('{')) {
                    const cfg = JSON.parse(raw);
                    if (cfg.sigLegal)  { setSigLegal(cfg.sigLegal); loadedFromJson = true; }
                    if (cfg.sigTech)   { setSigTech(cfg.sigTech); loadedFromJson = true; }
                    if (cfg.sigCompany) setSigCompany(cfg.sigCompany);
                    if (cfg.bankData)  setBankData(cfg.bankData);
                    if (cfg.signatureMode) setSignatureMode(cfg.signatureMode as 'LEGAL' | 'TECH' | 'BOTH');
                    if (cfg.validityDays)  setValidityDays(cfg.validityDays);
                }
            } catch { /* ignore */ }
        }

        // ─── 3. Fallback final: campos diretos do BD (primeira vez, sem JSON) ───
        if (!loadedFromJson) {
            setSigLegal({
                name: co.contactName || '',
                cpf: co.contactCpf || '',
                role: 'Representante Legal',
            });
            setSigCompany({
                razaoSocial: co.razaoSocial || '',
                cnpj: co.cnpj || '',
            });
            // Resp. técnico: pega nome até a primeira vírgula
            const techQual = co.technicalQualification || '';
            if (techQual) {
                const techName = techQual.split(',')[0].trim();
                // Registro: qualquer padrão CREA/CAU/CRA/Carteira Profissional
                const regMatch = techQual.match(/((?:CREA|CAU|CRA|CONFEA|Carteira\s+Profissional)[^,]*)/i);
                const techReg = regMatch ? regMatch[1].trim() : '';
                setSigTech({ name: techName, registration: techReg, role: 'Responsável Técnico' });
            } else {
                setSigTech({ name: '', registration: '', role: 'Responsável Técnico' });
            }
            setBankData({ bank: '', agency: '', account: '', accountType: 'Conta Corrente', pix: '' });
        }
    }, [selectedCompany?.id]);

    // Load proposals when bidding changes
    useEffect(() => {
        if (!selectedBiddingId) { setProposals([]); setProposal(null); setItems([]); return; }
        loadProposals();
    }, [selectedBiddingId]);

    const loadProposals = async () => {
        try {
            const res = await fetch(`${API_BASE_URL}/api/proposals/${selectedBiddingId}`, { headers });
            if (res.ok) {
                const data = await res.json();
                setProposals(data);
                if (data.length > 0) {
                    const latest = data[0];
                    setProposal(latest);
                    setItems(latest.items || []);
                    setBdi(latest.bdiPercentage || 0);
                    setDiscount(latest.taxPercentage || 0);
                    setRoundingMode(latest.socialCharges === 1 ? 'TRUNCATE' : 'ROUND');
                    setValidityDays(latest.validityDays || 60);
                    if (latest.companyProfileId) setSelectedCompanyId(latest.companyProfileId);
                    setLetterContent(latest.letterContent || '');
                    setHeaderImage(latest.headerImage || '');
                    setFooterImage(latest.footerImage || '');
                    setSignatureMode(latest.signatureMode || 'LEGAL');
                    setHeaderImageHeight(latest.headerImageHeight || 150);
                    setFooterImageHeight(latest.footerImageHeight || 100);
                }
            }
        } catch (e) {
            console.error('Failed to load proposals', e);
        }
    };

    const handleCreateProposal = async () => {
        if (!selectedBiddingId || !selectedCompanyId) {
            toast.warning('Selecione uma licitação e uma empresa.');
            return;
        }
        setIsLoading(true);
        try {
            const res = await fetch(`${API_BASE_URL}/api/proposals`, {
                method: 'POST', headers,
                body: JSON.stringify({
                    biddingProcessId: selectedBiddingId,
                    companyProfileId: selectedCompanyId,
                    bdiPercentage: bdi,
                    validityDays,
                    headerImage: selectedCompany?.defaultProposalHeader || '',
                    footerImage: selectedCompany?.defaultProposalFooter || '',
                    headerImageHeight: selectedCompany?.defaultProposalHeaderHeight || 80,
                    footerImageHeight: selectedCompany?.defaultProposalFooterHeight || 60,
                }),
            });
            if (res.ok) {
                const data = await res.json();
                setProposal(data);
                setItems(data.items || []);
                setProposals(prev => [data, ...prev]);
                if (selectedCompany) {
                    setHeaderImage(selectedCompany.defaultProposalHeader || '');
                    setFooterImage(selectedCompany.defaultProposalFooter || '');
                    setHeaderImageHeight(selectedCompany.defaultProposalHeaderHeight || 80);
                    setFooterImageHeight(selectedCompany.defaultProposalFooterHeight || 60);
                    if (selectedCompany.defaultLetterContent) {
                        setLetterContent(selectedCompany.defaultLetterContent);
                    }
                }
                showSaveMsg('Proposta criada com sucesso!');
            }
        } catch (e) {
            toast.error('Erro ao criar proposta.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleAiPopulate = async () => {
        if (!selectedBiddingId) return;
        setIsAiLoading(true);
        try {
            const res = await fetch(`${API_BASE_URL}/api/proposals/ai-populate`, {
                method: 'POST', headers,
                body: JSON.stringify({ biddingProcessId: selectedBiddingId }),
            });
            if (res.ok) {
                const data = await res.json();

                // F5: Validate AI items before saving
                const validItems = (data.items || []).filter((it: any) => {
                    if (!it.description || it.description.trim().length < 3) return false;
                    if (typeof it.quantity === 'number' && it.quantity <= 0) return false;
                    return true;
                });

                if (validItems.length === 0) {
                    toast.warning('A IA não encontrou itens válidos neste edital.');
                    return;
                }

                // F4: Preserve multiplier from AI; map referencePrice as unitCost (starting point)
                const prepareItems = (items: any[]) => items.map((it: any) => {
                    const rawItem = {
                        ...it,
                        unitCost: it.referencePrice || it.unitCost || 0,
                        multiplier: it.multiplier || 1,           // F4: preserve AI multiplier
                        multiplierLabel: it.multiplierLabel || '', // F4: preserve label
                        quantity: it.quantity || 1,
                        referencePrice: it.referencePrice || null,
                    };
                    const calc = calculateItem(rawItem, bdi, discount, roundingMode);
                    return { ...rawItem, unitPrice: calc.unitPrice, totalPrice: calc.totalPrice };
                });

                const saveItems = async (proposalId: string) => {
                    const itemsToSave = prepareItems(validItems);
                    const saveRes = await fetch(`${API_BASE_URL}/api/proposals/${proposalId}/items`, {
                        method: 'POST', headers,
                        body: JSON.stringify({ items: itemsToSave, replaceAll: true, roundingMode }),
                    });
                    if (saveRes.ok) {
                        await loadProposals();
                        const src = data.source === 'pncp_planilha' ? ' (via planilha PNCP)' : '';
                        showSaveMsg(`${validItems.length} itens extraídos pela IA${src}!`);
                    }
                };

                if (proposal) {
                    await saveItems(proposal.id);
                } else {
                    await handleCreateProposal();
                    setTimeout(async () => {
                        const latestRes = await fetch(`${API_BASE_URL}/api/proposals/${selectedBiddingId}`, { headers });
                        if (latestRes.ok) {
                            const latestData = await latestRes.json();
                            if (latestData[0]) await saveItems(latestData[0].id);
                        }
                    }, 1000);
                }
            } else {
                const err = await res.json();
                toast.error(err.error || 'Erro ao popular itens com IA.');
            }
        } catch (e) {
            toast.error('Erro ao consultar IA.');
        } finally {
            setIsAiLoading(false);
        }
    };

    const handleAddItem = () => {
        const newItem: ProposalItem = {
            id: `temp-${Date.now()}`,
            proposalId: proposal?.id || '',
            itemNumber: String(items.length + 1),
            description: '',
            unit: 'UN',
            quantity: 1,
            multiplier: 1,
            unitCost: 0,
            unitPrice: 0,
            totalPrice: 0,
            sortOrder: items.length,
        };
        setItems(prev => [...prev, newItem]);
        setIsBulkEditing(true);
    };

    const updateItem = (itemId: string, field: string, value: any) => {
        setItems(prev => prev.map(it => {
            if (it.id !== itemId) return it;
            const updated = { ...it, [field]: value };
            const calc = calculateItem(updated, bdi, discount, roundingMode);
            updated.unitPrice = calc.unitPrice;
            updated.totalPrice = calc.totalPrice;
            return updated;
        }));
    };

    const handleRecalculateAll = () => {
        const updatedItems = items.map(it => {
            const calc = calculateItem(it, bdi, discount, roundingMode);
            return { ...it, unitPrice: calc.unitPrice, totalPrice: calc.totalPrice };
        });
        setItems(updatedItems);
    };

    useEffect(() => {
        if (proposal) handleRecalculateAll();
    }, [bdi, discount, roundingMode]);

    const handleSaveAllItems = async () => {
        if (!proposal) return;
        setIsSaving(true);
        try {
            const res = await fetch(`${API_BASE_URL}/api/proposals/${proposal.id}/items`, {
                method: 'POST', headers,
                body: JSON.stringify({ items, replaceAll: true }),
            });
            if (res.ok) {
                await loadProposals();
                showSaveMsg('Todos os itens foram salvos!');
                setIsBulkEditing(false);
            }
        } catch (e) {
            toast.error('Erro ao salvar os itens.');
        } finally {
            setIsSaving(false);
        }
    };

    const handleSaveCompanyTemplate = async () => {
        if (!selectedCompanyId) {
            toast.warning('Selecione uma empresa primeiro.');
            return;
        }
        setIsSavingTemplate(true);
        try {
            // Config de assinatura/banco → campo dedicado da empresa
            const signatureConfig = {
                sigLegal,
                sigTech,
                sigCompany,
                bankData,
                validityDays,
                signatureMode,
            };
            const templateConfig = {
                letterContent,
                ...signatureConfig,
            };
            const res = await fetch(`${API_BASE_URL}/api/companies/${selectedCompanyId}/proposal-template`, {
                method: 'PUT', headers,
                body: JSON.stringify({
                    headerImage,
                    footerImage,
                    headerHeight: headerImageHeight,
                    footerHeight: footerImageHeight,
                    defaultLetterContent: JSON.stringify(templateConfig),
                    defaultSignatureConfig: JSON.stringify(signatureConfig),
                    contactName: sigLegal.name,
                    contactCpf: sigLegal.cpf,
                })
            });
            if (res.ok) {
                // ── Atualizar o company no array local para que o useEffect não sobrescreva ──
                const idx = companies.findIndex(c => c.id === selectedCompanyId);
                if (idx !== -1) {
                    companies[idx] = {
                        ...companies[idx],
                        defaultSignatureConfig: JSON.stringify(signatureConfig),
                        defaultLetterContent: JSON.stringify(templateConfig),
                        contactName: sigLegal.name,
                        contactCpf: sigLegal.cpf,
                    };
                }
                toast.success('Dados salvos no cadastro da empresa!');
                showSaveMsg('Padrão da empresa salvo!');
            } else {
                const err = await res.json().catch(() => ({ error: 'Erro desconhecido' }));
                toast.error(err.error || 'Erro ao salvar template.');
            }
        } catch (e) {
            toast.error('Erro ao salvar template da empresa.');
        } finally {
            setIsSavingTemplate(false);
        }
    };

    const handleDeleteItem = async (itemId: string) => {
        if (itemId.startsWith('temp-')) {
            setItems(prev => prev.filter(it => it.id !== itemId));
            return;
        }
        if (!proposal) return;
        setConfirmDeleteItemId(itemId);
    };

    const executeDeleteItem = async () => {
        if (!confirmDeleteItemId || !proposal) return;
        const itemId = confirmDeleteItemId;
        setConfirmDeleteItemId(null);
        try {
            await fetch(`${API_BASE_URL}/api/proposals/${proposal.id}/items/${itemId}`, {
                method: 'DELETE', headers,
            });
            await loadProposals();
            showSaveMsg('Item removido.');
        } catch (e) {
            toast.error('Erro ao remover item.');
        }
    };

    const handleSaveConfig = async () => {
        if (!proposal) return;
        setIsSaving(true);
        try {
            await fetch(`${API_BASE_URL}/api/proposals/${proposal.id}`, {
                method: 'PUT', headers,
                body: JSON.stringify({
                    bdiPercentage: bdi,
                    taxPercentage: discount,
                    socialCharges: roundingMode === 'TRUNCATE' ? 1 : 0,
                    validityDays,
                    headerImage,
                    footerImage,
                    headerImageHeight,
                    footerImageHeight,
                    signatureMode
                }),
            });
            await loadProposals();
            showSaveMsg('Configurações salvas!');
        } catch (e) {
            toast.error('Erro ao salvar configurações.');
        } finally {
            setIsSaving(false);
        }
    };

    const showSaveMsg = (msg: string) => {
        setSaveMessage(msg);
        setTimeout(() => setSaveMessage(''), 3000);
    };

    const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>, setter: (v: string) => void) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            if (ev.target?.result) setter(ev.target.result as string);
        };
        reader.readAsDataURL(file);
    };

    const handleExportExcel = () => {
        if (!proposal || items.length === 0) return;
        exportExcelProposal(selectedBiddingId, items, bdi);
    };

    const handleSaveLetter = async (blocks?: any[]) => {
        if (!proposal) return;
        setIsSaving(true);
        try {
            // Se temos blocos estruturados, salvar como JSON envelope
            const contentToSave = blocks && blocks.length > 0
                ? JSON.stringify({ v: 2, blocks, plainText: letterContent })
                : letterContent;
            await fetch(`${API_BASE_URL}/api/proposals/${proposal.id}`, {
                method: 'PUT', headers,
                body: JSON.stringify({ letterContent: contentToSave }),
            });
            showSaveMsg('Carta proposta salva!');
            await loadProposals();
        } catch (e) {
            toast.error('Erro ao salvar carta.');
        } finally {
            setIsSaving(false);
        }
    };

    const handlePrintProposal = (type: 'FULL' | 'LETTER' | 'SPREADSHEET' = 'FULL') => {
        if (!proposal || !selectedBidding || !selectedCompanyId) {
            toast.warning('Carregue os dados da proposta primeiro.');
            return;
        }
        generateProposalPdf(
            selectedBidding, selectedCompany, items, validityDays,
            letterContent, headerImage, footerImage,
            headerImageHeight, footerImageHeight,
            signatureMode, printLandscape, discount, type
        );
    };

    // Totals
    const totalsCalculated = useMemo(() => calculateTotals(items), [items]);
    const { subtotal, total } = totalsCalculated;

    return {
        // Selection
        selectedBiddingId, setSelectedBiddingId,
        selectedCompanyId, setSelectedCompanyId,
        availableBiddings, selectedBidding, selectedCompany,
        // Proposal
        proposal, proposals, items, setItems,
        bdi, setBdi, discount, setDiscount,
        roundingMode, setRoundingMode,
        validityDays, setValidityDays,
        // UI state
        isLoading, isAiLoading, isSaving, isSavingTemplate,
        editingItemId, setEditingItemId,
        confirmDeleteItemId, setConfirmDeleteItemId,
        isBulkEditing, setIsBulkEditing,
        showConfig, setShowConfig,
        saveMessage,
        activeTab, setActiveTab,
        letterContent, setLetterContent,
        // Config
        headerImage, setHeaderImage,
        footerImage, setFooterImage,
        signatureMode, setSignatureMode,
        headerImageHeight, setHeaderImageHeight,
        footerImageHeight, setFooterImageHeight,
        printLandscape, setPrintLandscape,
        // Assinatura e Banco (persistem entre abas)
        sigLegal, setSigLegal,
        sigTech, setSigTech,
        sigCompany, setSigCompany,
        bankData, setBankData,
        // Computed
        subtotal, total,
        // Handlers
        handleCreateProposal, handleAiPopulate,
        handleAddItem, updateItem,
        handleSaveAllItems, handleSaveCompanyTemplate,
        handleDeleteItem, executeDeleteItem,
        handleSaveConfig, handleImageUpload,
        handleExportExcel,
        handleSaveLetter, handlePrintProposal,
    };
}
