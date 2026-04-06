import type { AnalysisResult } from './useTechnicalOracle';
import type { BiddingProcess } from '../../types';

export class OraclePdfExporter {
    export(bidding: BiddingProcess, result: AnalysisResult): Window | null {
        const printWindow = window.open('', '_blank');
        if (!printWindow) {
            console.warn('[OraclePdfExporter] Pop-up locked.');
            return null;
        }

        const html = this.buildHtml(bidding, result);
        printWindow.document.write(html);
        printWindow.document.close();
        return printWindow;
    }

    private buildHtml(bidding: BiddingProcess, result: AnalysisResult): string {
        const d = new Date().toLocaleDateString('pt-BR');
        
        let colorStatus = '#2563eb'; // Apto (vamos usar Azul Premium como default no cabeçalho PDF)
        if (result.overallStatus === 'Risco') colorStatus = '#ea580c';
        if (result.overallStatus === 'Inapto') colorStatus = '#dc2626';
        if (result.overallStatus === 'Apto') colorStatus = '#16a34a';

        const requirementsHtml = result.analysis.map((req: any, idx: number) => {
            const statusColor = req.status === 'Atende' ? '#16a34a' : req.status === 'Similar' ? '#ea580c' : '#dc2626';
            const statusBg = req.status === 'Atende' ? '#dcfce7' : req.status === 'Similar' ? '#ffedd5' : '#fee2e2';

            return `
                <div class="req-card">
                    <div class="req-header">
                        <div class="req-title">EXIGÊNCIA ${idx + 1}</div>
                        <div class="req-status" style="color: ${statusColor}; background: ${statusBg}; border-color: ${statusColor};">${req.status.toUpperCase()}</div>
                    </div>
                    <div class="req-body">
                        <p class="req-text"><strong>Texto do Edital:</strong> ${this.esc(req.requirement)}</p>
                        
                        <div class="comp-box">
                            <p style="margin:0 0 5px 0;"><strong>Comprovação Integrada / Somatório:</strong></p>
                            <p style="margin:0 0 5px 0; color: #1e3a8a;">${this.esc(req.foundExperience)}</p>
                            <div class="qty-line">
                                <span>Quantitativo Aceito:</span>
                                <strong>${req.foundQuantity}</strong>
                            </div>
                        </div>

                        <div class="just-box">
                            <p style="margin:0;"><strong>Fundamentação Técnica:</strong> ${this.esc(req.justification)}</p>
                            <p style="margin:5px 0 0 0; font-style: italic; color: #555;"><strong>Atestados amparados:</strong> ${this.esc(req.matchingCertificate)}</p>
                        </div>
                        
                        ${req.missing ? `<div class="missing-box"><strong>🔴 Déficit Mapeado:</strong> ${this.esc(req.missing)}</div>` : ''}
                    </div>
                </div>
            `;
        }).join('');

        return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Relatório do Oráculo - ${bidding.title}</title>
    <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; color: #1f2937; line-height: 1.5; font-size: 13px; margin: 0; padding: 0; background: #fff; }
        .page { padding: 40px; max-width: 800px; margin: 0 auto; box-sizing: border-box; }
        
        /* Cabeçalho */
        .header { border-bottom: 2px solid #e5e7eb; padding-bottom: 20px; margin-bottom: 30px; display: flex; justify-content: space-between; align-items: flex-end; }
        .logo-area h1 { margin: 0 0 5px 0; font-size: 24px; color: #111; letter-spacing: -0.5px; }
        .logo-area p { margin: 0; font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 1px; }
        .meta-d { text-align: right; font-size: 11px; color: #6b7280; }

        /* Dados do Processo */
        .process-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; margin-bottom: 30px; }
        .process-box h2 { margin: 0 0 10px 0; font-size: 16px; color: #0f172a; }
        .process-box p { margin: 4px 0; font-size: 13px; }
        
        /* Summary Report */
        .summary-box { border-left: 4px solid ${colorStatus}; background: #fafafa; padding: 15px 20px; margin-bottom: 30px; border-radius: 0 8px 8px 0; }
        .summary-box h3 { margin: 0 0 10px 0; font-size: 16px; display: flex; justify-content: space-between; }
        .badge { background: ${colorStatus}; color: white; padding: 3px 10px; border-radius: 12px; font-size: 12px; font-weight: bold; text-transform: uppercase; }
        .summary-box p { margin: 0; white-space: pre-line; color: #374151; }

        /* Requisitos */
        .req-card { border: 1px solid #e5e7eb; border-radius: 8px; margin-bottom: 20px; page-break-inside: avoid; overflow: hidden; }
        .req-header { background: #f9fafb; border-bottom: 1px solid #e5e7eb; padding: 12px 15px; display: flex; justify-content: space-between; align-items: center; }
        .req-title { font-weight: 700; font-size: 12px; color: #4b5563; }
        .req-status { padding: 3px 10px; border-radius: 12px; font-size: 11px; font-weight: 800; border: 1px solid; }
        .req-body { padding: 15px; }
        .req-text { font-size: 14px; color: #111; margin: 0 0 15px 0; }

        /* Caixas internas */
        .comp-box { background: #eff6ff; padding: 12px; border-radius: 6px; margin-bottom: 10px; border: 1px solid #bfdbfe; }
        .qty-line { border-top: 1px dashed #93c5fd; padding-top: 8px; margin-top: 8px; display: flex; justify-content: space-between; font-size: 14px; }
        .just-box { background: #f9fafb; padding: 12px; border-radius: 6px; border: 1px solid #e5e7eb; }
        .missing-box { background: #fef2f2; padding: 10px 12px; border-radius: 6px; border: 1px solid #fecaca; margin-top: 10px; color: #991b1b; font-size: 13px; }

        /* Impressão */
        @media print {
            body { background: transparent; }
            .page { padding: 0; max-width: 100%; margin: 1cm; }
        }
    </style>
</head>
<body>
    <script>
    window.onload = function() {
        setTimeout(function() { window.print(); }, 800);
    };
    </script>
    <div class="page">
        <div class="header">
            <div class="logo-area">
                <h1>Relatório do Oráculo Técnico</h1>
                <p>Análise de Somatório & Aderência Material</p>
            </div>
            <div class="meta-d">
                <p style="margin:0;">Data da Extração: <strong>${d}</strong></p>
                <p style="margin:0;">LicitaSaaS - Módulo Inteligência</p>
            </div>
        </div>

        <div class="process-box">
            <h2>Processo Analisado</h2>
            <p><strong>Edital/Processo:</strong> ${this.esc(bidding.title)}</p>
            <p><strong>Objeto:</strong> ${this.esc(bidding.summary || '')}</p>
        </div>

        <div class="summary-box">
            <h3><span>Parecer da IA:</span> <span class="badge">${result.overallStatus}</span></h3>
            ${result.summaryReport ? `<p>${this.esc(result.summaryReport)}</p>` : `<p>Análise fundamentada considerando o somatório do acervo técnico verificado contra as exigências materiais deste processo.</p>`}
        </div>

        <div style="margin-top: 30px;">
            <h3 style="color: #111; border-bottom: 2px solid #111; padding-bottom: 8px; font-size: 18px; margin-bottom: 20px;">Detalhamento das Exigências</h3>
            ${requirementsHtml}
        </div>
    </div>
</body>
</html>`;
    }

    private esc(text?: string): string {
        if (!text) return '';
        return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
}
