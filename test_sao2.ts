import axios from 'axios';
import https from 'https';

async function testFilter() {
    const orgao_cnpj = "08079402000135";
    const ano = "2026";
    const numero_sequencial = "23";
    
    const arquivosUrl = `https://pncp.gov.br/api/pncp/v1/orgaos/${orgao_cnpj}/compras/${ano}/${numero_sequencial}/arquivos`;
    const agent = new https.Agent({ rejectUnauthorized: false });
    
    const arquivosRes = await axios.get(arquivosUrl, { httpsAgent: agent, timeout: 25000 });
    const arquivos = Array.isArray(arquivosRes.data) ? arquivosRes.data : [];
    console.log("Total files found:", arquivos.length);

    const discardedFiles: string[] = [];
    
    const EXCLUDE_PATTERNS = [
        'modelo_proposta', 'modelo_de_proposta', 'modelo proposta',
        'modelo_recibo', 'modelo recibo', 'modelo_declarac', 'modelo declarac',
        'modelo_ata', 'modelo ata', 'modelo_contrato', 'modelo_carta',
        'carta_fian', 'carta fian',
        'aviso_publicac', 'aviso publicac', 'aviso_licitac',
        'aviso_de_licit', 'aviso de licit', 'aviso_licit',
        'aviso_de_publicac', 'aviso de publicac',
        'quadro_de_aviso', 'quadro de aviso',
        'd.o.u', 'diario_oficial', 'diario oficial',
        'retificac', 'errata', 'ata_sessao', 'ata_da_sessao',
        'comprovante', 'recibo_garantia', 'modelo_recibo_garantia',
        'minuta_contrato', 'minuta contrato', 'minuta_de_contrato',
        'projeto_arq', 'projeto arq', 'planta_', 'planta ',
        'memorial_descritivo', 'memorial descritivo',
        'croqui', 'layout_', 'layout ',
        'detalhamento_', 'det_arq', 'det arq',
        'pecas_graficas', 'pecas graficas', 'peas_grficas', 'peas_graficas',
        'desenho_tecnico', 'desenho tecnico', 'peca_grafica',
    ];

    const ESSENTIAL_KEYWORDS = [
        'edital', 'termo_referencia', 'termo de referencia', 'tr_',
        'projeto_basico', 'projeto basico', 'planilha', 'orcamento',
        'cronograma', 'bdi', 'etp', 'estudo_tecnico',
    ];

    const filteredArquivos = arquivos.filter((arq: any) => {
        const name = (arq.titulo || arq.nomeArquivo || arq.nome || '').toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        const tipoDesc = (arq.tipoDocumentoDescricao || '').toLowerCase();
        const tipoId = arq.tipoDocumentoId;

        const isExcludedByPattern = EXCLUDE_PATTERNS.some(pat => name.includes(pat));
        if (isExcludedByPattern) {
            console.log(`🚫 Excluído (pattern): "${arq.titulo}" (tipo: ${tipoDesc})`);
            discardedFiles.push(`${arq.titulo} (excluído: template/padrão)`);
            return false;
        }

        const isOutros = tipoDesc.includes('outros') || (tipoId !== 2 && tipoId !== 4);
        const hasEssentialKeyword = ESSENTIAL_KEYWORDS.some(kw => name.includes(kw));
        const isGenericAnexo = /^anexo[_\s]+(i|ii|iii|iv|v|vi|vii|viii|ix|x|[0-9])/.test(name);

        if (isOutros && isGenericAnexo && !hasEssentialKeyword) {
            console.log(`🚫 Excluído (anexo genérico): "${arq.titulo}"`);
            discardedFiles.push(`${arq.titulo} (excluído: anexo genérico)`);
            return false;
        }

        console.log(`✅ Aprovado: "${arq.titulo}" (tipo: ${tipoDesc})`);
        return true;
    });

    console.log(`\nFiltered files: ${filteredArquivos.length}`);
}
testFilter();
