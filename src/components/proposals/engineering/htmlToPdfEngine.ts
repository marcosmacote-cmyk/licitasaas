/**
 * htmlToPdfEngine.ts — Converte HTML para PDF nativo via jsPDF + html2canvas
 * 
 * Estratégia: Extrai header/footer do HTML, captura apenas o conteúdo
 * do corpo, e compõe cada página do PDF com header no topo e footer
 * na base — tudo programaticamente via jsPDF.
 * Download direto, sem janela de impressão.
 */
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';

export interface HtmlToPdfOptions {
    /** HTML completo do documento */
    html: string;
    /** Nome do arquivo PDF (sem extensão) */
    filename: string;
    /** Orientação: portrait ou landscape */
    orientation?: 'portrait' | 'landscape';
    /** Escala de renderização (default: 2 para alta resolução) */
    scale?: number;
}

/** Captura um elemento HTML invisível como canvas */
async function captureElement(
    parentDoc: Document,
    htmlContent: string,
    width: number,
    scale: number
): Promise<HTMLCanvasElement | null> {
    if (!htmlContent.trim()) return null;

    const container = parentDoc.createElement('div');
    container.style.cssText = `position:absolute;left:-9999px;top:0;width:${width}px;background:#fff;`;
    container.innerHTML = htmlContent;
    parentDoc.body.appendChild(container);

    // Esperar imagens carregarem
    await Promise.all(
        Array.from(container.querySelectorAll('img')).map(img =>
            (img as HTMLImageElement).complete
                ? Promise.resolve()
                : new Promise(r => { img.onload = r; img.onerror = r; })
        )
    );
    await new Promise(r => setTimeout(r, 100));

    const canvas = await html2canvas(container, {
        scale,
        useCORS: true,
        allowTaint: true,
        logging: false,
        width,
    });

    parentDoc.body.removeChild(container);
    return canvas;
}

/**
 * Converte HTML completo em PDF e faz download direto.
 * Extrai header/footer, captura conteúdo, compõe PDF multi-página.
 */
export async function htmlToPdf(options: HtmlToPdfOptions): Promise<void> {
    const { html, filename, orientation = 'portrait', scale = 2 } = options;

    // ── 1. Extrair header, footer e conteúdo do HTML ──
    const headerMatch = html.match(/<div class="fixed-header"[^>]*>([\s\S]*?)<\/div>\s*(?=<div class="fixed-footer"|<table class="print-wrapper")/);
    const footerMatch = html.match(/<div class="fixed-footer"[^>]*>([\s\S]*?)<\/div>\s*(?=<table class="print-wrapper")/);

    const headerHtml = headerMatch ? headerMatch[0] : '';
    const footerHtml = footerMatch ? footerMatch[0] : '';

    // Build content-only HTML: strip fixed-header, fixed-footer, no-print button
    let contentHtml = html
        .replace(/<div class="fixed-header"[^>]*>[\s\S]*?<\/div>\s*(?=<div class="fixed-footer"|<table class="print-wrapper")/, '')
        .replace(/<div class="fixed-footer"[^>]*>[\s\S]*?<\/div>\s*(?=<table class="print-wrapper")/, '')
        .replace(/<div class="no-print"[^>]*>[\s\S]*?<\/div>\s*<\/body>/, '</body>')
        // Remove spacer rows in print-wrapper since we handle margins programmatically
        .replace(/<thead><tr><td[^>]*><\/td><\/tr><\/thead>/, '')
        .replace(/<tfoot><tr><td[^>]*><\/td><\/tr><\/tfoot>/, '');

    // ── 2. Setup dimensions (mm) ──
    const isLandscape = orientation === 'landscape';
    const pageWidthMm = isLandscape ? 297 : 210;
    const pageHeightMm = isLandscape ? 210 : 297;
    const marginX = 8; // mm lateral margins
    const marginY = 5; // mm top/bottom page margins
    const contentWidthMm = pageWidthMm - (marginX * 2);

    // Pixel width for rendering (A4 at 96dpi)
    const renderWidthPx = isLandscape ? 1123 : 794;

    // ── 3. Criar iframe oculto ──
    const iframe = document.createElement('iframe');
    iframe.style.cssText = `position:fixed;left:-9999px;top:0;width:${renderWidthPx}px;height:2000px;border:none;opacity:0;pointer-events:none;`;
    document.body.appendChild(iframe);

    try {
        const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
        if (!iframeDoc) throw new Error('Falha ao acessar iframe');

        // ── 4. Capturar header e footer separadamente ──
        // Write a base doc so styles are available
        iframeDoc.open();
        iframeDoc.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>
            * { margin:0; padding:0; box-sizing:border-box; }
            body { font-family:'Segoe UI',Arial,sans-serif; font-size:10px; color:#1a1a2e; background:#fff; }
            img { max-width:100%; height:auto; display:block; margin:0 auto; }
        </style></head><body></body></html>`);
        iframeDoc.close();

        const headerCanvas = await captureElement(
            iframeDoc,
            headerHtml.replace(/class="fixed-header"/, 'style="text-align:center;padding:6px 15px 4px;border-bottom:1px solid #cbd5e1;background:#fff;"'),
            renderWidthPx,
            scale
        );

        const footerCanvas = await captureElement(
            iframeDoc,
            footerHtml.replace(/class="fixed-footer"/, 'style="text-align:center;padding:4px 15px 6px;border-top:1px solid #cbd5e1;background:#fff;"'),
            renderWidthPx,
            scale
        );

        // Calculate header/footer heights in mm
        const headerHeightMm = headerCanvas
            ? (headerCanvas.height / headerCanvas.width) * contentWidthMm
            : 0;
        const footerHeightMm = footerCanvas
            ? (footerCanvas.height / footerCanvas.width) * contentWidthMm
            : 0;

        const bodyTopMm = marginY + headerHeightMm + (headerHeightMm > 0 ? 2 : 0);
        const bodyBottomMm = marginY + footerHeightMm + (footerHeightMm > 0 ? 2 : 0);
        const bodyHeightMm = pageHeightMm - bodyTopMm - bodyBottomMm;

        // ── 5. Capturar conteúdo do body ──
        // Rewrite iframe with content-only HTML
        iframeDoc.open();
        iframeDoc.write(contentHtml);
        iframeDoc.close();

        await new Promise(r => setTimeout(r, 300));
        await Promise.all(
            Array.from(iframeDoc.images).map(img =>
                img.complete ? Promise.resolve() : new Promise(r => { img.onload = r; img.onerror = r; })
            )
        );

        const bodyCanvas = await html2canvas(iframeDoc.body, {
            scale,
            useCORS: true,
            allowTaint: true,
            logging: false,
            windowWidth: renderWidthPx,
        });

        // ── 6. Compor PDF multi-página ──
        const pdf = new jsPDF({
            orientation: isLandscape ? 'l' : 'p',
            unit: 'mm',
            format: 'a4',
        });

        // Body image total height in mm
        const bodyImgTotalMm = (bodyCanvas.height / bodyCanvas.width) * contentWidthMm;
        const totalPages = Math.max(1, Math.ceil(bodyImgTotalMm / bodyHeightMm));

        for (let page = 0; page < totalPages; page++) {
            if (page > 0) pdf.addPage();

            // ── Draw header on this page ──
            if (headerCanvas) {
                const hdrData = headerCanvas.toDataURL('image/png');
                pdf.addImage(hdrData, 'PNG', marginX, marginY, contentWidthMm, headerHeightMm);
            }

            // ── Draw body slice for this page ──
            const sliceStartMm = page * bodyHeightMm;
            const sliceHeightMm = Math.min(bodyHeightMm, bodyImgTotalMm - sliceStartMm);

            if (sliceHeightMm > 0) {
                // Source coordinates in canvas pixels
                const srcY = (sliceStartMm / bodyImgTotalMm) * bodyCanvas.height;
                const srcH = (sliceHeightMm / bodyImgTotalMm) * bodyCanvas.height;
                const actualSrcH = Math.min(srcH, bodyCanvas.height - srcY);

                // Create slice canvas
                const sliceCanvas = document.createElement('canvas');
                sliceCanvas.width = bodyCanvas.width;
                sliceCanvas.height = Math.max(1, Math.round(actualSrcH));
                const ctx = sliceCanvas.getContext('2d')!;
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
                ctx.drawImage(bodyCanvas, 0, srcY, bodyCanvas.width, actualSrcH, 0, 0, bodyCanvas.width, sliceCanvas.height);

                const sliceData = sliceCanvas.toDataURL('image/jpeg', 0.92);
                const actualSliceMm = (sliceCanvas.height / sliceCanvas.width) * contentWidthMm;
                pdf.addImage(sliceData, 'JPEG', marginX, bodyTopMm, contentWidthMm, actualSliceMm);
            }

            // ── Draw footer on this page ──
            if (footerCanvas) {
                const ftrData = footerCanvas.toDataURL('image/png');
                const footerY = pageHeightMm - marginY - footerHeightMm;
                pdf.addImage(ftrData, 'PNG', marginX, footerY, contentWidthMm, footerHeightMm);
            }
        }

        // ── 7. Download direto ──
        pdf.save(`${filename}.pdf`);
    } finally {
        document.body.removeChild(iframe);
    }
}
