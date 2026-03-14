import { useState, useMemo } from 'react';
import { CheckCircle2, FileArchive, Loader2, Search, ChevronDown, ChevronUp, XCircle, ScanSearch, Shield, FileSearch, Briefcase, FileText, HelpCircle, AlertTriangle, Eye, Package, ClipboardList } from 'lucide-react';
import { API_BASE_URL } from '../../config';
import type { BiddingProcess, CompanyProfile, CompanyDocument } from '../../types';
import { useDossierExporter, getGroupMeta } from '../hooks/useDossierExporter';

const ICON_MAP: Record<string, any> = { Shield, FileSearch, Briefcase, FileText, ScanSearch, HelpCircle };

interface Props {
    biddings: BiddingProcess[];
    companies: CompanyProfile[];
}

// ──────────────────────────────────────────────────────────────────────
// RequirementCard — Self-contained subcomponent
// ──────────────────────────────────────────────────────────────────────
function RequirementCard({
    req, reqItem, selectedDocs, isIgnored, companyDocs, onToggleMatch, note,
}: {
    req: string; reqItem: string;
    selectedDocs: { docId: string; fileName: string; url: string }[];
    isIgnored: boolean; companyDocs: CompanyDocument[];
    onToggleMatch: (requirement: string, docId: string) => void;
    note?: string;
}) {
    const [isExpanded, setIsExpanded] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const isSatisfied = selectedDocs.length > 0;

    const groupedDocs = useMemo(() => {
        const groups: Record<string, CompanyDocument[]> = {};
        const sortedDocs = [...companyDocs].sort((a, b) => getGroupMeta(a.docGroup).priority - getGroupMeta(b.docGroup).priority);
        for (const doc of sortedDocs) {
            const group = doc.docGroup || 'Outros';
            if (!groups[group]) groups[group] = [];
            groups[group].push(doc);
        }
        return groups;
    }, [companyDocs]);

    const filteredGroups = useMemo(() => {
        if (!searchTerm.trim()) return groupedDocs;
        const term = searchTerm.toLowerCase();
        const result: Record<string, CompanyDocument[]> = {};
        for (const [group, docs] of Object.entries(groupedDocs)) {
            const filtered = docs.filter(d =>
                (d.docType || '').toLowerCase().includes(term) ||
                (d.fileName || '').toLowerCase().includes(term) ||
                group.toLowerCase().includes(term)
            );
            if (filtered.length > 0) result[group] = filtered;
        }
        return result;
    }, [groupedDocs, searchTerm]);

    const statusColor = isIgnored ? 'var(--color-neutral)' : isSatisfied ? 'var(--color-success)' : 'var(--color-danger)';
    const statusBg = isIgnored ? 'rgba(148,163,184,0.06)' : isSatisfied ? 'rgba(34,197,94,0.04)' : 'rgba(239,68,68,0.04)';

    return (
        <div style={{ borderRadius: 'var(--radius-lg)', border: `1px solid ${isIgnored ? 'var(--color-border)' : isSatisfied ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.25)'}`, background: statusBg, overflow: 'hidden', transition: 'var(--transition-fast)' }}>
            {/* Header */}
            <div className="flex-center gap-3" style={{ padding: 'var(--space-4) var(--space-5)', cursor: 'pointer', userSelect: 'none' }} onClick={() => setIsExpanded(!isExpanded)}>
                <div style={{ width: '28px', height: '28px', borderRadius: '50%', background: statusColor + '18', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, border: `2px solid ${statusColor}40` }}>
                    {isIgnored ? <XCircle size={14} color={statusColor} /> : isSatisfied ? <CheckCircle2 size={14} color={statusColor} /> : <AlertTriangle size={14} color={statusColor} />}
                </div>

                <div className="flex-1">
                    <div className="flex-center gap-2">
                        {reqItem && (
                            <span style={{ padding: '2px var(--space-2)', borderRadius: 'var(--radius-sm)', background: 'var(--color-primary)', color: 'white', fontSize: '0.65rem', fontWeight: 'var(--font-bold)', flexShrink: 0, letterSpacing: '0.05em' }}>{reqItem}</span>
                        )}
                        <span style={{ fontSize: 'var(--text-md)', fontWeight: 'var(--font-semibold)', color: isIgnored ? 'var(--color-text-tertiary)' : 'var(--color-text-primary)', textDecoration: isIgnored ? 'line-through' : 'none', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {req}
                        </span>
                    </div>
                    {isSatisfied && !isIgnored && (
                        <div className="flex-wrap gap-2 mt-2" style={{ display: 'flex' }}>
                            {note && (
                                <span className="flex-center gap-1" style={{ padding: '2px var(--space-3)', borderRadius: 'var(--radius-lg)', background: 'var(--color-primary-light)', color: 'var(--color-primary)', fontSize: '0.65rem', fontWeight: 'var(--font-bold)', border: '1px solid rgba(56, 189, 248, 0.3)' }}>
                                    <ScanSearch size={10} /> {note}
                                </span>
                            )}
                            {selectedDocs.map(doc => (
                                <span key={doc.docId} className="flex-center gap-1" style={{ padding: '2px var(--space-3)', borderRadius: 'var(--radius-lg)', background: 'var(--color-success-bg)', color: 'var(--color-success)', fontSize: 'var(--text-sm)', fontWeight: 'var(--font-semibold)', maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    <CheckCircle2 size={10} /> {doc.fileName}
                                </span>
                            ))}
                        </div>
                    )}
                </div>

                <div className="flex-center gap-2" style={{ flexShrink: 0 }}>
                    <label className="flex-center gap-1" style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-medium)', cursor: 'pointer', color: 'var(--color-text-tertiary)', padding: '4px var(--space-2)', borderRadius: 'var(--radius-sm)', background: isIgnored ? 'rgba(148,163,184,0.12)' : 'transparent', border: '1px solid var(--color-border)' }} onClick={e => e.stopPropagation()}>
                        <input type="checkbox" checked={isIgnored} onChange={() => onToggleMatch(req, 'IGNORAR')} style={{ width: '12px', height: '12px' }} />
                        N/A
                    </label>
                    {isExpanded ? <ChevronUp size={16} color="var(--color-text-tertiary)" /> : <ChevronDown size={16} color="var(--color-text-tertiary)" />}
                </div>
            </div>

            {/* Expanded Document Picker */}
            {isExpanded && !isIgnored && (
                <div style={{ borderTop: '1px solid var(--color-border)', padding: 'var(--space-4) var(--space-5)', background: 'var(--color-bg-surface)' }}>
                    <div className="flex-center gap-2 mb-3" style={{ padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', background: 'var(--color-bg-body)' }}>
                        <Search size={14} color="var(--color-text-tertiary)" />
                        <input type="text" placeholder="Buscar documento por nome, tipo ou grupo..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                            style={{ border: 'none', background: 'transparent', outline: 'none', width: '100%', fontSize: '0.8125rem', color: 'var(--color-text-primary)' }} />
                        {searchTerm && <button onClick={() => setSearchTerm('')} className="btn-link" style={{ padding: '2px' }}><XCircle size={14} /></button>}
                    </div>

                    <div style={{ maxHeight: '280px', overflowY: 'auto', paddingRight: '4px' }}>
                        {Object.keys(filteredGroups).length === 0 ? (
                            <p style={{ textAlign: 'center', color: 'var(--color-text-tertiary)', fontSize: '0.8rem', padding: '16px' }}>
                                {searchTerm ? 'Nenhum documento encontrado para esta busca.' : 'Nenhum documento cadastrado nesta empresa.'}
                            </p>
                        ) : (
                            Object.entries(filteredGroups).map(([group, docs]) => {
                                const meta = getGroupMeta(group);
                                const Icon = ICON_MAP[meta.icon] || HelpCircle;
                                return (
                                    <div key={group} style={{ marginBottom: '10px' }}>
                                        <div className="section-label flex-center gap-2" style={{ padding: '4px var(--space-2)', color: meta.color, fontSize: 'var(--text-sm)' }}>
                                            <Icon size={12} />
                                            {group}
                                        </div>
                                        {docs.map(doc => {
                                            const isSelected = selectedDocs.some(s => s.docId === doc.id);
                                            const isExpiredDoc = doc.expirationDate && new Date(doc.expirationDate) < new Date();
                                            return (
                                                <label key={doc.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-md)', cursor: 'pointer', marginBottom: '2px', background: isSelected ? `${meta.color}0A` : 'transparent', border: `1px solid ${isSelected ? meta.color + '40' : 'transparent'}`, transition: 'all 0.15s ease' }}>
                                                    <input type="checkbox" checked={isSelected} onChange={() => onToggleMatch(req, doc.id)} style={{ width: '14px', height: '14px', accentColor: meta.color, flexShrink: 0 }} />
                                                    <div className="flex-1">
                                                        <div style={{ fontSize: '0.8125rem', fontWeight: isSelected ? 600 : 500, color: isSelected ? meta.color : 'var(--color-text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{doc.docType}</div>
                                                        <div style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                            {doc.fileName}
                                                            {isExpiredDoc && <span style={{ color: 'var(--color-danger)', fontWeight: 'var(--font-bold)', marginLeft: 'var(--space-2)' }}>Vencido</span>}
                                                        </div>
                                                    </div>
                                                    <a href={`${API_BASE_URL}${doc.fileUrl}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-text-tertiary)', display: 'flex', padding: '4px', flexShrink: 0 }} onClick={e => e.stopPropagation()} title="Visualizar">
                                                        <Eye size={14} />
                                                    </a>
                                                </label>
                                            );
                                        })}
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}


// ──────────────────────────────────────────────────────────────────────
// Main Component
// ──────────────────────────────────────────────────────────────────────
export function DossierExporter({ biddings, companies }: Props) {
    const d = useDossierExporter({ biddings, companies });

    return (
        <div className="flex-col gap-6">
            {/* ── Top Bar: Config ── */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 'var(--space-4)', alignItems: 'end', padding: 'var(--space-6)', borderRadius: 'var(--radius-xl)', background: 'linear-gradient(135deg, rgba(37,99,235,0.03), rgba(139,92,246,0.03))', border: '1px solid var(--color-border)' }}>
                <div>
                    <label className="form-label flex-center gap-2">
                        <FileArchive size={14} style={{ verticalAlign: '-2px' }} /> Licitação em Preparação
                    </label>
                    <select className="form-select" value={d.selectedBiddingId} onChange={e => d.setSelectedBiddingId(e.target.value)}>
                        <option value="">— Selecione uma Licitação —</option>
                        {d.biddingsWithAnalysis.map(b => (<option key={b.id} value={b.id}>{b.title}</option>))}
                    </select>
                    {d.biddingsWithAnalysis.length === 0 && (
                        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)', marginTop: '4px' }}>
                            Apenas licitações na coluna "Preparando Documentação" com Análise IA aparecem aqui.
                        </p>
                    )}
                </div>

                <div>
                    <label className="form-label flex-center gap-2">
                        <Shield size={14} style={{ verticalAlign: '-2px' }} /> Empresa Participante
                    </label>
                    <select className="form-select" value={d.selectedCompanyId} onChange={e => d.setSelectedCompanyId(e.target.value)} disabled={!d.selectedBiddingId}>
                        <option value="">— Selecione a Empresa —</option>
                        {companies.map(c => (<option key={c.id} value={c.id}>{c.razaoSocial}</option>))}
                    </select>
                </div>

                <div className="flex-col gap-2">
                    <label className="form-label flex-center gap-2 mb-0">Situação</label>
                    <div style={{ display: 'flex', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
                        {(['active', 'expired', 'all'] as const).map(filter => (
                            <button key={filter} onClick={() => d.setDateFilter(filter)}
                                style={{ padding: '9px 14px', fontSize: '0.75rem', fontWeight: 600, background: d.dateFilter === filter ? 'var(--color-primary)' : 'var(--color-bg-surface)', color: d.dateFilter === filter ? 'white' : 'var(--color-text-secondary)', border: 'none', cursor: 'pointer', borderRight: filter !== 'all' ? '1px solid var(--color-border)' : 'none', transition: 'all 0.15s' }}>
                                {filter === 'active' ? 'Válidos' : filter === 'expired' ? 'Vencidos' : 'Todos'}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* ── Score + Export Bar ── */}
            {d.selectedBidding && d.selectedCompany && (
                <div className="flex-between" style={{ padding: 'var(--space-4) var(--space-6)', borderRadius: 'var(--radius-lg)', background: d.readinessScore >= 100 ? 'rgba(34,197,94,0.06)' : d.readinessScore >= 50 ? 'rgba(245,158,11,0.06)' : 'rgba(239,68,68,0.06)', border: `1px solid ${d.readinessScore >= 100 ? 'rgba(34,197,94,0.25)' : d.readinessScore >= 50 ? 'rgba(245,158,11,0.25)' : 'rgba(239,68,68,0.25)'}` }}>
                    <div className="flex-center gap-5">
                        <div style={{ position: 'relative', width: '56px', height: '56px' }}>
                            <svg width="56" height="56" viewBox="0 0 56 56">
                                <circle cx="28" cy="28" r="24" fill="none" stroke="var(--color-border)" strokeWidth="4" />
                                <circle cx="28" cy="28" r="24" fill="none" stroke={d.readinessScore >= 100 ? 'var(--color-success)' : d.readinessScore >= 50 ? 'var(--color-warning)' : 'var(--color-danger)'} strokeWidth="4" strokeLinecap="round" strokeDasharray={`${(d.readinessScore / 100) * 150.8} 150.8`} transform="rotate(-90 28 28)" />
                            </svg>
                            <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.8rem', fontWeight: 800, color: d.readinessScore >= 100 ? 'var(--color-success)' : d.readinessScore >= 50 ? 'var(--color-warning)' : 'var(--color-danger)' }}>
                                {Math.round(d.readinessScore)}%
                            </span>
                        </div>
                        <div>
                            <div style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--font-bold)', color: 'var(--color-text-primary)' }}>Índice de Prontidão</div>
                            <div className="flex-center gap-4" style={{ marginTop: '4px', fontSize: 'var(--text-sm)' }}>
                                <span style={{ color: 'var(--color-success)', fontWeight: 'var(--font-semibold)', display: 'inline-flex', alignItems: 'center', gap: '3px' }}><CheckCircle2 size={13} /> {d.satisfiedCount} vinculados</span>
                                <span style={{ color: 'var(--color-danger)', fontWeight: 'var(--font-semibold)', display: 'inline-flex', alignItems: 'center', gap: '3px' }}><XCircle size={13} /> {d.pendingCount} pendentes</span>
                                {d.ignoredCount > 0 && <span style={{ color: 'var(--color-neutral)', fontWeight: 'var(--font-semibold)' }}>{d.ignoredCount} ignorados</span>}
                            </div>
                        </div>
                    </div>

                    <div className="flex-center gap-3">
                        <button className="btn btn-outline" onClick={d.handleExportPdfReport} disabled={d.requiredList.length === 0}
                            style={{ padding: 'var(--space-3) var(--space-5)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)', borderRadius: 'var(--radius-lg)', fontWeight: 'var(--font-semibold)', fontSize: 'var(--text-md)', border: '1px solid rgba(139,92,246,0.3)', color: 'var(--color-ai)', background: 'var(--color-ai-bg)' }}
                            title="Exportar relatório PDF de conformidade documental">
                            <ClipboardList size={16} /> Relatório PDF
                        </button>
                        <button className="btn btn-primary" onClick={d.handleExportZip} disabled={d.isExporting || d.matchedDocs.length === 0}
                            style={{ padding: 'var(--space-3) var(--space-7)', display: 'flex', alignItems: 'center', gap: 'var(--space-3)', background: d.matchedDocs.length > 0 ? 'linear-gradient(135deg, var(--color-primary), var(--color-ai))' : undefined, borderRadius: 'var(--radius-lg)', fontWeight: 'var(--font-bold)', fontSize: 'var(--text-md)', boxShadow: d.matchedDocs.length > 0 ? '0 4px 12px rgba(37,99,235,0.25)' : undefined }}>
                            {d.isExporting ? <Loader2 size={18} className="spin" /> : <Package size={18} />}
                            {d.isExporting ? 'Gerando ZIP...' : `Exportar Dossiê (${d.matchedDocs.length} doc${d.matchedDocs.length !== 1 ? 's' : ''})`}
                        </button>
                    </div>
                </div>
            )}

            {/* ── AI Badge ── */}
            {d.selectedBidding && d.selectedCompany && (d.isAiLoading || d.aiApplied) && (
                <div className="flex-center gap-3" style={{ padding: 'var(--space-3) var(--space-5)', borderRadius: 'var(--radius-lg)', background: d.isAiLoading ? 'linear-gradient(135deg, rgba(245,158,11,0.06), rgba(139,92,246,0.06))' : 'linear-gradient(135deg, rgba(139,92,246,0.06), rgba(59,130,246,0.06))', border: `1px solid ${d.isAiLoading ? 'rgba(245,158,11,0.3)' : 'rgba(139,92,246,0.2)'}` }}>
                    {d.isAiLoading ? (
                        <>
                            <Loader2 size={16} color="var(--color-warning)" className="spin" />
                            <span style={{ fontSize: '0.8125rem', color: 'var(--color-warning-hover)', fontWeight: 600 }}>Gemini analisando correspondências...</span>
                            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>— A IA está avaliando {d.requiredList.length} exigências contra {d.companyDocs.length} documentos.</span>
                        </>
                    ) : (
                        <>
                            <ScanSearch size={16} color="var(--color-ai)" />
                            <span style={{ fontSize: '0.8125rem', color: 'var(--color-ai)', fontWeight: 600 }}>Correspondência Inteligente (Gemini) aplicada</span>
                            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>— A IA pré-selecionou {d.satisfiedCount} documento(s) automaticamente. Revise e ajuste conforme necessário.</span>
                        </>
                    )}
                </div>
            )}

            {/* ── Requirements List ── */}
            {d.selectedBidding && d.selectedCompany ? (
                <div className="flex-col gap-2">
                    <h3 className="flex-center gap-2" style={{ margin: '0 0 4px 0', fontSize: 'var(--text-lg)', fontWeight: 'var(--font-bold)', color: 'var(--color-text-primary)' }}>
                        <FileArchive size={18} color="var(--color-primary)" />
                        Exigências do Edital ({d.requiredList.length})
                    </h3>
                    {d.requiredList.map((reqObj, idx) => {
                        const reqText = reqObj.description;
                        const manualIds = d.manualMatches[reqText] || [];
                        const isIgnored = manualIds.includes('IGNORAR');
                        const selectedDocsForReq = isIgnored ? [] : manualIds
                            .filter(id => id !== 'IGNORAR')
                            .map(id => { const doc = d.companyDocs.find(dd => dd.id === id); return doc ? { docId: doc.id, fileName: doc.fileName, url: doc.fileUrl } : null; })
                            .filter(Boolean) as { docId: string; fileName: string; url: string }[];

                        return (
                            <RequirementCard key={idx} req={reqText} reqItem={reqObj.item || ''} selectedDocs={selectedDocsForReq} isIgnored={isIgnored} companyDocs={d.companyDocs} onToggleMatch={d.toggleMatch} note={d.oracleNotes[reqText]} />
                        );
                    })}
                </div>
            ) : (
                <div className="empty-state" style={{ padding: 'var(--space-20) var(--space-10)', borderRadius: 'var(--radius-xl)', border: '2px dashed var(--color-border)' }}>
                    <FileArchive size={56} style={{ marginBottom: 'var(--space-4)', opacity: 0.25 }} />
                    <h3 style={{ margin: '0 0 var(--space-2) 0', color: 'var(--color-text-secondary)', fontWeight: 'var(--font-bold)' }}>Montador Inteligente de Dossiê</h3>
                    <p style={{ margin: 0, maxWidth: '400px', lineHeight: 1.5, fontSize: 'var(--text-md)' }}>
                        Selecione uma Licitação e uma Empresa acima. A IA irá pré-vincular automaticamente os documentos corretos a cada exigência do edital.
                    </p>
                </div>
            )}
        </div>
    );
}
