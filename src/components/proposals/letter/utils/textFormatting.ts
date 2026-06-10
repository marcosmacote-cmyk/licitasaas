export function toTitleCasePt(str: string): string {
    if (!str) return '';
    const trimmed = str.trim();
    const hasLetters = /[a-zA-Z]/;
    const isAllCaps = hasLetters.test(trimmed) && trimmed === trimmed.toUpperCase();
    if (!isAllCaps) {
        return trimmed;
    }
    const minorWords = new Set([
        'a', 'o', 'as', 'os', 'em', 'de', 'do', 'da', 'dos', 'das', 
        'com', 'para', 'por', 'sem', 'sob', 'sobre', 'e', 'ou', 'um', 'uma'
    ]);
    return trimmed
        .toLowerCase()
        .split(/\s+/)
        .map((word, idx) => {
            if (idx > 0 && minorWords.has(word)) {
                return word;
            }
            return word.charAt(0).toUpperCase() + word.slice(1);
        })
        .join(' ');
}

export function toSentenceCasePt(str: string): string {
    if (!str) return '';
    const trimmed = str.trim();
    const hasLetters = /[a-zA-Z]/;
    const isAllCaps = hasLetters.test(trimmed) && trimmed === trimmed.toUpperCase();
    if (!isAllCaps) {
        return trimmed;
    }
    const lower = trimmed.toLowerCase();
    let formatted = lower.replace(/(^\s*|[.!?]\s+)([a-z])/g, (m, p1, p2) => p1 + p2.toUpperCase());
    
    const replacements: [RegExp, string][] = [
        [/\bedital\b/g, 'Edital'],
        [/\bcf\b/g, 'CF'],
        [/\bclt\b/g, 'CLT'],
        [/\blgpd\b/g, 'LGPD'],
        [/\bcnpj\b/g, 'CNPJ'],
        [/\bcpf\b/g, 'CPF'],
        [/\bme\b/g, 'ME'],
        [/\bepp\b/g, 'EPP'],
        [/\blei\b/g, 'Lei'],
        [/\bart\b/g, 'Art'],
        [/\bcrfb\b/g, 'CRFB'],
        [/\btcu\b/g, 'TCU'],
        [/\bsinapi\b/g, 'SINAPI'],
        [/\bseinfra\b/g, 'SEINFRA'],
        [/\bcaern\b/g, 'CAERN'],
        [/\bsbc\b/g, 'SBC'],
        [/\borse\b/g, 'ORSE'],
        [/\bsicro\b/g, 'SICRO'],
        [/\bsicor\b/g, 'SICOR'],
        [/\bbr\b/g, 'BR'],
        [/\buf\b/g, 'UF'],
    ];
    
    for (const [regex, replacement] of replacements) {
        formatted = formatted.replace(regex, replacement);
    }
    
    formatted = formatted.charAt(0).toUpperCase() + formatted.slice(1);
    return formatted;
}

export function normalizeDeclarationContent(title: string, content: string): string {
    let baseText = content?.trim() || '';
    
    // Se o conteúdo for vazio, usamos o título como base
    if (!baseText) {
        baseText = title?.trim() || '';
    }
    
    if (!baseText) return '';
    
    // 1. Remover redundância do título se o texto base começar com ele
    if (title && title.trim()) {
        const cleanTitle = title.trim().toLowerCase();
        const cleanBase = baseText.toLowerCase();
        if (cleanBase.startsWith(cleanTitle)) {
            // Remove o título e qualquer caractere de pontuação/separador subsequente
            let remaining = baseText.substring(cleanTitle.length).trim();
            remaining = remaining.replace(/^[:\-\–\s]+/, '').trim();
            if (remaining) {
                baseText = remaining;
            }
        }
    }
    
    // 2. Garantir Sentence Case se o texto for todo em maiúsculas (ou processar para manter caixa baixa/Sentence Case geral)
    // Para a coerência de caixa baixa, vamos converter para Sentence Case caso a palavra seja all caps ou para ter harmonização básica
    baseText = toSentenceCasePt(baseText);
    
    // 3. Normalizar o prefixo para "Declaramos que...", "Declaramos a...", "Declaramos o..." ou "Declaramos..."
    let trimmed = baseText.trim();
    
    const prefixRegexes: { pattern: RegExp; replacement: string }[] = [
        { pattern: /^declaração de que\b/i, replacement: 'Declaramos que' },
        { pattern: /^declaração que\b/i, replacement: 'Declaramos que' },
        { pattern: /^declaração de inexistência\b/i, replacement: 'Declaramos a inexistência' },
        { pattern: /^declaração de atendimento\b/i, replacement: 'Declaramos o atendimento' },
        { pattern: /^declaração de cumprimento\b/i, replacement: 'Declaramos o cumprimento' },
        { pattern: /^declaração de regularidade\b/i, replacement: 'Declaramos a regularidade' },
        { pattern: /^declaração de\b/i, replacement: 'Declaramos que' },
        { pattern: /^declaração\b/i, replacement: 'Declaramos' },
        
        { pattern: /^declaro de que\b/i, replacement: 'Declaramos que' },
        { pattern: /^declaro que\b/i, replacement: 'Declaramos que' },
        { pattern: /^declaro a inexistência\b/i, replacement: 'Declaramos a inexistência' },
        { pattern: /^declaro o atendimento\b/i, replacement: 'Declaramos o atendimento' },
        { pattern: /^declaro o cumprimento\b/i, replacement: 'Declaramos o cumprimento' },
        { pattern: /^declaro a regularidade\b/i, replacement: 'Declaramos a regularidade' },
        { pattern: /^declaro a\b/i, replacement: 'Declaramos a' },
        { pattern: /^declaro o\b/i, replacement: 'Declaramos o' },
        { pattern: /^declaro de\b/i, replacement: 'Declaramos que' },
        { pattern: /^declaro\b/i, replacement: 'Declaramos' },
        
        { pattern: /^declara-se que\b/i, replacement: 'Declaramos que' },
        { pattern: /^declara-se a\b/i, replacement: 'Declaramos a' },
        { pattern: /^declara-se o\b/i, replacement: 'Declaramos o' },
        { pattern: /^declara-se\b/i, replacement: 'Declaramos' },
        { pattern: /^declara que\b/i, replacement: 'Declaramos que' },
        { pattern: /^declara a\b/i, replacement: 'Declaramos a' },
        { pattern: /^declara o\b/i, replacement: 'Declaramos o' },
        { pattern: /^declara\b/i, replacement: 'Declaramos' },
        
        { pattern: /^declaramos de que\b/i, replacement: 'Declaramos que' },
        { pattern: /^declaramos de\b/i, replacement: 'Declaramos que' },
    ];
    
    let matched = false;
    for (const item of prefixRegexes) {
        if (item.pattern.test(trimmed)) {
            trimmed = trimmed.replace(item.pattern, item.replacement);
            matched = true;
            break;
        }
    }
    
    if (!matched) {
        if (/^inexistência\b/i.test(trimmed)) {
            trimmed = 'Declaramos a ' + trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
        } else if (/^atendimento\b/i.test(trimmed)) {
            trimmed = 'Declaramos o ' + trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
        } else if (/^cumprimento\b/i.test(trimmed)) {
            trimmed = 'Declaramos o ' + trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
        } else if (/^regularidade\b/i.test(trimmed)) {
            trimmed = 'Declaramos a ' + trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
        } else if (/^que\b/i.test(trimmed)) {
            trimmed = 'Declaramos ' + trimmed.charAt(0).toLowerCase() + trimmed.slice(1);
        } else if (/^declaramos\b/i.test(trimmed)) {
            // Já começa com Declaramos, nada a fazer
        } else {
            // Prefixar com "Declaramos que "
            const firstWord = trimmed.split(/\s+/)[0];
            const isSigla = firstWord === firstWord.toUpperCase() && firstWord.length > 1;
            const cleanFirst = isSigla ? trimmed : (trimmed.charAt(0).toLowerCase() + trimmed.slice(1));
            trimmed = 'Declaramos que ' + cleanFirst;
        }
    }
    
    // Garantir ponto final
    if (trimmed && !/[.!?]$/.test(trimmed)) {
        trimmed += '.';
    }
    
    return trimmed;
}
