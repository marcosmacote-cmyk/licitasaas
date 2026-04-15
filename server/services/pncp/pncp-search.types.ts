export interface PncpSearchInput {
    keywords?: string;
    status?: string;
    uf?: string;
    modalidade?: string;
    esfera?: string;
    orgao?: string;
    orgaosLista?: string;
    excludeKeywords?: string;
    dataInicio?: string;
    dataFim?: string;
    valorMin?: number;
    valorMax?: number;
    pagina?: number;
    tamanhoPagina?: number;
}

export interface PncpSearchMeta {
    source: 'local' | 'govbr' | 'hybrid';
    fallbackUsed: boolean;
    isPartial: boolean;
    localCount?: number;
    remoteCount?: number;
    elapsedMs?: number;
    errors: string[];
}

export interface PncpSearchResponse {
    items: any[];
    total: number;
    meta: PncpSearchMeta;
}
