import { useState, useMemo, useEffect, useRef } from 'react';
import { CheckCircle2, FileArchive, Loader2, Search, ChevronDown, ChevronUp, XCircle, Sparkles, Shield, FileSearch, Briefcase, FileText, HelpCircle, AlertTriangle, Eye, Package, ClipboardList } from 'lucide-react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { API_BASE_URL } from '../../config';
import type { BiddingProcess, CompanyProfile, CompanyDocument } from '../../types';

interface Props {
    biddings: BiddingProcess[];
    companies: CompanyProfile[];
}

const DOCUMENT_GROUP_META: Record<string, { icon: any; color: string; priority: number }> = {
    'Habilitação Jurídica': { icon: Shield, color: 'var(--color-primary)', priority: 1 },
    'Regularidade Fiscal, Social e Trabalhista': { icon: FileSearch, color: 'var(--color-success)', priority: 2 },
    'Qualificação Técnica': { icon: Briefcase, color: 'var(--color-ai)', priority: 3 },
    'Qualificação Econômica Financeira': { icon: FileText, color: 'var(--color-warning)', priority: 4 },
    'Declarações': { icon: Sparkles, color: 'var(--color-danger)', priority: 5 },
    'Outros': { icon: HelpCircle, color: 'var(--color-neutral)', priority: 99 },
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
    note,
}: {
    idx: number;
    req: string;
    reqItem: string;
    selectedDocs: { docId: string; fileName: string; url: string }[];
    isIgnored: boolean;
    companyDocs: CompanyDocument[];
    onToggleMatch: (requirement: string, docId: string) => void;
    note?: string;
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

    const statusColor = isIgnored ? 'var(--color-neutral)' : isSatisfied ? 'var(--color-success)' : 'var(--color-danger)';
    const statusBg = isIgnored ? 'rgba(148,163,184,0.06)' : isSatisfied ? 'rgba(34,197,94,0.04)' : 'rgba(239,68,68,0.04)';

    return (
        <div style={{
            borderRadius: 'var(--radius-lg)',
            border: `1px solid ${isIgnored ? 'var(--color-border)' : isSatisfied ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.25)'}`,
            background: statusBg,
            overflow: 'hidden',
            transition: 'var(--transition-fast)',
        }}>
            {/* Header */}
            <div
                style={{
                    padding: 'var(--space-4) var(--space-5)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-3)',
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
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                        {reqItem && (
                            <span style={{
                                padding: '2px var(--space-2)', borderRadius: 'var(--radius-sm)',
                                background: 'var(--color-primary)', color: 'white',
                                fontSize: '0.65rem', fontWeight: 'var(--font-bold)', flexShrink: 0,
                                letterSpacing: '0.05em',
                            }}>{reqItem}</span>
                        )}
                        <span style={{
                            fontSize: 'var(--text-md)', fontWeight: 'var(--font-semibold)',
                            color: isIgnored ? 'var(--color-text-tertiary)' : 'var(--color-text-primary)',
                            textDecoration: isIgnored ? 'line-through' : 'none',
                            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>
                            {req}
                        </span>
                    </div>
                    {isSatisfied && !isIgnored && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
                            {note && (
                                <span style={{
                                    padding: '2px var(--space-3)', borderRadius: 'var(--radius-lg)',
                                    background: 'var(--color-primary-light)', color: 'var(--color-primary)',
                                    fontSize: '0.65rem', fontWeight: 'var(--font-bold)',
                                    display: 'flex', alignItems: 'center', gap: '4px', border: '1px solid rgba(56, 189, 248, 0.3)'
                                }}>
                                    <Sparkles size={10} /> {note}
                                </span>
                            )}
                            {selectedDocs.map(doc => (
                                <span key={doc.docId} style={{
                                    padding: '2px var(--space-3)', borderRadius: 'var(--radius-lg)',
                                    background: 'var(--color-success-bg)', color: 'var(--color-success)',
                                    fontSize: 'var(--text-sm)', fontWeight: 'var(--font-semibold)',
                                    display: 'flex', alignItems: 'center', gap: '4px',
                                    maxWidth: '200px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                }}>
                                    <CheckCircle2 size={10} /> {doc.fileName}
                                </span>
                            ))}
                        </div>
                    )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexShrink: 0 }}>
                    <label
                        style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: 'var(--text-sm)', fontWeight: 'var(--font-medium)', cursor: 'pointer', color: 'var(--color-text-tertiary)', padding: '4px var(--space-2)', borderRadius: 'var(--radius-sm)', background: isIgnored ? 'rgba(148,163,184,0.12)' : 'transparent', border: '1px solid var(--color-border)' }}
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
                    padding: 'var(--space-4) var(--space-5)',
                    background: 'var(--color-bg-surface)',
                }}>
                    {/* Search */}
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                        padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--color-border)',
                        background: 'var(--color-bg-body)',
                        marginBottom: 'var(--space-3)',
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
                                            display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                                            padding: '4px var(--space-2)', marginBottom: '4px',
                                            fontSize: 'var(--text-sm)', fontWeight: 'var(--font-bold)', textTransform: 'uppercase',
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
                                                        display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                                                        padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-md)',
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
                                                            {isExpired && <span style={{ color: 'var(--color-danger)', fontWeight: 'var(--font-bold)', marginLeft: 'var(--space-2)' }}>⚠ Vencido</span>}
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
    const [oracleNotes, setOracleNotes] = useState<Record<string, string>>({});
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

    const [isAiLoading, setIsAiLoading] = useState(false);

    // Track which combination we've already auto-matched for
    const lastAutoMatchKey = useRef('');

    // Single combined effect: calls Gemini backend for AI matching, falls back to local
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

        // Async function to call Gemini API
        const runAiMatch = async () => {
            setIsAiLoading(true);
            try {
                const reqTexts = requiredList.map(r => r.description).filter(Boolean);
                const docPayload = companyDocs.map(d => ({
                    id: d.id,
                    docType: d.docType,
                    fileName: d.fileName,
                    docGroup: d.docGroup,
                    expirationDate: d.expirationDate,
                }));

                console.log(`[Dossier] Calling Gemini AI Match: ${reqTexts.length} reqs × ${docPayload.length} docs`);

                const response = await fetch(`${API_BASE_URL}/api/dossier/ai-match`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${localStorage.getItem('token')}`,
                    },
                    body: JSON.stringify({ requirements: reqTexts, documents: docPayload }),
                });

                if (!response.ok) {
                    throw new Error(`API ${response.status}`);
                }

                const data = await response.json();
                console.log(`[Dossier] Gemini matched ${data.matchCount}/${data.totalRequirements}`);

                // --- INTEGRATION WITH ORACLE ---
                const savedEvidence = localStorage.getItem(`oracle_evidence_${selectedBiddingId}`);
                const parsedEvidence = savedEvidence ? JSON.parse(savedEvidence) : {};

                const combinedMatches = { ...(data.matches || {}) };
                const notes: Record<string, string> = {};

                Object.keys(parsedEvidence).forEach(req => {
                    // Combine AI matches with Oracle matches
                    combinedMatches[req] = Array.from(new Set([...(combinedMatches[req] || []), ...parsedEvidence[req].docIds]));
                    notes[req] = parsedEvidence[req].note;
                });

                setManualMatches(combinedMatches);
                setOracleNotes(notes);
                // -----------------------------

                setAiApplied(true);
            } catch (error) {
                console.error('[Dossier] Gemini AI matching failed, falling back to local:', error);

                // Fallback: run local matching
                const autoMatches: Record<string, string[]> = {};
                const usedDocIds = new Set<string>();

                requiredList.forEach(reqObj => {
                    const reqText = reqObj.description;
                    if (!reqText) return;
                    const bestMatches = findBestMatches(companyDocs, reqText, 3);
                    for (const match of bestMatches) {
                        if (match.score >= 25 && !usedDocIds.has(match.doc.id)) {
                            autoMatches[reqText] = [match.doc.id];
                            usedDocIds.add(match.doc.id);
                            break;
                        }
                    }
                });

                setManualMatches(autoMatches);
                setAiApplied(true);
            } finally {
                setIsAiLoading(false);
            }
        };

        runAiMatch();
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

    const handleExportPdfReport = () => {
        if (!selectedBidding || !selectedCompany) return;

        // Landscape A4 for better table fit
        const doc = new jsPDF('l', 'mm', 'a4');
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const now = new Date();
        const dateStr = `${now.getDate().toString().padStart(2, '0')}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getFullYear()} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

        const formatDate = (dateVal: string | undefined | null): string => {
            if (!dateVal) return '-';
            try {
                const d = new Date(dateVal);
                return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;
            } catch { return '-'; }
        };

        const isExpired = (dateVal: string | undefined | null): boolean => {
            if (!dateVal) return false;
            try { return new Date(dateVal) < now; } catch { return false; }
        };

        // ─── Header Bar ───
        doc.setFillColor(30, 58, 138);
        doc.rect(0, 0, pageWidth, 28, 'F');
        // Accent line
        doc.setFillColor(59, 130, 246);
        doc.rect(0, 28, pageWidth, 2, 'F');

        doc.setFontSize(16);
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold');
        doc.text('RELATORIO DE CONFORMIDADE DOCUMENTAL', 14, 12);
        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        doc.text('Exportador de Dossie  |  LicitaSaaS', 14, 18);
        doc.text(`Data: ${dateStr}`, 14, 23);

        // Readiness badge on header right side
        const scoreText = `${Math.round(readinessScore)}%`;
        doc.setFontSize(22);
        doc.setFont('helvetica', 'bold');
        doc.text(scoreText, pageWidth - 14, 16, { align: 'right' });
        doc.setFontSize(7);
        doc.setFont('helvetica', 'normal');
        doc.text('Indice de Prontidao', pageWidth - 14, 22, { align: 'right' });

        // ─── Bidding Info (2-column layout) ───
        let y = 36;
        doc.setTextColor(30, 30, 30);
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.text('DADOS DA LICITACAO', 14, y);

        // Horizontal line
        doc.setDrawColor(220, 220, 220);
        doc.line(14, y + 2, pageWidth - 14, y + 2);
        y += 8;

        doc.setFontSize(8);
        const leftCol = [
            ['Processo', (selectedBidding.title || '-').substring(0, 80)],
            ['Modalidade', selectedBidding.modality || '-'],
            ['Portal', selectedBidding.portal || '-'],
        ];
        const rightCol = [
            ['Empresa', (selectedCompany.razaoSocial || '-').substring(0, 60)],
            ['CNPJ', selectedCompany.cnpj || '-'],
            ['Filtro Docs', dateFilter === 'active' ? 'Apenas validos' : dateFilter === 'expired' ? 'Apenas vencidos' : 'Todos'],
        ];

        leftCol.forEach(([label, value], i) => {
            doc.setFont('helvetica', 'bold');
            doc.text(`${label}:`, 14, y + i * 5);
            doc.setFont('helvetica', 'normal');
            doc.text(String(value), 42, y + i * 5);
        });

        rightCol.forEach(([label, value], i) => {
            const xStart = pageWidth / 2 + 10;
            doc.setFont('helvetica', 'bold');
            doc.text(`${label}:`, xStart, y + i * 5);
            doc.setFont('helvetica', 'normal');
            doc.text(String(value), xStart + 25, y + i * 5);
        });

        y += 18;

        // ─── Readiness Score Box ───
        const boxWidth = pageWidth - 28;
        doc.setFillColor(240, 245, 255);
        doc.roundedRect(14, y, boxWidth, 14, 2, 2, 'F');
        doc.setDrawColor(37, 99, 235);
        doc.roundedRect(14, y, boxWidth, 14, 2, 2, 'S');

        // Progress bar
        const barX = 20;
        const barY = y + 4;
        const barWidth = 60;
        const barHeight = 5;
        doc.setFillColor(226, 232, 240);
        doc.roundedRect(barX, barY, barWidth, barHeight, 2, 2, 'F');
        const fillWidth = Math.min((readinessScore / 100) * barWidth, barWidth);
        if (readinessScore >= 70) doc.setFillColor(34, 197, 94);
        else if (readinessScore >= 40) doc.setFillColor(245, 158, 11);
        else doc.setFillColor(239, 68, 68);
        if (fillWidth > 0) doc.roundedRect(barX, barY, fillWidth, barHeight, 2, 2, 'F');

        // Score text
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(37, 99, 235);
        doc.text(`${Math.round(readinessScore)}% Pronto`, barX + barWidth + 6, barY + 4);

        // Stats
        doc.setFontSize(8);
        doc.setFont('helvetica', 'normal');
        const statsX = barX + barWidth + 50;
        doc.setTextColor(34, 197, 94);
        doc.text(`${satisfiedCount} vinculados`, statsX, barY + 4);
        doc.setTextColor(239, 68, 68);
        doc.text(`${pendingCount} pendentes`, statsX + 35, barY + 4);
        if (ignoredCount > 0) {
            doc.setTextColor(148, 163, 184);
            doc.text(`${ignoredCount} ignorados`, statsX + 70, barY + 4);
        }

        y += 20;

        // ─── Section Title ───
        doc.setFontSize(10);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(30, 30, 30);
        doc.text('ASSOCIACAO DE DOCUMENTOS AS EXIGENCIAS', 14, y);
        doc.setDrawColor(220, 220, 220);
        doc.line(14, y + 2, pageWidth - 14, y + 2);
        y += 5;

        // ─── Table Data ───
        const tableData = requiredList.map((reqObj, idx) => {
            const reqText = reqObj.description;
            const manualIds = manualMatches[reqText] || [];
            const isIgnoredReq = manualIds.includes('IGNORAR');

            if (isIgnoredReq) {
                return [
                    reqObj.item || String(idx + 1),
                    reqText,
                    'N/A (Ignorado)',
                    '-',
                    '-',
                    'N/A',
                ];
            }

            const matchedDocs = manualIds
                .filter(id => id !== 'IGNORAR')
                .map(id => companyDocs.find(d => d.id === id))
                .filter(Boolean) as CompanyDocument[];

            const docName = matchedDocs.length > 0
                ? matchedDocs.map(d => d.docType || d.fileName).join('; ')
                : '-';

            const docFile = matchedDocs.length > 0
                ? matchedDocs.map(d => d.fileName || '-').join('; ')
                : '-';

            const expDate = matchedDocs.length > 0
                ? matchedDocs.map(d => formatDate(d.expirationDate)).join('; ')
                : '-';

            const status = matchedDocs.length > 0 ? 'VINCULADO' : 'PENDENTE';

            return [
                reqObj.item || String(idx + 1),
                reqText,
                docName,
                docFile,
                expDate,
                status,
            ];
        });

        autoTable(doc, {
            head: [['#', 'Exigencia do Edital', 'Documento', 'Arquivo', 'Vencimento', 'Status']],
            body: tableData,
            startY: y,
            theme: 'grid',
            headStyles: {
                fillColor: [30, 58, 138],
                textColor: 255,
                fontSize: 7,
                fontStyle: 'bold',
                cellPadding: 2.5,
                halign: 'center',
            },
            bodyStyles: {
                fontSize: 6.5,
                cellPadding: 2,
                lineColor: [220, 220, 220],
                textColor: [40, 40, 40],
                overflow: 'linebreak',
            },
            columnStyles: {
                0: { cellWidth: 14, halign: 'center', fontStyle: 'bold' },
                1: { cellWidth: 80 },
                2: { cellWidth: 55 },
                3: { cellWidth: 55 },
                4: { cellWidth: 24, halign: 'center' },
                5: { cellWidth: 22, halign: 'center', fontStyle: 'bold' },
            },
            alternateRowStyles: {
                fillColor: [248, 250, 252],
            },
            didParseCell: (data: any) => {
                if (data.section !== 'body') return;

                // Status column coloring
                if (data.column.index === 5) {
                    const text = String(data.cell.raw);
                    if (text === 'VINCULADO') {
                        data.cell.styles.textColor = [34, 197, 94];
                        data.cell.styles.fillColor = [240, 253, 244];
                    } else if (text === 'PENDENTE') {
                        data.cell.styles.textColor = [220, 38, 38];
                        data.cell.styles.fillColor = [254, 242, 242];
                    } else {
                        data.cell.styles.textColor = [148, 163, 184];
                        data.cell.styles.fillColor = [248, 250, 252];
                    }
                }

                // Expiration date coloring
                if (data.column.index === 4) {
                    const text = String(data.cell.raw);
                    if (text !== '-') {
                        // Check if any matched doc is expired
                        const rowIdx = data.row.index;
                        if (rowIdx < requiredList.length) {
                            const reqText = requiredList[rowIdx]?.description;
                            const ids = manualMatches[reqText] || [];
                            const docs = ids.filter((id: string) => id !== 'IGNORAR').map((id: string) => companyDocs.find(d => d.id === id)).filter(Boolean);
                            const hasExpired = docs.some((d: any) => isExpired(d?.expirationDate));
                            if (hasExpired) {
                                data.cell.styles.textColor = [220, 38, 38];
                                data.cell.styles.fontStyle = 'bold';
                            } else {
                                data.cell.styles.textColor = [34, 197, 94];
                            }
                        }
                    }
                }
            },
            margin: { left: 14, right: 14 },
        });

        // ─── Footer on all pages ───
        const pageCount = doc.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
            doc.setPage(i);

            // Bottom line
            doc.setDrawColor(30, 58, 138);
            doc.setLineWidth(0.5);
            doc.line(14, pageHeight - 12, pageWidth - 14, pageHeight - 12);

            doc.setFontSize(6.5);
            doc.setTextColor(120);
            doc.setFont('helvetica', 'normal');
            doc.text(
                `Pagina ${i} de ${pageCount}`,
                14,
                pageHeight - 7,
            );
            doc.text(
                'Gerado automaticamente por LicitaSaaS  |  Este documento nao substitui a conferencia manual',
                pageWidth - 14,
                pageHeight - 7,
                { align: 'right' }
            );
        }

        const safeName = (selectedBidding.title || 'Processo').substring(0, 30).replace(/[^a-z0-9]/gi, '_');
        doc.save(`Relatorio_Conformidade_${safeName}_${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}.pdf`);
    };

    const satisfiedCount = requiredList.filter(r => {
        const ids = manualMatches[r.description];
        return ids && ids.length > 0 && !ids.includes('IGNORAR');
    }).length;
    const ignoredCount = requiredList.filter(r => manualMatches[r.description]?.includes('IGNORAR')).length;
    const pendingCount = requiredList.length - satisfiedCount - ignoredCount;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>

            {/* ── Top Bar: Config ── */}
            <div style={{
                display: 'grid', gridTemplateColumns: '1fr 1fr auto',
                gap: 'var(--space-4)', alignItems: 'end',
                padding: 'var(--space-6)', borderRadius: 'var(--radius-xl)',
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
                        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)', marginTop: '4px' }}>
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

                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                    <label style={{ ...labelStyle, marginBottom: 0 }}>Situação</label>
                    <div style={{ display: 'flex', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-lg)', overflow: 'hidden' }}>
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
                    padding: 'var(--space-4) var(--space-6)', borderRadius: 'var(--radius-lg)',
                    background: readinessScore >= 100 ? 'rgba(34,197,94,0.06)' : readinessScore >= 50 ? 'rgba(245,158,11,0.06)' : 'rgba(239,68,68,0.06)',
                    border: `1px solid ${readinessScore >= 100 ? 'rgba(34,197,94,0.25)' : readinessScore >= 50 ? 'rgba(245,158,11,0.25)' : 'rgba(239,68,68,0.25)'}`,
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-5)' }}>
                        {/* Circular Score */}
                        <div style={{
                            position: 'relative', width: '56px', height: '56px',
                        }}>
                            <svg width="56" height="56" viewBox="0 0 56 56">
                                <circle cx="28" cy="28" r="24" fill="none" stroke="var(--color-border)" strokeWidth="4" />
                                <circle cx="28" cy="28" r="24" fill="none"
                                    stroke={readinessScore >= 100 ? 'var(--color-success)' : readinessScore >= 50 ? 'var(--color-warning)' : 'var(--color-danger)'}
                                    strokeWidth="4" strokeLinecap="round"
                                    strokeDasharray={`${(readinessScore / 100) * 150.8} 150.8`}
                                    transform="rotate(-90 28 28)"
                                />
                            </svg>
                            <span style={{
                                position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: '0.8rem', fontWeight: 800,
                                color: readinessScore >= 100 ? 'var(--color-success)' : readinessScore >= 50 ? 'var(--color-warning)' : 'var(--color-danger)',
                            }}>
                                {Math.round(readinessScore)}%
                            </span>
                        </div>

                        {/* Stats */}
                        <div>
                            <div style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--font-bold)', color: 'var(--color-text-primary)' }}>
                                Índice de Prontidão
                            </div>
                            <div style={{ display: 'flex', gap: 'var(--space-4)', marginTop: '4px', fontSize: 'var(--text-sm)' }}>
                                <span style={{ color: 'var(--color-success)', fontWeight: 'var(--font-semibold)' }}>✅ {satisfiedCount} vinculados</span>
                                <span style={{ color: 'var(--color-danger)', fontWeight: 'var(--font-semibold)' }}>❌ {pendingCount} pendentes</span>
                                {ignoredCount > 0 && <span style={{ color: 'var(--color-neutral)', fontWeight: 'var(--font-semibold)' }}>⏭ {ignoredCount} ignorados</span>}
                            </div>
                        </div>
                    </div>

                    <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
                        <button
                            className="btn btn-outline"
                            onClick={handleExportPdfReport}
                            disabled={requiredList.length === 0}
                            style={{
                                padding: 'var(--space-3) var(--space-5)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                                borderRadius: 'var(--radius-lg)', fontWeight: 'var(--font-semibold)', fontSize: 'var(--text-md)',
                                border: '1px solid rgba(139,92,246,0.3)',
                                color: 'var(--color-ai)',
                                background: 'var(--color-ai-bg)',
                            }}
                            title="Exportar relatório PDF de conformidade documental"
                        >
                            <ClipboardList size={16} />
                            Relatório PDF
                        </button>

                        <button
                            className="btn btn-primary"
                            onClick={handleExportZip}
                            disabled={isExporting || matchedDocs.length === 0}
                            style={{
                                padding: 'var(--space-3) var(--space-7)', display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                                background: matchedDocs.length > 0 ? 'linear-gradient(135deg, var(--color-primary), var(--color-ai))' : undefined,
                                borderRadius: 'var(--radius-lg)', fontWeight: 'var(--font-bold)', fontSize: 'var(--text-md)',
                                boxShadow: matchedDocs.length > 0 ? '0 4px 12px rgba(37,99,235,0.25)' : undefined,
                            }}
                        >
                            {isExporting ? <Loader2 size={18} className="spin" /> : <Package size={18} />}
                            {isExporting ? 'Gerando ZIP...' : `Exportar Dossiê (${matchedDocs.length} doc${matchedDocs.length !== 1 ? 's' : ''})`}
                        </button>
                    </div>
                </div>
            )}

            {/* ── AI Badge ── */}
            {selectedBidding && selectedCompany && (isAiLoading || aiApplied) && (
                <div style={{
                    display: 'flex', alignItems: 'center', gap: 'var(--space-3)',
                    padding: 'var(--space-3) var(--space-5)', borderRadius: 'var(--radius-lg)',
                    background: isAiLoading
                        ? 'linear-gradient(135deg, rgba(245,158,11,0.06), rgba(139,92,246,0.06))'
                        : 'linear-gradient(135deg, rgba(139,92,246,0.06), rgba(59,130,246,0.06))',
                    border: `1px solid ${isAiLoading ? 'rgba(245,158,11,0.3)' : 'rgba(139,92,246,0.2)'}`,
                }}>
                    {isAiLoading ? (
                        <>
                            <Loader2 size={16} color="var(--color-warning)" className="spin" />
                            <span style={{ fontSize: '0.8125rem', color: 'var(--color-warning-hover)', fontWeight: 600 }}>
                                Gemini analisando correspondências...
                            </span>
                            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>
                                — A IA está avaliando {requiredList.length} exigências contra {companyDocs.length} documentos.
                            </span>
                        </>
                    ) : (
                        <>
                            <Sparkles size={16} color="var(--color-ai)" />
                            <span style={{ fontSize: '0.8125rem', color: 'var(--color-ai)', fontWeight: 600 }}>
                                Correspondência Inteligente (Gemini) aplicada
                            </span>
                            <span style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)' }}>
                                — A IA pré-selecionou {satisfiedCount} documento(s) automaticamente. Revise e ajuste conforme necessário.
                            </span>
                        </>
                    )}
                </div>
            )}

            {/* ── Requirements List ── */}
            {selectedBidding && selectedCompany ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                    <h3 style={{
                        margin: '0 0 4px 0', fontSize: 'var(--text-lg)', fontWeight: 'var(--font-bold)',
                        color: 'var(--color-text-primary)',
                        display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
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
                                note={oracleNotes[reqText]}
                            />
                        );
                    })}
                </div>
            ) : (
                <div style={{
                    padding: 'var(--space-20) var(--space-10)', borderRadius: 'var(--radius-xl)',
                    background: 'var(--color-bg-surface)',
                    border: '2px dashed var(--color-border)',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                    color: 'var(--color-text-tertiary)', textAlign: 'center',
                }}>
                    <FileArchive size={56} style={{ marginBottom: 'var(--space-4)', opacity: 0.25 }} />
                    <h3 style={{ margin: '0 0 var(--space-2) 0', color: 'var(--color-text-secondary)', fontWeight: 'var(--font-bold)' }}>Montador Inteligente de Dossiê</h3>
                    <p style={{ margin: 0, maxWidth: '400px', lineHeight: 1.5, fontSize: 'var(--text-md)' }}>
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
    fontSize: 'var(--text-md)',
    fontWeight: 'var(--font-semibold)',
    color: 'var(--color-text-secondary)',
    marginBottom: 'var(--space-2)',
    alignItems: 'center',
    gap: 'var(--space-2)',
};

const selectStyle: React.CSSProperties = {
    width: '100%',
    padding: 'var(--space-3) var(--space-4)',
    borderRadius: 'var(--radius-lg)',
    border: '1px solid var(--color-border)',
    background: 'var(--color-bg-surface)',
    color: 'var(--color-text-primary)',
    fontSize: 'var(--text-md)',
    fontWeight: 'var(--font-medium)',
};
