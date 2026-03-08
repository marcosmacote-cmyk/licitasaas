import { useState, useMemo } from 'react';
import { Sparkles, Download, Loader2, Scale, ScrollText, AlertCircle, ChevronRight, Copy, Check } from 'lucide-react';
import { jsPDF } from 'jspdf';
import { API_BASE_URL } from '../../config';
import type { BiddingProcess, CompanyProfile } from '../../types';

interface Props {
    biddings: BiddingProcess[];
    companies: CompanyProfile[];
    onSave?: () => void;
}

const PETITION_TYPES = [
    { id: 'impugnacao', label: 'Impugnação ao Edital', law: 'Lei 14.133/2021, Art. 164' },
    { id: 'recurso', label: 'Recurso Administrativo', law: 'Lei 14.133/2021, Art. 165, I' },
    { id: 'contrarrazoes', label: 'Contrarrazões ao Recurso', law: 'Lei 14.133/2021, Art. 165, § 2º' },
    { id: 'esclarecimento', label: 'Pedido de Esclarecimento', law: 'Lei 14.133/2021, Art. 164' },
    { id: 'representacao', label: 'Representação ao TC', law: 'Lei 14.133/2021, Art. 170, IV' },
];

export function PetitionGenerator({ biddings, companies }: Props) {
    const [selectedBiddingId, setSelectedBiddingId] = useState('');
    const [selectedCompanyId, setSelectedCompanyId] = useState('');
    const [petitionTypeId, setPetitionTypeId] = useState('recurso');
    const [factsSummary, setFactsSummary] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [generatedDraft, setGeneratedDraft] = useState('');
    const [isCopied, setIsCopied] = useState(false);

    // Filter biddings in "Recurso" status
    const biddingsInRecurso = useMemo(() =>
        biddings.filter(b => b.status === 'Recurso')
        , [biddings]);

    const handleCopy = () => {
        navigator.clipboard.writeText(generatedDraft);
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
    };

    const handleGenerate = async () => {
        if (!selectedBiddingId || !factsSummary) {
            alert('Por favor, selecione um processo e descreva os fatos.');
            return;
        }

        setIsGenerating(true);
        try {
            const response = await fetch(`${API_BASE_URL}/api/petitions/generate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify({
                    biddingProcessId: selectedBiddingId,
                    companyId: selectedCompanyId,
                    templateType: petitionTypeId,
                    userContext: factsSummary
                })
            });

            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Erro ao gerar petição');
            setGeneratedDraft(data.text);
        } catch (error: any) {
            console.error(error);
            alert(`Erro: ${error.message}`);
        } finally {
            setIsGenerating(false);
        }
    };

    const handleExportPDF = () => {
        const doc = new jsPDF();
        const splitText = doc.splitTextToSize(generatedDraft, 180);
        doc.setFontSize(11);
        doc.text(splitText, 15, 20);
        doc.save(`Peticao_${petitionTypeId}_${Date.now()}.pdf`);
    };

    return (
        <div style={{ display: 'grid', gridTemplateColumns: '400px 1fr', gap: '24px', height: 'calc(100vh - 250px)' }}>
            {/* Left: Configuration */}
            <div className="card" style={{ display: 'flex', flexDirection: 'column', padding: '20px', overflowY: 'auto' }}>
                <div style={{ marginBottom: '20px' }}>
                    <h3 style={{ margin: '0 0 8px 0', fontSize: '1.1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Scale size={20} color="var(--color-primary)" />
                        Mestre de Petições
                    </h3>
                    <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--color-text-tertiary)' }}>
                        Elabore peças fundamentadas na Lei 14.133/2021.
                    </p>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div className="form-group">
                        <label className="form-label" style={{ fontSize: '0.8rem', fontWeight: 600 }}>Selecione o Processo (Coluna Recurso)</label>
                        <select
                            className="form-control"
                            value={selectedBiddingId}
                            onChange={(e) => setSelectedBiddingId(e.target.value)}
                        >
                            <option value="">-- Selecione um processo --</option>
                            {biddingsInRecurso.map(b => (
                                <option key={b.id} value={b.id}>{b.title} ({b.portal})</option>
                            ))}
                        </select>
                        {biddingsInRecurso.length === 0 && (
                            <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: 'var(--color-danger)' }}>
                                <AlertCircle size={12} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
                                Nenhum processo na coluna "Recurso".
                            </p>
                        )}
                    </div>

                    <div className="form-group">
                        <label className="form-label" style={{ fontSize: '0.8rem', fontWeight: 600 }}>Empresa Litigante</label>
                        <select
                            className="form-control"
                            value={selectedCompanyId}
                            onChange={(e) => setSelectedCompanyId(e.target.value)}
                        >
                            <option value="">-- Selecione a empresa --</option>
                            {companies.map(c => (
                                <option key={c.id} value={c.id}>{c.razaoSocial}</option>
                            ))}
                        </select>
                    </div>

                    <div className="form-group">
                        <label className="form-label" style={{ fontSize: '0.8rem', fontWeight: 600 }}>Tipo de Peça</label>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {PETITION_TYPES.map(type => (
                                <div
                                    key={type.id}
                                    onClick={() => setPetitionTypeId(type.id)}
                                    style={{
                                        padding: '10px 12px',
                                        borderRadius: '8px',
                                        border: `1px solid ${petitionTypeId === type.id ? 'var(--color-primary)' : 'var(--color-border)'}`,
                                        background: petitionTypeId === type.id ? 'rgba(37, 99, 235, 0.05)' : 'white',
                                        cursor: 'pointer',
                                        transition: 'all 0.2s ease',
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center'
                                    }}
                                >
                                    <div>
                                        <div style={{ fontSize: '0.85rem', fontWeight: 600, color: petitionTypeId === type.id ? 'var(--color-primary)' : 'var(--color-text-primary)' }}>
                                            {type.label}
                                        </div>
                                        <div style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)' }}>{type.law}</div>
                                    </div>
                                    {petitionTypeId === type.id && <ChevronRight size={14} color="var(--color-primary)" />}
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="form-group">
                        <label className="form-label" style={{ fontSize: '0.8rem', fontWeight: 600 }}>Resumo dos Fatos / Argumentos</label>
                        <textarea
                            className="form-control"
                            style={{ minHeight: '120px', fontSize: '0.85rem' }}
                            placeholder="Descreva aqui os motivos do recurso, irregularidades encontradas ou fatos relevantes..."
                            value={factsSummary}
                            onChange={(e) => setFactsSummary(e.target.value)}
                        />
                    </div>

                    <button
                        className="btn btn-primary"
                        style={{ width: '100%', height: '48px', gap: '8px', fontSize: '0.95rem' }}
                        disabled={isGenerating || !selectedBiddingId || !factsSummary}
                        onClick={handleGenerate}
                    >
                        {isGenerating ? <Loader2 size={20} className="spin" /> : <Sparkles size={20} />}
                        {isGenerating ? 'IA escrevendo petição...' : 'Gerar Minuta com IA'}
                    </button>
                </div>
            </div>

            {/* Right: Draft Preview */}
            <div className="card" style={{ display: 'flex', flexDirection: 'column', padding: '0', overflow: 'hidden' }}>
                <div style={{
                    padding: '16px 24px',
                    borderBottom: '1px solid var(--color-border)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: 'var(--color-bg-secondary)'
                }}>
                    <h3 style={{ margin: 0, fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <ScrollText size={18} color="var(--color-primary)" />
                        Minuta Gerada
                    </h3>
                    <div style={{ display: 'flex', gap: '10px' }}>
                        <button
                            className="btn btn-outline"
                            style={{ padding: '6px 12px', fontSize: '0.85rem' }}
                            disabled={!generatedDraft}
                            onClick={handleCopy}
                        >
                            {isCopied ? <Check size={16} /> : <Copy size={16} />}
                            {isCopied ? 'Copiado!' : 'Copiar Texto'}
                        </button>
                        <button
                            className="btn btn-primary"
                            style={{ padding: '6px 12px', fontSize: '0.85rem', background: '#059669', borderColor: '#059669' }}
                            disabled={!generatedDraft}
                            onClick={handleExportPDF}
                        >
                            <Download size={16} /> Exportar PDF
                        </button>
                    </div>
                </div>

                <div style={{ flex: 1, padding: '24px', overflowY: 'auto', background: 'white' }}>
                    {!generatedDraft && !isGenerating ? (
                        <div style={{
                            height: '100%',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: 'var(--color-text-tertiary)',
                            textAlign: 'center'
                        }}>
                            <ScrollText size={64} style={{ opacity: 0.1, marginBottom: '16px' }} />
                            <p style={{ maxWidth: '300px' }}>
                                Preencha as informações ao lado e clique em <strong>Gerar Minuta</strong> para ver a petição elaborada pela IA.
                            </p>
                        </div>
                    ) : isGenerating ? (
                        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: '24px' }}>
                            <div className="skeleton" style={{ height: '40px', width: '60%' }}></div>
                            <div className="skeleton" style={{ height: '20px', width: '100%' }}></div>
                            <div className="skeleton" style={{ height: '20px', width: '90%' }}></div>
                            <div className="skeleton" style={{ height: '200px', width: '100%' }}></div>
                            <div className="skeleton" style={{ height: '20px', width: '40%' }}></div>
                        </div>
                    ) : (
                        <div style={{ whiteSpace: 'pre-wrap', fontFamily: 'serif', fontSize: '1.1rem', lineHeight: '1.6', color: '#1a1a1a' }}>
                            {generatedDraft}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

