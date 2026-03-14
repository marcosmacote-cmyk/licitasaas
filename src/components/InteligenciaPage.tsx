import { useState, useEffect } from 'react';
import { ScanSearch } from 'lucide-react';
import type { BiddingProcess, CompanyProfile } from '../types';
import { TechnicalOracle } from './reports/TechnicalOracle';
import { TabNav } from './ui';

interface Props {
    biddings: BiddingProcess[];
    companies: CompanyProfile[];
    onRefresh?: () => void;
    initialProcessId?: string;
    onContextConsumed?: () => void;
}

type InteligenciaTab = 'oracle';

export function InteligenciaPage({ biddings, companies, onRefresh, initialProcessId, onContextConsumed }: Props) {
    const [activeTab, setActiveTab] = useState<InteligenciaTab>('oracle');

    useEffect(() => {
        if (initialProcessId) {
            onContextConsumed?.();
        }
    }, [initialProcessId]);

    const tabs: { key: InteligenciaTab; label: string; icon: React.ReactNode; description: string }[] = [
        { key: 'oracle', label: 'Oráculo Técnico', icon: <ScanSearch size={16} />, description: 'Compare exigências técnicas com acervos da empresa' },
    ];

    return (
        <div className="page-container">
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

            {/* Content */}
            <div>
                {activeTab === 'oracle' && <TechnicalOracle biddings={biddings} companies={companies} onRefresh={onRefresh} initialBiddingId={initialProcessId} />}
            </div>
        </div>
    );
}
