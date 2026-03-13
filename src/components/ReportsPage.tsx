import { useState } from 'react';
import { BarChart, FileArchive, Clock, FileText, Sparkles, DollarSign } from 'lucide-react';
import type { BiddingProcess, CompanyProfile } from '../types';
import { PerformanceDashboard } from './reports/PerformanceDashboard';
import { DossierExporter } from './reports/DossierExporter';
import { DocumentExpirationList } from './reports/DocumentExpirationList';
import { BiddingListExporter } from './reports/BiddingListExporter';
import { AiDeclarationGenerator } from './reports/AiDeclarationGenerator';
import { ProposalGeneratorPage } from './proposals/ProposalGeneratorPage';
import { TechnicalOracle } from './reports/TechnicalOracle';
import { PetitionGenerator } from './reports/PetitionGenerator';
import { BrainCircuit, Scale } from 'lucide-react';

interface Props {
    biddings: BiddingProcess[];
    companies: CompanyProfile[];
    onRefresh?: () => void;
}

export function ReportsPage({ biddings, companies, onRefresh }: Props) {
    const [activeTab, setActiveTab] = useState<'dashboard' | 'proposal' | 'exporter' | 'expiration' | 'biddingList' | 'declarations' | 'oracle' | 'petitions'>('dashboard');

    return (
        <div className="page-container">
            <div className="page-header flex-between" style={{ marginBottom: 'var(--space-6)' }}>
                <div>
                    <h1 className="page-title">Relatórios e Inteligência</h1>
                    <p className="page-subtitle">Acompanhe métricas, exporte dossiês e controle validades.</p>
                </div>
            </div>

            <div style={{ display: 'flex', gap: 'var(--space-6)', marginBottom: 'var(--space-6)', borderBottom: '1px solid var(--color-border)' }}>
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
                    onClick={() => setActiveTab('proposal')}
                    style={{
                        ...tabStyle,
                        color: activeTab === 'proposal' ? 'var(--color-ai)' : 'var(--color-text-tertiary)',
                        borderBottom: activeTab === 'proposal' ? '2px solid var(--color-ai)' : '2px solid transparent'
                    }}
                >
                    <DollarSign size={16} /> Proposta de Preços
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
                    onClick={() => setActiveTab('oracle')}
                    style={{
                        ...tabStyle,
                        color: activeTab === 'oracle' ? 'var(--color-success)' : 'var(--color-text-tertiary)',
                        borderBottom: activeTab === 'oracle' ? '2px solid var(--color-success)' : '2px solid transparent'
                    }}
                >
                    <BrainCircuit size={16} /> Oráculo (Acervos)
                </button>
                <button
                    onClick={() => setActiveTab('petitions')}
                    style={{
                        ...tabStyle,
                        color: activeTab === 'petitions' ? 'var(--color-primary)' : 'var(--color-text-tertiary)',
                        borderBottom: activeTab === 'petitions' ? '2px solid var(--color-primary)' : '2px solid transparent'
                    }}
                >
                    <Scale size={16} /> Elaboração de Petições
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
                {activeTab === 'proposal' && <ProposalGeneratorPage biddings={biddings} companies={companies} />}
                {activeTab === 'exporter' && <DossierExporter biddings={biddings} companies={companies} />}
                {activeTab === 'declarations' && <AiDeclarationGenerator biddings={biddings} companies={companies} onSave={onRefresh} />}
                {activeTab === 'oracle' && <TechnicalOracle biddings={biddings} companies={companies} onRefresh={onRefresh} />}
                {activeTab === 'petitions' && <PetitionGenerator biddings={biddings} companies={companies} onSave={onRefresh} />}
                {activeTab === 'expiration' && <DocumentExpirationList companies={companies} />}
                {activeTab === 'biddingList' && <BiddingListExporter biddings={biddings} companies={companies} />}
            </div>
        </div>
    );
}

const tabStyle: React.CSSProperties = {
    padding: 'var(--space-3) var(--space-4)',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 'var(--text-md)',
    fontWeight: 'var(--font-medium)',
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-2)',
    transition: 'var(--transition-fast)',
    outline: 'none'
};
