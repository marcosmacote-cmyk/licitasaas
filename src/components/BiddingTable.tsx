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
        if (!dateStr) return '—';
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return '—';
        return format(d, 'dd/MM/yy HH:mm');
    };
    // Normalize modality names to canonical forms (Lei 14.133/2021)
    const normalizeModality = (raw?: string): string => {
        if (!raw) return 'Não informada';
        const m = raw.toLowerCase().trim();
        if (m.includes('pregão') || m.includes('pregao')) return 'Pregão Eletrônico';
        if (m.includes('concorrência') || m.includes('concorrencia')) return 'Concorrência Eletrônica';
        if (m.includes('diálogo') || m.includes('dialogo')) return 'Diálogo Competitivo';
        if (m.includes('concurso')) return 'Concurso';
        if (m.includes('leilão') || m.includes('leilao')) return 'Leilão';
        if (m.includes('pré-qualificação') || m.includes('pre-qualificacao') || m.includes('pre qualificação')) return 'Procedimento Auxiliar';
        if (m.includes('manifestação de interesse') || m.includes('manifestacao de interesse')) return 'Procedimento Auxiliar';
        if (m.includes('credenciamento')) return 'Credenciamento';
        if (m.includes('dispensa')) return 'Dispensa';
        if (m.includes('inexigibilidade')) return 'Inexigibilidade';
        if (m.includes('licitação eletrônica') || m.includes('licitacao eletronica')) return 'Concorrência Eletrônica';
        // Fallback: capitalize first letter
        return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
    };
    const normalizePortalDisplay = (portal?: string): string => {
        if (!portal) return 'Não informado';
        const p = portal.toLowerCase();
        if (p.includes('compras.gov') || p.includes('comprasnet') || p.includes('cnetmobile') || p.includes('comprasgov')) return 'Compras.gov.br';
        if (p.includes('bll')) return 'BLL';
        if (p.includes('bnc')) return 'BNC';
        if (p.includes('m2a')) return 'M2A';
        if (p.includes('bbmnet')) return 'BBMNet';
        if (p.includes('pncp') && !p.includes('compras')) return 'PNCP';
        if (p.includes('licitamaisbrasil') || p.includes('licita+brasil') || p.includes('licita mais')) return 'Licita+Brasil';
        if (p.includes('bolsa de licitações') || p.includes('bllcompras') || p.includes('blcompras')) return 'BLL';
        if (p.includes('portal de compras')) return 'Portal de Compras';
        if (p.includes('licitações-e') || p.includes('licitacoes-e')) return 'Licitações-e (BB)';
        if (p.includes('bec')) return 'BEC/SP';
        if (portal.length > 30) return portal.substring(0, 27) + '...';
        return portal;
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
                                            <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '320px' }} title={item.title}>{item.title}</div>
                                            {item.summary && <div className="text-truncate" style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', marginTop: '4px', maxWidth: '320px', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }} title={item.summary}>{item.summary}</div>}
                                        </td>
                                        <td>
                                            <span className="badge badge-blue">{normalizePortalDisplay(item.portal)}</span>
                                        </td>
                                        <td>{normalizeModality(item.modality)}</td>
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
