/**
 * Templates pré-definidos de Composição de Preços
 * 
 * Cada template fornece uma estrutura base de elementos de custo
 * adequada para o tipo de contratação.
 */

import type { CompositionTemplate, CostCompositionLine } from './types';
import { generateLineId } from './compositionEngine';

export const COMPOSITION_TEMPLATES: CompositionTemplate[] = [
    {
        key: 'FORNECIMENTO',
        label: 'Fornecimento de Bens',
        description: 'Materiais, kits, uniformes, equipamentos, mobiliário, etc.',
        lines: [
            { group: 'MATERIAL',           description: 'Custo de aquisição do produto',       unit: 'UN', quantity: 1, unitValue: 0, source: 'Cotação' },
            { group: 'MATERIAL',           description: 'Embalagem e acondicionamento',        unit: 'UN', quantity: 1, unitValue: 0 },
            { group: 'FRETE',              description: 'Frete de entrega no órgão',            unit: 'VB', quantity: 1, unitValue: 0, source: 'Tabela ANTT' },
            { group: 'MAO_DE_OBRA',        description: 'Mão de obra de preparação',            unit: 'HORA', quantity: 0, unitValue: 0 },
            { group: 'ADMIN_CENTRAL',      description: 'Administração Central',                unit: '%',  quantity: 3, unitValue: 0, notes: '% sobre custo direto' },
            { group: 'CUSTOS_FINANCEIROS', description: 'Custos Financeiros',                   unit: '%',  quantity: 1, unitValue: 0 },
            { group: 'SEGUROS',            description: 'Seguros',                              unit: '%',  quantity: 0.5, unitValue: 0 },
            { group: 'TRIBUTOS',           description: 'PIS (0,65%)',                           unit: 'VB', quantity: 1, unitValue: 0 },
            { group: 'TRIBUTOS',           description: 'COFINS (3,00%)',                        unit: 'VB', quantity: 1, unitValue: 0 },
            { group: 'TRIBUTOS',           description: 'ICMS',                                  unit: 'VB', quantity: 1, unitValue: 0 },
            { group: 'LUCRO',             description: 'Margem de Lucro',                       unit: '%',  quantity: 8, unitValue: 0, notes: '% sobre custo direto' },
        ],
    },
    {
        key: 'SERVICO',
        label: 'Prestação de Serviços',
        description: 'Limpeza, vigilância, TI, consultoria, manutenção, confecção, etc.',
        lines: [
            { group: 'MAO_DE_OBRA',        description: 'Salário base (categoria)',              unit: 'MÊS', quantity: 1, unitValue: 0 },
            { group: 'MAO_DE_OBRA',        description: 'Encargos sociais e trabalhistas',      unit: '%',  quantity: 68, unitValue: 0, notes: '% sobre salário' },
            { group: 'MAO_DE_OBRA',        description: 'Benefícios (VA, VT, plano saúde)',     unit: 'MÊS', quantity: 1, unitValue: 0 },
            { group: 'MATERIAL',           description: 'Material de consumo',                   unit: 'VB', quantity: 1, unitValue: 0 },
            { group: 'EQUIPAMENTO',        description: 'Equipamentos (depreciação/aluguel)',    unit: 'MÊS', quantity: 1, unitValue: 0 },
            { group: 'TERCEIROS',          description: 'Serviços de terceiros',                 unit: 'VB', quantity: 1, unitValue: 0 },
            { group: 'ADMIN_CENTRAL',      description: 'Administração Central',                 unit: '%',  quantity: 5, unitValue: 0 },
            { group: 'CUSTOS_FINANCEIROS', description: 'Custos Financeiros',                    unit: '%',  quantity: 1.2, unitValue: 0 },
            { group: 'RISCOS',             description: 'Riscos e Imprevistos',                  unit: '%',  quantity: 1, unitValue: 0 },
            { group: 'SEGUROS',            description: 'Seguros e Garantias',                   unit: '%',  quantity: 0.8, unitValue: 0 },
            { group: 'TRIBUTOS',           description: 'ISSQN',                                 unit: 'VB', quantity: 1, unitValue: 0 },
            { group: 'TRIBUTOS',           description: 'PIS (0,65%)',                            unit: 'VB', quantity: 1, unitValue: 0 },
            { group: 'TRIBUTOS',           description: 'COFINS (3,00%)',                         unit: 'VB', quantity: 1, unitValue: 0 },
            { group: 'LUCRO',             description: 'Margem de Lucro',                        unit: '%',  quantity: 6.5, unitValue: 0, notes: '% sobre custo direto' },
        ],
    },
    {
        key: 'OBRA',
        label: 'Obras e Engenharia',
        description: 'Construção, reforma, manutenção predial, infraestrutura, etc.',
        lines: [
            { group: 'MATERIAL',           description: 'Materiais de construção',              unit: 'VB', quantity: 1, unitValue: 0, source: 'SINAPI' },
            { group: 'MAO_DE_OBRA',        description: 'Mão de obra + Encargos Sociais',       unit: 'HORA', quantity: 1, unitValue: 0, source: 'SINAPI' },
            { group: 'EQUIPAMENTO',        description: 'Equipamento produtivo',                 unit: 'HORA', quantity: 1, unitValue: 0, source: 'SICRO/SINAPI' },
            { group: 'EQUIPAMENTO',        description: 'Equipamento improdutivo',               unit: 'HORA', quantity: 0, unitValue: 0 },
            { group: 'FRETE',              description: 'Transporte de materiais',               unit: 'VB', quantity: 1, unitValue: 0 },
            { group: 'TERCEIROS',          description: 'Subempreiteiros',                       unit: 'VB', quantity: 1, unitValue: 0 },
            { group: 'DESPESAS_OPERACIONAIS', description: 'Canteiro / Mobilização',             unit: 'VB', quantity: 1, unitValue: 0 },
            { group: 'ADMIN_CENTRAL',      description: 'Administração Central',                 unit: '%',  quantity: 4, unitValue: 0 },
            { group: 'CUSTOS_FINANCEIROS', description: 'Custos Financeiros',                    unit: '%',  quantity: 1.5, unitValue: 0 },
            { group: 'SEGUROS',            description: 'Seguro e Garantia',                     unit: '%',  quantity: 0.8, unitValue: 0 },
            { group: 'RISCOS',             description: 'Riscos e Imprevistos',                  unit: '%',  quantity: 1, unitValue: 0 },
            { group: 'TRIBUTOS',           description: 'PIS (0,65%)',                            unit: 'VB', quantity: 1, unitValue: 0 },
            { group: 'TRIBUTOS',           description: 'COFINS (3,00%)',                         unit: 'VB', quantity: 1, unitValue: 0 },
            { group: 'TRIBUTOS',           description: 'ISSQN',                                  unit: 'VB', quantity: 1, unitValue: 0 },
            { group: 'TRIBUTOS',           description: 'CPRB (contribuição previdenciária)',     unit: 'VB', quantity: 1, unitValue: 0 },
            { group: 'LUCRO',             description: 'Lucro',                                   unit: '%',  quantity: 7.4, unitValue: 0 },
        ],
    },
    {
        key: 'VAZIO',
        label: 'Composição em Branco',
        description: 'Estrutura mínima para montar livremente.',
        lines: [
            { group: 'MATERIAL',           description: '',                                     unit: 'UN', quantity: 1, unitValue: 0 },
            { group: 'MAO_DE_OBRA',        description: '',                                     unit: 'HORA', quantity: 1, unitValue: 0 },
            { group: 'TRIBUTOS',           description: 'Tributos',                              unit: 'VB', quantity: 1, unitValue: 0 },
            { group: 'LUCRO',             description: 'Lucro',                                  unit: '%',  quantity: 0, unitValue: 0 },
        ],
    },
];

/** Aplica um template, gerando IDs para cada linha */
export function applyTemplate(templateKey: string, itemId: string): { itemId: string; lines: CostCompositionLine[]; templateUsed: string } {
    const template = COMPOSITION_TEMPLATES.find(t => t.key === templateKey);
    if (!template) {
        return { itemId, lines: [], templateUsed: 'VAZIO' };
    }
    const lines: CostCompositionLine[] = template.lines.map(l => ({
        ...l,
        id: generateLineId(),
        totalValue: Math.round(l.quantity * l.unitValue * 100) / 100,
    }));
    return { itemId, lines, templateUsed: templateKey };
}
