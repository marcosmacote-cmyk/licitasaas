/**
 * htmlToPdfEngine.ts — Converte HTML para PDF nativo via jsPDF + html2canvas
 * 
 * Renderiza o HTML em um iframe oculto, captura com html2canvas,
 * e gera PDF real com jsPDF. Download direto, sem janela de impressão.
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

/**
 * Converte HTML completo em PDF e faz download direto.
 * Usa iframe oculto + html2canvas + jsPDF.
 */
export async function htmlToPdf(options: HtmlToPdfOptions): Promise<void> {
    const { html, filename, orientation = 'portrait', scale = 2 } = options;

    // 1. Criar iframe oculto para renderizar o HTML
    const iframe = document.createElement('iframe');
    iframe.style.cssText = 'position:fixed;left:-9999px;top:0;width:210mm;height:297mm;border:none;opacity:0;pointer-events:none;';
    if (orientation === 'landscape') {
        iframe.style.width = '297mm';
        iframe.style.height = '210mm';
    }
    document.body.appendChild(iframe);

    try {
        // 2. Escrever o HTML no iframe
        const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
        if (!iframeDoc) throw new Error('Falha ao acessar iframe');
        
        // Inject styles to hide print-only elements and ensure proper rendering
        const cleanHtml = html
            .replace(/class="no-print"[^>]*>[\s\S]*?<\/div>/g, '') // Remove botão "Salvar como PDF"
            .replace(/class="fixed-header"/g, 'class="fixed-header" style="position:static !important;"') // Unfixed for capture
            .replace(/class="fixed-footer"/g, 'class="fixed-footer" style="position:static !important;"'); // Unfixed for capture

        iframeDoc.open();
        iframeDoc.write(cleanHtml);
        iframeDoc.close();

        // 3. Esperar imagens e fontes carregarem
        await new Promise(resolve => setTimeout(resolve, 300));
        await Promise.all(
            Array.from(iframeDoc.images).map(img =>
                img.complete ? Promise.resolve() : new Promise(r => { img.onload = r; img.onerror = r; })
            )
        );

        // 4. Capturar com html2canvas
        const body = iframeDoc.body;
        const canvas = await html2canvas(body, {
            scale,
            useCORS: true,
            allowTaint: true,
            logging: false,
            windowWidth: orientation === 'landscape' ? 1123 : 794, // A4 at 96dpi
            windowHeight: orientation === 'landscape' ? 794 : 1123,
        });

        // 5. Gerar PDF com jsPDF
        const isLandscape = orientation === 'landscape';
        const pdf = new jsPDF({
            orientation: isLandscape ? 'l' : 'p',
            unit: 'mm',
            format: 'a4',
        });

        const pageWidth = isLandscape ? 297 : 210;
        const pageHeight = isLandscape ? 210 : 297;
        const margin = 5; // mm
        const contentWidth = pageWidth - (margin * 2);
        const contentHeight = pageHeight - (margin * 2);

        // Calculate how many pages we need
        const imgWidth = contentWidth;
        const imgHeight = (canvas.height * imgWidth) / canvas.width;
        const totalPages = Math.ceil(imgHeight / contentHeight);

        for (let page = 0; page < totalPages; page++) {
            if (page > 0) pdf.addPage();

            // Calculate the source crop for this page
            const sourceY = (page * contentHeight * canvas.width) / imgWidth;
            const sourceHeight = (contentHeight * canvas.width) / imgWidth;
            const actualSourceHeight = Math.min(sourceHeight, canvas.height - sourceY);

            // Create a temporary canvas for this page's slice
            const pageCanvas = document.createElement('canvas');
            pageCanvas.width = canvas.width;
            pageCanvas.height = actualSourceHeight;
            const ctx = pageCanvas.getContext('2d')!;
            ctx.drawImage(canvas, 0, sourceY, canvas.width, actualSourceHeight, 0, 0, canvas.width, actualSourceHeight);

            const pageImgData = pageCanvas.toDataURL('image/jpeg', 0.95);
            const pageImgHeight = (actualSourceHeight * imgWidth) / canvas.width;
            pdf.addImage(pageImgData, 'JPEG', margin, margin, imgWidth, pageImgHeight);
        }

        // 6. Download direto
        pdf.save(`${filename}.pdf`);
    } finally {
        // 7. Limpar iframe
        document.body.removeChild(iframe);
    }
}
