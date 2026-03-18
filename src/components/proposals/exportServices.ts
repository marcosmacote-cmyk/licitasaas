import * as XLSX from 'xlsx';
import type { BiddingProcess, CompanyProfile, ProposalItem } from '../../types';
import type { RoundingMode } from './engine';

export function exportExcelProposal(biddingId: string, items: ProposalItem[], bdiPercentage: number, discountPercentage: number = 0, roundingMode: RoundingMode = 'ROUND') {
    if (items.length === 0) return;

    const ws = XLSX.utils.aoa_to_sheet([
        ['Item', 'Descrição', 'Marca', 'Modelo', 'Unid', 'Qtd', 'Multiplicador', 'Custo Unit.', 'Preço Unit.', 'Valor Total', '% Peso']
    ]);

    items.forEach((it, i) => {
        const rowIdx = i + 2;
        // Formula in Excel for unitPrice: Cost * (1 + BDI/100) * (1 - DISC/100)
        const roundFormula = roundingMode === 'ROUND' ? 'ROUND' : 'TRUNC';
        const row = [
            it.itemNumber || String(i + 1),
            it.description,
            it.brand || '',
            it.model || '',
            it.unit,
            it.quantity,
            it.multiplier,
            it.unitCost,
            { f: `${roundFormula}(H${rowIdx} * (1 + $M$1/100) * (1 - $O$1/100) * (1 - ${it.discountPercentage || 0}/100), 2)` }, // Uses item discount if set, plus linear discount
            { f: `ROUND(F${rowIdx} * G${rowIdx} * I${rowIdx}, 2)` },
            { f: `J${rowIdx} / $J$${items.length + 2}` }
        ];
        XLSX.utils.sheet_add_aoa(ws, [row], { origin: -1 });
    });

    const totalRowIdx = items.length + 2;
    XLSX.utils.sheet_add_aoa(ws, [[null, null, null, null, null, null, null, null, 'TOTAL GLOBAL', { f: `SUM(J2:J${totalRowIdx - 1})` }, '100%']], { origin: -1 });

    ws['M1'] = { v: bdiPercentage, t: 'n' };
    ws['L1'] = { v: 'BDI (%)' };
    ws['O1'] = { v: discountPercentage, t: 'n' };
    ws['N1'] = { v: 'Desc Lin (%)' };

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Proposta');
    XLSX.writeFile(wb, `Proposta_Precos_${biddingId.substring(0, 6)}.xlsx`);
}

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtNum = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * @deprecated Use LetterPdfExporter.export() for block-based export.
 * This function is kept for backward compatibility with the quick-print buttons.
 */
export function generateProposalPdf(
    bidding: BiddingProcess,
    company: CompanyProfile | undefined,
    items: ProposalItem[],
    validityDays: number,
    letterContent: string,
    headerImage: string,
    footerImage: string,
    headerImageHeight: number,
    footerImageHeight: number,
    signatureMode: 'LEGAL' | 'TECH' | 'BOTH',
    printLandscape: boolean,
    _discountPercentage: number = 0,
    exportType: 'FULL' | 'LETTER' | 'SPREADSHEET' = 'FULL'
) {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        console.warn('Pop-up blocked by browser. Please allow pop-ups to generate the PDF.');
        return;
    }

    const totalItemsValue = items.reduce((sum, it) => sum + (it.totalPrice || 0), 0);
    const itemsHtml = items.map((it, i) => {
        const peso = totalItemsValue > 0 ? ((it.totalPrice || 0) / totalItemsValue) * 100 : 0;
        return `
        <tr style="border-bottom: 1px solid #ddd;">
            <td style="padding: 4px 6px; text-align: center;">${it.itemNumber || i + 1}</td>
            <td style="padding: 4px 6px; text-align: justify; hyphens: auto;">${it.description}</td>
            <td style="padding: 4px 6px; text-align: center;">${it.brand || '-'}</td>
            <td style="padding: 4px 6px; text-align: center;">${it.model || '-'}</td>
            <td style="padding: 4px 6px; text-align: center; white-space: nowrap;">${it.unit}</td>
            <td style="padding: 4px 6px; text-align: center; white-space: nowrap;">${fmtNum(it.quantity)}</td>
            <td style="padding: 4px 6px; text-align: center;">${it.multiplier > 1 ? it.multiplier : '1'}</td>
            <td style="padding: 4px 6px; text-align: right; white-space: nowrap;">${fmt(it.unitPrice)}</td>
            <td style="padding: 4px 6px; text-align: right; font-weight: bold; white-space: nowrap;">${fmt(it.totalPrice)}</td>
            <td style="padding: 4px 6px; text-align: right; font-size: 0.8em; color: #555;">${peso.toFixed(1)}%</td>
        </tr>
    `}).join('');

    const finalTotal = totalItemsValue; // Discount is already in unit prices
    // Desconto total efetivo: diferença entre referência total e total real
    const refTotal = items.reduce((sum, it) => sum + ((it.quantity || 0) * (it.multiplier || 1) * (it.referencePrice || it.unitCost || 0)), 0);
    const totalDiscountPct = refTotal > 0 ? ((refTotal - finalTotal) / refTotal * 100) : 0;

    let letterHtml = (letterContent || 'Nenhuma carta proposta redigida.');
    const qualificationText = company?.qualification || '';

    // Integrated qualification context
    if (letterHtml.includes('[IDENTIFICACAO]')) {
        letterHtml = letterHtml.replace('[IDENTIFICACAO]', qualificationText);
    } else if (qualificationText) {
        // Fallback: if tag not present, prepend to first paragraph
        letterHtml = qualificationText + '\n\n' + letterHtml;
    }

    const cleanLetter = letterHtml
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/^### (.+)$/gm, '<h4>$1</h4>')
        .replace(/^## (.+)$/gm, '<h3>$1</h3>')
        .replace(/^# (.+)$/gm, '<h2>$1</h2>');

    let derivedCity = company?.city || '';
    let derivedState = company?.state || '';
    let derivedContactName = company?.contactName || '';
    let derivedCpf = company?.contactCpf || '';

    // Se o contactName contém CPF embutido, separar
    if (derivedContactName && /CPF/i.test(derivedContactName)) {
        const cpfInName = derivedContactName.match(/CPF[:\s]*([0-9]{3}\.?[0-9]{3}\.?[0-9]{3}-?[0-9]{2})/i);
        if (cpfInName) {
            if (!derivedCpf) derivedCpf = cpfInName[1];
            derivedContactName = derivedContactName.replace(/\s*CPF[:\s]*[0-9]{3}\.?[0-9]{3}\.?[0-9]{3}-?[0-9]{2}/i, '').trim();
        }
    }

    if (company?.qualification) {
        const qual = company.qualification;
        if (!derivedCity) {
            const cityMatch = qual.match(/,\s*([^,.(0-9\-]{3,30})\s*[/|-]\s*([A-Z]{2})(?=\s*,|\s+CEP|\s+inscrita|\s*neste|$)/i);
            if (cityMatch) {
                derivedCity = cityMatch[1].trim();
                derivedState = cityMatch[2].trim();
            }
        }
        if (!derivedCpf) {
            const cpfMatch = qual.match(/[0-9]{3}\.?[0-9]{3}\.?[0-9]{3}-?[0-9]{2}/);
            if (cpfMatch && cpfMatch[0].length <= 14) {
                derivedCpf = cpfMatch[0];
            }
        }
    }

    if (derivedCity.toUpperCase().endsWith('/' + (derivedState || '').toUpperCase())) {
        derivedState = '';
    }

    const locParts = [derivedCity, derivedState].filter(Boolean).join('/');
    const localData = locParts
        ? `${locParts}, ${new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date())}`
        : new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date());

    const topMargin = headerImage ? (headerImageHeight + 20) : 100; // default for text header
    const bottomMargin = footerImage ? (footerImageHeight + 30) : 80;

    const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <title>Proposta Comercial - ${bidding.title}</title>
            <style>
                body { font-family: 'Arial', sans-serif; color: #111; line-height: 1.5; font-size: 13px; margin: 0; padding: 0; }
                .fixed-header { position: fixed; top: 0; left: 0; right: 0; text-align: center; background: #fff; z-index: 100; padding: 0; }
                .fixed-header img { max-width: 100%; height: auto; display: block; margin: 0 auto; }
                .fixed-footer { position: fixed; bottom: 0; left: 0; right: 0; text-align: center; background: #fff; z-index: 100; padding: 0; }
                .fixed-footer img { max-width: 100%; height: auto; display: block; margin: 0 auto; }
                .fixed-footer .gen-info { font-size: 8px; color: #999; margin-top: 2px; }
                .content-wrapper { padding: 15px 20px; }
                .letter { white-space: pre-wrap; margin-bottom: 25px; text-align: justify; font-size: 13px; line-height: 1.5; }
                table.items { width: 100%; border-collapse: collapse; margin-bottom: 15px; font-size: 10px; table-layout: auto; }
                table.items th { border-bottom: 2px solid #222; padding: 6px 4px; text-align: left; background: #f5f5f5; font-size: 10px; overflow: hidden; }
                table.items td { padding: 4px 6px; border-bottom: 1px solid #ddd; font-size: 10px; word-wrap: break-word; overflow: visible; font-weight: normal; }
                .totals { width: 250px; margin-left: auto; margin-top: 10px; page-break-inside: avoid; }
                .totals tr th, .totals tr td { padding: 4px; text-align: right; border-bottom: 1px solid #ddd; font-size: 11px; }
                .signature-block { text-align: center; page-break-inside: avoid; clear: both; margin-top: 40px; }
                .signature-block .sig-item { display: inline-block; width: 45%; vertical-align: top; text-align: center; font-size: 12px; }
                table.print-wrapper { width: 100%; border: none; border-collapse: collapse; }
                table.print-wrapper > thead > tr > td { height: ${topMargin}px; border: none; padding: 0; }
                table.print-wrapper > tfoot > tr > td { height: ${bottomMargin}px; border: none; padding: 0; }
                table.print-wrapper > tbody > tr > td { border: none; padding: 0; vertical-align: top; }
                @media print {
                    body { font-size: 12px; }
                    .content-wrapper { padding: 0; }
                    @page { size: ${printLandscape ? 'landscape' : 'portrait'}; margin: 0.8cm 1cm; }
                }
            </style>
        </head>
        <body>
            <script>
                window.onload = function() {
                    setTimeout(() => { window.print(); }, 500);
                };
            </script>
            
            <div class="fixed-header">
                ${headerImage ? `
                    <img src="${headerImage}" alt="Cabeçalho" style="max-height: ${headerImageHeight}px;" />
                ` : `
                    <div style="border-bottom: 2px solid #222; padding: 20px 0; margin: 0 40px;">
                        <h1 style="margin: 0; font-size: 20px;">${company?.razaoSocial || 'EMPRESA PROPONENTE'}</h1>
                        <p style="margin: 5px 0; font-weight: bold;">CNPJ: ${company?.cnpj || '-'}</p>
                    </div>
                `}
            </div>

            <div class="fixed-footer">
                ${footerImage ? `
                    <img src="${footerImage}" alt="Rodapé" style="max-height: ${footerImageHeight}px;" />
                ` : `
                    <div style="border-top: 1px solid #ddd; padding: 10px 0; font-size: 10px; color: #444; margin: 0 40px;">
                        ${company?.address || 'Endereço não informado'}<br/>
                        ${company?.contactEmail || ''} ${company?.contactPhone ? ' | Tel: ' + company.contactPhone : ''}
                    </div>
                `}
                <div class="gen-info">Documento gerado em ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR')}.</div>
            </div>

            <table class="print-wrapper">
                <thead><tr><td></td></tr></thead>
                <tfoot><tr><td></td></tr></tfoot>
                <tbody><tr><td>
                    <div class="content-wrapper">
            
            ${(exportType === 'FULL' || exportType === 'LETTER') ? `<div class="letter">${cleanLetter}</div>` : ''}

            ${(exportType === 'FULL' || exportType === 'SPREADSHEET') ? `
            <h3 style="font-size: 14px; margin-bottom: 10px;">${exportType === 'SPREADSHEET' ? 'Planilha de Preços' : 'Planilha de Formação de Preços'}</h3>
            <table class="items">
                <thead>
                    <tr>
                        <th style="text-align:center; width: 35px;">Item</th>
                        <th style="width: auto;">Descrição detalhada</th>
                        <th style="text-align:center; width: 55px;">Marca</th>
                        <th style="text-align:center; width: 55px;">Modelo</th>
                        <th style="text-align:center; width: 35px;">Unid</th>
                        <th style="text-align:center; width: 45px;">Qtd</th>
                        <th style="text-align:center; width: 28px;">Mult.</th>
                        <th style="text-align:right; width: 75px;">Unitário</th>
                        <th style="text-align:right; width: 85px;">Total</th>
                        <th style="text-align:right; width: 35px;">%</th>
                    </tr>
                </thead>
                <tbody>${itemsHtml}</tbody>
            </table>

            <table class="totals">
                <tbody>
                    <tr><th style="font-size: 1.1em;">TOTAL GLOBAL</th><td style="font-size: 1.1em; font-weight: bold;">${fmt(finalTotal)}</td></tr>
                    ${totalDiscountPct > 0 ? `<tr><th style="font-weight: normal; color: #555;">Desconto Total</th><td style="font-weight: normal; color: #555;">${fmtNum(totalDiscountPct)}%</td></tr>` : ''}
                    <tr><th style="font-weight: normal; color: #555;">Validade</th><td style="font-weight: normal; color: #555;">${validityDays} dias</td></tr>
                </tbody>
            </table>
            ` : ''}
            
            <div style="clear: both; margin-top: 50px;">
                <div style="text-align: right; font-size: 13px;">${localData}</div>
                <div style="text-align: left; font-size: 13px; margin-top: 20px;">Atenciosamente,</div>
            </div>

            <div class="signature-block">
                ${(() => {
                    // Limpar razão social (remover CNPJ embutido se houver)
                    let razao = (company?.razaoSocial || '').toUpperCase();
                    const cnpjInRazao = razao.match(/\s*CNPJ[:\s]*([\d./-]+)/i);
                    let cnpjVal = company?.cnpj || '';
                    if (cnpjInRazao) {
                        if (!cnpjVal) cnpjVal = cnpjInRazao[1];
                        razao = razao.replace(/\s*CNPJ[:\s]*[\d./-]+/i, '').trim();
                    }
                    
                    const legalHtml = (signatureMode === 'LEGAL' || signatureMode === 'BOTH') ? `
                        <div class="sig-item">
                            <div style="margin-bottom: 50px;"></div>
                            ___________________________________<br/>
                            <strong>${derivedContactName || 'Representante Legal'}</strong><br/>
                            ${derivedCpf ? 'CPF: ' + derivedCpf + '<br/>' : ''}
                            Representante Legal<br/>
                            ${razao}<br/>
                            ${cnpjVal ? 'CNPJ: ' + cnpjVal : ''}
                        </div>
                    ` : '';
                    
                    const techHtml = (signatureMode === 'TECH' || signatureMode === 'BOTH') ? `
                        <div class="sig-item">
                            <div style="margin-bottom: 50px;"></div>
                            ___________________________________<br/>
                            <strong>Responsável Técnico</strong><br/>
                            ${razao}<br/>
                            ${cnpjVal ? 'CNPJ: ' + cnpjVal : ''}
                        </div>
                    ` : '';
                    
                    return legalHtml + techHtml;
                })()}
            </div>
            
                    </div>
                </td></tr></tbody>
            </table>
        </body>
        </html>
    `;
    printWindow.document.write(html);
    printWindow.document.close();
}
