import prisma from '../../lib/prisma';
import { logger } from '../../lib/logger';
import axios from 'axios';
import https from 'https';

const agent = new https.Agent({ rejectUnauthorized: false, keepAlive: true, maxSockets: 10 });
const MODALITIES = ['1', '2', '4', '5', '6', '7'];

export class PncpHydrationService {
    /**
     * Formats Date object into YYYYMMDD string for Gov.br API
     */
    private static formatDateToYYYYMMDD(d: Date): string {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}${m}${day}`;
    }

    /**
     * Formats Date object into YYYY-MM-DD string for PncpHydrationLog
     */
    private static formatDateToISO(d: Date): string {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }

    /**
     * Generates all dates between start and end (inclusive)
     */
    private static getDatesInRange(start: Date, end: Date): Date[] {
        const dates: Date[] = [];
        let curr = new Date(start);
        while (curr <= end) {
            dates.push(new Date(curr));
            curr.setDate(curr.getDate() + 1);
        }
        return dates;
    }

    /**
     * Hydrates past date range on-demand
     */
    static async hydrate(dataInicio: string, dataFim: string): Promise<void> {
        const startTime = Date.now();
        const start = new Date(dataInicio + 'T00:00:00');
        const end = new Date(dataFim + 'T23:59:59');

        // Safety: Limit maximum date range to 1 year back
        const oneYearAgo = new Date();
        oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
        if (start < oneYearAgo) {
            logger.warn(`[Hydration] dataInicio ${dataInicio} is older than 1 year. Adjusting to ${this.formatDateToISO(oneYearAgo)}`);
            start.setTime(oneYearAgo.getTime());
        }

        const dates = this.getDatesInRange(start, end);
        if (dates.length === 0) return;

        logger.info(`[Hydration] Checking range ${dataInicio} to ${dataFim} (${dates.length} days)`);

        // Find which day + modality combinations are already hydrated
        const dateStrings = dates.map(d => this.formatDateToISO(d));
        const existingLogs = await prisma.pncpHydrationLog.findMany({
            where: {
                date: { in: dateStrings },
                modality: { in: MODALITIES }
            }
        });

        const hydratedSet = new Set<string>();
        for (const log of existingLogs) {
            hydratedSet.add(`${log.date}_${log.modality}`);
        }

        // Identify pending chunks of dates to fetch
        // We chunk dates in blocks of 7 days to query Gov.br efficiently
        const CHUNK_SIZE = 7;
        for (let i = 0; i < dates.length; i += CHUNK_SIZE) {
            const chunk = dates.slice(i, i + CHUNK_SIZE);
            const chunkStart = chunk[0];
            const chunkEnd = chunk[chunk.length - 1];
            
            const chunkStartStr = this.formatDateToISO(chunkStart);
            const chunkEndStr = this.formatDateToISO(chunkEnd);

            // Check if any modality needs hydration for this chunk
            const pendingModalities = MODALITIES.filter(mod => {
                return chunk.some(d => !hydratedSet.has(`${this.formatDateToISO(d)}_${mod}`));
            });

            if (pendingModalities.length === 0) {
                continue;
            }

            logger.info(`[Hydration] Hydrating block ${chunkStartStr} to ${chunkEndStr} for modalities: ${pendingModalities.join(', ')}`);

            // Fetch in parallel for the pending modalities of this chunk
            await Promise.all(pendingModalities.map(async (mod) => {
                try {
                    await this.fetchAndSaveChunk(chunkStart, chunkEnd, mod);
                    
                    // Mark all days in this chunk as hydrated for this modality
                    const logData = chunk.map(d => ({
                        date: this.formatDateToISO(d),
                        modality: mod
                    }));

                    await prisma.pncpHydrationLog.createMany({
                        data: logData,
                        skipDuplicates: true
                    });

                    // Add to local set to avoid duplicate work if same day appears again
                    chunk.forEach(d => hydratedSet.add(`${this.formatDateToISO(d)}_${mod}`));

                } catch (err: any) {
                    logger.error(`[Hydration] Failed block ${chunkStartStr} to ${chunkEndStr} for mod ${mod}: ${err.message}`);
                }
            }));
        }

        logger.info(`[Hydration] Hydration completed in ${Date.now() - startTime}ms`);
    }

    /**
     * Fetch from Gov.br API and upsert into local database
     */
    private static async fetchAndSaveChunk(start: Date, end: Date, modality: string): Promise<void> {
        const startParam = this.formatDateToYYYYMMDD(start);
        const endParam = this.formatDateToYYYYMMDD(end);

        let page = 1;
        let hasMore = true;

        while (hasMore) {
            const url = `https://pncp.gov.br/api/consulta/v1/contratacoes/publicacao?dataInicial=${startParam}&dataFinal=${endParam}&codigoModalidadeContratacao=${modality}&pagina=${page}&tamanhoPagina=100`;
            
            let data: any = null;
            let attempt = 0;
            const maxAttempts = 3;

            while (attempt < maxAttempts) {
                try {
                    const resp = await axios.get(url, {
                        headers: { 'Accept': 'application/json' },
                        httpsAgent: agent,
                        timeout: 10000
                    } as any);
                    data = resp.data;
                    break;
                } catch (err: any) {
                    attempt++;
                    if (attempt >= maxAttempts) throw err;
                    await new Promise(r => setTimeout(r, 1000 * attempt));
                }
            }

            const items = data?.data || [];
            if (items.length === 0) {
                break;
            }

            // Map and upsert
            const mappedItems = items.map((item: any) => this.mapContratacao(item));
            
            for (const item of mappedItems) {
                if (!item.cnpjOrgao || !item.anoCompra || !item.sequencialCompra) continue;
                
                try {
                    await prisma.pncpContratacao.upsert({
                        where: { numeroControle: item.numeroControle },
                        update: { ...item, syncedAt: new Date() },
                        create: item
                    });
                } catch (dbErr: any) {
                    if (!dbErr.message?.includes('Unique constraint')) {
                        logger.warn(`[Hydration DB] Skip upsert for ${item.numeroControle}: ${dbErr.message}`);
                    }
                }
            }

            const totalPaginas = data?.totalPaginas || 1;
            hasMore = page < totalPaginas;
            page++;
        }
    }

    /**
     * Mappings duplicated here to maintain self-contained file/service
     */
    private static mapContratacao(item: any): any {
        const orgao = item.orgaoEntidade || {};
        const unidade = item.unidadeOrgao || {};
        const cnpj = orgao.cnpj || item.cnpjOrgao || item.orgao_cnpj || '';
        const ano = item.anoCompra || item.ano || 0;
        const seq = item.sequencialCompra || item.numeroSequencial || item.numero_sequencial || 0;
        const numeroControle = item.numeroControlePNCP || item.numero_controle_pncp || `${cnpj}-1-${seq}/${ano}`;

        return {
            numeroControle,
            cnpjOrgao: cnpj,
            anoCompra: Number(ano),
            sequencialCompra: Number(seq),
            orgaoNome: orgao.razaoSocial || item.orgaoNome || item.orgao_nome || null,
            unidadeNome: unidade.nomeUnidade || item.unidadeNome || item.unidade_nome || null,
            uf: unidade.ufSigla || unidade.uf || item.uf || null,
            municipio: unidade.nomeMunicipio || unidade.municipio || item.municipio || item.municipio_nome || null,
            esfera: this.mapEsfera(orgao.esferaId || item.esfera || item.esfera_id),
            objeto: item.objetoCompra || item.objeto || item.description || null,
            modalidade: item.modalidadeNome || item.modalidade || item.modalidade_licitacao_nome || null,
            modalidadeCodigo: item.modalidadeId?.toString() || item.modalidadeCodigo || item.modalidade_licitacao_id || null,
            situacao: item.situacaoCompraId ? this.mapSituacao(item.situacaoCompraId) : (item.situacao || item.situacao_nome || null),
            valorEstimado: item.valorTotalEstimado ? Number(item.valorTotalEstimado) : (item.valor_global ? Number(item.valor_global) : null),
            valorHomologado: item.valorTotalHomologado ? Number(item.valorTotalHomologado) : null,
            srp: item.srp === true || item.srp === 'Sim',
            modoDisputa: item.modoDisputaNome || item.modoDisputa || null,
            numeroCompra: item.numeroCompra || null,
            dataPublicacao: item.dataPublicacaoPncp ? new Date(item.dataPublicacaoPncp) : (item.data_publicacao_pncp ? new Date(item.data_publicacao_pncp) : (item.createdAt ? new Date(item.createdAt) : null)),
            dataAbertura: item.dataAberturaProposta ? new Date(item.dataAberturaProposta) : (item.data_inicio_vigencia ? new Date(item.data_inicio_vigencia) : null),
            dataEncerramento: item.dataEncerramentoProposta ? new Date(item.dataEncerramentoProposta) : (item.data_fim_vigencia ? new Date(item.data_fim_vigencia) : null),
            dataInclusao: item.dataInclusao ? new Date(item.dataInclusao) : null,
            linkSistema: item.linkSistemaOrigem || null,
            linkOrigem: numeroControle ? `https://pncp.gov.br/app/editais/${cnpj}/${ano}/${seq}` : null,
        };
    }

    private static mapSituacao(id: any): string {
        const map: Record<string, string> = {
            '1': 'Divulgada', '2': 'Aberta', '3': 'Encerrada',
            '4': 'Suspensa', '5': 'Revogada', '6': 'Anulada',
            '7': 'Deserta', '8': 'Fracassada',
        };
        return map[String(id)] || String(id);
    }

    private static mapEsfera(esferaId: any): string | null {
        if (!esferaId) return null;
        const map: Record<string, string> = {
            '1': 'F', '2': 'E', '3': 'M', '4': 'D',
            'F': 'F', 'E': 'E', 'M': 'M', 'D': 'D',
        };
        return map[String(esferaId)] || String(esferaId);
    }
}
