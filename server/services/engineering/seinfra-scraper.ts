/**
 * ══════════════════════════════════════════════════════════════════
 *  SEINFRA-CE Excel Importer
 * ══════════════════════════════════════════════════════════════════
 *
 *  Downloads and parses the official SEINFRA-CE cost table Excel files
 *  from the SIPROCE portal:
 *    - Composicoes-028---ENC.-SOCIAIS-114,15.xls → Compositions
 *    - Tabela-de-Insumos-028---ENC.-SOCIAIS-114,15.xls → Items/Insumos
 *
 *  These are publicly available at:
 *    https://sin.seinfra.ce.gov.br/site-seinfra/siproce/onerada/
 */

import * as XLSX from 'xlsx';

const SEINFRA_BASE = 'https://sin.seinfra.ce.gov.br/site-seinfra/siproce/onerada';
const INSUMOS_URL = `${SEINFRA_BASE}/Tabela-de-Insumos-028---ENC.-SOCIAIS-114,15.xls`;
const COMPOSICOES_URL = `${SEINFRA_BASE}/Composicoes-028---ENC.-SOCIAIS-114,15.xls`;

export interface ParsedInsumo {
    code: string;
    description: string;
    unit: string;
    price: number;
    type: 'MATERIAL' | 'MAO_DE_OBRA' | 'EQUIPAMENTO' | 'SERVICO';
}

export interface ParsedCompositionItem {
    insumoCode: string;
    description: string;
    unit: string;
    coefficient: number;
    unitPrice: number;
    totalPrice: number;
    isComposition: boolean; // true if C-code (auxiliary composition)
}

export interface ParsedComposition {
    code: string;
    description: string;
    unit: string;
    totalPrice: number;
    items: ParsedCompositionItem[];
}

/**
 * Download a file from URL and return as Buffer
 */
async function downloadFile(url: string): Promise<Buffer> {
    console.log(`[SEINFRA Import] ⬇️ Downloading: ${url.split('/').pop()}`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000); // 2min timeout
    try {
        const res = await fetch(url, {
            signal: controller.signal,
            headers: { 'User-Agent': 'LicitaSaaS-Importer/1.0' }
        });
        if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
        const arrayBuf = await res.arrayBuffer();
        const buf = Buffer.from(arrayBuf);
        console.log(`[SEINFRA Import] ✅ Downloaded: ${(buf.length / 1024 / 1024).toFixed(1)} MB`);
        return buf;
    } finally {
        clearTimeout(timeout);
    }
}

/**
 * Detect insumo type from description
 */
function detectType(code: string, description: string): ParsedInsumo['type'] {
    const desc = (description || '').toUpperCase();
    if (code.startsWith('C')) return 'SERVICO'; // Compositions are services
    if (desc.includes('PEDREIRO') || desc.includes('SERVENTE') || desc.includes('CARPINTEIRO') ||
        desc.includes('ELETRICIST') || desc.includes('BOMBEIRO') || desc.includes('PINTOR') ||
        desc.includes('ENCANADOR') || desc.includes('SOLDADOR') || desc.includes('ARMADOR') ||
        desc.includes('OPERADOR') || desc.includes('MOTORISTA') || desc.includes('MÃO DE OBRA') ||
        desc.includes('MAO DE OBRA') || desc.includes('AJUDANTE') || desc.includes('ENGENHEIRO') ||
        desc.includes('MESTRE DE OBRA') || desc.includes('APONTADOR') || desc.includes('VIGIA') ||
        desc.includes('TOPÓGRAFO') || desc.includes('TOPOGRAFO') || desc.includes('ALMOXARIFE')) return 'MAO_DE_OBRA';
    if (desc.includes('BETONEIRA') || desc.includes('COMPACTADOR') || desc.includes('RETRO') ||
        desc.includes('ESCAVADEIRA') || desc.includes('CAMINHÃO') || desc.includes('CAMINHAO') ||
        desc.includes('VIBRADOR') || desc.includes('GUINDASTE') || desc.includes('MÁQUINA') ||
        desc.includes('MAQUINA') || desc.includes('ROLO') || desc.includes('TRATOR') ||
        desc.includes('GUINCHO') || desc.includes('SERRA CIRCULAR') || desc.includes('PERFURATRIZ') ||
        desc.includes('ALUGUEL')) return 'EQUIPAMENTO';
    return 'MATERIAL';
}

/**
 * Parse the Insumos Excel file
 * Structure: Código | Descrição | Unidade | Preço
 */
export function parseInsumosExcel(buffer: Buffer): ParsedInsumo[] {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const items: ParsedInsumo[] = [];

    for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

        for (const row of rows) {
            if (!row || row.length < 3) continue;
            
            const code = String(row[0] || '').trim();
            // Valid insumo codes: I followed by digits, or just numeric codes
            if (!code || (!code.match(/^I\d{3,5}$/i) && !code.match(/^\d{4,6}$/))) continue;

            const description = String(row[1] || '').trim();
            const unit = String(row[2] || '').trim();
            const price = typeof row[3] === 'number' ? row[3] :
                parseFloat(String(row[3] || '0').replace('.', '').replace(',', '.')) || 0;

            if (description) {
                items.push({
                    code: code.toUpperCase(),
                    description,
                    unit: unit || 'UN',
                    price,
                    type: detectType(code, description),
                });
            }
        }
    }

    console.log(`[SEINFRA Import] 📋 Insumos parsed: ${items.length} items from ${workbook.SheetNames.length} sheets`);
    return items;
}

/**
 * Parse the Composições Excel file
 * Structure varies but typically:
 *   - Header row: Composition Code | Description | Unit | Total Price
 *   - Item rows: Insumo Code | Description | Unit | Coefficient | Unit Price | Total
 *   - Blank row separator between compositions
 */
export function parseComposicoesExcel(buffer: Buffer): ParsedComposition[] {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const compositions: ParsedComposition[] = [];

    for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

        let currentComp: ParsedComposition | null = null;

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            if (!row || row.length < 2) {
                // Empty row = end of current composition
                if (currentComp && currentComp.items.length > 0) {
                    compositions.push(currentComp);
                    currentComp = null;
                }
                continue;
            }

            const col0 = String(row[0] || '').trim();
            const col1 = String(row[1] || '').trim();

            // Detect composition header: C-code in first column
            if (col0.match(/^C\d{3,5}$/i)) {
                // Save previous composition if exists
                if (currentComp && currentComp.items.length > 0) {
                    compositions.push(currentComp);
                }

                const unit = String(row[2] || '').trim() || 'UN';
                // Total price may be in column 3 or at the end
                let totalPrice = 0;
                for (let c = row.length - 1; c >= 3; c--) {
                    const val = typeof row[c] === 'number' ? row[c] :
                        parseFloat(String(row[c] || '0').replace('.', '').replace(',', '.'));
                    if (val > 0) { totalPrice = val; break; }
                }

                currentComp = {
                    code: col0.toUpperCase(),
                    description: col1,
                    unit,
                    totalPrice,
                    items: [],
                };
                continue;
            }

            // Detect item row within a composition
            if (currentComp && (col0.match(/^I\d{3,5}$/i) || col0.match(/^C\d{3,5}$/i) || col0.match(/^\d{4,6}$/))) {
                // This is a C-code auxiliary composition reference inside another composition
                const isComposition = col0.toUpperCase().startsWith('C');
                
                const unit = String(row[2] || '').trim();
                const coefficient = typeof row[3] === 'number' ? row[3] :
                    parseFloat(String(row[3] || '0').replace(',', '.')) || 0;
                const unitPrice = typeof row[4] === 'number' ? row[4] :
                    parseFloat(String(row[4] || '0').replace('.', '').replace(',', '.')) || 0;
                const totalPrice = typeof row[5] === 'number' ? row[5] :
                    parseFloat(String(row[5] || '0').replace('.', '').replace(',', '.')) || 0;

                if (col1 && coefficient > 0) {
                    currentComp.items.push({
                        insumoCode: col0.toUpperCase(),
                        description: col1,
                        unit: unit || 'UN',
                        coefficient,
                        unitPrice,
                        totalPrice: totalPrice || (coefficient * unitPrice),
                        isComposition,
                    });
                }
            }
        }

        // Don't forget the last composition
        if (currentComp && currentComp.items.length > 0) {
            compositions.push(currentComp);
        }
    }

    console.log(`[SEINFRA Import] 📋 Composições parsed: ${compositions.length} compositions from ${workbook.SheetNames.length} sheets`);
    return compositions;
}

/**
 * Main function: Download and parse all SEINFRA data
 */
export async function downloadAndParseSeinfra(): Promise<{
    insumos: ParsedInsumo[];
    compositions: ParsedComposition[];
    errors: string[];
}> {
    const errors: string[] = [];
    let insumos: ParsedInsumo[] = [];
    let compositions: ParsedComposition[] = [];

    // Download Insumos
    try {
        const insumosBuffer = await downloadFile(INSUMOS_URL);
        insumos = parseInsumosExcel(insumosBuffer);
    } catch (e: any) {
        errors.push(`Insumos download failed: ${e.message}`);
        console.error('[SEINFRA Import] ❌ Insumos download failed:', e.message);
    }

    // Download Composições
    try {
        const composBuffer = await downloadFile(COMPOSICOES_URL);
        compositions = parseComposicoesExcel(composBuffer);
    } catch (e: any) {
        errors.push(`Composições download failed: ${e.message}`);
        console.error('[SEINFRA Import] ❌ Composições download failed:', e.message);
    }

    return { insumos, compositions, errors };
}
