import { useState, useEffect } from 'react';
import { ScanSearch, LayoutDashboard } from 'lucide-react';
import type { BiddingProcess, CompanyProfile } from '../types';
import { TechnicalOracle } from './reports/TechnicalOracle';
import { InteligenciaDashboard } from './reports/InteligenciaDashboard';
import { TabNav } from './ui';
import { BackToHubBanner } from './ui/BackToHubBanner';
import { GovernanceBlockedBanner } from './ui/GovernanceBlockedBanner';
import { resolveStage, isModuleAllowed } from '../governance';

interface Props {
    biddings: BiddingProcess[];
    companies: CompanyProfile[];
    onRefresh?: () => void;
    initialProcessId?: string;
    hubOriginId?: string;
    onContextConsumed?: () => void;
    onReturnToHub?: (processId: string) => void;
}

type InteligenciaTab = 'dashboard' | 'oracle';

export function InteligenciaPage({ biddings, companies, onRefresh, initialProcessId, hubOriginId, onContextConsumed, onReturnToHub }: Props) {
    const [activeTab, setActiveTab] = useState<InteligenciaTab>(
        initialProcessId ? 'oracle' : 'dashboard'
    );

    useEffect(() => {
        if (initialProcessId) {
            onContextConsumed?.();
        }
    }, [initialProcessId]);

    const tabs: { key: InteligenciaTab; label: string; icon: React.ReactNode; description: string }[] = [
        { key: 'dashboard', label: 'Visão Geral', icon: <LayoutDashboard size={16} />, description: 'Estatísticas e visão geral de inteligência técnica' },
        { key: 'oracle', label: 'Oráculo Técnico', icon: <ScanSearch size={16} />, description: 'Compare exigências técnicas com acervos da empresa' },
    ];

    const hubProcess = hubOriginId ? biddings.find(b => b.id === hubOriginId) : undefined;

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
                <span>Inteligência</span>
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
                            background: 'var(--color-ai-bg)',
                            color: 'var(--color-ai)',
                            display: 'flex'
                        }}>
                            <ScanSearch size={24} />
                        </div>
                        Inteligência
                    </h1>
                    <p className="page-subtitle">Ferramentas de IA para análise de editais e acervos técnicos.</p>
                </div>
            </div>

            {/* Tabs */}
            <TabNav
                tabs={tabs.map(t => ({ key: t.key, label: t.label, icon: t.icon }))}
                active={activeTab}
                onChange={(key) => setActiveTab(key as InteligenciaTab)}
                color="var(--color-ai)"
            />

            {/* Content — governance check */}
            {(() => {
                if (activeTab === 'dashboard') {
                    return <InteligenciaDashboard onNavigateToOracle={() => setActiveTab('oracle')} />;
                }

                if (hubProcess) {
                    const stage = resolveStage(hubProcess.status);
                    const module = 'oracle' as const;
                    if (!isModuleAllowed(stage, hubProcess.substage, module)) {
                        return (
                            <div style={{ marginTop: 'var(--space-4)' }}>
                                <GovernanceBlockedBanner
                                    processStatus={hubProcess.status}
                                    substage={hubProcess.substage}
                                    module={module}
                                    processTitle={hubProcess.title}
                                    onGoToHub={onReturnToHub ? () => onReturnToHub(hubOriginId!) : undefined}
                                />
                            </div>
                        );
                    }
                }
                return (
                    <div>
                        {activeTab === 'oracle' && <TechnicalOracle biddings={biddings} companies={companies} onRefresh={onRefresh} initialBiddingId={initialProcessId} />}
                    </div>
                );
            })()}
        </div>
    );
}
