/**
 * ══════════════════════════════════════════════════════════════
 * TextSanitizer
 * Camada final obrigatória de higienização textual.
 * Aplica-se APÓS o Builder montar os blocos e ANTES da revisão/exportação.
 * Não altera estrutura — apenas limpa o texto de cada bloco.
 * ══════════════════════════════════════════════════════════════
 */

import type { LetterBlock } from './types';

export class TextSanitizer {

    /**
     * Sanitiza todos os blocos visíveis in-place.
     */
    sanitizeAll(blocks: LetterBlock[]): LetterBlock[] {
        return blocks.map(block => ({
            ...block,
            content: block.visible ? this.sanitize(block.content) : block.content,
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

        // 4. Limpar labels órfãs (ex: "Local de execução: " sem valor)
        result = this.removeOrphanLabels(result);

        // 5. Normalizar capitalização de início de parágrafo
        result = this.normalizeCapitalization(result);

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
}
