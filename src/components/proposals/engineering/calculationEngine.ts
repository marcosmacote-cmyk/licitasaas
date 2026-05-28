/**
 * calculationEngine.ts — Motor ÚNICO de cálculo de itens de engenharia.
 *
 * FIX F1: Substitui os recalcAll duplicados do Wizard (sem desconto)
 * e do Editor (com desconto). Agora ambos chamam esta função pura.
 *
 * Centraliza:
 *  - recalcAllItems: recálculo completo de preços
 *  - resolveItemBdi: BDI diferenciado (OBRA vs FORNECIMENTO)
 *  - ensureClientIds: IDs estáveis para persistência incremental (Q1)
 *
 * REGRA: Nenhum componente deve possuir fórmula própria de preço.
 *        Todo cálculo de unitPrice/totalPrice DEVE passar por aqui.
 */
import { applyBdi, resolveEffectiveBdi, type BdiConfig } from './bdiEngine';
import { applyPrecision } from './precisionEngine';
import type { EngItem, EngineeringConfig, PriceAudit } from './types';
import { isGrouper } from './types';

// ═══════════════════════════════════════════════
// CORE — Funções primárias
// ═══════════════════════════════════════════════

/**
 * Resolve o BDI efetivo para um item individual.
 * Suporte a BDI diferenciado: OBRA (padrão) vs FORNECIMENTO.
 */
export function resolveItemBdi(
    item: EngItem,
    globalBdi: number,
    config: EngineeringConfig,
): number {
    if (config.bdiDiferenciado && item.bdiCategoria === 'FORNECIMENTO') {
        return config.bdiFornecimento || 14.02;
    }
    return globalBdi;
}

/**
 * Calcula unitPrice de um único item (BDI + desconto + precisão).
 */
export function calculateEngineeringUnitPrice(item: EngItem, effectiveBdi: number, config: EngineeringConfig): number {
    const itemBdi = resolveItemBdi(item, effectiveBdi, config);
    let unitPrice = applyBdi(Number(item.unitCost) || 0, itemBdi, config.precision);
    const discount = Number(item.discount) || 0;

    if (discount > 0) {
        unitPrice = applyPrecision(unitPrice * (1 - discount / 100), config);
    }

    return unitPrice;
}

type RefreshPriceAudit = (item: EngItem) => PriceAudit | undefined;

/**
 * Recalcula unitPrice e totalPrice de todos os itens.
 * Aplica: BDI (diferenciado ou global), desconto individual, precisão.
 *
 * Esta é a ÚNICA função de recálculo do módulo.
 * Nem o Wizard nem o Editor devem ter lógica própria de preço.
 *
 * @param items - Lista de itens a recalcular
 * @param effectiveBdi - BDI global efetivo (já resolvido via resolveEffectiveBdi)
 * @param config - Configuração de engenharia (precisão, BDI diferenciado, etc.)
 * @param options.refreshAudit - Função opcional para atualizar priceAudit (só Editor usa)
 * @param options.refreshPriceAudit - Alias de refreshAudit (compatibilidade)
 */
export function recalcAllItems(
    items: EngItem[],
    effectiveBdi: number,
    config: EngineeringConfig,
    options?: { refreshAudit?: (item: EngItem) => EngItem; refreshPriceAudit?: RefreshPriceAudit }
): EngItem[] {
    return items.map(it => {
        if (isGrouper(it.type)) return it;

        // Opcional: refresh de auditoria (duas APIs para compatibilidade)
        let audited = it;
        if (options?.refreshAudit) {
            audited = options.refreshAudit(it);
        } else if (options?.refreshPriceAudit) {
            audited = { ...it, priceAudit: options.refreshPriceAudit(it) };
        }

        const unitPrice = calculateEngineeringUnitPrice(audited, effectiveBdi, config);

        return {
            ...audited,
            unitPrice,
            totalPrice: applyPrecision((Number(audited.quantity) || 0) * unitPrice, config),
        };
    });
}

// ═══════════════════════════════════════════════
// ALIASES — Compatibilidade com nomes do Codex
// ═══════════════════════════════════════════════

/** Alias de recalcAllItems para compatibilidade */
export const recalculateEngineeringItems = recalcAllItems;

/**
 * Resolve o BDI efetivo de um BdiConfig para uso no módulo de engenharia.
 * Wrapper que une BdiConfig + EngineeringConfig.precision.
 */
export function resolveEffectiveEngineeringBdi(bdiConfig: BdiConfig, config: EngineeringConfig): number {
    return resolveEffectiveBdi(bdiConfig, config.precision);
}

// ═══════════════════════════════════════════════
// UTILITÁRIOS
// ═══════════════════════════════════════════════

/**
 * Gera hash determinístico dos itens para invalidação de cache (insumos, etc).
 * Mudanças em code, quantity, unitCost, sourceName ou insumos invalidam o hash.
 */
export function buildInsumosItemsHash(items: EngItem[]): string {
    return items
        .filter(item => !isGrouper(item.type))
        .map(item => [
            item.id,
            item.code || '',
            item.sourceName || '',
            Number(item.quantity) || 0,
            Number(item.unitCost) || 0,
            Number(item.unitPrice) || 0,
            Number(item.totalPrice) || 0,
            item.insumos?.length || 0,
        ].join(':'))
        .join('|');
}

/**
 * Q1/F5: Garante que todos os itens tenham clientId estável.
 * Aplicar na fronteira de save (antes de enviar ao backend).
 * Itens que já possuem clientId mantêm o valor existente.
 * Itens sem clientId (legado ou novos) recebem um UUID.
 */
export function ensureClientIds(items: EngItem[]): EngItem[] {
    let changed = false;
    const result = items.map(it => {
        if (it.clientId) return it;
        changed = true;
        return { ...it, clientId: crypto.randomUUID() };
    });
    return changed ? result : items;
}
