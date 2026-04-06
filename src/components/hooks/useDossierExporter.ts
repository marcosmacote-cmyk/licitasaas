import { useState, useMemo, useEffect, useRef } from 'react';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { API_BASE_URL } from '../../config';
import type { BiddingProcess, CompanyProfile, CompanyDocument } from '../../types';
import { useToast } from '../ui';
import { resolveStage, isModuleAllowed } from '../../governance';

// ──────────────────────────────────────────────────────────────────────
// Constants & Utilities
// ──────────────────────────────────────────────────────────────────────

export const DOCUMENT_GROUP_META: Record<string, { icon: string; color: string; priority: number }> = {
    'Habilitação Jurídica': { icon: 'Shield', color: 'var(--color-primary)', priority: 1 },
    'Regularidade Fiscal, Social e Trabalhista': { icon: 'FileSearch', color: 'var(--color-success)', priority: 2 },
    'Qualificação Técnica': { icon: 'Briefcase', color: 'var(--color-ai)', priority: 3 },
    'Qualificação Econômica Financeira': { icon: 'FileText', color: 'var(--color-warning)', priority: 4 },
    'Declarações': { icon: 'Sparkles', color: 'var(--color-danger)', priority: 5 },
    'Outros': { icon: 'HelpCircle', color: 'var(--color-neutral)', priority: 99 },
};

export function getGroupMeta(group: string) {
    return DOCUMENT_GROUP_META[group] || DOCUMENT_GROUP_META['Outros'];
}

// ──────────────────────────────────────────────────────────────────────
// AI Matching Engine
// ──────────────────────────────────────────────────────────────────────

function norm(text: string): string {
    return (text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

const SYNONYM_MAP: Record<string, string[]> = {
    'contrato_social': ['contrato social', 'ato constitutivo', 'estatuto social', 'requerimento de empresario', 'registro comercial', 'certificado mei', 'constituicao'],
    'procuracao': ['procuracao', 'substabelecimento', 'carta de preposto', 'credenciamento'],
    'identidade': ['rg', 'documento de identidade', 'carteira de identidade', 'cedula de identidade', 'cnh', 'cpf', 'identidade do representante'],
    'cnpj': ['cnpj', 'comprovante de inscricao', 'cartao cnpj'],
    'alvara': ['alvara', 'licenca de funcionamento', 'licenca municipal'],
    'cnd_federal': ['certidao conjunta', 'cnd federal', 'certidao negativa de debitos federais', 'receita federal', 'divida ativa da uniao', 'pgfn', 'tributos federais', 'cnd rfb'],
    'cnd_estadual': ['certidao negativa estadual', 'fazenda estadual', 'tributos estaduais', 'debitos estaduais', 'sefaz', 'icms'],
    'cnd_municipal': ['certidao negativa municipal', 'fazenda municipal', 'tributos municipais', 'debitos municipais', 'iss', 'issqn'],
    'fgts': ['fgts', 'crf', 'certificado de regularidade', 'fundo de garantia', 'caixa economica'],
    'inss': ['inss', 'previdencia', 'previdenciaria', 'seguridade social', 'contribuicoes previdenciarias'],
    'cndt': ['cndt', 'certidao negativa de debitos trabalhistas', 'justica do trabalho', 'debitos trabalhistas', 'trabalhista'],
    'simples_nacional': ['simples nacional', 'optante pelo simples', 'das', 'mei'],
    'atestado_tecnico': ['atestado de capacidade tecnica', 'atestado tecnico', 'acervo tecnico', 'certidao de acervo', 'cat', 'declaracao de capacidade'],
    'registro_conselho': ['crea', 'cau', 'crq', 'crf', 'conselho de classe', 'registro profissional', 'crm', 'oab', 'crc'],
    'responsavel_tecnico': ['responsavel tecnico', 'rt', 'art', 'rrt', 'anotacao de responsabilidade'],
    'balanco': ['balanco patrimonial', 'balanco', 'demonstracoes contabeis', 'demonstracoes financeiras', 'dre', 'demonstracao de resultado'],
    'certidao_falencia': ['certidao de falencia', 'recuperacao judicial', 'certidao negativa de falencia', 'concordata'],
    'patrimonio_liquido': ['patrimonio liquido', 'capital social', 'indices contabeis', 'liquidez', 'solvencia'],
    'garantia': ['garantia de proposta', 'caucao', 'seguro-garantia', 'fianca bancaria'],
    'declaracao_menores': ['declaracao de que nao emprega menores', 'emprega menor', 'trabalho infantil', 'menores de 18', 'decreto 6481', 'menor aprendiz'],
    'declaracao_impedimento': ['declaracao de que nao esta impedido', 'impedimento', 'inidoneo', 'inidoneidade', 'suspensao', 'proibicao de contratar'],
    'declaracao_fatos': ['declaracao de fatos supervenientes', 'fatos impeditivos', 'superveniencia'],
    'declaracao_me_epp': ['declaracao me', 'microempresa', 'epp', 'empresa de pequeno porte', 'lei complementar 123'],
    'declaracao_parentesco': ['nepotismo', 'parentesco', 'vinculo familiar', 'declaracao de parentesco'],
    'declaracao_visita': ['declaracao de vistoria', 'visita tecnica', 'declaracao de visita', 'vistoria', 'conhecimento do local'],
};

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

    if (docTypeNorm === reqNorm) return 100;

    let score = 0;

    for (const synonyms of Object.values(SYNONYM_MAP)) {
        const reqHitCount = synonyms.filter(s => reqNorm.includes(s)).length;
        const docHitCount = synonyms.filter(s => combinedDoc.includes(s)).length;
        if (reqHitCount > 0 && docHitCount > 0) {
            const familyScore = Math.min(65, 35 + (reqHitCount + docHitCount) * 10);
            score = Math.max(score, familyScore);
        }
    }

    if (docTypeNorm.length > 4 && reqNorm.length > 4) {
        if (reqNorm.includes(docTypeNorm)) score = Math.max(score, 55);
        if (docTypeNorm.includes(reqNorm)) score = Math.max(score, 55);
    }

    const reqWords = reqNorm.split(/[\s,;.()/-]+/).filter(w => w.length > 2);
    if (reqWords.length > 0) {
        let matched = 0;
        for (const word of reqWords) {
            if (combinedDoc.includes(word)) matched++;
        }
        const ratio = matched / reqWords.length;
        score += Math.round(ratio * 35);
    }

    const reqCategory = detectCategory(reqText);
    if (reqCategory) {
        const docCategory = doc.docGroup || '';
        if (norm(docCategory) === norm(reqCategory)) {
            score += 20;
        } else if (detectCategory(doc.docType) === reqCategory) {
            score += 15;
        }
    }

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
// Hook
// ──────────────────────────────────────────────────────────────────────

interface UseDossierExporterParams {
    biddings: BiddingProcess[];
    companies: CompanyProfile[];
    initialBiddingId?: string;
}

export function useDossierExporter({ biddings, companies, initialBiddingId }: UseDossierExporterParams) {
    const toast = useToast();
    const [selectedBiddingId, setSelectedBiddingId] = useState(initialBiddingId || '');
    const [selectedCompanyId, setSelectedCompanyId] = useState('');
    const [isExporting, setIsExporting] = useState(false);
    const [dateFilter, setDateFilter] = useState<'all' | 'active' | 'expired'>('active');
    const [manualMatches, setManualMatches] = useState<Record<string, string[]>>({});
    const [oracleNotes, setOracleNotes] = useState<Record<string, string>>({});
    const [aiApplied, setAiApplied] = useState(false);
    const [isAiLoading, setIsAiLoading] = useState(false);

    const biddingsWithAnalysis = useMemo(() => biddings.filter(b => {
        const stage = resolveStage(b.status);
        return isModuleAllowed(stage, b.substage, 'production-dossier') && b.aiAnalysis;
    }), [biddings]);
    const selectedBidding = biddings.find(b => b.id === selectedBiddingId);
    const selectedCompany = companies.find(c => c.id === selectedCompanyId);

    // Auto-infer company from selected bidding
    useEffect(() => {
        if (selectedBiddingId && !selectedCompanyId) {
            const bidding = biddings.find(b => b.id === selectedBiddingId);
            if (bidding?.companyProfileId) {
                setSelectedCompanyId(bidding.companyProfileId);
            }
        }
    }, [selectedBiddingId]);

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

    const lastAutoMatchKey = useRef('');

    useEffect(() => {
        const comboKey = `${selectedBiddingId}::${selectedCompanyId}::${dateFilter}`;
        if (lastAutoMatchKey.current === comboKey) return;
        lastAutoMatchKey.current = comboKey;

        if (!selectedBiddingId || !selectedCompanyId || companyDocs.length === 0 || requiredList.length === 0) {
            setManualMatches({});
            setAiApplied(false);
            return;
        }

        const runAiMatch = async () => {
            setIsAiLoading(true);
            try {
                const reqTexts = requiredList.map(r => r.description).filter(Boolean);
                const docPayload = companyDocs.map(d => ({
                    id: d.id, docType: d.docType, fileName: d.fileName,
                    docGroup: d.docGroup, expirationDate: d.expirationDate,
                }));

                const response = await fetch(`${API_BASE_URL}/api/dossier/ai-match`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${localStorage.getItem('token')}`,
                    },
                    body: JSON.stringify({ requirements: reqTexts, documents: docPayload }),
                });

                if (!response.ok) throw new Error(`API ${response.status}`);
                const data = await response.json();

                // Oracle evidence: primeiro tenta localStorage, fallback para schemaV2 persistido
                const savedEvidence = localStorage.getItem(`oracle_evidence_${selectedBiddingId}`);
                const schemaV2Evidence = selectedBidding?.aiAnalysis?.schemaV2?.oracle_evidence;
                const parsedEvidence = savedEvidence ? JSON.parse(savedEvidence) : (schemaV2Evidence || {});
                const combinedMatches = { ...(data.matches || {}) };
                const notes: Record<string, string> = {};

                Object.keys(parsedEvidence).forEach(req => {
                    combinedMatches[req] = Array.from(new Set([...(combinedMatches[req] || []), ...parsedEvidence[req].docIds]));
                    notes[req] = parsedEvidence[req].note;
                });

                setManualMatches(combinedMatches);
                setOracleNotes(notes);
                setAiApplied(true);
            } catch (error) {
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
                            requirement: reqText, url: doc.fileUrl,
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
            toast.warning('Não há documentos vinculados para exportar. Vincule ao menos um documento.');
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
                            window.location.origin, '',
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
                toast.warning(`${failures.length} arquivo(s) falharam, mas o ZIP foi gerado com ${filesAddedCount} documento(s).`);
            }
            const content = await zip.generateAsync({ type: 'blob' });
            saveAs(content, `${folderName}.zip`);
        } catch (error: any) {
            toast.error(`Erro ao exportar: ${error.message}`);
        } finally {
            setIsExporting(false);
        }
    };

    const handleExportPdfReport = () => {
        if (!selectedBidding || !selectedCompany) return;
        const doc = new jsPDF('l', 'mm', 'a4');
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const now = new Date();
        const dateStr = `${now.getDate().toString().padStart(2, '0')}/${(now.getMonth() + 1).toString().padStart(2, '0')}/${now.getFullYear()} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

        const formatDate = (dateVal: string | undefined | null): string => {
            if (!dateVal) return '-';
            try { const d = new Date(dateVal); return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`; } catch { return '-'; }
        };
        const isExpired = (dateVal: string | undefined | null): boolean => {
            if (!dateVal) return false;
            try { return new Date(dateVal) < now; } catch { return false; }
        };

        doc.setFillColor(30, 58, 138); doc.rect(0, 0, pageWidth, 28, 'F');
        doc.setFillColor(59, 130, 246); doc.rect(0, 28, pageWidth, 2, 'F');
        doc.setFontSize(16); doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold');
        doc.text('RELATORIO DE CONFORMIDADE DOCUMENTAL', 14, 12);
        doc.setFontSize(8); doc.setFont('helvetica', 'normal');
        doc.text('Exportador de Dossie  |  LicitaSaaS', 14, 18);
        doc.text(`Data: ${dateStr}`, 14, 23);
        const scoreText = `${Math.round(readinessScore)}%`;
        doc.setFontSize(22); doc.setFont('helvetica', 'bold');
        doc.text(scoreText, pageWidth - 14, 16, { align: 'right' });
        doc.setFontSize(7); doc.setFont('helvetica', 'normal');
        doc.text('Indice de Prontidao', pageWidth - 14, 22, { align: 'right' });

        let y = 36;
        doc.setTextColor(30, 30, 30); doc.setFontSize(10); doc.setFont('helvetica', 'bold');
        doc.text('DADOS DA LICITACAO', 14, y);
        doc.setDrawColor(220, 220, 220); doc.line(14, y + 2, pageWidth - 14, y + 2);
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
            doc.setFont('helvetica', 'bold'); doc.text(`${label}:`, 14, y + i * 5);
            doc.setFont('helvetica', 'normal'); doc.text(String(value), 42, y + i * 5);
        });
        rightCol.forEach(([label, value], i) => {
            const xStart = pageWidth / 2 + 10;
            doc.setFont('helvetica', 'bold'); doc.text(`${label}:`, xStart, y + i * 5);
            doc.setFont('helvetica', 'normal'); doc.text(String(value), xStart + 25, y + i * 5);
        });
        y += 18;

        const boxWidth = pageWidth - 28;
        doc.setFillColor(240, 245, 255); doc.roundedRect(14, y, boxWidth, 14, 2, 2, 'F');
        doc.setDrawColor(37, 99, 235); doc.roundedRect(14, y, boxWidth, 14, 2, 2, 'S');
        const barX = 20; const barY = y + 4; const barWidth = 60; const barHeight = 5;
        doc.setFillColor(226, 232, 240); doc.roundedRect(barX, barY, barWidth, barHeight, 2, 2, 'F');
        const fillWidth = Math.min((readinessScore / 100) * barWidth, barWidth);
        if (readinessScore >= 70) doc.setFillColor(34, 197, 94);
        else if (readinessScore >= 40) doc.setFillColor(245, 158, 11);
        else doc.setFillColor(239, 68, 68);
        if (fillWidth > 0) doc.roundedRect(barX, barY, fillWidth, barHeight, 2, 2, 'F');

        doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(37, 99, 235);
        doc.text(`${Math.round(readinessScore)}% Pronto`, barX + barWidth + 6, barY + 4);
        doc.setFontSize(8); doc.setFont('helvetica', 'normal');
        const statsX = barX + barWidth + 50;
        doc.setTextColor(34, 197, 94); doc.text(`${satisfiedCount} vinculados`, statsX, barY + 4);
        doc.setTextColor(239, 68, 68); doc.text(`${pendingCount} pendentes`, statsX + 35, barY + 4);
        if (ignoredCount > 0) { doc.setTextColor(148, 163, 184); doc.text(`${ignoredCount} ignorados`, statsX + 70, barY + 4); }
        y += 20;

        doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(30, 30, 30);
        doc.text('ASSOCIACAO DE DOCUMENTOS AS EXIGENCIAS', 14, y);
        doc.setDrawColor(220, 220, 220); doc.line(14, y + 2, pageWidth - 14, y + 2);
        y += 5;

        const tableData = requiredList.map((reqObj, idx) => {
            const reqText = reqObj.description;
            const manualIds = manualMatches[reqText] || [];
            const isIgnoredReq = manualIds.includes('IGNORAR');
            if (isIgnoredReq) return [reqObj.item || String(idx + 1), reqText, 'N/A (Ignorado)', '-', '-', 'N/A'];
            const mDocs = manualIds.filter(id => id !== 'IGNORAR').map(id => companyDocs.find(d => d.id === id)).filter(Boolean) as CompanyDocument[];
            const docName = mDocs.length > 0 ? mDocs.map(d => d.docType || d.fileName).join('; ') : '-';
            const docFile = mDocs.length > 0 ? mDocs.map(d => d.fileName || '-').join('; ') : '-';
            const expDate = mDocs.length > 0 ? mDocs.map(d => formatDate(d.expirationDate)).join('; ') : '-';
            const status = mDocs.length > 0 ? 'VINCULADO' : 'PENDENTE';
            return [reqObj.item || String(idx + 1), reqText, docName, docFile, expDate, status];
        });

        autoTable(doc, {
            head: [['#', 'Exigencia do Edital', 'Documento', 'Arquivo', 'Vencimento', 'Status']],
            body: tableData, startY: y, theme: 'grid',
            headStyles: { fillColor: [30, 58, 138], textColor: 255, fontSize: 7, fontStyle: 'bold', cellPadding: 2.5, halign: 'center' },
            bodyStyles: { fontSize: 6.5, cellPadding: 2, lineColor: [220, 220, 220], textColor: [40, 40, 40], overflow: 'linebreak' },
            columnStyles: {
                0: { cellWidth: 14, halign: 'center', fontStyle: 'bold' }, 1: { cellWidth: 80 },
                2: { cellWidth: 55 }, 3: { cellWidth: 55 },
                4: { cellWidth: 24, halign: 'center' }, 5: { cellWidth: 22, halign: 'center', fontStyle: 'bold' },
            },
            alternateRowStyles: { fillColor: [248, 250, 252] },
            didParseCell: (data: any) => {
                if (data.section !== 'body') return;
                if (data.column.index === 5) {
                    const text = String(data.cell.raw);
                    if (text === 'VINCULADO') { data.cell.styles.textColor = [34, 197, 94]; data.cell.styles.fillColor = [240, 253, 244]; }
                    else if (text === 'PENDENTE') { data.cell.styles.textColor = [220, 38, 38]; data.cell.styles.fillColor = [254, 242, 242]; }
                    else { data.cell.styles.textColor = [148, 163, 184]; data.cell.styles.fillColor = [248, 250, 252]; }
                }
                if (data.column.index === 4) {
                    const text = String(data.cell.raw);
                    if (text !== '-') {
                        const rowIdx = data.row.index;
                        if (rowIdx < requiredList.length) {
                            const reqText = requiredList[rowIdx]?.description;
                            const ids = manualMatches[reqText] || [];
                            const docs = ids.filter((id: string) => id !== 'IGNORAR').map((id: string) => companyDocs.find(d => d.id === id)).filter(Boolean);
                            const hasExpired = docs.some((d: any) => isExpired(d?.expirationDate));
                            if (hasExpired) { data.cell.styles.textColor = [220, 38, 38]; data.cell.styles.fontStyle = 'bold'; }
                            else { data.cell.styles.textColor = [34, 197, 94]; }
                        }
                    }
                }
            },
            margin: { left: 14, right: 14 },
        });

        const pageCount = doc.getNumberOfPages();
        for (let i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            doc.setDrawColor(30, 58, 138); doc.setLineWidth(0.5);
            doc.line(14, pageHeight - 12, pageWidth - 14, pageHeight - 12);
            doc.setFontSize(6.5); doc.setTextColor(120); doc.setFont('helvetica', 'normal');
            doc.text(`Pagina ${i} de ${pageCount}`, 14, pageHeight - 7);
            doc.text('Gerado automaticamente por LicitaSaaS  |  Este documento nao substitui a conferencia manual', pageWidth - 14, pageHeight - 7, { align: 'right' });
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

    return {
        selectedBiddingId, setSelectedBiddingId,
        selectedCompanyId, setSelectedCompanyId,
        dateFilter, setDateFilter,
        isExporting, isAiLoading, aiApplied,
        biddingsWithAnalysis, selectedBidding, selectedCompany,
        requiredList, companyDocs, manualMatches, oracleNotes,
        matchedDocs, readinessScore,
        satisfiedCount, ignoredCount, pendingCount,
        toggleMatch, handleExportZip, handleExportPdfReport,
    };
}
