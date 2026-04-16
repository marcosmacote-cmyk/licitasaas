import axios from 'axios';
import https from 'https';
import prisma from '../../lib/prisma';
import { logger } from '../../lib/logger';
import { PncpSearchInput, PncpSearchResponse, PncpSearchMeta } from './pncp-search.types';

const STATUS_TO_GOVBR: Record<string, string> = {
    'recebendo_proposta': 'recebendo_proposta',
    'encerrada': 'encerradas',
    'suspensa': 'suspensas',
    'anulada': 'anuladas',
    'todas': '',
};

const MODALIDADE_MAP: Record<string, string> = {
    '1': 'Pregão', '2': 'Concorrência', '3': 'Concurso',
    '4': 'Leilão', '5': 'Diálogo Competitivo', '6': 'Dispensa',
    '7': 'Inexigibilidade', '8': 'Tomada de Preços', '9': 'Convite',
};

const pncpKeepAliveAgent = new https.Agent({ rejectUnauthorized: false, keepAlive: true, maxSockets: 10 });

export class PncpSearchService {

    /**
     * Motor de busca Local-First Prisma (A base de tudo)
     */
    static async searchLocal(input: PncpSearchInput): Promise<PncpSearchResponse> {
        const startTime = Date.now();
        const { keywords, status, uf, modalidade, esfera, valorMin, valorMax, orgao, orgaosLista, excludeKeywords, dataInicio, dataFim, pagina = 1, tamanhoPagina = 50 } = input;
        
        const where: any = {};
        const meta: PncpSearchMeta = { source: 'local', fallbackUsed: false, isPartial: false, errors: [] };

        if (uf) {
            const ufs = uf.split(',').map(u => u.trim()).filter(Boolean);
            if (ufs.length === 1) where.uf = ufs[0];
            else if (ufs.length > 1) where.uf = { in: ufs };
        }

        if (status) {
            const statusMap: Record<string, string[]> = {
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
                } else {
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
            if (valorMin) where.valorEstimado.gte = Number(valorMin);
            if (valorMax) where.valorEstimado.lte = Number(valorMax);
        }

        if (dataInicio || dataFim) {
            where.dataPublicacao = {};
            if (dataInicio) where.dataPublicacao.gte = new Date(dataInicio + 'T00:00:00');
            if (dataFim) where.dataPublicacao.lte = new Date(dataFim + 'T23:59:59');
        }

        let orgaoNames: string[] = [];
        if (orgao && orgao.trim()) {
            if (orgao.includes(',')) orgaoNames.push(...orgao.split(',').map(s => s.trim()).filter(Boolean));
            else orgaoNames.push(orgao.trim());
        }
        if (orgaosLista && orgaosLista.trim()) {
            const listNames = orgaosLista.split(/[\n,;]+/).map(s => s.trim().replace(/^"|"$/g, '')).filter((s) => s.length > 0);
            orgaoNames.push(...listNames);
        }
        orgaoNames = [...new Set(orgaoNames)];

        const orgaoFilters: any[] = [];
        if (orgaoNames.length > 0) {
            orgaoFilters.push({
                OR: orgaoNames.map((name: string) => {
                    const onlyDigits = name.replace(/\D/g, '');
                    if (onlyDigits.length === 14) return { cnpjOrgao: onlyDigits };
                    return {
                        OR: [
                            { orgaoNome: { contains: name, mode: 'insensitive' as const } },
                            { unidadeNome: { contains: name, mode: 'insensitive' as const } },
                        ]
                    };
                })
            });
        }

        const keywordFilters: any[] = [];
        if (keywords && keywords.trim()) {
            const rawTerms = keywords.includes(',')
                ? keywords.split(',').map(t => t.trim().replace(/^"|"$/g, '')).filter(t => t.length > 1)
                : keywords.trim().split(/\s+/).filter(t => t.length > 1);
            if (rawTerms.length > 0) {
                for (const term of rawTerms) {
                    keywordFilters.push({
                        OR: [
                            { objeto: { contains: term, mode: 'insensitive' as const } },
                            { orgaoNome: { contains: term, mode: 'insensitive' as const } },
                            { unidadeNome: { contains: term, mode: 'insensitive' as const } },
                        ]
                    });
                }
            }
        }

        const excludeFilters: any[] = [];
        if (excludeKeywords && excludeKeywords.trim()) {
            const excludeTerms = excludeKeywords.split(',').map(t => t.trim()).filter(t => t.length > 0);
            for (const term of excludeTerms) {
                excludeFilters.push({ NOT: { objeto: { contains: term, mode: 'insensitive' as const } } });
            }
        }

        const andConditions: any[] = [];
        if (where.OR) {
            andConditions.push({ OR: where.OR });
            delete where.OR;
        }
        andConditions.push(...keywordFilters, ...orgaoFilters, ...excludeFilters);
        if (andConditions.length > 0) where.AND = andConditions;

        try {
            logger.info(`[PncpSearch] searchLocal WHERE: ${JSON.stringify(where).substring(0, 300)}`);
            const total = await prisma.pncpContratacao.count({ where });
            const skip = (Number(pagina) - 1) * Number(tamanhoPagina);
            const contratacoes = await prisma.pncpContratacao.findMany({
                where,
                // itens NÃO são carregados na listagem principal — apenas no detalhe/prefetch
                orderBy: [ { dataEncerramento: { sort: 'asc', nulls: 'last' } } ],
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
                    if (daysUntil <= 3) urgency = 'critical';
                    else if (daysUntil <= 7) urgency = 'high';
                    else if (daysUntil <= 15) urgency = 'medium';
                    else urgency = 'low';
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
        } catch (error: any) {
            logger.error(`[PncpSearch] ❌ LOCAL QUERY FAILED: ${error?.message}`, { stack: error?.stack?.split('\n').slice(0,3).join(' | ') });
            meta.errors.push(`Local query failed: ${error?.message}`);
            meta.elapsedMs = Date.now() - startTime;
            // IMPORTANTE: marcar como erro local para que search() não tente Gov.br
            meta.isPartial = true;
            return { items: [], total: -1, meta }; // total=-1 sinaliza erro (não "sem dados")
        }
    }

    /**
     * Motor de Busca Governamental (Remoto/Fallback)
     */
    static async searchGovbr(input: PncpSearchInput): Promise<PncpSearchResponse> {
        const startTime = Date.now();
        const { keywords, status, uf, modalidade, dataInicio, dataFim, esfera, orgao, orgaosLista, excludeKeywords } = input;
        const meta: PncpSearchMeta = { source: 'govbr', fallbackUsed: true, isPartial: false, errors: [] };
        const requestedPageSize = Math.max(1, Math.min(Number(input.tamanhoPagina) || 50, 100));
        let filteredItems: any[] = [];

        try {
            const useOfficialApi = (status === 'recebendo_proposta' || !status || status === '') && !orgao && !orgaosLista && !keywords;

            if (useOfficialApi) {
                const tomorrow = new Date();
                tomorrow.setDate(tomorrow.getDate() + 1);
                const dataFinalParam = dataFim ? dataFim.replace(/-/g, '') : tomorrow.toISOString().split('T')[0].replace(/-/g, '');
                const dataInicialParam = dataInicio ? dataInicio.replace(/-/g, '') : '';
                const officialPageSize = Math.min(requestedPageSize, 50);
                const officialPagesNeeded = Math.max(1, Math.ceil(requestedPageSize / officialPageSize));
                let ufsForApi: string[] = [];
                if (uf && uf.trim()) ufsForApi = uf.includes(',') ? uf.split(',').map(u => u.trim()).filter(Boolean) : [uf.trim()];
                const modalidadeCode = modalidade && modalidade !== 'todas' ? modalidade : '';

                const fetchOfficialPage = async (pageNum: number, singleUf?: string) => {
                    let url = `https://pncp.gov.br/api/consulta/v1/contratacoes/proposta?dataFinal=${dataFinalParam}&pagina=${pageNum}&tamanhoPagina=${officialPageSize}`;
                    if (dataInicialParam) url += `&dataInicial=${dataInicialParam}`;
                    if (singleUf) url += `&uf=${singleUf}`;
                    if (modalidadeCode) url += `&codigoModalidadeContratacao=${modalidadeCode}`;
                    
                    for (let attempt = 0; attempt < 3; attempt++) {
                        try {
                            const resp = await axios.get(url, { httpsAgent: pncpKeepAliveAgent, timeout: 10000 } as any);
                            return { data: Array.isArray((resp.data as any)?.data) ? (resp.data as any).data : [], totalPages: (resp.data as any)?.totalPaginas || 1 };
                        } catch (err: any) {
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

                let rawConsulta: any[] = [];
                if (ufsForApi.length > 0) {
                     // Parallel logic from the routes...
                     const ufBatches = await Promise.allSettled(ufsForApi.map(async (singleUf) => {
                         const first = await fetchOfficialPage(1, singleUf);
                         let allData = [...first.data];
                         const pagesToFetch = Math.min(first.totalPages, officialPagesNeeded);
                         if (pagesToFetch > 1) {
                             const pageResults = await Promise.allSettled(Array.from({ length: pagesToFetch - 1 }, (_, i) => fetchOfficialPage(i + 2, singleUf)));
                             pageResults.forEach(pr => { if (pr.status === 'fulfilled') allData.push(...pr.value.data); });
                         }
                         return allData;
                     }));
                     ufBatches.forEach(b => { if (b.status === 'fulfilled') rawConsulta.push(...b.value); });
                } else {
                     const first = await fetchOfficialPage(1);
                     rawConsulta = [...first.data];
                     const pagesToFetch = Math.min(first.totalPages, officialPagesNeeded);
                     if (pagesToFetch > 1) {
                         const pageResults = await Promise.allSettled(Array.from({ length: pagesToFetch - 1 }, (_, i) => fetchOfficialPage(i + 2)));
                         pageResults.forEach(pr => { if (pr.status === 'fulfilled') rawConsulta.push(...pr.value.data); });
                     }
                }

                const seenIds = new Set<string>();
                filteredItems = rawConsulta.filter(Boolean).map((item: any) => {
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
                     const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                     const kwTerms = keywords.split(',').map(k => normalize(k.trim().replace(/^"|"$/g, ''))).filter(k => k.length > 1);
                     if (kwTerms.length > 0) filteredItems = filteredItems.filter((it: any) => kwTerms.some((term) => normalize((it.objeto || '') + ' ' + (it.titulo || '') + ' ' + (it.orgao_nome || '')).includes(term)));
                }
            } else {
                // FALLBACK: Search API (/api/search/)
                let kwList: string[] = [];
                if (keywords) kwList = keywords.includes(',') ? keywords.split(',').map(k => k.trim().replace(/^"|"$/g, '')).filter(k => k.length > 0).map(k => k.includes(' ') ? `"${k}"` : k) : [keywords.includes(' ') && !keywords.startsWith('"') ? `"${keywords}"` : keywords];

                let effectiveOrgao = orgao || '';
                let effectiveOrgaosLista = orgaosLista || '';
                if (effectiveOrgao.includes(',')) { effectiveOrgaosLista = effectiveOrgaosLista ? `${effectiveOrgaosLista},${effectiveOrgao}` : effectiveOrgao; effectiveOrgao = ''; }
                let ufsToIterate: string[] = uf ? (uf.includes(',') ? uf.split(',').map(u => u.trim()).filter(Boolean) : [uf]) : [];
                let extractedNames: string[] = effectiveOrgaosLista ? [...new Set(effectiveOrgaosLista.split(/[\n,;]+/).map(s => s.trim().replace(/^"|"$/g, '')).filter(Boolean))] : [];
                
                const buildBaseUrl = (qItems: string[], overrideCnpj?: string, singleUf?: string) => {
                     const searchPageSize = Math.min(requestedPageSize, overrideCnpj ? 50 : 100);
                     let url = `https://pncp.gov.br/api/search/?tipos_documento=edital&ordenacao=-data&tam_pagina=${searchPageSize}&pagina=1`;
                     if (overrideCnpj) url += `&cnpj=${overrideCnpj}`;
                     if (qItems.length > 0) url += `&q=${encodeURIComponent(qItems.join(' '))}`;
                     const govStatus = status ? (STATUS_TO_GOVBR[status] || status) : '';
                     if (govStatus) url += `&status=${govStatus}`;
                     if (singleUf) url += `&ufs=${singleUf}`;
                     if (modalidade && modalidade !== 'todas') url += `&modalidades_licitacao=${encodeURIComponent(modalidade)}`;
                     if (dataInicio) url += `&data_inicio=${dataInicio}`;
                     if (dataFim) url += `&data_fim=${dataFim}`;
                     if (esfera && esfera !== 'todas') url += `&esferas=${esfera}`;
                     return url;
                };

                let urlsToFetch: string[] = [];
                const keywordsToIterate = kwList.length > 0 ? kwList : [null];
                const orgaosToIterate = extractedNames.length > 0 ? extractedNames : (effectiveOrgao ? [effectiveOrgao] : [null]);
                const ufsForIteration = ufsToIterate.length > 0 ? ufsToIterate : [null];
                 
                for (const kw of keywordsToIterate) {
                    for (const org2 of orgaosToIterate) {
                         for (const singleUf of ufsForIteration) {
                             let localParams: string[] = [];
                             let overrideCnpj: string | undefined = undefined;
                             if (kw) localParams.push(kw);
                             if (org2) {
                                  const onlyNumbers = org2.replace(/\D/g, '');
                                  if (onlyNumbers.length === 14) overrideCnpj = onlyNumbers;
                                  else localParams.push(org2.includes(' ') && !org2.startsWith('"') ? `"${org2}"` : org2);
                             }
                             urlsToFetch.push(buildBaseUrl(localParams, overrideCnpj, singleUf || undefined));
                         }
                    }
                }
                urlsToFetch = urlsToFetch.slice(0, 10);
                let rawItems: any[] = [];
                const fetchWithRetry = async (url: string, retries = 2) => {
                     for (let attempt = 0; attempt <= retries; attempt++) {
                          try {
                               const resp = await axios.get(url, { headers: { 'Accept': 'application/json' }, httpsAgent: pncpKeepAliveAgent, timeout: 12000 } as any);
                               return Array.isArray((resp.data as any)?.items) ? (resp.data as any).items : (Array.isArray((resp.data as any)?.data) ? (resp.data as any).data : []);
                          } catch (err: any) {
                               if (attempt < retries && (err.code === 'ECONNABORTED' || err?.response?.status >= 500)) { await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); continue; }
                               meta.errors.push(`Govbr search failed: ${err.message}`);
                               meta.isPartial = true;
                               return [];
                          }
                     }
                     return [];
                };

                for (let i = 0; i < urlsToFetch.length; i += 5) {
                     if (rawItems.length >= requestedPageSize) break;
                     const results = await Promise.all(urlsToFetch.slice(i, i + 5).map(u => fetchWithRetry(u)));
                     results.forEach(items => rawItems = rawItems.concat(items));
                }

                const seenIds = new Set<string>();
                filteredItems = rawItems.filter(Boolean).map((item: any) => {
                     let cnpj = item.orgao_cnpj || item.orgaoEntidade?.cnpj || item.cnpj || '';
                     let ano = item.ano || item.anoCompra || '';
                     let nSeq = item.numero_sequencial || item.sequencialCompra || item.numero_compra || '';
                     if (item.numeroControlePNCP && (!cnpj || !ano || !nSeq)) {
                          const ctrlMatch = item.numeroControlePNCP.match(/^(\d{11,14})-(\d+)-(\d+)\/(\d{4})$/);
                          if (ctrlMatch) { if (!cnpj) cnpj = ctrlMatch[1]; if (!nSeq) nSeq = ctrlMatch[3]; if (!ano) ano = ctrlMatch[4]; }
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
                     filteredItems = filteredItems.filter((it: any) => !it.uf || allowedUfs.has(it.uf.trim().toUpperCase()));
                }
                const elapsed = Date.now() - startTime;
                const hydrateBudget = Math.max(0, 15000 - elapsed);
                if (hydrateBudget > 2000) {
                     const itemsToHydrate = filteredItems.slice(0, 10).filter((it: any) => it.orgao_cnpj && it.ano && it.numero_sequencial && (!it.valor_estimado || it.valor_estimado === 0));
                     if (itemsToHydrate.length > 0) {
                          const hydrateResults = await Promise.allSettled(itemsToHydrate.map((it: any) => axios.get(`https://pncp.gov.br/api/consulta/v1/orgaos/${it.orgao_cnpj}/compras/${it.ano}/${it.numero_sequencial}`, { httpsAgent: pncpKeepAliveAgent, timeout: Math.min(hydrateBudget, 5000) } as any)));
                          hydrateResults.forEach((r, idx) => {
                               if (r.status === 'fulfilled') {
                                    const val = (r.value.data as any)?.valorTotalEstimado ?? (r.value.data as any)?.valorTotalHomologado ?? null;
                                    if (val != null && Number(val) > 0) itemsToHydrate[idx].valor_estimado = Number(val);
                               }
                          });
                     }
                }
            }

            // COMMON POST PROCESSING FOR REMOTO
            if (modalidade && modalidade !== 'todas') {
                const modalidadeLabel = (MODALIDADE_MAP[modalidade] || '').toLowerCase();
                if (modalidadeLabel) filteredItems = filteredItems.filter((it: any) => (it.modalidade_nome || '').toLowerCase().includes(modalidadeLabel));
            }
            if (esfera && esfera !== 'todas') {
                const esferaMap: Record<string, string[]> = { 'F': ['F', '1'], 'E': ['E', '2'], 'M': ['M', '3'], 'D': ['D', '4'] };
                const allowed = new Set(esferaMap[esfera] || [esfera]);
                filteredItems = filteredItems.filter((it: any) => !it.esfera_id || allowed.has(String(it.esfera_id)));
            }
            if (excludeKeywords && excludeKeywords.trim()) {
                const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                const excludeTerms = excludeKeywords.split(',').map(t => normalize(t.trim())).filter(t => t.length > 0);
                if (excludeTerms.length > 0) {
                    filteredItems = filteredItems.filter((it: any) => {
                        const objNorm = normalize((it.objeto || '') + ' ' + (it.titulo || ''));
                        return !excludeTerms.some(term => objNorm.includes(term));
                    });
                }
            }
            if (dataInicio || dataFim) {
                const startTs = dataInicio ? new Date(dataInicio + 'T00:00:00').getTime() : 0;
                const endTs = dataFim ? new Date(dataFim + 'T23:59:59').getTime() : Infinity;
                filteredItems = filteredItems.filter((it: any) => {
                    if (!it.data_publicacao) return true;
                    const pubTs = new Date(it.data_publicacao).getTime();
                    return isNaN(pubTs) || (pubTs >= startTs && pubTs <= endTs);
                });
            }
            const now = Date.now();
            filteredItems.sort((a: any, b: any) => {
                const dateA = new Date(a.data_encerramento_proposta || a.data_abertura || '9999').getTime();
                const dateB = new Date(b.data_encerramento_proposta || b.data_abertura || '9999').getTime();
                const validA = !isNaN(dateA), validB = !isNaN(dateB);
                const futureA = validA && dateA >= now, futureB = validB && dateB >= now;
                if (futureA && !futureB) return -1;
                if (!futureA && futureB) return 1;
                if (futureA && futureB) return dateA - dateB;
                if (!validA && !validB) return 0;
                if (!validA) return 1;
                if (!validB) return -1;
                return dateB - dateA;
            });
            filteredItems = filteredItems.slice(0, requestedPageSize);

            meta.remoteCount = filteredItems.length;
            meta.elapsedMs = Date.now() - startTime;
            return { items: filteredItems, total: filteredItems.length, meta };
        } catch (error: any) {
            logger.error("PncpSearchService govbr query error: ", error);
            meta.errors.push(error?.message || "Govbr query failed");
            meta.elapsedMs = Date.now() - startTime;
            return { items: [], total: 0, meta };
        }
    }

    /**
     * BUSCA 100% LOCAL — Modelo Conlicitações
     * 
     * A base local tem 6000+ contratações sincronizadas pelo pncp-aggregator (Railway).
     * Prisma cobre todos os filtros: UF, status, keywords (ILIKE), modalidade, datas.
     * 
     * Gov.br NÃO é chamado em tempo de busca. Nunca. Zero.
     * Gov.br é usado EXCLUSIVAMENTE pelo serviço pncp-aggregator (background sync).
     * 
     * Ref: Conlicitações usa 100% base local (668K registros, resposta em 2s).
     */
    static async search(input: PncpSearchInput): Promise<PncpSearchResponse> {
        const localResponse = await this.searchLocal(input);
        
        if (localResponse.total < 0) {
            // searchLocal teve erro de conexão — normalizar para o frontend
            localResponse.total = 0;
        }
        
        logger.info(`[PncpSearch] ${localResponse.total > 0 ? '✅' : '⚠️'} Local: ${localResponse.total} resultados em ${localResponse.meta.elapsedMs}ms | UF=${input.uf || 'todas'} | keywords=${input.keywords || 'nenhuma'}`);
        
        return localResponse;
    }
}
