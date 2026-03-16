/**
 * ══════════════════════════════════════════════════════════════
 * Converte número para valor por extenso em Português Brasileiro
 * Suporta valores até R$ 999.999.999.999,99
 * ══════════════════════════════════════════════════════════════
 */

const UNITS = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove'];
const TEENS = ['dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const TENS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const HUNDREDS = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

function groupToWords(n: number): string {
    if (n === 0) return '';
    if (n === 100) return 'cem';

    const parts: string[] = [];
    const h = Math.floor(n / 100);
    const t = Math.floor((n % 100) / 10);
    const u = n % 10;

    if (h > 0) parts.push(HUNDREDS[h]);

    if (t === 1) {
        parts.push(TEENS[u]);
    } else {
        if (t > 1) parts.push(TENS[t]);
        if (u > 0) parts.push(UNITS[u]);
    }

    return parts.join(' e ');
}

/**
 * Converte um número inteiro (sem centavos) para extenso.
 * Ex: 1234 → "um mil, duzentos e trinta e quatro"
 */
export function numberToWords(n: number): string {
    if (n === 0) return 'zero';
    if (n < 0) return 'menos ' + numberToWords(-n);

    n = Math.floor(n); // Ignora decimais

    const groups: { value: number; singular: string; plural: string }[] = [
        { value: 1_000_000_000, singular: 'bilhão', plural: 'bilhões' },
        { value: 1_000_000, singular: 'milhão', plural: 'milhões' },
        { value: 1_000, singular: 'mil', plural: 'mil' },
    ];

    const parts: string[] = [];
    let remaining = n;

    for (const g of groups) {
        const count = Math.floor(remaining / g.value);
        if (count > 0) {
            if (g.value === 1000 && count === 1) {
                parts.push('mil');
            } else {
                parts.push(`${groupToWords(count)} ${count === 1 ? g.singular : g.plural}`);
            }
            remaining %= g.value;
        }
    }

    if (remaining > 0) {
        parts.push(groupToWords(remaining));
    }

    // Brazilian Portuguese joining:
    // - Between major groups (milhões, mil): use ", "
    // - Before the final group: use " e "
    // Ex: "um milhão, duzentos e trinta e quatro mil, quinhentos e sessenta e sete"
    //     "mil e quinhentos"
    //     "doze mil, trezentos e quarenta e cinco"
    if (parts.length <= 1) return parts[0] || 'zero';
    if (parts.length === 2) return parts[0] + ' e ' + parts[1];

    // 3+ parts: join all but last with ", ", then " e " before last
    const last = parts.pop()!;
    return parts.join(', ') + ' e ' + last;
}

/**
 * Converte valor monetário (com centavos) para extenso em formato licitatório.
 * Ex: 1234567.89 → "um milhão, duzentos e trinta e quatro mil, quinhentos e sessenta e sete reais e oitenta e nove centavos"
 */
export function currencyToWords(value: number): string {
    if (value === 0) return 'zero reais';

    const intPart = Math.floor(Math.abs(value));
    const cents = Math.round((Math.abs(value) - intPart) * 100);

    const parts: string[] = [];

    if (intPart > 0) {
        const intWords = numberToWords(intPart);
        parts.push(`${intWords} ${intPart === 1 ? 'real' : 'reais'}`);
    }

    if (cents > 0) {
        const centWords = numberToWords(cents);
        parts.push(`${centWords} ${cents === 1 ? 'centavo' : 'centavos'}`);
    }

    return parts.join(' e ');
}
