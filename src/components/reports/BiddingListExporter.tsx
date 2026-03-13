import { useState, useMemo } from 'react';
import { FileText, Filter, Search, FileSpreadsheet, Settings } from 'lucide-react';
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

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
            <div className="card p-6">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-6)', flexWrap: 'wrap', gap: 'var(--space-4)' }}>
                    <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center', flex: 1, minWidth: '300px' }}>
                        <div style={{ position: 'relative', flex: 1 }}>
                            <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-tertiary)' }} />
                            <input
                                type="text"
                                placeholder="Buscar por título ou portal..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                style={{
                                    padding: '10px 10px 10px 40px',
                                    borderRadius: 'var(--radius-md)',
                                    border: '1px solid var(--color-border)',
                                    width: '100%',
                                    fontSize: 'var(--text-base)'
                                }}
                            />
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                            <Filter size={18} color="var(--color-text-tertiary)" />
                            <select
                                value={statusFilter}
                                onChange={(e) => setStatusFilter(e.target.value as any)}
                                className="form-select"
                                style={{ background: 'var(--color-bg-base)' }}
                            >
                                <option value="Todos">Todos os Status</option>
                                {COLUMNS.map(col => (
                                    <option key={col} value={col}>{col}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: 'var(--space-3)', position: 'relative' }}>
                        <button
                            className="btn btn-outline"
                            onClick={() => setIsConfigOpen(!isConfigOpen)}
                            style={{ gap: '8px' }}
                        >
                            <Settings size={18} /> Colunas
                        </button>

                        {isConfigOpen && (
                            <div style={{
                                position: 'absolute',
                                top: '100%',
                                right: 0,
                                marginTop: 'var(--space-2)',
                                background: 'var(--color-bg-surface)',
                                border: '1px solid var(--color-border)',
                                borderRadius: 'var(--radius-md)',
                                padding: 'var(--space-4)',
                                zIndex: 100,
                                boxShadow: 'var(--shadow-lg)',
                                minWidth: '200px'
                            }}>
                                <div style={{ fontWeight: 'var(--font-semibold)', marginBottom: 'var(--space-3)', fontSize: 'var(--text-base)' }}>Configurar Colunas</div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                                    {availableColumns.map(col => (
                                        <label key={col.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: 'pointer', fontSize: 'var(--text-base)' }}>
                                            <input
                                                type="checkbox"
                                                checked={visibleColumns.includes(col.id)}
                                                onChange={() => toggleColumn(col.id)}
                                            />
                                            {col.label}
                                        </label>
                                    ))}
                                </div>
                            </div>
                        )}

                        <button className="btn btn-outline" onClick={exportCSV} style={{ gap: '8px' }}>
                            <FileSpreadsheet size={18} /> Exportar CSV
                        </button>
                        <button className="btn btn-primary" onClick={exportPDF} style={{ gap: '8px' }}>
                            <FileText size={18} /> Exportar PDF
                        </button>
                    </div>
                </div>

                <div style={{ overflowX: 'auto', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                    <table className="table" style={{ width: '100%', fontSize: 'var(--text-base)' }}>
                        <thead>
                            <tr>
                                {availableColumns.filter(col => visibleColumns.includes(col.id)).map(col => (
                                    <th key={col.id}>{col.label}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {filteredBiddings.length > 0 ? (
                                filteredBiddings.map(b => (
                                    <tr key={b.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                        {availableColumns.filter(col => visibleColumns.includes(col.id)).map(col => {
                                            const val = (b as any)[col.id];
                                            if (col.id === 'companyProfileId') {
                                                const company = companies.find(c => c.id === val);
                                                return <td key={col.id} style={{ padding: '12px 16px' }}>{company ? company.razaoSocial : '-'}</td>;
                                            }
                                            if (col.id === 'estimatedValue') {
                                                return <td key={col.id} style={{ padding: '12px 16px' }}>{val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>;
                                            }
                                            if (col.id === 'sessionDate') {
                                                return <td key={col.id} style={{ padding: '12px 16px' }}>{format(new Date(val), 'dd/MM/yy HH:mm')}</td>;
                                            }
                                            if (col.id === 'status') {
                                                return (
                                                    <td key={col.id} style={{ padding: '12px 16px' }}>
                                                        <span className="badge badge-blue">{val}</span>
                                                    </td>
                                                );
                                            }
                                            return <td key={col.id} style={{ padding: '12px 16px', fontWeight: col.id === 'title' ? 500 : 400 }}>{val || '-'}</td>;
                                        })}
                                    </tr>
                                ))
                            ) : (
                                <tr>
                                    <td colSpan={5} style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-tertiary)' }}>
                                        Nenhum processo encontrado com os filtros selecionados.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>

                <div style={{ marginTop: 'var(--space-4)', color: 'var(--color-text-tertiary)', fontSize: 'var(--text-base)' }}>
                    Mostrando {filteredBiddings.length} de {biddings.length} processos.
                </div>
            </div>
        </div>
    );
}
