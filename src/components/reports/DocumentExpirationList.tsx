import { useMemo, useState, useCallback } from 'react';
import { AlertTriangle, Clock, ShieldCheck, Building2, Search, AlertCircle, Download, FileSpreadsheet, FileText, Filter, X } from 'lucide-react';
import type { CompanyProfile } from '../../types';
import { API_BASE_URL } from '../../config';
import jsPDF from 'jspdf';

interface Props {
    companies: CompanyProfile[];
}

type DocStatus = 'valid' | 'warning' | 'expired' | 'unknown';

interface DocRow {
    id: string;
    title: string;
    companyName: string;
    companyId: string;
    expirationDate?: string;
    status: DocStatus;
    daysRemaining: number | null;
    url: string;
    docGroup?: string;
}

export function DocumentExpirationList({ companies }: Props) {
    const [searchTerm, setSearchTerm] = useState('');
    const [filterCompany, setFilterCompany] = useState('');
    const [filterStatus, setFilterStatus] = useState<DocStatus | ''>('');
    const [filterDateFrom, setFilterDateFrom] = useState('');
    const [filterDateTo, setFilterDateTo] = useState('');
    const [showFilters, setShowFilters] = useState(false);

    // Build document list
    const allDocuments = useMemo<DocRow[]>(() => {
        const docs: DocRow[] = [];
        const now = new Date();
        now.setHours(0, 0, 0, 0);

        companies.forEach(company => {
            (company.documents || []).forEach(doc => {
                let status: DocStatus = 'unknown';
                let daysRemaining: number | null = null;

                if (doc.expirationDate) {
                    const expDate = new Date(doc.expirationDate);
                    const diffTime = expDate.getTime() - now.getTime();
                    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                    daysRemaining = diffDays;

                    if (diffDays < 0) status = 'expired';
                    else if (diffDays <= (doc.alertDays || 15)) status = 'warning';
                    else status = 'valid';
                }

                docs.push({
                    id: doc.id,
                    title: doc.docType,
                    companyName: company.razaoSocial,
                    companyId: company.id,
                    expirationDate: doc.expirationDate,
                    status,
                    daysRemaining,
                    url: doc.fileUrl,
                    docGroup: doc.docGroup
                });
            });
        });

        return docs.sort((a, b) => {
            const getRank = (s: string) => s === 'expired' ? 0 : s === 'warning' ? 1 : s === 'unknown' ? 2 : 3;
            const rankDiff = getRank(a.status) - getRank(b.status);
            if (rankDiff !== 0) return rankDiff;
            if (a.daysRemaining !== null && b.daysRemaining !== null) return a.daysRemaining - b.daysRemaining;
            return 0;
        });
    }, [companies]);

    // Apply all filters
    const filteredDocuments = useMemo(() => {
        return allDocuments.filter(d => {
            // Search term
            if (searchTerm) {
                const lc = searchTerm.toLowerCase();
                if (!d.title.toLowerCase().includes(lc) && !d.companyName.toLowerCase().includes(lc)) return false;
            }
            // Company filter
            if (filterCompany && d.companyId !== filterCompany) return false;
            // Status filter
            if (filterStatus && d.status !== filterStatus) return false;
            // Date range filters
            if (filterDateFrom && d.expirationDate) {
                if (new Date(d.expirationDate) < new Date(filterDateFrom)) return false;
            }
            if (filterDateTo && d.expirationDate) {
                if (new Date(d.expirationDate) > new Date(filterDateTo)) return false;
            }
            // If date filter is set but doc has no date
            if ((filterDateFrom || filterDateTo) && !d.expirationDate) return false;
            return true;
        });
    }, [allDocuments, searchTerm, filterCompany, filterStatus, filterDateFrom, filterDateTo]);

    // Summary stats
    const stats = useMemo(() => {
        const expired = filteredDocuments.filter(d => d.status === 'expired').length;
        const warning = filteredDocuments.filter(d => d.status === 'warning').length;
        const valid = filteredDocuments.filter(d => d.status === 'valid').length;
        const unknown = filteredDocuments.filter(d => d.status === 'unknown').length;
        return { expired, warning, valid, unknown, total: filteredDocuments.length };
    }, [filteredDocuments]);

    const activeFilterCount = useMemo(() => {
        let c = 0;
        if (filterCompany) c++;
        if (filterStatus) c++;
        if (filterDateFrom) c++;
        if (filterDateTo) c++;
        return c;
    }, [filterCompany, filterStatus, filterDateFrom, filterDateTo]);

    const clearFilters = useCallback(() => {
        setFilterCompany('');
        setFilterStatus('');
        setFilterDateFrom('');
        setFilterDateTo('');
        setSearchTerm('');
    }, []);

    // ── Export CSV ──
    const exportCSV = useCallback(() => {
        const header = ['Status', 'Documento', 'Grupo', 'Empresa', 'Vencimento', 'Dias Restantes'];
        const statusLabel = (s: DocStatus) => s === 'expired' ? 'Vencido' : s === 'warning' ? 'Próx. Vencimento' : s === 'valid' ? 'Válido' : 'Sem Validade';
        const rows = filteredDocuments.map(d => [
            statusLabel(d.status),
            `"${d.title}"`,
            d.docGroup || '-',
            `"${d.companyName}"`,
            d.expirationDate ? new Date(d.expirationDate).toLocaleDateString('pt-BR') : '-',
            d.daysRemaining !== null ? String(d.daysRemaining) : '-'
        ]);

        const bom = '\uFEFF';
        const csv = bom + [header.join(';'), ...rows.map(r => r.join(';'))].join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Validade_Documentos_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }, [filteredDocuments]);

    // ── Export PDF ──
    const exportPDF = useCallback(() => {
        const doc = new jsPDF({ orientation: 'landscape' });
        const pw = doc.internal.pageSize.getWidth();
        const ph = doc.internal.pageSize.getHeight();
        const m = 14;
        const mw = pw - m * 2;
        let y = m;

        // Title
        doc.setFontSize(14);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(30);
        doc.text('Relatório de Validade de Documentos', pw / 2, y, { align: 'center' });
        y += 6;
        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(100);
        doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')} — ${filteredDocuments.length} documentos`, pw / 2, y, { align: 'center' });
        y += 8;

        // Summary bar
        doc.setFillColor(239, 68, 68);
        doc.roundedRect(m, y, 50, 8, 1, 1, 'F');
        doc.setTextColor(255);
        doc.setFontSize(7);
        doc.setFont('helvetica', 'bold');
        doc.text(`${stats.expired} Vencidos`, m + 25, y + 5.5, { align: 'center' });

        doc.setFillColor(245, 158, 11);
        doc.roundedRect(m + 54, y, 50, 8, 1, 1, 'F');
        doc.setTextColor(255);
        doc.text(`${stats.warning} Próx. Vencimento`, m + 79, y + 5.5, { align: 'center' });

        doc.setFillColor(34, 197, 94);
        doc.roundedRect(m + 108, y, 50, 8, 1, 1, 'F');
        doc.setTextColor(255);
        doc.text(`${stats.valid} Válidos`, m + 133, y + 5.5, { align: 'center' });
        y += 14;

        // Table header
        const cols = [
            { label: 'Status', x: m, w: 32 },
            { label: 'Documento', x: m + 32, w: 80 },
            { label: 'Empresa', x: m + 112, w: 80 },
            { label: 'Vencimento', x: m + 192, w: 35 },
            { label: 'Dias Rest.', x: m + 227, w: 30 }
        ];

        const drawTableHeader = () => {
            doc.setFillColor(240, 243, 248);
            doc.rect(m, y, mw, 7, 'F');
            doc.setFontSize(7);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(60);
            cols.forEach(c => doc.text(c.label, c.x + 2, y + 5));
            y += 9;
        };

        drawTableHeader();

        const statusLabel = (s: DocStatus) => s === 'expired' ? 'VENCIDO' : s === 'warning' ? 'ATENÇÃO' : s === 'valid' ? 'VÁLIDO' : 'S/ VALIDADE';
        const statusColor = (s: DocStatus): [number, number, number] => s === 'expired' ? [220, 38, 38] : s === 'warning' ? [217, 119, 6] : s === 'valid' ? [22, 163, 74] : [120, 120, 120];

        filteredDocuments.forEach(d => {
            if (y > ph - 15) {
                doc.setFontSize(6.5);
                doc.setTextColor(150);
                doc.text(`Página ${doc.getNumberOfPages()}`, pw - m, ph - 6, { align: 'right' });
                doc.addPage();
                y = m;
                drawTableHeader();
            }

            // Zebra striping
            const idx = filteredDocuments.indexOf(d);
            if (idx % 2 === 0) {
                doc.setFillColor(250, 250, 253);
                doc.rect(m, y - 3.5, mw, 7, 'F');
            }

            doc.setFontSize(6.5);
            doc.setFont('helvetica', 'normal');

            // Status with color
            const [r, g, b] = statusColor(d.status);
            doc.setTextColor(r, g, b);
            doc.setFont('helvetica', 'bold');
            doc.text(statusLabel(d.status), cols[0].x + 2, y);

            // Title
            doc.setTextColor(30);
            doc.setFont('helvetica', 'normal');
            const titleTrunc = d.title.length > 50 ? d.title.substring(0, 48) + '...' : d.title;
            doc.text(titleTrunc, cols[1].x + 2, y);

            // Company
            doc.setTextColor(80);
            const compTrunc = d.companyName.length > 50 ? d.companyName.substring(0, 48) + '...' : d.companyName;
            doc.text(compTrunc, cols[2].x + 2, y);

            // Date
            doc.setTextColor(60);
            doc.text(d.expirationDate ? new Date(d.expirationDate).toLocaleDateString('pt-BR') : '-', cols[3].x + 2, y);

            // Days remaining
            doc.setTextColor(r, g, b);
            doc.setFont('helvetica', 'bold');
            doc.text(d.daysRemaining !== null ? `${d.daysRemaining} dias` : '-', cols[4].x + 2, y);

            y += 7;
        });

        // Footer on last page
        doc.setFontSize(6.5);
        doc.setTextColor(150);
        doc.text(`Página ${doc.getNumberOfPages()}`, pw - m, ph - 6, { align: 'right' });

        doc.save(`Validade_Documentos_${new Date().toISOString().slice(0, 10)}.pdf`);
    }, [filteredDocuments, stats]);

    // ── Helpers ──
    const getStatusIcon = (status: string) => {
        switch (status) {
            case 'expired': return <AlertTriangle size={16} color="var(--color-danger)" />;
            case 'warning': return <Clock size={16} color="var(--color-warning)" />;
            case 'valid': return <ShieldCheck size={16} color="var(--color-success)" />;
            default: return <span style={{ width: 16, height: 16, display: 'inline-block', borderRadius: '50%', background: 'var(--color-border)' }}></span>;
        }
    };

    const getStatusBadge = (status: string, daysR: number | null) => {
        switch (status) {
            case 'expired':
                return <span className="doc-badge" style={{ background: 'rgba(239, 68, 68, 0.1)', color: 'var(--color-danger)' }}>Expirado há {Math.abs(daysR || 0)} dias</span>;
            case 'warning':
                return <span className="doc-badge" style={{ background: 'rgba(245, 158, 11, 0.1)', color: 'var(--color-warning)' }}>Vence em {daysR} dias</span>;
            case 'valid':
                return <span className="doc-badge" style={{ background: 'rgba(34, 197, 94, 0.1)', color: 'var(--color-success)' }}>Válido</span>;
            default:
                return <span className="doc-badge" style={{ background: 'var(--color-bg-body)', color: 'var(--color-text-tertiary)' }}>Sem Validade</span>;
        }
    };

    const formatDate = (dateStr?: string) => {
        if (!dateStr) return '-';
        return new Date(dateStr).toLocaleDateString('pt-BR');
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>

            {/* ── Summary Cards ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--space-3)' }}>
                <SummaryCard
                    label="Vencidos" value={stats.expired} total={stats.total}
                    color="var(--color-danger)" bg="rgba(239, 68, 68, 0.06)"
                    icon={<AlertTriangle size={18} />}
                    active={filterStatus === 'expired'}
                    onClick={() => setFilterStatus(filterStatus === 'expired' ? '' : 'expired')}
                />
                <SummaryCard
                    label="Próx. Vencimento" value={stats.warning} total={stats.total}
                    color="var(--color-warning)" bg="rgba(245, 158, 11, 0.06)"
                    icon={<Clock size={18} />}
                    active={filterStatus === 'warning'}
                    onClick={() => setFilterStatus(filterStatus === 'warning' ? '' : 'warning')}
                />
                <SummaryCard
                    label="Válidos" value={stats.valid} total={stats.total}
                    color="var(--color-success)" bg="rgba(34, 197, 94, 0.06)"
                    icon={<ShieldCheck size={18} />}
                    active={filterStatus === 'valid'}
                    onClick={() => setFilterStatus(filterStatus === 'valid' ? '' : 'valid')}
                />
                <SummaryCard
                    label="Sem Validade" value={stats.unknown} total={stats.total}
                    color="var(--color-text-tertiary)" bg="var(--color-bg-body)"
                    icon={<AlertCircle size={18} />}
                    active={filterStatus === 'unknown'}
                    onClick={() => setFilterStatus(filterStatus === 'unknown' ? '' : 'unknown')}
                />
            </div>

            {/* ── Toolbar: Search + Filters Toggle + Export ── */}
            <div className="card" style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', padding: 'var(--space-3) var(--space-4)' }}>
                {/* Search */}
                <div style={{ flex: 1, maxWidth: '360px', display: 'flex', alignItems: 'center', gap: 'var(--space-2)', background: 'var(--color-bg-body)', padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-md)', border: 'none', boxShadow: '0 0 0 1px var(--color-border)' }}>
                    <Search size={16} color="var(--color-text-secondary)" />
                    <input
                        type="text"
                        placeholder="Buscar documento ou empresa..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        style={{ border: 'none', background: 'transparent', outline: 'none', color: 'var(--color-text-primary)', width: '100%', fontSize: '0.85rem' }}
                    />
                    {searchTerm && <button onClick={() => setSearchTerm('')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}><X size={14} color="var(--color-text-tertiary)" /></button>}
                </div>

                {/* Filter toggle */}
                <button
                    onClick={() => setShowFilters(!showFilters)}
                    className="btn btn-secondary"
                    style={{ padding: 'var(--space-2) var(--space-4)', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: 'var(--space-2)', position: 'relative' }}
                >
                    <Filter size={14} /> Filtros
                    {activeFilterCount > 0 && (
                        <span style={{ position: 'absolute', top: -5, right: -5, background: 'var(--color-primary)', color: 'white', borderRadius: '50%', width: 18, height: 18, fontSize: '0.65rem', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>
                            {activeFilterCount}
                        </span>
                    )}
                </button>

                {activeFilterCount > 0 && (
                    <button onClick={clearFilters} className="btn" style={{ padding: '8px 12px', fontSize: '0.75rem', color: 'var(--color-text-tertiary)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>
                        Limpar filtros
                    </button>
                )}

                {/* Spacer */}
                <div style={{ flex: 1 }} />

                {/* Export buttons */}
                <button onClick={exportCSV} className="btn btn-secondary" style={{ padding: 'var(--space-2) var(--space-4)', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <FileSpreadsheet size={14} /> CSV
                </button>
                <button onClick={exportPDF} className="btn btn-primary" style={{ padding: 'var(--space-2) var(--space-4)', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <FileText size={14} /> PDF
                </button>
            </div>

            {/* ── Filter Panel (Collapsible) ── */}
            {showFilters && (
                <div style={{
                    display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 'var(--space-3)',
                    background: 'var(--color-bg-surface)', padding: 'var(--space-4)',
                    borderRadius: 'var(--radius-lg)', border: 'none', boxShadow: '0 0 0 1px var(--color-border)',
                    animation: 'slideDown 0.2s ease-out'
                }}>
                    <div>
                        <label className="form-label">Empresa</label>
                        <select
                            value={filterCompany}
                            onChange={e => setFilterCompany(e.target.value)}
                            className="form-select"
                        >
                            <option value="">Todas as empresas</option>
                            {companies.map(c => <option key={c.id} value={c.id}>{c.razaoSocial}</option>)}
                        </select>
                    </div>
                    <div>
                        <label className="form-label">Status</label>
                        <select
                            value={filterStatus}
                            onChange={e => setFilterStatus(e.target.value as DocStatus | '')}
                            className="form-select"
                        >
                            <option value="">Todos os status</option>
                            <option value="expired">Vencido</option>
                            <option value="warning">Próx. Vencimento</option>
                            <option value="valid">Válido</option>
                            <option value="unknown">Sem Validade</option>
                        </select>
                    </div>
                    <div>
                        <label className="form-label">Vencimento a partir de</label>
                        <input
                            type="date"
                            value={filterDateFrom}
                            onChange={e => setFilterDateFrom(e.target.value)}
                            className="form-select"
                        />
                    </div>
                    <div>
                        <label className="form-label">Vencimento até</label>
                        <input
                            type="date"
                            value={filterDateTo}
                            onChange={e => setFilterDateTo(e.target.value)}
                            className="form-select"
                        />
                    </div>
                </div>
            )}

            {/* ── Results Header ── */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 4px' }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--color-text-tertiary)' }}>
                    {filteredDocuments.length} de {allDocuments.length} documentos
                    {activeFilterCount > 0 && <span style={{ color: 'var(--color-primary)', fontWeight: 600 }}> (filtrado)</span>}
                </span>
                <div className="flex-gap" style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)', gap: 'var(--space-3)' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-danger)', display: 'inline-block' }} /> Vencido</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-warning)', display: 'inline-block' }} /> Atenção</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--color-success)', display: 'inline-block' }} /> Válido</span>
                </div>
            </div>

            {/* ── Document Table ── */}
            <div style={{ background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-lg)', border: 'none', boxShadow: '0 0 0 1px var(--color-border)', overflow: 'hidden' }}>
                <table className="table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                        <tr>
                            <th style={{ width: '180px' }}>Status</th>
                            <th>Documento</th>
                            <th>Empresa</th>
                            <th style={{ width: '130px' }}>Vencimento</th>
                            <th style={{ width: '80px' }}>Ação</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredDocuments.length === 0 ? (
                            <tr>
                                <td colSpan={5} style={{ textAlign: 'center', padding: '40px', color: 'var(--color-text-tertiary)' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-2)' }}>
                                        <Search size={32} color="var(--color-border)" />
                                        <span>Nenhum documento encontrado{activeFilterCount > 0 ? ' com os filtros aplicados' : ''}.</span>
                                        {activeFilterCount > 0 && (
                                            <button onClick={clearFilters} className="btn btn-secondary" style={{ padding: '6px 16px', fontSize: '0.8rem', marginTop: '4px' }}>
                                                Limpar filtros
                                            </button>
                                        )}
                                    </div>
                                </td>
                            </tr>
                        ) : (
                            filteredDocuments.map(doc => (
                                <tr key={doc.id} style={{
                                    borderBottom: '1px solid var(--color-border)',
                                    transition: 'background 0.15s ease',
                                }}>
                                    <td style={{
                                        padding: '12px 16px',
                                        borderLeft: doc.status === 'expired' ? '3px solid var(--color-danger)' : doc.status === 'warning' ? '3px solid var(--color-warning)' : doc.status === 'valid' ? '3px solid var(--color-success)' : '3px solid transparent',
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            {getStatusIcon(doc.status)}
                                            {getStatusBadge(doc.status, doc.daysRemaining)}
                                        </div>
                                    </td>
                                    <td style={{ padding: '12px 16px' }}>
                                        <div style={{ fontWeight: 500, fontSize: '0.875rem' }}>{doc.title}</div>
                                        {doc.docGroup && <div style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)', marginTop: '2px' }}>{doc.docGroup}</div>}
                                    </td>
                                    <td style={{ padding: '12px 16px', color: 'var(--color-text-secondary)' }}>
                                        <div className="flex-gap" style={{ fontSize: '0.875rem' }}>
                                            <Building2 size={14} /> {doc.companyName}
                                        </div>
                                    </td>
                                    <td style={{ padding: '12px 16px', color: 'var(--color-text-secondary)', fontSize: '0.875rem' }}>
                                        {formatDate(doc.expirationDate)}
                                    </td>
                                    <td style={{ padding: '12px 16px' }}>
                                        <a href={`${API_BASE_URL}${doc.url}`} target="_blank" rel="noopener noreferrer" className="btn btn-secondary" style={{ padding: '4px 10px', fontSize: '0.75rem', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                            <Download size={12} /> PDF
                                        </a>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            <style>{`
                @keyframes slideDown {
                    from { opacity: 0; transform: translateY(-8px); }
                    to { opacity: 1; transform: translateY(0); }
                }
            `}</style>
        </div>
    );
}

// ── Summary Card Component ──
function SummaryCard({ label, value, total, color, bg, icon, active, onClick }: {
    label: string; value: number; total: number; color: string; bg: string;
    icon: React.ReactNode; active: boolean; onClick: () => void;
}) {
    const pct = total > 0 ? Math.round((value / total) * 100) : 0;
    return (
        <button
            onClick={onClick}
            style={{
                padding: 'var(--space-4) var(--space-5)', borderRadius: 'var(--radius-xl)',
                border: 'none',
                background: active ? bg : 'var(--color-bg-surface)',
                cursor: 'pointer', textAlign: 'left',
                transition: 'var(--transition-fast)',
                boxShadow: active ? `0 0 0 2px ${color}, 0 4px 16px ${bg}` : '0 0 0 1px var(--color-border), 0 1px 4px rgba(0,0,0,0.04)',
            }}
        >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-3)' }}>
                <div style={{ fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-tertiary)' }}>{label}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <span style={{ fontSize: '0.65rem', fontWeight: 700, color: color, opacity: 0.7 }}>{pct}%</span>
                    <span style={{ color, opacity: active ? 1 : 0.6 }}>{icon}</span>
                </div>
            </div>
            <div style={{ fontSize: '2rem', fontWeight: 800, color, lineHeight: 1, letterSpacing: '-0.03em', marginBottom: 4 }}>{value}</div>
            <div style={{ height: 3, borderRadius: 9999, background: 'var(--color-bg-body)', overflow: 'hidden', marginTop: 'var(--space-2)' }}>
                <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 9999, transition: 'width 0.5s ease' }} />
            </div>
        </button>
    );
}

