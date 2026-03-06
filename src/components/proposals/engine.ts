import type { ProposalItem } from '../../types';

export function calculateItem(item: Partial<ProposalItem>, bdiPercentage: number) {
    const quantity = item.quantity || 0;
    const unitCost = item.unitCost || 0;
    const multiplier = item.multiplier || 1;

    // Calcula unitPrice incluindo BDI
    const rawUnitPrice = unitCost * (1 + bdiPercentage / 100);
    const unitPrice = Math.round(rawUnitPrice * 100) / 100;

    // Calcula totalPrice
    const rawTotalPrice = quantity * multiplier * unitPrice;
    const totalPrice = Math.round(rawTotalPrice * 100) / 100;

    return {
        unitPrice,
        totalPrice
    };
}

export function calculateTotals(items: ProposalItem[], bdiPercentage: number) {
    const subtotal = items.reduce((sum, it) => sum + ((it.quantity || 0) * (it.multiplier || 1) * (it.unitCost || 0)), 0);
    const bdiValue = subtotal * (bdiPercentage / 100);
    const total = items.reduce((sum, it) => sum + (it.totalPrice || 0), 0);

    return {
        subtotal,
        bdiValue,
        total
    };
}
