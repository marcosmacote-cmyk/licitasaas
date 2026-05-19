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

        // Expand iframe to fit full content height (critical for large documents like Proposta Completa)
        const bodyScrollH = iframeDoc.body.scrollHeight || iframeDoc.documentElement.scrollHeight || 2000;
        iframe.style.height = `${Math.max(bodyScrollH + 200, 2000)}px`;
        await new Promise(r => setTimeout(r, 150)); // allow reflow

        const bodyCanvas = await html2canvas(iframeDoc.body, {
            scale,
            useCORS: true,
            allowTaint: true,
            logging: false,
            windowWidth: renderWidthPx,
            height: bodyScrollH, // explicitly set capture height
        });

        // ── Diagnostic logging for PDF debugging ──
        const bodyEl = iframeDoc.body;
        console.log('[PDF Engine] contentHtml length:', contentHtml.length);
        console.log('[PDF Engine] iframe body dimensions:', bodyEl.scrollWidth, 'x', bodyEl.scrollHeight);
        console.log('[PDF Engine] bodyCanvas dimensions:', bodyCanvas.width, 'x', bodyCanvas.height);
        // Check if canvas has any non-white pixels (sample first 10000 pixels)
        const diagCtx = bodyCanvas.getContext('2d');
        if (diagCtx) {
            const sample = diagCtx.getImageData(0, 0, Math.min(bodyCanvas.width, 200), Math.min(bodyCanvas.height, 200));
            let nonWhite = 0;
            for (let i = 0; i < sample.data.length; i += 4) {
                if (sample.data[i] < 250 || sample.data[i+1] < 250 || sample.data[i+2] < 250) nonWhite++;
            }
            console.log('[PDF Engine] Non-white pixels in 200x200 sample:', nonWhite, '/', sample.data.length / 4);
        }

        // ── 6. Smart page composition with row-boundary detection ──
        const pdf = new jsPDF({
            orientation: isLandscape ? 'l' : 'p',
            unit: 'mm',
            format: 'a4',
        });

        const bodyImgTotalMm = (bodyCanvas.height / bodyCanvas.width) * contentWidthMm;
        const pxPerMm = bodyCanvas.height / bodyImgTotalMm;
        const safeBodyHeightMm = bodyHeightMm - 2; // safety buffer
        const maxSlicePx = Math.floor(safeBodyHeightMm * pxPerMm);

        // ── Row-boundary scanner ──
        // Scans the canvas for horizontal rows that are "safe" to break at
        // (white/light-gray uniform rows indicating gaps between table rows)
        const canvasWidth = bodyCanvas.width;
        const canvasHeight = bodyCanvas.height;
        const imgData = bodyCanvas.getContext('2d')!.getImageData(0, 0, canvasWidth, canvasHeight);
        const pixels = imgData.data;

        /**
         * Check if a horizontal pixel row is a "safe break" point.
         * A safe row is one where the vast majority of pixels are white/very light
         * (indicating whitespace between table rows, not mid-text).
         * We sample every 4th pixel across the row for performance.
         */
        function isRowSafe(y: number): boolean {
            if (y < 0 || y >= canvasHeight) return false;
            let lightPixels = 0;
            const sampleStep = 4;
            const totalSamples = Math.floor(canvasWidth / sampleStep);
            for (let x = 0; x < canvasWidth; x += sampleStep) {
                const idx = (y * canvasWidth + x) * 4;
                const r = pixels[idx], g = pixels[idx + 1], b = pixels[idx + 2];
                // Consider pixel "light" if all channels > 230 (near-white)
                if (r > 230 && g > 230 && b > 230) lightPixels++;
            }
            // Safe if >90% of sampled pixels are light
            return (lightPixels / totalSamples) > 0.90;
        }

        /**
         * Find the best safe break point at or before targetY.
         * Searches backwards from targetY up to `searchRange` pixels.
         * A safe break needs at least 2 consecutive safe rows for reliability.
         */
        function findSafeBreak(targetY: number, searchRange: number = 200): number {
            const clampedTarget = Math.min(targetY, canvasHeight - 1);
            // Search backwards for a safe row
            for (let y = clampedTarget; y > clampedTarget - searchRange && y > 0; y--) {
                if (isRowSafe(y) && isRowSafe(y - 1)) {
                    return y;
                }
            }
            // No safe break found — fallback to target (will cut through content)
            return clampedTarget;
        }

        // ── Build page break positions ──
        const breakPositions: number[] = [0]; // start of first page
        let currentY = 0;

        while (currentY < canvasHeight) {
            const idealEnd = currentY + maxSlicePx;
            if (idealEnd >= canvasHeight) {
                // Last page — no need to find break
                break;
            }
            // Find nearest safe row boundary at or before the ideal cut point
            const safeBreakY = findSafeBreak(idealEnd);
            breakPositions.push(safeBreakY);
            currentY = safeBreakY;
        }

        const totalPages = breakPositions.length;

        // Pre-cache header/footer data URLs
        const hdrData = headerCanvas ? headerCanvas.toDataURL('image/png') : null;
        const ftrData = footerCanvas ? footerCanvas.toDataURL('image/png') : null;

        for (let page = 0; page < totalPages; page++) {
            if (page > 0) pdf.addPage();

            // ── Draw header ──
            if (hdrData) {
                pdf.addImage(hdrData, 'PNG', marginX, marginY, contentWidthMm, headerHeightMm);
            }

            // ── Draw body slice ──
            const sliceStartPx = breakPositions[page];
            const sliceEndPx = page < totalPages - 1 ? breakPositions[page + 1] : canvasHeight;
            const sliceHeightPx = sliceEndPx - sliceStartPx;

            if (sliceHeightPx > 0) {
                const sliceCanvas = document.createElement('canvas');
                sliceCanvas.width = canvasWidth;
                sliceCanvas.height = sliceHeightPx;
                const ctx = sliceCanvas.getContext('2d')!;
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, canvasWidth, sliceHeightPx);
                ctx.drawImage(bodyCanvas, 0, sliceStartPx, canvasWidth, sliceHeightPx, 0, 0, canvasWidth, sliceHeightPx);

                const sliceData = sliceCanvas.toDataURL('image/jpeg', 0.92);
                const sliceHeightMm = (sliceHeightPx / canvasWidth) * contentWidthMm;
                pdf.addImage(sliceData, 'JPEG', marginX, bodyTopMm, contentWidthMm, sliceHeightMm);
            }

            // ── Draw footer ──
            if (ftrData) {
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
