import type { ProposalItem } from '../../types';

export type RoundingMode = 'ROUND' | 'TRUNCATE';

export function calculateItem(
    item: Partial<ProposalItem>,
    bdiPercentage: number,
    discountPercentage: number = 0,
    roundingMode: RoundingMode = 'ROUND'
) {
    const quantity = item.quantity || 0;
    const unitCost = item.unitCost || 0;
    const multiplier = item.multiplier || 1;
    const itemDisc = item.discountPercentage || 0;

    // Unit Price including BDI, Linear Discount (discountPercentage arg) and then Item Discount
    // Formula: Price = Cost * (1 + BDI/100) * (1 - LinearDisc/100) * (1 - ItemDisc/100)
    const rawUnitPrice = unitCost * (1 + bdiPercentage / 100) * (1 - discountPercentage / 100) * (1 - itemDisc / 100);

    let unitPrice: number;
    if (roundingMode === 'ROUND') {
        unitPrice = Math.round(rawUnitPrice * 100) / 100;
    } else {
        unitPrice = Math.floor(rawUnitPrice * 100) / 100; // Truncate to 2 decimals
    }

    // Total Price based on the calculated unitPrice
    const rawTotalPrice = quantity * multiplier * unitPrice;
    let totalPrice: number;
    if (roundingMode === 'ROUND') {
        totalPrice = Math.round(rawTotalPrice * 100) / 100;
    } else {
        totalPrice = Math.floor(rawTotalPrice * 100) / 100;
    }

    return {
        unitPrice,
        totalPrice
    };
}

export function calculateTotals(items: ProposalItem[]) {
    // With discount applied to unit nodes, the total is just the sum of items
    const total = items.reduce((sum, it) => sum + (it.totalPrice || 0), 0);
    const subtotal = items.reduce((sum, it) => sum + ((it.quantity || 0) * (it.multiplier || 1) * (it.unitCost || 0)), 0);

    return {
        subtotal,
        total
    };
}
