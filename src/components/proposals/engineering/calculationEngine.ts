import { applyBdi, resolveEffectiveBdi, type BdiConfig } from './bdiEngine';
import { applyPrecision } from './precisionEngine';
import type { EngItem, EngineeringConfig, PriceAudit } from './types';
import { isGrouper } from './types';

type RefreshPriceAudit = (item: EngItem) => PriceAudit | undefined;

export function resolveItemBdi(item: EngItem, effectiveBdi: number, config: EngineeringConfig): number {
    if (config.bdiDiferenciado && item.bdiCategoria === 'FORNECIMENTO') {
        return config.bdiFornecimento || 14.02;
    }
    return effectiveBdi;
}

export function calculateEngineeringUnitPrice(item: EngItem, effectiveBdi: number, config: EngineeringConfig): number {
    const itemBdi = resolveItemBdi(item, effectiveBdi, config);
    let unitPrice = applyBdi(Number(item.unitCost) || 0, itemBdi, config.precision);
    const discount = Number(item.discount) || 0;

    if (discount > 0) {
        unitPrice = applyPrecision(unitPrice * (1 - discount / 100), config);
    }

    return unitPrice;
}

export function recalculateEngineeringItems(
    items: EngItem[],
    effectiveBdi: number,
    config: EngineeringConfig,
    options: { refreshPriceAudit?: RefreshPriceAudit } = {}
): EngItem[] {
    return items.map(item => {
        if (isGrouper(item.type)) return item;

        const audited = options.refreshPriceAudit
            ? { ...item, priceAudit: options.refreshPriceAudit(item) }
            : item;
        const unitPrice = calculateEngineeringUnitPrice(audited, effectiveBdi, config);

        return {
            ...audited,
            unitPrice,
            totalPrice: applyPrecision((Number(audited.quantity) || 0) * unitPrice, config),
        };
    });
}

export function resolveEffectiveEngineeringBdi(bdiConfig: BdiConfig, config: EngineeringConfig): number {
    return resolveEffectiveBdi(bdiConfig, config.precision);
}

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
