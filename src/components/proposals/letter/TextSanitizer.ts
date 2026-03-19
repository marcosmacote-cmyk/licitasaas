/**
 * ══════════════════════════════════════════════════════════════
 * TextSanitizer
 * Camada final obrigatória de higienização textual.
 * Aplica-se APÓS o Builder montar os blocos e ANTES da revisão/exportação.
 * Não altera estrutura — apenas limpa o texto de cada bloco.
 * ══════════════════════════════════════════════════════════════
 */

import type { LetterBlock } from './types';
import { LetterBlockType } from './types';

export class TextSanitizer {

    /**
     * Sanitiza todos os blocos visíveis in-place.
     */
    sanitizeAll(blocks: LetterBlock[]): LetterBlock[] {
        // Blocos com formatação fixa NÃO devem ser sanitizados
        const FIXED_FORMAT_BLOCKS = new Set<string>([
            LetterBlockType.SIGNATURE,
            LetterBlockType.CLOSING,
        ]);

        return blocks.map(block => ({
            ...block,
            content: (block.visible && !FIXED_FORMAT_BLOCKS.has(block.type))
                ? this.sanitize(block.content)
                : block.content,
        }));
    }

    /**
     * Pipeline de sanitização para texto individual.
     */
    sanitize(text: string): string {
        if (!text?.trim()) return text;

        let result = text;

        // 1. Remover linhas com apenas "Não informado", "N/A", "-" (campos vazios mal formatados)
        result = this.removeOrphanPlaceholders(result);

        // 2. Normalizar espaçamento
        result = this.normalizeSpacing(result);

        // 3. Corrigir pontuação
        result = this.fixPunctuation(result);

        // 4. Normalizar ALL CAPS em nomes de órgãos/instituições
        result = this.normalizeAllCaps(result);

        // 5. Limpar labels órfãs (ex: "Local de execução: " sem valor)
        result = this.removeOrphanLabels(result);

        // 6. Normalizar capitalização de início de parágrafo
        result = this.normalizeCapitalization(result);

        // 7. Detectar texto truncado — DESATIVADO (v3.0)
        // A detecção era agressiva demais, marcando textos válidos.
        // A validação pré-exportação (validateForExport) agora cobre este caso.

        return result.trim();
    }

    /**
     * Remove linhas que contêm apenas placeholders sem valor útil.
     */
    private removeOrphanPlaceholders(text: string): string {
        return text
            .split('\n')
            .filter(line => {
                const trimmed = line.trim();
                // Remove linhas que são apenas placeholders
                if (/^(Não informado\.?|N\/A|—|-|\.\.\.)$/i.test(trimmed)) return false;
                // Remove linhas tipo "Campo: Não informado."
                if (/^[A-ZÀ-Ú][^:]+:\s*(Não informado|N\/A|—|-)\.?$/i.test(trimmed)) return false;
                return true;
            })
            .join('\n');
    }

    /**
     * Normaliza espaços, linhas em branco duplicadas, tabs, etc.
     */
    private normalizeSpacing(text: string): string {
        return text
            // Múltiplos espaços → 1
            .replace(/ {2,}/g, ' ')
            // Mais de 2 linhas em branco → 2
            .replace(/\n{4,}/g, '\n\n\n')
            // Espaços antes de pontuação
            .replace(/\s+([.,;:!?])/g, '$1')
            // Espaços no início/final de linhas
            .replace(/^[ \t]+|[ \t]+$/gm, '')
            // Tab → espaço
            .replace(/\t/g, ' ');
    }

    /**
     * Corrige problemas comuns de pontuação.
     */
    private fixPunctuation(text: string): string {
        return text
            // Duplo ponto final
            .replace(/\.{2,}/g, '.')
            // Vírgula antes de vírgula
            .replace(/,\s*,/g, ',')
            // Ponto e vírgula e ponto
            .replace(/;\./g, '.')
            // Espaço antes de barra (Ref nº 045 /2026 → nº 045/2026)
            .replace(/\s+\//g, '/')
            // Vírgula final desnecessária antes de ponto
            .replace(/,\s*\./g, '.')
            // Dois-pontos seguido de ponto, sem conteúdo
            .replace(/:\s*\./g, '.');
    }

    /**
     * Remove labels que ficaram órfãs (sem valor após os dois-pontos).
     */
    private removeOrphanLabels(text: string): string {
        return text
            .split('\n')
            .filter(line => {
                const trimmed = line.trim();
                // "Label: " (só label com : e nada depois)
                if (/^[A-ZÀ-Ú][^:]{2,40}:\s*$/.test(trimmed)) return false;
                // "Label: ___" (placeholders vazios)
                if (/^[A-ZÀ-Ú][^:]{2,40}:\s*_{3,}\s*$/.test(trimmed)) return false;
                return true;
            })
            .join('\n');
    }

    /**
     * Normaliza capitalização sem ser agressivo.
     */
    private normalizeCapitalization(text: string): string {
        // Após ponto final + espaço, garantir maiúscula
        return text.replace(/\.\s+([a-zà-ú])/g, (_, c) => '. ' + c.toUpperCase());
    }

    /**
     * Converte ALL CAPS em nomes de órgãos/instituições para Title Case.
     * Ex: "SECRETARIA DE EDUCAÇÃO" → "Secretaria de Educação"
     * Preserva acronyms conhecidos (CNPJ, CPF, CEP, CREA, CAU, BDI, PIX, etc.)
     */
    private normalizeAllCaps(text: string): string {
        const ACRONYMS = new Set([
            'CNPJ', 'CPF', 'CEP', 'CREA', 'CAU', 'CRC', 'OAB', 'CRM',
            'RG', 'IE', 'IM', 'BDI', 'PIX', 'LTDA', 'EIRELI', 'MEI',
            'ME', 'EPP', 'SA', 'S/A', 'SLU', 'S.A',
            'PNCP', 'TCU', 'TCE', 'CGU', 'STF', 'STJ',
        ]);
        const LOWERCASE_WORDS = new Set([
            'de', 'da', 'do', 'das', 'dos', 'e', 'em', 'no', 'na',
            'nos', 'nas', 'para', 'por', 'com', 'sem', 'sob', 'ao', 'à',
            'pelo', 'pela', 'pelos', 'pelas', 'o', 'a', 'os', 'as', 'um', 'uma',
        ]);

        // Match sequences of 3+ ALL CAPS words on the SAME line.
        // First word must be 2+ chars; subsequent can be 1+ (allows connectors E, A, O, etc.)
        return text.replace(/\b([A-ZÀ-Ú]{2,}(?:[ \t]+[A-ZÀ-Ú]+){2,})\b/g, (match) => {
            const words = match.split(/[ \t]+/);
            return words.map((word, i) => {
                if (ACRONYMS.has(word)) return word;
                if (i > 0 && LOWERCASE_WORDS.has(word.toLowerCase())) return word.toLowerCase();
                // Title Case
                return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
            }).join(' ');
        });
    }
}
