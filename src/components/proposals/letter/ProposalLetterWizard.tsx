import React from 'react';
import { Settings, CheckCircle2, Cpu, Edit3, Printer, ChevronRight } from 'lucide-react';
import type { BiddingProcess, CompanyProfile, PriceProposal, ProposalItem } from '../../../types';
import { useProposalWizard } from './useProposalWizard';
import { WizardStepConfig } from './steps/WizardStepConfig';
import { WizardStepValidation } from './steps/WizardStepValidation';
import { WizardStepGeneration } from './steps/WizardStepGeneration';
import { WizardStepReview } from './steps/WizardStepReview';
import { WizardStepExport } from './steps/WizardStepExport';

export interface ProposalLetterWizardProps {
    bidding: BiddingProcess;
    company: CompanyProfile;
    proposal: PriceProposal;
    items: ProposalItem[];
    totalValue: number;
    validityDays: number;
    signatureMode: 'LEGAL' | 'TECH' | 'BOTH';
    bdi: number;
    discount: number;
    headerImage: string;
    footerImage: string;
    headerImageHeight: number;
    footerImageHeight: number;
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
    letterContent: string;
    setLetterContent: (v: string) => void;
    handleSaveLetter: (contentOverride?: string) => void;
    handlePrintProposal: (type: 'FULL' | 'LETTER' | 'SPREADSHEET') => void;
    isSaving: boolean;
    printLandscape?: boolean;
    setPrintLandscape?: (v: boolean) => void;
    sigLegal: { name: string; cpf: string; role: string };
    setSigLegal: (v: { name: string; cpf: string; role: string }) => void;
    sigTech: { name: string; registration: string; role: string };
    setSigTech: (v: { name: string; registration: string; role: string }) => void;
    sigCompany: { razaoSocial: string; cnpj: string };
    setSigCompany: (v: { razaoSocial: string; cnpj: string }) => void;
    bankData: { bank: string; agency: string; account: string; accountType: string; pix: string };
    setBankData: (v: { bank: string; agency: string; account: string; accountType: string; pix: string }) => void;
    adjustedEnabled?: boolean;
    adjustedBdi?: number;
    adjustedDiscount?: number;
    adjustedTotal?: number;
}

const STEPS = [
    { id: 'config',     label: 'Configuração',  icon: <Settings size={16} /> },
    { id: 'validation', label: 'Validação',      icon: <CheckCircle2 size={16} /> },
    { id: 'generation', label: 'Geração',        icon: <Cpu size={16} /> },
    { id: 'review',     label: 'Revisão',        icon: <Edit3 size={16} /> },
    { id: 'export',     label: 'Exportação',     icon: <Printer size={16} /> },
] as const;

export function ProposalLetterWizard(props: ProposalLetterWizardProps) {
    const w = useProposalWizard(props);
    const stepIndex = STEPS.findIndex(s => s.id === w.step);

    return (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {/* ── Step Bar ── */}
            <div style={{
                display: 'flex', background: 'var(--color-bg-elevated)', borderBottom: '1px solid var(--color-border)',
                padding: '0 var(--space-2)',
            }}>
                {STEPS.map((s, i) => {
                    const isActive = s.id === w.step;
                    const isPast = i < stepIndex;
                    const isAccessible = i <= stepIndex || (w.letterResult && i <= 4);
                    return (
                        <button key={s.id}
                            onClick={() => isAccessible && w.setStep(s.id as any)}
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
                {w.step === 'config' && <WizardStepConfig p={props} w={w} />}
                {w.step === 'validation' && <WizardStepValidation p={props} w={w} />}
                {w.step === 'generation' && <WizardStepGeneration p={props} w={w} />}
                {w.step === 'review' && <WizardStepReview p={props} w={w} />}
                {w.step === 'export' && <WizardStepExport p={props} w={w} />}
            </div>
        </div>
    );
}
