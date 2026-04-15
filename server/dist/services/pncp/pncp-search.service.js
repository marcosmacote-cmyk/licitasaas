"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PncpSearchService = void 0;
const axios_1 = __importDefault(require("axios"));
const https_1 = __importDefault(require("https"));
const prisma_1 = __importDefault(require("../../lib/prisma"));
const logger_1 = require("../../lib/logger");
const STATUS_TO_GOVBR = {
    'recebendo_proposta': 'recebendo_proposta',
    'encerrada': 'encerradas',
    'suspensa': 'suspensas',
    'anulada': 'anuladas',
    'todas': '',
};
const MODALIDADE_MAP = {
    '1': 'Pregão', '2': 'Concorrência', '3': 'Concurso',
    '4': 'Leilão', '5': 'Diálogo Competitivo', '6': 'Dispensa',
    '7': 'Inexigibilidade', '8': 'Tomada de Preços', '9': 'Convite',
};
const pncpKeepAliveAgent = new https_1.default.Agent({ rejectUnauthorized: false, keepAlive: true, maxSockets: 10 });
class PncpSearchService {
    /**
     * Motor de busca Local-First Prisma (A base de tudo)
     */
    static async searchLocal(input) {
        const startTime = Date.now();
        const { keywords, status, uf, modalidade, esfera, valorMin, valorMax, orgao, orgaosLista, excludeKeywords, dataInicio, dataFim, pagina = 1, tamanhoPagina = 50 } = input;
        const where = {};
        const meta = { source: 'local', fallbackUsed: false, isPartial: false, errors: [] };
        if (uf) {
            const ufs = uf.split(',').map(u => u.trim()).filter(Boolean);
            if (ufs.length === 1)
                where.uf = ufs[0];
            else if (ufs.length > 1)
                where.uf = { in: ufs };
        }
        if (status) {
            const statusMap = {
                'recebendo_proposta': ['Divulgada', 'Aberta'],
                'encerrada': ['Encerrada'],
                'suspensa': ['Suspensa'],
                'anulada': ['Revogada', 'Anulada'],
                'revogada': ['Revogada', 'Anulada'], // alias de compatibilidade
            };
            const mapped = statusMap[status];
            if (mapped) {
                if (status === 'recebendo_proposta') {
                    where.OR = [{ situacao: { in: mapped } }, { situacao: null }];
                }
                else {
                    where.situacao = { in: mapped };
                }
            }
        }
        if (modalidade && modalidade !== 'todas') {
            const modalText = MODALIDADE_MAP[modalidade] || modalidade;
            where.modalidade = { contains: modalText, mode: 'insensitive' };
        }
        if (esfera && esfera !== 'todas') {
            where.esfera = esfera;
        }
        if (valorMin || valorMax) {
            where.valorEstimado = {};
            if (valorMin)
                where.valorEstimado.gte = Number(valorMin);
            if (valorMax)
                where.valorEstimado.lte = Number(valorMax);
        }
        if (dataInicio || dataFim) {
            where.dataPublicacao = {};
            if (dataInicio)
                where.dataPublicacao.gte = new Date(dataInicio + 'T00:00:00');
            if (dataFim)
                where.dataPublicacao.lte = new Date(dataFim + 'T23:59:59');
        }
        let orgaoNames = [];
        if (orgao && orgao.trim()) {
            if (orgao.includes(','))
                orgaoNames.push(...orgao.split(',').map(s => s.trim()).filter(Boolean));
            else
                orgaoNames.push(orgao.trim());
        }
        if (orgaosLista && orgaosLista.trim()) {
            const listNames = orgaosLista.split(/[\n,;]+/).map(s => s.trim().replace(/^"|"$/g, '')).filter((s) => s.length > 0);
            orgaoNames.push(...listNames);
        }
        orgaoNames = [...new Set(orgaoNames)];
        const orgaoFilters = [];
        if (orgaoNames.length > 0) {
            orgaoFilters.push({
                OR: orgaoNames.map((name) => {
                    const onlyDigits = name.replace(/\D/g, '');
                    if (onlyDigits.length === 14)
                        return { cnpjOrgao: onlyDigits };
                    return {
                        OR: [
                            { orgaoNome: { contains: name, mode: 'insensitive' } },
                            { unidadeNome: { contains: name, mode: 'insensitive' } },
                        ]
                    };
                })
            });
        }
        const keywordFilters = [];
        if (keywords && keywords.trim()) {
            const rawTerms = keywords.includes(',')
                ? keywords.split(',').map(t => t.trim().replace(/^"|"$/g, '')).filter(t => t.length > 1)
                : keywords.trim().split(/\s+/).filter(t => t.length > 1);
            if (rawTerms.length > 0) {
                for (const term of rawTerms) {
                    keywordFilters.push({
                        OR: [
                            { objeto: { contains: term, mode: 'insensitive' } },
                            { orgaoNome: { contains: term, mode: 'insensitive' } },
                            { unidadeNome: { contains: term, mode: 'insensitive' } },
                        ]
                    });
                }
            }
        }
        const excludeFilters = [];
        if (excludeKeywords && excludeKeywords.trim()) {
            const excludeTerms = excludeKeywords.split(',').map(t => t.trim()).filter(t => t.length > 0);
            for (const term of excludeTerms) {
                excludeFilters.push({ NOT: { objeto: { contains: term, mode: 'insensitive' } } });
            }
        }
        const andConditions = [];
        if (where.OR) {
            andConditions.push({ OR: where.OR });
            delete where.OR;
        }
        andConditions.push(...keywordFilters, ...orgaoFilters, ...excludeFilters);
        if (andConditions.length > 0)
            where.AND = andConditions;
        try {
            const total = await prisma_1.default.pncpContratacao.count({ where });
            const skip = (Number(pagina) - 1) * Number(tamanhoPagina);
            const contratacoes = await prisma_1.default.pncpContratacao.findMany({
                where,
                // itens NÃO são carregados na listagem principal — apenas no detalhe/prefetch
                orderBy: [{ dataEncerramento: { sort: 'asc', nulls: 'last' } }],
                skip,
                take: Number(tamanhoPagina),
            });
            const now = Date.now();
            const items = contratacoes.map((c) => {
                const cnpj = c.cnpjOrgao || '';
                const ano = String(c.anoCompra || '');
                const nSeq = String(c.sequencialCompra || '');
                const pncpId = c.numeroControle || (cnpj && ano && nSeq ? `${cnpj}-${ano}-${nSeq}` : String(c.id));
                let urgency = 'medium';
                if (c.dataEncerramento) {
                    const daysUntil = (new Date(c.dataEncerramento).getTime() - now) / (1000 * 3600 * 24);
                    if (daysUntil <= 3)
                        urgency = 'critical';
                    else if (daysUntil <= 7)
                        urgency = 'high';
                    else if (daysUntil <= 15)
                        urgency = 'medium';
                    else
                        urgency = 'low';
                }
                return {
                    id: pncpId,
                    orgao_cnpj: cnpj,
                    ano,
                    numero_sequencial: nSeq,
                    titulo: c.objeto?.substring(0, 120) || `${c.modalidade || 'Licitação'} nº ${nSeq}/${ano}`,
                    objeto: c.objeto || 'Sem objeto',
                    orgao_nome: c.orgaoNome || 'Órgão não informado',
                    unidade_nome: c.unidadeNome || '',
                    uf: c.uf || '',
                    municipio: c.municipio || '',
                    esfera: c.esfera || '',
                    esfera_id: c.esfera || '',
                    modalidade: c.modalidade || '',
                    modalidade_nome: c.modalidade || '',
                    situacao: c.situacao || '',
                    status: c.situacao || 'Aberta',
                    valor_estimado: c.valorEstimado ? Number(c.valorEstimado) : 0,
                    valor_homologado: c.valorHomologado ? Number(c.valorHomologado) : null,
                    srp: c.srp || false,
                    data_publicacao: c.dataPublicacao ? c.dataPublicacao.toISOString() : new Date().toISOString(),
                    data_abertura: c.dataAbertura ? c.dataAbertura.toISOString() : '',
                    data_encerramento_proposta: c.dataEncerramento ? c.dataEncerramento.toISOString() : '',
                    link_sistema: (cnpj && ano && nSeq) ? `https://pncp.gov.br/app/editais/${cnpj}/${ano}/${nSeq}` : (c.linkOrigem || c.linkSistema || ''),
                    link_comprasnet: c.linkSistema || '',
                    numeroControlePNCP: c.numeroControle,
                    urgency,
                    itens_preview: [], // carregado sob demanda no detalhe
                    _source: 'local',
                };
            });
            meta.elapsedMs = Date.now() - startTime;
            meta.localCount = Number(total);
            return { items, total: Number(total), meta };
        }
        catch (error) {
            logger_1.logger.error("PncpSearchService local query error: ", error);
            meta.errors.push(error?.message || "Local query failed");
            meta.elapsedMs = Date.now() - startTime;
            return { items: [], total: 0, meta };
        }
    }
    /**
     * Motor de Busca Governamental (Remoto/Fallback)
     */
    static async searchGovbr(input) {
        const startTime = Date.now();
        const { keywords, status, uf, modalidade, dataInicio, dataFim, esfera, orgao, orgaosLista, excludeKeywords } = input;
        const meta = { source: 'govbr', fallbackUsed: true, isPartial: false, errors: [] };
        const requestedPageSize = Math.max(1, Math.min(Number(input.tamanhoPagina) || 50, 100));
        let filteredItems = [];
        try {
            const useOfficialApi = (status === 'recebendo_proposta' || !status || status === '') && !orgao && !orgaosLista && !keywords;
            if (useOfficialApi) {
                const tomorrow = new Date();
                tomorrow.setDate(tomorrow.getDate() + 1);
                const dataFinalParam = dataFim ? dataFim.replace(/-/g, '') : tomorrow.toISOString().split('T')[0].replace(/-/g, '');
                const dataInicialParam = dataInicio ? dataInicio.replace(/-/g, '') : '';
                const officialPageSize = Math.min(requestedPageSize, 50);
                const officialPagesNeeded = Math.max(1, Math.ceil(requestedPageSize / officialPageSize));
                let ufsForApi = [];
                if (uf && uf.trim())
                    ufsForApi = uf.includes(',') ? uf.split(',').map(u => u.trim()).filter(Boolean) : [uf.trim()];
                const modalidadeCode = modalidade && modalidade !== 'todas' ? modalidade : '';
                const fetchOfficialPage = async (pageNum, singleUf) => {
                    let url = `https://pncp.gov.br/api/consulta/v1/contratacoes/proposta?dataFinal=${dataFinalParam}&pagina=${pageNum}&tamanhoPagina=${officialPageSize}`;
                    if (dataInicialParam)
                        url += `&dataInicial=${dataInicialParam}`;
                    if (singleUf)
                        url += `&uf=${singleUf}`;
                    if (modalidadeCode)
                        url += `&codigoModalidadeContratacao=${modalidadeCode}`;
                    for (let attempt = 0; attempt < 3; attempt++) {
                        try {
                            const resp = await axios_1.default.get(url, { httpsAgent: pncpKeepAliveAgent, timeout: 10000 });
                            return { data: Array.isArray(resp.data?.data) ? resp.data.data : [], totalPages: resp.data?.totalPaginas || 1 };
                        }
                        catch (err) {
                            if (attempt < 2 && (err?.response?.status >= 500 || err.code === 'ECONNABORTED')) {
                                await new Promise(r => setTimeout(r, 1000 * Math.pow(2, attempt)));
                                continue;
                            }
                            meta.errors.push(`Govbr consulta/v1 failed: ${err.message}`);
                            meta.isPartial = true;
                            return { data: [], totalPages: 0 };
                        }
                    }
                    return { data: [], totalPages: 0 };
                };
                let rawConsulta = [];
                if (ufsForApi.length > 0) {
                    // Parallel logic from the routes...
                    const ufBatches = await Promise.allSettled(ufsForApi.map(async (singleUf) => {
                        const first = await fetchOfficialPage(1, singleUf);
                        let allData = [...first.data];
                        const pagesToFetch = Math.min(first.totalPages, officialPagesNeeded);
                        if (pagesToFetch > 1) {
                            const pageResults = await Promise.allSettled(Array.from({ length: pagesToFetch - 1 }, (_, i) => fetchOfficialPage(i + 2, singleUf)));
                            pageResults.forEach(pr => { if (pr.status === 'fulfilled')
                                allData.push(...pr.value.data); });
                        }
                        return allData;
                    }));
                    ufBatches.forEach(b => { if (b.status === 'fulfilled')
                        rawConsulta.push(...b.value); });
                }
                else {
                    const first = await fetchOfficialPage(1);
                    rawConsulta = [...first.data];
                    const pagesToFetch = Math.min(first.totalPages, officialPagesNeeded);
                    if (pagesToFetch > 1) {
                        const pageResults = await Promise.allSettled(Array.from({ length: pagesToFetch - 1 }, (_, i) => fetchOfficialPage(i + 2)));
                        pageResults.forEach(pr => { if (pr.status === 'fulfilled')
                            rawConsulta.push(...pr.value.data); });
                    }
                }
                const seenIds = new Set();
                filteredItems = rawConsulta.filter(Boolean).map((item) => {
                    const org = item.orgaoEntidade || {};
                    const uni = item.unidadeOrgao || {};
                    const cnpj = org.cnpj || '';
                    const ano = String(item.anoCompra || '');
                    const nSeq = String(item.sequencialCompra || '');
                    const pncpId = item.numeroControlePNCP || (cnpj && ano && nSeq ? `${cnpj}-${ano}-${nSeq}` : Math.random().toString());
                    return {
                        id: pncpId,
                        orgao_nome: org.razaoSocial || 'Órgão não informado',
                        orgao_cnpj: cnpj, ano, numero_sequencial: nSeq,
                        titulo: item.numeroCompra ? `Compra nº ${item.numeroCompra}/${ano}` : `${item.modalidadeNome || 'Licitação'} nº ${nSeq}/${ano}`,
                        objeto: item.objetoCompra || 'Sem objeto',
                        data_publicacao: item.dataPublicacaoPncp || item.dataInclusao || new Date().toISOString(),
                        data_abertura: item.dataAberturaProposta || '',
                        data_encerramento_proposta: item.dataEncerramentoProposta || '',
                        valor_estimado: Number(item.valorTotalEstimado || item.valorTotalHomologado || 0),
                        uf: uni.ufSigla || '', municipio: uni.municipioNome || '',
                        modalidade_nome: item.modalidadeNome || '',
                        link_sistema: (cnpj && ano && nSeq) ? `https://pncp.gov.br/app/editais/${cnpj}/${ano}/${nSeq}` : (item.linkSistemaOrigem || ''),
                        status: item.situacaoCompraNome || 'Aberta',
                        esfera_id: org.esferaId || '', urgency: 'medium',
                    };
                }).filter(item => !seenIds.has(item.id) && seenIds.add(item.id));
                if (keywords) {
                    const normalize = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                    const kwTerms = keywords.split(',').map(k => normalize(k.trim().replace(/^"|"$/g, ''))).filter(k => k.length > 1);
                    if (kwTerms.length > 0)
                        filteredItems = filteredItems.filter((it) => kwTerms.some((term) => normalize((it.objeto || '') + ' ' + (it.titulo || '') + ' ' + (it.orgao_nome || '')).includes(term)));
                }
            }
            else {
                // FALLBACK: Search API (/api/search/)
                let kwList = [];
                if (keywords)
                    kwList = keywords.includes(',') ? keywords.split(',').map(k => k.trim().replace(/^"|"$/g, '')).filter(k => k.length > 0).map(k => k.includes(' ') ? `"${k}"` : k) : [keywords.includes(' ') && !keywords.startsWith('"') ? `"${keywords}"` : keywords];
                let effectiveOrgao = orgao || '';
                let effectiveOrgaosLista = orgaosLista || '';
                if (effectiveOrgao.includes(',')) {
                    effectiveOrgaosLista = effectiveOrgaosLista ? `${effectiveOrgaosLista},${effectiveOrgao}` : effectiveOrgao;
                    effectiveOrgao = '';
                }
                let ufsToIterate = uf ? (uf.includes(',') ? uf.split(',').map(u => u.trim()).filter(Boolean) : [uf]) : [];
                let extractedNames = effectiveOrgaosLista ? [...new Set(effectiveOrgaosLista.split(/[\n,;]+/).map(s => s.trim().replace(/^"|"$/g, '')).filter(Boolean))] : [];
                const buildBaseUrl = (qItems, overrideCnpj, singleUf) => {
                    const searchPageSize = Math.min(requestedPageSize, overrideCnpj ? 50 : 100);
                    let url = `https://pncp.gov.br/api/search/?tipos_documento=edital&ordenacao=-data&tam_pagina=${searchPageSize}&pagina=1`;
                    if (overrideCnpj)
                        url += `&cnpj=${overrideCnpj}`;
                    if (qItems.length > 0)
                        url += `&q=${encodeURIComponent(qItems.join(' '))}`;
                    const govStatus = status ? (STATUS_TO_GOVBR[status] || status) : '';
                    if (govStatus)
                        url += `&status=${govStatus}`;
                    if (singleUf)
                        url += `&ufs=${singleUf}`;
                    if (modalidade && modalidade !== 'todas')
                        url += `&modalidades_licitacao=${encodeURIComponent(modalidade)}`;
                    if (dataInicio)
                        url += `&data_inicio=${dataInicio}`;
                    if (dataFim)
                        url += `&data_fim=${dataFim}`;
                    if (esfera && esfera !== 'todas')
                        url += `&esferas=${esfera}`;
                    return url;
                };
                let urlsToFetch = [];
                const keywordsToIterate = kwList.length > 0 ? kwList : [null];
                const orgaosToIterate = extractedNames.length > 0 ? extractedNames : (effectiveOrgao ? [effectiveOrgao] : [null]);
                const ufsForIteration = ufsToIterate.length > 0 ? ufsToIterate : [null];
                for (const kw of keywordsToIterate) {
                    for (const org2 of orgaosToIterate) {
                        for (const singleUf of ufsForIteration) {
                            let localParams = [];
                            let overrideCnpj = undefined;
                            if (kw)
                                localParams.push(kw);
                            if (org2) {
                                const onlyNumbers = org2.replace(/\D/g, '');
                                if (onlyNumbers.length === 14)
                                    overrideCnpj = onlyNumbers;
                                else
                                    localParams.push(org2.includes(' ') && !org2.startsWith('"') ? `"${org2}"` : org2);
                            }
                            urlsToFetch.push(buildBaseUrl(localParams, overrideCnpj, singleUf || undefined));
                        }
                    }
                }
                urlsToFetch = urlsToFetch.slice(0, 10);
                let rawItems = [];
                const fetchWithRetry = async (url, retries = 2) => {
                    for (let attempt = 0; attempt <= retries; attempt++) {
                        try {
                            const resp = await axios_1.default.get(url, { headers: { 'Accept': 'application/json' }, httpsAgent: pncpKeepAliveAgent, timeout: 12000 });
                            return Array.isArray(resp.data?.items) ? resp.data.items : (Array.isArray(resp.data?.data) ? resp.data.data : []);
                        }
                        catch (err) {
                            if (attempt < retries && (err.code === 'ECONNABORTED' || err?.response?.status >= 500)) {
                                await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
                                continue;
                            }
                            meta.errors.push(`Govbr search failed: ${err.message}`);
                            meta.isPartial = true;
                            return [];
                        }
                    }
                    return [];
                };
                for (let i = 0; i < urlsToFetch.length; i += 5) {
                    if (rawItems.length >= requestedPageSize)
                        break;
                    const results = await Promise.all(urlsToFetch.slice(i, i + 5).map(u => fetchWithRetry(u)));
                    results.forEach(items => rawItems = rawItems.concat(items));
                }
                const seenIds = new Set();
                filteredItems = rawItems.filter(Boolean).map((item) => {
                    let cnpj = item.orgao_cnpj || item.orgaoEntidade?.cnpj || item.cnpj || '';
                    let ano = item.ano || item.anoCompra || '';
                    let nSeq = item.numero_sequencial || item.sequencialCompra || item.numero_compra || '';
                    if (item.numeroControlePNCP && (!cnpj || !ano || !nSeq)) {
                        const ctrlMatch = item.numeroControlePNCP.match(/^(\d{11,14})-(\d+)-(\d+)\/(\d{4})$/);
                        if (ctrlMatch) {
                            if (!cnpj)
                                cnpj = ctrlMatch[1];
                            if (!nSeq)
                                nSeq = ctrlMatch[3];
                            if (!ano)
                                ano = ctrlMatch[4];
                        }
                    }
                    const rawVal = item.valor_estimado ?? item.valor_global ?? item.valorTotalEstimado ?? item.valorTotalHomologado ?? item.valorEstimado ?? 0;
                    const pncpId = item.numeroControlePNCP || (cnpj && ano && nSeq ? `${cnpj}-${ano}-${nSeq}` : null) || item.id || Math.random().toString();
                    return {
                        id: pncpId,
                        orgao_nome: item.orgao_nome || item.orgaoEntidade?.razaoSocial || item.nomeOrgao || 'Órgão não informado',
                        orgao_cnpj: cnpj, ano, numero_sequencial: nSeq,
                        titulo: item.title || item.titulo || item.identificador || 'Sem título',
                        objeto: item.description || item.objetoCompra || item.objeto || item.resumo || 'Sem objeto',
                        data_publicacao: item.createdAt || item.dataPublicacaoPncp || item.data_publicacao || new Date().toISOString(),
                        data_abertura: item.dataAberturaProposta || item.data_inicio_vigencia || item.data_abertura || '',
                        data_encerramento_proposta: item.dataEncerramentoProposta || item.data_fim_vigencia || '',
                        valor_estimado: Number(rawVal) || 0,
                        uf: item.uf || item.unidadeOrgao?.ufSigla || item.ufSigla || item.ufNome || '',
                        municipio: item.municipio_nome || item.unidadeOrgao?.municipioNome || item.municipio || '',
                        modalidade_nome: item.modalidade_licitacao_nome || item.modalidade_nome || item.modalidadeNome || '',
                        link_sistema: (cnpj && ano && nSeq) ? `https://pncp.gov.br/app/editais/${cnpj}/${ano}/${nSeq}` : (item.linkSistemaOrigem || item.link || ''),
                        status: item.situacao_nome || item.situacaoCompraNome || item.status || status || '',
                        esfera_id: item.esfera_id || item.esferaId || item.orgaoEntidade?.esferaId || '',
                        urgency: 'medium',
                    };
                }).filter(item => !seenIds.has(item.id) && seenIds.add(item.id));
                if (uf && uf.trim() !== '') {
                    const allowedUfs = new Set(uf.split(',').map((u) => u.trim().toUpperCase()));
                    filteredItems = filteredItems.filter((it) => !it.uf || allowedUfs.has(it.uf.trim().toUpperCase()));
                }
                const elapsed = Date.now() - startTime;
                const hydrateBudget = Math.max(0, 15000 - elapsed);
                if (hydrateBudget > 2000) {
                    const itemsToHydrate = filteredItems.slice(0, 10).filter((it) => it.orgao_cnpj && it.ano && it.numero_sequencial && (!it.valor_estimado || it.valor_estimado === 0));
                    if (itemsToHydrate.length > 0) {
                        const hydrateResults = await Promise.allSettled(itemsToHydrate.map((it) => axios_1.default.get(`https://pncp.gov.br/api/consulta/v1/orgaos/${it.orgao_cnpj}/compras/${it.ano}/${it.numero_sequencial}`, { httpsAgent: pncpKeepAliveAgent, timeout: Math.min(hydrateBudget, 5000) })));
                        hydrateResults.forEach((r, idx) => {
                            if (r.status === 'fulfilled') {
                                const val = r.value.data?.valorTotalEstimado ?? r.value.data?.valorTotalHomologado ?? null;
                                if (val != null && Number(val) > 0)
                                    itemsToHydrate[idx].valor_estimado = Number(val);
                            }
                        });
                    }
                }
            }
            // COMMON POST PROCESSING FOR REMOTO
            if (modalidade && modalidade !== 'todas') {
                const modalidadeLabel = (MODALIDADE_MAP[modalidade] || '').toLowerCase();
                if (modalidadeLabel)
                    filteredItems = filteredItems.filter((it) => (it.modalidade_nome || '').toLowerCase().includes(modalidadeLabel));
            }
            if (esfera && esfera !== 'todas') {
                const esferaMap = { 'F': ['F', '1'], 'E': ['E', '2'], 'M': ['M', '3'], 'D': ['D', '4'] };
                const allowed = new Set(esferaMap[esfera] || [esfera]);
                filteredItems = filteredItems.filter((it) => !it.esfera_id || allowed.has(String(it.esfera_id)));
            }
            if (excludeKeywords && excludeKeywords.trim()) {
                const normalize = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                const excludeTerms = excludeKeywords.split(',').map(t => normalize(t.trim())).filter(t => t.length > 0);
                if (excludeTerms.length > 0) {
                    filteredItems = filteredItems.filter((it) => {
                        const objNorm = normalize((it.objeto || '') + ' ' + (it.titulo || ''));
                        return !excludeTerms.some(term => objNorm.includes(term));
                    });
                }
            }
            if (dataInicio || dataFim) {
                const startTs = dataInicio ? new Date(dataInicio + 'T00:00:00').getTime() : 0;
                const endTs = dataFim ? new Date(dataFim + 'T23:59:59').getTime() : Infinity;
                filteredItems = filteredItems.filter((it) => {
                    if (!it.data_publicacao)
                        return true;
                    const pubTs = new Date(it.data_publicacao).getTime();
                    return isNaN(pubTs) || (pubTs >= startTs && pubTs <= endTs);
                });
            }
            const now = Date.now();
            filteredItems.sort((a, b) => {
                const dateA = new Date(a.data_encerramento_proposta || a.data_abertura || '9999').getTime();
                const dateB = new Date(b.data_encerramento_proposta || b.data_abertura || '9999').getTime();
                const validA = !isNaN(dateA), validB = !isNaN(dateB);
                const futureA = validA && dateA >= now, futureB = validB && dateB >= now;
                if (futureA && !futureB)
                    return -1;
                if (!futureA && futureB)
                    return 1;
                if (futureA && futureB)
                    return dateA - dateB;
                if (!validA && !validB)
                    return 0;
                if (!validA)
                    return 1;
                if (!validB)
                    return -1;
                return dateB - dateA;
            });
            filteredItems = filteredItems.slice(0, requestedPageSize);
            meta.remoteCount = filteredItems.length;
            meta.elapsedMs = Date.now() - startTime;
            return { items: filteredItems, total: filteredItems.length, meta };
        }
        catch (error) {
            logger_1.logger.error("PncpSearchService govbr query error: ", error);
            meta.errors.push(error?.message || "Govbr query failed");
            meta.elapsedMs = Date.now() - startTime;
            return { items: [], total: 0, meta };
        }
    }
    /**
     * Motor de Fusão (Busca Híbrida)
     * Abordagem atual: tentar Local-First. Se o DB local não retornar nada, tentar Remoto (Govbr).
     * No futuro isso pode mesclar e classificar tudo instantaneamente.
     */
    static async search(input, preferLocalIfPartial = true) {
        // Tentativa Local
        const localResponse = await this.searchLocal(input);
        // Filtros que o banco local NÃO cobre com confiança total (texto livre, orgaos externos, janelas de data)
        // UF, status, modalidade e esfera são bem indexados no local — não forçam remoto
        const hasHighRiskFilters = !!(input.keywords ||
            input.orgao ||
            input.orgaosLista ||
            input.dataInicio ||
            input.dataFim);
        // Se achou no local, mas é uma busca de baixo risco (ex: todos status recebendo_proposta)
        if (localResponse.total > 0 && !hasHighRiskFilters) {
            return localResponse;
        }
        // Se tem filtros de risco, a base local será marcada como possivelmente parcial
        if (localResponse.total > 0 && hasHighRiskFilters) {
            localResponse.meta.isPartial = true;
        }
        // Disparar Gov.br se o local zerou, OU se há filtros de risco e precisamos confirmar na fonte
        const shouldFallbackToRemote = localResponse.total === 0 || hasHighRiskFilters;
        if (!shouldFallbackToRemote) {
            return localResponse;
        }
        logger_1.logger.info(`[PncpSearchService] Disparando fallback Gov.br (Total Local: ${localResponse.total} | Filtros de Risco: ${hasHighRiskFilters})`);
        const remoteResponse = await this.searchGovbr(input);
        remoteResponse.meta.localCount = localResponse.total;
        // Se a remota não trouxe nada, mas a local tinha algo (ex: API offline), devolve a local (marcada como parcial)
        if (remoteResponse.total === 0 && localResponse.total > 0) {
            localResponse.meta.fallbackUsed = true;
            if (remoteResponse.meta.errors.length > 0) {
                localResponse.meta.errors.push(...remoteResponse.meta.errors);
            }
            return localResponse;
        }
        // Se ambos falharem, juntar os erros para observabilidade
        if (remoteResponse.total === 0 && (remoteResponse.meta.errors.length > 0 || localResponse.meta.errors.length > 0)) {
            remoteResponse.meta.errors = [...localResponse.meta.errors, ...remoteResponse.meta.errors];
        }
        return remoteResponse;
    }
}
exports.PncpSearchService = PncpSearchService;
