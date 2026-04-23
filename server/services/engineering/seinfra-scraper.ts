/**
 * ══════════════════════════════════════════════════════════════════
 *  SEINFRA-CE Excel Importer V2
 * ══════════════════════════════════════════════════════════════════
 *
 *  Downloads and parses the official SEINFRA-CE cost table Excel files
 *  from the SIPROCE portal:
 *    - Composicoes-028---ENC.-SOCIAIS-114,15.xls → Compositions
 *    - Tabela-de-Insumos-028---ENC.-SOCIAIS-114,15.xls → Items/Insumos
 *
 *  Excel Structure (Composições):
 *    Row: "C1802 - BOMBA CENTRÍFUGA DE 1/4 CV... - UN"  (header)
 *    Row: "MAO DE OBRA" | "" | "Unidade" | "Coeficiente" | "Preço" | "Total"
 *    Row: "I0043" | "AJUDANTE DE ENCANADOR" | "H" | 8 | 21.1 | 168.8
 *    ...
 *    Row: "" | "" | "" | "Total Simples:" | "" | 836.05
 *    Row: "" | "" | "" | "Valor Geral:" | "" | 836.05
 *    Row: "C1803 - MURETA C/TIJOLO MACIÇO..." (next composition)
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
    isComposition: boolean;
}

export interface ParsedComposition {
    code: string;
    description: string;
    unit: string;
    totalPrice: number;
    items: ParsedCompositionItem[];
}

async function downloadFile(url: string): Promise<Buffer> {
    console.log(`[SEINFRA Import] ⬇️ Downloading: ${url.split('/').pop()?.split('?')[0]}`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
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

function detectType(code: string, description: string): ParsedInsumo['type'] {
    const desc = (description || '').toUpperCase();
    if (code.startsWith('C')) return 'SERVICO';
    if (desc.includes('PEDREIRO') || desc.includes('SERVENTE') || desc.includes('CARPINTEIRO') ||
        desc.includes('ELETRICIST') || desc.includes('BOMBEIRO') || desc.includes('PINTOR') ||
        desc.includes('ENCANADOR') || desc.includes('SOLDADOR') || desc.includes('ARMADOR') ||
        desc.includes('OPERADOR') || desc.includes('MOTORISTA') || desc.includes('MÃO DE OBRA') ||
        desc.includes('MAO DE OBRA') || desc.includes('AJUDANTE') || desc.includes('ENGENHEIRO') ||
        desc.includes('MESTRE DE OBRA') || desc.includes('APONTADOR') || desc.includes('VIGIA') ||
        desc.includes('TOPÓGRAFO') || desc.includes('TOPOGRAFO') || desc.includes('ALMOXARIFE') ||
        desc.includes('MONTADOR') || desc.includes('SERRALHEIRO') || desc.includes('CALCETEIRO') ||
        desc.includes('MARMORISTA') || desc.includes('VIDRACEIRO') || desc.includes('IMPERMEABILIZADOR')) return 'MAO_DE_OBRA';
    if (desc.includes('BETONEIRA') || desc.includes('COMPACTADOR') || desc.includes('RETRO') ||
        desc.includes('ESCAVADEIRA') || desc.includes('CAMINHÃO') || desc.includes('CAMINHAO') ||
        desc.includes('VIBRADOR') || desc.includes('GUINDASTE') || desc.includes('MÁQUINA') ||
        desc.includes('MAQUINA') || desc.includes('ROLO') || desc.includes('TRATOR') ||
        desc.includes('GUINCHO') || desc.includes('SERRA CIRCULAR') || desc.includes('PERFURATRIZ') ||
        desc.includes('USINA') || desc.includes('GERADOR') || desc.includes('ANDAIME')) return 'EQUIPAMENTO';
    return 'MATERIAL';
}

/**
 * Parse the Insumos Excel file
 * Structure: Código | Descrição | Unidade | Preço (with group headers)
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
            if (!code.match(/^I\d{3,5}$/i) && !code.match(/^\d{4,6}$/)) continue;

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

    console.log(`[SEINFRA Import] 📋 Insumos parsed: ${items.length} from ${workbook.SheetNames.length} sheets`);
    return items;
}

/**
 * Parse the Composições Excel file — V2 format
 * 
 * Each composition starts with a row like:
 *   "C1802 - BOMBA CENTRÍFUGA DE 1/4 CV, INCLUSIVE MAT.DE SUCÇÃO - UN"
 * Followed by group headers ("MAO DE OBRA", "MATERIAIS", "EQUIPAMENTOS")
 * Followed by item rows: I-code | Description | Unit | Coefficient | Price | Total
 * Ends at "Valor Geral:" row
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
            if (!row) continue;

            const col0 = String(row[0] || '').trim();

            // Detect composition header: "C1802 - DESCRIÇÃO - UNIDADE"
            const headerMatch = col0.match(/^(C\d{4,5})\s*-\s*(.+?)\s*-\s*(\w+(?:\.\w+)?)\s*$/);
            if (headerMatch) {
                // Save previous composition
                if (currentComp && currentComp.items.length > 0) {
                    compositions.push(currentComp);
                }

                currentComp = {
                    code: headerMatch[1].toUpperCase(),
                    description: headerMatch[2].trim(),
                    unit: headerMatch[3].trim(),
                    totalPrice: 0,
                    items: [],
                };
                continue;
            }

            // Skip group headers and empty rows
            if (!currentComp) continue;
            if (col0 === 'MAO DE OBRA' || col0 === 'MATERIAIS' || col0 === 'EQUIPAMENTOS' || 
                col0 === 'ATIVIDADES AUXILIARES' || col0 === 'SERVIÇOS' || col0 === 'CUSTOS HORÁRIOS') continue;

            // Detect "Valor Geral:" → captures total price
            const col3 = String(row[3] || '').trim();
            if (col3 === 'Valor Geral:' || col3 === 'Total Simples:') {
                const totalVal = typeof row[5] === 'number' ? row[5] :
                    parseFloat(String(row[5] || '0').replace('.', '').replace(',', '.')) || 0;
                if (col3 === 'Valor Geral:' && totalVal > 0) {
                    currentComp.totalPrice = Math.round(totalVal * 100) / 100;
                }
                continue;
            }

            // Skip "Total:" subtotal rows and "Encargos Sociais:" rows
            const col4 = String(row[4] || '').trim();
            if (col4 === 'Total:' || col3 === 'Encargos Sociais:' || col3 === 'Valor BDI:') continue;

            // Detect item row: I-code or C-code | Description | Unit | Coefficient | Price | Total
            const itemMatch = col0.match(/^([IC]\d{4,5})$/i);
            if (itemMatch) {
                const insumoCode = itemMatch[1].toUpperCase();
                const desc = String(row[1] || '').trim();
                const unit = String(row[2] || '').trim();
                const coefficient = typeof row[3] === 'number' ? row[3] :
                    parseFloat(String(row[3] || '0').replace(',', '.')) || 0;
                const unitPrice = typeof row[4] === 'number' ? row[4] :
                    parseFloat(String(row[4] || '0').replace('.', '').replace(',', '.')) || 0;
                const totalPrice = typeof row[5] === 'number' ? row[5] :
                    parseFloat(String(row[5] || '0').replace('.', '').replace(',', '.')) || 0;

                if (desc && coefficient > 0) {
                    currentComp.items.push({
                        insumoCode,
                        description: desc,
                        unit: unit || 'UN',
                        coefficient,
                        unitPrice,
                        totalPrice: totalPrice || (coefficient * unitPrice),
                        isComposition: insumoCode.startsWith('C'),
                    });
                }
            }
        }

        // Don't forget the last composition
        if (currentComp && currentComp.items.length > 0) {
            compositions.push(currentComp);
        }
    }

    console.log(`[SEINFRA Import] 📋 Composições parsed: ${compositions.length} from ${workbook.SheetNames.length} sheets`);
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

    try {
        const insumosBuffer = await downloadFile(INSUMOS_URL);
        insumos = parseInsumosExcel(insumosBuffer);
    } catch (e: any) {
        errors.push(`Insumos download failed: ${e.message}`);
        console.error('[SEINFRA Import] ❌ Insumos download failed:', e.message);
    }

    try {
        const composBuffer = await downloadFile(COMPOSICOES_URL);
        compositions = parseComposicoesExcel(composBuffer);
    } catch (e: any) {
        errors.push(`Composições download failed: ${e.message}`);
        console.error('[SEINFRA Import] ❌ Composições download failed:', e.message);
    }

    return { insumos, compositions, errors };
}
