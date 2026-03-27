/**
 * Normaliza nomes de modalidades licitatárias para formas canônicas (Lei 14.133/2021).
 * Usado em toda a plataforma: tabelas, dashboard, gráficos, cards, oportunidades PNCP.
 */
export function normalizeModality(raw?: string | null): string {
    if (!raw) return 'Não informada';
    const m = raw.toLowerCase().trim();
    if (m.includes('pregão') || m.includes('pregao')) return 'Pregão Eletrônico';
    if (m.includes('concorrência') || m.includes('concorrencia')) return 'Concorrência Eletrônica';
    if (m.includes('diálogo') || m.includes('dialogo')) return 'Diálogo Competitivo';
    if (m.includes('concurso')) return 'Concurso';
    if (m.includes('leilão') || m.includes('leilao')) return 'Leilão';
    if (m.includes('pré-qualificação') || m.includes('pre-qualificacao') || m.includes('pre qualificação')) return 'Procedimento Auxiliar';
    if (m.includes('manifestação de interesse') || m.includes('manifestacao de interesse')) return 'Procedimento Auxiliar';
    if (m.includes('credenciamento')) return 'Credenciamento';
    if (m.includes('dispensa')) return 'Dispensa';
    if (m.includes('inexigibilidade')) return 'Inexigibilidade';
    if (m.includes('licitação eletrônica') || m.includes('licitacao eletronica')) return 'Concorrência Eletrônica';
    // Fallback: capitalize first letter
    return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

/**
 * Normaliza títulos de processos: remove o excesso de caixa alta
 * mantendo números, siglas (2-4 letras maiúsculas) e capitalização natural.
 */
export function normalizeTitle(raw?: string | null): string {
    if (!raw) return '';
    // Verificar se o título contém segmentos significativos em MAIÚSCULAS
    const letters = raw.replace(/[^a-zA-ZÀ-ÿ]/g, '');
    if (letters.length === 0) return raw;
    const upperCount = (raw.match(/[A-ZÀ-ÖØ-Þ]/g) || []).length;
    const ratio = upperCount / letters.length;
    // Detecção: ratio >40% OU 3+ palavras consecutivas em ALL CAPS
    const hasConsecutiveAllCaps = /\b[A-ZÀ-ÖØ-Þ]{2,}\s+[A-ZÀ-ÖØ-Þ]{2,}\s+[A-ZÀ-ÖØ-Þ]{2,}/.test(raw);
    if (ratio < 0.4 && !hasConsecutiveAllCaps) return raw;
    // Converter para Title Case preservando siglas e números
    return raw
        .toLowerCase()
        .replace(/(?:^|\s|[-/])\S/g, (match) => match.toUpperCase())
        // Re-uppercase siglas de estados
        .replace(/\b(ce|sp|rj|mg|ba|pr|rs|sc|go|mt|ms|df|pa|am|pi|ma|se|al|pb|pe|rn|to|ro|rr|ap|ac|es)\b/gi, (s) => s.toUpperCase())
        // Re-uppercase siglas corporativas/documentais
        .replace(/\b(cnpj|cpf|cep|epp|me|ltda|sa|eireli|pncp|sesporte)\b/gi, (s) => s.toUpperCase())
        .replace(/\bnº\b/gi, 'nº')
        .replace(/\bN°\b/gi, 'Nº')
        .replace(/\bn°\b/gi, 'Nº');
}
