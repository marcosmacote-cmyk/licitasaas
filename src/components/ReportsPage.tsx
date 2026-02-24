import { useState } from 'react';
import { BarChart, FileArchive, Clock, FileText, Sparkles } from 'lucide-react';
import type { BiddingProcess, CompanyProfile } from '../types';
import { PerformanceDashboard } from './reports/PerformanceDashboard';
import { DossierExporter } from './reports/DossierExporter';
import { DocumentExpirationList } from './reports/DocumentExpirationList';
import { BiddingListExporter } from './reports/BiddingListExporter';
import { AiDeclarationGenerator } from './reports/AiDeclarationGenerator';

interface Props {
    biddings: BiddingProcess[];
    companies: CompanyProfile[];
    onRefresh?: () => void;
}

export function ReportsPage({ biddings, companies, onRefresh }: Props) {
    const [activeTab, setActiveTab] = useState<'dashboard' | 'exporter' | 'expiration' | 'biddingList' | 'declarations'>('dashboard');

    return (
        <div className="page-container">
            <div className="page-header flex-between" style={{ marginBottom: '24px' }}>
                <div>
                    <h1 className="page-title">Relatórios e Inteligência</h1>
                    <p className="page-subtitle">Acompanhe métricas, exporte dossiês e controle validades.</p>
                </div>
            </div>

            <div style={{ display: 'flex', gap: '24px', marginBottom: '24px', borderBottom: '1px solid var(--color-border)' }}>
                <button
                    onClick={() => setActiveTab('dashboard')}
                    style={{
                        ...tabStyle,
                        color: activeTab === 'dashboard' ? 'var(--color-primary)' : 'var(--color-text-tertiary)',
                        borderBottom: activeTab === 'dashboard' ? '2px solid var(--color-primary)' : '2px solid transparent'
                    }}
                >
                    <BarChart size={16} /> Dashboard de Performance
                </button>
                <button
                    onClick={() => setActiveTab('exporter')}
                    style={{
                        ...tabStyle,
                        color: activeTab === 'exporter' ? 'var(--color-primary)' : 'var(--color-text-tertiary)',
                        borderBottom: activeTab === 'exporter' ? '2px solid var(--color-primary)' : '2px solid transparent'
                    }}
                >
                    <FileArchive size={16} /> Exportador de Dossiê (ZIP)
                </button>
                <button
                    onClick={() => setActiveTab('declarations')}
                    style={{
                        ...tabStyle,
                        color: activeTab === 'declarations' ? 'var(--color-primary)' : 'var(--color-text-tertiary)',
                        borderBottom: activeTab === 'declarations' ? '2px solid var(--color-primary)' : '2px solid transparent'
                    }}
                >
                    <Sparkles size={16} /> Gerador de Declarações (IA)
                </button>
                <button
                    onClick={() => setActiveTab('expiration')}
                    style={{
                        ...tabStyle,
                        color: activeTab === 'expiration' ? 'var(--color-primary)' : 'var(--color-text-tertiary)',
                        borderBottom: activeTab === 'expiration' ? '2px solid var(--color-primary)' : '2px solid transparent'
                    }}
                >
                    <Clock size={16} /> Validade de Documentos
                </button>
                <button
                    onClick={() => setActiveTab('biddingList')}
                    style={{
                        ...tabStyle,
                        color: activeTab === 'biddingList' ? 'var(--color-primary)' : 'var(--color-text-tertiary)',
                        borderBottom: activeTab === 'biddingList' ? '2px solid var(--color-primary)' : '2px solid transparent'
                    }}
                >
                    <FileText size={16} /> Exportar Lista
                </button>
            </div>

            <div style={{ flex: 1 }}>
                {activeTab === 'dashboard' && <PerformanceDashboard biddings={biddings} />}
                {activeTab === 'exporter' && <DossierExporter biddings={biddings} companies={companies} />}
                {activeTab === 'declarations' && <AiDeclarationGenerator biddings={biddings} companies={companies} onSave={onRefresh} />}
                {activeTab === 'expiration' && <DocumentExpirationList companies={companies} />}
                {activeTab === 'biddingList' && <BiddingListExporter biddings={biddings} companies={companies} />}
            </div>
        </div>
    );
}

const tabStyle: React.CSSProperties = {
    padding: '12px 16px',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: '0.95rem',
    fontWeight: 500,
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    transition: 'all 0.2s ease',
    outline: 'none'
};
