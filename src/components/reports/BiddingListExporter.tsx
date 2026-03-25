import { useState, useMemo } from 'react';
import { FileText, Filter, Search, FileSpreadsheet, Settings, TableProperties, Download } from 'lucide-react';
import { format } from 'date-fns';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { BiddingProcess, BiddingStatus, CompanyProfile } from '../../types';
import { COLUMNS } from '../../types';

interface Props {
    biddings: BiddingProcess[];
    companies: CompanyProfile[];
}

export function BiddingListExporter({ biddings, companies }: Props) {
    const [statusFilter, setStatusFilter] = useState<BiddingStatus | 'Todos'>('Todos');
    const [searchTerm, setSearchTerm] = useState('');
    const [visibleColumns, setVisibleColumns] = useState<string[]>([
        'title', 'portal', 'estimatedValue', 'sessionDate', 'status'
    ]);
    const [isConfigOpen, setIsConfigOpen] = useState(false);

    const availableColumns = [
        { id: 'title', label: 'Título' },
        { id: 'companyProfileId', label: 'Empresa' },
        { id: 'portal', label: 'Portal' },
        { id: 'modality', label: 'Modalidade' },
        { id: 'estimatedValue', label: 'Valor Estimado' },
        { id: 'sessionDate', label: 'Data da Sessão' },
        { id: 'status', label: 'Status' },
        { id: 'risk', label: 'Risco' },
        { id: 'link', label: 'Link' },
        { id: 'summary', label: 'Objeto Resumido' }
    ];

    const toggleColumn = (columnId: string) => {
        setVisibleColumns(prev =>
            prev.includes(columnId)
                ? prev.filter(id => id !== columnId)
                : [...prev, columnId]
        );
    };

    const filteredBiddings = useMemo(() => {
        return biddings.filter(b => {
            const matchesStatus = statusFilter === 'Todos' || b.status === statusFilter;
            const matchesSearch = b.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                (b.portal || '').toLowerCase().includes(searchTerm.toLowerCase());
            return matchesStatus && matchesSearch;
        });
    }, [biddings, statusFilter, searchTerm]);

    const exportCSV = () => {
        const selectedCols = availableColumns.filter(col => visibleColumns.includes(col.id));
        const headers = selectedCols.map(col => col.label);

        const rows = filteredBiddings.map(b => {
            return selectedCols.map(col => {
                const val = (b as any)[col.id];
                if (col.id === 'companyProfileId') {
                    const company = companies.find(c => c.id === val);
                    return company ? company.razaoSocial : '-';
                }
                if (col.id === 'estimatedValue') {
                    return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                }
                if (col.id === 'sessionDate') {
                    return format(new Date(val), 'dd/MM/yyyy HH:mm');
                }
                return val || '';
            });
        });

        const csvContent = [
            headers.join(','),
            ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(','))
        ].join('\n');

        const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `relatorio_licitacoes_${format(new Date(), 'yyyyMMdd_HHmm')}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const exportPDF = () => {
        const doc = new jsPDF('l', 'mm', 'a4');
        const selectedCols = availableColumns.filter(col => visibleColumns.includes(col.id));

        // Title
        doc.setFontSize(18);
        doc.text('Relatório de Processos Licitatórios', 14, 22);

        doc.setFontSize(11);
        doc.setTextColor(100);
        doc.text(`Gerado em: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, 14, 30);
        doc.text(`Status Filtrado: ${statusFilter}`, 14, 35);

        const tableColumn = selectedCols.map(col => col.label);
        const tableRows = filteredBiddings.map(b => {
            return selectedCols.map(col => {
                const val = (b as any)[col.id];
                if (col.id === 'companyProfileId') {
                    const company = companies.find(c => c.id === val);
                    return company ? company.razaoSocial : '-';
                }
                if (col.id === 'estimatedValue') {
                    return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
                }
                if (col.id === 'sessionDate') {
                    return format(new Date(val), 'dd/MM/yy HH:mm');
                }
                return val || '';
            });
        });

        autoTable(doc, {
            head: [tableColumn],
            body: tableRows,
            startY: 45,
            theme: 'striped',
            headStyles: { fillColor: [37, 99, 235], textColor: 255 },
            styles: { fontSize: 8, cellPadding: 3 },
            columnStyles: {
                0: { cellWidth: 'auto' }
            }
        });

        doc.save(`relatorio_licitacoes_${format(new Date(), 'yyyyMMdd_HHmm')}.pdf`);
    };

    const getStatusBadgeStyle = (status: string): React.CSSProperties => {
        const s = status.toLowerCase();
        if (s === 'vencido') return { background: 'rgba(34,197,94,0.1)', color: 'var(--color-success)', border: 'none', boxShadow: '0 0 0 1px rgba(34,197,94,0.25)' };
        if (s === 'perdido' || s === 'sem sucesso') return { background: 'rgba(239,68,68,0.08)', color: 'var(--color-danger)', border: 'none', boxShadow: '0 0 0 1px rgba(239,68,68,0.2)' };
        if (s === 'participando') return { background: 'rgba(37,99,235,0.08)', color: 'var(--color-primary)', border: 'none', boxShadow: '0 0 0 1px rgba(37,99,235,0.2)' };
        if (s === 'em análise de edital') return { background: 'rgba(99,102,241,0.08)', color: 'rgba(99,102,241,0.9)', border: 'none', boxShadow: '0 0 0 1px rgba(99,102,241,0.2)' };
        if (s === 'preparando documentação') return { background: 'rgba(245,158,11,0.08)', color: 'var(--color-warning)', border: 'none', boxShadow: '0 0 0 1px rgba(245,158,11,0.2)' };
        if (s === 'captado') return { background: 'var(--color-bg-body)', color: 'var(--color-text-secondary)', border: 'none', boxShadow: '0 0 0 1px var(--color-border)' };
        if (s === 'monitorando') return { background: 'rgba(37,99,235,0.06)', color: 'var(--color-primary)', border: 'none', boxShadow: '0 0 0 1px rgba(37,99,235,0.15)' };
        if (s === 'recurso') return { background: 'rgba(245,158,11,0.08)', color: '#d97706', border: 'none', boxShadow: '0 0 0 1px rgba(245,158,11,0.2)' };
        if (s === 'desclassificado') return { background: 'rgba(239,68,68,0.06)', color: 'var(--color-danger)', border: 'none', boxShadow: '0 0 0 1px rgba(239,68,68,0.15)' };
        return { background: 'var(--color-bg-body)', color: 'var(--color-text-secondary)', border: 'none', boxShadow: '0 0 0 1px var(--color-border)' };
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
            <div style={{ borderRadius: 'var(--radius-xl)', border: 'none', overflow: 'hidden', background: 'var(--color-bg-surface)', boxShadow: '0 0 0 1px var(--color-border), 0 2px 12px rgba(0,0,0,0.04)' }}>

                {/* ── Module Header ── */}
                <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: 'var(--space-4) var(--space-6)',
                    background: 'linear-gradient(135deg, rgba(37,99,235,0.05) 0%, rgba(99,102,241,0.03) 100%)',
                    borderBottom: '1px solid var(--color-border)',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                        <div style={{ width: 36, height: 36, borderRadius: 'var(--radius-lg)', background: 'rgba(37,99,235,0.1)', border: 'none', boxShadow: '0 0 0 1px rgba(37,99,235,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <TableProperties size={18} color="var(--color-primary)" />
                        </div>
                        <div>
                            <div style={{ fontSize: 'var(--text-lg)', fontWeight: 800, color: 'var(--color-text-primary)', lineHeight: 1.1, letterSpacing: '-0.02em' }}>Central de Exportação</div>
                            <div style={{ fontSize: '0.68rem', color: 'var(--color-text-tertiary)' }}>{filteredBiddings.length} de {biddings.length} processo(s) · selecione colunas e exporte</div>
                        </div>
                    </div>

                    {/* Action bar */}
                    <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', position: 'relative' }}>
                        <button className="btn btn-outline" onClick={() => setIsConfigOpen(!isConfigOpen)} style={{ gap: 6, fontSize: 'var(--text-sm)', padding: 'var(--space-2) var(--space-3)' }}>
                            <Settings size={14} /> Colunas
                        </button>

                        {isConfigOpen && (
                            <div style={{
                                position: 'absolute', top: '100%', right: 0, marginTop: 'var(--space-2)',
                                background: 'var(--color-bg-surface)', border: 'none',
                                borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)', zIndex: 100,
                                boxShadow: '0 0 0 1px var(--color-border), var(--shadow-lg)', minWidth: '200px',
                            }}>
                                <div style={{ fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-3)' }}>Colunas visíveis</div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    {availableColumns.map(col => (
                                        <label key={col.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: 'pointer', fontSize: 'var(--text-sm)', padding: '4px 0' }}>
                                            <input type="checkbox" checked={visibleColumns.includes(col.id)} onChange={() => toggleColumn(col.id)} style={{ accentColor: 'var(--color-primary)', width: 13, height: 13 }} />
                                            {col.label}
                                        </label>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div style={{ width: 1, height: 24, background: 'var(--color-border)' }} />
                        <button className="btn btn-outline" onClick={exportCSV} style={{ gap: 6, fontSize: 'var(--text-sm)', padding: 'var(--space-2) var(--space-3)' }}>
                            <FileSpreadsheet size={14} /> CSV
                        </button>
                        <button className="btn btn-primary" onClick={exportPDF} style={{ gap: 6, fontSize: 'var(--text-sm)', padding: 'var(--space-2) var(--space-4)', background: 'linear-gradient(135deg, var(--color-primary), rgba(99,102,241,0.9))', border: 'none', boxShadow: '0 3px 10px rgba(37,99,235,0.25)' }}>
                            <Download size={14} /> Exportar PDF
                        </button>
                    </div>
                </div>

                {/* ── Filter bar ── */}
                <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', padding: 'var(--space-3) var(--space-6)', borderBottom: '1px solid var(--color-border)', background: 'var(--color-bg-body)' }}>
                    <div style={{ flex: 1, maxWidth: 360, display: 'flex', alignItems: 'center', gap: 'var(--space-2)', background: 'var(--color-bg-surface)', padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-md)', border: 'none', boxShadow: '0 0 0 1px var(--color-border)' }}>
                        <Search size={14} color="var(--color-text-tertiary)" />
                        <input
                            type="text"
                            placeholder="Buscar por título ou portal..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            style={{ border: 'none', background: 'transparent', outline: 'none', color: 'var(--color-text-primary)', width: '100%', fontSize: 'var(--text-sm)' }}
                        />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                        <Filter size={13} color="var(--color-text-tertiary)" />
                        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} className="form-select" style={{ background: 'var(--color-bg-surface)', fontSize: 'var(--text-sm)', padding: 'var(--space-1) var(--space-3)' }}>
                            <option value="Todos">Todos os Status</option>
                            {COLUMNS.map(col => <option key={col} value={col}>{col}</option>)}
                        </select>
                    </div>
                </div>

                {/* ── Table ── */}
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
                        <thead>
                            <tr style={{ background: 'linear-gradient(135deg, rgba(37,99,235,0.04), rgba(99,102,241,0.02))', borderBottom: '2px solid var(--color-border)' }}>
                                {availableColumns.filter(col => visibleColumns.includes(col.id)).map(col => (
                                    <th key={col.id} style={{ padding: '10px 16px', textAlign: 'left', fontSize: '0.65rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap' }}>{col.label}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {filteredBiddings.length > 0 ? (
                                filteredBiddings.map((b, idx) => (
                                    <tr key={b.id} style={{ background: idx % 2 === 0 ? 'var(--color-bg-surface)' : 'var(--color-bg-body)', borderBottom: '1px solid var(--color-border)' }}>
                                        {availableColumns.filter(col => visibleColumns.includes(col.id)).map(col => {
                                            const val = (b as any)[col.id];
                                            if (col.id === 'companyProfileId') {
                                                const company = companies.find(c => c.id === val);
                                                return <td key={col.id} style={{ padding: '10px 16px', color: 'var(--color-text-secondary)' }}>{company ? company.razaoSocial : '-'}</td>;
                                            }
                                            if (col.id === 'estimatedValue') {
                                                return <td key={col.id} style={{ padding: '10px 16px', fontWeight: 600, color: 'var(--color-text-primary)' }}>{val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>;
                                            }
                                            if (col.id === 'sessionDate') {
                                                return <td key={col.id} style={{ padding: '10px 16px', color: 'var(--color-text-secondary)', whiteSpace: 'nowrap' }}>{format(new Date(val), 'dd/MM/yy HH:mm')}</td>;
                                            }
                                            if (col.id === 'status') {
                                                const style = getStatusBadgeStyle(val);
                                                return (
                                                    <td key={col.id} style={{ padding: '10px 16px' }}>
                                                        <span style={{ ...style, display: 'inline-block', padding: '2px 8px', borderRadius: 'var(--radius-md)', fontSize: '0.7rem', fontWeight: 700 }}>{val}</span>
                                                    </td>
                                                );
                                            }
                                            return <td key={col.id} style={{ padding: '10px 16px', fontWeight: col.id === 'title' ? 600 : 400, color: col.id === 'title' ? 'var(--color-text-primary)' : 'var(--color-text-secondary)' }}>{val || '-'}</td>;
                                        })}
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan={visibleColumns.length} style={{ padding: 'var(--space-16)', textAlign: 'center' }}>
                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-3)' }}>
                                            <div style={{ width: 52, height: 52, borderRadius: 'var(--radius-xl)', background: 'rgba(37,99,235,0.06)', border: 'none', boxShadow: '0 0 0 1px rgba(37,99,235,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                <Search size={22} color="var(--color-primary)" strokeWidth={1.5} />
                                            </div>
                                            <div style={{ fontWeight: 700, color: 'var(--color-text-primary)', fontSize: 'var(--text-md)' }}>Nenhum processo encontrado</div>
                                            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)' }}>Ajuste os filtros de status ou busca acima.</div>
                                        </div>
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {/* ── Footer ── */}
                <div style={{ padding: 'var(--space-3) var(--space-6)', borderTop: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--color-bg-body)' }}>
                    <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)' }}>
                        <strong style={{ color: 'var(--color-text-primary)', fontWeight: 700 }}>{filteredBiddings.length}</strong> de {biddings.length} processos exibidos
                    </span>
                    <span style={{ fontSize: '0.68rem', color: 'var(--color-text-tertiary)', display: 'flex', alignItems: 'center', gap: 5 }}>
                        <FileText size={11} /> Relatório de Processos Licitatórios
                    </span>
                </div>
            </div>
        </div>
    );
}
