import { describe, expect, test } from 'vitest';
import { resolveMetaCategory } from './insumoEngine';

describe('insumoEngine — Mapeamento de Categorias Expandidas', () => {
    test('Mapeia Mão de Obra para MAO_DE_OBRA', () => {
        expect(resolveMetaCategory('Mão de Obra')).toBe('MAO_DE_OBRA');
        expect(resolveMetaCategory('Mão de obra')).toBe('MAO_DE_OBRA');
        expect(resolveMetaCategory('MAO DE OBRA')).toBe('MAO_DE_OBRA');
        expect(resolveMetaCategory('mao_de_obra')).toBe('MAO_DE_OBRA');
    });

    test('Mapeia Material e Equipamento para Aquisição Permanente para MATERIAL', () => {
        expect(resolveMetaCategory('Material')).toBe('MATERIAL');
        expect(resolveMetaCategory('Equipamento para Aquisição Permanente')).toBe('MATERIAL');
        expect(resolveMetaCategory('Equipamento para Aquisicao Permanente')).toBe('MATERIAL');
    });

    test('Mapeia Equipamento, Aluguel e Transporte para EQUIPAMENTO', () => {
        expect(resolveMetaCategory('Equipamento')).toBe('EQUIPAMENTO');
        expect(resolveMetaCategory('Aluguel')).toBe('EQUIPAMENTO');
        expect(resolveMetaCategory('Transporte')).toBe('EQUIPAMENTO');
    });

    test('Mapeia Serviços, Taxas, Administração, Verba, Consultoria, Encargos Complementares, Franquia e Outros para SERVICO', () => {
        expect(resolveMetaCategory('Serviços')).toBe('SERVICO');
        expect(resolveMetaCategory('Servicos')).toBe('SERVICO');
        expect(resolveMetaCategory('Servico')).toBe('SERVICO');
        expect(resolveMetaCategory('Taxas')).toBe('SERVICO');
        expect(resolveMetaCategory('Administração')).toBe('SERVICO');
        expect(resolveMetaCategory('Administracao')).toBe('SERVICO');
        expect(resolveMetaCategory('Verba')).toBe('SERVICO');
        expect(resolveMetaCategory('Consultoria')).toBe('SERVICO');
        expect(resolveMetaCategory('Encargos Complementares')).toBe('SERVICO');
        expect(resolveMetaCategory('Franquia')).toBe('SERVICO');
        expect(resolveMetaCategory('Outros')).toBe('SERVICO');
    });

    test('Mapeamento fallback para valores legados', () => {
        expect(resolveMetaCategory('Qualquer Mão')).toBe('MAO_DE_OBRA');
        expect(resolveMetaCategory('Equipamento Novo')).toBe('EQUIPAMENTO');
        expect(resolveMetaCategory('Material de Construção')).toBe('MATERIAL');
        expect(resolveMetaCategory('Algum tipo desconhecido')).toBe('SERVICO');
    });
});
