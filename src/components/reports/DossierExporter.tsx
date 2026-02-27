import { useState, useMemo } from 'react';
import { Download, CheckCircle2, FileArchive, Loader2 } from 'lucide-react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { API_BASE_URL } from '../../config';
import type { BiddingProcess, CompanyProfile } from '../../types';

interface Props {
    biddings: BiddingProcess[];
    companies: CompanyProfile[];
}

export function DossierExporter({ biddings, companies }: Props) {
    const [selectedBiddingId, setSelectedBiddingId] = useState('');
    const [selectedCompanyId, setSelectedCompanyId] = useState('');
    const [isExporting, setIsExporting] = useState(false);
    const [dateFilter, setDateFilter] = useState<'all' | 'active' | 'expired'>('active');
    const [manualMatches, setManualMatches] = useState<Record<string, string[]>>({});
    const [additionalDocs, setAdditionalDocs] = useState<Set<string>>(new Set());
    const [includeRequired, setIncludeRequired] = useState(true);

    const biddingsWithAnalysis = useMemo(() => {
        return biddings.filter(b => b.aiAnalysis);
    }, [biddings]);

    const selectedBidding = biddings.find(b => b.id === selectedBiddingId);
    const selectedCompany = companies.find(c => c.id === selectedCompanyId);

    // Document matching logic
    const { matchedDocs, readinessScore, requiredDocsCount } = useMemo(() => {
        if (!selectedBidding || !selectedBidding.aiAnalysis) {
            return { matchedDocs: [], readinessScore: 0, requiredDocsCount: 0 };
        }

        let requiredList: any[] = [];
        try {
            const rawReq = selectedBidding.aiAnalysis.requiredDocuments;
            const parsed = typeof rawReq === 'string' ? JSON.parse(rawReq) : rawReq;

            if (Array.isArray(parsed)) {
                requiredList = parsed.map(d => typeof d === 'string' ? { item: '', description: d } : d);
            } else if (typeof parsed === 'object') {
                requiredList = Object.values(parsed).flat().map((d: any) => typeof d === 'string' ? { item: '', description: d } : d);
            }
        } catch (e) {
            requiredList = [];
        }

        if (!selectedCompany) {
            return { matchedDocs: [], readinessScore: 0, requiredDocsCount: requiredList.length };
        }

        const now = new Date();
        now.setHours(0, 0, 0, 0);

        let companyDocs = selectedCompany.documents || [];

        // Apply Date Filter
        if (dateFilter === 'active') {
            companyDocs = companyDocs.filter(d => !d.expirationDate || new Date(d.expirationDate) >= now);
        } else if (dateFilter === 'expired') {
            companyDocs = companyDocs.filter(d => d.expirationDate && new Date(d.expirationDate) < now);
        }

        const matched: { requirement: string; url: string; fileName: string; docId: string }[] = [];
        const satisfiedReqs = new Set<string>();

        requiredList.forEach(reqObj => {
            const reqText = reqObj.description;
            const manualIds = manualMatches[reqText];

            if (manualIds && manualIds.length > 0) {
                if (!manualIds.includes('IGNORAR')) {
                    manualIds.forEach(id => {
                        const doc = companyDocs.find(d => d.id === id);
                        if (doc) {
                            matched.push({
                                requirement: reqText,
                                url: doc.fileUrl,
                                fileName: doc.fileName || `${reqText.substring(0, 30).replace(/[^a-z0-9]/gi, '_').toLowerCase()}_${id}.pdf`,
                                docId: doc.id
                            });
                            satisfiedReqs.add(reqText);
                        }
                    });
                }
            } else {
                // Auto-match logic
                const reqLower = reqText.toLowerCase();
                const foundDoc = companyDocs.find(d => {
                    const typeLower = (d.docType || '').toLowerCase();
                    return typeLower.includes(reqLower) || reqLower.includes(typeLower);
                });

                if (foundDoc) {
                    matched.push({
                        requirement: reqText,
                        url: foundDoc.fileUrl,
                        fileName: foundDoc.fileName || `${reqText.substring(0, 30).replace(/[^a-z0-9]/gi, '_').toLowerCase()}.pdf`,
                        docId: foundDoc.id
                    });
                    satisfiedReqs.add(reqText);
                }
            }
        });

        const score = requiredList.length > 0 ? (satisfiedReqs.size / requiredList.length) * 100 : 0;

        return { matchedDocs: matched, readinessScore: score, requiredDocsCount: requiredList.length };
    }, [selectedBidding, selectedCompany, manualMatches]);

    const finalExportDocs = useMemo(() => {
        if (!selectedCompany) return includeRequired ? matchedDocs : [];

        const additional = Array.from(additionalDocs).map(id => {
            const doc = selectedCompany.documents?.find(d => d.id === id);
            if (!doc) return null;
            return {
                requirement: `Manual: ${doc.docType}`,
                url: doc.fileUrl,
                fileName: doc.fileName,
                docId: doc.id
            };
        }).filter(Boolean) as typeof matchedDocs;

        const base = includeRequired ? matchedDocs : [];
        const matchedIds = new Set(base.map(d => d.docId));
        const filteredAdditional = additional.filter(d => !matchedIds.has(d.docId));

        return [...base, ...filteredAdditional];
    }, [matchedDocs, additionalDocs, selectedCompany, includeRequired]);

    const toggleMatch = (requirement: string, docId: string) => {
        setManualMatches(prev => {
            const current = prev[requirement] || [];
            if (docId === 'IGNORAR') return { ...prev, [requirement]: ['IGNORAR'] };

            const next = current.filter(id => id !== 'IGNORAR');
            if (next.includes(docId)) {
                return { ...prev, [requirement]: next.filter(id => id !== docId) };
            } else {
                return { ...prev, [requirement]: [...next, docId] };
            }
        });
    };

    const handleExportZip = async () => {
        if (finalExportDocs.length === 0) {
            alert("Não há documentos selecionados para exportar. Marque os arquivos do edital ou adicione arquivos avulsos.");
            return;
        }

        try {
            setIsExporting(true);
            const zip = new JSZip();

            // Refined folder name without trailing spaces or problematic chars
            const safeBiddingTitle = (selectedBidding?.title || 'Dossie').substring(0, 30).replace(/[^a-z0-9]/gi, '_');
            const folderName = `Dossie_${safeBiddingTitle}`;

            let filesAdded = 0;

            for (const doc of finalExportDocs) {
                try {
                    let fullUrl = '';

                    if (doc.url.startsWith('http')) {
                        fullUrl = doc.url;
                    } else {
                        // Normalize docUrl
                        const docUrl = doc.url.startsWith('/') ? doc.url : `/${doc.url}`;

                        // If API_BASE_URL is relative or empty, use relative path directly
                        if (!API_BASE_URL || !API_BASE_URL.startsWith('http')) {
                            fullUrl = docUrl;
                        } else {
                            const baseUrl = API_BASE_URL.endsWith('/') ? API_BASE_URL.slice(0, -1) : API_BASE_URL;
                            fullUrl = `${baseUrl}${docUrl}`;
                        }
                    }

                    console.log(`Dossier Export - Attempting fetch: ${fullUrl}`);

                    let response = await fetch(fullUrl);

                    // Fallback to purely relative if absolute fails (common in Railway/Proxy setups)
                    if (!response.ok && fullUrl.startsWith('http')) {
                        const relativeUrl = doc.url.startsWith('/') ? doc.url : `/${doc.url}`;
                        console.log(`Fallback fetch to relative: ${relativeUrl}`);
                        response = await fetch(relativeUrl);
                    }

                    if (!response.ok) {
                        console.warn(`Failed to fetch ${doc.fileName} from any location.`);
                        continue;
                    }

                    const blob = await response.blob();
                    if (blob.size === 0) {
                        console.warn(`File is empty: ${doc.fileName}`);
                        continue;
                    }

                    // Use a safe file name
                    const safeFileName = doc.fileName.replace(/[^a-z0-9.-]/gi, '_');

                    // Add directly to root or a folder
                    zip.file(`${folderName}/${safeFileName}`, blob);
                    filesAdded++;
                } catch (err) {
                    console.error(`Error adding file ${doc.fileName} to ZIP:`, err);
                }
            }

            if (filesAdded === 0) {
                throw new Error("Nenhum arquivo pôde ser baixado com sucesso.");
            }

            const content = await zip.generateAsync({ type: 'blob' });
            saveAs(content, `${folderName}.zip`);

        } catch (error: any) {
            console.error("Export error", error);
            alert(`Erro ao exportar o pacote ZIP: ${error.message || 'Erro desconhecido'}`);
        } finally {
            setIsExporting(false);
        }
    };

    return (
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 1fr) 2fr', gap: '32px' }}>

            {/* Left Column: Form Setup */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <div style={{ background: 'var(--color-bg-surface)', padding: '24px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }}>
                    <h3 style={{ margin: '0 0 16px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <FileArchive size={20} color="var(--color-primary)" /> Configuração do Dossiê
                    </h3>

                    <div style={{ marginBottom: '16px' }}>
                        <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.875rem', fontWeight: 500 }}>1. Selecione a Licitação (com Análise de IA)</label>
                        <select
                            className="select-input"
                            value={selectedBiddingId}
                            onChange={(e) => setSelectedBiddingId(e.target.value)}
                            style={{ width: '100%' }}
                        >
                            <option value="">-- Selecione uma Licitação --</option>
                            {biddingsWithAnalysis.map(b => (
                                <option key={b.id} value={b.id}>{b.title}</option>
                            ))}
                        </select>
                        {biddingsWithAnalysis.length === 0 && (
                            <p style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)', marginTop: '4px' }}>
                                Apenas licitações que utilizaram "Extrair Edital (IA)" aparecem aqui.
                            </p>
                        )}
                    </div>

                    <div style={{ marginBottom: '16px' }}>
                        <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.875rem', fontWeight: 500 }}>2. Selecione a Empresa Participante</label>
                        <select
                            className="select-input"
                            value={selectedCompanyId}
                            onChange={(e) => setSelectedCompanyId(e.target.value)}
                            style={{ width: '100%' }}
                            disabled={!selectedBiddingId}
                        >
                            <option value="">-- Selecione a Empresa --</option>
                            {companies.map(c => (
                                <option key={c.id} value={c.id}>{c.razaoSocial}</option>
                            ))}
                        </select>
                    </div>

                    <div style={{ marginBottom: '0' }}>
                        <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.875rem', fontWeight: 500 }}>3. Situação dos Documentos</label>
                        <div style={{ display: 'flex', border: '1px solid var(--color-border)', borderRadius: '6px', overflow: 'hidden' }}>
                            {(['active', 'expired', 'all'] as const).map((filter) => (
                                <button
                                    key={filter}
                                    onClick={() => setDateFilter(filter)}
                                    style={{
                                        flex: 1,
                                        padding: '8px',
                                        fontSize: '0.75rem',
                                        background: dateFilter === filter ? 'var(--color-primary)' : 'var(--color-bg-body)',
                                        color: dateFilter === filter ? 'white' : 'var(--color-text-primary)',
                                        border: 'none',
                                        cursor: 'pointer',
                                        borderRight: filter !== 'all' ? '1px solid var(--color-border)' : 'none',
                                        fontWeight: 500
                                    }}
                                >
                                    {filter === 'active' ? 'Válidos' : filter === 'expired' ? 'Vencidos' : 'Todos'}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Score Summary Card */}
                {selectedBidding && selectedCompany && (
                    <div style={{ background: 'var(--color-bg-surface)', padding: '24px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', textAlign: 'center' }}>
                        <div style={{ width: '120px', height: '120px', borderRadius: '50%', margin: '0 auto 16px auto', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '2.5rem', fontWeight: 'bold', border: `8px solid ${readinessScore >= 100 ? '#22c55e' : readinessScore >= 50 ? '#f59e0b' : '#ef4444'} `, color: readinessScore >= 100 ? '#22c55e' : readinessScore >= 50 ? '#f59e0b' : '#ef4444' }}>
                            {Math.round(readinessScore)}%
                        </div>
                        <h4 style={{ margin: '0 0 8px 0', fontSize: '1.25rem' }}>Índice de Prontidão</h4>
                        <p style={{ margin: 0, color: 'var(--color-text-secondary)', fontSize: '0.9rem' }}>
                            A empresa possui {matchedDocs.length} de {requiredDocsCount} arquivos obrigatórios.
                        </p>
                    </div>
                )}
            </div>

            {/* Right Column: Preview & Download */}
            <div>
                {selectedBidding ? (
                    <div style={{ background: 'var(--color-bg-surface)', padding: '24px', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', height: '100%', display: 'flex', flexDirection: 'column' }}>
                        <div className="flex-between" style={{ marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
                            <h3 style={{ margin: 0 }}>Pré-visualização do Dossiê</h3>

                            <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
                                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.875rem', fontWeight: 500, cursor: 'pointer', color: 'var(--color-text-secondary)' }}>
                                    <input
                                        type="checkbox"
                                        checked={includeRequired}
                                        onChange={(e) => setIncludeRequired(e.target.checked)}
                                    />
                                    Incluir Documentos do Edital
                                </label>

                                <button
                                    className="btn btn-primary flex-gap"
                                    onClick={handleExportZip}
                                    disabled={isExporting || finalExportDocs.length === 0}
                                >
                                    {isExporting ? <Loader2 size={18} className="spin" /> : <Download size={18} />}
                                    {isExporting ? 'Zipando...' : 'Baixar ZIP Consolidado'}
                                </button>
                            </div>
                        </div>

                        <div style={{ flex: 1, overflowY: 'auto', paddingRight: '8px' }}>
                            {/* Requirements List (Matched and Missing) */}
                            {(() => {
                                // Group matchedDocs by requirement
                                const groupedMatched: Record<string, { requirement: string; url: string; fileName: string; docId: string }[]> = {};
                                matchedDocs.forEach(d => {
                                    if (!groupedMatched[d.requirement]) groupedMatched[d.requirement] = [];
                                    groupedMatched[d.requirement].push(d);
                                });

                                // All requirements from analysis
                                let allReqs: string[] = [];
                                try {
                                    const rawReq = selectedBidding.aiAnalysis?.requiredDocuments;
                                    const parsed = typeof rawReq === 'string' ? JSON.parse(rawReq) : rawReq;
                                    if (Array.isArray(parsed)) {
                                        allReqs = parsed.map(d => typeof d === 'string' ? d : (d.description || ''));
                                    } else if (typeof parsed === 'object') {
                                        allReqs = Object.values(parsed).flat().map((d: any) => typeof d === 'string' ? d : (d.description || ''));
                                    }
                                } catch (e) { }

                                return (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                                        {allReqs.map((req, idx) => {
                                            const isIgnored = manualMatches[req]?.includes('IGNORAR');
                                            const docs = groupedMatched[req] || [];
                                            const isSatisfied = docs.length > 0;

                                            return (
                                                <div key={idx} style={{
                                                    padding: '16px',
                                                    background: isIgnored ? 'var(--color-bg-surface-hover)' : isSatisfied ? 'rgba(34, 197, 94, 0.03)' : 'rgba(239, 68, 68, 0.03)',
                                                    borderLeft: `4px solid ${isIgnored ? 'var(--color-border)' : isSatisfied ? 'var(--color-success)' : 'var(--color-danger)'}`,
                                                    borderRadius: '8px',
                                                    border: '1px solid var(--color-border)'
                                                }}>
                                                    <div style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                                        <span style={{ flex: 1 }}>{req}</span>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.75rem', fontWeight: 500, cursor: 'pointer', color: 'var(--color-text-tertiary)' }}>
                                                                <input
                                                                    type="checkbox"
                                                                    checked={isIgnored}
                                                                    onChange={() => toggleMatch(req, 'IGNORAR')}
                                                                /> Ignorar
                                                            </label>
                                                        </div>
                                                    </div>

                                                    {!isIgnored && (
                                                        <>
                                                            {/* Selected Docs for this requirement */}
                                                            {docs.length > 0 && (
                                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
                                                                    {docs.map(doc => (
                                                                        <div key={doc.docId} style={{ background: 'var(--color-bg-surface)', border: '1px solid var(--color-success)', color: 'var(--color-success)', padding: '4px 10px', borderRadius: '20px', fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                                            <CheckCircle2 size={12} />
                                                                            {doc.fileName}
                                                                            <button
                                                                                onClick={() => toggleMatch(req, doc.docId)}
                                                                                style={{ background: 'none', border: 'none', color: 'var(--color-danger)', cursor: 'pointer', padding: '0 2px', fontWeight: 'bold' }}
                                                                            >
                                                                                ×
                                                                            </button>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}

                                                            {/* Multi-select Dropdown / Picker */}
                                                            <div style={{ position: 'relative' }}>
                                                                <p style={{ margin: '0 0 6px 0', fontSize: '0.75rem', color: 'var(--color-text-tertiary)', fontWeight: 500 }}>Vincular Documentos da Empresa:</p>
                                                                <div style={{ maxHeight: '150px', overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: '6px', background: 'var(--color-bg-body)', padding: '8px' }}>
                                                                    {selectedCompany?.documents?.map(d => {
                                                                        const isSelected = manualMatches[req]?.includes(d.id) || docs.some(m => m.docId === d.id);
                                                                        return (
                                                                            <label key={d.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 6px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem', background: isSelected ? 'var(--color-primary-light)' : 'transparent', marginBottom: '2px' }}>
                                                                                <input
                                                                                    type="checkbox"
                                                                                    checked={isSelected}
                                                                                    onChange={() => toggleMatch(req, d.id)}
                                                                                />
                                                                                <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                                                    {d.docType} ({d.fileName})
                                                                                </span>
                                                                            </label>
                                                                        );
                                                                    })}
                                                                    {(!selectedCompany?.documents || selectedCompany.documents.length === 0) && (
                                                                        <p style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)', textAlign: 'center', padding: '8px' }}>Nenhum documento cadastrado nesta empresa.</p>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                );
                            })()}

                            {/* Manual Selection Section (Floating docs) */}
                            {selectedCompany && (
                                <div style={{ marginTop: '40px', borderTop: '2px dashed var(--color-border)', paddingTop: '24px' }}>
                                    <div className="flex-between" style={{ marginBottom: '16px' }}>
                                        <h4 style={{ color: 'var(--color-primary)', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                                            <Download size={18} /> Adicionar outros arquivos (fora das exigências)
                                        </h4>
                                        <div style={{ display: 'flex', gap: '8px' }}>
                                            <button
                                                onClick={() => {
                                                    const allIds = selectedCompany.documents?.map(d => d.id) || [];
                                                    setAdditionalDocs(new Set(allIds));
                                                }}
                                                style={{ fontSize: '0.7rem', padding: '4px 8px', background: 'none', border: '1px solid var(--color-border)', borderRadius: '4px', cursor: 'pointer' }}
                                            >
                                                Marcar Todos
                                            </button>
                                            <button
                                                onClick={() => setAdditionalDocs(new Set())}
                                                style={{ fontSize: '0.7rem', padding: '4px 8px', background: 'none', border: '1px solid var(--color-border)', borderRadius: '4px', cursor: 'pointer' }}
                                            >
                                                Limpar
                                            </button>
                                        </div>
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                        {selectedCompany.documents?.map(doc => {
                                            const isAttachedToReq = matchedDocs.some(m => m.docId === doc.id);
                                            const isSelected = additionalDocs.has(doc.id);

                                            return (
                                                <div
                                                    key={doc.id}
                                                    style={{
                                                        padding: '10px',
                                                        borderRadius: '6px',
                                                        border: `1px solid ${isSelected || isAttachedToReq ? 'var(--color-primary)' : 'var(--color-border)'}`,
                                                        background: isAttachedToReq ? 'var(--color-bg-surface-hover)' : isSelected ? 'var(--color-primary-light)' : 'transparent',
                                                        cursor: isAttachedToReq ? 'default' : 'pointer',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '10px',
                                                        opacity: isAttachedToReq ? 0.6 : 1
                                                    }}
                                                    onClick={() => {
                                                        if (isAttachedToReq) return;
                                                        setAdditionalDocs(prev => {
                                                            const next = new Set(prev);
                                                            if (next.has(doc.id)) next.delete(doc.id);
                                                            else next.add(doc.id);
                                                            return next;
                                                        });
                                                    }}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={isSelected || isAttachedToReq}
                                                        disabled={isAttachedToReq}
                                                        readOnly
                                                    />
                                                    <div style={{ fontSize: '0.8rem', overflow: 'hidden' }}>
                                                        <div style={{ fontWeight: 600, whiteSpace: 'nowrap', textOverflow: 'ellipsis', overflow: 'hidden' }}>{doc.docType}</div>
                                                        <div style={{ fontSize: '0.7rem', color: 'var(--color-text-tertiary)' }}>{doc.fileName}</div>
                                                        {isAttachedToReq && <span style={{ fontSize: '0.65rem', color: 'var(--color-success)', fontWeight: 700 }}>Já vinculado</span>}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                ) : (
                    <div style={{ height: '100%', background: 'var(--color-bg-surface)', border: '1px dashed var(--color-border)', borderRadius: 'var(--radius-lg)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', color: 'var(--color-text-tertiary)' }}>
                        <FileArchive size={64} style={{ marginBottom: '16px', opacity: 0.5 }} />
                        <h3 style={{ margin: '0 0 8px 0', color: 'var(--color-text-secondary)' }}>Pré-visualização do Dossiê</h3>
                        <p style={{ margin: 0 }}>Selecione uma Licitação à esquerda para listar os documentos exigidos pelo Edital.</p>
                    </div>
                )}
            </div>

        </div>
    );
}

