import { useState } from 'react';
import { BrainCircuit } from 'lucide-react';
import type { BiddingProcess, CompanyProfile } from '../types';
import { TechnicalOracle } from './reports/TechnicalOracle';

interface Props {
    biddings: BiddingProcess[];
    companies: CompanyProfile[];
    onRefresh?: () => void;
}

type InteligenciaTab = 'oracle';

export function InteligenciaPage({ biddings, companies, onRefresh }: Props) {
    const [activeTab, setActiveTab] = useState<InteligenciaTab>('oracle');

    const tabs: { key: InteligenciaTab; label: string; icon: React.ReactNode; description: string }[] = [
        { key: 'oracle', label: 'Oráculo Técnico', icon: <BrainCircuit size={16} />, description: 'Compare exigências técnicas com acervos da empresa' },
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
                            <BrainCircuit size={24} />
                        </div>
                        Inteligência
                    </h1>
                    <p className="page-subtitle">Ferramentas de IA para análise de editais e acervos técnicos.</p>
                </div>
            </div>

            {/* Tabs */}
            <div style={{
                display: 'flex',
                gap: 'var(--space-1)',
                marginBottom: 'var(--space-6)',
                borderBottom: '1px solid var(--color-border)',
                paddingBottom: '0'
            }}>
                {tabs.map(tab => (
                    <button
                        key={tab.key}
                        onClick={() => setActiveTab(tab.key)}
                        style={{
                            padding: '10px 16px',
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            fontSize: 'var(--text-md)',
                            fontWeight: activeTab === tab.key ? 'var(--font-semibold)' : 'var(--font-medium)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            color: activeTab === tab.key ? 'var(--color-ai)' : 'var(--color-text-tertiary)',
                            borderBottom: activeTab === tab.key ? '2px solid var(--color-ai)' : '2px solid transparent',
                            transition: 'all 150ms',
                            marginBottom: '-1px',
                        }}
                    >
                        {tab.icon} {tab.label}
                    </button>
                ))}
            </div>

            {/* Content */}
            <div>
                {activeTab === 'oracle' && <TechnicalOracle biddings={biddings} companies={companies} onRefresh={onRefresh} />}
            </div>
        </div>
    );
}
