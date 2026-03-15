"use strict";
/**
 * ══════════════════════════════════════════════════════════════════
 *  Taxonomia Licitatória Mestra — LicitaSaaS
 * ══════════════════════════════════════════════════════════════════
 *
 *  Camada central de classificação semântica para uniformização
 *  de prompts, validações, risco e integração interna.
 *
 *  Usado por:
 *    - Prompts V2 (extração, normalização, risk review)
 *    - validateAnalysisCompleteness
 *    - riskRulesEngine
 *    - analysisQualityEvaluator
 *    - buildSchemaV2Context
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.OBJECT_TYPE_PROFILES = exports.CRITICAL_DISTINCTIONS = exports.REQUIREMENT_CATEGORIES = void 0;
exports.generateTaxonomyPromptBlock = generateTaxonomyPromptBlock;
exports.generateObjectTypeReinforcement = generateObjectTypeReinforcement;
// ── Categorias ──
exports.REQUIREMENT_CATEGORIES = [
    {
        key: 'habilitacao_juridica',
        label: 'Habilitação Jurídica',
        definition: 'Documentos que comprovam a existência legal e capacidade jurídica para contratar com a Administração (Art. 66 da Lei 14.133/2021).',
        synonyms: ['habilitação jurídica', 'documentação jurídica', 'capacidade jurídica', 'personalidade jurídica'],
        textPatterns: [
            'contrato social', 'ato constitutivo', 'estatuto', 'inscrição no cnpj',
            'cédula de identidade', 'registro na junta comercial', 'requerimento de empresário',
            'decreto de autorização', 'registro no órgão competente', 'alteração contratual',
            'cláusula de administração', 'objeto social compatível'
        ],
        examples: [
            'Ato constitutivo, estatuto ou contrato social em vigor, registrado na Junta Comercial',
            'Comprovante de inscrição no Cadastro Nacional da Pessoa Jurídica (CNPJ)',
            'Decreto de autorização para funcionamento no país (empresa estrangeira)',
            'Documento de identidade do representante legal'
        ],
        exclusions: ['certidões negativas', 'balanço patrimonial', 'atestados técnicos'],
        riskIfMissing: 'inabilitação',
        responsibleArea: 'juridico',
        idPrefix: 'HJ'
    },
    {
        key: 'regularidade_fiscal_trabalhista',
        label: 'Regularidade Fiscal, Social e Trabalhista',
        definition: 'Certidões que comprovam adimplência fiscal, tributária e trabalhista perante esferas federal, estadual e municipal (Art. 68 da Lei 14.133/2021).',
        synonyms: ['regularidade fiscal', 'certidões negativas', 'regularidade tributária', 'quitação fiscal', 'regularidade trabalhista'],
        textPatterns: [
            'certidão negativa', 'cnd', 'certidão conjunta', 'fazenda federal',
            'fazenda estadual', 'fazenda municipal', 'tributos federais',
            'dívida ativa', 'fgts', 'crf', 'cndt', 'débitos trabalhistas',
            'regularidade perante', 'prova de regularidade', 'certidão de débitos',
            'inss', 'previdenciária', 'seguridade social'
        ],
        examples: [
            'Certidão Conjunta de Débitos relativos a Tributos Federais e à Dívida Ativa da União',
            'Certidão Negativa de Débitos Estaduais (Fazenda Estadual / SEFAZ)',
            'Certidão Negativa de Débitos Municipais / ISS',
            'Certificado de Regularidade do FGTS (CRF)',
            'Certidão Negativa de Débitos Trabalhistas (CNDT)',
            'Certidão de regularidade perante a Previdência Social (INSS)'
        ],
        exclusions: ['contrato social', 'balanço', 'atestado técnico', 'inscrição no cnpj'],
        riskIfMissing: 'inabilitação',
        responsibleArea: 'contabil',
        idPrefix: 'RFT'
    },
    {
        key: 'qualificacao_economico_financeira',
        label: 'Qualificação Econômico-Financeira',
        definition: 'Demonstrações contábeis e índices que comprovam solidez financeira do licitante (Art. 69 da Lei 14.133/2021).',
        synonyms: ['qualificação econômico-financeira', 'capacidade financeira', 'solidez financeira', 'saúde financeira'],
        textPatterns: [
            'balanço patrimonial', 'demonstrações contábeis', 'índice de liquidez',
            'liquidez geral', 'liquidez corrente', 'solvência geral', 'patrimônio líquido',
            'capital social mínimo', 'certidão de falência', 'recuperação judicial',
            'lg', 'lc', 'sg', 'patrimônio líquido mínimo', 'capital mínimo',
            'demonstrações financeiras', 'receita bruta'
        ],
        examples: [
            'Balanço Patrimonial do último exercício social, devidamente registrado',
            'Índice de Liquidez Geral (LG) >= 1,0',
            'Índice de Liquidez Corrente (LC) >= 1,0',
            'Índice de Solvência Geral (SG) >= 1,0',
            'Patrimônio Líquido mínimo de R$ 500.000,00 ou 10% do valor estimado',
            'Capital Social mínimo de R$ 200.000,00',
            'Certidão negativa de falência e recuperação judicial'
        ],
        exclusions: ['certidão negativa de débitos', 'atestado técnico', 'contrato social'],
        riskIfMissing: 'inabilitação',
        responsibleArea: 'contabil',
        idPrefix: 'QEF'
    },
    {
        key: 'qualificacao_tecnica_operacional',
        label: 'Qualificação Técnica Operacional',
        definition: 'Atestados e comprovações de que a EMPRESA já executou serviços/obras de natureza compatível (Art. 67, II da Lei 14.133/2021). Refere-se à capacidade da pessoa jurídica.',
        synonyms: ['capacidade técnica operacional', 'técnica operacional', 'atestado de capacidade técnica da empresa', 'experiência da empresa'],
        textPatterns: [
            'atestado de capacidade técnica', 'comprovação de aptidão', 'execução de serviço',
            'compatível em características', 'parcela de maior relevância',
            'quantitativo mínimo', 'percentual mínimo', 'fornecido por pessoa jurídica',
            'experiência anterior', 'prestação de serviços similares',
            'registro no crea.*empresa', 'vistoria técnica'
        ],
        examples: [
            'Atestado(s) de Capacidade Técnica comprovando aptidão para execução de serviço compatível com pavimentação asfáltica em área mínima de 5.000m²',
            'Comprovação de execução de serviços de mesma natureza e porte, equivalente a 50% do objeto licitado',
            'Atestado em nome da empresa, emitido por pessoa jurídica de direito público ou privado',
            'Atestado comprovando a execução de serviços de coleta e transporte de resíduos sólidos'
        ],
        exclusions: ['CAT em nome do profissional', 'ART de profissional', 'registro individual no CREA'],
        riskIfMissing: 'inabilitação',
        responsibleArea: 'engenharia',
        idPrefix: 'QTO'
    },
    {
        key: 'qualificacao_tecnica_profissional',
        label: 'Qualificação Técnica Profissional',
        definition: 'Comprovações de que o PROFISSIONAL vinculado à empresa possui experiência e registro em conselho (Art. 67, I da Lei 14.133/2021). Refere-se à capacidade da pessoa física (RT, engenheiro, etc.).',
        synonyms: ['técnica profissional', 'capacidade técnica profissional', 'acervo técnico do profissional', 'responsável técnico'],
        textPatterns: [
            'cat', 'certidão de acervo técnico', 'art', 'anotação de responsabilidade',
            'rrt', 'registro de responsabilidade técnica', 'responsável técnico',
            'profissional de nível superior', 'registro no crea', 'registro no cau',
            'vínculo com a empresa', 'acervo profissional', 'profissional habilitado',
            'coordenador de equipe', 'gerente de obras'
        ],
        examples: [
            'Certidão de Acervo Técnico (CAT) emitida pelo CREA, comprovando execução de obra de pavimentação asfáltica',
            'Comprovação de vínculo (CLT, contrato, sócio) do responsável técnico com a empresa',
            'Profissional engenheiro civil, com registro ativo no CREA, detentor de acervo compatível',
            'ART (Anotação de Responsabilidade Técnica) referente a serviços de mesma natureza'
        ],
        exclusions: ['atestado da empresa', 'CNPJ', 'balanço patrimonial'],
        riskIfMissing: 'inabilitação',
        responsibleArea: 'engenharia',
        idPrefix: 'QTP'
    },
    {
        key: 'proposta_comercial',
        label: 'Proposta Comercial',
        definition: 'Requisitos formais e materiais que a proposta de preços deve cumprir para ser classificada. Inclui planilha, carta proposta, composições, BDI e critérios de julgamento.',
        synonyms: ['proposta de preços', 'proposta comercial', 'envelope de preços', 'oferta de preços'],
        textPatterns: [
            'proposta de preço', 'planilha orçamentária', 'carta proposta',
            'composição de bdi', 'cronograma físico-financeiro', 'marca e modelo',
            'catálogo', 'ficha técnica', 'manual do fabricante',
            'declaração do fabricante', 'critério de julgamento', 'menor preço',
            'técnica e preço', 'maior desconto', 'exequibilidade'
        ],
        examples: [
            'Proposta em papel timbrado com indicação de marca e modelo',
            'Planilha de composição de custos e formação de preços',
            'Composição analítica do BDI',
            'Cronograma físico-financeiro com desembolso mensal',
            'Catálogo ou ficha técnica demonstrando conformidade'
        ],
        exclusions: ['habilitação jurídica', 'certidão negativa', 'atestado técnico'],
        riskIfMissing: 'desclassificação',
        responsibleArea: 'comercial',
        idPrefix: 'PC'
    },
    {
        key: 'execucao_contratual',
        label: 'Execução Contratual',
        definition: 'Cláusulas, obrigações, penalidades, prazos e condições que regem a execução do contrato após a adjudicação.',
        synonyms: ['cláusulas contratuais', 'condições contratuais', 'obrigações da contratada', 'minuta contratual'],
        textPatterns: [
            'prazo de execução', 'prazo de vigência', 'reajuste', 'repactuação',
            'medição', 'pagamento', 'multa', 'penalidade', 'advertência',
            'suspensão', 'impedimento', 'obrigação da contratada',
            'obrigação da contratante', 'matriz de risco', 'garantia contratual',
            'subcontratação', 'fiscalização'
        ],
        examples: [
            'Prazo de execução: 12 meses a partir da Ordem de Serviço',
            'Multa de 0,5% por dia de atraso sobre o valor mensal',
            'Garantia contratual de 5% do valor do contrato',
            'Reajuste pelo IPCA após 12 meses'
        ],
        exclusions: ['documentos de habilitação', 'proposta de preços'],
        riskIfMissing: 'risco_contratual',
        responsibleArea: 'juridico',
        idPrefix: 'EC'
    },
    {
        key: 'documentos_complementares',
        label: 'Documentos Complementares',
        definition: 'Declarações, procurações e outros documentos acessórios exigidos pelo edital, que não se enquadram diretamente nas categorias acima.',
        synonyms: ['documentos extras', 'declarações obrigatórias', 'documentação complementar'],
        textPatterns: [
            'declaração', 'procuração', 'credenciamento', 'termo de ciência',
            'declaração de inexistência de fato superveniente', 'declaração de idoneidade',
            'declaração de trabalho infantil', 'declaração de vistoria',
            'declaração de elaboração independente', 'microempresa',
            'declaração me/epp'
        ],
        examples: [
            'Declaração de inexistência de fato impeditivo à habilitação',
            'Declaração de não emprego de menores (Art. 7º, XXXIII, CF)',
            'Declaração de enquadramento como ME/EPP',
            'Procuração do representante legal com poderes específicos'
        ],
        exclusions: ['balanço', 'certidão negativa', 'atestado de capacidade técnica'],
        riskIfMissing: 'inabilitação',
        responsibleArea: 'licitacoes',
        idPrefix: 'DC'
    }
];
// ── Distinções Críticas ──
// Pares de categorias frequentemente confundidas, com regras de desambiguação
exports.CRITICAL_DISTINCTIONS = [
    {
        pair: ['qualificacao_tecnica_operacional', 'qualificacao_tecnica_profissional'],
        rule: 'OPERACIONAL = experiência da EMPRESA (PJ). PROFISSIONAL = experiência do PROFISSIONAL (PF). Se o edital pede atestado "em nome da empresa", é operacional. Se pede CAT/ART/acervo "do profissional" ou "do RT", é profissional.',
        indicators: {
            first: ['atestado da empresa', 'em nome da licitante', 'pessoa jurídica', 'aptidão da empresa'],
            second: ['CAT', 'acervo do profissional', 'RT', 'responsável técnico', 'ART', 'RRT', 'profissional de nível superior', 'vínculo do profissional']
        }
    },
    {
        pair: ['qualificacao_economico_financeira', 'regularidade_fiscal_trabalhista'],
        rule: 'ECO-FIN = solidez financeira (balanço, índices, patrimônio). FISCAL = adimplência tributária (certidões negativas de débitos). Certidão de falência é ECO-FIN.',
        indicators: {
            first: ['balanço', 'LG', 'LC', 'SG', 'patrimônio líquido', 'capital social', 'falência', 'recuperação judicial'],
            second: ['certidão negativa de débitos', 'CND', 'FGTS', 'CRF', 'CNDT', 'tributos', 'fazenda']
        }
    },
    {
        pair: ['proposta_comercial', 'execucao_contratual'],
        rule: 'PROPOSTA = o que deve constar na proposta para ser CLASSIFICADA. CONTRATUAL = o que rege a EXECUÇÃO após contratação. Se é exigência para participar/propor, é proposta. Se é obrigação pós-contrato, é contratual.',
        indicators: {
            first: ['proposta de preços', 'planilha', 'BDI', 'marca e modelo', 'catálogo', 'critério de julgamento'],
            second: ['multa', 'penalidade', 'prazo de execução', 'vigência', 'reajuste', 'obrigação da contratada']
        }
    },
    {
        pair: ['qualificacao_tecnica_operacional', 'proposta_comercial'],
        rule: 'TÉCNICA = comprova que a empresa SABE fazer. PROPOSTA = documenta o que a empresa OFERECE fazer. Atestado é técnica. Planilha/BDI é proposta.',
        indicators: {
            first: ['atestado', 'capacidade técnica', 'experiência anterior', 'serviço compatível'],
            second: ['planilha', 'preço', 'composição', 'BDI', 'carta proposta']
        }
    },
    {
        pair: ['habilitacao_juridica', 'documentos_complementares'],
        rule: 'JURÍDICA = documentos de existência legal (CNPJ, Contrato Social). COMPLEMENTAR = declarações, procurações, termos. Se comprova existência/capacidade jurídica, é HJ. Se é declaração avulsa exigida pelo edital, é DC.',
        indicators: {
            first: ['contrato social', 'CNPJ', 'ato constitutivo', 'estatuto', 'junta comercial'],
            second: ['declaração', 'procuração', 'termo de ciência', 'credenciamento']
        }
    }
];
exports.OBJECT_TYPE_PROFILES = [
    {
        key: 'obra_engenharia',
        label: 'Obra / Engenharia',
        reinforcementAreas: [
            'parcelas de maior relevância com quantitativos mínimos',
            'atestados de capacidade técnica operacional E profissional',
            'CAT, ART, RRT',
            'responsável técnico com vínculo e registro em conselho (CREA/CAU/CONFEA)',
            'planilha orçamentária com composição de BDI',
            'cronograma físico-financeiro',
            'projeto básico ou executivo',
            'licenças ambientais'
        ],
        criticalCategories: ['qualificacao_tecnica_operacional', 'qualificacao_tecnica_profissional', 'proposta_comercial'],
        typicalRisks: [
            'parcela relevante com quantitativo mínimo excessivo',
            'exigência de CAT em especialidade muito restritiva',
            'BDI imposto sem justificativa técnica',
            'ausência de projeto básico'
        ]
    },
    {
        key: 'servico_comum_engenharia',
        label: 'Serviço Comum de Engenharia',
        reinforcementAreas: [
            'qualificação técnica (operacional e profissional)',
            'atestados com quantitativos',
            'responsável técnico',
            'visita técnica',
            'condições de execução',
            'obrigações contratuais específicas do serviço'
        ],
        criticalCategories: ['qualificacao_tecnica_operacional', 'qualificacao_tecnica_profissional', 'execucao_contratual'],
        typicalRisks: [
            'classificação incorreta: serviço comum vs. serviço de engenharia',
            'ausência de justificativa para exigência de visita técnica',
            'quantitativo mínimo de atestado desproporcional ao objeto'
        ]
    },
    {
        key: 'fornecimento',
        label: 'Fornecimento',
        reinforcementAreas: [
            'especificações técnicas detalhadas',
            'marca, modelo, referência',
            'catálogo, ficha técnica, manual do fabricante',
            'amostra e critérios de aceitação',
            'certificações e registros (ANVISA, INMETRO, etc.)',
            'prazo e local de entrega',
            'declaração do fabricante ou distribuidor'
        ],
        criticalCategories: ['proposta_comercial', 'documentos_complementares'],
        typicalRisks: [
            'direcionamento por marca sem "ou similar/equivalente"',
            'exigência de certificação desnecessária',
            'prazo de entrega inexequível',
            'amostra sem critérios objetivos de aceitação'
        ]
    },
    {
        key: 'servico_comum',
        label: 'Serviço Comum',
        reinforcementAreas: [
            'qualificação técnica operacional',
            'regularidade trabalhista (CNDT, FGTS)',
            'obrigações contratuais',
            'execução continuada',
            'repactuação e reajuste',
            'encargos sociais e trabalhistas',
            'fiscalização e gestão contratual'
        ],
        criticalCategories: ['qualificacao_tecnica_operacional', 'regularidade_fiscal_trabalhista', 'execucao_contratual'],
        typicalRisks: [
            'exigência técnica desproporcional para serviço simples',
            'ausência de cláusula de repactuação em serviço continuado',
            'prazos de pagamento incompatíveis com o fluxo de caixa'
        ]
    },
    {
        key: 'locacao',
        label: 'Locação',
        reinforcementAreas: [
            'especificações dos equipamentos',
            'condições de manutenção e substituição',
            'prazo de vigência',
            'reajuste e repactuação',
            'obrigações de manutenção preditiva e corretiva'
        ],
        criticalCategories: ['proposta_comercial', 'execucao_contratual'],
        typicalRisks: [
            'exigência de marca específica sem justificativa',
            'prazo de substituição de equipamento inexequível',
            'cláusula de descarte sem previsão de custo'
        ]
    },
    {
        key: 'outro',
        label: 'Outro',
        reinforcementAreas: ['análise geral de todas as seções'],
        criticalCategories: ['habilitacao_juridica', 'regularidade_fiscal_trabalhista'],
        typicalRisks: ['classificação incorreta do tipo de objeto']
    }
];
// ── Gerador de texto para prompts ──
/**
 * Gera bloco de texto da taxonomia para injetar nos prompts V2.
 * Inclui categorias com exemplos e distinções críticas.
 */
function generateTaxonomyPromptBlock() {
    let text = '═══ TAXONOMIA LICITATÓRIA DE REFERÊNCIA ═══\n\n';
    text += 'Use esta taxonomia para classificar CORRETAMENTE cada exigência:\n\n';
    for (const cat of exports.REQUIREMENT_CATEGORIES) {
        text += `▸ ${cat.label} (${cat.idPrefix}-XX)\n`;
        text += `  Definição: ${cat.definition}\n`;
        text += `  Exemplos: ${cat.examples.slice(0, 3).join('; ')}.\n`;
        text += `  NÃO inclui: ${cat.exclusions.join(', ')}.\n`;
        text += `  Risco se ausente: ${cat.riskIfMissing}\n\n`;
    }
    text += '═══ DISTINÇÕES CRÍTICAS (NUNCA CONFUNDIR) ═══\n\n';
    for (const d of exports.CRITICAL_DISTINCTIONS) {
        text += `⚠️ ${d.pair[0]} vs ${d.pair[1]}:\n`;
        text += `  REGRA: ${d.rule}\n`;
        text += `  Indicadores de ${d.pair[0]}: ${d.indicators.first.join(', ')}\n`;
        text += `  Indicadores de ${d.pair[1]}: ${d.indicators.second.join(', ')}\n\n`;
    }
    return text;
}
/**
 * Gera bloco de reforço por tipo de objeto para injetar no prompt.
 */
function generateObjectTypeReinforcement(objectType) {
    const profile = exports.OBJECT_TYPE_PROFILES.find(p => p.key === objectType);
    if (!profile)
        return '';
    let text = `═══ REFORÇO POR TIPO DE OBJETO: ${profile.label.toUpperCase()} ═══\n\n`;
    text += `Este edital trata de ${profile.label}. Dê ATENÇÃO REFORÇADA a:\n`;
    for (const area of profile.reinforcementAreas) {
        text += `  ✦ ${area}\n`;
    }
    text += `\nRiscos típicos deste tipo de objeto:\n`;
    for (const risk of profile.typicalRisks) {
        text += `  ⚠️ ${risk}\n`;
    }
    return text;
}
