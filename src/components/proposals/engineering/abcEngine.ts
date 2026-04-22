/**
 * abcEngine.ts — Motor de Curva ABC (Princípio de Pareto)
 * 
 * Classifica itens de engenharia por impacto financeiro:
 *  - Classe A: itens que representam ~80% do custo total (poucos e caros)
 *  - Classe B: itens que representam ~15% do custo total (intermediários)
 *  - Classe C: itens que representam ~5% do custo total (muitos e baratos)
 */

export interface AbcItem {
    itemNumber: string;
    code: string;
    description: string;
    unit: string;
    quantity: number;
    unitPrice: number;
    totalPrice: number;
    // ABC calculated fields
    rank: number;
    percentOfTotal: number;
    cumulativePercent: number;
    classification: 'A' | 'B' | 'C';
}

export interface AbcSummary {
    items: AbcItem[];
    totalGlobal: number;
    classA: { count: number; total: number; percent: number };
    classB: { count: number; total: number; percent: number };
    classC: { count: number; total: number; percent: number };
}

export function calculateCurvaAbc(
    items: { itemNumber: string; code: string; description: string; unit: string; quantity: number; unitPrice: number; totalPrice: number }[],
    thresholdA: number = 80,
    thresholdB: number = 95
): AbcSummary {
    const totalGlobal = items.reduce((s, it) => s + it.totalPrice, 0);
    if (totalGlobal === 0) {
        return { items: [], totalGlobal: 0, classA: { count: 0, total: 0, percent: 0 }, classB: { count: 0, total: 0, percent: 0 }, classC: { count: 0, total: 0, percent: 0 } };
    }

    // Sort by totalPrice descending
    const sorted = [...items]
        .filter(it => it.totalPrice > 0)
        .sort((a, b) => b.totalPrice - a.totalPrice);

    let cumulative = 0;
    const classified: AbcItem[] = sorted.map((it, idx) => {
        const pct = (it.totalPrice / totalGlobal) * 100;
        cumulative += pct;
        let classification: 'A' | 'B' | 'C' = 'C';
        if (cumulative <= thresholdA) classification = 'A';
        else if (cumulative <= thresholdB) classification = 'B';

        return {
            ...it,
            rank: idx + 1,
            percentOfTotal: Math.round(pct * 100) / 100,
            cumulativePercent: Math.round(cumulative * 100) / 100,
            classification,
        };
    });

    const classA = classified.filter(i => i.classification === 'A');
    const classB = classified.filter(i => i.classification === 'B');
    const classC = classified.filter(i => i.classification === 'C');

    return {
        items: classified,
        totalGlobal,
        classA: { count: classA.length, total: classA.reduce((s, i) => s + i.totalPrice, 0), percent: classA.length > 0 ? classA[classA.length - 1].cumulativePercent : 0 },
        classB: { count: classB.length, total: classB.reduce((s, i) => s + i.totalPrice, 0), percent: (classB.length > 0 ? classB[classB.length - 1].cumulativePercent : classA.length > 0 ? classA[classA.length - 1].cumulativePercent : 0) - (classA.length > 0 ? classA[classA.length - 1].cumulativePercent : 0) },
        classC: { count: classC.length, total: classC.reduce((s, i) => s + i.totalPrice, 0), percent: 100 - (classB.length > 0 ? classB[classB.length - 1].cumulativePercent : classA.length > 0 ? classA[classA.length - 1].cumulativePercent : 0) },
    };
}
