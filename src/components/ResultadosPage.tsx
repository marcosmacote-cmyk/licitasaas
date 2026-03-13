import { useState } from 'react';
import { BarChart3, FileText, Clock } from 'lucide-react';
import type { BiddingProcess, CompanyProfile } from '../types';
import { PerformanceDashboard } from './reports/PerformanceDashboard';
import { BiddingListExporter } from './reports/BiddingListExporter';
import { DocumentExpirationList } from './reports/DocumentExpirationList';

interface Props {
    biddings: BiddingProcess[];
    companies: CompanyProfile[];
}

type ResultadosTab = 'performance' | 'biddingList' | 'expiration';

export function ResultadosPage({ biddings, companies }: Props) {
    const [activeTab, setActiveTab] = useState<ResultadosTab>('performance');

    const tabs: { key: ResultadosTab; label: string; icon: React.ReactNode }[] = [
        { key: 'performance', label: 'Dashboard de Performance', icon: <BarChart3 size={16} /> },
        { key: 'biddingList', label: 'Exportar Lista', icon: <FileText size={16} /> },
        { key: 'expiration', label: 'Validade de Documentos', icon: <Clock size={16} /> },
    ];

    return (
        <div className="page-container">
            {/* Breadcrumb */}
            <div className="breadcrumb">
                <span>Resultados</span>
                <span className="breadcrumb-sep">›</span>
                <span className="breadcrumb-current">{tabs.find(t => t.key === activeTab)?.label}</span>
            </div>

            {/* Page Header */}
            <div className="page-header" style={{ marginBottom: '24px' }}>
                <div>
                    <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{
                            padding: '8px',
                            borderRadius: 'var(--radius-md)',
                            background: 'var(--color-success-bg)',
                            color: 'var(--color-success)',
                            display: 'flex'
                        }}>
                            <BarChart3 size={24} />
                        </div>
                        Resultados
                    </h1>
                    <p className="page-subtitle">Acompanhe métricas de desempenho e exporte relatórios.</p>
                </div>
            </div>

            {/* Tabs */}
            <div style={{
                display: 'flex',
                gap: '4px',
                marginBottom: '24px',
                borderBottom: '1px solid var(--color-border)',
                paddingBottom: '0',
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
                            color: activeTab === tab.key ? 'var(--color-primary)' : 'var(--color-text-tertiary)',
                            borderBottom: activeTab === tab.key ? '2px solid var(--color-primary)' : '2px solid transparent',
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
                {activeTab === 'performance' && <PerformanceDashboard biddings={biddings} />}
                {activeTab === 'biddingList' && <BiddingListExporter biddings={biddings} companies={companies} />}
                {activeTab === 'expiration' && <DocumentExpirationList companies={companies} />}
            </div>
        </div>
    );
}
