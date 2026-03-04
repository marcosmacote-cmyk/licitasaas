import { useState, useMemo, useEffect, useRef } from 'react';
import { CheckCircle2, FileArchive, Loader2, Search, ChevronDown, ChevronUp, XCircle, Sparkles, Shield, FileSearch, Briefcase, FileText, HelpCircle, AlertTriangle, Eye, Package } from 'lucide-react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { API_BASE_URL } from '../../config';
import type { BiddingProcess, CompanyProfile, CompanyDocument } from '../../types';

interface Props {
    biddings: BiddingProcess[];
    companies: CompanyProfile[];
}

const DOCUMENT_GROUP_META: Record<string, { icon: any; color: string; priority: number }> = {
    'Habilitação Jurídica': { icon: Shield, color: '#3b82f6', priority: 1 },
    'Regularidade Fiscal, Social e Trabalhista': { icon: FileSearch, color: '#10b981', priority: 2 },
    'Qualificação Técnica': { icon: Briefcase, color: '#8b5cf6', priority: 3 },
    'Qualificação Econômica Financeira': { icon: FileText, color: '#f59e0b', priority: 4 },
    'Declarações': { icon: Sparkles, color: '#ec4899', priority: 5 },
    'Outros': { icon: HelpCircle, color: '#64748b', priority: 99 },
};

function getGroupMeta(group: string) {
    return DOCUMENT_GROUP_META[group] || DOCUMENT_GROUP_META['Outros'];
}

// ──────────────────────────────────────────────────────────────────────
// Smart AI matching engine — synonym-aware, category-driven scoring
// ──────────────────────────────────────────────────────────────────────

// Normalize text: lowercase, remove accents, trim
function norm(text: string): string {
    return (text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

// Synonym dictionary: each entry maps a "canonical key" to terms that are semantically equivalent
const SYNONYM_MAP: Record<string, string[]> = {
    // Habilitação Jurídica
    'contrato_social': ['contrato social', 'ato constitutivo', 'estatuto social', 'requerimento de empresario', 'registro comercial', 'certificado mei', 'constituicao'],
    'procuracao': ['procuracao', 'substabelecimento', 'carta de preposto', 'credenciamento'],
    'identidade': ['rg', 'documento de identidade', 'carteira de identidade', 'cedula de identidade', 'cnh', 'cpf', 'identidade do representante'],
    'cnpj': ['cnpj', 'comprovante de inscricao', 'cartao cnpj'],
    'alvara': ['alvara', 'licenca de funcionamento', 'licenca municipal'],

    // Regularidade Fiscal
    'cnd_federal': ['certidao conjunta', 'cnd federal', 'certidao negativa de debitos federais', 'receita federal', 'divida ativa da uniao', 'pgfn', 'tributos federais', 'cnd rfb'],
    'cnd_estadual': ['certidao negativa estadual', 'fazenda estadual', 'tributos estaduais', 'debitos estaduais', 'sefaz', 'icms'],
    'cnd_municipal': ['certidao negativa municipal', 'fazenda municipal', 'tributos municipais', 'debitos municipais', 'iss', 'issqn'],
    'fgts': ['fgts', 'crf', 'certificado de regularidade', 'fundo de garantia', 'caixa economica'],
    'inss': ['inss', 'previdencia', 'previdenciaria', 'seguridade social', 'contribuicoes previdenciarias'],
    'cndt': ['cndt', 'certidao negativa de debitos trabalhistas', 'justica do trabalho', 'debitos trabalhistas', 'trabalhista'],
    'simples_nacional': ['simples nacional', 'optante pelo simples', 'das', 'mei'],

    // Qualificação Técnica
    'atestado_tecnico': ['atestado de capacidade tecnica', 'atestado tecnico', 'acervo tecnico', 'certidao de acervo', 'cat', 'declaracao de capacidade'],
    'registro_conselho': ['crea', 'cau', 'crq', 'crf', 'conselho de classe', 'registro profissional', 'crm', 'oab', 'crc'],
    'responsavel_tecnico': ['responsavel tecnico', 'rt', 'art', 'rrt', 'anotacao de responsabilidade'],

    // Qualificação Econômico-Financeira
    'balanco': ['balanco patrimonial', 'balanco', 'demonstracoes contabeis', 'demonstracoes financeiras', 'dre', 'demonstracao de resultado'],
    'certidao_falencia': ['certidao de falencia', 'recuperacao judicial', 'certidao negativa de falencia', 'concordata'],
    'patrimonio_liquido': ['patrimonio liquido', 'capital social', 'indices contabeis', 'liquidez', 'solvencia'],
    'garantia': ['garantia de proposta', 'caucao', 'seguro-garantia', 'fianca bancaria'],

    // Declarações
    'declaracao_menores': ['declaracao de que nao emprega menores', 'emprega menor', 'trabalho infantil', 'menores de 18', 'decreto 6481', 'menor aprendiz'],
    'declaracao_impedimento': ['declaracao de que nao esta impedido', 'impedimento', 'inidoneo', 'inidoneidade', 'suspensao', 'proibicao de contratar'],
    'declaracao_fatos': ['declaracao de fatos supervenientes', 'fatos impeditivos', 'superveniencia'],
    'declaracao_me_epp': ['declaracao me', 'microempresa', 'epp', 'empresa de pequeno porte', 'lei complementar 123'],
    'declaracao_parentesco': ['nepotismo', 'parentesco', 'vinculo familiar', 'declaracao de parentesco'],
    'declaracao_visita': ['declaracao de vistoria', 'visita tecnica', 'declaracao de visita', 'vistoria', 'conhecimento do local'],
};

// Category detection: map requirement text to document group
const CATEGORY_SIGNATURES: Record<string, string[]> = {
    'Habilitação Jurídica': ['contrato social', 'ato constitutivo', 'estatuto', 'procuracao', 'registro comerci', 'alvara', 'cnpj', 'junta comercial', 'identidade', 'rg', 'cpf'],
    'Regularidade Fiscal, Social e Trabalhista': ['fiscal', 'tribut', 'fgts', 'inss', 'cndt', 'trabalhi', 'certidao negativa', 'debito', 'fazenda', 'receita', 'municipal', 'estadual', 'federal', 'previdenc', 'crf', 'regularidade'],
    'Qualificação Técnica': ['tecnic', 'atestado', 'acervo', 'crea', 'cau', 'responsavel tecn', 'capacidade tecn', 'art', 'rrt'],
    'Qualificação Econômica Financeira': ['balanco', 'patrimonio', 'liquidez', 'economic', 'financeir', 'contab', 'falencia', 'recuperacao judicial', 'solvencia', 'capital social'],
    'Declarações': ['declaracao', 'declaro', 'compromisso', 'menor', 'impediment', 'fatos', 'vistoria', 'visita', 'nepotism'],
};

function detectCategory(text: string): string | null {
    const n = norm(text);
    let bestGroup: string | null = null;
    let bestScore = 0;
    for (const [group, signatures] of Object.entries(CATEGORY_SIGNATURES)) {
        const hits = signatures.filter(s => n.includes(s)).length;
        if (hits > bestScore) { bestScore = hits; bestGroup = group; }
    }
    return bestScore > 0 ? bestGroup : null;
}

function scoreDocAgainstRequirement(doc: CompanyDocument, reqText: string): number {
    const reqNorm = norm(reqText);
    const docTypeNorm = norm(doc.docType);
    const docNameNorm = norm(doc.fileName);
    const docGroupNorm = norm(doc.docGroup);
    const combinedDoc = `${docTypeNorm} ${docNameNorm} ${docGroupNorm}`;

    // 1. Perfect match (100)
    if (docTypeNorm === reqNorm) return 100;

    let score = 0;

    // 2. Synonym matching (up to 65 pts)
    for (const synonyms of Object.values(SYNONYM_MAP)) {
        const reqHitCount = synonyms.filter(s => reqNorm.includes(s)).length;
        const docHitCount = synonyms.filter(s => combinedDoc.includes(s)).length;
        if (reqHitCount > 0 && docHitCount > 0) {
            // Both req and doc match the same synonym family
            const familyScore = Math.min(65, 35 + (reqHitCount + docHitCount) * 10);
            score = Math.max(score, familyScore);
        }
    }

    // 3. Strong substring containment (up to 55 pts)
    if (docTypeNorm.length > 4 && reqNorm.length > 4) {
        if (reqNorm.includes(docTypeNorm)) score = Math.max(score, 55);
        if (docTypeNorm.includes(reqNorm)) score = Math.max(score, 55);
    }

    // 4. N-gram keyword matching (up to 35 pts additive)
    const reqWords = reqNorm.split(/[\s,;.()/-]+/).filter(w => w.length > 2);
    if (reqWords.length > 0) {
        let matched = 0;
        for (const word of reqWords) {
            if (combinedDoc.includes(word)) matched++;
        }
        const ratio = matched / reqWords.length;
        score += Math.round(ratio * 35);
    }

    // 5. Category alignment bonus (up to 20 pts)
    const reqCategory = detectCategory(reqText);
    if (reqCategory) {
        const docCategory = doc.docGroup || '';
        if (norm(docCategory) === norm(reqCategory)) {
            score += 20;
        } else if (detectCategory(doc.docType) === reqCategory) {
            score += 15;
        }
    }

    // 6. Penalty for expired docs
    if (doc.expirationDate && new Date(doc.expirationDate) < new Date()) {
        score = Math.round(score * 0.7);
    }

    return Math.min(score, 100);
}

function findBestMatches(docs: CompanyDocument[], reqText: string, maxResults: number = 3): { doc: CompanyDocument; score: number }[] {
    const scored = docs.map(doc => ({ doc, score: scoreDocAgainstRequirement(doc, reqText) }));
    return scored
        .filter(s => s.score >= 20)
        .sort((a, b) => b.score - a.score)
        .slice(0, maxResults);
}

// ──────────────────────────────────────────────────────────────────────
// RequirementCard component
// ──────────────────────────────────────────────────────────────────────
function RequirementCard({
    idx: _idx,
    req,
    reqItem,
    selectedDocs,
    isIgnored,
    companyDocs,
    onToggleMatch,
}: {
    idx: number;
    req: string;
    reqItem: string;
    selectedDocs: { docId: string; fileName: string; url: string }[];
    isIgnored: boolean;
    companyDocs: CompanyDocument[];
    onToggleMatch: (requirement: string, docId: string) => void;
}) {
    const [isExpanded, setIsExpanded] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');

    const isSatisfied = selectedDocs.length > 0;

    // Group company docs by docGroup for display
    const groupedDocs = useMemo(() => {
        const groups: Record<string, CompanyDocument[]> = {};
        const sortedDocs = [...companyDocs].sort((a, b) => {
            const gA = getGroupMeta(a.docGroup).priority;
            const gB = getGroupMeta(b.docGroup).priority;
            return gA - gB;
        });

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

    const statusColor = isIgnored ? '#94a3b8' : isSatisfied ? '#22c55e' : '#ef4444';
    const statusBg = isIgnored ? 'rgba(148,163,184,0.06)' : isSatisfied ? 'rgba(34,197,94,0.04)' : 'rgba(239,68,68,0.04)';

    return (
        <div style={{
            borderRadius: '12px',
            border: `1px solid ${isIgnored ? 'var(--color-border)' : isSatisfied ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.25)'}`,
            background: statusBg,
            overflow: 'hidden',
            transition: 'all 0.2s ease',
        }}>
            {/* Header */}
            <div
                style={{
                    padding: '14px 18px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    cursor: 'pointer',
                    userSelect: 'none',
                }}
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div style={{
                    width: '28px', height: '28px', borderRadius: '50%',
                    background: statusColor + '18',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0,
                    border: `2px solid ${statusColor}40`,
                }}>
                    {isIgnored ? (
                        <XCircle size={14} color={statusColor} />
                    ) : isSatisfied ? (
                        <CheckCircle2 size={14} color={statusColor} />
                    ) : (
                        <AlertTriangle size={14} color={statusColor} />
                    )}
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {reqItem && (
                            <span style={{
                                padding: '2px 8px', borderRadius: '4px',
                                background: 'var(--color-primary)', color: 'white',
                                fontSize: '0.65rem', fontWeight: 700, flexShrink: 0,
                                letterSpacing: '0.05em',
                            }}>{reqItem}</span>
                        )}
                        <span style={{
                            fontSize: '0.875rem', fontWeight: 600,
                            color: isIgnored ? 'var(--color-text-tertiary)' : 'var(--color-text-primary)',
                            textDecoration: isIgnored ? 'line-through' : 'none',
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>
                            {req}
                        </span>
                    </div>
                    {isSatisfied && !isIgnored && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginTop: '6px' }}>
                            {selectedDocs.map(doc => (
                                <span key={doc.docId} style={{
                                    padding: '2px 10px', borderRadius: '12px',
                                    background: 'rgba(34,197,94,0.1)', color: '#16a34a',
                                    fontSize: '0.7rem', fontWeight: 600,
                                    display: 'flex', alignItems: 'center', gap: '4px',
                                    maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                }}>
                                    <CheckCircle2 size={10} /> {doc.fileName}
                                </span>
                            ))}
                        </div>
                    )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                    <label
                        style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.7rem', fontWeight: 500, cursor: 'pointer', color: 'var(--color-text-tertiary)', padding: '4px 8px', borderRadius: '6px', background: isIgnored ? 'rgba(148,163,184,0.12)' : 'transparent', border: '1px solid var(--color-border)' }}
                        onClick={e => e.stopPropagation()}
                    >
                        <input
                            type="checkbox"
                            checked={isIgnored}
                            onChange={() => onToggleMatch(req, 'IGNORAR')}
                            style={{ width: '12px', height: '12px' }}
                        />
                        N/A
                    </label>
                    {isExpanded ? <ChevronUp size={16} color="var(--color-text-tertiary)" /> : <ChevronDown size={16} color="var(--color-text-tertiary)" />}
                </div>
            </div>

            {/* Expanded Document Picker */}
            {isExpanded && !isIgnored && (
                <div style={{
                    borderTop: '1px solid var(--color-border)',
                    padding: '14px 18px',
                    background: 'var(--color-bg-surface)',
                }}>
                    {/* Search */}
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: '8px',
                        padding: '8px 12px', borderRadius: '8px',
                        border: '1px solid var(--color-border)',
                        background: 'var(--color-bg-body)',
                        marginBottom: '12px',
                    }}>
                        <Search size={14} color="var(--color-text-tertiary)" />
                        <input
                            type="text"
                            placeholder="Buscar documento por nome, tipo ou grupo..."
                            value={searchTerm}
                            onChange={e => setSearchTerm(e.target.value)}
                            style={{
                                border: 'none', background: 'transparent', outline: 'none',
                                width: '100%', fontSize: '0.8125rem', color: 'var(--color-text-primary)',
                            }}
                        />
                        {searchTerm && (
                            <button onClick={() => setSearchTerm('')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: 'var(--color-text-tertiary)' }}>
                                <XCircle size={14} />
                            </button>
                        )}
                    </div>

                    {/* Grouped docs */}
                    <div style={{ maxHeight: '280px', overflowY: 'auto', paddingRight: '4px' }}>
                        {Object.keys(filteredGroups).length === 0 ? (
                            <p style={{ textAlign: 'center', color: 'var(--color-text-tertiary)', fontSize: '0.8rem', padding: '16px' }}>
                                {searchTerm ? 'Nenhum documento encontrado para esta busca.' : 'Nenhum documento cadastrado nesta empresa.'}
                            </p>
                        ) : (
                            Object.entries(filteredGroups).map(([group, docs]) => {
                                const meta = getGroupMeta(group);
                                const Icon = meta.icon;
                                return (
                                    <div key={group} style={{ marginBottom: '10px' }}>
                                        <div style={{
                                            display: 'flex', alignItems: 'center', gap: '6px',
                                            padding: '4px 8px', marginBottom: '4px',
                                            fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase',
                                            color: meta.color, letterSpacing: '0.05em',
                                        }}>
                                            <Icon size={12} />
                                            {group}
                                        </div>
                                        {docs.map(doc => {
                                            const isSelected = selectedDocs.some(s => s.docId === doc.id);
                                            const isExpired = doc.expirationDate && new Date(doc.expirationDate) < new Date();
                                            return (
                                                <label
                                                    key={doc.id}
                                                    style={{
                                                        display: 'flex', alignItems: 'center', gap: '10px',
                                                        padding: '8px 10px', borderRadius: '8px',
                                                        cursor: 'pointer', marginBottom: '2px',
                                                        background: isSelected ? `${meta.color}0A` : 'transparent',
                                                        border: `1px solid ${isSelected ? meta.color + '40' : 'transparent'}`,
                                                        transition: 'all 0.15s ease',
                                                    }}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={isSelected}
                                                        onChange={() => onToggleMatch(req, doc.id)}
                                                        style={{ width: '14px', height: '14px', accentColor: meta.color, flexShrink: 0 }}
                                                    />
                                                    <div style={{ flex: 1, minWidth: 0 }}>
                                                        <div style={{
                                                            fontSize: '0.8125rem', fontWeight: isSelected ? 600 : 500,
                                                            color: isSelected ? meta.color : 'var(--color-text-primary)',
                                                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                                        }}>
                                                            {doc.docType}
                                                        </div>
                                                        <div style={{
                                                            fontSize: '0.7rem', color: 'var(--color-text-tertiary)',
                                                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                                        }}>
                                                            {doc.fileName}
                                                            {isExpired && <span style={{ color: '#ef4444', fontWeight: 700, marginLeft: '6px' }}>⚠ Vencido</span>}
                                                        </div>
                                                    </div>
                                                    <a
                                                        href={`${API_BASE_URL}${doc.fileUrl}`}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        style={{ color: 'var(--color-text-tertiary)', display: 'flex', padding: '4px', flexShrink: 0 }}
                                                        onClick={e => e.stopPropagation()}
                                                        title="Visualizar"
                                                    >
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
    const [selectedBiddingId, setSelectedBiddingId] = useState('');
    const [selectedCompanyId, setSelectedCompanyId] = useState('');
    const [isExporting, setIsExporting] = useState(false);
    const [dateFilter, setDateFilter] = useState<'all' | 'active' | 'expired'>('active');
    const [manualMatches, setManualMatches] = useState<Record<string, string[]>>({});
    const [aiApplied, setAiApplied] = useState(false);

    const biddingsWithAnalysis = useMemo(() => biddings.filter(b => b.aiAnalysis && b.status === 'Preparando Documentação'), [biddings]);
    const selectedBidding = biddings.find(b => b.id === selectedBiddingId);
    const selectedCompany = companies.find(c => c.id === selectedCompanyId);

    // Parse required documents list
    const requiredList = useMemo(() => {
        if (!selectedBidding?.aiAnalysis) return [];
        try {
            const rawReq = selectedBidding.aiAnalysis.requiredDocuments;
            const parsed = typeof rawReq === 'string' ? JSON.parse(rawReq) : rawReq;
            if (Array.isArray(parsed)) {
                return parsed.map(d => typeof d === 'string' ? { item: '', description: d } : d);
            } else if (typeof parsed === 'object') {
                return Object.values(parsed).flat().map((d: any) => typeof d === 'string' ? { item: '', description: d } : d);
            }
        } catch (e) { }
        return [];
    }, [selectedBidding]);

    // Get filtered company docs
    const companyDocs = useMemo(() => {
        if (!selectedCompany?.documents) return [];
        const now = new Date();
        now.setHours(0, 0, 0, 0);

        return selectedCompany.documents.filter(d => {
            if (dateFilter === 'active') return !d.expirationDate || new Date(d.expirationDate) >= now;
            if (dateFilter === 'expired') return d.expirationDate && new Date(d.expirationDate) < now;
            return true;
        });
    }, [selectedCompany, dateFilter]);

    // Track which combination we've already auto-matched for
    const lastAutoMatchKey = useRef('');

    // Single combined effect: reset + auto-match in one pass (eliminates race condition)
    useEffect(() => {
        const comboKey = `${selectedBiddingId}::${selectedCompanyId}::${dateFilter}`;

        // If the combination hasn't changed, don't re-run
        if (lastAutoMatchKey.current === comboKey) return;

        // Mark this combination as processed
        lastAutoMatchKey.current = comboKey;

        // If inputs are incomplete, just reset
        if (!selectedBiddingId || !selectedCompanyId || companyDocs.length === 0 || requiredList.length === 0) {
            setManualMatches({});
            setAiApplied(false);
            return;
        }

        // Run AI auto-matching
        const autoMatches: Record<string, string[]> = {};
        const usedDocIds = new Set<string>(); // prevent same doc from being assigned twice

        console.log(`[Dossier AI] Matching ${requiredList.length} requirements against ${companyDocs.length} company docs`);

        requiredList.forEach(reqObj => {
            const reqText = reqObj.description;
            if (!reqText) return;

            const bestMatches = findBestMatches(companyDocs, reqText, 3);
            // Pick the best unused match above threshold
            for (const match of bestMatches) {
                if (match.score >= 15 && !usedDocIds.has(match.doc.id)) {
                    autoMatches[reqText] = [match.doc.id];
                    usedDocIds.add(match.doc.id);
                    console.log(`[Dossier AI] ✅ "${reqText.substring(0, 50)}..." → "${match.doc.docType}" (score: ${match.score})`);
                    break;
                }
            }

            if (!autoMatches[reqText]) {
                const topScore = bestMatches.length > 0 ? bestMatches[0].score : 0;
                console.log(`[Dossier AI] ❌ "${reqText.substring(0, 50)}..." → no match (top score: ${topScore})`);
            }
        });

        const matchCount = Object.keys(autoMatches).length;
        console.log(`[Dossier AI] Result: ${matchCount}/${requiredList.length} matched`);

        setManualMatches(autoMatches);
        setAiApplied(true);
    }, [selectedBiddingId, selectedCompanyId, dateFilter, companyDocs, requiredList]);

    // Compute matched docs for export
    const { matchedDocs, readinessScore } = useMemo(() => {
        const matched: { requirement: string; url: string; fileName: string; docId: string }[] = [];
        const satisfiedReqs = new Set<string>();

        requiredList.forEach(reqObj => {
            const reqText = reqObj.description;
            const manualIds = manualMatches[reqText];

            if (manualIds && manualIds.length > 0 && !manualIds.includes('IGNORAR')) {
                manualIds.forEach(id => {
                    const doc = companyDocs.find(d => d.id === id);
                    if (doc) {
                        matched.push({
                            requirement: reqText,
                            url: doc.fileUrl,
                            fileName: doc.fileName || `${reqText.substring(0, 30).replace(/[^a-z0-9]/gi, '_').toLowerCase()}_${id}.pdf`,
                            docId: doc.id,
                        });
                        satisfiedReqs.add(reqText);
                    }
                });
            }
        });

        const ignoredCount = requiredList.filter(r => manualMatches[r.description]?.includes('IGNORAR')).length;
        const effectiveTotal = requiredList.length - ignoredCount;
        const score = effectiveTotal > 0 ? (satisfiedReqs.size / effectiveTotal) * 100 : 0;

        return { matchedDocs: matched, readinessScore: score };
    }, [requiredList, manualMatches, companyDocs]);

    const toggleMatch = (requirement: string, docId: string) => {
        setManualMatches(prev => {
            const current = prev[requirement] || [];
            if (docId === 'IGNORAR') {
                return { ...prev, [requirement]: current.includes('IGNORAR') ? [] : ['IGNORAR'] };
            }
            const next = current.filter(id => id !== 'IGNORAR');
            if (next.includes(docId)) {
                return { ...prev, [requirement]: next.filter(id => id !== docId) };
            } else {
                return { ...prev, [requirement]: [...next, docId] };
            }
        });
    };

    const handleExportZip = async () => {
        if (matchedDocs.length === 0) {
            alert("Não há documentos vinculados para exportar. Vincule ao menos um documento.");
            return;
        }

        try {
            setIsExporting(true);
            const zip = new JSZip();
            const safeBiddingTitle = (selectedBidding?.title || 'Dossie').substring(0, 30).replace(/[^a-z0-9]/gi, '_');
            const folderName = `Dossie_${safeBiddingTitle}`;

            let filesAddedCount = 0;
            const failures: string[] = [];

            for (const doc of matchedDocs) {
                try {
                    let response: Response | null = null;
                    if (doc.url.startsWith('http')) {
                        response = await fetch(doc.url);
                    } else {
                        const docUrl = doc.url.startsWith('/') ? doc.url : `/${doc.url}`;
                        const possibleBases = [
                            API_BASE_URL.endsWith('/') ? API_BASE_URL.slice(0, -1) : API_BASE_URL,
                            window.location.origin,
                            '',
                        ].filter(Boolean);

                        for (const base of possibleBases) {
                            try {
                                const res = await fetch(`${base}${docUrl}`);
                                if (res.ok) { response = res; break; }
                            } catch { continue; }
                        }
                    }

                    if (!response || !response.ok) throw new Error(`Status ${response?.status || 'erro'}`);
                    const blob = await response.blob();
                    if (blob.size === 0) throw new Error("Arquivo vazio");

                    const safeFileName = (doc.fileName || 'arquivo').replace(/[/\\?%*:|"<>]/g, '-').trim();
                    zip.file(`${folderName}/${safeFileName}`, blob);
                    filesAddedCount++;
                } catch (err: any) {
                    failures.push(`${doc.fileName} (${err.message})`);
                }
            }

            if (filesAddedCount === 0) {
                throw new Error("Nenhum arquivo pôde ser capturado." + (failures.length > 0 ? `\n\n• ${failures.join('\n• ')}` : ''));
            }

            if (failures.length > 0) {
                alert(`Aviso: ${failures.length} arquivo(s) falharam, mas o ZIP foi gerado com ${filesAddedCount} documento(s).`);
            }

            const content = await zip.generateAsync({ type: 'blob' });
            saveAs(content, `${folderName}.zip`);
        } catch (error: any) {
            alert(`Erro ao exportar: ${error.message}`);
        } finally {
            setIsExporting(false);
        }
    };

    const satisfiedCount = requiredList.filter(r => {
        const ids = manualMatches[r.description];
        return ids && ids.length > 0 && !ids.includes('IGNORAR');
    }).length;
    const ignoredCount = requiredList.filter(r => manualMatches[r.description]?.includes('IGNORAR')).length;
    const pendingCount = requiredList.length - satisfiedCount - ignoredCount;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

            {/* ── Top Bar: Config ── */}
            <div style={{
                display: 'grid', gridTemplateColumns: '1fr 1fr auto',
                gap: '16px', alignItems: 'end',
                padding: '24px', borderRadius: '16px',
                background: 'linear-gradient(135deg, rgba(37,99,235,0.03), rgba(139,92,246,0.03))',
                border: '1px solid var(--color-border)',
            }}>
                <div>
                    <label style={labelStyle}>
                        <FileArchive size={14} style={{ verticalAlign: '-2px' }} /> Licitação em Preparação
                    </label>
                    <select
                        className="select-input"
                        value={selectedBiddingId}
                        onChange={e => setSelectedBiddingId(e.target.value)}
                        style={selectStyle}
                    >
                        <option value="">— Selecione uma Licitação —</option>
                        {biddingsWithAnalysis.map(b => (
                            <option key={b.id} value={b.id}>{b.title}</option>
                        ))}
                    </select>
                    {biddingsWithAnalysis.length === 0 && (
                        <p style={{ fontSize: '0.7rem', color: '#94a3b8', marginTop: '4px' }}>
                            Apenas licitações na coluna "Preparando Documentação" com Análise IA aparecem aqui.
                        </p>
                    )}
                </div>

                <div>
                    <label style={labelStyle}>
                        <Shield size={14} style={{ verticalAlign: '-2px' }} /> Empresa Participante
                    </label>
                    <select
                        className="select-input"
                        value={selectedCompanyId}
                        onChange={e => setSelectedCompanyId(e.target.value)}
                        style={selectStyle}
                        disabled={!selectedBiddingId}
                    >
                        <option value="">— Selecione a Empresa —</option>
                        {companies.map(c => (
                            <option key={c.id} value={c.id}>{c.razaoSocial}</option>
                        ))}
                    </select>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <label style={{ ...labelStyle, marginBottom: 0 }}>Situação</label>
                    <div style={{ display: 'flex', border: '1px solid var(--color-border)', borderRadius: '10px', overflow: 'hidden' }}>
                        {(['active', 'expired', 'all'] as const).map(filter => (
                            <button
                                key={filter}
                                onClick={() => setDateFilter(filter)}
                                style={{
                                    padding: '9px 14px', fontSize: '0.75rem', fontWeight: 600,
                                    background: dateFilter === filter ? 'var(--color-primary)' : 'var(--color-bg-surface)',
                                    color: dateFilter === filter ? 'white' : 'var(--color-text-secondary)',
                                    border: 'none', cursor: 'pointer',
                                    borderRight: filter !== 'all' ? '1px solid var(--color-border)' : 'none',
                                    transition: 'all 0.15s',
                                }}
                            >
                                {filter === 'active' ? '✅ Válidos' : filter === 'expired' ? '⚠ Vencidos' : '📋 Todos'}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* ── Score + Export Bar ── */}
            {selectedBidding && selectedCompany && (
                <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '16px 24px', borderRadius: '12px',
                    background: readinessScore >= 100 ? 'rgba(34,197,94,0.06)' : readinessScore >= 50 ? 'rgba(245,158,11,0.06)' : 'rgba(239,68,68,0.06)',
                    border: `1px solid ${readinessScore >= 100 ? 'rgba(34,197,94,0.25)' : readinessScore >= 50 ? 'rgba(245,158,11,0.25)' : 'rgba(239,68,68,0.25)'}`,
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                        {/* Circular Score */}
                        <div style={{
                            position: 'relative', width: '56px', height: '56px',
                        }}>
                            <svg width="56" height="56" viewBox="0 0 56 56">
                                <circle cx="28" cy="28" r="24" fill="none" stroke="var(--color-border)" strokeWidth="4" />
                                <circle cx="28" cy="28" r="24" fill="none"
                                    stroke={readinessScore >= 100 ? '#22c55e' : readinessScore >= 50 ? '#f59e0b' : '#ef4444'}
                                    strokeWidth="4" strokeLinecap="round"
                                    strokeDasharray={`${(readinessScore / 100) * 150.8} 150.8`}
                                    transform="rotate(-90 28 28)"
                                />
                            </svg>
                            <span style={{
                                position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: '0.8rem', fontWeight: 800,
                                color: readinessScore >= 100 ? '#22c55e' : readinessScore >= 50 ? '#f59e0b' : '#ef4444',
                            }}>
                                {Math.round(readinessScore)}%
                            </span>
                        </div>

                        {/* Stats */}
                        <div>
                            <div style={{ fontSize: '1rem', fontWeight: 700, color: 'var(--color-text-primary)' }}>
                                Índice de Prontidão
                            </div>
                            <div style={{ display: 'flex', gap: '16px', marginTop: '4px', fontSize: '0.75rem' }}>
                                <span style={{ color: '#22c55e', fontWeight: 600 }}>✅ {satisfiedCount} vinculados</span>
                                <span style={{ color: '#ef4444', fontWeight: 600 }}>❌ {pendingCount} pendentes</span>
                                {ignoredCount > 0 && <span style={{ color: '#94a3b8', fontWeight: 600 }}>⏭ {ignoredCount} ignorados</span>}
                            </div>
                        </div>
                    </div>

                    <button
                        className="btn btn-primary"
                        onClick={handleExportZip}
                        disabled={isExporting || matchedDocs.length === 0}
                        style={{
                            padding: '12px 28px', display: 'flex', alignItems: 'center', gap: '10px',
                            background: matchedDocs.length > 0 ? 'linear-gradient(135deg, var(--color-primary), #4f46e5)' : undefined,
                            borderRadius: '12px', fontWeight: 700, fontSize: '0.875rem',
                            boxShadow: matchedDocs.length > 0 ? '0 4px 12px rgba(37,99,235,0.25)' : undefined,
                        }}
                    >
                        {isExporting ? <Loader2 size={18} className="spin" /> : <Package size={18} />}
                        {isExporting ? 'Gerando ZIP...' : `Exportar Dossiê (${matchedDocs.length} doc${matchedDocs.length !== 1 ? 's' : ''})`}
                    </button>
                </div>
            )}

            {/* ── AI Badge ── */}
            {selectedBidding && selectedCompany && aiApplied && (
                <div style={{
                    display: 'flex', alignItems: 'center', gap: '10px',
                    padding: '10px 18px', borderRadius: '10px',
                    background: 'linear-gradient(135deg, rgba(139,92,246,0.06), rgba(59,130,246,0.06))',
                    border: '1px solid rgba(139,92,246,0.2)',
                }}>
                    <Sparkles size={16} color="#8b5cf6" />
                    <span style={{ fontSize: '0.8125rem', color: '#7c3aed', fontWeight: 600 }}>
                        Correspondência Inteligente aplicada
                    </span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>
                        — A IA pré-selecionou {satisfiedCount} documento(s) automaticamente. Revise e ajuste conforme necessário.
                    </span>
                </div>
            )}

            {/* ── Requirements List ── */}
            {selectedBidding && selectedCompany ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <h3 style={{
                        margin: '0 0 4px 0', fontSize: '1rem', fontWeight: 700,
                        color: 'var(--color-text-primary)',
                        display: 'flex', alignItems: 'center', gap: '8px',
                    }}>
                        <FileArchive size={18} color="var(--color-primary)" />
                        Exigências do Edital ({requiredList.length})
                    </h3>
                    {requiredList.map((reqObj, idx) => {
                        const reqText = reqObj.description;
                        const manualIds = manualMatches[reqText] || [];
                        const isIgnored = manualIds.includes('IGNORAR');
                        const selectedDocsForReq = isIgnored ? [] : manualIds
                            .filter(id => id !== 'IGNORAR')
                            .map(id => {
                                const doc = companyDocs.find(d => d.id === id);
                                return doc ? { docId: doc.id, fileName: doc.fileName, url: doc.fileUrl } : null;
                            })
                            .filter(Boolean) as { docId: string; fileName: string; url: string }[];

                        return (
                            <RequirementCard
                                key={idx}
                                idx={idx}
                                req={reqText}
                                reqItem={reqObj.item || ''}
                                selectedDocs={selectedDocsForReq}
                                isIgnored={isIgnored}
                                companyDocs={companyDocs}
                                onToggleMatch={toggleMatch}
                            />
                        );
                    })}
                </div>
            ) : (
                <div style={{
                    padding: '80px 40px', borderRadius: '16px',
                    background: 'var(--color-bg-surface)',
                    border: '2px dashed var(--color-border)',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    color: 'var(--color-text-tertiary)', textAlign: 'center',
                }}>
                    <FileArchive size={56} style={{ marginBottom: '16px', opacity: 0.25 }} />
                    <h3 style={{ margin: '0 0 8px 0', color: 'var(--color-text-secondary)', fontWeight: 700 }}>Montador Inteligente de Dossiê</h3>
                    <p style={{ margin: 0, maxWidth: '400px', lineHeight: 1.5, fontSize: '0.875rem' }}>
                        Selecione uma Licitação e uma Empresa acima. A IA irá pré-vincular automaticamente os documentos corretos a cada exigência do edital.
                    </p>
                </div>
            )}

            <style>{`
                ::-webkit-scrollbar { width: 6px; }
                ::-webkit-scrollbar-track { background: transparent; }
                ::-webkit-scrollbar-thumb { background: var(--color-border); border-radius: 10px; }
                ::-webkit-scrollbar-thumb:hover { background: var(--color-text-tertiary); }
            `}</style>
        </div>
    );
}

const labelStyle: React.CSSProperties = {
    display: 'flex',
    fontSize: '0.8125rem',
    fontWeight: 600,
    color: 'var(--color-text-secondary)',
    marginBottom: '8px',
    alignItems: 'center',
    gap: '6px',
};

const selectStyle: React.CSSProperties = {
    width: '100%',
    padding: '10px 14px',
    borderRadius: '10px',
    border: '1px solid var(--color-border)',
    background: 'var(--color-bg-surface)',
    color: 'var(--color-text-primary)',
    fontSize: '0.875rem',
    fontWeight: 500,
};
