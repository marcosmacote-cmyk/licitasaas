import * as XLSX from 'xlsx';
import type { BiddingProcess, CompanyProfile, PriceProposal, ProposalItem } from '../../types';

export function exportExcelProposal(biddingId: string, items: ProposalItem[], bdiPercentage: number) {
    if (items.length === 0) return;

    // Build it row by row.
    const ws = XLSX.utils.aoa_to_sheet([
        ['Item', 'Descrição', 'Marca', 'Modelo', 'Unid', 'Qtd', 'Multiplicador', 'Custo Unit.', 'Preço Unit.', 'Valor Total', '% Peso']
    ]);

    items.forEach((it, i) => {
        const rowIdx = i + 2;
        const row = [
            it.itemNumber || String(i + 1),
            it.description,
            it.brand || '',
            it.model || '',
            it.unit,
            it.quantity,
            it.multiplier,
            it.unitCost,
            { f: `H${rowIdx} * (1 + $M$1/100)` },
            { f: `F${rowIdx} * G${rowIdx} * I${rowIdx}` },
            { f: `J${rowIdx} / $J$${items.length + 2}` }
        ];
        XLSX.utils.sheet_add_aoa(ws, [row], { origin: -1 });
    });

    // Add Totals
    const totalRowIdx = items.length + 2;
    XLSX.utils.sheet_add_aoa(ws, [[null, null, null, null, null, null, null, null, 'TOTAL GLOBAL', { f: `SUM(J2:J${totalRowIdx - 1})` }, '100%']], { origin: -1 });

    // Add BDI Helper in M1
    ws['M1'] = { v: bdiPercentage, t: 'n' };
    ws['L1'] = { v: 'BDI (%)' };

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Proposta');
    XLSX.writeFile(wb, `Proposta_Precos_${biddingId.substring(0, 6)}.xlsx`);
}

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtNum = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function generateProposalPdf(
    proposal: PriceProposal,
    bidding: BiddingProcess,
    company: CompanyProfile | undefined,
    items: ProposalItem[],
    total: number,
    validityDays: number,
    letterContent: string,
    headerImage: string,
    footerImage: string,
    headerImageHeight: number,
    footerImageHeight: number,
    signatureMode: 'LEGAL' | 'TECH' | 'BOTH',
    printLandscape: boolean
) {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        alert('Por favor, permita pop-ups para gerar o PDF.');
        return;
    }

    const totalItemsValue = items.reduce((sum, it) => sum + (it.totalPrice || 0), 0);
    const itemsHtml = items.map((it, i) => {
        const peso = totalItemsValue > 0 ? ((it.totalPrice || 0) / totalItemsValue) * 100 : 0;
        return `
        <tr style="border-bottom: 1px solid #ddd;">
            <td style="padding: 8px; text-align: center;">${it.itemNumber || i + 1}</td>
            <td style="padding: 8px; text-align: justify; hyphens: auto;">${it.description}</td>
            <td style="padding: 8px; text-align: center;">${it.brand || '-'}</td>
            <td style="padding: 8px; text-align: center;">${it.model || '-'}</td>
            <td style="padding: 8px; text-align: center;">${it.unit}</td>
            <td style="padding: 8px; text-align: center;">${fmtNum(it.quantity)}</td>
            <td style="padding: 8px; text-align: right;">${fmt(it.unitPrice)}</td>
            <td style="padding: 8px; text-align: right; font-weight: bold;">${fmt(it.totalPrice)}</td>
            <td style="padding: 8px; text-align: right; font-size: 0.8em; color: #555;">${peso.toFixed(1)}%</td>
        </tr>
    `}).join('');

    const cleanLetter = (letterContent || 'Nenhuma carta proposta redigida.')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/^### (.+)$/gm, '<h4>$1</h4>')
        .replace(/^## (.+)$/gm, '<h3>$1</h3>')
        .replace(/^# (.+)$/gm, '<h2>$1</h2>');

    let derivedCity = company?.city || '';
    let derivedState = company?.state || '';
    let derivedContactName = company?.contactName || '';
    let derivedCpf = company?.contactCpf || '';

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

    // Fix repetition: if city contains state abbreviation, don't repeat it
    if (derivedCity.toUpperCase().endsWith('/' + (derivedState || '').toUpperCase())) {
        derivedState = '';
    }

    const locParts = [derivedCity, derivedState].filter(Boolean).join('/');
    const localData = locParts
        ? `${locParts}, ${new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())}`
        : new Intl.DateTimeFormat('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());

    const topMargin = headerImage ? (headerImageHeight + 20) : 0;
    const bottomMargin = footerImage ? (footerImageHeight + 30) : 0;

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
                .fixed-footer .gen-info { font-size: 9px; color: #999; margin-top: 2px; }
                .content-wrapper { padding: 15px 20px; }
                .text-header { text-align: center; border-bottom: 2px solid #222; padding-bottom: 12px; margin-bottom: 15px; }
                .text-header h1 { margin: 0; font-size: 20px; color: #000; }
                .text-header p { margin: 3px 0; color: #444; font-size: 12px; }
                .letter { white-space: pre-wrap; margin-bottom: 25px; text-align: justify; font-size: 13px; line-height: 1.5; }
                table.items { width: 100%; border-collapse: collapse; margin-bottom: 15px; font-size: 11px; }
                table.items th { border-bottom: 2px solid #222; padding: 6px 4px; text-align: left; background: #f5f5f5; font-size: 11px; }
                table.items td { padding: 5px 4px; border-bottom: 1px solid #ddd; font-size: 11px; }
                .totals { width: 300px; float: right; margin-top: 10px; }
                .totals tr th, .totals tr td { padding: 6px; text-align: right; border-bottom: 1px solid #ddd; font-size: 12px; }
                .signature-block { text-align: center; page-break-inside: avoid; clear: both; margin-top: 40px; }
                .signature-block .sig-item { display: inline-block; width: 45%; vertical-align: top; text-align: center; font-size: 12px; }
                table.print-wrapper { width: 100%; border: none; border-collapse: collapse; }
                table.print-wrapper > thead > tr > td { height: ${topMargin > 0 ? topMargin : 0}px; border: none; padding: 0; }
                table.print-wrapper > tfoot > tr > td { height: ${bottomMargin > 0 ? bottomMargin : 0}px; border: none; padding: 0; }
                table.print-wrapper > tbody > tr > td { border: none; padding: 0; vertical-align: top; }
                .no-print { }
                @media print {
                    .no-print { display: none !important; }
                    body { font-size: 12px; }
                    .content-wrapper { padding: 0; }
                    @page { size: ${printLandscape ? 'landscape' : 'portrait'}; margin: 0.8cm 1cm; }
                }
            </style>
        </head>
        <body>
            <button class="no-print" onclick="window.print()" style="padding: 10px 20px; margin-left: 20px; margin-top: 20px; font-weight: bold; cursor: pointer; border-radius: 6px; background: #2563eb; color: #fff; border: none; font-size: 13px;">🖨️ Imprimir / Salvar PDF</button>
            ${headerImage ? `
            <div class="fixed-header"><img src="${headerImage}" alt="Cabeçalho" style="max-height: ${headerImageHeight}px;" /></div>
            ` : ''}
            ${footerImage ? `
            <div class="fixed-footer">
                <img src="${footerImage}" alt="Rodapé" style="max-height: ${footerImageHeight}px;" />
                <div class="gen-info">Documento gerado em ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR')}.</div>
            </div>
            ` : ''}
            <table class="print-wrapper">
                <thead><tr><td></td></tr></thead>
                <tfoot><tr><td></td></tr></tfoot>
                <tbody><tr><td>
                    <div class="content-wrapper">
            ${!headerImage ? `
            <div class="text-header">
                <h1>${company?.razaoSocial || 'EMPRESA PROPONENTE'}</h1>
                <p>CNPJ: ${company?.cnpj || 'Não informado'} | Proposta V${proposal.version}</p>
            </div>
            ` : ''}

            <div class="letter">${cleanLetter}</div>

            <h3 style="font-size: 14px; margin-bottom: 10px;">Planilha de Formação de Preços</h3>
            <table class="items">
                <thead>
                    <tr>
                        <th style="text-align:center; width: 60px;">Lote/Item</th>
                        <th>Descrição detalhada</th>
                        <th style="text-align:center; width: 55px;">Marca</th>
                        <th style="text-align:center; width: 55px;">Modelo</th>
                        <th style="text-align:center; width: 35px;">Unid</th>
                        <th style="text-align:center; width: 45px;">Qtd</th>
                        <th style="text-align:right; width: 75px;">Valor Unit.</th>
                        <th style="text-align:right; width: 85px;">Valor Total</th>
                        <th style="text-align:right; width: 40px;">% Peso</th>
                    </tr>
                </thead>
                <tbody>${itemsHtml}</tbody>
            </table>

            <table class="totals">
                <tbody>
                    <tr><th>Valor Total Global</th><td>${fmt(total)}</td></tr>
                    <tr><th style="font-weight: normal; color: #555;">Validade da Proposta</th><td style="font-weight: normal; color: #555;">${validityDays} dias</td></tr>
                </tbody>
            </table>
            
            <div style="text-align: right; margin-top: 35px; margin-bottom: 30px; font-size: 13px; clear: both;">
                ${localData}
            </div>

            <div class="signature-block">
                ${(signatureMode === 'LEGAL' || signatureMode === 'BOTH') ? `
                    <div class="sig-item">
                        <div style="margin-bottom: 50px;"></div>
                        ___________________________________<br/>
                        <strong>${derivedContactName || 'Representante Legal'}</strong><br/>
                        ${derivedCpf ? 'CPF: ' + derivedCpf + '<br/>' : ''}
                        Representante Legal<br/>
                        ${company?.razaoSocial || ''}<br/>
                        ${company?.cnpj ? 'CNPJ: ' + company.cnpj : ''}
                    </div>
                ` : ''}
                ${(signatureMode === 'TECH' || signatureMode === 'BOTH') ? `
                    <div class="sig-item">
                        <div style="margin-bottom: 50px;"></div>
                        ___________________________________<br/>
                        <strong>Responsável Técnico</strong><br/>
                        ${company?.razaoSocial || ''}<br/>
                        ${company?.cnpj ? 'CNPJ: ' + company.cnpj : ''}
                    </div>
                ` : ''}
            </div>
            
            ${!footerImage ? `
            <div style="margin-top: 60px; text-align: center; border-top: 1px solid #ddd; padding-top: 15px; font-size: 10px; color: #888; clear: both;">
                Documento gerado pelo LicitaSaaS em ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR')}.
            </div>
            ` : ''}
            
                    </div>
                </td></tr></tbody>
            </table>
        </body>
        </html>
    `;
    printWindow.document.write(html);
    printWindow.document.close();
}
