/**
 * cronogramaEngine.ts — Motor do Cronograma Físico-Financeiro
 * 
 * Distribui o custo dos itens ao longo dos meses de execução da obra.
 * Gera: tabela mensal, acumulado e percentuais por etapa.
 */

export interface CronogramaEtapa {
    id: string;
    nome: string;
    valorTotal: number;
    percentuais: number[]; // % de execução por mês (ex: [50, 30, 20])
}

export interface CronogramaResult {
    meses: number;
    etapas: CronogramaEtapaResult[];
    mensalTotal: number[];     // valor total por mês
    acumulado: number[];       // valor acumulado por mês
    percentMensal: number[];   // % mensal do total global
    percentAcumulado: number[];// % acumulado do total global
    totalGlobal: number;
}

export interface CronogramaEtapaResult extends CronogramaEtapa {
    valoresMensais: number[];  // valor em R$ por mês
}

export function calcularCronograma(etapas: CronogramaEtapa[], meses: number): CronogramaResult {
    const totalGlobal = etapas.reduce((s, e) => s + e.valorTotal, 0);

    const etapasResult: CronogramaEtapaResult[] = etapas.map(etapa => {
        const valoresMensais = Array(meses).fill(0);
        for (let m = 0; m < meses; m++) {
            const pct = (etapa.percentuais[m] || 0) / 100;
            valoresMensais[m] = Math.round(etapa.valorTotal * pct * 100) / 100;
        }
        return { ...etapa, valoresMensais };
    });

    const mensalTotal = Array(meses).fill(0);
    const acumulado = Array(meses).fill(0);
    const percentMensal = Array(meses).fill(0);
    const percentAcumulado = Array(meses).fill(0);

    for (let m = 0; m < meses; m++) {
        mensalTotal[m] = etapasResult.reduce((s, e) => s + e.valoresMensais[m], 0);
        acumulado[m] = (m > 0 ? acumulado[m - 1] : 0) + mensalTotal[m];
        percentMensal[m] = totalGlobal > 0 ? Math.round((mensalTotal[m] / totalGlobal) * 10000) / 100 : 0;
        percentAcumulado[m] = totalGlobal > 0 ? Math.round((acumulado[m] / totalGlobal) * 10000) / 100 : 0;
    }

    return { meses, etapas: etapasResult, mensalTotal, acumulado, percentMensal, percentAcumulado, totalGlobal };
}

/** Gerar etapas padrão a partir dos itens agrupados pelo prefixo do itemNumber */
export function gerarEtapasPadrao(
    items: { itemNumber: string; description: string; totalPrice: number }[]
): CronogramaEtapa[] {
    const grupoMap = new Map<string, { nome: string; total: number }>();

    for (const it of items) {
        const prefix = it.itemNumber.split('.')[0] || '1';
        if (!grupoMap.has(prefix)) {
            grupoMap.set(prefix, { nome: `Etapa ${prefix}`, total: 0 });
        }
        grupoMap.get(prefix)!.total += it.totalPrice;
    }

    return Array.from(grupoMap.entries()).map(([key, g]) => ({
        id: key,
        nome: g.nome,
        valorTotal: g.total,
        percentuais: [], // user fills these
    }));
}
