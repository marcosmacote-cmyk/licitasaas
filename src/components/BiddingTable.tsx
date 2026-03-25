import { format } from 'date-fns';
import { ExternalLink, Edit2, ScanSearch, Building2, SignalHigh } from 'lucide-react';
import type { BiddingProcess, AiAnalysis, CompanyProfile } from '../types';
import { RiskIndicator } from './ui';

interface Props {
    items: BiddingProcess[];
    companies: CompanyProfile[];
    onEditProcess: (process: BiddingProcess) => void;
    analyses: AiAnalysis[];
    onViewAnalysis: (analysis: AiAnalysis, process: BiddingProcess) => void;
    onToggleMonitor?: (id: string) => void;
}

export function BiddingTable({ items, companies, onEditProcess, analyses, onViewAnalysis, onToggleMonitor }: Props) {
    const renderDate = (dateStr?: string) => {
        if (!dateStr) return 'Sem data';
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return 'Data Inválida';
        return format(d, 'dd/MM/yy HH:mm');
    };

    return (
        <div style={{ backgroundColor: 'var(--color-bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
            <div style={{ overflowX: 'auto' }}>
                <table className="table" style={{ width: '100%' }}>
                    <thead>
                        <tr>
                            <th>Título / Objeto</th>
                            <th>Portal</th>
                            <th>Modalidade</th>
                            <th>Fase (Status)</th>
                            <th>Empresa</th>
                            <th>Data Sessão</th>
                            <th>Risco</th>
                            <th>Valor Est.</th>
                            <th>Ações</th>
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
                                    <tr key={item.id} className="table-row-hover" style={{ borderBottom: '1px solid var(--color-border)' }}>
                                        <td onDoubleClick={() => onEditProcess(item)}>
                                            <div style={{ fontWeight: 500 }}>{item.title}</div>
                                            {item.summary && <div className="text-truncate" style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', marginTop: '4px', maxWidth: '300px' }}>{item.summary}</div>}
                                        </td>
                                        <td>
                                            <span className="badge badge-blue">{item.portal}</span>
                                        </td>
                                        <td>{item.modality}</td>
                                        <td>{item.status}</td>
                                        <td>
                                            {item.companyProfileId ? (
                                                <div className="flex-gap" style={{ fontSize: '0.75rem', color: 'var(--color-primary)', fontWeight: 500 }}>
                                                    <Building2 size={12} />
                                                    {companies.find(c => c.id === item.companyProfileId)?.razaoSocial || 'Empresa Desconhecida'}
                                                </div>
                                            ) : (
                                                <span style={{ color: 'var(--color-text-tertiary)', fontSize: '0.75rem' }}>Não definida</span>
                                            )}
                                        </td>
                                        <td>
                                            {renderDate(item.sessionDate)}
                                        </td>
                                        <td>
                                            {item.risk ? <RiskIndicator risk={item.risk} compact /> : <span style={{ color: 'var(--color-text-tertiary)' }}>-</span>}
                                        </td>
                                        <td>
                                            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.estimatedValue)}
                                        </td>
                                        <td>
                                            <div className="flex-gap">
                                                {analysis && (
                                                    <button
                                                        className="icon-btn"
                                                        style={{ color: 'var(--color-ai)', background: 'var(--color-ai-bg)' }}
                                                        onClick={() => onViewAnalysis(analysis, item)}
                                                        title="Ver Relatório da IA"
                                                    >
                                                        <ScanSearch size={16} />
                                                    </button>
                                                )}
                                                 {(() => {
                                                    const p = (item.portal || '').toLowerCase();
                                                    const l = (item.link || '').toLowerCase();
                                                    const isMonitorable = p.includes('pncp') || l.includes('pncp.gov.br')
                                                        || l.includes('cnetmobile') || l.includes('comprasnet') || p.includes('compras') || p.includes('cnet')
                                                        || l.includes('bbmnet') || p.includes('bbmnet')
                                                        || l.includes('bllcompras') || l.includes('bll.org') || p.includes('bll')
                                                        || l.includes('bnccompras') || p.includes('bnc')
                                                        || l.includes('m2atecnologia') || p.includes('m2a');
                                                    if (!isMonitorable) return null;
                                                    const platformName = l.includes('m2atecnologia') || p.includes('m2a') ? 'M2A'
                                                        : l.includes('bbmnet') || p.includes('bbmnet') ? 'BBMNET'
                                                        : l.includes('bllcompras') || p.includes('bll') ? 'BLL'
                                                        : l.includes('bnccompras') || p.includes('bnc') ? 'BNC'
                                                        : p.includes('pncp') || l.includes('pncp') ? 'PNCP'
                                                        : 'ComprasNet';
                                                    return (
                                                        <button
                                                            className="icon-btn"
                                                            style={{ 
                                                                color: item.isMonitored ? 'var(--color-primary)' : 'var(--color-text-tertiary)', 
                                                                background: item.isMonitored ? 'rgba(37, 99, 235, 0.1)' : 'transparent',
                                                                borderRadius: '50%'
                                                            }}
                                                            onClick={() => onToggleMonitor?.(item.id)}
                                                            title={item.isMonitored ? `Monitoramento Ativo (${platformName})` : `Ativar Monitor de Chat (${platformName})`}
                                                        >
                                                            <SignalHigh size={16} className={item.isMonitored ? "pulse-animation" : ""} />
                                                        </button>
                                                    );
                                                })()}
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
