import axios from 'axios';
import https from 'https';

async function test() {
    let url = "https://pncp.gov.br/api/search/?tipos_documento=edital&ordenacao=-data&tam_pagina=10&pagina=1&q=obras&status=recebendo_proposta&ufs=CE";
    const agent = new https.Agent({ rejectUnauthorized: false });

    try {
        const response = await axios.get(url, { headers: { 'Accept': 'application/json' }, httpsAgent: agent, timeout: 10000 });
        const data = response.data;

        const items = (data.items || data.data || []).map((item: any) => ({
            id: item.id || item.numeroControlePNCP || Math.random().toString(),
            orgao_nome: item.orgao_nome || item.orgaoEntidade?.razaoSocial || 'Órgão não informado',
            orgao_cnpj: item.orgao_cnpj || item.orgaoEntidade?.cnpj || '',
            ano: item.ano,
            numero_sequencial: item.numero_sequencial,
            titulo: item.title || item.titulo || item.identificador || 'Sem título',
            objeto: item.description || item.objetoCompra || item.objeto || item.resumo || 'Sem objeto',
            data_publicacao: item.createdAt || item.dataPublicacaoPncp || item.data_publicacao || new Date().toISOString(),
            data_abertura: item.data_fim_vigencia || item.data_inicio_vigencia || item.dataAberturaProposta || item.data_abertura || item.dataPublicacaoPncp || new Date().toISOString(),
            valor_estimado: Number(item.valor_estimado ?? item.valor_global ?? item.valorTotalEstimado) || 0,
            uf: item.uf || item.unidadeOrgao?.ufSigla || 'CE' || '--',
            municipio: item.municipio_nome || item.unidadeOrgao?.municipioNome || item.municipio || '--',
            link_sistema: (item.orgao_cnpj && item.ano && item.numero_sequencial)
                ? `https://pncp.gov.br/app/editais/${item.orgao_cnpj}/${item.ano}/${item.numero_sequencial}`
                : (item.linkSistemaOrigem || item.link || ''),
            status: item.situacao_nome || item.situacaoCompraNome || item.status || 'recebendo_proposta' || ''
        }));

        const now = Date.now();
        items.sort((a: any, b: any) => {
            const dateA = new Date(a.data_abertura).getTime();
            const dateB = new Date(b.data_abertura).getTime();
            return Math.abs(dateA - now) - Math.abs(dateB - now);
        });

        const hydratedItems = await Promise.all(items.map(async (item: any) => {
            if (!item.valor_estimado && item.orgao_cnpj && item.ano && item.numero_sequencial) {
                try {
                    const detailUrl = `https://pncp.gov.br/api/pncp/v1/orgaos/${item.orgao_cnpj}/compras/${item.ano}/${item.numero_sequencial}`;
                    const detailRes = await axios.get(detailUrl, { httpsAgent: agent, timeout: 5000 } as any);
                    const detailData: any = detailRes.data;
                    if (detailData && detailData.valorTotalEstimado) {
                        item.valor_estimado = Number(detailData.valorTotalEstimado);
                    }
                } catch (e) {
                }
            }
            return item;
        }));

        console.log("Success! Items:", hydratedItems.length);
    } catch (e: any) {
        console.error("PNCP search error:", e?.message);
    }
}
test();
