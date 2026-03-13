import { useState, lazy, Suspense } from 'react';
import { BarChart, FileArchive, Clock, FileText, Sparkles, DollarSign } from 'lucide-react';
import type { BiddingProcess, CompanyProfile } from '../types';
import { BrainCircuit, Scale, Loader2 } from 'lucide-react';

// ── Lazy-loaded report modules ──
const PerformanceDashboard = lazy(() => import('./reports/PerformanceDashboard').then(m => ({ default: m.PerformanceDashboard })));
const DossierExporter = lazy(() => import('./reports/DossierExporter').then(m => ({ default: m.DossierExporter })));
const DocumentExpirationList = lazy(() => import('./reports/DocumentExpirationList').then(m => ({ default: m.DocumentExpirationList })));
const BiddingListExporter = lazy(() => import('./reports/BiddingListExporter').then(m => ({ default: m.BiddingListExporter })));
const AiDeclarationGenerator = lazy(() => import('./reports/AiDeclarationGenerator').then(m => ({ default: m.AiDeclarationGenerator })));
const ProposalGeneratorPage = lazy(() => import('./proposals/ProposalGeneratorPage').then(m => ({ default: m.ProposalGeneratorPage })));
const TechnicalOracle = lazy(() => import('./reports/TechnicalOracle').then(m => ({ default: m.TechnicalOracle })));
const PetitionGenerator = lazy(() => import('./reports/PetitionGenerator').then(m => ({ default: m.PetitionGenerator })));

function LazyFallback() {
    return (
        <div className="flex-center" style={{ padding: 'var(--space-20)', justifyContent: 'center' }}>
            <Loader2 size={32} className="spinner" color="var(--color-primary)" />
        </div>
    );
}

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

            <div style={{ display: 'flex', gap: 'var(--space-6)', marginBottom: 'var(--space-6)', borderBottom: '1px solid var(--color-border)', overflowX: 'auto' }}>
                <button onClick={() => setActiveTab('dashboard')} className={`tab-btn${activeTab === 'dashboard' ? ' active' : ''}`}>
                    <BarChart size={16} /> Dashboard de Performance
                </button>
                <button onClick={() => setActiveTab('proposal')} className={`tab-btn${activeTab === 'proposal' ? ' active' : ''}`}>
                    <DollarSign size={16} /> Proposta de Preços
                </button>
                <button onClick={() => setActiveTab('exporter')} className={`tab-btn${activeTab === 'exporter' ? ' active' : ''}`}>
                    <FileArchive size={16} /> Exportador de Dossiê (ZIP)
                </button>
                <button onClick={() => setActiveTab('declarations')} className={`tab-btn${activeTab === 'declarations' ? ' active' : ''}`}>
                    <Sparkles size={16} /> Gerador de Declarações (IA)
                </button>
                <button onClick={() => setActiveTab('oracle')} className={`tab-btn${activeTab === 'oracle' ? ' active' : ''}`}>
                    <BrainCircuit size={16} /> Oráculo (Acervos)
                </button>
                <button onClick={() => setActiveTab('petitions')} className={`tab-btn${activeTab === 'petitions' ? ' active' : ''}`}>
                    <Scale size={16} /> Elaboração de Petições
                </button>
                <button onClick={() => setActiveTab('expiration')} className={`tab-btn${activeTab === 'expiration' ? ' active' : ''}`}>
                    <Clock size={16} /> Validade de Documentos
                </button>
                <button onClick={() => setActiveTab('biddingList')} className={`tab-btn${activeTab === 'biddingList' ? ' active' : ''}`}>
                    <FileText size={16} /> Exportar Lista
                </button>
            </div>

            <div style={{ flex: 1 }}>
                <Suspense fallback={<LazyFallback />}>
                    {activeTab === 'dashboard' && <PerformanceDashboard biddings={biddings} />}
                    {activeTab === 'proposal' && <ProposalGeneratorPage biddings={biddings} companies={companies} />}
                    {activeTab === 'exporter' && <DossierExporter biddings={biddings} companies={companies} />}
                    {activeTab === 'declarations' && <AiDeclarationGenerator biddings={biddings} companies={companies} onSave={onRefresh} />}
                    {activeTab === 'oracle' && <TechnicalOracle biddings={biddings} companies={companies} onRefresh={onRefresh} />}
                    {activeTab === 'petitions' && <PetitionGenerator biddings={biddings} companies={companies} onSave={onRefresh} />}
                    {activeTab === 'expiration' && <DocumentExpirationList companies={companies} />}
                    {activeTab === 'biddingList' && <BiddingListExporter biddings={biddings} companies={companies} />}
                </Suspense>
            </div>
        </div>
    );
}
