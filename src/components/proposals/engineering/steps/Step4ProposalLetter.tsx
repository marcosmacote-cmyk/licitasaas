/**
 * Step4ProposalLetter.tsx — Carta Proposta para Engenharia (Step 4 do Wizard)
 * 
 * Busca os dados da licitação e empresa a partir do biddingId/proposalId,
 * adapta os EngItems para o formato ProposalItem, e delega ao ProposalLetterWizard
 * existente que já possui os 5 sub-passos internos de geração de carta.
 */
import { useState, useEffect, useCallback } from 'react';
import { FileText, Loader2, AlertTriangle, Building2, Briefcase } from 'lucide-react';
import { ProposalLetterWizard } from '../../letter/ProposalLetterWizard';
import { AiDisclaimerBanner } from '../../../shared/AiDisclaimerBanner';
import type { BiddingProcess, CompanyProfile, PriceProposal, ProposalItem } from '../../../../types';
import type { EngItem, EngineeringConfig } from '../types';
import { isGrouper } from '../types';

const token = () => localStorage.getItem('token') || '';
const hdrs = () => ({ 'Authorization': `Bearer ${token()}`, 'Content-Type': 'application/json' });

interface Props {
    proposalId: string;
    biddingId: string;
    items: EngItem[];
    bdiGlobal: number;
    total: number;
    engineeringConfig: EngineeringConfig;
    onPrev: () => void;
    onNext: () => void;
}

/** Adapta EngItem[] → ProposalItem[] (formato esperado pelo ProposalLetterWizard) */
function adaptItems(items: EngItem[], proposalId: string): ProposalItem[] {
    return items.filter(it => !isGrouper(it.type)).map((it, i) => ({
        id: it.id,
        proposalId,
        itemNumber: it.itemNumber || String(i + 1),
        description: it.description,
        unit: it.unit || 'UN',
        quantity: it.quantity,
        multiplier: 1,
        unitCost: it.unitCost,
        unitPrice: it.unitPrice,
        totalPrice: it.totalPrice,
        sortOrder: i,
    }));
}

export function Step4ProposalLetter({ proposalId, biddingId, items, bdiGlobal, total, engineeringConfig, onPrev, onNext }: Props) {
    const [bidding, setBidding] = useState<BiddingProcess | null>(null);
    const [company, setCompany] = useState<CompanyProfile | null>(null);
    const [proposal, setProposal] = useState<PriceProposal | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Letter state
    const [validityDays, setValidityDays] = useState(60);
    const [signatureMode, setSignatureMode] = useState<'LEGAL' | 'TECH' | 'BOTH'>('BOTH');
    const [headerImage, setHeaderImage] = useState('');
    const [footerImage, setFooterImage] = useState('');
    const [headerImageHeight, setHeaderImageHeight] = useState(80);
    const [footerImageHeight, setFooterImageHeight] = useState(60);
    const [letterContent, setLetterContent] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [isSavingTemplate, setIsSavingTemplate] = useState(false);
    const [printLandscape, setPrintLandscape] = useState(false);
    const [sigLegal, setSigLegal] = useState({ name: '', cpf: '', role: 'Representante Legal' });
    const [sigTech, setSigTech] = useState({ name: '', registration: '', role: 'Responsável Técnico' });
    const [sigCompany, setSigCompany] = useState({ razaoSocial: '', cnpj: '' });
    const [bankData, setBankData] = useState({ bank: '', agency: '', account: '', accountType: 'Corrente', pix: '' });

    // Load bidding + company data
    useEffect(() => {
        setLoading(true); setError(null);
        Promise.all([
            fetch(`/api/biddings/${biddingId}`, { headers: hdrs() }).then(r => r.ok ? r.json() : null),
            fetch(`/api/proposals/detail/${proposalId}`, { headers: hdrs() }).then(r => r.ok ? r.json() : null).catch(() => null),
        ]).then(([biddingData, proposalData]) => {
            if (biddingData) setBidding(biddingData);
            if (proposalData) {
                setProposal(proposalData);
                if (proposalData.company) {
                    const co = proposalData.company;
                    setCompany(co);
                    setSigCompany({ razaoSocial: co.razaoSocial || '', cnpj: co.cnpj || '' });
                    // Timbrado padrão
                    if (co.defaultProposalHeader) setHeaderImage(co.defaultProposalHeader);
                    if (co.defaultProposalFooter) setFooterImage(co.defaultProposalFooter);
                    if (co.defaultProposalHeaderHeight) setHeaderImageHeight(co.defaultProposalHeaderHeight);
                    if (co.defaultProposalFooterHeight) setFooterImageHeight(co.defaultProposalFooterHeight);

                    // ─── 1. Fonte primária: JSON dedicado (defaultSignatureConfig) ───
                    let loadedFromJson = false;
                    if (co.defaultSignatureConfig) {
                        try {
                            const sig = JSON.parse(co.defaultSignatureConfig);
                            if (sig.sigLegal)  { setSigLegal(sig.sigLegal); loadedFromJson = true; }
                            if (sig.sigTech)   { setSigTech(sig.sigTech); loadedFromJson = true; }
                            if (sig.sigCompany) setSigCompany(sig.sigCompany);
                            if (sig.signatureMode) setSignatureMode(sig.signatureMode);
                            if (sig.validityDays) setValidityDays(sig.validityDays);
                            // Bancário: priorizar campos reais se JSON legado vazio
                            if (sig.bankData && (sig.bankData.bank || sig.bankData.pix)) {
                                setBankData(sig.bankData);
                            } else {
                                setBankData({
                                    bank: co.bankName || '',
                                    agency: co.bankAgency || '',
                                    account: co.bankAccount || '',
                                    accountType: co.bankAccountType || 'Corrente',
                                    pix: co.bankPix || '',
                                });
                            }
                        } catch { /* ignore */ }
                    }

                    // ─── 2. Fallback: campos estruturados v2 (sem JSON salvo) ───
                    if (!loadedFromJson) {
                        setSigLegal({
                            name: co.contactName || '',
                            cpf: co.contactCpf || '',
                            role: co.contactCargo || 'Representante Legal',
                        });

                        const techName = co.techName || '';
                        const techReg = co.techRegistration || '';
                        const techTitle = co.techTitle || 'Responsável Técnico';
                        if (techName || techReg) {
                            setSigTech({ name: techName, registration: techReg, role: techTitle });
                        } else if (co.technicalQualification) {
                            const tName = co.technicalQualification.split(',')[0].trim();
                            const regM = co.technicalQualification.match(/((?:CREA|CAU|CRA|CONFEA)[^,]*)/i);
                            setSigTech({ name: tName, registration: regM ? regM[1].trim() : '', role: techTitle });
                        }

                        setBankData({
                            bank: co.bankName || '',
                            agency: co.bankAgency || '',
                            account: co.bankAccount || '',
                            accountType: co.bankAccountType || 'Corrente',
                            pix: co.bankPix || '',
                        });
                    }
                }
                if (proposalData.letterContent) setLetterContent(proposalData.letterContent);
                if (proposalData.headerImage) setHeaderImage(proposalData.headerImage);
                if (proposalData.footerImage) setFooterImage(proposalData.footerImage);
                if (proposalData.signatureMode) setSignatureMode(proposalData.signatureMode);
                if (proposalData.validityDays) setValidityDays(proposalData.validityDays);
            }
            if (!biddingData) setError('Licitação não encontrada');
        }).catch(e => setError(e.message))
          .finally(() => setLoading(false));
    }, [biddingId, proposalId]);

    const handleImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>, setter: (v: string) => void) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => setter(reader.result as string);
        reader.readAsDataURL(file);
    }, []);

    const handleSaveConfig = useCallback(async () => {
        setIsSaving(true);
        try {
            await fetch(`/api/proposals/${proposalId}`, {
                method: 'PATCH', headers: hdrs(),
                body: JSON.stringify({ headerImage, footerImage, headerImageHeight, footerImageHeight, signatureMode, validityDays }),
            });
        } catch { /* best effort */ }
        finally { setIsSaving(false); }
    }, [proposalId, headerImage, footerImage, headerImageHeight, footerImageHeight, signatureMode, validityDays]);

    const handleSaveCompanyTemplate = useCallback(async () => {
        if (!company) return;
        setIsSavingTemplate(true);
        try {
            await fetch(`/api/companies/${company.id}`, {
                method: 'PATCH', headers: hdrs(),
                body: JSON.stringify({
                    defaultProposalHeader: headerImage, defaultProposalFooter: footerImage,
                    defaultProposalHeaderHeight: headerImageHeight, defaultProposalFooterHeight: footerImageHeight,
                    defaultSignatureConfig: JSON.stringify({ sigLegal, sigTech, sigCompany, bankData, signatureMode, validityDays }),
                }),
            });
        } catch { /* best effort */ }
        finally { setIsSavingTemplate(false); }
    }, [company, headerImage, footerImage, headerImageHeight, footerImageHeight, sigLegal, sigTech, sigCompany, bankData, signatureMode, validityDays]);

    const handleSaveLetter = useCallback(async (contentOverride?: string) => {
        setIsSaving(true);
        try {
            await fetch(`/api/proposals/${proposalId}`, {
                method: 'PATCH', headers: hdrs(),
                body: JSON.stringify({ letterContent: contentOverride || letterContent }),
            });
            if (contentOverride) setLetterContent(contentOverride);
        } catch { /* best effort */ }
        finally { setIsSaving(false); }
    }, [proposalId, letterContent]);

    const handlePrintProposal = useCallback((type: 'FULL' | 'LETTER' | 'SPREADSHEET') => {
        window.print();
    }, []);

    // Loading / Error states
    if (loading) {
        return (
            <div style={{ padding: 48, textAlign: 'center', background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }}>
                <Loader2 size={32} className="spin" style={{ margin: '0 auto 12px', color: 'var(--color-primary)' }} />
                <p style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)' }}>Carregando dados da licitação...</p>
            </div>
        );
    }

    if (error || !bidding) {
        return (
            <div style={{ padding: 48, textAlign: 'center', background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }}>
                <AlertTriangle size={32} style={{ margin: '0 auto 12px', color: 'var(--color-warning)' }} />
                <p style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--color-warning)' }}>{error || 'Dados insuficientes'}</p>
                <p style={{ fontSize: '0.8rem', color: 'var(--color-text-tertiary)' }}>Certifique-se de que a licitação e empresa foram selecionadas na página principal.</p>
            </div>
        );
    }

    // Build minimal proposal object if backend didn't return one
    const effectiveProposal: PriceProposal = proposal || {
        id: proposalId, tenantId: '', biddingProcessId: biddingId,
        companyProfileId: company?.id || '', version: 1, status: 'RASCUNHO',
        bdiPercentage: bdiGlobal, taxPercentage: 0, socialCharges: 0,
        totalValue: total, signatureMode, validityDays,
        letterContent, headerImage, footerImage,
        headerImageHeight, footerImageHeight,
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        items: adaptItems(items, proposalId),
    };

    const effectiveCompany: CompanyProfile = company || {
        id: '', cnpj: '', razaoSocial: 'Empresa não selecionada', isHeadquarters: true,
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {/* Info banner */}
            <div style={{
                display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px',
                background: 'linear-gradient(135deg, rgba(37,99,235,0.04), rgba(139,92,246,0.03))',
                borderRadius: 'var(--radius-md)', border: '1px solid rgba(37,99,235,0.1)',
                fontSize: '0.8rem', color: 'var(--color-text-secondary)',
            }}>
                <Briefcase size={14} color="var(--color-primary)" />
                <span><strong>{bidding.title?.substring(0, 80)}</strong></span>
                <span style={{ width: 1, height: 14, background: 'var(--color-border)' }} />
                <Building2 size={14} color="var(--color-primary)" />
                <span>{effectiveCompany.razaoSocial}</span>
                <span style={{ width: 1, height: 14, background: 'var(--color-border)' }} />
                <span style={{ fontWeight: 600, color: 'var(--color-primary)' }}>{items.filter(it => !isGrouper(it.type)).length} itens</span>
            </div>

            {/* AI Disclaimer */}
            <AiDisclaimerBanner variant="proposal" compact />

            {/* Embedded ProposalLetterWizard */}
            <ProposalLetterWizard
                bidding={bidding}
                company={effectiveCompany}
                proposal={effectiveProposal}
                items={adaptItems(items, proposalId)}
                totalValue={total}
                validityDays={validityDays}
                signatureMode={signatureMode}
                bdi={bdiGlobal}
                discount={0}
                headerImage={headerImage}
                footerImage={footerImage}
                headerImageHeight={headerImageHeight}
                footerImageHeight={footerImageHeight}
                setValidityDays={setValidityDays}
                setSignatureMode={setSignatureMode}
                setHeaderImage={setHeaderImage}
                setFooterImage={setFooterImage}
                setHeaderImageHeight={setHeaderImageHeight}
                setFooterImageHeight={setFooterImageHeight}
                handleImageUpload={handleImageUpload}
                handleSaveConfig={handleSaveConfig}
                handleSaveCompanyTemplate={handleSaveCompanyTemplate}
                isSavingTemplate={isSavingTemplate}
                letterContent={letterContent}
                setLetterContent={setLetterContent}
                handleSaveLetter={handleSaveLetter}
                handlePrintProposal={handlePrintProposal}
                isSaving={isSaving}
                printLandscape={printLandscape}
                setPrintLandscape={setPrintLandscape}
                sigLegal={sigLegal}
                setSigLegal={setSigLegal}
                sigTech={sigTech}
                setSigTech={setSigTech}
                sigCompany={sigCompany}
                setSigCompany={setSigCompany}
                bankData={bankData}
                setBankData={setBankData}
                hideExportStep={true}
                onFinish={onNext}
            />

            {/* Step navigation */}
            <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '12px 0', borderTop: '1px solid var(--color-border)', marginTop: 8,
            }}>
                <button className="btn btn-outline" onClick={onPrev}
                    style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 20px' }}>
                    ← Voltar: Cronograma
                </button>
                {/* Botão Próximo removido: o ProposalLetterWizard possui seu próprio botão "Salvar e Concluir" que salva o estado interno antes de avançar. */}
                <div />
            </div>
        </div>
    );
}
