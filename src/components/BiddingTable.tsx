import { format } from 'date-fns';
import { ExternalLink, Edit2, Brain, Building2 } from 'lucide-react';
import type { BiddingProcess, AiAnalysis, CompanyProfile } from '../types';

interface Props {
    items: BiddingProcess[];
    companies: CompanyProfile[];
    onEditProcess: (process: BiddingProcess) => void;
    analyses: AiAnalysis[];
    onViewAnalysis: (analysis: AiAnalysis, process: BiddingProcess) => void;
}

export function BiddingTable({ items, companies, onEditProcess, analyses, onViewAnalysis }: Props) {
    const renderDate = (dateStr?: string) => {
        if (!dateStr) return 'Sem data';
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return 'Data Inválida';
        return format(d, 'dd/MM/yy HH:mm');
    };

    return (
        <div style={{ backgroundColor: 'var(--color-bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead>
                        <tr style={{ backgroundColor: 'var(--color-bg-surface-hover)', borderBottom: '1px solid var(--color-border)' }}>
                            <th style={thStyle}>Título / Objeto</th>
                            <th style={thStyle}>Portal</th>
                            <th style={thStyle}>Modalidade</th>
                            <th style={thStyle}>Fase (Status)</th>
                            <th style={thStyle}>Empresa</th>
                            <th style={thStyle}>Data Sessão</th>
                            <th style={thStyle}>Risco</th>
                            <th style={thStyle}>Valor Est.</th>
                            <th style={thStyle}>Ações</th>
                        </tr>
                    </thead>
                    <tbody>
                        {items.length === 0 ? (
                            <tr>
                                <td colSpan={9} style={{ padding: '24px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                                    Nenhuma licitação encontrada.
                                </td>
                            </tr>
                        ) : (
                            items.map(item => {
                                const analysis = analyses.find(a => a.biddingProcessId === item.id);
                                return (
                                    <tr key={item.id} style={{ borderBottom: '1px solid var(--color-border)' }} className="table-row-hover">
                                        <td style={tdStyle} onDoubleClick={() => onEditProcess(item)}>
                                            <div style={{ fontWeight: 500 }}>{item.title}</div>
                                            {item.summary && <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', marginTop: '4px', maxWidth: '300px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.summary}</div>}
                                        </td>
                                        <td style={tdStyle}>
                                            <span className="badge badge-blue">{item.portal}</span>
                                        </td>
                                        <td style={tdStyle}>{item.modality}</td>
                                        <td style={tdStyle}>{item.status}</td>
                                        <td style={tdStyle}>
                                            {item.companyProfileId ? (
                                                <div className="flex-gap" style={{ fontSize: '0.75rem', color: 'var(--color-primary)', fontWeight: 500 }}>
                                                    <Building2 size={12} />
                                                    {companies.find(c => c.id === item.companyProfileId)?.razaoSocial || 'Empresa Desconhecida'}
                                                </div>
                                            ) : (
                                                <span style={{ color: 'var(--color-text-tertiary)', fontSize: '0.75rem' }}>Não definida</span>
                                            )}
                                        </td>
                                        <td style={tdStyle}>
                                            {renderDate(item.sessionDate)}
                                        </td>
                                        <td style={tdStyle}>
                                            <RiskBadge risk={item.risk} />
                                        </td>
                                        <td style={tdStyle}>
                                            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.estimatedValue)}
                                        </td>
                                        <td style={tdStyle}>
                                            <div className="flex-gap">
                                                {analysis && (
                                                    <button
                                                        className="icon-btn"
                                                        style={{ color: '#8b5cf6', background: 'rgba(139, 92, 246, 0.1)' }}
                                                        onClick={() => onViewAnalysis(analysis, item)}
                                                        title="Ver Relatório da IA"
                                                    >
                                                        <Brain size={16} />
                                                    </button>
                                                )}
                                                {item.link && (
                                                    <a href={item.link} target="_blank" rel="noreferrer" className="icon-btn" title="Acessar processo">
                                                        <ExternalLink size={16} />
                                                    </a>
                                                )}
                                                <button className="icon-btn" onClick={() => onEditProcess(item)} title="Editar">
                                                    <Edit2 size={16} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

function RiskBadge({ risk }: { risk?: string }) {
    if (!risk) return <span style={{ color: 'var(--color-text-tertiary)' }}>-</span>;
    let colorClass = 'badge-blue';
    if (risk === 'Alto' || risk === 'Crítico') colorClass = 'badge-red';
    if (risk === 'Médio') colorClass = 'badge-orange';
    if (risk === 'Baixo') colorClass = 'badge-green';

    return <span className={`badge ${colorClass}`}>{risk}</span>;
}

const thStyle: React.CSSProperties = {
    padding: '12px 16px',
    fontSize: '0.75rem',
    fontWeight: 600,
    color: 'var(--color-text-secondary)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em'
};

const tdStyle: React.CSSProperties = {
    padding: '16px',
    fontSize: '0.875rem',
    color: 'var(--color-text-primary)',
    verticalAlign: 'middle'
};
