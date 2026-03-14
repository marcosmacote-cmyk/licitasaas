import { useState, useEffect, useMemo } from 'react';
import { DollarSign, FolderArchive, Cpu, Gavel, FileOutput } from 'lucide-react';
import type { BiddingProcess, CompanyProfile } from '../types';
import { ProposalGeneratorPage } from './proposals/ProposalGeneratorPage';
import { DossierExporter } from './reports/DossierExporter';
import { AiDeclarationGenerator } from './reports/AiDeclarationGenerator';
import { PetitionGenerator } from './reports/PetitionGenerator';
import { TabNav } from './ui';
import { BackToHubBanner } from './ui/BackToHubBanner';
import { GovernanceBlockedBanner } from './ui/GovernanceBlockedBanner';
import { resolveStage, isModuleAllowed, type SystemModule } from '../governance';

interface Props {
    biddings: BiddingProcess[];
    companies: CompanyProfile[];
    onRefresh?: () => void;
    initialContext?: { subTab?: string; processId?: string; hubOriginId?: string } | null;
    onContextConsumed?: () => void;
    onReturnToHub?: (processId: string) => void;
}

type ProducaoTab = 'proposal' | 'declarations' | 'petitions' | 'dossier';

export function ProducaoPage({ biddings, companies, onRefresh, initialContext, onContextConsumed, onReturnToHub }: Props) {
    const [activeTab, setActiveTab] = useState<ProducaoTab>(
        initialContext?.subTab && ['proposal', 'declarations', 'petitions', 'dossier'].includes(initialContext.subTab)
            ? initialContext.subTab as ProducaoTab
            : 'proposal'
    );
    const [initialProcessId] = useState<string | undefined>(initialContext?.processId);
    const [hubOriginId] = useState<string | undefined>(initialContext?.hubOriginId);
    const hubProcess = hubOriginId ? biddings.find(b => b.id === hubOriginId) : undefined;

    // Consume context on mount
    useEffect(() => {
        if (initialContext) {
            onContextConsumed?.();
        }
    }, []);

    const tabs: { key: ProducaoTab; label: string; icon: React.ReactNode }[] = [
        { key: 'proposal', label: 'Proposta de Preços', icon: <DollarSign size={16} /> },
        { key: 'declarations', label: 'Declarações (IA)', icon: <Cpu size={16} /> },
        { key: 'petitions', label: 'Petições e Recursos', icon: <Gavel size={16} /> },
        { key: 'dossier', label: 'Dossiê ZIP', icon: <FolderArchive size={16} /> },
    ];

    const tabMeta: Record<ProducaoTab, { color: string; desc: string }> = {
        proposal:     { color: 'var(--color-primary)',   desc: 'Elabore e precifique propostas com suporte da IA' },
        declarations: { color: 'var(--color-ai)',        desc: 'Gere declarações formais a partir do edital analisado' },
        petitions:    { color: 'var(--color-warning)',   desc: 'Redija petições e recursos com inteligência jurídica especializada' },
        dossier:      { color: 'var(--color-urgency)',   desc: 'Monte o dossiê de habilitação e exporte o pacote ZIP' },
    };
    const meta = tabMeta[activeTab];

    // ── Governance blocking ──
    const TAB_MODULE_MAP: Record<ProducaoTab, SystemModule> = {
        proposal: 'production-proposal',
        declarations: 'production-declaration',
        petitions: 'production-petition',
        dossier: 'production-dossier',
    };

    const isBlocked = useMemo(() => {
        if (!hubProcess) return false;
        const stage = resolveStage(hubProcess.status);
        const module = TAB_MODULE_MAP[activeTab];
        return !isModuleAllowed(stage, hubProcess.substage, module);
    }, [hubProcess, activeTab]);

    return (
        <div className="page-container">
            {/* Back to Hub */}
            {hubOriginId && onReturnToHub && (
                <BackToHubBanner
                    processTitle={hubProcess?.title}
                    onReturn={() => onReturnToHub(hubOriginId)}
                />
            )}

            {/* Breadcrumb */}
            <div className="breadcrumb">
                <span>Produção</span>
                <span className="breadcrumb-sep">›</span>
                <span className="breadcrumb-current">{tabs.find(t => t.key === activeTab)?.label}</span>
            </div>

            {/* Page Header */}
            <div className="page-header" style={{ marginBottom: 'var(--space-6)' }}>
                <div>
                    <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                        <div style={{
                            padding: 'var(--space-2)',
                            borderRadius: 'var(--radius-md)',
                            background: 'var(--color-urgency-bg)',
                            color: 'var(--color-urgency)',
                            display: 'flex'
                        }}>
                            <FileOutput size={24} />
                        </div>
                        Produção Documental
                    </h1>
                    <p className="page-subtitle" style={{ marginBottom: 0 }}>{meta.desc}</p>
                </div>
            </div>

            {/* Tabs */}
            <TabNav
                tabs={tabs.map(t => ({ key: t.key, label: t.label, icon: t.icon }))}
                active={activeTab}
                onChange={(key) => setActiveTab(key as ProducaoTab)}
            />

            {/* Content — blocked by governance? */}
            {isBlocked && hubProcess ? (
                <div style={{ marginTop: 'var(--space-4)' }}>
                    <GovernanceBlockedBanner
                        processStatus={hubProcess.status}
                        substage={hubProcess.substage}
                        module={TAB_MODULE_MAP[activeTab]}
                        processTitle={hubProcess.title}
                        onGoToHub={onReturnToHub ? () => onReturnToHub(hubOriginId!) : undefined}
                    />
                </div>
            ) : (
                <div>
                    {activeTab === 'proposal' && <ProposalGeneratorPage biddings={biddings} companies={companies} initialBiddingId={initialProcessId} />}
                    {activeTab === 'declarations' && <AiDeclarationGenerator biddings={biddings} companies={companies} onSave={onRefresh} initialBiddingId={initialProcessId} />}
                    {activeTab === 'petitions' && <PetitionGenerator biddings={biddings} companies={companies} onSave={onRefresh} initialBiddingId={initialProcessId} />}
                    {activeTab === 'dossier' && <DossierExporter biddings={biddings} companies={companies} initialBiddingId={initialProcessId} />}
                </div>
            )}
        </div>
    );
}

