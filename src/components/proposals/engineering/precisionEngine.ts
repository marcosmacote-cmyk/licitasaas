export interface PrecisionConfig {
    tipo: 'ROUND' | 'TRUNCATE';
    casasDecimais: number;
}

export function applyPrecision(value: number, config?: { precision?: PrecisionConfig }): number {
    const tipo = config?.precision?.tipo || 'ROUND';
    const casas = config?.precision?.casasDecimais || 2;
    const factor = Math.pow(10, casas);

    if (tipo === 'TRUNCATE') {
        return Math.trunc(value * factor) / factor;
    }
    return Math.round(value * factor) / factor;
}
