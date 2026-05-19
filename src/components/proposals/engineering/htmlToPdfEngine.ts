/**
 * htmlToPdfEngine.ts — Converte HTML para PDF nativo via jsPDF + html2canvas
 * 
 * Estratégia: Usa DOM parsing (não regex) para extrair header/footer do HTML.
 * Captura o corpo em um iframe SEPARADO e fresco para cada seção individual,
 * evitando estouro de tamanho de canvas no navegador.
 * Compõe cada página do PDF com header no topo e footer na base via jsPDF.
 * Download direto ou retorno de Blob para ZIP.
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
    /** Modo de saída: 'download' para baixar o arquivo ou 'blob' para retornar o Blob do PDF */
    output?: 'download' | 'blob';
}

/** Helper: create a hidden iframe, write HTML, wait for load */
async function createIframe(width: number, htmlContent: string): Promise<HTMLIFrameElement> {
    const iframe = document.createElement('iframe');
    // IMPORTANTE: Não usamos opacity 0 para evitar que o motor do Chrome desative renderização de sub-camadas
    iframe.style.cssText = `position:fixed;left:-9999px;top:0;width:${width}px;height:2000px;border:none;pointer-events:none;`;
    document.body.appendChild(iframe);

    const doc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!doc) throw new Error('Falha ao acessar iframe');

    doc.open();
    doc.write(htmlContent);
    doc.close();

    // Wait for DOM to settle + images to load
    await new Promise(r => setTimeout(r, 400));
    await Promise.all(
        Array.from(doc.images).map(img =>
            img.complete ? Promise.resolve() : new Promise(r => { img.onload = r; img.onerror = r; })
        )
    );

    return iframe;
}

/** Helper: capture an element as canvas */
async function captureToCanvas(
    element: HTMLElement,
    width: number,
    scale: number,
    height?: number,
): Promise<HTMLCanvasElement> {
    return html2canvas(element, {
        scale,
        useCORS: true,
        allowTaint: true,
        logging: false,
        windowWidth: width,
        ...(height ? { height } : {}),
    });
}

/**
 * Converte HTML completo em PDF e faz download direto ou retorna o Blob.
 * Extrai header/footer via DOM parsing, captura conteúdo de cada seção em iframes individuais.
 */
export async function htmlToPdf(options: HtmlToPdfOptions): Promise<Blob | void> {
    const { html, filename, orientation = 'portrait', scale = 2 } = options;

    // ── 1. Parse HTML via DOM to extract header, footer, content ──
    const parser = new DOMParser();
    const parsedDoc = parser.parseFromString(html, 'text/html');

    // Extract header/footer elements
    const headerEl = parsedDoc.querySelector('.fixed-header');
    const footerEl = parsedDoc.querySelector('.fixed-footer');
    const headerHtml = headerEl ? headerEl.outerHTML : '';
    const footerHtml = footerEl ? footerEl.outerHTML : '';

    // Build content-only HTML: remove fixed-header, fixed-footer, no-print, spacer rows
    if (headerEl) headerEl.remove();
    if (footerEl) footerEl.remove();
    const noPrint = parsedDoc.querySelector('.no-print');
    if (noPrint) noPrint.remove();
    
    // Remove spacer thead/tfoot from print-wrapper
    const printWrapper = parsedDoc.querySelector('table.print-wrapper');
    if (printWrapper) {
        const thead = printWrapper.querySelector(':scope > thead');
        const tfoot = printWrapper.querySelector(':scope > tfoot');
        if (thead) thead.remove();
        if (tfoot) tfoot.remove();
    }

    // ── 2. Setup dimensions (mm) ──
    const isLandscape = orientation === 'landscape';
    const pageWidthMm = isLandscape ? 297 : 210;
    const pageHeightMm = isLandscape ? 210 : 297;
    const marginX = 8;
    const marginY = 5;
    const contentWidthMm = pageWidthMm - (marginX * 2);
    const renderWidthPx = isLandscape ? 1123 : 794;

    // ── 3. Capture header & footer in a small temporary iframe ──
    let headerCanvas: HTMLCanvasElement | null = null;
    let footerCanvas: HTMLCanvasElement | null = null;

    if (headerHtml || footerHtml) {
        const helperHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
            * { margin:0; padding:0; box-sizing:border-box; }
            body { font-family:'Segoe UI',Arial,sans-serif; font-size:10px; color:#1a1a2e; background:#fff; }
            img { max-width:100%; height:auto; display:block; margin:0 auto; }
        </style></head><body></body></html>`;

        const helperFrame = await createIframe(renderWidthPx, helperHtml);
        const helperDoc = helperFrame.contentDocument!;

        try {
            // Capture header
            if (headerHtml) {
                const container = helperDoc.createElement('div');
                container.style.cssText = `width:${renderWidthPx}px;background:#fff;text-align:center;padding:6px 15px 4px;border-bottom:1px solid #cbd5e1;`;
                const hParsed = new DOMParser().parseFromString(headerHtml, 'text/html');
                const hEl = hParsed.querySelector('.fixed-header');
                container.innerHTML = hEl ? hEl.innerHTML : headerHtml;
                helperDoc.body.appendChild(container);
                await new Promise(r => setTimeout(r, 100));
                await Promise.all(Array.from(container.querySelectorAll('img')).map(img =>
                    (img as HTMLImageElement).complete ? Promise.resolve() : new Promise(r => { img.onload = r; img.onerror = r; })
                ));
                headerCanvas = await captureToCanvas(container, renderWidthPx, scale);
                helperDoc.body.removeChild(container);
            }

            // Capture footer
            if (footerHtml) {
                const container = helperDoc.createElement('div');
                container.style.cssText = `width:${renderWidthPx}px;background:#fff;text-align:center;padding:4px 15px 6px;border-top:1px solid #cbd5e1;`;
                const fParsed = new DOMParser().parseFromString(footerHtml, 'text/html');
                const fEl = fParsed.querySelector('.fixed-footer');
                container.innerHTML = fEl ? fEl.innerHTML : footerHtml;
                helperDoc.body.appendChild(container);
                await new Promise(r => setTimeout(r, 100));
                await Promise.all(Array.from(container.querySelectorAll('img')).map(img =>
                    (img as HTMLImageElement).complete ? Promise.resolve() : new Promise(r => { img.onload = r; img.onerror = r; })
                ));
                footerCanvas = await captureToCanvas(container, renderWidthPx, scale);
                helperDoc.body.removeChild(container);
            }
        } finally {
            document.body.removeChild(helperFrame);
        }
    }

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

    // ── 4. Split content-wrapper children into sections ──
    const contentWrapper = parsedDoc.querySelector('.content-wrapper');
    if (!contentWrapper) throw new Error('content-wrapper não encontrado no documento.');

    const sections: HTMLElement[][] = [[]];
    let currentIdx = 0;

    Array.from(contentWrapper.children).forEach((child) => {
        const htmlChild = child as HTMLElement;
        const styleAttr = htmlChild.getAttribute('style') || '';
        const isPageBreak = 
            htmlChild.style.pageBreakBefore === 'always' || 
            htmlChild.style.breakBefore === 'page' ||
            styleAttr.includes('page-break-before:always') ||
            styleAttr.includes('page-break-before: always') ||
            styleAttr.includes('break-before:page') ||
            styleAttr.includes('break-before: page');

        if (isPageBreak) {
            sections.push([]);
            currentIdx++;
        } else {
            sections[currentIdx].push(htmlChild);
        }
    });

    const activeSections = sections.filter(sec => sec.length > 0);
    const headHtml = parsedDoc.head.innerHTML;

    // Initialize unified jsPDF document
    const pdf = new jsPDF({
        orientation: isLandscape ? 'l' : 'p',
        unit: 'mm',
        format: 'a4',
    });

    const hdrData = headerCanvas ? headerCanvas.toDataURL('image/png') : null;
    const ftrData = footerCanvas ? footerCanvas.toDataURL('image/png') : null;
    let isFirstPage = true;

    // Process each section sequentially to keep canvas size small
    for (let sIdx = 0; sIdx < activeSections.length; sIdx++) {
        const sectionElements = activeSections[sIdx];
        const sectionContentHtml = sectionElements.map(el => el.outerHTML).join('\n');
        
        const sectionDocHtml = `<!DOCTYPE html><html><head>${headHtml}</head><body>
            <table class="print-wrapper">
            <tbody><tr><td>
            <div class="content-wrapper">
                ${sectionContentHtml}
            </div>
            </td></tr></tbody>
            </table>
        </body></html>`;

        const sectionFrame = await createIframe(renderWidthPx, sectionDocHtml);
        const sectionDoc = sectionFrame.contentDocument!;

        try {
            const wrapperEl = sectionDoc.querySelector('.content-wrapper') as HTMLElement || sectionDoc.body;
            const contentHeight = Math.max(wrapperEl.offsetHeight, wrapperEl.scrollHeight, 0);

            if (contentHeight < 25) {
                document.body.removeChild(sectionFrame);
                continue;
            }

            sectionFrame.style.height = `${contentHeight + 100}px`;
            await new Promise(r => setTimeout(r, 200));

            // Dynamic scale based on section height to completely prevent white-canvas browser limits
            let sectionScale = scale;
            if (contentHeight > 16000) {
                sectionScale = 1.0;
            } else if (contentHeight > 8000) {
                sectionScale = 1.25;
            }

            const sectionCanvas = await captureToCanvas(wrapperEl, renderWidthPx, sectionScale);

            const bodyImgTotalMm = (sectionCanvas.height / sectionCanvas.width) * contentWidthMm;
            const pxPerMm = sectionCanvas.height / bodyImgTotalMm;
            const safeBodyHeightMm = bodyHeightMm - 2;
            const maxSlicePx = Math.floor(safeBodyHeightMm * pxPerMm);

            // ── Row-boundary scanner ──
            const canvasWidth = sectionCanvas.width;
            const canvasHeight = sectionCanvas.height;
            const imgData = sectionCanvas.getContext('2d')!.getImageData(0, 0, canvasWidth, canvasHeight);
            const pixels = imgData.data;

            const isRowSafe = (y: number): boolean => {
                if (y < 0 || y >= canvasHeight) return false;
                let lightPixels = 0;
                const sampleStep = 4;
                const totalSamples = Math.floor(canvasWidth / sampleStep);
                for (let x = 0; x < canvasWidth; x += sampleStep) {
                    const idx = (y * canvasWidth + x) * 4;
                    const r = pixels[idx], g = pixels[idx + 1], b = pixels[idx + 2];
                    if (r > 230 && g > 230 && b > 230) lightPixels++;
                }
                return (lightPixels / totalSamples) > 0.90;
            };

            const findSafeBreak = (targetY: number, searchRange: number = 200): number => {
                const clampedTarget = Math.min(targetY, canvasHeight - 1);
                for (let y = clampedTarget; y > clampedTarget - searchRange && y > 0; y--) {
                    if (isRowSafe(y) && isRowSafe(y - 1)) {
                        return y;
                    }
                }
                return clampedTarget;
            };

            // ── Build page break positions for this section ──
            const breakPositions: number[] = [0];
            let currentY = 0;

            while (currentY < canvasHeight) {
                const idealEnd = currentY + maxSlicePx;
                // Tolerância de 60px para evitar criar uma página extra com uma fatia minúscula no final
                if (idealEnd + 60 >= canvasHeight) break;
                
                const safeBreakY = findSafeBreak(idealEnd);
                
                // Se a quebra de página recuou demais (menos de 100px de progresso), força o avanço
                if (safeBreakY - currentY < 100) {
                    const forcedEnd = Math.min(idealEnd, canvasHeight);
                    breakPositions.push(forcedEnd);
                    currentY = forcedEnd;
                } else {
                    breakPositions.push(safeBreakY);
                    currentY = safeBreakY;
                }
            }

            const totalSectionPages = breakPositions.length;

            for (let page = 0; page < totalSectionPages; page++) {
                if (isFirstPage) {
                    isFirstPage = false;
                } else {
                    pdf.addPage();
                }

                // ── Draw header ──
                if (hdrData) {
                    pdf.addImage(hdrData, 'PNG', marginX, marginY, contentWidthMm, headerHeightMm);
                }

                // ── Draw body slice ──
                const sliceStartPx = breakPositions[page];
                const sliceEndPx = page < totalSectionPages - 1 ? breakPositions[page + 1] : canvasHeight;
                const sliceHeightPx = sliceEndPx - sliceStartPx;

                if (sliceHeightPx > 0) {
                    const sliceCanvas = document.createElement('canvas');
                    sliceCanvas.width = canvasWidth;
                    sliceCanvas.height = sliceHeightPx;
                    const ctx = sliceCanvas.getContext('2d')!;
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, canvasWidth, sliceHeightPx);
                    ctx.drawImage(sectionCanvas, 0, sliceStartPx, canvasWidth, sliceHeightPx, 0, 0, canvasWidth, sliceHeightPx);

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
        } finally {
            document.body.removeChild(sectionFrame);
        }
    }

    // ── 4.5. Add dynamic page numbering (1/X format) ──
    const totalPages = pdf.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
        pdf.setPage(i);
        pdf.setFont('helvetica', 'normal');
        pdf.setFontSize(8);
        pdf.setTextColor(100, 116, 139); // Slate-500
        const pageText = `${i}/${totalPages}`;
        
        const xPos = pageWidthMm - marginX - 12;
        const yPos = pageHeightMm - marginY - 6;
        
        pdf.text(pageText, xPos, yPos, { align: 'right' });
    }

    // ── 5. Output PDF ──
    if (options.output === 'blob') {
        return pdf.output('blob');
    } else {
        pdf.save(`${filename}.pdf`);
    }
}
