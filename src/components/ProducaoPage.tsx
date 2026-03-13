import { useState } from 'react';
import { DollarSign, FileArchive, Sparkles, Scale, FileOutput } from 'lucide-react';
import type { BiddingProcess, CompanyProfile } from '../types';
import { ProposalGeneratorPage } from './proposals/ProposalGeneratorPage';
import { DossierExporter } from './reports/DossierExporter';
import { AiDeclarationGenerator } from './reports/AiDeclarationGenerator';
import { PetitionGenerator } from './reports/PetitionGenerator';

interface Props {
    biddings: BiddingProcess[];
    companies: CompanyProfile[];
    onRefresh?: () => void;
}

type ProducaoTab = 'proposal' | 'declarations' | 'petitions' | 'dossier';

export function ProducaoPage({ biddings, companies, onRefresh }: Props) {
    const [activeTab, setActiveTab] = useState<ProducaoTab>('proposal');

    const tabs: { key: ProducaoTab; label: string; icon: React.ReactNode }[] = [
        { key: 'proposal', label: 'Proposta de Preços', icon: <DollarSign size={16} /> },
        { key: 'declarations', label: 'Declarações (IA)', icon: <Sparkles size={16} /> },
        { key: 'petitions', label: 'Petições e Recursos', icon: <Scale size={16} /> },
        { key: 'dossier', label: 'Dossiê ZIP', icon: <FileArchive size={16} /> },
    ];

    return (
        <div className="page-container">
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
                    <p className="page-subtitle">Gere propostas, declarações, petições e dossiês para licitações.</p>
                </div>
            </div>

            {/* Tabs */}
            <div style={{
                display: 'flex',
                gap: 'var(--space-1)',
                marginBottom: 'var(--space-6)',
                borderBottom: '1px solid var(--color-border)',
                paddingBottom: '0',
                overflowX: 'auto',
            }}>
                {tabs.map(tab => (
                    <button
                        key={tab.key}
                        onClick={() => setActiveTab(tab.key)}
                        style={{
                            padding: 'var(--space-3) var(--space-4)',
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            fontSize: 'var(--text-md)',
                            fontWeight: activeTab === tab.key ? 'var(--font-semibold)' : 'var(--font-medium)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 'var(--space-2)',
                            color: activeTab === tab.key ? 'var(--color-primary)' : 'var(--color-text-tertiary)',
                            borderBottom: activeTab === tab.key ? '2px solid var(--color-primary)' : '2px solid transparent',
                            transition: 'var(--transition-fast)',
                            marginBottom: '-1px',
                            whiteSpace: 'nowrap',
                        }}
                    >
                        {tab.icon} {tab.label}
                    </button>
                ))}
            </div>

            {/* Content */}
            <div>
                {activeTab === 'proposal' && <ProposalGeneratorPage biddings={biddings} companies={companies} />}
                {activeTab === 'declarations' && <AiDeclarationGenerator biddings={biddings} companies={companies} onSave={onRefresh} />}
                {activeTab === 'petitions' && <PetitionGenerator biddings={biddings} companies={companies} onSave={onRefresh} />}
                {activeTab === 'dossier' && <DossierExporter biddings={biddings} companies={companies} />}
            </div>
        </div>
    );
}
