import prisma from '../../lib/prisma';
import { logger } from '../../lib/logger';

export class PncpSynonymService {
    private static cache: Map<string, string[]> = new Map();
    private static lastLoaded = 0;
    private static CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutos

    /**
     * Carrega os sinônimos do banco e atualiza o cache em memória
     */
    static async loadCacheIfNeeded(force = false): Promise<void> {
        const now = Date.now();
        if (!force && this.cache.size > 0 && (now - this.lastLoaded) < this.CACHE_TTL_MS) {
            return;
        }

        try {
            const dbSynonyms = await prisma.pncpSynonym.findMany();
            this.cache.clear();
            
            for (const item of dbSynonyms) {
                const wordClean = item.word.trim().toLowerCase();
                const synList = item.synonyms
                    .split(',')
                    .map(s => s.trim().toLowerCase())
                    .filter(Boolean);
                
                if (wordClean && synList.length > 0) {
                    this.cache.set(wordClean, synList);
                }
            }
            
            this.lastLoaded = now;
            logger.info(`[Synonyms] Cache atualizado com ${this.cache.size} conjuntos de sinônimos.`);
        } catch (err: any) {
            logger.error(`[Synonyms] Falha ao carregar sinônimos do banco: ${err.message}`);
        }
    }

    /**
     * Normaliza e remove acentos básicos para facilitar a correspondência no dicionário
     */
    private static normalizeWord(w: string): string {
        return w
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .trim();
    }

    /**
     * Recebe a string de keywords (ex: "merenda, TI") e a expande usando sinônimos mapeados
     */
    static async expandQuery(keywords: string): Promise<string> {
        if (!keywords || keywords.trim() === '') return '';

        await this.loadCacheIfNeeded();

        // As palavras-chave do frontend costumam ser separadas por vírgula (ex: "merenda, merenda escolar")
        const terms = keywords
            .split(',')
            .map(k => k.trim())
            .filter(Boolean);
        
        const expandedTerms: string[] = [];

        for (const term of terms) {
            const termNorm = this.normalizeWord(term);
            
            // Verifica se o termo inteiro (ex: "alimentacao escolar") tem sinônimos
            if (this.cache.has(termNorm)) {
                const syns = this.cache.get(termNorm) || [];
                // Se o próprio termo não estiver na lista de sinônimos, insere
                const uniqueSyns = Array.from(new Set([term, ...syns]));
                expandedTerms.push('(' + uniqueSyns.map(s => `"${s}"`).join(' OR ') + ')');
                continue;
            }

            // Se for um termo composto (ex: "merenda escolar"), tenta verificar as palavras individuais
            const words = term.split(/\s+/).filter(Boolean);
            let replacedAny = false;
            const expandedWords = await Promise.all(words.map(w => {
                const wNorm = this.normalizeWord(w);
                if (this.cache.has(wNorm)) {
                    replacedAny = true;
                    const syns = this.cache.get(wNorm) || [];
                    const uniqueSyns = Array.from(new Set([w, ...syns]));
                    return '(' + uniqueSyns.map(s => `"${s}"`).join(' OR ') + ')';
                }
                return w;
            }));

            if (replacedAny) {
                expandedTerms.push('(' + expandedWords.join(' AND ') + ')');
            } else {
                expandedTerms.push(`"${term}"`);
            }
        }

        const finalQuery = expandedTerms.join(' OR ');
        logger.info(`[Synonyms] Query original: "${keywords}" -> Expandida: "${finalQuery}"`);
        return finalQuery;
    }
}
