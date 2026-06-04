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
        
        let colorStatus = '#3b82f6'; // Default Azul
        let statusBg = '#eff6ff';
        let statusBorder = '#bfdbfe';

        if (result.overallStatus === 'Risco') {
            colorStatus = '#f59e0b';
            statusBg = '#fffbeb';
            statusBorder = '#fde68a';
        } else if (result.overallStatus === 'Inapto') {
            colorStatus = '#ef4444';
            statusBg = '#fff1f2';
            statusBorder = '#fecdd3';
        } else if (result.overallStatus === 'Apto') {
            colorStatus = '#10b981';
            statusBg = '#f0fdf4';
            statusBorder = '#bbf7d0';
        }

        const requirementsHtml = result.analysis.map((req: any, idx: number) => {
            let statusColor = '#3b82f6';
            let reqBg = '#eff6ff';
            let reqBorder = '#bfdbfe';

            if (req.status === 'Atende') {
                statusColor = '#10b981';
                reqBg = '#f0fdf4';
                reqBorder = '#bbf7d0';
            } else if (req.status === 'Similar') {
                statusColor = '#f59e0b';
                reqBg = '#fffbeb';
                reqBorder = '#fde68a';
            } else if (req.status === 'Não Atende') {
                statusColor = '#ef4444';
                reqBg = '#fff1f2';
                reqBorder = '#fecdd3';
            }

            return `
                <div class="req-card">
                    <div class="req-header">
                        <span class="req-title">EXIGÊNCIA TÉCNICA ${idx + 1}</span>
                        <span class="req-status" style="color: ${statusColor}; background: ${reqBg}; border-color: ${statusColor};">${req.status.toUpperCase()}</span>
                    </div>
                    <div class="req-body">
                        <p class="req-text">${this.esc(req.requirement)}</p>
                        
                        <!-- Colunas Flex/Tabela para visual em grid limpo -->
                        <table class="detail-grid-table">
                            <tr>
                                <td class="grid-col" style="width: 50%; vertical-align: top;">
                                    <div class="comp-box">
                                        <div class="box-title">COMPROVAÇÃO INTEGRADA / SOMATÓRIO</div>
                                        <p class="box-text">${this.esc(req.foundExperience)}</p>
                                        <div class="qty-line">
                                            <span class="qty-label">Quantitativo Somado:</span>
                                            <span class="qty-value">${this.formatQuantity(req.foundQuantity)}</span>
                                        </div>
                                    </div>
                                </td>
                                <td class="grid-col" style="width: 50%; vertical-align: top;">
                                    <div class="just-box">
                                        <div>
                                            <div class="box-title">FUNDAMENTAÇÃO TÉCNICA</div>
                                            <p class="box-text">${this.esc(req.justification)}</p>
                                        </div>
                                        <div class="atestados-list">
                                            <strong>Atestados associados:</strong> ${this.esc(req.matchingCertificate)}
                                        </div>
                                    </div>
                                </td>
                            </tr>
                        </table>
                        
                        ${req.missing ? `
                        <div class="missing-box">
                            <strong>Déficit de Qualificação:</strong> ${this.esc(req.missing)}
                        </div>` : ''}
                    </div>
                </div>
            `;
        }).join('');

        return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Relatório do Oráculo Técnico - ${bidding.title}</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');

        body { 
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif; 
            color: #1e293b; 
            line-height: 1.6; 
            font-size: 13px; 
            margin: 0; 
            padding: 0; 
            background: #fff; 
            -webkit-print-color-adjust: exact; 
            print-color-adjust: exact;
        }
        
        .page { 
            padding: 40px; 
            max-width: 850px; 
            margin: 0 auto; 
            box-sizing: border-box; 
        }
        
        /* Cabeçalho Premium */
        .header { 
            border-bottom: 2px solid #f1f5f9; 
            padding-bottom: 20px; 
            margin-bottom: 30px; 
            display: flex; 
            justify-content: space-between; 
            align-items: flex-end; 
        }
        .logo-area h1 { 
            margin: 0 0 4px 0; 
            font-size: 24px; 
            color: #0f172a; 
            font-weight: 800;
            letter-spacing: -0.025em;
        }
        .logo-area p { 
            margin: 0; 
            font-size: 10px; 
            color: #64748b; 
            text-transform: uppercase; 
            letter-spacing: 0.1em; 
            font-weight: 600;
        }
        .meta-d { 
            text-align: right; 
            font-size: 11px; 
            color: #64748b; 
            line-height: 1.4;
        }

        /* Dados do Processo (Grid modernizado) */
        .meta-table {
            width: 100%;
            border-collapse: separate;
            border-spacing: 0;
            background: #f8fafc;
            border: 1px solid #e2e8f0;
            border-radius: 8px;
            margin-bottom: 24px;
            font-size: 12px;
        }
        .meta-table td {
            padding: 14px 18px;
        }
        .meta-label {
            display: block;
            font-size: 9px;
            font-weight: 700;
            color: #64748b;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            margin-bottom: 4px;
        }
        .meta-value {
            font-weight: 600;
            color: #0f172a;
            font-size: 13px;
        }

        /* Parecer da IA */
        .summary-box { 
            border-left: 5px solid ${colorStatus}; 
            background: ${statusBg}; 
            border-top: 1px solid ${statusBorder};
            border-right: 1px solid ${statusBorder};
            border-bottom: 1px solid ${statusBorder};
            padding: 20px 24px; 
            margin-bottom: 30px; 
            border-radius: 4px 8px 8px 4px; 
        }
        .summary-box h3 { 
            margin: 0 0 8px 0; 
            font-size: 15px; 
            font-weight: 700;
            color: #0f172a;
            display: flex; 
            justify-content: space-between; 
            align-items: center;
        }
        .badge { 
            background: ${colorStatus}; 
            color: white; 
            padding: 4px 14px; 
            border-radius: 9999px; 
            font-size: 11px; 
            font-weight: 700; 
            text-transform: uppercase; 
            letter-spacing: 0.05em;
        }
        .summary-box p { 
            margin: 0; 
            font-size: 13px;
            line-height: 1.6;
            color: #334155; 
            white-space: pre-line;
        }

        /* Requisitos Cards */
        .req-card { 
            border: 1px solid #e2e8f0; 
            border-radius: 8px; 
            margin-bottom: 24px; 
            page-break-inside: avoid; 
            overflow: hidden; 
            background: #fff;
            box-shadow: 0 1px 3px rgba(0,0,0,0.02);
        }
        .req-header { 
            background: #f8fafc; 
            border-bottom: 1px solid #e2e8f0; 
            padding: 12px 20px; 
            display: flex; 
            justify-content: space-between; 
            align-items: center; 
        }
        .req-title { 
            font-weight: 700; 
            font-size: 10px; 
            color: #475569; 
            letter-spacing: 0.05em;
        }
        .req-status { 
            padding: 3px 12px; 
            border-radius: 9999px; 
            font-size: 10px; 
            font-weight: 700; 
            border: 1px solid; 
            letter-spacing: 0.02em;
        }
        .req-body { 
            padding: 20px; 
        }
        .req-text { 
            font-size: 14px; 
            color: #0f172a; 
            margin: 0 0 16px 0; 
            font-weight: 500;
        }

        /* Grid de Detalhes da Exigência */
        .detail-grid-table {
            width: 100%;
            border-collapse: separate;
            border-spacing: 12px 0;
            margin-left: -12px;
            margin-right: -12px;
        }
        .grid-col {
            padding: 0;
        }

        /* Caixas internas de conteúdo */
        .comp-box { 
            background: #eff6ff; 
            padding: 16px; 
            border-radius: 8px; 
            border: 1px solid #bfdbfe; 
            height: 100%;
            box-sizing: border-box;
        }
        .just-box { 
            background: #f8fafc; 
            padding: 16px; 
            border-radius: 8px; 
            border: 1px solid #e2e8f0; 
            height: 100%;
            box-sizing: border-box;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
        }
        .box-title {
            font-size: 9px;
            font-weight: 700;
            color: #475569;
            letter-spacing: 0.05em;
            margin-bottom: 8px;
        }
        .comp-box .box-title {
            color: #1d4ed8;
        }
        .box-text {
            margin: 0 0 10px 0;
            font-size: 12px;
            color: #334155;
            line-height: 1.5;
        }
        .qty-line { 
            border-top: 1px dashed #93c5fd; 
            padding-top: 8px; 
            margin-top: 8px; 
            display: flex; 
            justify-content: space-between; 
            align-items: center;
        }
        .qty-label {
            font-size: 11px;
            color: #1e40af;
        }
        .qty-value {
            font-size: 15px;
            font-weight: 800;
            color: #1e3a8a;
        }
        .atestados-list {
            margin-top: 10px;
            padding-top: 8px;
            border-top: 1px solid #e2e8f0;
            font-size: 11px;
            color: #64748b;
            line-height: 1.4;
        }

        .missing-box { 
            background: #fff1f2; 
            padding: 12px 16px; 
            border-radius: 6px; 
            border: 1px solid #fecdd3; 
            margin-top: 16px; 
            color: #991b1b; 
            font-size: 12px; 
            font-weight: 500;
        }

        /* Impressão e quebras */
        @media print {
            body { background: transparent; }
            .page { padding: 0; max-width: 100%; margin: 1.2cm 1cm; }
            .req-card { page-break-inside: avoid; }
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

        <table class="meta-table">
            <tr>
                <td style="width: 65%; border-right: 1px solid #e2e8f0;">
                    <span class="meta-label">Processo Analisado</span>
                    <div class="meta-value" style="font-weight: 700; font-size: 13px;">${this.esc(bidding.title)}</div>
                </td>
                <td style="width: 35%;">
                    <span class="meta-label">Órgão / Portal</span>
                    <div class="meta-value">${this.esc(bidding.portal || 'Não Informado')}</div>
                </td>
            </tr>
            ${bidding.summary ? `
            <tr>
                <td colspan="2" style="border-top: 1px solid #e2e8f0; background: #fafbfc;">
                    <span class="meta-label">Objeto Licitado</span>
                    <div class="meta-value" style="font-weight: 400; color: #475569; font-size: 12px; line-height: 1.5;">${this.esc(bidding.summary)}</div>
                </td>
            </tr>` : ''}
        </table>

        <div class="summary-box">
            <h3><span>Parecer Técnico do Oráculo</span> <span class="badge">${result.overallStatus}</span></h3>
            ${result.summaryReport ? `<p>${this.esc(result.summaryReport)}</p>` : `<p>Análise fundamentada considerando o somatório do acervo técnico verificado contra as exigências materiais deste processo.</p>`}
        </div>

        <div style="margin-top: 30px;">
            <h3 style="color: #0f172a; border-bottom: 2px solid #0f172a; padding-bottom: 8px; font-size: 16px; margin-bottom: 20px; font-weight: 800; letter-spacing: -0.01em;">Detalhamento das Exigências</h3>
            ${requirementsHtml}
        </div>
    </div>
</body>
</html>`;
    }

    private formatQuantity(val: any): string {
        if (val === null || val === undefined) return '-';
        const cleanStr = String(val).trim();
        const num = Number(cleanStr.replace(',', '.'));
        if (isNaN(num)) return cleanStr;
        return num.toLocaleString('pt-BR');
    }

    private esc(text?: string): string {
        if (!text) return '';
        return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }
}
