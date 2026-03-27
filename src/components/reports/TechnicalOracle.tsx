import { Upload, Search, FileText, Trash2, HardHat, FileBadge, CheckCircle2, AlertTriangle, XCircle, Info, Building2, ChevronRight, Layers, Package } from 'lucide-react';
import type { BiddingProcess, CompanyProfile } from '../../types';
import { ConfirmDialog } from '../ui';
import { useTechnicalOracle, CATEGORIES_HIERARCHY } from '../hooks/useTechnicalOracle';

interface Props {
    biddings: BiddingProcess[];
    companies: CompanyProfile[];
    onRefresh?: () => void;
    initialBiddingId?: string;
}

export function TechnicalOracle({ biddings, companies, onRefresh, initialBiddingId }: Props) {
    const o = useTechnicalOracle({ biddings, onRefresh, initialBiddingId });

    return (
        <>
        <div style={{ display: 'grid', gridTemplateColumns: '400px 1fr', gap: 'var(--space-6)', height: 'calc(100vh - 250px)' }}>
            {/* Left Column: List and Upload */}
            <div className="flex-col" style={{ background: 'var(--color-bg-surface)', padding: 'var(--space-4)', overflow: 'hidden', borderRadius: 'var(--radius-xl)', boxShadow: '0 2px 8px rgba(0,0,0,0.04), 0 0 0 1px var(--color-border)' }}>
                <div className="mb-5">
                    <h3 className="flex-center gap-2" style={{ margin: '0 0 var(--space-2) 0', fontSize: 'var(--text-xl)' }}>
                        <FileBadge size={20} color="var(--color-primary)" /> Acervo Técnico
                    </h3>
                    <p style={{ margin: 0, fontSize: 'var(--text-base)', color: 'var(--color-text-tertiary)' }}>
                        Selecione os atestados para somatório e análise.
                    </p>
                </div>

                {/* Upload Zone */}
                <div style={{ marginBottom: 'var(--space-5)', background: 'var(--color-bg-secondary)', padding: 'var(--space-4)', borderRadius: 'var(--radius-xl)', border: 'none', boxShadow: '0 0 0 1px var(--color-border)' }}>
                    <div className="mb-4">
                        <label className="form-label section-label">Vincular à Empresa</label>
                        <div className="pos-relative">
                            <Building2 size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-tertiary)', zIndex: 1 }} />
                            <select className="form-control" style={{ width: '100%', paddingLeft: '36px', fontSize: 'var(--text-base)', height: '42px', background: 'var(--color-bg-surface)', border: 'none', boxShadow: '0 1px 2px rgba(0,0,0,0.05), 0 0 0 1px var(--color-border)', borderRadius: 'var(--radius-lg)', transition: 'all 0.2s ease', cursor: 'pointer' }}
                                value={o.selectedCompanyId} onChange={(e) => o.setSelectedCompanyId(e.target.value)}>
                                <option value="">Selecione a empresa...</option>
                                {companies.map(c => <option key={c.id} value={c.id}>{c.razaoSocial}</option>)}
                            </select>
                        </div>
                    </div>

                    <div className="mb-4">
                        <label className="form-label section-label">Categoria do Acervo</label>
                        <div className="pos-relative">
                            <Layers size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-tertiary)', zIndex: 1 }} />
                            <select className="form-control" style={{ width: '100%', paddingLeft: '36px', fontSize: 'var(--text-base)', height: '42px', background: 'var(--color-bg-surface)', border: 'none', boxShadow: '0 1px 2px rgba(0,0,0,0.05), 0 0 0 1px var(--color-border)', borderRadius: 'var(--radius-lg)', transition: 'all 0.2s ease', cursor: 'pointer' }}
                                value={o.selectedCategory} onChange={(e) => o.setSelectedCategory(e.target.value)}>
                                <option value="">Selecione uma categoria...</option>
                                {Object.entries(CATEGORIES_HIERARCHY).map(([group, cats]) => (
                                    <optgroup key={group} label={group}>
                                        {cats.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                                    </optgroup>
                                ))}
                                <option value="Outros">Outros</option>
                            </select>
                        </div>
                    </div>

                    <label className="btn btn-primary w-full" style={{ justifyContent: 'center', height: '42px', opacity: (o.isUploading || !o.selectedCompanyId) ? 0.7 : 1, cursor: (o.isUploading || !o.selectedCompanyId) ? 'not-allowed' : 'pointer', fontWeight: 'var(--font-bold)' }}>
                        {o.isUploading ? 'Processando IA...' : 'Enviar Novo Atestado'}
                        <Upload size={18} />
                        <input type="file" hidden onChange={o.handleFileUpload} disabled={o.isUploading || !o.selectedCompanyId} accept=".pdf" />
                    </label>
                    {o.uploadError && (
                        <div className="info-panel info-panel--danger mt-3">
                            <AlertTriangle size={14} /> {o.uploadError}
                        </div>
                    )}
                </div>

                {/* Search */}
                <div style={{ marginBottom: 'var(--space-5)' }}>
                    <label className="form-label section-label">Busca por Objeto</label>
                    <div className="input-group pos-relative">
                        <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-tertiary)', zIndex: 1 }} />
                        <input type="text" placeholder="Descreva o que procura no acervo..." className="form-control"
                            style={{ paddingLeft: '40px', height: '42px', fontSize: 'var(--text-base)', width: '100%', background: 'var(--color-bg-surface)', border: 'none', boxShadow: '0 1px 2px rgba(0,0,0,0.05), 0 0 0 1px var(--color-border)', borderRadius: 'var(--radius-lg)', transition: 'all 0.2s ease' }}
                            value={o.searchTerm} onChange={(e) => o.setSearchTerm(e.target.value)} />
                    </div>
                </div>

                {/* Certificate List */}
                <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', padding: '4px' }}>
                    {o.isLoading ? (
                        <div style={{ textAlign: 'center', padding: '20px', color: 'var(--color-text-tertiary)' }}>Carregando...</div>
                    ) : Object.keys(o.groupedCertificates).length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '20px', color: 'var(--color-text-tertiary)', fontSize: '0.9rem' }}>Nenhum atestado encontrado.</div>
                    ) : (
                        Object.entries(o.groupedCertificates).map(([companyName, certs]) => (
                            <div key={companyName} style={{ marginBottom: '4px' }}>
                                <div onClick={() => o.toggleCompanyExpansion(companyName)} style={{ padding: 'var(--space-3)', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-lg)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)', cursor: 'pointer', fontWeight: 'var(--font-semibold)', fontSize: 'var(--text-base)', color: 'var(--color-text-primary)', border: 'none', boxShadow: '0 0 0 1px var(--color-border)', transition: 'var(--transition-fast)' }}>
                                    <Building2 size={16} color="var(--color-primary)" />
                                    <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{companyName}</span>
                                    <span style={{ fontSize: '0.7rem', background: 'var(--color-border)', padding: '2px 6px', borderRadius: '10px', minWidth: '20px', textAlign: 'center' }}>{certs.length}</span>
                                    <ChevronRight size={16} style={{ transform: o.expandedCompanies.has(companyName) ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s ease', opacity: 0.5 }} />
                                </div>

                                {o.expandedCompanies.has(companyName) && (
                                    <div style={{ padding: '8px 0 8px 12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        {certs.map(cert => (
                                            <div key={cert.id} onClick={() => o.setViewingCert(cert)}
                                                style={{ padding: 'var(--space-3)', borderRadius: 'var(--radius-lg)', border: 'none', boxShadow: o.viewingCert?.id === cert.id ? '0 4px 12px rgba(0,0,0,0.06), 0 0 0 2px var(--color-primary)' : o.selectedCertIds.has(cert.id) ? '0 0 0 1px var(--color-primary)' : '0 0 0 1px var(--color-border)', background: o.viewingCert?.id === cert.id ? 'var(--color-bg-surface)' : o.selectedCertIds.has(cert.id) ? 'rgba(37, 99, 235, 0.04)' : 'var(--color-bg-surface)', cursor: 'pointer', transition: 'all 0.2s', position: 'relative' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                                                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', flex: 1, paddingRight: '8px' }}>
                                                        <input type="checkbox" checked={o.selectedCertIds.has(cert.id)} onChange={() => {}} onClick={(e) => o.toggleCertSelection(cert.id, e)} style={{ cursor: 'pointer', width: '16px', height: '16px', margin: 0 }} />
                                                        <span style={{ fontSize: '0.65rem', background: 'var(--color-bg-secondary)', padding: '2px 6px', borderRadius: '4px', fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase', display: 'flex', alignItems: 'center' }}>{cert.type}</span>
                                                        {cert.category && <span style={{ fontSize: '0.65rem', background: 'var(--color-primary-light)', padding: '2px 6px', borderRadius: 'var(--radius-sm)', fontWeight: 'var(--font-bold)', color: 'var(--color-primary)', border: '1px solid var(--color-primary-border)', display: 'flex', alignItems: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '140px' }}>{cert.category}</span>}
                                                    </div>
                                                    <button onClick={(e) => { e.stopPropagation(); o.handleDeleteCert(cert.id); }} style={{ background: 'none', border: 'none', color: 'var(--color-text-tertiary)', cursor: 'pointer', padding: '2px', flexShrink: 0 }}>
                                                        <Trash2 size={14} />
                                                    </button>
                                                </div>
                                                <h4 style={{ margin: 0, fontSize: 'var(--text-base)', fontWeight: 'var(--font-semibold)', color: 'var(--color-text-primary)', wordBreak: 'break-word', lineHeight: '1.4' }}>{cert.title}</h4>
                                                <p style={{ margin: '4px 0 0 0', fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)', opacity: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{cert.issuer}</p>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Right Column: Details and Analysis */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)', overflowY: 'auto', paddingBottom: 'var(--space-6)' }}>
                {/* Comparison Header */}
                <div style={{ padding: 'var(--space-5)', border: 'none', borderRadius: 'var(--radius-xl)', boxShadow: '0 2px 8px rgba(0,0,0,0.04), 0 0 0 1px var(--color-border)', background: 'var(--color-bg-surface)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
                        <h3 style={{ margin: 0, fontSize: 'var(--text-xl)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                            <HardHat size={22} color="var(--color-warning)" /> Oráculo de Somatório
                        </h3>
                        {o.selectedCertIds.size > 0 && (
                            <span style={{ fontSize: 'var(--text-base)', background: 'var(--color-warning-bg)', color: 'var(--color-warning-hover)', padding: 'var(--space-1) var(--space-3)', borderRadius: 'var(--radius-full)', fontWeight: 'var(--font-bold)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)', border: '1px solid var(--color-warning-border)' }}>
                                <Layers size={14} /> {o.selectedCertIds.size} atestado(s) selecionado(s) para soma
                            </span>
                        )}
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
                        <div style={{ flex: 1 }}>
                            <select className="form-control" style={{ width: '100%' }} value={o.selectedBiddingId || ''} onChange={(e) => o.setSelectedBiddingId(e.target.value)}>
                                <option value="">Selecione uma licitação para análise conjunta...</option>
                                {o.biddingsWithAnalysis.map(b => <option key={b.id} value={b.id}>{b.title}</option>)}
                            </select>
                        </div>
                        {!o.analysisResult ? (
                            <button className="btn btn-primary" disabled={!o.selectedBiddingId || o.selectedCertIds.size === 0 || o.isAnalyzing} onClick={o.handleAnalyzeCompatibility} style={{ padding: '10px 24px' }}>
                                {o.isAnalyzing ? 'Processando Somatório...' : 'Analisar Somatório'}
                            </button>
                        ) : (
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <button className="btn btn-primary" onClick={o.handleAddToDossier} style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: '8px' }} title="Vincular certificados selecionados ao Dossiê desta licitação">
                                    <Package size={16} /> Adicionar ao Dossiê
                                </button>
                                <button className="btn btn-outline" onClick={o.handleNewSearch} style={{ padding: '10px 16px' }} title="Zerar análise e começar nova pesquisa">
                                    <Layers size={16} /> Nova Pesquisa
                                </button>
                            </div>
                        )}
                    </div>
                    {o.selectedCertIds.size === 0 && !o.analysisResult && (
                        <div style={{ marginTop: 'var(--space-3)', padding: 'var(--space-3) var(--space-4)', background: 'var(--color-primary-light)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-primary-border)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                            <Info size={16} color="var(--color-primary)" style={{ flexShrink: 0 }} />
                            <span style={{ fontSize: 'var(--text-base)', color: 'var(--color-primary)', fontWeight: 'var(--font-medium)' }}>
                                Selecione ao menos um atestado na lista lateral para iniciar a análise.
                            </span>
                        </div>
                    )}
                </div>

                {/* Analysis Results */}
                {o.analysisResult && (
                    <div style={{ padding: 'var(--space-6)', borderRadius: 'var(--radius-xl)', border: 'none', boxShadow: `0 4px 16px rgba(0,0,0,0.08), 0 0 0 2px ${o.analysisResult.overallStatus === 'Apto' ? 'var(--color-success)' : o.analysisResult.overallStatus === 'Risco' ? 'var(--color-warning)' : 'var(--color-danger)'}`, background: 'var(--color-bg-surface)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-6)' }}>
                            {o.analysisResult.overallStatus === 'Apto' ? <CheckCircle2 color="var(--color-success)" size={36} /> :
                                o.analysisResult.overallStatus === 'Risco' ? <AlertTriangle color="var(--color-warning)" size={36} /> :
                                    <XCircle color="var(--color-danger)" size={36} />}
                            <div>
                                <h3 style={{ margin: 0, fontSize: 'var(--text-3xl)', fontWeight: 'var(--font-bold)' }}>Parecer do Oráculo: {o.analysisResult.overallStatus}</h3>
                                <p style={{ margin: 0, fontSize: 'var(--text-base)', color: 'var(--color-text-tertiary)' }}>Análise fundamentada considerando o somatório do acervo técnico.</p>
                            </div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                            {o.analysisResult.analysis.map((item, idx) => (
                                <div key={idx} style={{ padding: 'var(--space-5)', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-4)' }}>
                                        <div style={{ flex: 1, paddingRight: 'var(--space-5)' }}>
                                            <h4 style={{ margin: '0 0 6px 0', fontSize: 'var(--text-sm)', textTransform: 'uppercase', color: 'var(--color-text-tertiary)', letterSpacing: '0.05em' }}>Exigência do Edital</h4>
                                            <p style={{ margin: 0, fontSize: 'var(--text-lg)', color: 'var(--color-text-primary)', fontWeight: 'var(--font-semibold)', lineHeight: '1.4' }}>{item.requirement}</p>
                                        </div>
                                        <span style={{ padding: 'var(--space-2) var(--space-4)', borderRadius: 'var(--radius-full)', fontSize: 'var(--text-base)', fontWeight: 'var(--font-bold)', textTransform: 'uppercase',
                                            background: item.status === 'Atende' ? 'var(--color-success-bg)' : item.status === 'Similar' ? 'var(--color-warning-bg)' : 'var(--color-danger-bg)',
                                            color: item.status === 'Atende' ? 'var(--color-success-hover)' : item.status === 'Similar' ? 'var(--color-warning-hover)' : 'var(--color-danger-hover)',
                                            border: `1px solid ${item.status === 'Atende' ? 'var(--color-success)' : item.status === 'Similar' ? 'var(--color-warning)' : 'var(--color-danger)'}` }}>
                                            {item.status}
                                        </span>
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 'var(--space-5)', fontSize: 'var(--text-base)' }}>
                                        <div style={{ background: 'var(--color-bg-surface)', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                                            <div style={{ color: 'var(--color-text-tertiary)', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: 'var(--space-2)', fontSize: 'var(--text-sm)', fontWeight: 'var(--font-semibold)' }}><FileBadge size={14} /> COMPROVAÇÃO INTEGRADA</div>
                                            <p style={{ margin: '0 0 var(--space-2) 0', fontWeight: 'var(--font-semibold)', color: 'var(--color-primary)' }}>{item.foundExperience}</p>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px dashed var(--color-border)', paddingTop: 'var(--space-2)' }}>
                                                <span style={{ fontSize: 'var(--text-base)', color: 'var(--color-text-secondary)' }}>Total Somado:</span>
                                                <span style={{ fontSize: 'var(--text-xl)', fontWeight: 'var(--font-bold)' }}>{item.foundQuantity?.toLocaleString()}</span>
                                            </div>
                                            <div style={{ marginTop: 'var(--space-3)', fontSize: 'var(--text-base)', color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>
                                                <strong>Atestados utilizados:</strong> {item.matchingCertificate}
                                            </div>
                                        </div>
                                        <div style={{ background: 'var(--color-primary-light)', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', border: '1px solid rgba(37, 99, 235, 0.1)' }}>
                                            <div style={{ color: 'var(--color-primary)', display: 'flex', alignItems: 'center', gap: '4px', marginBottom: 'var(--space-2)', fontSize: 'var(--text-sm)', fontWeight: 'var(--font-bold)' }}><Info size={14} /> FUNDAMENTAÇÃO</div>
                                            <p style={{ margin: 0, fontSize: 'var(--text-base)', lineHeight: '1.5', color: 'var(--color-text-secondary)' }}>{item.justification}</p>
                                        </div>
                                    </div>
                                    {item.missing && (
                                        <div style={{ marginTop: 'var(--space-4)', padding: 'var(--space-3) var(--space-4)', background: 'var(--color-danger-bg)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-danger-border)', fontSize: 'var(--text-base)', color: 'var(--color-danger-hover)', display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                                            <AlertTriangle size={16} /> <span><strong>Déficit de Qualificação:</strong> {item.missing}</span>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* Certificate Details */}
                {o.viewingCert ? (
                    <div style={{ padding: 'var(--space-6)', borderRadius: 'var(--radius-xl)', background: 'var(--color-bg-surface)', border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.04), 0 0 0 1px var(--color-border)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 'var(--space-6)' }}>
                            <div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: '4px' }}>
                                    <span style={{ fontSize: 'var(--text-sm)', background: 'var(--color-primary)', color: 'white', padding: '2px var(--space-2)', borderRadius: 'var(--radius-sm)', fontWeight: 'var(--font-bold)' }}>{o.viewingCert.type}</span>
                                    {o.viewingCert.category && <span style={{ fontSize: 'var(--text-sm)', background: 'var(--color-primary-light)', color: 'var(--color-primary)', padding: '2px var(--space-2)', borderRadius: 'var(--radius-sm)', fontWeight: 'var(--font-bold)', border: '1px solid var(--color-primary-border)' }}>{o.viewingCert.category}</span>}
                                    <h2 style={{ margin: 0, fontSize: 'var(--text-3xl)', fontWeight: 'var(--font-bold)' }}>{o.viewingCert.title}</h2>
                                </div>
                                <p style={{ margin: 0, color: 'var(--color-text-tertiary)', fontSize: 'var(--text-base)', fontWeight: 'var(--font-medium)' }}>
                                    <strong>Emissor:</strong> {o.viewingCert.issuer} {o.viewingCert.issueDate && `• ${new Date(o.viewingCert.issueDate).toLocaleDateString()}`}
                                </p>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-4)', marginTop: 'var(--space-2)', fontSize: 'var(--text-base)' }}>
                                    <p style={{ margin: 0, color: 'var(--color-text-secondary)' }}><strong>Empresa Executora:</strong> {o.viewingCert.executingCompany || o.viewingCert.company?.razaoSocial || '-'}</p>
                                    <p style={{ margin: 0, color: 'var(--color-text-secondary)' }}><strong>Responsável Técnico:</strong> {o.viewingCert.technicalResponsible || '-'}</p>
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <button className={`btn ${o.selectedCertIds.has(o.viewingCert.id) ? 'btn-primary' : 'btn-outline'}`} onClick={(e) => o.toggleCertSelection(o.viewingCert!.id, e)}>
                                    {o.selectedCertIds.has(o.viewingCert.id) ? 'Remover do Somatório' : 'Selecionar para Somatório'}
                                </button>
                                <a href={o.viewingCert.fileUrl} target="_blank" rel="noreferrer" className="btn btn-secondary">Visualizar PDF</a>
                            </div>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-6)' }}>
                            <div>
                                <h4 style={{ fontSize: 'var(--text-base)', textTransform: 'uppercase', color: 'var(--color-text-tertiary)', letterSpacing: '0.05em', marginBottom: 'var(--space-3)', fontWeight: 'var(--font-bold)' }}>Objeto do Documento</h4>
                                <div style={{ background: 'var(--color-bg-secondary)', padding: 'var(--space-4)', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-base)', lineHeight: '1.6', whiteSpace: 'pre-wrap', border: '1px solid var(--color-border)' }}>
                                    {o.viewingCert.object || 'Objeto não extraído.'}
                                </div>
                            </div>
                            <div>
                                <h4 style={{ fontSize: 'var(--text-base)', textTransform: 'uppercase', color: 'var(--color-text-tertiary)', letterSpacing: '0.05em', marginBottom: 'var(--space-3)', fontWeight: 'var(--font-bold)' }}>Experiências Técnicas (Granular)</h4>
                                <div style={{ display: 'flex', flexDirection: 'column', background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
                                    {o.viewingCert.experiences?.map((exp, idx) => (
                                        <div key={exp.id || idx} style={{ padding: 'var(--space-4)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: idx < o.viewingCert!.experiences!.length - 1 ? '1px solid var(--color-border)' : 'none' }}>
                                            <div style={{ flex: 1, paddingRight: 'var(--space-4)' }}>
                                                <div style={{ fontSize: 'var(--text-base)', fontWeight: 'var(--font-semibold)', color: 'var(--color-text-primary)', wordBreak: 'break-word', lineHeight: '1.4' }}>{exp.description}</div>
                                                <div style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', fontWeight: 500, marginTop: '4px' }}>{exp.category}</div>
                                            </div>
                                            <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                                                <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--color-primary)' }}>
                                                    {exp.quantity?.toLocaleString() || '-'} <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>{exp.unit}</span>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                    {(!o.viewingCert.experiences || o.viewingCert.experiences.length === 0) && (
                                        <div style={{ padding: 'var(--space-5)', textAlign: 'center', fontSize: '0.9rem', color: 'var(--color-text-tertiary)', fontStyle: 'italic' }}>Nenhuma experiência técnica listada para este documento.</div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="card empty-state--centered" style={{ background: 'var(--color-bg-secondary)', borderStyle: 'dashed', padding: 'var(--space-8)' }}>
                        <FileText size={48} style={{ opacity: 0.08, marginBottom: 'var(--space-3)' }} />
                        <h3 style={{ margin: 0, fontSize: 'var(--text-xl)', fontWeight: 'var(--font-semibold)', color: 'var(--color-text-secondary)' }}>Nenhum atestado selecionado</h3>
                        <div style={{ marginTop: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', maxWidth: '340px', textAlign: 'left' }}>
                            <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-start' }}>
                                <span style={{ background: 'var(--color-primary-light)', color: 'var(--color-primary)', borderRadius: 'var(--radius-full)', width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--text-sm)', fontWeight: 700, flexShrink: 0 }}>1</span>
                                <span style={{ fontSize: 'var(--text-base)', color: 'var(--color-text-tertiary)' }}>Clique em um atestado na lista lateral para ver seus detalhes</span>
                            </div>
                            <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-start' }}>
                                <span style={{ background: 'var(--color-primary-light)', color: 'var(--color-primary)', borderRadius: 'var(--radius-full)', width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--text-sm)', fontWeight: 700, flexShrink: 0 }}>2</span>
                                <span style={{ fontSize: 'var(--text-base)', color: 'var(--color-text-tertiary)' }}>Marque os checkboxes para selecionar múltiplos atestados</span>
                            </div>
                            <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-start' }}>
                                <span style={{ background: 'var(--color-primary-light)', color: 'var(--color-primary)', borderRadius: 'var(--radius-full)', width: 24, height: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--text-sm)', fontWeight: 700, flexShrink: 0 }}>3</span>
                                <span style={{ fontSize: 'var(--text-base)', color: 'var(--color-text-tertiary)' }}>Use "Analisar Somatório" para verificar a conformidade</span>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
            <ConfirmDialog open={!!o.confirmDeleteId} title="Excluir Acervo" message="Tem certeza que deseja excluir este acervo? Esta ação não pode ser desfeita."
                variant="danger" confirmLabel="Excluir" onConfirm={o.executeDeleteCert} onCancel={() => o.setConfirmDeleteId(null)} />
        </>
    );
}
