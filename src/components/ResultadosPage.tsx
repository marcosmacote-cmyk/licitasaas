import { useState } from 'react';
import { BarChart3, FileText, Clock } from 'lucide-react';
import type { BiddingProcess, CompanyProfile } from '../types';
import { PerformanceDashboard } from './reports/PerformanceDashboard';
import { BiddingListExporter } from './reports/BiddingListExporter';
import { DocumentExpirationList } from './reports/DocumentExpirationList';
import { TabNav } from './ui';

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
            <div className="page-header" style={{ marginBottom: 'var(--space-6)' }}>
                <div>
                    <h1 className="page-title" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                        <div style={{
                            padding: 'var(--space-2)',
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
            <TabNav
                tabs={tabs}
                active={activeTab}
                onChange={(key) => setActiveTab(key as ResultadosTab)}
            />

            {/* Content */}
            <div>
                {activeTab === 'performance' && <PerformanceDashboard biddings={biddings} />}
                {activeTab === 'biddingList' && <BiddingListExporter biddings={biddings} companies={companies} />}
                {activeTab === 'expiration' && <DocumentExpirationList companies={companies} />}
            </div>
        </div>
    );
}
