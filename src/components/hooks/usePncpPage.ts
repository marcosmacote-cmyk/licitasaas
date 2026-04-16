/**
 * ═══════════════════════════════════════════════════════
 * usePncpPage — Compositor Principal (Fase 1 Refatoração)
 * 
 * BEFORE: 1.314 lines monolithic hook
 * AFTER: ~350 lines compositor that delegates to 3 sub-hooks:
 *   - usePncpSearch (search + filters + pagination)
 *   - usePncpFavorites (multi-list favorites + PDF export)
 *   - usePncpScanner (opportunity scanner + notifications)
 *   - usePncpSavedSearches (saved searches + multi-list)
 * 
 * IMPORTANT: The return contract is IDENTICAL to the original.
 * No changes needed in PncpPage.tsx or any sub-components.
 * ═══════════════════════════════════════════════════════
 */
import { useState, useEffect, useRef } from 'react';
import { API_BASE_URL } from '../../config';
import type { CompanyProfile, PncpSavedSearch, PncpBiddingItem, BiddingProcess, AiAnalysis } from '../../types';
import { useToast } from '../ui';
import { v4 as uuidv4 } from 'uuid';
import { aiService } from '../../services/ai';

// Sub-hooks
import { usePncpSearch } from './usePncpSearch';
import { usePncpFavorites } from './usePncpFavorites';
import { usePncpScanner } from './usePncpScanner';
import { usePncpSavedSearches } from './usePncpSavedSearches';

// Re-export constants for backward compatibility
export const UFS = [
    'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA',
    'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN',
    'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'
];

export const ESFERAS = [
    { value: 'todas', label: 'Todas as Esferas' },
    { value: 'F', label: 'Federal' },
    { value: 'E', label: 'Estadual' },
    { value: 'M', label: 'Municipal' },
    { value: 'D', label: 'Distrital' },
];

export const MODALIDADES = [
    { value: 'todas', label: 'Todas as Modalidades' },
    { value: '1', label: 'Pregão Eletrônico' },
    { value: '2', label: 'Concorrência' },
    { value: '3', label: 'Concurso' },
    { value: '4', label: 'Leilão' },
    { value: '5', label: 'Diálogo Competitivo' },
    { value: '6', label: 'Dispensa de Licitação' },
    { value: '7', label: 'Inexigibilidade' },
];

export const STATUS_OPTIONS = [
    { value: 'recebendo_proposta', label: 'Abertas (Recebendo Propostas)' },
    { value: 'encerrada', label: 'Encerradas' },
    { value: 'suspensa', label: 'Suspensas' },
    { value: 'anulada', label: 'Anuladas' },
    { value: 'todas', label: 'Todas' },
];

interface UsePncpPageParams {
    companies: CompanyProfile[];
    onRefresh?: () => Promise<void>;
    items?: BiddingProcess[];
    initialContext?: any;
    onContextConsumed?: () => void;
}

export function usePncpPage({ companies, onRefresh, items = [], initialContext, onContextConsumed }: UsePncpPageParams) {
    const toast = useToast();

    // ═══════════════════════════════════════════════════
    // COMPOSE SUB-HOOKS
    // ═══════════════════════════════════════════════════

    const search = usePncpSearch();
    const favorites = usePncpFavorites();
    const scanner = usePncpScanner();
    const savedSearches = usePncpSavedSearches({
        setConfirmAction: favorites.setConfirmAction,
    });

    // ═══════════════════════════════════════════════════
    // SHARED STATE (activeTab, modals, import/AI)
    // ═══════════════════════════════════════════════════

    const [activeTab, setActiveTab] = useState<'search' | 'found' | 'favorites'>('search');

    // Modal state
    const [editingProcess, setEditingProcess] = useState<Partial<BiddingProcess> | null>(null);

    // AI Analysis state
    const [analyzingItemId, setAnalyzingItemId] = useState<string | null>(null);
    const [pncpAnalysis, setPncpAnalysis] = useState<{ process: Partial<BiddingProcess>; analysis: AiAnalysis } | null>(null);
    const [viewingAnalysisProcess, setViewingAnalysisProcess] = useState<BiddingProcess | null>(null);
    const [analyzedPncpItem, setAnalyzedPncpItem] = useState<PncpBiddingItem | null>(null);
    const [pendingAiAnalysis, setPendingAiAnalysis] = useState<AiAnalysis | null>(null);
    const [isParsingAI, setIsParsingAI] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // ═══════════════════════════════════════════════════
    // TAB SYNC — Fetch scanner opportunities when tab changes
    // ═══════════════════════════════════════════════════

    useEffect(() => {
        if (activeTab === 'found') {
            scanner.fetchScannerOpportunities();
        }
    }, [activeTab, scanner.scannerOpportunitiesPage, scanner.scannerFilterSearchId]);

    // ═══════════════════════════════════════════════════
    // DISPLAY ITEMS — computed based on active tab
    // ═══════════════════════════════════════════════════

    const displayItems = activeTab === 'favorites' ? favorites.filteredFavoritos 
        : activeTab === 'found' ? scanner.scannerOpportunities.map((opp: any) => ({
            id: opp.pncpId || opp.id,
            titulo: opp.titulo || 'Sem título',
            objeto: opp.objeto || '',
            orgao_nome: opp.orgaoNome || '',
            uf: opp.uf || '--',
            municipio: opp.municipio || '--',
            valor_estimado: opp.valorEstimado || 0,
            data_encerramento_proposta: opp.dataEncerramentoProposta || '',
            modalidade_nome: opp.modalidadeNome || '',
            link_sistema: opp.linkSistema || '',
            _scannerLogId: opp.id,
            _isViewed: opp.isViewed,
            _searchName: opp.searchName,
            _foundAt: opp.createdAt,
        } as PncpBiddingItem & { _scannerLogId: string; _isViewed: boolean; _searchName: string; _foundAt: string }))
        : search.results;

    // ═══════════════════════════════════════════════════
    // PAGINATION (client-side)
    // ═══════════════════════════════════════════════════

    const prevPageRef = useRef(search.page);
    useEffect(() => {
        let timeoutId: any;
        if (search.hasSearched && search.page !== prevPageRef.current) {
            prevPageRef.current = search.page;
            const perPage = 10;
            const startIdx = (search.page - 1) * perPage;
            const pageItems = search.allResults.slice(startIdx, startIdx + perPage);
            search.setResults(pageItems);
            window.scrollTo({ top: 0, behavior: 'smooth' });
            
            // Prefetch items for the new page (warms server cache)
            // Debounced by 600ms to avoid DDoS if user rapidly clicks next page
            timeoutId = setTimeout(() => {
                const token = localStorage.getItem('token');
                if (token) {
                    const prefetchPage = pageItems
                        .filter((it: any) => it.orgao_cnpj && it.ano && it.numero_sequencial)
                        .map((it: any) => ({ cnpj: it.orgao_cnpj, ano: it.ano, seq: it.numero_sequencial }));
                    if (prefetchPage.length > 0) {
                        fetch(`${API_BASE_URL}/api/pncp/items/prefetch`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                            body: JSON.stringify({ processes: prefetchPage }),
                        }).catch(() => {});
                    }
                }
            }, 600);
        }
        
        return () => {
            if (timeoutId) clearTimeout(timeoutId);
        };
    }, [search.page, search.allResults, search.hasSearched]);

    // ═══════════════════════════════════════════════════
    // LOAD SAVED SEARCH — bridges saved searches → search
    // ═══════════════════════════════════════════════════

    const loadSavedSearch = (s: PncpSavedSearch) => {
        const searchKeywords = s.keywords || '';
        const searchStatus = s.status || 'recebendo_proposta';
        let customState = { uf: '', modalidade: 'todas', esfera: 'todas', orgao: '', orgaosLista: '', excludeKeywords: '', dataInicio: '', dataFim: '' };
        try {
            const parsedStates = JSON.parse(s.states || '{}');
            if (Array.isArray(parsedStates)) { customState.uf = parsedStates[0] || ''; }
            else if (typeof parsedStates === 'object' && parsedStates !== null) { customState = { ...customState, ...parsedStates }; }
        } catch { }

        search.setKeywords(searchKeywords); search.setStatus(searchStatus);
        search.setSelectedSearchCompanyId(s.companyProfileId || '');
        search.setSelectedUf(customState.uf); search.setModalidade(customState.modalidade);
        search.setEsfera(customState.esfera); search.setOrgao(customState.orgao);
        search.setOrgaosLista(customState.orgaosLista); search.setExcludeKeywords(customState.excludeKeywords);
        search.setDataInicio(customState.dataInicio); search.setDataFim(customState.dataFim);
        search.setPage(1);
        setActiveTab('search');

        search.handleSearch(undefined, {
            keywords: searchKeywords, status: searchStatus, uf: customState.uf,
            modalidade: customState.modalidade, esfera: customState.esfera,
            orgao: customState.orgao, orgaosLista: customState.orgaosLista,
            excludeKeywords: customState.excludeKeywords,
            dataInicio: customState.dataInicio, dataFim: customState.dataFim,
            resetPage: true
        });
    };

    // Save search bridge: injects current search state
    const handleSaveSearch = async (listName?: string) => {
        savedSearches.handleSaveSearch(listName, {
            keywords: search.keywords, status: search.status,
            selectedSearchCompanyId: search.selectedSearchCompanyId,
            selectedUf: search.selectedUf, modalidade: search.modalidade,
            esfera: search.esfera, orgao: search.orgao,
            orgaosLista: search.orgaosLista, excludeKeywords: search.excludeKeywords,
            dataInicio: search.dataInicio, dataFim: search.dataFim,
        });
    };

    // Clear search bridge: also reset tab
    const clearSearch = () => {
        search.clearSearch();
        setActiveTab('search');
    };

    // ═══════════════════════════════════════════════════
    // IMPORT TO FUNNEL
    // ═══════════════════════════════════════════════════

    const handleImportToFunnel = (item: PncpBiddingItem, aiData?: { process: Partial<BiddingProcess>; analysis: AiAnalysis }) => {
        if (items) {
            const existingProcess = items.find(p => p.link && item.link_sistema && p.link.includes(item.link_sistema));
            if (existingProcess) {
                const isCaptado = existingProcess.status === 'Captado';
                const locationStr = isCaptado ? 'na coluna "Captada"' : `na coluna "${existingProcess.status}"`;
                favorites.setConfirmAction({
                    type: 'duplicate',
                    message: `Esta licitação aparentemente já está no seu funil (${locationStr}). Tem certeza que deseja importar novamente e criar uma duplicidade?`,
                    onConfirm: () => { favorites.setConfirmAction(null); doImport(item, aiData); }
                });
                return;
            }
        }
        doImport(item, aiData);
    };

    const doImport = (item: PncpBiddingItem, aiData?: { process: Partial<BiddingProcess>; analysis: AiAnalysis }) => {
        // ═══════════════════════════════════════════════════════════
        // 1. SMART PORTAL DETECTION — resolve o portal real de operação
        // ═══════════════════════════════════════════════════════════
        let bestPortalName = "PNCP";
        const aiEnrichedLink = ((aiData?.process as any)?.link_sistema || '').toLowerCase();
        const allLinksForDetection = [aiEnrichedLink, (item.link_sistema || '').toLowerCase()].filter(Boolean).join(' ');

        if (companies.length > 0) {
            const allCreds = companies.flatMap(c => c.credentials || []);
            const match = allCreds.find(c => {
                const cu = (c.url || '').toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
                return cu && allLinksForDetection.includes(cu.split('/')[0]);
            });
            if (match) bestPortalName = match.platform;
        }

        if (bestPortalName === 'PNCP') {
            if (allLinksForDetection.includes('comprasnet') || allLinksForDetection.includes('cnetmobile') || allLinksForDetection.includes('gov.br/compras')) bestPortalName = "ComprasNet";
            else if (allLinksForDetection.includes('bllcompras') || allLinksForDetection.includes('bll.org')) bestPortalName = "BLL";
            else if (allLinksForDetection.includes('bnccompras') || allLinksForDetection.includes('bnc.org.br')) bestPortalName = "BNC";
            else if (allLinksForDetection.includes('licitacoes-e')) bestPortalName = "Licitações-e (BB)";
            else if (allLinksForDetection.includes('portaldecompraspublicas')) bestPortalName = "Portal de Compras Públicas";
            else if (allLinksForDetection.includes('bec.sp')) bestPortalName = "BEC/SP";
            else if (allLinksForDetection.includes('m2atecnologia') || allLinksForDetection.includes('m2a.')) bestPortalName = "M2A Tecnologia";
            else if (allLinksForDetection.includes('bbmnet')) bestPortalName = "BBMNet";
            else if (allLinksForDetection.includes('licitamaisbrasil')) bestPortalName = "Licita Mais Brasil";
            else if (allLinksForDetection.includes('compras.gov.br') || allLinksForDetection.includes('pncp.gov.br')) bestPortalName = "Compras.gov.br";

            if (bestPortalName === 'PNCP' || bestPortalName === 'Compras.gov.br') {
                const isCE = (item.uf?.toUpperCase() === 'CE');
                const isStateLevel = (item.esfera_id === 'E');
                const isDispensa = /dispensa|cota[çc][ãa]o/i.test(item.modalidade_nome || '');
                if (isCE && isStateLevel && !isDispensa) {
                    bestPortalName = "Compras.gov.br";
                }
            }
        }

        // ═══════════════════════════════════════════════════════════
        // 2. AI-INFORMED RISK TAG
        // ═══════════════════════════════════════════════════════════
        let riskTag: string = aiData?.process?.risk || 'Médio';
        if (aiData?.analysis?.schemaV2) {
            const v2 = aiData.analysis.schemaV2 as any;
            const flags = v2?.risks_and_flags || [];
            if (Array.isArray(flags) && flags.length > 0) {
                const hasCritica = flags.some((f: any) => f.severity === 'critica');
                const hasAlta = flags.some((f: any) => f.severity === 'alta');
                const hasMedia = flags.some((f: any) => f.severity === 'media');
                if (hasCritica) riskTag = 'Crítico';
                else if (hasAlta) riskTag = 'Alto';
                else if (hasMedia && flags.length >= 3) riskTag = 'Alto';
                else if (hasMedia) riskTag = 'Médio';
                else riskTag = 'Baixo';
            }
        } else if (aiData?.analysis?.irregularitiesFlags) {
            try {
                const flags = typeof aiData.analysis.irregularitiesFlags === 'string'
                    ? JSON.parse(aiData.analysis.irregularitiesFlags)
                    : aiData.analysis.irregularitiesFlags;
                if (Array.isArray(flags) && flags.length >= 3) riskTag = 'Alto';
                else if (Array.isArray(flags) && flags.length > 0) riskTag = 'Médio';
            } catch { /* keep default */ }
        }

        // ═══════════════════════════════════════════════════════════
        // 3. SMART TITLE
        // ═══════════════════════════════════════════════════════════
        let title = aiData?.process?.title || item.titulo;
        const normalizeForCompare = (s: string) => s.toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/prefeitura municipal d[eo] /gi, '')
            .replace(/municipio d[eo] /gi, '')
            .replace(/secretaria d[eo] /gi, '')
            .replace(/\s+/g, ' ').trim();
        const titleNorm = normalizeForCompare(title || '');
        const orgNorm = normalizeForCompare(item.orgao_nome || '');
        const alreadyHasOrg = titleNorm.includes(orgNorm.slice(0, 10)) || orgNorm.includes(titleNorm.slice(-15));
        if (title && !alreadyHasOrg && !title.includes('Município') && title.length < 80) {
            const orgParts = item.orgao_nome.split(' ');
            const orgShort = orgParts.length > 4 ? orgParts.slice(0, 4).join(' ') : item.orgao_nome;
            title = `${title} - ${orgShort}`;
        }

        // ═══════════════════════════════════════════════════════════
        // 4. LINK COMPOSITION
        // ═══════════════════════════════════════════════════════════
        const links: string[] = [];
        const aiLinkSistema = (aiData?.process as any)?.link_sistema as string | undefined;
        if (aiLinkSistema && !links.includes(aiLinkSistema)) links.push(aiLinkSistema);
        if (aiData?.process?.link && !links.includes(aiData.process.link)) links.push(aiData.process.link);
        if (item.link_sistema && !links.includes(item.link_sistema)) links.push(item.link_sistema);
        if (item.link_comprasnet && !links.includes(item.link_comprasnet)) links.push(item.link_comprasnet);

        // ═══════════════════════════════════════════════════════════
        // 5. SESSION DATE
        // ═══════════════════════════════════════════════════════════
        let sessionDateISO: string;
        if (aiData?.process?.sessionDate && aiData.process.sessionDate.length > 5) {
            const parsed = new Date(aiData.process.sessionDate);
            sessionDateISO = isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
        } else if (item.data_encerramento_proposta) {
            sessionDateISO = new Date(item.data_encerramento_proposta).toISOString();
        } else if (item.data_abertura) {
            sessionDateISO = new Date(item.data_abertura).toISOString();
        } else {
            sessionDateISO = new Date().toISOString();
        }

        // ═══════════════════════════════════════════════════════════
        // 6. SMART REMINDER
        // ═══════════════════════════════════════════════════════════
        let reminderDate: string | undefined;
        let reminderStatus: 'pending' | undefined;
        let reminderType: 'once' | undefined;
        const sessionMs = new Date(sessionDateISO).getTime();
        const now = Date.now();
        const twoDaysBefore = sessionMs - (2 * 24 * 60 * 60 * 1000);
        if (twoDaysBefore > now) {
            const reminderDt = new Date(twoDaysBefore);
            reminderDt.setHours(8, 0, 0, 0);
            reminderDate = reminderDt.toISOString();
            reminderStatus = 'pending';
            reminderType = 'once';
        }

        // ═══════════════════════════════════════════════════════════
        // 7. RICH OBSERVATION
        // ═══════════════════════════════════════════════════════════
        const obsParts = [`Importado do PNCP`];
        if (item.orgao_nome) obsParts.push(`Órgão: ${item.orgao_nome.toUpperCase()}`);
        if (item.municipio && item.uf) obsParts.push(`${item.municipio}-${item.uf}`);
        if (item.data_encerramento_proposta) {
            obsParts.push(`Prazo Limite: ${new Date(item.data_encerramento_proposta).toLocaleString('pt-BR')}`);
        }
        const observationText = obsParts.join(' | ');

        // ═══════════════════════════════════════════════════════════
        // 8-9. SUMMARY & MODALITY
        // ═══════════════════════════════════════════════════════════
        let summary = aiData?.process?.summary || item.objeto;
        let modality = aiData?.process?.modality || item.modalidade_nome || "Não Informado (PNCP)";
        const modalMap: Record<string, string> = {
            'pregão - eletrônico': 'Pregão Eletrônico', 'pregão eletrônico': 'Pregão Eletrônico',
            'concorrência - eletrônica': 'Concorrência', 'concorrência eletrônica': 'Concorrência',
            'concorrência': 'Concorrência', 'dispensa': 'Dispensa', 'dispensa de licitação': 'Dispensa',
            'inexigibilidade': 'Inexigibilidade', 'diálogo competitivo': 'Diálogo Competitivo',
            'leilão - eletrônico': 'Leilão',
        };
        const normalizedMod = modalMap[modality.toLowerCase().trim()];
        if (normalizedMod) modality = normalizedMod;

        // ═══════════════════════════════════════════════════════════
        // BUILD & SET PROCESS
        // ═══════════════════════════════════════════════════════════
        const genericPortals = ['compras.gov.br', 'pncp', 'não informado', ''];
        const aiPortal = aiData?.process?.portal || '';
        const resolvedPortal = (bestPortalName && !genericPortals.includes(bestPortalName.toLowerCase()))
            ? bestPortalName
            : (aiPortal || bestPortalName);

        const processData: Partial<BiddingProcess> = {
            title, summary, portal: resolvedPortal, modality,
            status: "Captado",
            estimatedValue: aiData?.process?.estimatedValue || item.valor_estimado || 0,
            sessionDate: sessionDateISO,
            link: links.join(', '),
            pncpLink: item.link_sistema,
            risk: riskTag as any,
            companyProfileId: search.selectedSearchCompanyId || (companies.length > 0 ? companies[0].id : ''),
            ...(reminderDate ? { reminderDate, reminderStatus, reminderType } : {}),
            observations: JSON.stringify([{
                id: crypto.randomUUID?.() || Date.now().toString(),
                text: observationText,
                timestamp: new Date().toISOString(), author: 'Sistema'
            }])
        };
        setEditingProcess(processData);
    };

    // ═══════════════════════════════════════════════════
    // AI ANALYSIS
    // ═══════════════════════════════════════════════════

    const handlePncpAiAnalyze = async (item: PncpBiddingItem) => {
        if (analyzingItemId) return;
        setAnalyzingItemId(item.id);
        setAnalyzedPncpItem(item);
        
        try {
            const { submitBackgroundJob } = await import('./useSSE');
            await submitBackgroundJob({
                type: 'pncp_analysis',
                input: {
                    orgao_cnpj: item.orgao_cnpj, ano: item.ano,
                    numero_sequencial: item.numero_sequencial, link_sistema: item.link_sistema,
                    _itemData: item
                },
                targetId: `pncp_${item.id}`,
                targetTitle: `Análise PNCP: ${item.orgao_nome || item.numero_sequencial}`
            });
            toast.success('Análise enviada para processamento! Você será notificado quando concluir.');
        } catch (e: any) {
            toast.error(`Erro ao enviar análise IA: ${e.message}`);
        } finally {
            setAnalyzingItemId(null);
        }
    };

    const handleLoadPncpJobResult = async (jobId: string) => {
        try {
            const token = localStorage.getItem('token');
            const jobRes = await fetch(`${API_BASE_URL}/api/jobs/${jobId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!jobRes.ok) throw new Error('Falha ao carregar tarefa');
            const jobData = await jobRes.json();
            
            const resRes = await fetch(`${API_BASE_URL}/api/jobs/${jobId}/result`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (!resRes.ok) throw new Error('Falha ao buscar resultado');
            const { result: aiData } = await resRes.json();
            
            const item = jobData.input?._itemData || {};
            const processObj = aiData.process || {};
            const analysisObj = aiData.analysis || {};

            const analysisData: AiAnalysis = {
                id: uuidv4(), biddingProcessId: '',
                requiredDocuments: JSON.stringify(analysisObj.requiredDocuments || []),
                pricingConsiderations: analysisObj.pricingConsiderations || '',
                irregularitiesFlags: JSON.stringify(analysisObj.irregularitiesFlags || []),
                fullSummary: analysisObj.fullSummary || '',
                deadlines: JSON.stringify(analysisObj.deadlines || []),
                penalties: analysisObj.penalties || '',
                qualificationRequirements: analysisObj.qualificationRequirements || '',
                biddingItems: analysisObj.biddingItems || '',
                sourceFileNames: JSON.stringify(aiData.pncpSource?.downloadedFiles || []),
                schemaV2: aiData.schemaV2 || null,
                promptVersion: aiData._prompt_version || null,
                modelUsed: aiData._model_used || null,
                pipelineDurationS: aiData._pipeline_duration_s || null,
                overallConfidence: aiData._overall_confidence || null,
                analyzedAt: new Date().toISOString()
            };

            const toISOSafe = (d: string): string => {
                if (!d) return new Date().toISOString();
                const parsed = new Date(d);
                if (!isNaN(parsed.getTime())) return parsed.toISOString();
                const m = d.match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(?:às\s+)?(\d{2}):(\d{2}))?/);
                if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4] || '00'}:${m[5] || '00'}:00-03:00`).toISOString();
                return new Date().toISOString();
            };

            const fakeProcess: BiddingProcess = {
                id: jobData.targetId || `pncp-${item.id}`, 
                title: processObj.title || item.titulo || 'Licitação Analisada',
                summary: processObj.summary || item.objeto || '', 
                portal: 'PNCP',
                modality: processObj.modality || item.modalidade_nome || '',
                status: 'Captado', estimatedValue: processObj.estimatedValue || item.valor_estimado || 0,
                sessionDate: toISOSafe(processObj.sessionDate || item.data_encerramento_proposta || item.data_abertura || ''),
                link: [processObj.link_sistema, item.link_sistema, item.link_comprasnet].filter(Boolean).filter((v: string, i: number, a: string[]) => a.indexOf(v) === i).join(', '),
                pncpLink: item.link_sistema || '', risk: processObj.risk || 'Médio',
                companyProfileId: search.selectedSearchCompanyId || '', createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(), observations: '[]'
            } as BiddingProcess;

            setAnalyzedPncpItem(item);
            setPncpAnalysis({ process: processObj, analysis: analysisData });
            setViewingAnalysisProcess(fakeProcess);
        } catch (error: any) {
             toast.error(`Erro ao carregar análise: ${error.message}`);
        }
    };

    useEffect(() => {
        if (initialContext?.action === 'open_pncp_job' && initialContext.jobId) {
            handleLoadPncpJobResult(initialContext.jobId);
            if (onContextConsumed) onContextConsumed();
        }
    }, [initialContext]);

    // ═══════════════════════════════════════════════════
    // FILE UPLOAD (Manual edital)
    // ═══════════════════════════════════════════════════

    const handleAIAssistClick = () => { fileInputRef.current?.click(); };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;
        try {
            setIsParsingAI(true);
            const { process: parsedData, analysis } = await aiService.parseEditalPDF(files);
            
            const toISOSafe = (d: string): string => {
                if (!d) return new Date().toISOString();
                const parsed = new Date(d);
                if (!isNaN(parsed.getTime())) return parsed.toISOString();
                const m = d.match(/(\d{2})\/(\d{2})\/(\d{4})(?:\s+(?:às\s+)?(\d{2}):(\d{2}))?/);
                if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}T${m[4] || '00'}:${m[5] || '00'}:00-03:00`).toISOString();
                return new Date().toISOString();
            };

            const fakeItem: any = {
                id: `manual-upload-${Date.now()}`,
                titulo: parsedData.title || 'Licitação Captada (Processo Manual)',
                objeto: parsedData.summary || '',
                orgao_nome: '',
                municipio: '',
                uf: '',
                modalidade_nome: parsedData.modality || '',
                valor_estimado: parsedData.estimatedValue || 0,
                data_abertura: toISOSafe(parsedData.sessionDate || ''),
                data_encerramento_proposta: toISOSafe(parsedData.sessionDate || ''),
                link_sistema: parsedData.link || '',
            };

            const fakeProcess: BiddingProcess = {
                id: fakeItem.id,
                title: parsedData.title || fakeItem.titulo,
                summary: parsedData.summary || fakeItem.objeto,
                portal: parsedData.portal || 'Não Informado',
                modality: parsedData.modality || 'Não Informado',
                status: 'Captado',
                estimatedValue: parsedData.estimatedValue || 0,
                sessionDate: toISOSafe(parsedData.sessionDate || ''),
                link: parsedData.link || '',
                pncpLink: '',
                risk: parsedData.risk || 'Médio',
                companyProfileId: search.selectedSearchCompanyId || '',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                observations: '[]'
            } as BiddingProcess;

            setAnalyzedPncpItem(fakeItem);
            setPncpAnalysis({ process: parsedData, analysis });
            setViewingAnalysisProcess(fakeProcess);
        } catch (error) {
            console.error('Failed to parse document with AI', error);
            const errorMessage = error instanceof Error ? error.message : 'Falha ao extrair dados do Edital.';
            toast.error(errorMessage);
        } finally {
            setIsParsingAI(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    // ═══════════════════════════════════════════════════
    // SAVE PROCESS
    // ═══════════════════════════════════════════════════

    const handleSaveProcess = async (data: Partial<BiddingProcess>, aiData?: any) => {
        try {
            const token = localStorage.getItem('token');
            console.log('[PNCP Save] Sending payload:', Object.keys(data));
            const res = await fetch(`${API_BASE_URL}/api/biddings`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            if (res.ok) {
                const savedProcess = await res.json();
                const analysisToSave = aiData || pendingAiAnalysis;
                if (analysisToSave) {
                    await fetch(`${API_BASE_URL}/api/analysis`, {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ ...analysisToSave, biddingProcessId: savedProcess.id })
                    });
                }
                toast.success('Licitação importada com sucesso!' + (analysisToSave ? ' (com análise IA)' : ''));
                setEditingProcess(null); setPendingAiAnalysis(null);
                setPncpAnalysis(null); setAnalyzedPncpItem(null);
                if (onRefresh) await onRefresh();
            } else {
                const errBody = await res.json().catch(() => ({ error: 'Erro desconhecido' }));
                console.error('[PNCP Save] Server error:', errBody);
                throw new Error(errBody.details || errBody.error || `HTTP ${res.status}`);
            }
        } catch (e: any) { console.error(e); toast.error(`Erro ao importar licitação: ${e.message}`); }
    };

    // ═══════════════════════════════════════════════════
    // RETURN — Identical contract to original usePncpPage
    // ═══════════════════════════════════════════════════

    return {
        // Search state (from usePncpSearch)
        savedSearches: savedSearches.savedSearches,
        results: search.results, loading: search.loading,
        searchSlow: search.searchSlow,
        saving: savedSearches.saving,
        showAdvancedFilters: search.showAdvancedFilters, setShowAdvancedFilters: search.setShowAdvancedFilters,
        searchSource: search.searchSource, searchElapsed: search.searchElapsed,
        keywords: search.keywords, setKeywords: search.setKeywords,
        status: search.status, setStatus: search.setStatus,
        selectedUf: search.selectedUf, setSelectedUf: search.setSelectedUf,
        selectedSearchCompanyId: search.selectedSearchCompanyId, setSelectedSearchCompanyId: search.setSelectedSearchCompanyId,
        modalidade: search.modalidade, setModalidade: search.setModalidade,
        esfera: search.esfera, setEsfera: search.setEsfera,
        orgao: search.orgao, setOrgao: search.setOrgao,
        orgaosLista: search.orgaosLista, setOrgaosLista: search.setOrgaosLista,
        excludeKeywords: search.excludeKeywords, setExcludeKeywords: search.setExcludeKeywords,
        dataInicio: search.dataInicio, setDataInicio: search.setDataInicio,
        dataFim: search.dataFim, setDataFim: search.setDataFim,
        page: search.page, setPage: search.setPage,
        totalResults: search.totalResults, hasSearched: search.hasSearched,
        // Modal state
        editingProcess, setEditingProcess, fileInputRef, handleAIAssistClick, handleFileUpload, isParsingAI,
        // AI state
        analyzingItemId, pncpAnalysis, setPncpAnalysis,
        viewingAnalysisProcess, setViewingAnalysisProcess,
        analyzedPncpItem, setAnalyzedPncpItem,
        pendingAiAnalysis, setPendingAiAnalysis,
        // Multi-list Favoritos (from usePncpFavorites)
        favoritos: favorites.favoritos, favLists: favorites.favLists, favStore: favorites.favStore,
        activeFavListId: favorites.activeFavListId, setActiveFavListId: favorites.setActiveFavListId,
        activeTab, setActiveTab,
        confirmAction: favorites.confirmAction, setConfirmAction: favorites.setConfirmAction,
        listPickerOpen: favorites.listPickerOpen, setListPickerOpen: favorites.setListPickerOpen,
        listPickerItem: favorites.listPickerItem, setListPickerItem: favorites.setListPickerItem,
        createFavList: favorites.createFavList, renameFavList: favorites.renameFavList,
        deleteFavList: favorites.deleteFavList, addToFavList: favorites.addToFavList,
        removeFromFavList: favorites.removeFromFavList, favListItemCount: favorites.favListItemCount,
        // Multi-list Saved Searches (from usePncpSavedSearches)
        searchListNames: savedSearches.searchListNames,
        filteredSavedSearches: savedSearches.filteredSavedSearches,
        activeSearchListName: savedSearches.activeSearchListName,
        setActiveSearchListName: savedSearches.setActiveSearchListName,
        searchListPickerOpen: savedSearches.searchListPickerOpen,
        setSearchListPickerOpen: savedSearches.setSearchListPickerOpen,
        renameSearchList: savedSearches.renameSearchList,
        deleteSearchList: savedSearches.deleteSearchList,
        // Computed
        displayItems, activeFilterCount: search.activeFilterCount,
        // Handlers
        toggleFavorito: favorites.toggleFavorito, exportFavoritesToPdf: favorites.exportFavoritesToPdf,
        handleSearch: search.handleSearch, handleSaveSearch, startSaveSearch: savedSearches.startSaveSearch,
        loadSavedSearch,
        deleteSavedSearch: savedSearches.deleteSavedSearch, clearSearch,
        editingSearch: savedSearches.editingSearch, setEditingSearch: savedSearches.setEditingSearch,
        updateSavedSearch: savedSearches.updateSavedSearch,
        handleImportToFunnel, handlePncpAiAnalyze, handleSaveProcess,
        handleTriggerScan: scanner.handleTriggerScan,
        // Global scanner (from usePncpScanner)
        opportunityScannerEnabled: scanner.opportunityScannerEnabled,
        toggleOpportunityScanner: scanner.toggleOpportunityScanner,
        // Last scan info
        lastScanAt: scanner.lastScanAt, lastScanTotalNew: scanner.lastScanTotalNew,
        lastScanResults: scanner.lastScanResults, nextScanAt: scanner.nextScanAt,
        getSearchScanResult: scanner.getSearchScanResult,
        // Scanner Opportunities ("Encontradas" tab)
        scannerOpportunities: scanner.scannerOpportunities,
        scannerOpportunitiesTotal: scanner.scannerOpportunitiesTotal,
        scannerOpportunitiesPage: scanner.scannerOpportunitiesPage,
        setScannerOpportunitiesPage: scanner.setScannerOpportunitiesPage,
        scannerOpportunitiesLoading: scanner.scannerOpportunitiesLoading,
        scannerFilterSearchId: scanner.scannerFilterSearchId,
        setScannerFilterSearchId: scanner.setScannerFilterSearchId,
        unreadOpportunityCount: scanner.unreadOpportunityCount,
        markOpportunitiesViewed: scanner.markOpportunitiesViewed,
        fetchScannerOpportunities: scanner.fetchScannerOpportunities,
    };
}
