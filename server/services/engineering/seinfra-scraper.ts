/**
 * ══════════════════════════════════════════════════════════════════
 *  SEINFRA-CE SIPROCE Scraper
 * ══════════════════════════════════════════════════════════════════
 *
 *  Scrapes the official SEINFRA-CE (Secretaria de Infraestrutura do Ceará)
 *  cost table (SIPROCE) from:
 *    https://sin.seinfra.ce.gov.br/site-seinfra/siproce/onerada/html/
 *
 *  Architecture:
 *    1. Fetch main page → list of 30 category pages (1.html to 30.html)
 *    2. Fetch each category → list of sub-categories (1.1.html, 1.2.html)
 *    3. Fetch each sub-category → list of compositions (C0002, C0089, etc.)
 *    4. Fetch each composition page → parse items (materials, labor, equipment)
 *    5. Upsert to EngineeringDatabase → EngineeringComposition → EngineeringCompositionItem
 *
 *  Performance:
 *    - Uses concurrency pool (5 parallel requests)
 *    - Respects server with 200ms delay between batches
 *    - Caches fetched pages in memory
 */

import * as cheerio from 'cheerio';

const BASE_URL = 'https://sin.seinfra.ce.gov.br/site-seinfra/siproce/onerada/html';
const CONCURRENCY = 3;
const DELAY_MS = 300;

export interface ScrapedInsumo {
    code: string;
    description: string;
    unit: string;
    price: number;
    type: 'MATERIAL' | 'MAO_DE_OBRA' | 'EQUIPAMENTO' | 'SERVICO';
}

export interface ScrapedCompositionItem {
    insumoCode: string;
    description: string;
    unit: string;
    coefficient: number;
    unitPrice: number;
    totalPrice: number;
    type: 'MATERIAL' | 'MAO_DE_OBRA' | 'EQUIPAMENTO' | 'SERVICO' | 'COMPOSICAO_AUXILIAR';
}

export interface ScrapedComposition {
    code: string;
    description: string;
    unit: string;
    totalPrice: number;
    items: ScrapedCompositionItem[];
}

export interface ScrapeProgress {
    phase: string;
    current: number;
    total: number;
    message: string;
}

async function fetchPage(url: string): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
        const res = await fetch(url, { 
            signal: controller.signal,
            headers: { 'User-Agent': 'LicitaSaaS-Scraper/1.0' }
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
        return await res.text();
    } finally {
        clearTimeout(timeout);
    }
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Parse the category index page to get sub-category links
 * e.g., /1.html → [1.1.html, 1.2.html, ...]
 */
function parseCategoryLinks(html: string, baseUrl: string): string[] {
    const $ = cheerio.load(html);
    const links: string[] = [];
    $('a').each((_, el) => {
        const href = $(el).attr('href') || '';
        // Match sub-category pages like 1.1.html, 6.2.html but NOT C0002.html
        if (/\/\d+\.\d+\.html/.test(href)) {
            const fullUrl = href.startsWith('http') ? href : `${baseUrl}/${href.split('/').pop()?.split('?')[0]}`;
            if (!links.includes(fullUrl)) links.push(fullUrl);
        }
    });
    return links;
}

/**
 * Parse a sub-category page to get composition links
 * e.g., /1.5.html → [{code: 'C0002', url: '.../C0002.html'}, ...]
 */
function parseCompositionLinks(html: string): Array<{ code: string; description: string; url: string }> {
    const $ = cheerio.load(html);
    const compositions: Array<{ code: string; description: string; url: string }> = [];
    const links = $('a').toArray();
    
    for (let i = 0; i < links.length; i += 2) {
        const el = links[i];
        const href = $(el).attr('href') || '';
        const text = $(el).text().trim();
        
        // Composition codes start with C or I followed by digits
        if (/^[CI]\d{3,5}$/.test(text) && href.includes('.html')) {
            const descEl = links[i + 1];
            const description = descEl ? $(descEl).text().trim() : text;
            const url = href.startsWith('http') ? href.split('?')[0] : `${BASE_URL}/${text}.html`;
            compositions.push({ code: text, description, url });
        }
    }
    return compositions;
}

/**
 * Parse a composition detail page to get its items
 * The SIPROCE HTML tables have: Código | Descrição | Un | Coeficiente | Preço | Total
 */
function parseCompositionPage(html: string, compCode: string): ScrapedComposition | null {
    const $ = cheerio.load(html);
    
    // Try to extract from table rows
    const items: ScrapedCompositionItem[] = [];
    let compositionDescription = '';
    let compositionUnit = '';
    let compositionTotal = 0;

    // The page typically has a header with the composition info
    // and a table with the breakdown
    const tables = $('table');
    
    if (tables.length === 0) {
        // Some pages might use divs instead of tables
        // Try to parse from structured text
        const allText = $('body').text();
        if (!allText || allText.trim().length < 10) return null;
    }

    tables.each((_, table) => {
        const rows = $(table).find('tr');
        rows.each((rowIdx, row) => {
            const cells = $(row).find('td, th');
            if (cells.length < 4) return;

            const cellTexts = cells.map((_, c) => $(c).text().trim()).get();
            
            // Skip header rows
            if (cellTexts[0]?.toLowerCase().includes('código') || 
                cellTexts[0]?.toLowerCase().includes('codigo')) return;

            // Try to identify composition header (code, description, unit)
            if (cellTexts[0] === compCode && compositionDescription === '') {
                compositionDescription = cellTexts[1] || '';
                compositionUnit = cellTexts[2] || 'UN';
                return;
            }

            // Parse item row: Code | Description | Unit | Coefficient | Price | Total
            const code = cellTexts[0] || '';
            const desc = cellTexts[1] || '';
            const unit = cellTexts[2] || '';
            const coeff = parseFloat((cellTexts[3] || '0').replace(',', '.')) || 0;
            const price = parseFloat((cellTexts[4] || '0').replace('.', '').replace(',', '.')) || 0;
            const total = parseFloat((cellTexts[5] || '0').replace('.', '').replace(',', '.')) || 0;

            if (code && desc && coeff > 0) {
                const type = detectInsumoType(code, desc);
                items.push({
                    insumoCode: code,
                    description: desc,
                    unit,
                    coefficient: coeff,
                    unitPrice: price,
                    totalPrice: total,
                    type,
                });
            }
        });
    });

    // If no table parsing worked, try text-based parsing
    if (items.length === 0) {
        const bodyHtml = $('body').html() || '';
        // SIPROCE uses specific class names for its data
        const dataRows = $('[class*="item"], [class*="row"], [class*="data"], tr');
        dataRows.each((_, el) => {
            const text = $(el).text();
            // Try to match patterns like "I1234  AREIA MEDIA  M3  0.0234  89.50  2.10"
            const match = text.match(/([CI]\d{3,5})\s+(.+?)\s+(M2|M3|UN|KG|H|ML|MES|L|CJ|VB|M|TON|SC)\s+([\d.,]+)\s+([\d.,]+)\s+([\d.,]+)/i);
            if (match) {
                items.push({
                    insumoCode: match[1],
                    description: match[2].trim(),
                    unit: match[3],
                    coefficient: parseFloat(match[4].replace(',', '.')) || 0,
                    unitPrice: parseFloat(match[5].replace('.', '').replace(',', '.')) || 0,
                    totalPrice: parseFloat(match[6].replace('.', '').replace(',', '.')) || 0,
                    type: detectInsumoType(match[1], match[2]),
                });
            }
        });
    }

    // Calculate total from items if not found
    if (compositionTotal === 0 && items.length > 0) {
        compositionTotal = items.reduce((sum, item) => sum + item.totalPrice, 0);
    }

    if (items.length === 0) return null;

    return {
        code: compCode,
        description: compositionDescription || compCode,
        unit: compositionUnit || 'UN',
        totalPrice: Math.round(compositionTotal * 100) / 100,
        items,
    };
}

function detectInsumoType(code: string, description: string): ScrapedCompositionItem['type'] {
    const desc = description.toUpperCase();
    if (code.startsWith('C')) return 'COMPOSICAO_AUXILIAR';
    // I-codes are insumos
    if (desc.includes('PEDREIRO') || desc.includes('SERVENTE') || desc.includes('CARPINTEIRO') || 
        desc.includes('ELETRICIST') || desc.includes('BOMBEIRO') || desc.includes('PINTOR') ||
        desc.includes('ENCANADOR') || desc.includes('SOLDADOR') || desc.includes('ARMADOR') ||
        desc.includes('OPERADOR') || desc.includes('MOTORISTA') || desc.includes('MÃO DE OBRA') ||
        desc.includes('MAO DE OBRA') || desc.includes('AJUDANTE')) return 'MAO_DE_OBRA';
    if (desc.includes('BETONEIRA') || desc.includes('COMPACTADOR') || desc.includes('RETRO') ||
        desc.includes('ESCAVADEIRA') || desc.includes('CAMINHÃO') || desc.includes('CAMINHAO') ||
        desc.includes('VIBRADOR') || desc.includes('GUINDASTE') || desc.includes('MÁQUINA') ||
        desc.includes('ROLO') || desc.includes('TRATOR')) return 'EQUIPAMENTO';
    return 'MATERIAL';
}

/**
 * Main scraper function — fetches all SEINFRA compositions
 * Returns scraped data for import
 */
export async function scrapeSeinfraCompositions(
    onProgress?: (p: ScrapeProgress) => void
): Promise<{ compositions: ScrapedComposition[]; errors: string[] }> {
    const compositions: ScrapedComposition[] = [];
    const errors: string[] = [];
    
    const progress = (phase: string, current: number, total: number, message: string) => {
        if (onProgress) onProgress({ phase, current, total, message });
        console.log(`[SEINFRA Scraper] ${phase} [${current}/${total}] ${message}`);
    };

    try {
        // Phase 1: Get main categories (1.html to 30.html)
        progress('categories', 0, 30, 'Carregando categorias...');
        const mainPage = await fetchPage(`${BASE_URL}/tabela-seinfra.html`);
        const $ = cheerio.load(mainPage);
        
        const categoryUrls: string[] = [];
        $('a').each((_, el) => {
            const href = $(el).attr('href') || '';
            if (/\/\d+\.html/.test(href) && !/\d+\.\d+/.test(href)) {
                const url = href.startsWith('http') ? href.split('?')[0] : `${BASE_URL}/${href.split('/').pop()?.split('?')[0]}`;
                if (!categoryUrls.includes(url)) categoryUrls.push(url);
            }
        });

        progress('categories', categoryUrls.length, 30, `${categoryUrls.length} categorias encontradas`);

        // Phase 2: Get sub-categories from each category
        const allSubCategoryUrls: string[] = [];
        for (let i = 0; i < categoryUrls.length; i++) {
            try {
                const catHtml = await fetchPage(categoryUrls[i]);
                const subUrls = parseCategoryLinks(catHtml, BASE_URL);
                allSubCategoryUrls.push(...subUrls);
                progress('subcategories', i + 1, categoryUrls.length, `${subUrls.length} sub-categorias em ${categoryUrls[i].split('/').pop()}`);
                await delay(DELAY_MS);
            } catch (e: any) {
                errors.push(`Category ${categoryUrls[i]}: ${e.message}`);
            }
        }

        progress('subcategories', allSubCategoryUrls.length, allSubCategoryUrls.length, `${allSubCategoryUrls.length} sub-categorias total`);

        // Phase 3: Get composition links from each sub-category
        const allCompositions: Array<{ code: string; description: string; url: string }> = [];
        for (let i = 0; i < allSubCategoryUrls.length; i++) {
            try {
                const subHtml = await fetchPage(allSubCategoryUrls[i]);
                const compLinks = parseCompositionLinks(subHtml);
                allCompositions.push(...compLinks);
                progress('compositions-list', i + 1, allSubCategoryUrls.length, `${compLinks.length} composições em ${allSubCategoryUrls[i].split('/').pop()}`);
                await delay(DELAY_MS);
            } catch (e: any) {
                errors.push(`SubCategory ${allSubCategoryUrls[i]}: ${e.message}`);
            }
        }

        // Deduplicate by code
        const uniqueComps = new Map<string, typeof allCompositions[0]>();
        for (const c of allCompositions) {
            if (!uniqueComps.has(c.code)) uniqueComps.set(c.code, c);
        }
        const deduped = Array.from(uniqueComps.values());

        progress('compositions-detail', 0, deduped.length, `${deduped.length} composições únicas para detalhar`);

        // Phase 4: Fetch each composition's detail page
        for (let i = 0; i < deduped.length; i += CONCURRENCY) {
            const batch = deduped.slice(i, i + CONCURRENCY);
            const results = await Promise.allSettled(
                batch.map(async (comp) => {
                    const html = await fetchPage(comp.url);
                    const parsed = parseCompositionPage(html, comp.code);
                    if (parsed && !parsed.description) parsed.description = comp.description;
                    return parsed;
                })
            );

            for (const result of results) {
                if (result.status === 'fulfilled' && result.value) {
                    compositions.push(result.value);
                } else if (result.status === 'rejected') {
                    errors.push(result.reason?.message || 'Unknown error');
                }
            }

            progress('compositions-detail', Math.min(i + CONCURRENCY, deduped.length), deduped.length,
                `${compositions.length} composições detalhadas`);
            await delay(DELAY_MS);
        }

    } catch (e: any) {
        errors.push(`Fatal: ${e.message}`);
    }

    return { compositions, errors };
}
